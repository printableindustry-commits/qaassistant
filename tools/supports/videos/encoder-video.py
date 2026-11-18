"""Encode les captures d'un enregistrement (manifest.json + JPEG) en vidéo MP4 légendée (H.264, sans son).

Usage : python encoder-video.py <dossier-captures> <sortie.mp4> [--vitesse 1.0] [--max-duree 27]
        [--max-pause 2.2] [--fin 1.2] [--crf 26] [--cible-mo 4]

- chaque capture reçoit un bandeau de légende en bas (fond sombre, texte blanc) ; une légende
  « Étape n — … » est dessinée avec la pastille rouge numérotée des annotations ;
- images identiques fusionnées (durée cumulée), pause plafonnée (--max-pause), pause finale (--fin) ;
- si la durée dépasse --max-duree, la vitesse est augmentée jusqu'à tenir ;
- encodage : libx264, yuv420p, crf 26, preset slow, +faststart, 30 i/s ; nouvel essai avec un crf plus
  élevé si le fichier dépasse --cible-mo.
ffmpeg : variable FFMPEG, sinon imageio_ffmpeg (pip install imageio-ffmpeg), sinon « ffmpeg » du PATH.
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw, ImageFont

BANDEAU = 54
FOND = (24, 32, 42)
ROUGE = (198, 40, 40)
VERT = (15, 122, 90)
POLICES = ["C:/Windows/Fonts/segoeuisb.ttf", "C:/Windows/Fonts/segoeui.ttf", "C:/Windows/Fonts/arial.ttf"]
POLICES_GRAS = ["C:/Windows/Fonts/segoeuib.ttf", "C:/Windows/Fonts/arialbd.ttf"]
ETAPE = re.compile(r"^Étape (\d+) — (.*)$")


def police(taille, gras=False):
    for p in (POLICES_GRAS if gras else []) + POLICES:
        if os.path.exists(p):
            return ImageFont.truetype(p, taille)
    return ImageFont.load_default()


def ffmpeg():
    if os.environ.get("FFMPEG"):
        return os.environ["FFMPEG"]
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return shutil.which("ffmpeg") or "ffmpeg"


def bandeau(img, texte, fnt, fnt_num):
    w, h = img.size
    out = Image.new("RGB", (w, h + BANDEAU), FOND)
    out.paste(img, (0, 0))
    d = ImageDraw.Draw(out)
    m = ETAPE.match(texte or "")
    d.rectangle([0, h, 7, h + BANDEAU], fill=ROUGE if m else VERT)
    cy = h + BANDEAU / 2
    if m:
        n, reste = m.group(1), m.group(2)
        etiquette = f"Étape {n} — "
        largeur = 40 + 12 + d.textlength(etiquette, font=fnt) + d.textlength(reste, font=fnt)
        x = (w - largeur) / 2
        d.ellipse([x, cy - 20, x + 40, cy + 20], fill=(255, 255, 255))
        d.ellipse([x + 3, cy - 17, x + 37, cy + 17], fill=ROUGE)
        d.text((x + 20, cy), n, font=fnt_num, fill=(255, 255, 255), anchor="mm")
        x += 52
        d.text((x, cy), etiquette, font=fnt, fill=(255, 140, 140), anchor="lm")
        x += d.textlength(etiquette, font=fnt)
        d.text((x, cy), reste, font=fnt, fill=(255, 255, 255), anchor="lm")
    elif texte:
        tw = d.textlength(texte, font=fnt)
        d.text(((w - tw) / 2, cy), texte, font=fnt, fill=(255, 255, 255), anchor="lm")
    return out


def sequence(man, dossier):
    """[(fichier, legende, t)] sans les doublons exacts consécutifs (même image, même légende)."""
    seq, der = [], None
    for im in man["images"]:
        cle = (hashlib.md5(open(os.path.join(dossier, im["f"]), "rb").read()).hexdigest(), im.get("legende", ""))
        if cle == der:
            continue
        der = cle
        seq.append((im["f"], im.get("legende", ""), im["t"]))
    return seq


def durees(seq, fin_t, vitesse, max_pause):
    out = []
    for i, (_, _, t) in enumerate(seq):
        suiv = seq[i + 1][2] if i + 1 < len(seq) else fin_t
        out.append(min(max(1 / 30, (suiv - t) / 1000 / vitesse), max_pause))
    return out


def duree_video(path, exe):
    r = subprocess.run([exe, "-hide_banner", "-i", path], capture_output=True, text=True, encoding="utf-8", errors="replace")
    m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", r.stderr)
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3)) if m else -1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dossier")
    ap.add_argument("sortie")
    ap.add_argument("--vitesse", type=float, default=1.0)
    ap.add_argument("--max-duree", type=float, default=27)
    ap.add_argument("--max-pause", type=float, default=2.2)
    ap.add_argument("--fin", type=float, default=1.2)
    ap.add_argument("--crf", type=int, default=26)
    ap.add_argument("--cible-mo", type=float, default=4)
    a = ap.parse_args()

    man = json.load(open(os.path.join(a.dossier, "manifest.json"), encoding="utf-8"))
    seq = sequence(man, a.dossier)
    if not seq:
        print("Aucune capture : vidéo non produite", file=sys.stderr)
        return 1
    vitesse, cible = a.vitesse, a.max_duree
    for passe in range(3):  # l'encodage peut allonger un peu la durée prévue : nouvelle passe corrigée
        r = encoder(a, seq, man, vitesse, cible)
        if r is None:
            return 1
        duree, vitesse, prevu = r
        if duree <= a.max_duree + 1 or vitesse > 6:
            break
        cible *= a.max_duree / duree
    if duree >= 30:
        print("ATTENTION : vidéo de 30 s ou plus", file=sys.stderr)
    return 0


def encoder(a, seq, man, vitesse, cible):
    while True:
        ds = durees(seq, man["fin"], vitesse, a.max_pause)
        total = sum(ds) + a.fin
        if total <= cible or vitesse > 6:
            break
        vitesse *= min(1.25, max(1.02, total / cible))
    ds[-1] += a.fin

    exe = ffmpeg()
    tmp = tempfile.mkdtemp(prefix="video-")
    try:
        fnt, fnt_num = police(21), police(18, True)
        ref = Image.open(os.path.join(a.dossier, seq[0][0])).size  # taille de référence (première image)
        lignes = []
        for i, ((f, leg, _), d) in enumerate(zip(seq, ds)):
            src = Image.open(os.path.join(a.dossier, f)).convert("RGB")
            if src.size != ref:
                src = src.resize(ref, Image.LANCZOS)
            img = bandeau(src, leg, fnt, fnt_num)
            if img.size[0] % 2 or img.size[1] % 2:
                img = img.crop((0, 0, img.size[0] // 2 * 2, img.size[1] // 2 * 2))
            nom = f"{i:05d}.jpg"
            img.save(os.path.join(tmp, nom), quality=95)
            lignes += [f"file '{nom}'", f"duration {d:.3f}"]
        lignes.append(f"file '{nom}'")
        with open(os.path.join(tmp, "liste.txt"), "w", encoding="utf-8") as fl:
            fl.write("\n".join(lignes) + "\n")
        os.makedirs(os.path.dirname(os.path.abspath(a.sortie)), exist_ok=True)
        for crf in (a.crf, a.crf + 3, a.crf + 6, a.crf + 9):
            cmd = [exe, "-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", "liste.txt",
                   "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", str(crf), "-preset", "slow",
                   "-movflags", "+faststart", "-r", "30", os.path.abspath(a.sortie)]
            r = subprocess.run(cmd, cwd=tmp, capture_output=True, text=True, encoding="utf-8", errors="replace")
            if r.returncode:
                print(r.stderr, file=sys.stderr)
                return None
            taille = os.path.getsize(a.sortie)
            duree = duree_video(a.sortie, exe)
            print(f"{os.path.basename(a.sortie)} : {duree:.1f} s, {taille / 1e6:.2f} Mo, {len(seq)} images "
                  f"(vitesse x{vitesse:.2f}, crf {crf}, {img.size[0]}×{img.size[1]})")
            if taille <= a.cible_mo * 1e6:
                break
        else:
            print("ATTENTION : cible de taille dépassée", file=sys.stderr)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return duree, vitesse, sum(ds)


if __name__ == "__main__":
    sys.exit(main())

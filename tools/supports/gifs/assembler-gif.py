"""Assemble les captures d'un enregistrement (manifest.json + JPEG) en GIF animé légendé.

Usage : python assembler-gif.py <dossier-captures> <sortie.gif> [--vitesse 1.0] [--largeur 960]
        [--max-pause 2.5] [--fin 1.5] [--cible-mo 2.5]

- largeur 960 px, bandeau de légende en bas (fond sombre, texte blanc), légende propre à chaque image ;
- palette adaptative commune (calculée sur un échantillon d'images), réutilisée pour toutes les images ;
- images identiques fusionnées (durée cumulée), pause plafonnée (--max-pause), pause finale (--fin) ;
- si le fichier dépasse --cible-mo, nouvel essai avec moins de couleurs puis moins d'images par seconde
  (intervalle minimal entre deux images, durées conservées).
"""
import argparse
import json
import os
import sys

from PIL import Image, ImageChops, ImageDraw, ImageFont

BANDEAU = 46
FOND = (24, 32, 42)
POLICES = ["C:/Windows/Fonts/segoeuisb.ttf", "C:/Windows/Fonts/segoeui.ttf", "C:/Windows/Fonts/arial.ttf"]


def police(taille):
    for p in POLICES:
        if os.path.exists(p):
            return ImageFont.truetype(p, taille)
    return ImageFont.load_default()


def bandeau(img, texte, fnt):
    w, h = img.size
    out = Image.new("RGB", (w, h + BANDEAU), FOND)
    out.paste(img, (0, 0))
    d = ImageDraw.Draw(out)
    d.rectangle([0, h, 6, h + BANDEAU], fill=(15, 122, 90))  # liseré vert Prisme
    if texte:
        tw = d.textlength(texte, font=fnt)
        d.text(((w - tw) / 2, h + BANDEAU / 2), texte, font=fnt, fill=(255, 255, 255), anchor="lm")
    return out


def charger(dossier, largeur, vitesse, max_pause, intervalle=0):
    man = json.load(open(os.path.join(dossier, "manifest.json"), encoding="utf-8"))
    imgs = []
    for k, im in enumerate(man["images"]):  # au plus une image par « intervalle » ms (la dernière d'une rafale est gardée)
        suiv = man["images"][k + 1]["t"] if k + 1 < len(man["images"]) else man["fin"]
        if imgs and im["t"] - imgs[-1]["t"] < intervalle and suiv - im["t"] < intervalle and im.get("legende") == imgs[-1].get("legende"):
            continue
        imgs.append(im)
    fnt = police(19)
    sortie = []
    for i, im in enumerate(imgs):
        t_suiv = imgs[i + 1]["t"] if i + 1 < len(imgs) else man["fin"]
        duree = max(40, (t_suiv - im["t"]) / vitesse)
        src = Image.open(os.path.join(dossier, im["f"])).convert("RGB")
        hauteur = round(src.height * largeur / src.width)
        src = src.resize((largeur, hauteur), Image.LANCZOS)
        sortie.append([bandeau(src, im.get("legende", ""), fnt), duree])
    # fusion des images identiques (ou quasi : bruit JPEG)
    fus = []
    for img, d in sortie:
        if fus:
            diff = ImageChops.difference(img, fus[-1][0]).convert("L").point(lambda v: 255 if v > 18 else 0)
            if diff.getbbox() is None:
                fus[-1][1] += d
                continue
        fus.append([img, d])
    for f in fus:
        f[1] = min(f[1], max_pause * 1000)
    return fus


def ecrire(fus, sortie, couleurs, fin):
    # palette commune : mosaïque d'un échantillon d'images
    ech = fus[:: max(1, len(fus) // 12)][:12]
    w, h = fus[0][0].size
    mos = Image.new("RGB", (w, h * len(ech)))
    for i, (im, _) in enumerate(ech):
        mos.paste(im, (0, h * i))
    pal = mos.quantize(colors=couleurs, method=Image.Quantize.MEDIANCUT)
    frames = [im.quantize(palette=pal, dither=Image.Dither.NONE) for im, _ in fus]
    durees = [int(round(d / 10.0) * 10) for _, d in fus]
    durees[-1] = max(durees[-1], int(fin * 1000))
    frames[0].save(sortie, save_all=True, append_images=frames[1:], duration=durees, loop=0,
                   optimize=False, disposal=1)
    return os.path.getsize(sortie), sum(durees) / 1000, len(frames)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dossier")
    ap.add_argument("sortie")
    ap.add_argument("--vitesse", type=float, default=1.0)
    ap.add_argument("--largeur", type=int, default=960)
    ap.add_argument("--max-pause", type=float, default=2.5)
    ap.add_argument("--fin", type=float, default=1.5)
    ap.add_argument("--cible-mo", type=float, default=2.5)
    a = ap.parse_args()
    essais = [(0, 256), (0, 160), (250, 160), (350, 128), (500, 96), (700, 96)]
    for pas, couleurs in essais:
        fus = charger(a.dossier, a.largeur, a.vitesse, a.max_pause, pas)
        taille, duree, n = ecrire(fus, a.sortie, couleurs, a.fin)
        print(f"{os.path.basename(a.sortie)} : {taille / 1e6:.2f} Mo, {duree:.1f} s, {n} images "
              f"(intervalle mini {pas} ms, {couleurs} couleurs)")
        if taille <= a.cible_mo * 1e6:
            return 0
    print("ATTENTION : cible de taille dépassée", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())

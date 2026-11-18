"""Planche de contrôle d'un GIF : N images réparties sur la durée, en grille (vérification visuelle rapide).

Usage : python planche-controle.py <fichier.gif> <sortie.png> [--n 9] [--colonnes 3] [--largeur 640]
"""
import argparse

from PIL import Image, ImageDraw, ImageSequence


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("gif")
    ap.add_argument("sortie")
    ap.add_argument("--n", type=int, default=9)
    ap.add_argument("--colonnes", type=int, default=3)
    ap.add_argument("--largeur", type=int, default=640)
    a = ap.parse_args()
    im = Image.open(a.gif)
    images, temps, t = [], [], 0
    for fr in ImageSequence.Iterator(im):
        images.append(fr.convert("RGB"))
        temps.append(t)
        t += fr.info.get("duration", 100)
    total = t
    choix = []
    for k in range(a.n):
        cible = total * k / max(1, a.n - 1) - 1 if k else 0
        i = max(j for j, tt in enumerate(temps) if tt <= max(0, cible))
        choix.append(i)
    w = a.largeur
    h = round(images[0].height * w / images[0].width)
    lignes = (len(choix) + a.colonnes - 1) // a.colonnes
    planche = Image.new("RGB", (w * a.colonnes, (h + 18) * lignes), (255, 255, 255))
    d = ImageDraw.Draw(planche)
    for n, i in enumerate(choix):
        x, y = (n % a.colonnes) * w, (n // a.colonnes) * (h + 18)
        planche.paste(images[i].resize((w, h), Image.LANCZOS), (x, y + 18))
        d.text((x + 4, y + 3), f"image {i}  t={temps[i] / 1000:.1f}s / {total / 1000:.1f}s", fill=(0, 0, 0))
    planche.save(a.sortie)


if __name__ == "__main__":
    main()

# Annote les captures brutes : cadres arrondis, pastilles numérotées et légende « Repères » à droite.
# Usage : python tools/supports/annoter.py <boites.json>
# Entrées : supports/captures/NN-ecran.png ; sorties : docs/captures-annotees/NN-ecran.jpg et reperes.json.
import json, os, sys
from PIL import Image, ImageDraw, ImageFont

RACINE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BRUT = os.path.join(RACINE, 'supports', 'captures')
SORTIE = os.path.join(RACINE, 'docs', 'captures-annotees')
ACCENT = (214, 40, 57)          # rouge des repères (lisible sur le vert Prisme)
VERT = (0, 105, 77)             # vert profond Prisme
ENCRE = (28, 36, 33)
GRIS = (96, 108, 104)
FOND = (246, 248, 247)
LARGEUR_LEGENDE = 560
FONTS = 'C:/Windows/Fonts/'

def police(taille, gras=False):
    return ImageFont.truetype(FONTS + ('segoeuib.ttf' if gras else 'segoeui.ttf'), taille)

def couper(draw, texte, font, largeur):
    lignes, ligne = [], ''
    for mot in texte.split():
        essai = (ligne + ' ' + mot).strip()
        if draw.textlength(essai, font=font) <= largeur: ligne = essai
        else: lignes.append(ligne); ligne = mot
    if ligne: lignes.append(ligne)
    return lignes

def pastille(draw, cx, cy, n, r=15):
    draw.ellipse((cx - r - 2, cy - r - 2, cx + r + 2, cy + r + 2), fill=(255, 255, 255))
    draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=ACCENT)
    f = police(17, True)
    draw.text((cx, cy - 1), str(n), font=f, fill=(255, 255, 255), anchor='mm')

def annoter(cap):
    img = Image.open(os.path.join(BRUT, cap['fichier'] + '.png')).convert('RGB')
    W, H = img.size
    toile = Image.new('RGB', (W + LARGEUR_LEGENDE, H), FOND)
    toile.paste(img, (0, 0))
    d = ImageDraw.Draw(toile)
    # cadres puis pastilles (au coin haut gauche, rentrées dans l'écran)
    for r in cap['reperes']:
        d.rounded_rectangle((r['x'], r['y'], r['x'] + r['w'], r['y'] + r['h']), radius=10, outline=ACCENT, width=3)
    for r in cap['reperes']:
        cx = min(max(r['x'], 18), W - 18); cy = min(max(r['y'], 18), H - 18)
        pastille(d, cx, cy, r['n'])
    # légende
    x0 = W + 28; lw = LARGEUR_LEGENDE - 56
    d.line((W, 0, W, H), fill=(220, 226, 223), width=1)
    d.text((x0, 30), cap['titre'], font=police(30, True), fill=VERT)
    y = 74
    for l in couper(d, cap.get('sousTitre') or '', police(17), lw):
        d.text((x0, y), l, font=police(17), fill=GRIS); y += 24
    y += 10
    d.text((x0, y), 'REPÈRES', font=police(13, True), fill=GRIS); y += 26
    for r in cap['reperes']:
        ft, fx = police(18, True), police(16)
        lignes = couper(d, r['texte'], fx, lw - 70)
        hcarte = 22 + 26 + len(lignes) * 22 + 6
        d.rounded_rectangle((x0, y, x0 + lw, y + hcarte), radius=10, fill=(255, 255, 255), outline=(222, 228, 225))
        d.rectangle((x0, y + 8, x0 + 3, y + hcarte - 8), fill=ACCENT)
        pastille(d, x0 + 32, y + 30, r['n'], 13)
        d.text((x0 + 58, y + 16), r['titre'], font=ft, fill=ENCRE)
        yy = y + 44
        for l in lignes:
            d.text((x0 + 58, yy), l, font=fx, fill=GRIS); yy += 22
        y += hcarte + 10
    if y > H: print('  ! légende trop haute pour', cap['fichier'], y)
    d.text((x0, H - 30), 'Wizard QA · données de démonstration fictives', font=police(13), fill=GRIS)
    toile.save(os.path.join(SORTIE, cap['fichier'] + '.jpg'), quality=88, optimize=True)

def main():
    boites = json.load(open(sys.argv[1], encoding='utf-8'))
    os.makedirs(SORTIE, exist_ok=True)
    sortie = []
    for cle in sorted(boites):
        cap = boites[cle]
        if not os.path.exists(os.path.join(BRUT, cap['fichier'] + '.png')): continue
        annoter(cap)
        sortie.append({'fichier': cap['fichier'] + '.jpg', 'brute': 'supports/captures/' + cap['fichier'] + '.png',
                       'titre': cap['titre'], 'sousTitre': cap.get('sousTitre'), 'page': cap.get('page'),
                       'taille': {'w': 1440, 'h': 900},
                       'reperes': [{k: r[k] for k in ('n', 'x', 'y', 'w', 'h', 'titre', 'texte')} for r in cap['reperes']]})
        print(cap['fichier'], len(cap['reperes']), 'repères')
    json.dump({'note': 'Coordonnées en pixels de la capture brute 1440×900.', 'captures': sortie},
              open(os.path.join(SORTIE, 'reperes.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=2)

if __name__ == '__main__':
    main()

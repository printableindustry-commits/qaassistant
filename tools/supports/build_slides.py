# -*- coding: utf-8 -*-
"""Construit la présentation de synthèse de Wizard QA à partir du gabarit (python-pptx).

    python tools/supports/build_slides.py                      # -> supports/presentations/WizardQA-synthese.pptx
    python tools/supports/build_slides.py --preparer-gabarit <gabarit-source.pptx>
                                                                # -> supports/presentations/gabarit-demo.pptx

Entrées : gabarit supports/presentations/gabarit-demo.pptx (dispositions), captures brutes supports/captures/,
repères docs/captures-annotees/reperes.json, schémas supports/schemas/, pictos tools/supports/slides/pictos/
(pictos.mjs), chiffres du jeu de démo tools/supports/slides/chiffres-demo.json (chiffres.mjs), logo
server/assets/logo-qa.png. Données 100 % fictives ; le modèle Word de l'entreprise n'est jamais utilisé.
"""
import argparse
import datetime
import json
import math
import os
import re
import shutil
import zipfile

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.oxml.ns import qn
from pptx.util import Emu, Pt

RACINE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SUPPORTS = os.path.join(RACINE, 'supports')
PRES = os.path.join(SUPPORTS, 'presentations')
GABARIT = os.path.join(PRES, 'gabarit-demo.pptx')
SORTIE = os.path.join(PRES, 'WizardQA-synthese.pptx')
PICTOS = os.path.join(RACINE, 'tools', 'supports', 'slides', 'pictos')
CHIFFRES = os.path.join(RACINE, 'tools', 'supports', 'slides', 'chiffres-demo.json')
REPERES = os.path.join(RACINE, 'docs', 'captures-annotees', 'reperes.json')
LOGO = os.path.join(RACINE, 'server', 'assets', 'logo-qa.png')

ACCROCHE = 'Du récit au test, du test au livrable.'
DATE = datetime.date.today().strftime('%d/%m/%Y')

# Palette et typographie du gabarit
VERT, VERT_FONCE, ENCRE, TEXTE, GRIS = '00694D', '004D38', '14261F', '4A5D56', '7D8C86'
BORD, FOND, MENTHE, MENTHE_BORD, ROUGE, BLANC = 'CBD5D0', 'F3F5F4', 'E2F3EA', '9FCDB6', 'C62828', 'FFFFFF'
POLICE = 'Segoe UI'
INSECABLE = chr(0xA0)  # espace insécable

# Grille (EMU) relevée sur le gabarit
G = 457200                    # marge gauche
L_UTILE = 11277295            # largeur utile
DROITE = G + L_UTILE
HAUT = 1298448                # haut du contenu
BAS = 6272784                 # bas du contenu
ECART = 182880                # écart entre blocs
DEMI = (L_UTILE - ECART) // 2  # 5547208

# Dispositions : index dans le gabarit, nom, rubrique du pied de page
DISPOSITIONS = {
    1: ('Wizard QA · Couverture', None),
    2: ('Wizard QA · Gabarit', 'Gabarit'),
    3: ('Wizard QA · Contexte', 'Contexte'),
    4: ('Wizard QA · Sommaire', 'Sommaire'),
    5: ('Wizard QA · Le produit', 'Le produit'),
    6: ("Wizard QA · L'application", "L'application"),
    7: ('Wizard QA · Architecture', 'Architecture'),
    8: ('Wizard QA · Architecture · planche', 'Architecture'),
    9: ('Wizard QA · Le parcours · planche', 'Le parcours'),
    10: ('Wizard QA · La suite', 'La suite'),
}


# --------------------------------------------------------------------------- outils de dessin

def rgb(h):
    return RGBColor.from_string(h)


def _nom(forme, nom):
    forme.name = nom
    return forme


def boite(slide, x, y, w, h, fond=None, trait=None, ep=9525, forme='roundRect', adj=4000, tirets=False, nom='Bloc'):
    f = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE if forme == 'roundRect' else
                               MSO_SHAPE.OVAL if forme == 'ellipse' else MSO_SHAPE.RECTANGLE,
                               Emu(x), Emu(y), Emu(w), Emu(h))
    if forme == 'roundRect':
        f.adjustments[0] = adj / 100000
    if fond:
        f.fill.solid()
        f.fill.fore_color.rgb = rgb(fond)
    else:
        f.fill.background()
    if trait:
        f.line.color.rgb = rgb(trait)
        f.line.width = Emu(ep)
        if tirets:
            f.line.dash_style = 4  # tiret
    else:
        f.line.fill.background()
    f.shadow.inherit = False
    f.text_frame.text = ''
    return _nom(f, nom)


def texte(slide, x, y, w, h, paragraphes, nom='Texte', ancre='t', align='l', interligne=None):
    """paragraphes : liste de paragraphes ; chacun = liste de segments (texte, taille, gras, couleur[, lien])."""
    tb = slide.shapes.add_textbox(Emu(x), Emu(y), Emu(w), Emu(h))
    tf = tb.text_frame
    tf.word_wrap = True
    tf.auto_size = None
    for cote in ('margin_left', 'margin_right', 'margin_top', 'margin_bottom'):
        setattr(tf, cote, 0)
    tf.vertical_anchor = {'t': MSO_ANCHOR.TOP, 'm': MSO_ANCHOR.MIDDLE, 'b': MSO_ANCHOR.BOTTOM}[ancre]
    for i, segs in enumerate(paragraphes):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = {'l': PP_ALIGN.LEFT, 'c': PP_ALIGN.CENTER, 'r': PP_ALIGN.RIGHT}[align]
        if interligne:
            p.line_spacing = interligne
        for seg in segs:
            t, taille, gras, couleur = seg[:4]
            r = p.add_run()
            # typographie française : espaces insécables autour des guillemets et avant « : ; ? ! »
            r.text = re.sub(r' ([:;?!' + chr(0xBB) + '])', lambda m: INSECABLE + m.group(1), t.replace(chr(0xAB) + ' ', chr(0xAB) + INSECABLE))
            r.font.name = POLICE
            r.font.size = Pt(taille)
            r.font.bold = bool(gras)
            r.font.color.rgb = rgb(couleur)
            if len(seg) > 4 and seg[4]:
                r.hyperlink.address = seg[4]
    return _nom(tb, nom)


def picto(slide, nom, x, y, taille, variante=''):
    chemin = os.path.join(PICTOS, nom + variante + '.png')
    return _nom(slide.shapes.add_picture(chemin, Emu(x), Emu(y), Emu(taille), Emu(taille)), 'Picto ' + nom)


def titre(slide, t, st):
    texte(slide, G, 329184, L_UTILE, 396240, [[(t, 26, True, VERT)]], nom='Titre')
    texte(slide, G, 771144, L_UTILE, 198120, [[(st, 13, False, TEXTE)]], nom='Sous-titre')


# Tailles des cartes à liseré : picto, intitulé, texte
CARTES = {'L': (236220, 15.5, 14), 'M': (205740, 13.5, 12), 'S': (182880, 12, 10.5)}


def carte(slide, x, y, w, h, icone, intitule, corps, taille='M', gris=False):
    p, t_int, t_txt = CARTES[taille]
    boite(slide, x, y, w, h, fond=FOND if gris else BLANC, trait=BORD, nom='Bloc ' + intitule)
    if not gris:
        boite(slide, x + 20117, y + 91440, 45720, h - 182880, fond=VERT, adj=50000, nom='Liseré')
    px, py = x + 173736, y + 146304
    picto(slide, icone, px, py, p, '-gris' if gris else '')
    texte(slide, px + p + 73152, py, w - 347472 - p - 73152, p,
          [[(intitule, t_int, True, TEXTE if gris else ENCRE)]], nom='Intitulé ' + intitule, ancre='m')
    paras = corps if isinstance(corps, list) else [corps]
    texte(slide, px, py + p + 54864, w - 347472, h - (py - y) - p - 54864 - 91440,
          [[(c, t_txt, False, TEXTE)] for c in paras], nom='Texte ' + intitule)


def pastille(slide, cx, cy, n, d=237744):
    f = boite(slide, cx - d // 2, cy - d // 2, d, d, fond=ROUGE, trait=BLANC, ep=15875, forme='ellipse',
              nom='Pastille %d' % n)
    tf = f.text_frame
    for cote in ('margin_left', 'margin_right', 'margin_top', 'margin_bottom'):
        setattr(tf, cote, 0)
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    r = p.add_run()
    r.text = str(n)
    r.font.name, r.font.size, r.font.bold = POLICE, Pt(9.36 if d >= 237744 else 8.64), True
    r.font.color.rgb = rgb(BLANC)
    return f


def notes(slide, t):
    slide.notes_slide.notes_text_frame.text = t


def pied(slide, numero, devant=False):
    """Numéro de slide (repris de la disposition) ; devant=True recopie aussi le pied de page au premier plan
    (planches : l'image pleine page cache sinon celui de la disposition)."""
    import copy
    arbre = slide.shapes._spTree
    for sh in slide.slide_layout.shapes:
        num = sh.is_placeholder and sh.placeholder_format.type is not None and 'SLIDE_NUMBER' in str(sh.placeholder_format.type)
        if num or (devant and sh.has_text_frame and not sh.is_placeholder):
            el = copy.deepcopy(sh._element)
            if num:
                for t in el.iter(qn('a:t')):
                    t.text = str(numero)
            arbre.append(el)


def lien_gifs(slide, gifs):
    """Lien discret vers le(s) GIF, à droite du pied de page."""
    segs = [('▶ GIF  ', 8.5, False, GRIS)]
    for i, g in enumerate(gifs):
        if i:
            segs.append(('  ·  ', 8.5, False, GRIS))
        segs.append((g, 8.5, False, VERT, '../gifs/' + g))
    texte(slide, 6400800, 6492240, 4480560, 219456, [segs], nom='Lien GIF', ancre='m', align='r')


# --------------------------------------------------------------------------- captures et repères

def charger_reperes():
    with open(REPERES, encoding='utf-8') as f:
        d = json.load(f)
    return {c['fichier'].split('.')[0]: c for c in d['captures']}


A_CHEVAL = {('01-pilotage', 6)}  # (capture, repère) : pastille posée à cheval sur le bord haut de la capture


def capture(slide, cle, x, y, w, numeros=None, exclus=()):
    """Pose la capture brute 1440×900 et ses encadrés + pastilles numérotées. Renvoie [(n, repère)]."""
    c = REP[cle]
    h = round(w * 900 / 1440)
    slide.shapes.add_picture(os.path.join(RACINE, c['brute']), Emu(x), Emu(y), Emu(w), Emu(h)).name = 'Capture ' + cle
    boite(slide, x, y, w, h, trait=BORD, forme='rect', nom='Bord de capture')
    s = w / 1440
    d = 237744 if w > 6000000 else 219456
    gardes = []
    poses = []
    for r in c['reperes']:
        if r['n'] in exclus:
            continue
        n = (numeros or {}).get(r['n'], r['n'])
        bx, by, bw, bh = x + r['x'] * s, y + r['y'] * s, r['w'] * s, r['h'] * s
        # encadré tenu dans la capture
        bx, by = max(bx, x + 12700), max(by, y + 12700)
        bw, bh = min(bw, x + w - 12700 - bx), min(bh, y + h - 12700 - by)
        boite(slide, int(bx), int(by), int(bw), int(bh), trait=ROUGE, ep=25400 if d > 230000 else 19050,
              adj=min(23148, int(100000 * 60000 / max(1, min(bw, bh)))), nom='Encadré %d' % n)
        cx = min(max(bx, x + d // 2 + 9144), x + w - d // 2 - 9144)
        cy = min(max(by, y + d // 2 + 9144), y + h - d // 2 - 9144)
        if (cle, r['n']) in A_CHEVAL:
            # petit bouton collé au haut de la capture : pastille à cheval sur le bord, pour ne masquer ni son
            # icône ni le libellé voisin
            cy = y
        # deux pastilles ne se chevauchent pas : on glisse la nouvelle le long du bord haut de son encadré
        vertical = bh > 2.5 * d  # encadré haut : on descend le long du bord gauche, sinon on glisse à droite
        while any(abs(cx - px) < d * 1.15 and abs(cy - py) < d * 1.15 for px, py in poses):
            if vertical and cy + d * 1.2 < by + bh:
                cy += d * 1.2
            elif not vertical and cx + d * 1.2 < bx + bw:
                cx += d * 1.2
            else:
                break
        poses.append((cx, cy))
        gardes.append((n, r, int(cx), int(cy), d))
    for n, r, cx, cy, d in gardes:
        pastille(slide, cx, cy, n, d)
    return [(n, r) for n, r, *_ in gardes], h


def lignes(t, cpl):
    return max(1, math.ceil(len(t) / cpl))


def zone_reperes(slide, x, y, w, items, cpl_titre, cpl_txt, taille=10, h=None):
    """Encadré « Repères » : pastille + titre gras + phrase. Renvoie la hauteur utilisée."""
    pas_ligne = int(taille * 1.2 * 12700)
    hauteurs = [(lignes(r['titre'], cpl_titre) + lignes(r['texte'], cpl_txt)) * pas_ligne + 64008 for _, r in items]
    tete = 146304 + 182880 + 128016
    hz = h or (tete + sum(hauteurs) + 64008)
    boite(slide, x, y, w, hz, fond=FOND, trait=BORD, ep=11430, adj=4321, nom='Zone Repères')
    picto(slide, 'search', x + 164592, y + 150114, 175260)
    texte(slide, x + 413004, y + 146304, w - 577596, 182880, [[('Repères', 12, True, VERT_FONCE)]],
          nom='Titre Repères', ancre='m')
    cy = y + tete
    for (n, r), hh in zip(items, hauteurs):
        pastille(slide, x + 164592 + 109728, cy + 109728, n, 219456)
        texte(slide, x + 493776, cy + 18288, w - 493776 - 164592, hh,
              [[(r['titre'], taille, True, ENCRE)], [(r['texte'], taille, False, TEXTE)]], nom='Repère %d' % n)
        cy += hh
    return hz


def zone_reperes_ligne(slide, x, y, w, h, items, taille=9.5):
    """Encadré « Repères » compact (deux captures) : une ligne par repère, « titre — phrase courte »."""
    boite(slide, x, y, w, h, fond=FOND, trait=BORD, ep=11430, adj=6000, nom='Zone Repères')
    picto(slide, 'search', x + 146304, y + 109728, 164592)
    texte(slide, x + 374904, y + 100584, w - 521208, 182880, [[('Repères', 11, True, VERT_FONCE)]],
          nom='Titre Repères', ancre='m')
    pas = (h - 365760 - 73152) // max(4, len(items))
    cy = y + 365760
    for n, t, court in items:
        pastille(slide, x + 146304 + 100584, cy + pas // 2, n, 201168)
        texte(slide, x + 420624, cy, w - 420624 - 128016, pas,
              [[(t, taille, True, ENCRE), ('  ' + court, taille, False, TEXTE)]], nom='Repère %d' % n, ancre='m')
        cy += pas


# --------------------------------------------------------------------------- dispositions de slides

def slide_application(prs, titre_, sous_titre, cle, a_retenir, en_demo, gifs, note, exclus=()):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    titre(s, titre_, sous_titre)
    cw = 6858000
    items, ch = capture(s, cle, G, HAUT, cw, exclus=exclus)
    texte(s, G, HAUT + ch + 91440, cw, 182880,
          [[('Capture sur les données de démonstration ◇ · page %s' % (REP[cle]['page'].replace('/', '/ (accueil)') if REP[cle]['page'] == '/' else REP[cle]['page']), 9, False, GRIS)]],
          nom='Légende de capture')
    zx = G + cw + ECART
    zw = DROITE - zx
    hz = zone_reperes(s, zx, HAUT, zw, items, 50, 62)
    cy = HAUT + hz + ECART
    if BAS - cy > 900000:
        carte(s, zx, cy, zw, BAS - cy, 'target', 'À retenir', [a_retenir, '', 'En démo ◇ : ' + en_demo], 'M')
    lien_gifs(s, gifs)
    notes(s, note)
    return s


def slide_double(prs, titre_, sous_titre, gauche, droite, gifs, note):
    """Deux captures côte à côte ; gauche/droite = (clé, [(n_source, titre, phrase courte)])."""
    s = prs.slides.add_slide(prs.slide_layouts[6])
    titre(s, titre_, sous_titre)
    n = 1
    for i, (cle, reps) in enumerate((gauche, droite)):
        x = G + i * (DEMI + ECART)
        numeros, items = {}, []
        for src, t, court in reps:
            numeros[src] = n
            items.append((n, t, court))
            n += 1
        exclus = [r['n'] for r in REP[cle]['reperes'] if r['n'] not in numeros]
        _, ch = capture(s, cle, x, HAUT, DEMI, numeros=numeros, exclus=exclus)
        texte(s, x, HAUT + ch + 54864, DEMI, 164592,
              [[(REP[cle]['titre'] + ' · page ' + REP[cle]['page'] + ' · données de démonstration ◇', 8.5, False, GRIS)]],
              nom='Légende de capture')
        zy = HAUT + ch + 283464
        zone_reperes_ligne(s, x, zy, DEMI, BAS - zy, items)
    lien_gifs(s, gifs)
    notes(s, note)
    return s


def slide_planche(prs, image, nom, note, disposition=8):
    s = prs.slides.add_slide(prs.slide_layouts[disposition])
    s.shapes.add_picture(os.path.join(SUPPORTS, 'schemas', image), 0, 0, prs.slide_width, prs.slide_height).name = nom
    # le pied de page et le numéro de la disposition passent au premier plan
    notes(s, note)
    return s


def tableau(slide, x, y, w, lignes_, largeurs, hauteur_ligne=420000):
    nl, nc = len(lignes_), len(lignes_[0])
    gf = slide.shapes.add_table(nl, nc, Emu(x), Emu(y), Emu(w), Emu(400000 * nl))
    gf.name = 'Tableau'
    tbl = gf.table
    tbl.first_row = False
    tbl.horz_banding = False
    tblPr = tbl._tbl.tblPr
    for enfant in list(tblPr):
        tblPr.remove(enfant)
    for j, lw in enumerate(largeurs):
        tbl.columns[j].width = Emu(lw)
    for i, ligne in enumerate(lignes_):
        tbl.rows[i].height = Emu(336042 if i == 0 else hauteur_ligne)
        for j, val in enumerate(ligne):
            cel = tbl.cell(i, j)
            cel.margin_left = cel.margin_right = Emu(73152)
            cel.margin_top = cel.margin_bottom = Emu(54864)
            cel.vertical_anchor = MSO_ANCHOR.MIDDLE if i == 0 else MSO_ANCHOR.TOP
            tf = cel.text_frame
            tf.word_wrap = True
            p = tf.paragraphs[0]
            r = p.add_run()
            r.text = val
            r.font.name = POLICE
            r.font.size = Pt(12.5 if i == 0 else 12)
            r.font.bold = i == 0 or j == 0
            r.font.color.rgb = rgb(VERT_FONCE if i == 0 else ENCRE if j == 0 else TEXTE)
            cel.fill.solid()
            cel.fill.fore_color.rgb = rgb(MENTHE if i == 0 else BLANC)
            tcPr = cel._tc.get_or_add_tcPr()
            for cote in ('a:lnL', 'a:lnR', 'a:lnT', 'a:lnB'):
                ln = tcPr.find(qn(cote))
                if ln is not None:
                    tcPr.remove(ln)
            for cote in ('lnL', 'lnR', 'lnT', 'lnB'):
                ln = tcPr.makeelement(qn('a:' + cote), {'w': '12700' if cote == 'lnB' and i < nl - 1 else '0'})
                if cote == 'lnB' and i < nl - 1:
                    sf = ln.makeelement(qn('a:solidFill'), {})
                    sf.append(sf.makeelement(qn('a:srgbClr'), {'val': MENTHE_BORD if i == 0 else 'E3E9E6'}))
                    ln.append(sf)
                else:
                    ln.append(ln.makeelement(qn('a:noFill'), {}))
                tcPr.insert(['lnL', 'lnR', 'lnT', 'lnB'].index(cote), ln)
    return gf


def tuile(slide, x, y, w, h, valeur, libelle):
    boite(slide, x, y, w, h, fond=BLANC, trait=BORD, nom='Tuile ' + valeur)
    boite(slide, x + 20117, y + 91440, 45720, h - 182880, fond=VERT, adj=50000, nom='Liseré')
    texte(slide, x + 155448, y + 109728, w - 283464, 350520, [[(valeur, 23, True, VERT)]], nom='Valeur ' + valeur)
    texte(slide, x + 155448, y + 496824, w - 283464, h - 588264, [[(libelle, 10.5, False, TEXTE)]],
          nom='Libellé ' + valeur)


# --------------------------------------------------------------------------- gabarit

def regler_dispositions(prs):
    """Renomme les dispositions et réécrit leur pied de page « Wizard QA · rubrique · date »."""
    for i, (nom, rubrique) in DISPOSITIONS.items():
        lay = prs.slide_layouts[i]
        lay._element.cSld.set('name', nom)
        for sh in lay.shapes:
            if sh.has_text_frame and not sh.is_placeholder and rubrique:
                runs = [r for p in sh.text_frame.paragraphs for r in p.runs]
                if runs:
                    runs[0].text = 'Wizard QA · %s · %s' % (rubrique, DATE)
                    for r in runs[1:]:
                        r.text = ''


def proprietes(prs, titre_):
    cp = prs.core_properties
    cp.title = titre_
    cp.subject = 'Wizard QA · ' + ACCROCHE
    cp.author = 'Wizard QA'
    cp.last_modified_by = 'Wizard QA'
    cp.keywords = 'Wizard QA; démonstration; données fictives'
    cp.created = cp.modified = datetime.datetime.now()


def nettoyer_paquet(chemin, nb_slides):
    """Retire les traces de l'ancien gabarit dans docProps/app.xml et le thème."""
    tmp = chemin + '.tmp'
    with zipfile.ZipFile(chemin) as zin, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == 'docProps/app.xml':
                data = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
                        '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" '
                        'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">'
                        '<Application>Microsoft Office PowerPoint</Application>'
                        '<PresentationFormat>On-screen Show (16:9)</PresentationFormat>'
                        '<Slides>%d</Slides><Notes>%d</Notes><Company>Wizard QA</Company>'
                        '<AppVersion>16.0000</AppVersion></Properties>' % (nb_slides, nb_slides)).encode('utf-8')
            elif item.filename.startswith('ppt/theme/'):
                data = data.replace('PRISME v2'.encode(), 'Wizard QA'.encode())
            zout.writestr(item, data)
    os.replace(tmp, chemin)
    with zipfile.ZipFile(chemin) as z:
        restes = [n for n in z.namelist() if re.search(rb'PRISME|ARGOS', z.read(n))]
    if restes:
        raise SystemExit('Contenu PRISME résiduel : ' + ', '.join(restes))


def preparer_gabarit(source):
    """Gabarit PRISME -> gabarit Wizard QA : dispositions renommées, pieds de page, aucune slide d'exemple."""
    prs = Presentation(source)
    regler_dispositions(prs)
    sld_ids = prs.slides._sldIdLst
    for sid in list(sld_ids):
        prs.part.drop_rel(sid.rId)
        sld_ids.remove(sid)
    # sections de l'ancien plan (extension p14:sectionLst)
    for ext in prs.part._element.findall('.//' + qn('p:ext')):
        if ext.find('{http://schemas.microsoft.com/office/powerpoint/2010/main}sectionLst') is not None:
            ext.getparent().remove(ext)
    proprietes(prs, 'Wizard QA · gabarit de présentation')
    os.makedirs(PRES, exist_ok=True)
    prs.save(GABARIT)
    nettoyer_paquet(GABARIT, 0)
    print('Gabarit :', GABARIT)


# --------------------------------------------------------------------------- contenu

def construire():
    global REP
    REP = charger_reperes()
    with open(CHIFFRES, encoding='utf-8') as f:
        C = json.load(f)
    prs = Presentation(GABARIT)
    regler_dispositions(prs)

    # 1 · Couverture -------------------------------------------------------------------------
    s = prs.slides.add_slide(prs.slide_layouts[1])
    s.shapes.add_picture(LOGO, Emu(G), Emu(320040), height=Emu(420624)).name = 'Logo Wizard QA'
    texte(s, G, 777240, 4480560, 822960, [[('Wizard QA', 54, True, VERT)]], nom='Titre')
    texte(s, G, 1645920, 4480560, 487680,
          [[(ACCROCHE + ' Synthèse de l’application, état au ' + DATE, 16, False, TEXTE)]],
          nom='Sous-titre')
    carte(s, G, 2453640, 4480560, 1836420, 'fileText', 'Ce document',
          'Wizard QA accompagne une équipe QA du récit JIRA au livrable ISTQB : prise de connaissance, tri, '
          'Gherkin, automatisation Playwright, Xray, campagnes, performance k6 et documents. Ce support présente '
          'le problème, la démarche, un écran par fonctionnalité, l’architecture et la suite.', 'M')
    carte(s, G, 4472940, 4480560, 1836420, 'listChecks', 'Conventions',
          '◇ marque une donnée ou une action simulée, ou une donnée fictive : tout vient du jeu de démonstration '
          'IRMA (Banque Horizon, personnes fictives). Pastilles rouges = renvois aux Repères. ▶ GIF en pied de page '
          '= animation de la fonctionnalité. Utilisateur affiché : Rémy VERGER.', 'M')
    cap = s.shapes.add_picture(os.path.join(SUPPORTS, 'captures', '01-pilotage.png'),
                               Emu(5349240), Emu(1433608), Emu(6385255), Emu(3990785))
    cap.name = 'Capture Pilotage'
    boite(s, 5349240, 1433608, 6385255, 3990785, trait=BORD, forme='rect', nom='Bord de capture')
    texte(s, 5349240, 5516880, 6385255, 182880,
          [[('Pilotage de Wizard QA sur le projet de démonstration IRMA ◇', 9, False, GRIS)]], nom='Légende', align='c')
    notes(s, 'Wizard QA est une application web qui accompagne une équipe QA de bout en bout : du récit JIRA au test '
             'automatisé, puis du test au livrable ISTQB. On l’ouvre sur le Pilotage, l’écran d’accueil, avec le jeu de '
             'démonstration IRMA de la Banque Horizon, entièrement fictif. Préciser la convention : ◇ signale ce qui est '
             'simulé ou fictif. Les liens ▶ GIF en bas des slides lancent l’animation de chaque fonctionnalité si l’on '
             'ne fait pas la démo en direct.')

    # 2 · Sommaire ---------------------------------------------------------------------------
    s = prs.slides.add_slide(prs.slide_layouts[4])
    titre(s, 'Sommaire', 'Sept parties, du problème aux branchements réels')
    boite(s, G, HAUT, 7086600, BAS - HAUT, fond=BLANC, trait=BORD, ep=11430, adj=3000, nom='Cadre du tableau')
    tableau(s, 566928, 1408176, 6867144, [
        ['Partie', 'Contenu', 'Slides'],
        ['1 · Contexte', 'Tests manuels, traçabilité perdue, documents réglementaires obsolètes', '3'],
        ['2 · Démarche', 'Promesse, parcours de bout en bout, la démo en chiffres', '4 à 6'],
        ['3 · L’application', 'Un écran par fonctionnalité, du Pilotage au mode démo guidé', '7 à 17'],
        ['4 · Architecture', 'Serveur Node, modules, moteur Playwright, fournisseurs IA', '18'],
        ['5 · Livrables', 'Des faits collectés au document Word', '19'],
        ['6 · Sécurité', 'Garde unique, secrets, rôles', '20'],
        ['7 · La suite', 'Branchements réels prévus, puis la démonstration', '21 et 22'],
    ], [1710724, 4075995, 1080425], hauteur_ligne=(BAS - HAUT - 2 * 109728 - 336042) // 7)
    carte(s, 7726680, HAUT, DROITE - 7726680, BAS - HAUT, 'book', 'Comment lire la suite',
          ['Les parties suivent l’ordre d’une présentation : pourquoi l’outil existe, ce qu’il promet, ce qu’on voit '
           'à l’écran, comment il est construit, puis ce qu’il reste à brancher.',
           '',
           'Chaque slide d’écran montre une capture réelle avec des pastilles numérotées, expliquées dans l’encadré '
           '« Repères ». Les chiffres viennent du jeu de démonstration, relevés par l’API.'], 'M')
    notes(s, 'Présenter le plan en une minute. Le contexte et la démarche expliquent pourquoi l’outil existe. La partie '
             'application est le cœur : un écran par fonctionnalité, dans l’ordre du parcours QA. On finit par '
             'l’architecture, les livrables, la sécurité et ce qu’il faut brancher pour un vrai projet. Si le temps '
             'manque, lancer plutôt la visite guidée (slide 17) qui enchaîne tout en 7 minutes.')

    # 3 · Contexte ---------------------------------------------------------------------------
    s = prs.slides.add_slide(prs.slide_layouts[3])
    titre(s, 'Contexte : des tests qui coûtent plus qu’ils ne rapportent', 'Ce que vit une équipe QA sur un projet agile')
    h1, h2 = 2286000, BAS - HAUT - 2286000 - ECART
    carte(s, G, HAUT, DEMI, h1, 'edit', 'Des tests encore manuels',
          'Les récits JIRA sont relus un par un, les cas de test écrits dans des tableurs et les scripts '
          'Playwright repartent de zéro. Le testeur recopie plus qu’il ne teste, et l’automatisation prend '
          'toujours un sprint de retard.', 'L')
    carte(s, G + DEMI + ECART, HAUT, DEMI, h1, 'link', 'Une traçabilité qui se perd',
          'Récit, scénario, test automatisé, ticket Xray, résultat de campagne : chaque lien se fait à la main '
          'et se rompt au premier changement. Impossible de dire vite quel récit est couvert et par quoi.', 'L')
    carte(s, G, HAUT + h1 + ECART, DEMI, h2, 'fileText', 'Des documents réglementaires obsolètes',
          'Politique, stratégie, plan, rapports : écrits une fois pour l’audit, jamais remis à jour. Les '
          'chiffres qu’ils citent ne correspondent plus à ce qui a vraiment été testé.', 'L')
    carte(s, G + DEMI + ECART, HAUT + h1 + ECART, DEMI, h2, 'layers', 'Données',
          'Les exemples de ce support viennent du jeu de démonstration livré avec l’application : projet IRMA '
          'de la Banque Horizon, récits et personnes fictifs ◇. Rien ne vient d’un projet réel.', 'L', gris=True)
    notes(s, 'Poser le problème sans jargon. Aujourd’hui le testeur passe son temps à recopier : du récit vers le cas '
             'de test, du cas de test vers le script, du résultat vers le rapport. La traçabilité entre récit, test, '
             'ticket Xray et campagne se fait à la main et se perd. Les documents ISTQB exigés par l’audit sont écrits '
             'une fois et vieillissent aussitôt. Préciser que tous les exemples qui suivent sont fictifs.')

    # 4 · Promesse et démarche ---------------------------------------------------------------
    s = prs.slides.add_slide(prs.slide_layouts[5])
    titre(s, 'La promesse : ' + ACCROCHE[0].lower() + ACCROCHE[1:-1], 'Une seule application, l’IA propose, le testeur décide')
    tiers = (L_UTILE - 2 * ECART) // 3
    h1, h2 = 2011680, 1554480
    for i, (ic, t, c) in enumerate([
        ('search', 'Comprendre', 'Une URL JIRA suffit : récits scannés, critères d’acceptation extraits, points à '
                                 'clarifier avec le PO, puis un tri motivé de chaque récit.'),
        ('flask', 'Tester', 'Scénarios Gherkin générés puis relus ; l’agent explore l’application et écrit le test '
                            'Playwright ; ticket Test relié dans Xray ; campagnes et performance k6.'),
        ('fileText', 'Livrer', 'Onze documents ISO/IEC/IEEE 29119-3 tirés des faits collectés, relus par l’agent, '
                               'approuvés par un humain, exportés en Word, HTML ou Markdown.')]):
        carte(s, G + i * (tiers + ECART), HAUT, tiers, h1, ic, t, c, 'L')
    y2 = HAUT + h1 + ECART
    y3 = y2 + h2 + ECART
    carte(s, G, y3, L_UTILE, BAS - y3, 'monitor', 'Pour qui, sur quel poste',
          'Testeurs et responsables QA d’une équipe agile. Un poste avec Node 22 et Edge ou Chrome suffit ; JIRA, '
          'Xray, k6 et l’IA se branchent quand ils sont disponibles.', 'M', gris=True)
    carte(s, G, y2, DEMI, h2, 'users', 'L’humain décide',
          'L’IA propose un tri, un scénario, un test, une relecture ; le testeur valide, corrige ou montre le geste '
          '(« Prenez la main »). Rien n’est envoyé ni approuvé sans lui.', 'L')
    carte(s, G + DEMI + ECART, y2, DEMI, h2, 'zap', 'Sans IA, tout reste utilisable',
          'Tri par règles, Gherkin par le modèle intégré, mode copier-coller, relecture par règles. Node 22 suffit : '
          'aucune dépendance npm côté serveur.', 'L')
    notes(s, 'La promesse tient en une phrase : du récit au test, du test au livrable. Trois temps : comprendre ce '
             'qu’il faut tester, tester, puis livrer les documents. Insister sur le principe : l’IA propose, le '
             'testeur décide, et chaque étape reste utilisable sans IA. C’est ce qui permet de démarrer sur un poste '
             'sans aucun fournisseur branché.')

    # 5 · Parcours (planche) -----------------------------------------------------------------
    slide_planche(prs, 'schema-parcours.png', 'Schéma parcours QA',
                  'Suivre le schéma dans le sens des flèches : URL JIRA, scan, tri, Gherkin, exploration IA, spec '
                  'Playwright, validation, ticket Xray, campagne, livrables, export Word. Montrer la boucle « Prenez la '
                  'main » quand l’IA bloque, et la performance k6 menée en parallèle. Les pastilles IA et HUMAIN disent '
                  'qui propose et qui décide. Chaque étape écrit un résultat réutilisable dans le projet de test : '
                  'c’est ce que les livrables lisent ensuite. GIF à lancer pour un aperçu : 13-visite-guidee.gif.',
                  disposition=9)

    # 6 · La démo en chiffres ----------------------------------------------------------------
    s = prs.slides.add_slide(prs.slide_layouts[5])
    titre(s, 'La démo en chiffres', 'Projet fictif IRMA de la Banque Horizon ◇, relevé par l’API le ' + DATE)
    r_, t_, g_, a_ = C['recits'], C['tri'], C['gherkin'], C['automatisation']
    ca, lv, pf = C['campagnes'], C['livrables'], C['perf']
    tuiles = [
        ('%d · %d' % (r_['total'], r_['epopees']), 'récits JIRA scannés · épopées, %d avec critères d’acceptation' % r_['avecCriteres']),
        (str(r_['aClarifier']), 'récits à clarifier avec le PO, dont %d sans critère ; %d questions prêtes' % (r_['sansCriteres'], r_['questions'])),
        ('%d · %d · %d' % (t_['todo'], t_['later'], t_['skip']), 'récits triés : à automatiser · plus tard · ignorés'),
        (str(g_['scenarios']), 'scénarios Gherkin : %d récits validés et exportés, %d brouillons' % (g_['validated'], g_['draft'])),
        (str(a_['sessions']), 'sessions d’automatisation : %d validée (%s étapes), %d en « Prenez la main » à relire' % (a_['validees'], a_['etapes'], a_['sessions'] - a_['validees'])),
        ('%d ◇' % C['xray']['simules'], 'envois vers Xray simulés, dont un ajouté au plan de test'),
        (' → '.join(map(str, ca['reussis'])), 'tests réussis sur %d, au fil de %d campagnes simulées ◇' % (ca['total'], ca['nombre'])),
        (str(C['anomalies']['total']), 'anomalies tirées des échecs de campagne, dont %d corrigée' % C['anomalies']['corrigees']),
        ('%d · %d · %d' % (lv['total'], lv['relus'], lv['approuves']), 'livrables ISTQB générés · relus par l’agent · approuvés'),
        ('%d ◇' % pf['runs'], 'runs k6 simulés ; dernier p95 %d ms, %d seuil franchi' % (pf['dernierP95'], pf['seuilsFranchis'])),
        ('25 · 7 min', 'étapes de la visite guidée · durée à vitesse ×1'),
    ]
    tw, th = 2709596, 1179576
    for i, (v, l) in enumerate(tuiles):
        x = G + (i % 4) * (tw + 146304)
        y = HAUT + (i // 4) * (th + 146304)
        tuile(s, x, y, tw, th, v, l)
    boite(s, G, 5312664, L_UTILE, 960120, fond=FOND, trait=BORD, nom='Bloc Données')
    picto(s, 'layers', 630936, 5458968, 175260, '-gris')
    texte(s, 879348, 5458968, 10708843, 175260, [[('Données', 11.5, True, TEXTE)]], nom='Intitulé Données', ancre='m')
    texte(s, 630936, 5689092, 10957255, 455676,
          [[('Chiffres relevés sur le jeu de démonstration chargé (Réglages › Démonstration) par les routes '
             '/api/demo/status, /api/jira/overview, /api/livrables/facts et /api/perf/runs. Les dates sont recalculées '
             'à chaque chargement. Campagnes, envois Xray et runs k6 sont simulés ◇ : rien n’est envoyé vers JIRA, '
             'Xray ou k6.', 10, False, TEXTE)]], nom='Texte Données')
    notes(s, 'Quelques chiffres pour donner la taille du jeu de démonstration, tous lus par l’API sur la démo chargée. '
             '%d récits sur %d épopées, dont %d à clarifier avec le PO. Le tri donne %d récits à automatiser ; %d '
             'scénarios Gherkin existent déjà. Les campagnes montrent une progression %s sur %d tests, et les %d '
             'livrables sont générés, dont %d approuvés. Rappeler que campagnes, Xray et k6 sont simulés en démo.'
             % (r_['total'], r_['epopees'], r_['aClarifier'], t_['todo'], g_['scenarios'],
                ' → '.join(map(str, ca['reussis'])), ca['total'], lv['total'], lv['approuves']))

    # 7 à 17 · L'application -----------------------------------------------------------------
    slide_application(prs, 'Piloter · Pilotage', 'Où en est la campagne de test, en un coup d’œil', '01-pilotage',
                      'Chaque indicateur, chaque action mène à l’écran où agir ; le Parcours QA donne la prochaine étape.',
                      'projet IRMA, %d récits scannés, couverture Gherkin et dernier run k6 affichés.' % r_['total'],
                      ['01-connexion-pilotage.gif'],
                      'On se connecte avec demo / demo et on arrive sur le Pilotage. Montrer le bandeau d’état (1) puis '
                      'les indicateurs clés (2) : poste de test, récits scannés, points à clarifier, couverture Gherkin. '
                      'Le Parcours QA (3) suit les étapes du poste installé aux tests reliés à Xray. « À traiter » (4) '
                      'liste les actions prioritaires, chacune avec son bouton. GIF : 01-connexion-pilotage.gif.')
    slide_application(prs, 'Comprendre · Prise de connaissance', 'Comprendre ce qu’il faut tester avant d’écrire le moindre test',
                      '02-prise-de-connaissance',
                      'Une URL JIRA suffit. Le scan extrait les critères d’acceptation et prépare les questions pour '
                      'le PO avant d’écrire un test.',
                      '%d récits, %d avec critères, %d à clarifier, %d questions prêtes pour le PO.' % (r_['total'], r_['avecCriteres'], r_['aClarifier'], r_['questions']),
                      ['02-scan-jira-par-url.gif'],
                      'Coller l’adresse d’un tableau ou d’un ticket JIRA : l’instance et le projet sont déduits (1). La '
                      'synthèse du scan (2) compte les récits, les critères d’acceptation extraits et les points à '
                      'clarifier. Montrer d’où viennent les critères (3) et la vue par épopée (5). Les questions « À '
                      'clarifier avec le PO » sont prêtes à envoyer. GIF : 02-scan-jira-par-url.gif.')
    slide_application(prs, 'Comprendre · Récits et tri', 'Chaque récit reçoit une décision de test', '03-recits-tri',
                      'Le tri dit quoi automatiser maintenant, plus tard ou jamais, avec une raison. Seuls les récits '
                      '« À automatiser » vont plus loin.',
                      '%d à automatiser, %d plus tard, %d ignorés, chacun avec sa raison.' % (t_['todo'], t_['later'], t_['skip']),
                      ['03-tri-des-recits.gif'],
                      'Chaque récit reçoit une décision : à automatiser, plus tard ou ignoré (2). L’assistant propose un '
                      'tri et explique pourquoi (5) ; le testeur garde la décision. Les actions par lot (3) trient '
                      'plusieurs récits d’un coup. Montrer un changement de décision et sa raison. '
                      'GIF : 03-tri-des-recits.gif.')
    slide_application(prs, 'Tester · Scénarios Gherkin', 'Générés depuis les critères d’acceptation, relus puis validés par le testeur',
                      '04-gherkin',
                      'Le Gherkin est généré depuis les critères d’acceptation, par l’IA ou sans IA, et ne compte '
                      'qu’une fois validé par le testeur.',
                      '%d récits validés et exportés en .feature, %d brouillons, %d scénarios.' % (g_['validated'], g_['draft'], g_['scenarios']),
                      ['04-gherkin.gif'],
                      'Ouvrir un récit : les scénarios sont générés depuis ses critères d’acceptation (2), par l’assistant '
                      'IA ou par le modèle intégré sans IA. L’éditeur (4) reste modifiable, l’aperçu (5) contrôle la '
                      'syntaxe en direct, en français ou en anglais. Une fois validés, les scénarios sont exportés en '
                      'fichiers .feature. GIF : 04-gherkin.gif.')
    slide_double(prs, 'Tester · Automatisation et Prenez la main',
                 'L’agent explore l’application et écrit le test Playwright ; s’il bloque, le testeur montre le geste',
                 ('05-automatisation', [(1, 'Récit à automatiser', 'décision de tri et Gherkin validé'),
                                        (2, 'Étapes de la session', 'plan IA, exploration, test, envoi'),
                                        (3, 'Plan exploré', 'chaque étape trouvée, passée ou confiée'),
                                        (4, 'Navigateur en direct', 'sélecteurs trouvés, écran capturé')]),
                 ('06-prenez-la-main', [(1, 'Où l’IA bloque', 'l’étape cherchée, après ses tentatives'),
                                        (2, 'Fenêtre du navigateur', 'le testeur agit dans Edge ou Chrome'),
                                        (3, 'Agir sur la capture', 'ou clique sur la capture, sans sortir'),
                                        (4, 'Journal', 'les gestes deviennent des étapes du test')]),
                 ['05-automatisation-exploration.gif'],
                 'À gauche, la session d’automatisation : l’IA déduit le plan de test du Gherkin (3), puis l’agent ouvre '
                 'l’application de démo, trouve les sélecteurs et capture chaque écran (4). À droite, « Prenez la main » : '
                 'quand l’IA bloque sur une étape (5), le testeur montre le geste dans le navigateur ou sur la capture '
                 '(6, 7) et il est enregistré dans le test (8). Le test généré est rejoué avant validation : pas de test '
                 'fragile en base. GIF : 05-automatisation-exploration.gif.')
    slide_double(prs, 'Tester · Envoi Xray et campagne d’exécution',
                 'Un ticket Test relié au récit, aperçu avant envoi ; les résultats nourrissent les livrables',
                 ('07-envoi-xray', [(1, 'Récit', 'le récit couvert et la source du test'),
                                    (2, 'Simulé en démo ◇', 'rien n’est créé dans JIRA'),
                                    (3, 'Ticket Test et plan', 'résumé, type Xray, plan facultatif'),
                                    (4, 'Aperçu', 'ce qui sera créé ou mis à jour')]),
                 ('11-campagne', [(1, 'Campagne', 'exécution réelle, ou simulée en démo ◇'),
                                  (2, 'Résultats par test', 'récit JIRA, fichier, durée'),
                                  (3, 'Instable', 'réussi au nouvel essai : signalé, pas masqué'),
                                  (4, 'Échec', 'message gardé pour le rapport d’anomalies')]),
                 ['06-envoi-xray.gif', '07-campagne-execution.gif'],
                 'À gauche, l’envoi dans JIRA / Xray : un ticket Test relié au récit et, en option, au plan de test, '
                 'avec un aperçu (4) avant tout envoi. En démo, l’envoi est simulé (2) : rien n’est créé dans JIRA, et un '
                 'renvoi met à jour sans doublon. À droite, une campagne d’exécution : chaque test avec son récit, les '
                 'instables signalés (7) et les échecs (8) qui deviennent des anomalies. '
                 'GIF : 06-envoi-xray.gif puis 07-campagne-execution.gif.')
    slide_application(prs, 'Livrer · Livrables ISTQB', 'Onze documents ISO/IEC/IEEE 29119-3 tirés des faits collectés',
                      '08-livrables',
                      'Les chiffres des documents viennent des faits collectés, jamais d’une saisie. Un document '
                      'n’est diffusable qu’approuvé par un humain.',
                      '%d documents générés, %d relus par l’agent, %d approuvés.' % (lv['total'], lv['relus'], lv['approuves']),
                      ['08-livrables-istqb.gif'],
                      'Les onze documents sont rangés par phase selon ISO/IEC/IEEE 29119-3 (2) : politique, stratégie, '
                      'plan, rapports, conception, traçabilité, journal, anomalies. L’aperçu (5) montre le document tel '
                      'qu’il sera exporté, avec des chiffres tirés des faits collectés. Chaque document est généré, relu '
                      'par l’agent puis approuvé par un humain (3). GIF : 08-livrables-istqb.gif.')
    slide_double(prs, 'Livrer · Informations projet, relecture et export Word',
                 'Ce que les données ne disent pas est demandé une fois ; l’agent relit, un humain approuve, on exporte',
                 ('10-informations-projet', [(1, 'Six étapes', 'organisation, périmètre, risques, approche…'),
                                             (2, 'Organisation', 'organisme, équipe, produit, version'),
                                             (3, 'Contexte réglementaire', 'repris dans politique et stratégie'),
                                             (4, 'Normes', 'ISO/IEC/IEEE 29119, ISTQB, référentiels')]),
                 ('09-livrable-document', [(1, 'Document', 'référence ISO 29119-3, phase, objet'),
                                           (2, 'Relire et approuver', 'export Word, HTML / PDF, Markdown'),
                                           (3, 'Relecture par l’agent', 'manques, « À compléter », verdict, score')]),
                 ['09-informations-projet.gif', '08-livrables-istqb.gif'],
                 'À gauche, l’assistant « Informations projet » demande une seule fois ce que les données ne disent pas : '
                 'organisation, périmètre, risques produit, approche, environnements, critères. Chaque réponse alimente '
                 'les documents concernés. À droite, le plan de test relu par l’agent (7) : sections manquantes, « À '
                 'compléter », chiffres écartés des faits, avec un verdict et un score. Après approbation, export Word au '
                 'format standard, HTML / PDF ou Markdown (6). GIF : 09-informations-projet.gif.')
    slide_application(prs, 'Mesurer · Performance k6', 'Profils de charge, runs et seuils : la performance suit les exigences des récits',
                      '12-performance-k6',
                      'Les exigences de performance des récits deviennent des seuils. Un run qui franchit son seuil '
                      'est signalé et se compare à la référence.',
                      '%d runs simulés, dont %d au-delà de son seuil p95.' % (pf['runs'], pf['seuilsFranchis']),
                      ['10-performance-k6.gif'],
                      'La performance se mesure avec k6. Les indicateurs (1) donnent les profils, les runs, le taux de '
                      'réussite et le p95 du dernier run. L’historique (3) compare temps de réponse p95, débit et erreurs. '
                      'Montrer le run dont le p95 franchit son seuil (4) : il est signalé. En démo, les runs sont simulés. '
                      'GIF : 10-performance-k6.gif, avec la comparaison A/B.')
    slide_double(prs, 'Équiper · Installation du poste et Assistant IA',
                 'Tout le poste QA s’installe en une fois ; l’IA passe par Copilot local, sans clé exposée',
                 ('13-installation', [(1, 'État du poste', 'requis en place, à installer, optionnels'),
                                      (2, 'Stacks à installer', 'Playwright, Gherkin, k6, assistant IA'),
                                      (3, 'Suivi en direct', 'détecté, installé, vérifié ; journal'),
                                      (4, 'Installer tout', 'en une fois ; simulation ouverte à tous')]),
                 ('14-assistant-ia', [(1, 'État de l’IA', 'fournisseur actif ; sinon copier-coller'),
                                      (2, 'Onglets', 'fournisseurs, Copilot local, CLI, bac à sable'),
                                      (3, 'Brancher Copilot local', 'VS Code, extension, jeton, essai'),
                                      (4, 'Procédure guidée', 'la page se met à jour à la connexion')]),
                 ['11-installation-poste.gif', '12-assistant-ia.gif'],
                 'À gauche, l’installation du poste : Node, Playwright et ses navigateurs, Gherkin, k6, extensions VS Code. '
                 'On coche les stacks (2), seuls les composants manquants s’installent, chacun détecté, installé puis '
                 'vérifié (3). À droite, l’assistant IA : Copilot local via l’extension VS Code d’abord, puis Copilot CLI, '
                 'une API compatible OpenAI ou Anthropic ; sans fournisseur, le mode copier-coller. '
                 'GIF : 11-installation-poste.gif puis 12-assistant-ia.gif.')
    slide_double(prs, 'Démontrer · Mode démo guidé',
                 'Un jeu de données fictif chargé en un clic, puis une visite guidée de 25 étapes, environ 7 minutes',
                 ('15-reglages-demonstration', [(1, 'Réglages', 'compte, utilisateurs, démonstration, JIRA / Xray'),
                                                (2, 'Données de démonstration', 'projet IRMA fictif ◇, rien n’est envoyé'),
                                                (3, 'Contenu chargé', 'récits, Gherkin, campagnes, k6, livrables'),
                                                (4, 'Charger ou réinitialiser', 'n’efface que ce que la démo a créé')]),
                 ('16-visite-guidee', [(1, 'Halo', 'l’élément à regarder, le reste voilé'),
                                       (2, 'Étiquette', 'titre et une phrase, toujours dans l’écran'),
                                       (3, 'Étapes', 'largeur selon la durée ; un clic y saute'),
                                       (4, 'Arrêter l’autodémo', 'rend la main ; « Reprendre la visite »')]),
                 ['13-visite-guidee.gif'],
                 'Réglages › Démonstration › Charger la démo installe le jeu IRMA en une dizaine de secondes ; '
                 'Réinitialiser n’efface que ce que la démo a créé. Le bouton « Démo » de l’en-tête rejoue toute la démo, '
                 'actions annotées ; la visite commentée (Ctrl K › Visite guidée commentée) fait passer l’application '
                 'seule d’écran en écran, l’élément à regarder entouré d’un halo. '
                 'Espace met en pause, Page suivante avance, Échap rend la main. C’est le meilleur plan B si le temps '
                 'manque. GIF : 13-visite-guidee.gif.')

    # 18 à 20 · Planches -----------------------------------------------------------------------
    slide_planche(prs, 'schema-architecture.png', 'Schéma architecture',
                  'Lire le schéma de gauche à droite. Le navigateur, ou la webview VS Code, parle au serveur Node '
                  'server/portail.mjs. Chaque requête passe la même chaîne : hôte et origine, garde d’authentification, '
                  'routeur des modules V3, puis les écrans historiques. Les modules (jira, gherkin, explore, livrables, '
                  'perf, llm, install, demo, xray) écrivent leurs résultats dans les fichiers locaux .wizard-qa du projet '
                  'de test. Le moteur Playwright tourne en processus enfant ; les fournisseurs IA sont essayés dans '
                  'l’ordre, Copilot local en premier.')
    slide_planche(prs, 'schema-livrables.png', 'Schéma livrables',
                  'Les livrables partent de trois sources : les faits collectés dans les modules, les informations '
                  'projet demandées une fois, et un modèle Markdown par document. On obtient onze documents rangés par '
                  'phase ISO/IEC/IEEE 29119-3. L’agent relit, un humain approuve et fige la version ; toute régénération '
                  'repasse en « Généré ». Insister : aucun chiffre inventé, tout vient des faits. En démo, l’export Word se '
                  'fait au format standard. GIF : 08-livrables-istqb.gif.')
    slide_planche(prs, 'schema-securite.png', 'Schéma sécurité',
                  'Trois messages. Chaque requête passe la même garde : hôte autorisé, origine identique, session '
                  'valide, rôle, puis module. Les secrets ne partent jamais vers l’IA : elle ne voit que des marqueurs '
                  '{{account:…}}, remplacés par le moteur Playwright au moment de la saisie. Les secrets au repos ne sont '
                  'jamais renvoyés en clair, et les actions sensibles (installations réelles, comptes, chargement de la '
                  'démo) sont réservées aux administrateurs.')

    # 21 · Branchements réels et suite --------------------------------------------------------
    s = prs.slides.add_slide(prs.slide_layouts[10])
    titre(s, 'Branchements réels et suite', 'Ce qui est simulé en démo ◇ et ce qu’il faut brancher pour un vrai projet')
    h1 = 1554480
    blocs = [
        ('link', 'JIRA / Xray réels', 'Réglages › JIRA / Xray : URL, jeton, client Xray. Scan, tri et tickets Test '
                                      'portent alors sur le vrai projet ; en démo, rien n’est envoyé ◇.'),
        ('monitor', 'Application cible réelle', 'Automatisation › Application : URL de recette, navigateur, comptes de '
                                                'test en marqueurs {{account:…}}. Les campagnes s’exécutent pour de vrai.'),
        ('sparkles', 'Fournisseur IA', 'Copilot local via l’extension VS Code, Copilot CLI, API compatible OpenAI ou '
                                       'Anthropic. Sans fournisseur : modèle intégré et copier-coller.'),
        ('fileText', 'Modèle Word de l’entreprise', 'À déposer sur le poste pour l’export des livrables (page de garde, '
                                                    'styles). La démo et ces supports utilisent le format standard.'),
    ]
    for i, (ic, t, c) in enumerate(blocs):
        carte(s, G + (i % 2) * (DEMI + ECART), HAUT + (i // 2) * (h1 + ECART), DEMI, h1, ic, t, c, 'L')
    y3 = HAUT + 2 * (h1 + ECART)
    carte(s, G, y3, L_UTILE, BAS - y3, 'target', 'Et ensuite',
          'Un premier projet réel sur un sprint : scanner ses récits, automatiser les parcours critiques, mener une '
          'campagne et produire le plan et le rapport d’avancement. Mesurer le temps gagné et recueillir les retours '
          'de l’équipe QA.', 'L', gris=True)
    notes(s, 'Tout ce qu’on a vu tourne sur des données fictives ; voici ce qu’il faut brancher pour un vrai projet. '
             'JIRA et Xray se configurent dans Réglages, avec un jeton personnel. L’application à tester se déclare dans '
             'l’automatisation, avec des comptes de test qui restent sur le poste. Le fournisseur IA est facultatif : '
             'Copilot local d’abord. Enfin, le modèle Word de l’entreprise se dépose pour l’export. Proposer un pilote '
             'sur un sprint.')

    # 22 · Fin -------------------------------------------------------------------------------
    s = prs.slides.add_slide(prs.slide_layouts[1])
    s.shapes.add_picture(LOGO, Emu(G), Emu(320040), height=Emu(420624)).name = 'Logo Wizard QA'
    texte(s, G, 777240, 4480560, 822960, [[('À vous de jouer', 44, True, VERT)]], nom='Titre')
    texte(s, G, 1645920, 4480560, 487680, [[('Wizard QA · ' + ACCROCHE, 16, False, TEXTE)]], nom='Sous-titre')
    carte(s, G, 2453640, 4480560, 1836420, 'play', 'Lancer la démonstration',
          'node server/portail.mjs, connexion demo / demo, puis Réglages › Démonstration › Charger la démo. '
          'Le bouton « Démo » de l’en-tête rejoue tout le parcours, actions annotées ; Ctrl K › Visite guidée commentée : 25 étapes en 7 minutes.', 'M')
    carte(s, G, 4472940, 4480560, 1836420, 'folder', 'Les supports',
          'supports/presentations : ces slides et leur PDF. supports/gifs : 13 GIF. docs/captures-annotees : 17 '
          'captures. supports/schemas : 4 schémas. Scripts de régénération : tools/supports.', 'M')
    s.shapes.add_picture(os.path.join(SUPPORTS, 'captures', '16-visite-guidee.png'),
                         Emu(5349240), Emu(1433608), Emu(6385255), Emu(3990785)).name = 'Capture Visite guidée'
    boite(s, 5349240, 1433608, 6385255, 3990785, trait=BORD, forme='rect', nom='Bord de capture')
    texte(s, 5349240, 5516880, 6385255, 182880,
          [[('Visite guidée sur les données de démonstration ◇', 9, False, GRIS)]], nom='Légende', align='c')
    notes(s, 'Conclure sur l’essentiel : du récit au test, du test au livrable, l’IA propose et le testeur décide. '
             'Si la salle le permet, lancer la visite guidée en direct pour finir. Rappeler où trouver les supports : '
             'les slides et le PDF, les GIF par fonctionnalité, les captures annotées et les schémas. Ouvrir les '
             'questions.')

    for i, sl in enumerate(prs.slides, 1):
        if sl.slide_layout != prs.slide_layouts[1]:
            pied(sl, i, devant='planche' in sl.slide_layout.name)

    proprietes(prs, 'Wizard QA · synthèse')
    prs.save(SORTIE)
    nettoyer_paquet(SORTIE, len(prs.slides))
    print('%d slides -> %s' % (len(prs.slides), SORTIE))


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--preparer-gabarit', metavar='SOURCE', help='réécrit gabarit-demo.pptx depuis un gabarit source')
    a = ap.parse_args()
    if a.preparer_gabarit:
        preparer_gabarit(a.preparer_gabarit)
    else:
        construire()

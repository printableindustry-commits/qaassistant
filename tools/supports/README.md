# Supports de présentation : captures annotées et schémas

Scripts qui produisent les images des supports à partir de l'application lancée sur les **données de démonstration**
(projet fictif IRMA, Banque Horizon). Prérequis : Node 22+, `playwright-core` dans `workspace/node_modules`,
Microsoft Edge, Python avec Pillow.

| Fichier | Rôle |
|---|---|
| `commun.mjs` | connexion `demo` / `demo`, chargement de la démo, navigateur Edge sans fenêtre 1440×900 |
| `ecrans.mjs` | les 17 écrans : URL, actions (clic, défilement, touche), repères (sélecteur CSS ou `{ sel, texte, rang }`, titre, phrase) |
| `captures.mjs` | captures brutes `supports/captures/NN-ecran.png` + boîtes réelles des repères (`boites.json`) |
| `annoter.py` | cadres, pastilles numérotées et légende « Repères » → `docs/captures-annotees/NN-ecran.jpg` + `reperes.json` |
| `schemas/*.html` | sources des schémas (`schema.css`, `fleches.js` communs) |
| `rendre-schemas.mjs` | rend chaque schéma en PNG 1920×1080 dans `supports/schemas/` |
| `gifs/` | GIF animés des fonctionnalités → `supports/gifs/` (voir [gifs/README.md](gifs/README.md)) |
| `videos/` | vidéos MP4 courtes (< 30 s) des fonctionnalités → `supports/videos/` (voir « Refaire les vidéos ») |
| `build_slides.py` | slides de synthèse → `supports/presentations/WizardQA-synthese.pptx` (python-pptx) ; `--preparer-gabarit <source>` réécrit `gabarit-demo.pptx` |
| `slides/pictos.mjs` | icônes du design system Prisme → `slides/pictos/*.png` (vert et gris) |
| `slides/chiffres.mjs` | chiffres du jeu de démo lus par l'API → `slides/chiffres-demo.json` |
| `slides/rendre-slides.ps1` | rendu PNG de chaque slide (contrôle) et export PDF, via PowerPoint (COM) |

## Refaire les slides

Prérequis : Python avec python-pptx, PowerPoint pour le rendu et le PDF. Les captures, `reperes.json` et les
schémas doivent exister (voir plus bas).

```bash
SUPPORTS_BASE=http://127.0.0.1:4002 node tools/supports/slides/chiffres.mjs --demo   # serveur isolé lancé
python tools/supports/build_slides.py
powershell -File tools/supports/slides/rendre-slides.ps1 -Pptx supports/presentations/WizardQA-synthese.pptx \
  -Sortie "$TMPDIR/rendu-slides" -Pdf "$PWD/supports/presentations/WizardQA-synthese.pdf"
```

- Le gabarit `supports/presentations/gabarit-demo.pptx` porte les dispositions (Couverture, Contexte, Sommaire,
  Le produit, L'application, Architecture · planche, Le parcours · planche, La suite) et leur pied de page ;
  les composants (cartes à liseré, pastilles, encadré « Repères », tuiles, tableau) sont dessinés par
  `build_slides.py` avec les cotes, couleurs et polices relevées sur le gabarit d'origine.
- Les pastilles des slides reprennent les boîtes de `docs/captures-annotees/reperes.json` ; deux pastilles
  trop proches sont décalées le long de leur encadré.
- Chaque slide a ses notes du présentateur ; les slides d'écran ont un lien ▶ GIF relatif (`../gifs/…`).
- Le script s'arrête si un texte « PRISME » ou « ARGOS » reste dans le paquet.

## Refaire les captures

Sur un serveur isolé, pour ne pas toucher au projet de test :

```bash
mkdir -p /tmp/ws-4002 && ln -s "$PWD/workspace/node_modules" /tmp/ws-4002/node_modules   # jonction sous Windows
PORTAIL_PORT=4002 PORTAIL_NO_BROWSER=1 WIZARD_REPO_ROOT=/tmp/ws-4002 node server/portail.mjs
```

Puis :

```bash
SUPPORTS_BASE=http://127.0.0.1:4002 node tools/supports/captures.mjs --demo     # --seulement 05,07 ; --decouvrir
python tools/supports/annoter.py "$TMPDIR/wizard-qa-supports/boites.json"
```

- `--demo` charge la démo avant de capturer ; `--decouvrir` écrit la liste des éléments visibles de chaque écran
  (aide pour choisir les sélecteurs). `SUPPORTS_TMP` change le dossier des fichiers de travail.
- Lancer deux fois de suite donne un bandeau d'état plus juste : la page Installation vérifie le poste au premier passage.
- La capture « Installation » retire le bandeau qui affiche le chemin local du projet.
- Un repère introuvable est signalé (`!`) et omis ; ajuster son sélecteur dans `ecrans.mjs`.

`docs/captures-annotees/reperes.json` donne pour chaque capture : `fichier`, `brute`, `titre`, `sousTitre`, `page` et
`reperes: [{ n, x, y, w, h, titre, texte }]` en pixels de la capture brute 1440×900 (réutilisable par les slides).

## Refaire les vidéos

Une vidéo MP4 par fonctionnalité (ordre du parcours), 1440×900, H.264 sans son, moins de 30 s et au plus 4 Mo.
Prérequis : ceux des GIF, plus ffmpeg (variable `FFMPEG`, sinon le binaire du paquet Python `imageio-ffmpeg`,
sinon `ffmpeg` du PATH). Serveur isolé lancé comme pour les GIF (`WIZARD_INSTALL_DRY=1` : installations simulées).

```bash
SUPPORTS_BASE_URL=http://127.0.0.1:4001 node tools/supports/videos/enregistrer-videos.mjs "$TMPDIR/videos-captures" supports/videos        # toutes
SUPPORTS_BASE_URL=http://127.0.0.1:4001 node tools/supports/videos/enregistrer-videos.mjs "$TMPDIR/videos-captures" supports/videos 05 07  # préfixes
```

| Fichier | Rôle |
|---|---|
| `videos/enregistrer-videos.mjs` | les 21 scénarios vidéo : ceux des GIF repris tels quels, plus l'exploration autonome en direct, la prise de main, le rejeu et la validation, l'export Word, les réglages, Mon projet, `.npmrc`, Hook Git, Sync Xray |
| `videos/encoder-video.py` | captures → MP4 : bandeau de légende (pastille rouge de l'étape), images identiques fusionnées, pauses plafonnées, vitesse relevée si la durée dépasse 27 s, `libx264 -pix_fmt yuv420p -crf 26 -preset slow -movflags +faststart -r 30`, crf relevé si > 4 Mo |

- Capture : flux d'écran du navigateur à 15 images/s au plus, page de 1440×846 + bandeau de 54 px.
- Les attentes longues (ouverture du navigateur exploré, rejeu) sont coupées : la capture est suspendue.
- Chaque scénario recharge la démo et arrête les sessions d'exploration encore actives.
- La prise de main clique sur la capture : la position de l'élément est calculée dans une page annexe à la taille du
  navigateur exploré (1280×800), puis ramenée à la capture affichée.

### Annotations rouges des étapes (vidéos et GIF)

`annoter()` (dans `gifs/enregistreur.mjs`) injecte une couche DOM fixe au-dessus de la page (`pointer-events: none`),
posée sur la boîte réelle de l'élément : cadre arrondi rouge `#C62828` épais avec une lueur, pastille numérotée et
étiquette « Étape n — ce qui est fait ». Elle apparaît en fondu, reste pendant l'action puis s'efface (`effacer()`) :
elle est dans les images, jamais dans l'application. `cliquer()` et `taper()` annotent chaque action (option `etape`,
sinon « Cliquer sur « libellé » » / « Saisir « texte » » ; `etape: false` pour ne rien annoter), `marquer()` annote
une zone sans action. La numérotation est continue dans un enregistrement et la légende du bas reprend l'étape courante.

## Refaire les schémas

```bash
node tools/supports/rendre-schemas.mjs                    # tous
node tools/supports/rendre-schemas.mjs schema-parcours    # un seul
```

Les flèches se déclarent en bas de chaque HTML : `fleche('#a', '#b', { de: 'b', vers: 't', texte, tir, double })`.
Le rendu signale un élément qui dépasse du cadre 1920×1080.

Règles : données 100 % fictives ; ne jamais utiliser le modèle Word de l'entreprise
(`workspace/.wizard-qa/livrables/modele-word.docx`) dans les supports.

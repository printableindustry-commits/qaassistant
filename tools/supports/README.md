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

## Refaire les schémas

```bash
node tools/supports/rendre-schemas.mjs                    # tous
node tools/supports/rendre-schemas.mjs schema-parcours    # un seul
```

Les flèches se déclarent en bas de chaque HTML : `fleche('#a', '#b', { de: 'b', vers: 't', texte, tir, double })`.
Le rendu signale un élément qui dépasse du cadre 1920×1080.

Règles : données 100 % fictives ; ne jamais utiliser le modèle Word de l'entreprise
(`workspace/.wizard-qa/livrables/modele-word.docx`) dans les supports.

# GIF animés des fonctionnalités

Produit `supports/gifs/NN-nom.gif` (960 px de large, légende en bas, ≤ 2,5 Mo, 8 à 25 s) à partir de l'application
lancée sur les **données de démonstration** (projet fictif IRMA, Banque Horizon). Prérequis : Node 22+, `playwright-core`
dans `workspace/node_modules`, Microsoft Edge, Python avec Pillow.

| Fichier | Rôle |
|---|---|
| `enregistreur.mjs` | navigateur Edge sans fenêtre 1440×900, connexion `demo` / `demo`, rechargement de la démo, capture du flux d'écran (≈ 6–7 images/s), gestes visibles (pointeur, frappe au clavier, défilement doux), halo + étiquette, masquage des mentions internes et des chemins du poste |
| `scenarios.mjs` | les 13 scénarios (actions réelles + légende de chaque moment), puis appel de l'assembleur |
| `assembler-gif.py` | captures → GIF : palette adaptative commune, images identiques fusionnées, pause finale 1,5 s, réduction automatique si > 2,5 Mo |
| `planche-controle.py` | planche de 9 images d'un GIF pour la relecture |

## Refaire les GIF

Sur un serveur isolé, installations forcées en simulation :

```bash
mkdir -p /tmp/ws-4001 && ln -s "$PWD/workspace/node_modules" /tmp/ws-4001/node_modules   # jonction sous Windows
WIZARD_INSTALL_DRY=1 PORTAIL_PORT=4001 PORTAIL_NO_BROWSER=1 WIZARD_REPO_ROOT=/tmp/ws-4001 node server/portail.mjs
```

Puis (`SUPPORTS_BASE_URL` change l'adresse, défaut `http://127.0.0.1:4001`) :

```bash
node tools/supports/gifs/scenarios.mjs "$TMPDIR/gifs-captures" supports/gifs            # tous
node tools/supports/gifs/scenarios.mjs "$TMPDIR/gifs-captures" supports/gifs 04 08      # quelques-uns (préfixe)
python tools/supports/gifs/planche-controle.py supports/gifs/04-gherkin.gif "$TMPDIR/planche.png"
```

- Chaque scénario recharge la démo : les GIF ne dépendent pas de l'ordre.
- Une légende par moment : `rec.legender('…')` dans le scénario ; `vitesse` accélère un scénario à l'assemblage.
- Les navigations en cours d'enregistrement passent par `naviguer()` : l'écran de chargement n'est pas capturé.
- Données 100 % fictives ; le modèle Word de l'entreprise n'est jamais utilisé (export Word standard).

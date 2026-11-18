# Supports de présentation de Wizard QA

Tous les supports sont produits sur l'application réelle avec les **données de démonstration** : projet IRMA de
l'organisme fictif Banque Horizon, personnes fictives. L'utilisateur affiché, « VERGER Rémy », est le compte de
démonstration. Convention : ◇ marque une donnée ou une action simulée, ou une donnée fictive. Le modèle Word de
l'entreprise n'est jamais utilisé : les exports Word montrés sont au format standard.

## Inventaire

| Support | Emplacement | Contenu |
|---|---|---|
| Slides de synthèse | `supports/presentations/WizardQA-synthese.pptx` | 22 slides 16:9 avec notes du présentateur : couverture, sommaire, contexte, promesse, parcours, la démo en chiffres, 11 slides d'écran (capture, pastilles, encadré « Repères », lien ▶ GIF), architecture, livrables, sécurité, branchements réels, fin |
| PDF des slides | `supports/presentations/WizardQA-synthese.pdf` | export PowerPoint des 22 slides (sans les notes) |
| Gabarit | `supports/presentations/gabarit-demo.pptx` | dispositions Wizard QA (Couverture, Contexte, Sommaire, Le produit, L'application, planches, La suite), sans slide |
| GIF animés | `supports/gifs/*.gif` | 13 GIF de 960 × 646, 18 à 27 s, environ 20 Mo en tout ; détail dans [gifs/README.md](gifs/README.md) |
| Captures annotées | `docs/captures-annotees/*.jpg` | 17 écrans 2000 × 900 : capture, pastilles numérotées, légende « Repères » ; `reperes.json` décrit chaque repère |
| Captures brutes | `supports/captures/*.png` | les 17 mêmes écrans en 1440 × 900, sans annotation (utilisées par les slides) |
| Schémas | `supports/schemas/*.png` | 4 planches 1920 × 1080 : parcours QA, architecture, livrables ISTQB, sécurité |

### Les slides, une par une

| N° | Slide | Média | GIF lié |
|---|---|---|---|
| 1 | Couverture (conventions ◇) | capture Pilotage | — |
| 2 | Sommaire | — | — |
| 3 | Contexte : tests manuels, traçabilité, documents obsolètes | — | — |
| 4 | La promesse : du récit au test, du test au livrable | — | — |
| 5 | Parcours QA de bout en bout | `schema-parcours.png` | — |
| 6 | La démo en chiffres (relevés par l'API) | — | — |
| 7 | Piloter · Pilotage | `01-pilotage` | `01-connexion-pilotage.gif` |
| 8 | Comprendre · Prise de connaissance | `02-prise-de-connaissance` | `02-scan-jira-par-url.gif` |
| 9 | Comprendre · Récits et tri | `03-recits-tri` | `03-tri-des-recits.gif` |
| 10 | Tester · Scénarios Gherkin | `04-gherkin` | `04-gherkin.gif` |
| 11 | Tester · Automatisation et Prenez la main | `05-automatisation`, `06-prenez-la-main` | `05-automatisation-exploration.gif` |
| 12 | Tester · Envoi Xray et campagne d'exécution | `07-envoi-xray`, `11-campagne` | `06-envoi-xray.gif`, `07-campagne-execution.gif` |
| 13 | Livrer · Livrables ISTQB | `08-livrables` | `08-livrables-istqb.gif` |
| 14 | Livrer · Informations projet, relecture et export Word | `10-informations-projet`, `09-livrable-document` | `09-informations-projet.gif`, `08-livrables-istqb.gif` |
| 15 | Mesurer · Performance k6 | `12-performance-k6` | `10-performance-k6.gif` |
| 16 | Équiper · Installation du poste et Assistant IA | `13-installation`, `14-assistant-ia` | `11-installation-poste.gif`, `12-assistant-ia.gif` |
| 17 | Démontrer · Mode démo guidé | `15-reglages-demonstration`, `16-visite-guidee` | `13-visite-guidee.gif` |
| 18 | Architecture logique | `schema-architecture.png` | — |
| 19 | Livrables : des faits au document Word | `schema-livrables.png` | — |
| 20 | Sécurité : secrets, accès et rôles | `schema-securite.png` | — |
| 21 | Branchements réels et suite | — | — |
| 22 | À vous de jouer | capture Visite guidée | — |

Les liens ▶ GIF sont relatifs (`../gifs/…`) : garder `presentations/` et `gifs/` côte à côte pour qu'ils
s'ouvrent depuis PowerPoint.

## Régénérer

Les scripts sont dans `tools/supports/` (voir [tools/supports/README.md](../tools/supports/README.md)). Toujours
sur un serveur isolé, pour ne pas toucher au projet de test :

```bash
mkdir -p /tmp/ws-4002 && ln -s "$PWD/workspace/node_modules" /tmp/ws-4002/node_modules   # jonction sous Windows
PORTAIL_PORT=4002 PORTAIL_NO_BROWSER=1 WIZARD_REPO_ROOT=/tmp/ws-4002 node server/portail.mjs
```

| Support | Commande |
|---|---|
| Captures brutes et annotées | `SUPPORTS_BASE=http://127.0.0.1:4002 node tools/supports/captures.mjs --demo` puis `python tools/supports/annoter.py "$TMPDIR/wizard-qa-supports/boites.json"` |
| Schémas | `node tools/supports/rendre-schemas.mjs` |
| GIF | voir [tools/supports/gifs/README.md](../tools/supports/gifs/README.md) |
| Chiffres de la démo | `SUPPORTS_BASE=http://127.0.0.1:4002 node tools/supports/slides/chiffres.mjs --demo` |
| Pictos des slides | `node tools/supports/slides/pictos.mjs` |
| Slides | `python tools/supports/build_slides.py` |
| Rendu de contrôle et PDF | `powershell -File tools/supports/slides/rendre-slides.ps1 -Pptx supports/presentations/WizardQA-synthese.pptx -Sortie <dossier> -Pdf <chemin absolu>.pdf` |

Ordre conseillé : captures, schémas et GIF d'abord, puis chiffres, slides, rendu et PDF. Les dates du jeu de
démonstration sont recalculées à chaque chargement ; les chiffres, eux, restent les mêmes.

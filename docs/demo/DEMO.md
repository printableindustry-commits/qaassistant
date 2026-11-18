# Lancer la démonstration

Wizard QA embarque un jeu de données **fictif et complet** (projet IRMA de l'organisme fictif « Banque Horizon »,
voir [DONNEES-FICTIVES.md](DONNEES-FICTIVES.md)) qui rend chaque écran vivant, sans JIRA, sans Xray, sans k6 et sans IA.

## 1. Démarrer

```bash
node server/portail.mjs
```

Ouvrez `http://127.0.0.1:3920/` et connectez-vous avec **demo / demo** (compte administrateur « Rémy VERGER »).

Pour une démo isolée (sans toucher à votre projet de test) :

```bash
PORTAIL_PORT=3991 WIZARD_REPO_ROOT=/chemin/vers/un/dossier-vide node server/portail.mjs
```

## 2. Charger la démo

**Réglages → Démonstration → Charger la démo** (administrateur). Le chargement prend une dizaine de secondes.
Les dates sont calculées à partir de maintenant.

| Écran | Ce que la démo y met |
|---|---|
| Pilotage | Profil projet IRMA, indicateurs, couverture par épopée, dernier test de charge |
| Connaissance / Récits | Scan JIRA de démonstration (16 récits, 4 épopées, 2 scans dans l'historique) ; tri : 9 « À automatiser », 4 « Plus tard », 3 « Ignorés » avec raisons |
| Gherkin | 6 récits validés (exportés dans `tests/features/`), 3 brouillons |
| Automatiser | 2 sessions sur l'application de démo : P0326-9301 validée (`tests/e2e/P0326-9301.spec.ts`), P0326-9310 « Prenez la main » terminée, à relire |
| JIRA / Xray | 4 envois simulés (`P0326-T1`…`T4`), dont P0326-9301 ajouté au plan de test `P0326-10528` |
| Livrables | 3 campagnes simulées sur 6 jours (6 → 8 → 9 réussis sur 10), 1 anomalie corrigée, 1 ouverte ; profil « Informations projet » ; 11 livrables générés dont 3 relus (plan, conception, traçabilité) et 2 approuvés (politique, stratégie) |
| Perf k6 | 2 profils (charge du tableau de bord, fumée de la connexion), 4 runs simulés dont 1 avec seuil p95 franchi |
| Installation | Une installation passée dans l'historique |

**Réinitialiser** (même onglet, avec confirmation) efface uniquement ce que la démo a créé : données sous
`<projet>/.wizard-qa`, fichiers de test générés par la démo (`tests/e2e/P0326-9301.spec.ts`, `tests/features/…`),
runs k6 de démo (`reports/k6/<id>`), et restaure le profil « Mon projet » d'avant la démo. Recharger remplace le jeu
précédent par un jeu neuf.

## 3. Démo et visite guidée

Le bouton **▶ Démo** de l'en-tête rejoue toute la démo, actions annotées en rouge ; la visite commentée, sans action
jouée, se lance depuis la palette Ctrl K (« Visite guidée commentée ») : voir [VISITE-GUIDEE.md](VISITE-GUIDEE.md).

## API

| Route | Rôle | Réponse |
|---|---|---|
| `GET /api/demo/status` | tout utilisateur connecté | `{ ok, loaded, at, by, counts, warnings }` |
| `POST /api/demo/load` | administrateur | `{ ok, at, counts, warnings }` |
| `POST /api/demo/reset` | administrateur | `{ ok, removed, details }` |

`counts` : `stories`, `triage`, `gherkinValidated`, `gherkinDraft`, `sessions`, `xray`, `campaigns`, `defects`,
`perfRuns`, `livrables`, `livrablesReviewed`, `livrablesApproved`. Le manifeste du jeu chargé est
`<projet>/.wizard-qa/demo/manifest.json`. Code : `server/lib/demo/seed.mjs` et `server/lib/demo/routes.mjs`.

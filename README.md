# Wizard QA Assistant — Installation et pilotage de la stack de test

Extension VS Code et portail local pour installer et configurer la stack de test **Playwright** et les tests de performance **k6** sur un poste CA-TS, puis synchroniser les tests avec JIRA / Xray et produire les livrables QA.

## Prérequis

- **Node.js 22+** (ou Volta, voir page *Installer Node*)
- **VS Code 1.85+** pour l'extension
- Accès au registry npm CA-TS (Artifactory)

## Lancer l'application

```bash
node server/portail.mjs
```

Accueil : http://127.0.0.1:3920/ (`PORTAIL_PORT` pour changer le port).

## Compiler / packager l'extension

```bash
npm install --registry https://registry.npmjs.org/
npm run package
```

Installer le fichier `wizard-qa-assistant-<version>.vsix` via **Extensions → … → Install from VSIX…**

## Modules

| Module | Rôle |
|--------|------|
| `src/` | Extension VS Code (sidebar, webview, démarrage du serveur) |
| `server/portail.mjs` | Serveur HTTP local et routes API |
| `server/lib/` | Services : npm, Playwright, k6, Hook Git, JIRA, documentation QA, `app-registry.json` (navigation) et `app-model.mjs` (statuts) |
| `server/pages/` | Pages HTML |
| `server/assets/` | Scripts, thèmes et logos (`app-shell.*` : en-tête, navigation, guides ; `app-home.*` : accueil ; `install-autofix.*` : correction Copilot) |
| `server/conf/` | Configurations de référence |
| `k6/` | Scripts et profils de performance |

## Navigation

L'accueil propose quatre objectifs, chacun guidé étape par étape (statuts : terminé, à faire, bloqué).

| Objectif | Étapes |
|----------|--------|
| **Tester mon application web** | Préparer mon poste (Node), accès au dépôt (`.npmrc`), télécharger les outils (npm), installer Playwright |
| **Mesurer la performance** | Installer k6, préparer un test de charge |
| **Relier mes tests à JIRA** | Mon projet, connecter Git à JIRA (Hook Git), synchroniser |
| **Produire mes livrables QA** | Mon projet, générer les livrables |

Chaque page affiche un guide (objectif, actions, suite) et un bouton « Étape suivante ». En cas d'échec d'installation, Copilot local peut corriger chemins et dépendances puis relancer l'installation.

## Ajouter un menu

La navigation, les guides et les parcours sont décrits dans [server/lib/app-registry.json](server/lib/app-registry.json) ; l'accueil, la barre latérale et les guides sont générés à partir de ce fichier.

1. Créer la page dans `server/pages/` (elle est servie automatiquement).
2. L'ajouter dans `pages` du registre (libellé, chemin, guide, `requires` éventuel).
3. La référencer dans `nav` et, si elle fait partie d'un objectif, dans `steps` d'un parcours de `journeys`.
4. Si elle a un statut, déclarer son fournisseur dans `STATUS_PROVIDERS` de [server/lib/app-model.mjs](server/lib/app-model.mjs) et renseigner `status` dans le registre.
5. Pour l'arbre de l'extension VS Code, l'ajouter à `WIZARD_PAGES` dans [src/wizardViews.ts](src/wizardViews.ts).

Si la page est une installation, ajouter `InstallAutofix.offer()` sur l'échec pour activer la correction Copilot (voir `server/assets/install-autofix.js`).

## Utilisation

1. **Mon projet** — décrire l'équipe et l'application (2 minutes).
2. Choisir un objectif sur l'accueil et suivre les étapes.
3. En cas d'échec d'installation, cliquer sur « Laisser Copilot corriger ».
4. **Mon projet** permet aussi d'exporter / importer la configuration.

## Données locales

| Fichier | Contenu |
|---------|---------|
| `.wizard-qa/conf/wizard.defaults.json` | Valeurs du wizard (**secrets**, ignoré par Git) |
| `.wizard-qa/doc-qa-progress.json` | Progression Documentation QA |
| `.wizard-qa/doc-qa-prompts/` | Archives des prompts IA générés |

Export / import : bundle `wizard-qa-bundle` v3 depuis l'accueil.

## Charte graphique

Alignée sur Kontext.AI et CA-TS :
- Vert `#006A4E`
- Teal `#009597`
- Fond `#eef4f2`

En-tête de marque avec filet dégradé, navigation latérale par sections, cartes arrondies et pied de page de version.

## Architecture

```
Extension VS Code
  ├── Sidebar (tree)
  ├── Webview intégrée (?embed=vscode)
  └── Serveur local → server/portail.mjs
         ├── lib/ (API REST)
         └── pages/ + assets/
```

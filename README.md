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
| `server/lib/` | Services : npm, Playwright, k6, Hook Git, JIRA, documentation QA |
| `server/pages/` | Pages HTML |
| `server/assets/` | Scripts, thèmes et logos (`app-shell.*` : en-tête et navigation) |
| `server/conf/` | Configurations de référence |
| `k6/` | Scripts et profils de performance |

## Navigation

| Section | Pages |
|---------|-------|
| **Accueil** | Tableau de bord |
| **Poste de travail** | Installer Node, registry `.npmrc`, Installer NPM, pré-configuration poste |
| **Stack de test** | Installer Playwright |
| **Performance k6** | Wizard performance, installation k6 |
| **JIRA et Git** | Hook Git, Sync JIRA |
| **Documentation** | Livrables QA, Wiki |

## Utilisation

1. **Poste de travail** — installer Node, configurer le registry, lancer `npm install`.
2. **Stack de test** — installer Playwright et ses navigateurs.
3. **Performance k6** — installer k6, définir les profils de charge et lancer les scénarios.
4. **JIRA et Git** — configurer le Hook Git puis synchroniser les plans de test.
5. **Documentation** — générer les livrables QA à partir du projet.

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

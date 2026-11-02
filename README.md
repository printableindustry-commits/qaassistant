# Wizard QA Assistant — v1.33.0

Extension VS Code pour la configuration et la documentation QA (CA-TS).

## Fonctions

| Page | Rôle |
|------|------|
| **Accueil** | Parcours, export/import wizard (bundle v3) |
| **Éditer .npmrc** | `%USERPROFILE%\.npmrc` |
| **Pré-configuration** | Node / npm / Cypress offline |
| **Hook JIRA/Xray** | `.env`, `hooks.conf`, post-commit |
| **Documentation QA** | Assistant guidé livrables Word, prompts IA entreprise, injection chapitre par chapitre |
| **Wiki** | Documentation interactive (parcours, fichiers, export/import) |

## Installation (développement)

```bash
cd 00_Scripts_Implementation/05_wizard-qa-vscode
npm install --registry https://registry.npmjs.org/
npm run compile
```

Puis **F5** (Run Extension) ou :

**Extensions** → `…` → **Install from VSIX…** après `npm run package`.

## Utilisation

1. Ouvrir le dépôt de tests dans VS Code.
2. Cliquer l'icône **Wizard QA** dans la barre latérale.
3. Choisir une page (Accueil, Hook, Documentation QA…).

Commandes palette : `Wizard QA: …`

Configuration : `wizardQa.port`, `wizardQa.autoStart`, `wizardQa.nodePath`.

## Données locales

| Fichier | Contenu |
|---------|---------|
| `.wizard-qa/conf/wizard.defaults.json` | Valeurs wizard (**secrets**, gitignored) |
| `.wizard-qa/doc-qa-progress.json` | Progression Documentation QA par chapitre |
| `.wizard-qa/doc-qa-prompts/` | Archives des prompts IA générés |

## Export / import (accueil)

Le bundle `wizard-qa-bundle` v3 inclut : profil wizard, fichiers `.wizard-qa/conf/`, progression doc QA et prompts archivés.

## Partager la TRIBU

```bash
npm run package
```

Distribuer le fichier **`wizard-qa-assistant-1.33.0.vsix`**.

Installation chez un collègue : **Install from VSIX…**

## Architecture

```
Extension VS Code
  ├── Sidebar (tree)
  ├── Webview intégrée (thème éditeur + ?embed=vscode)
  └── Serveur local → server/portail.mjs
         ├── lib/ (API REST)
         └── pages/ + assets/
```

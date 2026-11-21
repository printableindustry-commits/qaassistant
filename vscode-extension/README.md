# Wizard QA pour VS Code

La même application que l'appli web Wizard QA (`npm start`), dans VS Code :

- **Wizard QA : Ouvrir** démarre le serveur intégré (port libre de `127.0.0.1`) et affiche l'application dans un panneau ;
- la vue **Wizard QA › Pages** (barre d'activité) ouvre directement chaque écran : Pilotage, Connaissance, Récits,
  Automatiser, Installation, Perf k6, JIRA Xray, Livrables, IA, Aide, Réglages, et **Démo** ;
- **Ouvrir dans le navigateur** affiche le même écran dans le navigateur par défaut ;
- **Connecter Copilot local** relaie les requêtes d'IA du serveur vers GitHub Copilot (API `vscode.lm`).

Le projet de test géré est le premier dossier ouvert dans VS Code (ou le réglage `wizardQa.repoRoot`).
Le journal du serveur est dans **Sortie › Wizard QA**.

## Réglages

| Réglage | Rôle |
|---------|------|
| `wizardQa.serverUrl` | Serveur Wizard QA déjà lancé (l'application s'ouvre alors dans le navigateur) |
| `wizardQa.repoRoot` | Dossier du projet de test du serveur intégré |
| `wizardQa.nodePath` | Node.js 22+ à utiliser (défaut : `node` du PATH, sinon le Node de VS Code) |
| `wizardQa.bridgeToken` | Jeton d'appairage Copilot pour un serveur externe |
| `wizardQa.llmBridge.enabled` | Active le pont Copilot local |

## Développement

Ce dossier ne versionne que le code de l'extension (`src/`). `npm run build:ext`, à la racine du dépôt, compile,
copie `server/` et `media/` ici, puis produit `vsix/wizard-qa-<version>.vsix`.

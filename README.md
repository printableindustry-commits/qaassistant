# Wizard QA — installation de la stack de test, récits JIRA, Gherkin et performance k6

Application web (et extension VS Code) qui accompagne une équipe QA de bout en bout :

1. **Installer le poste de test** en une fois : Node, npm, `.npmrc`, Git, Playwright et ses navigateurs, Gherkin
   (playwright-bdd), k6, extensions VS Code, Copilot CLI. Chaque composant est détecté, installé puis vérifié.
2. **Prendre connaissance du projet** : fiche projet, connexion JIRA et scan des récits (description et critères
   d'acceptation extraits, récits à clarifier signalés).
3. **Proposer les tests en Gherkin** pour chaque récit scanné : génération par l'assistant IA (Copilot local en premier)
   ou par le modèle intégré sans IA, relecture, validation, export en fichiers `.feature`.
4. **Mesurer la performance** avec k6 : profils, runs suivis en direct, seuils, historique et comparaison.
5. **Relier les tests à JIRA / Xray** : ticket Test lié au récit, plan de test optionnel.
6. **Produire les livrables ISTQB** (ISO/IEC/IEEE 29119-3) à partir des données réelles : politique, stratégie, plan,
   avancement, clôture, conception, procédures, traçabilité, environnement, journal d'exécution, anomalies —
   assistant « Informations projet », relecture par l'agent, approbation, export Word / HTML / Markdown.

Interface au design **Prisme** : rail d'icônes, en-tête avec fil d'Ariane, recherche `Ctrl K`, bandeau d'état, guide de page.

## Démarrer

Prérequis : **Node.js 22+** (aucune dépendance npm côté serveur).

```bash
node server/portail.mjs
```

Ouvrir http://127.0.0.1:3920/ et se connecter avec le compte de démonstration **`demo` / `demo`**
(administrateur). Un bandeau le rappelle tant que son mot de passe n'a pas été changé dans **Réglages → Utilisateurs**,
où l'on crée aussi les autres comptes (rôles `admin` ou `user`).

Sans accès JIRA, **Prise de connaissance → Scanner** propose un jeu de données de démonstration (projet IRMA)
pour essayer toute la chaîne : scan → Gherkin → export → test de charge simulé.

Pour une démonstration complète en un clic (récits triés, Gherkin, sessions d'automatisation, envois Xray, campagnes,
runs k6 et livrables, données 100 % fictives) : **Réglages → Démonstration → Charger la démo**, voir [docs/demo/DEMO.md](docs/demo/DEMO.md).

### Variables d'environnement

| Variable | Défaut | Rôle |
|----------|--------|------|
| `PORTAIL_PORT` | `3920` | Port HTTP |
| `PORTAIL_HOST` | `127.0.0.1` | Interface d'écoute (`0.0.0.0` pour un accès réseau) |
| `PORTAIL_ALLOWED_HOSTS` | — | Noms d'hôte acceptés en plus de la boucle locale (liste séparée par des virgules) ; obligatoire si l'application est exposée sous un autre nom |
| `PORTAIL_NO_BROWSER` | — | `1` : ne pas ouvrir le navigateur au démarrage |
| `WIZARD_REPO_ROOT` | `./workspace` | Projet de test géré (tests, features, scripts k6, `.wizard-qa/`) |
| `WIZARD_INSTALL_DRY` | — | `1` : installations en simulation uniquement |
| `WIZARD_BRIDGE_TOKEN` | généré | Jeton d'appairage du pont Copilot local |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | — | Clés lues par les fournisseurs IA correspondants (sinon saisies dans **Assistant IA**) |

## Démo et supports

1. **Charger la démo** : se connecter en `demo` / `demo`, puis **Réglages › Démonstration › Charger la démo**. Le jeu
   est 100 % fictif (projet IRMA, Banque Horizon). Rien n'est envoyé vers JIRA, Xray ou k6, et **Réinitialiser**
   n'efface que ce que la démo a créé. Voir [docs/demo/DEMO.md](docs/demo/DEMO.md).
2. **Démo** : le bouton **▶ Démo** de l'en-tête (« Tout rejouer ») charge la démo si besoin puis joue l'application seule, actions annotées en rouge (≈ 4 min 30 à ×1, tout simulé) ; `Ctrl K` propose aussi la visite commentée. Voir [docs/demo/VISITE-GUIDEE.md](docs/demo/VISITE-GUIDEE.md).
3. **Supports de présentation**, avec l'inventaire et les commandes de régénération dans [supports/README.md](supports/README.md) :
   - slides de synthèse avec notes du présentateur : [WizardQA-synthese.pptx](supports/presentations/WizardQA-synthese.pptx) et son [PDF](supports/presentations/WizardQA-synthese.pdf) ;
   - 21 vidéos MP4 de moins de 30 s, annotées en rouge étape par étape : [supports/videos/](supports/videos/README.md) ;
   - 13 GIF, un par fonctionnalité : [supports/gifs/](supports/gifs/README.md) ;
   - 17 captures annotées : [docs/captures-annotees/](docs/captures-annotees/) ;
   - 4 schémas (parcours, architecture, livrables, sécurité) : [supports/schemas/](supports/schemas/).

   Les scripts qui les produisent sont dans [tools/supports/](tools/supports/README.md).

## Sécurité

- Toutes les pages et API exigent une session (cookie `qa_sid` HttpOnly, SameSite=Lax, 12 h glissantes) ;
  mots de passe en scrypt, verrouillage après 5 échecs en 10 minutes.
- Hôte contrôlé (anti DNS rebinding) et origine vérifiée pour toute requête modifiante.
- Secrets jamais renvoyés en clair par l'API (jetons JIRA, clés IA, mot de passe du proxy) ; l'export de configuration
  les exclut par défaut et, comme l'import, est réservé aux administrateurs.
- Installations réelles réservées aux administrateurs ; la simulation est ouverte à tous.
- Commandes système lancées sans shell (arguments séparés), jamais construites à partir de saisies.

## Modules

| Écran | Module serveur | Rôle |
|-------|----------------|------|
| Pilotage (`/`) | `server/lib/dashboard/` | Indicateurs, parcours QA, actions prioritaires, couverture par épopée |
| Prise de connaissance | `server/lib/jira/` | Connexion JIRA Cloud ou Server/DC, scan JQL, extraction des critères d'acceptation, revue des récits |
| Récits & Gherkin | `server/lib/gherkin/` | Génération (IA ou modèle), éditeur avec contrôle syntaxique FR/EN, validation, export `.feature`, génération par lot |
| Installation | `server/lib/install/` | Plan déclaratif (`server/conf/install-plan.reference.json`), composants idempotents détecter/installer/vérifier, suivi en direct, journaux, diagnostic IA |
| Performance k6 | `server/lib/perf/` | Profils, runs non bloquants en direct, lecture du `summary.json`, seuils, comparaison, mode simulation |
| Livrables | `server/lib/livrables/` | 11 livrables ISTQB alimentés par les faits (récits, Gherkin, tests, campagnes, Xray, k6), modèles éditables (`server/conf/livrables/`), relecture, approbation, exports |
| Assistant IA | `server/lib/llm/` | Fournisseurs, test, bac à sable, journal d'usage |
| Réglages | `server/lib/auth/` + config V2 | Utilisateurs, mot de passe, export / import |

Écrans historiques conservés et restylés : Mon projet, `.npmrc`, installations unitaires, scénarios k6, Hook Git,
synchronisation Xray, documentation QA, réparation, wiki.

Le contrat technique (routeur, statuts, design system, interfaces entre modules) est décrit dans
[docs/V3-ARCHITECTURE.md](docs/V3-ARCHITECTURE.md).

## Assistant IA : Copilot local d'abord

Les fournisseurs sont essayés dans cet ordre (modifiable dans **Assistant IA**) :

1. **Copilot local (VS Code)** — l'extension Wizard QA relaie les requêtes vers GitHub Copilot via l'API `vscode.lm`.
   Dans VS Code : commande **« Wizard QA : Connecter Copilot local »**, réglages `wizardQa.serverUrl` et
   `wizardQa.bridgeToken` (jeton affiché sur la page Assistant IA). Inutile de configurer quoi que ce soit avec le
   serveur intégré lancé par l'extension.
2. **Copilot CLI** — commande `copilot` (paquet npm `@github/copilot`, installable depuis la page Installation).
3. **API compatible OpenAI** — Azure OpenAI, GitHub Models, Ollama, LM Studio…
4. **Anthropic** — API Messages (modèle par défaut `claude-sonnet-5-5`).
5. **Manuel** — toujours disponible : le prompt est copié, la réponse collée.

Tant qu'aucun fournisseur n'est branché, chaque écran bascule automatiquement en mode manuel.

## Appli web et extension VS Code

Un seul code applicatif (`server/`), livré de deux façons, **toujours construites ensemble** :

| Commande | Produit |
|----------|---------|
| `npm start` | Lance l'appli web (http://127.0.0.1:3920/) |
| `npm run build` | `node --check` de `server/` et `scripts/`, **puis** l'appli web **et** l'extension |
| `npm run build:web` | `dist/web/wizard-qa-web-<version>.zip` : `server/`, `start.cmd`, `start.sh`, README (sans `workspace/` ni données) |
| `npm run build:ext` | `vsix/wizard-qa-<version>.vsix` : extension compilée + copie de `server/` et `media/` |
| `npm run setup-hooks` | Active `.githooks/pre-commit` (aussi lancé par `npm install`) |

Le hook **pre-commit** exécute `npm run build` à chaque commit (≈ 15 s), refuse le commit si le build échoue et ajoute
le `.vsix` au commit. Le dossier `vsix/` est versionné (un seul paquet, le courant) ; `dist/` ne l'est pas.
Si le contenu de l'extension n'a pas changé, le `.vsix` existant est conservé tel quel (pas de binaire réécrit à chaque commit).

**Installer l'extension** :

```bash
code --install-extension vsix/wizard-qa-3.0.0.vsix
```

ou **Extensions › … › Installer depuis un VSIX…**. Prérequis : VS Code 1.90+ et Node.js 22+ (sinon le Node de VS Code est utilisé).

Dans VS Code : icône **Wizard QA** de la barre d'activité (vue **Pages**), commandes **Wizard QA : Ouvrir**,
**Ouvrir dans le navigateur**, **Démo**, **Connecter Copilot local**. L'extension lance le serveur embarqué
(`--embedded`, port libre de `127.0.0.1`, utilisateur local `vscode` implicite, sans connexion) sur le projet ouvert
(ou `wizardQa.repoRoot`) et affiche l'application Prisme dans un panneau ; il s'arrête avec VS Code.
Journal : **Sortie › Wizard QA**. Avec `wizardQa.serverUrl` (serveur déjà lancé), les pages s'ouvrent dans le navigateur.
Code de l'extension : `vscode-extension/src/` ; débogage : configuration « Wizard QA (extension VS Code) » de `.vscode/launch.json`.

## Arborescence

| Chemin | Contenu |
|--------|---------|
| `server/portail.mjs` | Serveur HTTP, garde d'authentification, montage des modules V3 et routes historiques |
| `server/lib/http/router.mjs` | Routeur des modules V3 |
| `server/lib/<module>/` | Modules V3 (`routes.mjs` + services) |
| `server/lib/app-registry.json` | Pages, sections, rail de navigation, guides |
| `server/assets/prisme/` | Design system Prisme : `prisme.css`, `prisme-ui.js`, `prisme-shell.js`, `legacy-bridge.css` |
| `server/pages/`, `server/assets/pages/` | Pages et leurs scripts |
| `vscode-extension/` | Extension VS Code : `src/extension.ts`, `server.ts` (serveur embarqué), `panel.ts`, `pages.ts`, `llmBridge.ts` (pont Copilot) |
| `vsix/` | Paquet `.vsix` courant (versionné, produit par `npm run build`) |
| `scripts/build.mjs`, `.githooks/` | Build web + extension, hook pre-commit |
| `workspace/` | Projet de test géré par défaut (ignoré par Git) |

## Données locales

Sous `workspace/.wizard-qa/` (ignoré par Git) : `conf/users.json` et `conf/sessions.json` (comptes, sessions),
`conf/jira.json` et `conf/llm.json` (connexions, secrets en `0o600`), `jira/` (dernier scan), `gherkin/` (scénarios),
`install/` (état, runs et journaux), k6 (profils, historique), et la configuration V2 (`conf/wizard.defaults.json`).

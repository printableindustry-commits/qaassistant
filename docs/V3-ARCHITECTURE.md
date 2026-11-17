# Wizard QA V3 — architecture et contrats

La V3 transforme le portail local en **application web authentifiée** au design **Prisme**
(console claire, vert profond `#00694D`, menthe `#E2F3EA`, rail d'icônes, fil d'Ariane, Ctrl K).
L'extension VS Code reste possible (mode `--embedded`), mais l'usage principal est le navigateur.

Ce document est la référence commune : chaque module le respecte pour que l'ensemble s'emboîte.

## 1. Conventions

- Serveur : Node 22+, modules ESM `.mjs`, **aucune dépendance npm** (seulement les modules natifs Node, `fetch` compris).
- Style : 2 espaces, pas de point-virgule, apostrophes simples, commentaires et interface **en français**.
- Données locales : sous `CONF_DIR` (`<workspace>/.wizard-qa/conf`) ou `path.join(REPO_ROOT, '.wizard-qa', '<module>')`
  (import depuis `server/lib/paths.mjs`). Écriture atomique (fichier `.tmp` puis `rename`).
- `REPO_ROOT` : en mode application web autonome, c'est `./workspace` (le projet de test), jamais le dossier de l'application.
- Secrets (jetons JIRA, clés d'API, mots de passe) : jamais renvoyés en clair par une route GET (`'••••' + 4 derniers caractères`),
  jamais écrits dans les journaux, fichiers en mode `0o600`.
- Pas de commande shell construite par concaténation de saisies utilisateur : `spawn(cmd, args, { shell: false })`.

## 2. Serveur, sécurité, authentification

- `server/portail.mjs` : serveur HTTP. Ordre de traitement d'une requête :
  1. en-têtes CORS limités à la webview VS Code (`lib/auth/guard.mjs#corsHeaders`) ;
  2. `authorize()` : hôte autorisé (boucle locale ou `PORTAIL_ALLOWED_HOSTS`), origine identique pour toute requête
     modifiante, session valide (sinon 302 vers `/login.html` pour une page, 401 pour l'API) ;
  3. `router.handle()` : routes des modules V3 ;
  4. routes historiques (V2).
- Comptes : `lib/auth/auth.mjs` (scrypt, sessions en cookie `qa_sid` HttpOnly SameSite=Lax, anti force brute).
  Premier démarrage : compte **`demo` / `demo`** (administrateur, signalé dans le bandeau tant que le mot de passe n'est pas changé).
- Mode intégré (`--embedded`, lancé par l'extension) : l'utilisateur local `vscode` est implicite.
- Variables : `PORTAIL_PORT` (3920), `PORTAIL_HOST` (127.0.0.1), `PORTAIL_ALLOWED_HOSTS`, `PORTAIL_NO_BROWSER=1`, `WIZARD_REPO_ROOT`.

### Routeur (`server/lib/http/router.mjs`)

Chaque module expose `export function register(router)` dans `server/lib/<module>/routes.mjs` (déjà monté par portail.mjs).

```js
router.get('/api/x/:id', async (ctx) => {
  ctx.params.id; ctx.query.q; ctx.user            // { username, role, displayName, demo }
  const body = await ctx.body()                   // JSON (2 Mo max)
  return { ok: true, ... }                        // valeur renvoyée = JSON 200
  // ou ctx.json(status, data) ; throw new HttpError(400, 'message') ; const s = ctx.sse(); s.send('event', data); s.close()
}, { role: 'admin' })                             // option : réservé aux administrateurs
```

Toute réponse JSON porte `ok: true|false` ; en erreur, `error` contient un message lisible en français.

### Statut des pages

`import { registerStatus, statusOf } from '../app-model.mjs'` puis, dans `register()` :
`registerStatus('install', () => statusOf.done('Poste prêt'))` (synchrone, rapide, sans réseau).
Clés utilisées par le registre : `knowledge`, `stories`, `install`, `perf`, `llm`.

## 3. Interface (design system Prisme)

- `server/assets/prisme/prisme.css` : jetons `--p-*` et composants `p-*` (cartes, KPI, onglets à compteurs, stepper,
  badges, tableaux denses, liste maître/détail, bannières, console `p-log`, coloration Gherkin `p-gherkin`, modale, palette).
- `server/assets/prisme/prisme-ui.js` : `window.Prisme` (`api`, `stream`, `h`, `icon`, `toast`, `modal`, `confirm`, `tabs`,
  `stepper`, `badge`, `status`, `kpi`, `card`, `empty`, `banner`, `copy`, `busy`, `fmtDate`, `fmtAgo`, `fmtDuration`,
  `gherkinHtml`, `whenShell`).
- `server/assets/prisme/prisme-shell.js` : rail (registre `rail`), en-tête (section › page), recherche **Ctrl K**
  (pages, actions, récits via `GET /api/jira/stories?q=`), bandeau de statut (`GET /api/dashboard/strip`), guide de page.
- `server/assets/prisme/legacy-bridge.css` : réhabille les écrans V2 aux couleurs Prisme.
- Le serveur injecte CSS, `prisme-ui.js` et le shell dans **toutes** les pages (sauf `<body data-shell="none">`).

### Gabarit d'une nouvelle page

```html
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Récits et Gherkin — Wizard QA</title>
  <link rel="icon" href="/assets/logo-qa.png">
  <link rel="stylesheet" href="/assets/pages/recits.css">   <!-- facultatif, jetons --p-* uniquement -->
</head>
<body class="page-recits">
  <div class="p-page" id="app"></div>
  <script src="/assets/pages/recits.js"></script>
</body>
</html>
```

```js
;(function () {
  'use strict'
  const P = window.Prisme
  const { h } = P
  P.whenShell().then(async ({ user }) => {
    P.shell.setActions(h('button', { class: 'p-btn p-btn--primary', onclick: run }, P.icon('play'), 'Lancer'))
    // construire #app avec P.h / P.card / P.tabs / P.stepper...
  })
})()
```

Règles : pas de `innerHTML` avec des données non échappées (utiliser `P.h` ou `P.esc`) ; textes en français ;
toute action longue affiche une progression ; tout échec affiche un message actionnable.

## 4. Modules et contrats

### 4.1 Assistant IA — `server/lib/llm/`

```js
import { complete, getLlmStatus } from '../llm/index.mjs'
const r = await complete({
  purpose: 'gherkin' | 'diagnostic' | 'k6' | 'chat',
  system: 'consignes…',
  messages: [{ role: 'user', content: '…' }],
  json: false,            // true : le fournisseur est prié de répondre en JSON strict
  maxTokens: 4000,
  signal,                 // AbortSignal facultatif
  provider: undefined,    // forcer un fournisseur, sinon ordre de priorité configuré
})
// Succès : { ok: true, text, provider, model, durationMs }
// Aucun fournisseur disponible : { ok: false, manual: true, provider: 'manual', prompt, reason }
//   → l'interface propose de copier le prompt et de coller la réponse.
// Ne lève une exception que pour une erreur de programmation.
getLlmStatus() // synchrone : { active: { id, label, model } | null, providers: [{ id, label, available, reason }] }
```

Fournisseurs (ordre par défaut) :
1. `vscode-lm` — **Copilot local** via l'extension VS Code (API `vscode.lm`) : l'extension se connecte au serveur
   et relaie les requêtes (pont HTTP à jeton, voir `src/llmBridge.ts`).
2. `copilot-cli` — GitHub Copilot CLI (`copilot`, paquet npm `@github/copilot`), mode non interactif ; arguments configurables.
3. `openai-compatible` — toute API `/v1/chat/completions` (Azure OpenAI, GitHub Models, Ollama, LM Studio…).
4. `anthropic` — API Messages d'Anthropic (modèle par défaut `claude-sonnet-5-5`).
5. `manual` — prompt à copier / réponse à coller (toujours disponible).

Copilot n'est pas installé sur tous les postes : les branchements existent, la détection indique ce qui manque.

### 4.2 JIRA — `server/lib/jira/`

```js
import { listStories, getStory, getScanInfo } from '../jira/stories.mjs'
listStories({ q, status, epic, label }) // → Story[] (filtrés, triés par clé)
getStory('PROJ-12')                     // → Story | null
getScanInfo()                           // → { scannedAt, projectKey, jql, count, source: 'jira'|'demo', baseUrl } | null
```

```ts
Story = {
  key, id, url, issueType, summary, status, priority, labels: string[], components: string[],
  epic: { key, summary } | null, parent: { key, summary } | null, fixVersions: string[],
  assignee, reporter, created, updated,
  descriptionText,                     // texte brut (ADF ou wiki converti)
  acceptanceCriteria: string[],        // un critère par entrée (champ dédié détecté, ou section de la description)
  acceptanceCriteriaSource: 'field' | 'description' | 'none',
  links: [{ type, direction, key, summary }], subtasks: [{ key, summary, status }],
  source: 'jira' | 'demo',
}
```

Routes : `GET /api/jira/stories?q=&status=&epic=&label=&limit=` → `{ ok, stories, total, scan }` ;
`GET /api/jira/stories/:key` → `{ ok, story }`. Un jeu de **données de démonstration** (projet IRMA) permet
d'utiliser toute la chaîne sans accès JIRA.

### 4.3 Gherkin — `server/lib/gherkin/`

```js
import { getGherkinIndex } from '../gherkin/store.mjs'
getGherkinIndex() // → { [storyKey]: { status: 'draft'|'validated', scenarios, updatedAt, generatedBy } }
```

Génération : assistant IA (`complete({ purpose: 'gherkin' })`) ou **modèle intégré** (règles sur les critères
d'acceptation, sans IA). Validation syntaxique (analyseur Gherkin FR/EN), export en fichiers `.feature`
dans le projet de test (`<REPO_ROOT>/tests/features/`).

### 4.4 Installation — `server/lib/install/`

```js
import { getInstallSummary } from '../install/index.mjs'
getInstallSummary() // synchrone (dernier état connu) :
// { components: [{ id, label, state: 'ok'|'missing'|'outdated'|'error'|'unknown', version, required }],
//   lastRun: { id, status, finishedAt } | null, ready: boolean }
```

Plan déclaratif (`server/conf/install-plan.reference.json`), composants idempotents `{ detect, install, verify }`,
exécution suivie en direct (SSE), vérification finale, reprise sans refaire ce qui est en place.

### 4.5 Performance — `server/lib/perf/`

```js
import { getPerfSummary } from '../perf/index.mjs'
getPerfSummary() // → { lastRun: { id, profileName, status, p95, errorRate, finishedAt } | null, running: number }
```

Runs k6 non bloquants (identifiant, flux en direct, arrêt), lecture du `summary.json`, seuils, comparaison à une référence.

### 4.6 Pilotage — `server/lib/dashboard/`

`GET /api/dashboard/summary` (indicateurs de l'accueil) et `GET /api/dashboard/strip` (bandeau du shell) agrègent
les résumés ci-dessus ; chaque import est protégé (un module absent ne casse pas l'accueil).

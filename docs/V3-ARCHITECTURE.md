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

## 5. Du récit au test automatisé (V3.1)

Parcours visé : **URL du projet JIRA → scan → tri des récits → (Gherkin) → exploration Playwright de l'application
pilotée par l'IA → prise de main par le testeur si l'IA bloque → test Playwright généré → validation → ticket Test
dans JIRA/Xray, relié au récit et, en option, à un plan de test.**

Règles communes à ces modules :
- **Aucun mot de passe de compte de démo n'est envoyé à l'IA ni écrit dans un journal ou dans le code généré.**
  L'IA ne voit que des marqueurs `{{account:<id>:username}}` / `{{account:<id>:password}}` ; seul le moteur
  navigateur les remplace au moment de la saisie. Les saisies enregistrées pendant la prise de main qui
  correspondent à un secret connu (ou à un champ `type=password`) sont remplacées par le marqueur.
- Le contenu des pages explorées est une **donnée** : il est transmis à l'IA comme tel, jamais comme consigne.
  Le moteur refuse toute navigation hors des origines autorisées de la cible.
- Processus enfants sans shell, arrêtés à la fin de la session et à l'arrêt du serveur.
- Sans fournisseur d'IA (mode manuel), tout reste utilisable : tri par règles, prise de main directe,
  génération du test par règles à partir de l'enregistrement.

### 5.1 Source JIRA par URL et tri — `server/lib/jira/` (url.mjs, triage.mjs)

```js
import { parseJiraUrl } from '../jira/url.mjs'
parseJiraUrl('https://acme.atlassian.net/jira/software/projects/IRMA/boards/12')
// → { ok: true, baseUrl: 'https://acme.atlassian.net', projectKey: 'IRMA', boardId: '12', issueKey: null, jql: null, filterId: null }
// Formes reconnues : /browse/KEY, /browse/KEY-12, /projects/KEY, /jira/software/(c/)projects/KEY/…,
// /secure/RapidBoard.jspa?rapidView=&projectKey=, /issues/?jql=…, /issues/?filter=…, ?selectedIssue=KEY-1
// Erreur : { ok: false, error: 'message lisible' }

import { getTriage, suggestTriage } from '../jira/triage.mjs'
getTriage()           // → { [storyKey]: { decision: 'todo'|'later'|'skip', reason, updatedAt, by } }
suggestTriage(story)  // → { score: 0..100, suggestion: 'todo'|'later'|'skip', reasons: ['…'] }
```
Routes : `POST /api/jira/scan` accepte `{ url }` (en plus de `projectKey`/`jql`) ; `POST /api/jira/parse-url { url }` ;
`GET /api/jira/triage` → `{ ok, triage, suggestions }` ; `PUT /api/jira/triage/:key { decision, reason }` ;
`POST /api/jira/triage/bulk { keys, decision }` (ou `{ applySuggestions: true }`) ; `POST /api/jira/triage/ai { keys? }`
(classement par l'IA, `purpose: 'triage'`, repli manuel).
Fichier : `<REPO_ROOT>/.wizard-qa/jira/triage.json`. La génération Gherkin par lot ne traite par défaut que les récits « À automatiser ».

### 5.2 Exploration Playwright — `server/lib/explore/`

**Moteur** (`engine.mjs` + `runner/`) : un processus Node lancé dans `REPO_ROOT` (pour résoudre `playwright-core`
ou `@playwright/test` depuis `<REPO_ROOT>/node_modules`), dialogue en lignes JSON sur stdin/stdout.
Navigateurs : Edge (`channel: 'msedge'`) ou Chrome installés sur le poste, sinon Chromium de Playwright.

```js
import { engineStatus, openBrowser } from '../explore/engine.mjs'
engineStatus() // → { available, version, reason, browsers: [{ id: 'msedge'|'chrome'|'chromium', label, available }] }
const b = await openBrowser({ browser: 'msedge', headless: false, baseUrl, allowedOrigins: [], secrets: { 'account:agent:password': '…' },
                              viewport: { width: 1280, height: 800 }, onEvent: (type, data) => {} })
// onEvent : 'log' (texte), 'screenshot' (dataUrl jpeg), 'recording' (événement capturé), 'navigated' ({ url, title }), 'exit'
await b.goto(url)                    // → { ok, url, title, error? }
await b.snapshot({ screenshot: true })
// → { url, title, screenshot, size: { w, h }, elements: [{ ref, role, name, tag, type, text, placeholder, visible, enabled,
//      box: { x, y, w, h }, candidates: [{ strategy: 'testid'|'role'|'label'|'placeholder'|'text'|'css', value, code, unique }] }] }
await b.act({ action: 'click'|'fill'|'select'|'check'|'uncheck'|'press'|'hover', ref | selector: { strategy, value }, value, secret })
// → { ok, error?, usedSelector: { strategy, value, code }, url }
await b.expect({ kind: 'visible'|'text'|'url'|'value'|'hidden', selector, value })   // → { ok, error? }
await b.startRecording(); const events = await b.stopRecording()
// event : { type: 'click'|'fill'|'select'|'check'|'press'|'navigate', candidates, value | secret, url, at }
await b.clickAt({ x, y }); await b.typeText(text); await b.pressKey('Enter')  // prise de main à distance (sur la capture)
await b.screenshot(); await b.close()
```

**Génération du test** (`codegen.mjs`) :
```js
buildPlaywrightSpec({ story, target, accounts: [{ id, label }], scenarios: [{ name, steps: [Step] }] })
// → { code, relPath: 'tests/e2e/<clé>.spec.ts' }
// Step = { action: 'goto'|'click'|'fill'|'select'|'check'|'uncheck'|'press'|'expect', selector: { strategy, value, code } | null,
//          value, secret, url, expect: { kind, value } | null, gherkin, source: 'ai'|'human'|'rule', note }
```
Le code généré utilise `@playwright/test`, lit les comptes dans `tests/.auth/accounts.local.json` (ignoré par Git, écrit à la
validation) ou dans les variables `QA_ACCOUNT_<ID>_USERNAME|PASSWORD`, et ne contient jamais de mot de passe.

**Sessions** (`sessions.mjs`, `agent.mjs`, `routes.mjs`) :
- Cibles : `GET/PUT /api/explore/targets` (`{ id, name, baseUrl, allowedOrigins, browser, accounts: [{ id, label, username, password, notes }] }`,
  mots de passe masqués en lecture, conservés si la valeur masquée revient), fichier `<CONF_DIR>/explore-targets.json` (0o600).
  Cible préinstallée : **« Application de démo IRMA »** servie par le portail sous `/demo-app/` (comptes `agent` / `gestionnaire`).
- `GET /api/explore/engine` → `engineStatus()`.
- `POST /api/explore/sessions { storyKey, targetId, accountIds, instructions, maxIterations, headless }` → `{ ok, session }` ;
  `GET /api/explore/sessions?storyKey=` ; `GET /api/explore/sessions/:id` ; `GET /api/explore/sessions/:id/events` (SSE :
  `snapshot`, `plan`, `step`, `log`, `screenshot`, `needs-human`, `recording`, `code`, `status`, `done`, `error`).
- `POST /api/explore/sessions/:id/chat { message }` : dialogue avec l'IA sur la manière de tester (plan d'étapes) ;
  `POST …/start` (exploration autonome) ; `POST …/takeover` (prise de main : enregistrement) ; `POST …/remote { kind: 'click'|'type'|'key', x, y, text, key }` ;
  `POST …/takeover/done` (l'IA interprète l'enregistrement) ; `PUT …/steps` (édition) ; `POST …/replay` ; `POST …/validate` ; `POST …/stop`.
- Après `maxIterations` (défaut 4) tentatives sans progrès sur une étape, l'événement `needs-human` ouvre la fenêtre « Prenez la main ».
- Statuts : `draft`, `planning`, `exploring`, `needs-human`, `recording`, `review`, `replaying`, `validated`, `failed`, `stopped`.
- Contrat pour Xray : `getSessionArtifact(id)` → `{ id, storyKey, status, relPath, code, steps, scenarios, target: { name, baseUrl } } | null`.
- Page : `/automatisation.html?key=STORY-1` (section « Tester », dans le rail).

### 5.3 Envoi vers JIRA / Xray — `server/lib/xray/`

```js
import { pushTest } from '../xray/push.mjs'
pushTest({ storyKey, source: { kind: 'playwright', sessionId } | { kind: 'gherkin' }, summary, testPlanKey, dryRun, user })
// → { ok, testKey, testUrl, linked, planKey, simulated, updated }
```
- Xray Cloud (GraphQL, `client_id`/`client_secret`, préremplis depuis `XRAY_CLIENT_ID`/`XRAY_CLIENT_SECRET` du Hook) ou
  Xray Server/DC (REST `/rest/raven/1.0`, identifiants JIRA). Réglages : `<CONF_DIR>/xray.json` (0o600, secrets masqués).
- Étapes : création (ou mise à jour si déjà envoyé) du ticket **Test** (type Generic pour Playwright avec le code et le chemin
  du fichier, Cucumber pour le Gherkin), lien « tests » vers le récit, ajout optionnel au **plan de test**.
- Routes : `GET/PUT /api/xray/settings`, `POST /api/xray/test-connection`, `GET /api/xray/plans?q=`, `POST /api/xray/preview`,
  `POST /api/xray/push`, `GET /api/xray/pushed?storyKey=`. En données de démonstration, l'envoi est simulé (et signalé).
- Interface réutilisable : `/assets/pages/xray-push.js` → `window.XrayPush.open({ storyKey, source, onDone })`
  (aperçu, choix du plan, résultat avec liens) ; réglages Xray dans **Réglages → JIRA / Xray**.
- Historique : `<REPO_ROOT>/.wizard-qa/xray/pushed.json`.

/**
 * Jeu de données de démonstration FICTIF, chargeable en un clic (projet IRMA, organisme fictif « Banque Horizon »).
 *
 *   loadDemo(user)  → { ok, at, counts, warnings }   état complet et cohérent : chaque écran est « vivant »
 *   resetDemo()     → { ok, removed }                efface uniquement ce que la démo a créé
 *   demoStatus()    → { loaded, at, counts }
 *
 * Tout est simulé : aucun appel réseau (JIRA, Xray, k6), aucune exécution réelle. Les dates sont relatives
 * à « maintenant » (scan il y a 7 jours, campagnes étalées sur la semaine…). Les écritures passent par les
 * fonctions des modules quand elles existent ; sinon les fichiers sont écrits aux formats exacts qu'ils lisent.
 * Toutes les données vivent sous <REPO_ROOT>/.wizard-qa, sauf les fichiers de test générés (tests/e2e, tests/features)
 * et les runs k6 (reports/k6/<id>) : ils sont recensés dans le manifeste pour être retirés par resetDemo().
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import { REPO_ROOT } from '../paths.mjs'
import { JIRA_DATA_DIR, writeAtomic, saveScanResult, getScanInfo, getStory, listStories } from '../jira/stories.mjs'
import { discoverFields } from '../jira/fields.mjs'
import { normalizeIssue } from '../jira/normalize.mjs'
import { proposedJql } from '../jira/settings.mjs'
import { setDecisions, getTriage } from '../jira/triage.mjs'
import { GHERKIN_DIR, saveFeature, validateFeature, exportFeatures, readEntry, getGherkinIndex } from '../gherkin/store.mjs'
import { generateFromTemplate } from '../gherkin/template.mjs'
import * as S from '../explore/sessions.mjs'
import * as A from '../explore/agent.mjs'
import { getTarget, DEMO_TARGET_ID } from '../explore/targets.mjs'
import { XRAY_DATA_DIR, listPushed } from '../xray/history.mjs'
import { pushTest } from '../xray/push.mjs'
import { saveMeta, deleteRunFiles, getMeta, getSettings as getPerfSettings, saveSettings as savePerfSettings, writeJsonAtomic } from '../perf/store.mjs'
import { listRuns } from '../perf/history.mjs'
import { saveK6Profile, deleteK6Profile, getK6Profile } from '../k6-profiles.mjs'
import { CAMPAIGNS_DIR, listCampaigns, deriveDefects } from '../livrables/campaigns.mjs'
import { LIVRABLES_DIR, loadCatalog, loadDoc } from '../livrables/store.mjs'
import { applyDemoProfile } from '../livrables/profile.mjs'
import { generateAll, reviewDocumentById, approveDocument, invalidateFacts } from '../livrables/service.mjs'
import { loadWizardDefaults, saveWizardDefaults } from '../wizard-defaults.mjs'
import { getDemoFormDefaults } from '../demo-defaults.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEMO_FILE = path.join(HERE, '..', '..', 'conf', 'demo', 'irma-jira.json')
const CAPTURES_DIR = path.join(HERE, '..', '..', 'conf', 'demo', 'captures')
const DEMO_DIR = path.join(REPO_ROOT, '.wizard-qa', 'demo')
const MANIFEST = path.join(DEMO_DIR, 'manifest.json')
const INSTALL_RUNS_DIR = path.join(REPO_ROOT, '.wizard-qa', 'install', 'runs')
const PROFILE_FILE = path.join(LIVRABLES_DIR, 'profile.json')
const DOCS_DIR = path.join(LIVRABLES_DIR, 'docs')
const TRIAGE_FILE = path.join(JIRA_DATA_DIR, 'triage.json')
const STORIES_FILE = path.join(JIRA_DATA_DIR, 'stories.json')
const SCANS_FILE = path.join(JIRA_DATA_DIR, 'scans.json')

const DAY = 24 * 3600 * 1000
const HOUR = 3600 * 1000
const PLAN_KEY = 'P0326-10528'

let busy = false

// ------------------------------------------------------------------ outils

const ago = (ms) => new Date(Date.now() - ms)
const iso = (ms) => ago(ms).toISOString()
const pad = (n) => String(n).padStart(2, '0')
/** Identifiant horodaté (format commun des campagnes, runs k6 et installations) : 20261117-143012-ab12. */
const stampId = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${crypto.randomBytes(2).toString('hex')}`

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function rm(file) {
  try {
    fs.rmSync(file, { recursive: true, force: true })
    return true
  } catch {
    return false
  }
}

/** Chemin relatif au projet de test, refusé s'il sort du projet. */
function insideRepo(rel) {
  const abs = path.resolve(REPO_ROOT, String(rel || ''))
  return abs.startsWith(path.resolve(REPO_ROOT) + path.sep) ? abs : null
}

function userName(user) {
  return user?.displayName || user?.username || 'demo'
}

// ------------------------------------------------------------------ contenu fictif

// Tri : décision et raison (rédigées comme par un testeur).
const TRIAGE = {
  'P0326-9301': ['todo', 'Parcours critique (connexion) rejoué à chaque livraison.'],
  'P0326-9302': ['todo', 'Risque élevé : une cotation validée par un profil non habilité.'],
  'P0326-9310': ['todo', 'Écran le plus consulté ; critères d’acceptation précis.'],
  'P0326-9311': ['todo', 'Filtres stables, bon candidat à la non-régression.'],
  'P0326-9313': ['todo', 'Historique des cotations exigé par l’audit interne.'],
  'P0326-9320': ['todo', 'Import mensuel : valeurs limites et fichiers invalides à couvrir.'],
  'P0326-9323': ['todo', 'Rapport d’anomalies d’import demandé par la Direction des Risques.'],
  'P0326-9330': ['todo', 'Synthèse PDF présentée au comité : totaux à comparer.'],
  'P0326-9331': ['todo', 'Alertes par e-mail : à automatiser avec une boîte de test.'],
  'P0326-9303': ['later', 'Durée d’inactivité encore en discussion avec la sécurité.'],
  'P0326-9321': ['later', 'Règles de cohérence pas encore figées par le métier.'],
  'P0326-9332': ['later', 'Récit au statut Brouillon : critères à compléter par le PO.'],
  'P0326-9340': ['later', 'Audit RGAA manuel prévu avant l’automatisation.'],
  'P0326-9304': ['skip', 'Couvert par les contrôles techniques de l’équipe sécurité.'],
  'P0326-9312': ['skip', 'Doublon fonctionnel avec les filtres (P0326-9311).'],
  'P0326-9322': ['skip', 'Hors périmètre de la release : import SFTP reporté.'],
}
const GHERKIN_VALIDATED = ['P0326-9301', 'P0326-9302', 'P0326-9310', 'P0326-9313', 'P0326-9320', 'P0326-9330']
const GHERKIN_DRAFT = ['P0326-9311', 'P0326-9323', 'P0326-9331']

/** Scénario Gherkin de secours (valide) si le modèle intégré ne produit rien d'exploitable. */
function fallbackFeature(story) {
  return [
    '# language: fr',
    `@${story.key}`,
    `Fonctionnalité: ${String(story.summary || story.key).replace(/\s+/g, ' ')}`,
    '',
    `  Scénario: Parcours nominal de ${story.key}`,
    '    Étant donné un analyste connecté à IRMA',
    '    Quand il ouvre le tableau de bord des risques',
    '    Alors le titre « Tableau de bord des risques » est affiché',
    '',
  ].join('\n')
}

// ------------------------------------------------------------------ étapes du chargement

/** 1. Scan JIRA de démonstration (deux passages : il y a 7 jours, puis hier). */
function seedScan(user) {
  const demo = JSON.parse(fs.readFileSync(DEMO_FILE, 'utf8'))
  const map = discoverFields(demo.fields)
  const jql = proposedJql({ projectKey: demo.project.key, issueTypes: ['Story', 'Récit'] })
  const epicSummaries = new Map(demo.epics.map((e) => [e.key, e.fields.summary]))
  const ctx = { baseUrl: demo.baseUrl, map, epicSummaries, source: 'demo' }
  const stories = demo.issues.map((issue) => normalizeIssue(issue, ctx))
  const epics = demo.epics.map((e) => ({ key: e.key, summary: e.fields.summary, status: e.fields.status?.name || '' }))
  const base = { projectKey: demo.project.key, jql, source: 'demo', baseUrl: demo.baseUrl, deployment: 'server', fields: map, user: user?.username || 'demo', url: `${demo.baseUrl}/projects/${demo.project.key}`, urlKind: 'project' }
  saveScanResult({ scan: { ...base, scannedAt: iso(7 * DAY + 2 * HOUR), durationMs: 2140 }, stories: stories.slice(0, 13), epics })
  saveScanResult({ scan: { ...base, scannedAt: iso(1 * DAY + 3 * HOUR), durationMs: 1870 }, stories, epics })
  return { stories: stories.length, epics: epics.length }
}

/** 2. Tri des récits, décisions datées sur les jours qui suivent le premier scan. */
function seedTriage(user) {
  const items = Object.entries(TRIAGE).map(([key, [decision, reason]]) => ({ key, decision, reason }))
  setDecisions(items, user?.username || 'demo')
  const data = readJson(TRIAGE_FILE)
  if (data?.decisions) {
    let i = 0
    for (const key of Object.keys(TRIAGE)) {
      if (data.decisions[key]) data.decisions[key].updatedAt = iso(6 * DAY - (i++) * 40 * 60 * 1000)
    }
    writeAtomic(TRIAGE_FILE, data)
  }
  return Object.keys(TRIAGE).length
}

/** 3. Scénarios Gherkin : 6 validés (exportés en .feature), 3 brouillons. */
function seedGherkin(user, warnings) {
  const validated = []
  const features = []
  const all = [...GHERKIN_VALIDATED, ...GHERKIN_DRAFT]
  all.forEach((key, i) => {
    const story = getStory(key)
    if (!story) return
    let text = ''
    try { text = generateFromTemplate(story, { applicationLabel: 'IRMA' }).text } catch { text = '' }
    if (!text || !text.trim()) text = fallbackFeature(story)
    saveFeature(key, text, { generatedBy: 'template', user: user?.username || 'demo' })
    if (GHERKIN_VALIDATED.includes(key)) {
      let r = validateFeature(key, user?.username || 'demo')
      if (!r.ok) {
        // le modèle intégré a laissé une erreur : on retient un scénario minimal valide
        saveFeature(key, fallbackFeature(story), { generatedBy: 'template', user: user?.username || 'demo' })
        r = validateFeature(key, user?.username || 'demo')
      }
      if (r.ok) validated.push(key)
      else warnings.push(`Gherkin ${key} non validé.`)
    }
    // dates : génération il y a 5 jours, validation le lendemain
    const entry = readEntry(key)
    if (entry) {
      const gen = iso(5 * DAY - i * HOUR)
      const val = iso(4 * DAY - i * HOUR)
      const next = { ...entry, createdAt: gen, generatedAt: gen, updatedAt: entry.status === 'validated' ? val : gen }
      if (entry.status === 'validated') next.validatedAt = val
      writeAtomic(path.join(GHERKIN_DIR, `${key}.json`), next)
    }
  })
  if (validated.length) {
    const r = exportFeatures({ keys: validated })
    for (const w of r.written) features.push(w.path)
  }
  return { validated: validated.length, draft: GHERKIN_DRAFT.length, features }
}

// Étapes d'automatisation (forme des étapes du moteur, sélecteurs de l'application de démo).
const sel = (strategy, value) => ({ strategy, value })
function loginSteps(account, source) {
  return [
    { action: 'fill', selector: sel('label', 'Identifiant'), value: `{{account:${account}:username}}`, secret: null, url: null, expect: null, source, note: null, label: 'Identifiant' },
    { action: 'fill', selector: sel('label', 'Mot de passe'), value: null, secret: `account:${account}:password`, url: null, expect: null, source, note: null, label: 'Mot de passe' },
    { action: 'click', selector: sel('testid', 'btn-connexion'), value: null, secret: null, url: null, expect: null, source, note: null, label: 'Se connecter' },
    { action: 'expect', selector: null, value: null, secret: null, url: null, expect: { kind: 'url', value: 'tableau-de-bord.html' }, source: 'rule', note: 'Adresse atteinte après la connexion.' },
  ]
}

function stepsFor(planStep, { baseUrl, account, source }) {
  const common = { url: null, note: null }
  switch (planStep.kind) {
    case 'goto':
      return [{ action: 'goto', selector: null, value: null, secret: null, expect: null, source: 'rule', ...common, url: baseUrl }]
    case 'login':
      return loginSteps(planStep.account || account, 'rule')
    case 'context':
      return []
    case 'check':
      return [{
        action: 'expect', selector: null, value: null, secret: null, source, ...common,
        expect: { kind: 'text', value: planStep.expectText || 'Tableau de bord des risques' },
      }]
    default:
      return [{
        action: 'click', selector: sel('role', { role: 'link', name: 'Tableau de bord' }), value: null, secret: null, expect: null, source, ...common,
      }]
  }
}

/** Remplit toutes les étapes du plan (comme après une exploration réussie). */
function fillScenarios(rec, { source = 'ai', humanFrom = -1 } = {}) {
  const baseUrl = rec.target.baseUrl
  const account = (rec.accountIds || [])[0] || 'agent'
  let seq = 0
  rec.scenarios = rec.plan.scenarios.map((psc) => {
    const steps = []
    psc.steps.forEach((ps, idx) => {
      const human = humanFrom >= 0 && idx >= humanFrom
      for (const st of stepsFor(ps, { baseUrl, account, source: human ? 'human' : source })) {
        steps.push({ id: `t${++seq}`, planStepId: ps.id, gherkin: ps.gherkin || ps.goal || null, ...st })
      }
      ps.status = 'found'
    })
    return { planScenarioId: psc.id, name: psc.name, steps }
  })
  rec.stepSeq = seq
}

const stepsHash = (rec) => crypto.createHash('sha1').update(JSON.stringify((rec.scenarios || []).map((sc) => sc.steps.map((st) => [st.action, st.selector, st.value, st.secret, st.url, st.expect])))).digest('hex')

function newSession(storyKey, user, accountIds) {
  const story = getStory(storyKey)
  const target = getTarget(DEMO_TARGET_ID)
  if (!story || !target) return null
  const rec = S.createSession({
    storyKey,
    storySummary: story.summary || '',
    target: { id: target.id, name: target.name, baseUrl: target.baseUrl },
    browser: 'msedge',
    accountIds,
    accounts: target.accounts.filter((a) => accountIds.includes(a.id)).map((a) => ({ id: a.id, label: a.label })),
    instructions: '',
    maxIterations: 4,
    headless: true,
    createdBy: user?.username || 'demo',
    demo: true,
  })
  rec.plan = A.initialPlan(rec)
  return rec
}

/** Dépose une capture fictive de l'application de démo comme dernière capture de la session (cadre « Navigateur en direct »). */
function seedShot(rec, file) {
  try {
    const dir = path.join(S.SESSIONS_DIR, rec.id, 'shots')
    fs.mkdirSync(dir, { recursive: true })
    fs.copyFileSync(path.join(CAPTURES_DIR, file), path.join(dir, `00001-${Date.now()}.jpg`))
    rec.lastUrl = `${rec.target?.baseUrl || ''}`.replace(/\/?$/, '/') + 'tableau-de-bord.html'
  } catch { /* capture facultative */ }
}

/** 4. Deux sessions d'automatisation : une validée (spec écrit), une « Prenez la main » terminée. */
function seedSessions(user, warnings) {
  const ids = []
  const specs = []
  // a) Connexion SSO : exploration autonome, rejouée puis validée → tests/e2e/P0326-9301.spec.ts
  const a = newSession('P0326-9301', user, ['agent'])
  if (a) {
    fillScenarios(a, { source: 'ai' })
    a.chat = [
      { role: 'assistant', at: iso(4 * DAY), source: 'rule', content: `Bonjour ! J'ai préparé un premier plan à partir du Gherkin : ${a.plan.scenarios.length} scénario(s).` },
      { role: 'user', at: iso(4 * DAY - 5 * 60000), content: 'Utilise le compte agent et vérifie l’arrivée sur le tableau de bord.' },
      { role: 'assistant', at: iso(4 * DAY - 4 * 60000), source: 'ai', content: 'Entendu : connexion avec le compte « Agent (profil Analyste) », puis contrôle du titre « Tableau de bord des risques ».' },
    ]
    A.regenCode(a)
    a.replay = { at: iso(4 * DAY - 30 * 60000), ok: true, passed: S.flattenSteps(a).length, failed: 0, notRun: 0, durationMs: 9400, hash: stepsHash(a) }
    a.status = 'review'
    S.saveSession(a)
    try {
      const r = A.validate(a, user)
      specs.push(r.relPath)
    } catch (e) {
      warnings.push(`Validation de la session ${a.storyKey} : ${e.message}`)
    }
    a.createdAt = iso(4 * DAY)
    a.validatedAt = iso(4 * DAY - 20 * 60000)
    seedShot(a, 'tableau-de-bord-agent.jpg')
    S.saveSession(a)
    ids.push(a.id)
  }
  // b) Tableau de bord : l'agent a bloqué, le testeur a pris la main ; enregistrement interprété, test à relire.
  const b = newSession('P0326-9310', user, ['gestionnaire'])
  if (b) {
    fillScenarios(b, { source: 'ai', humanFrom: 2 })
    b.chat = [
      { role: 'assistant', at: iso(2 * DAY), source: 'rule', content: `Bonjour ! J'ai préparé un premier plan à partir du Gherkin : ${b.plan.scenarios.length} scénario(s).` },
      { role: 'assistant', at: iso(2 * DAY - 6 * 60000), source: 'ai', content: 'Je ne trouve pas le filtre par entité après 4 tentatives : prenez la main pour me montrer le parcours.' },
      { role: 'assistant', at: iso(2 * DAY - 2 * 60000), source: 'ai', content: 'Merci : j’ai interprété votre enregistrement (clic sur « Tableau de bord », contrôle du titre). Les étapes sont prêtes à rejouer.' },
    ]
    b.takeoverHistory = [{ mode: 'remote', startedAt: iso(2 * DAY - 5 * 60000), finishedAt: iso(2 * DAY - 3 * 60000), events: 6 }]
    A.regenCode(b)
    b.status = 'review'
    b.statusReason = 'Prise de main terminée : relisez les étapes enregistrées puis rejouez le test.'
    b.createdAt = iso(2 * DAY)
    seedShot(b, 'tableau-de-bord-gestionnaire.jpg')
    S.saveSession(b)
    S.emit(b, 'needs-human', { reason: 'Filtre par entité introuvable après 4 tentatives.', at: iso(2 * DAY - 6 * 60000) })
    S.emit(b, 'log', { text: 'Prise de main terminée : 6 action(s) enregistrée(s), interprétées en étapes.', level: 'ok', at: iso(2 * DAY - 2 * 60000) })
    ids.push(b.id)
  }
  return { ids, specs, a: a?.id || null }
}

/** 5. Envois Xray simulés (données de démo : rien ne part vers JIRA) ; un des tests est ajouté au plan de test. */
async function seedXray(user, sessionId, warnings) {
  const pushes = [
    { storyKey: 'P0326-9301', source: sessionId ? { kind: 'playwright', sessionId } : { kind: 'gherkin' }, testPlanKey: PLAN_KEY, when: 3 * DAY },
    { storyKey: 'P0326-9302', source: { kind: 'gherkin' }, when: 3 * DAY - 2 * HOUR },
    { storyKey: 'P0326-9320', source: { kind: 'gherkin' }, when: 2 * DAY + 4 * HOUR },
    { storyKey: 'P0326-9330', source: { kind: 'gherkin' }, when: 1 * DAY + 5 * HOUR },
  ]
  const ids = []
  for (const p of pushes) {
    try {
      const r = await pushTest({ storyKey: p.storyKey, source: p.source, testPlanKey: p.testPlanKey || '', user })
      if (r?.entry?.id) ids.push({ id: r.entry.id, at: iso(p.when) })
    } catch (e) {
      warnings.push(`Envoi Xray ${p.storyKey} : ${e.message}`)
    }
  }
  // dates étalées sur la semaine
  const file = path.join(XRAY_DATA_DIR, 'pushed.json')
  const data = readJson(file)
  if (data?.entries) {
    for (const e of data.entries) {
      const hit = ids.find((x) => x.id === e.id)
      if (hit) Object.assign(e, { pushedAt: hit.at, updatedAt: hit.at, demo: true })
    }
    writeAtomic(file, data)
  }
  return ids.map((x) => x.id)
}

/** 6. Trois campagnes d'exécution simulées (J-6, J-3, aujourd'hui) : tendance en amélioration, 1 anomalie corrigée, 1 ouverte. */
function seedCampaigns(user, specs) {
  const titles = {
    'P0326-9301': ['Connexion SSO réussie', 'Accès refusé sans habilitation'],
    'P0326-9302': ['Le Valideur valide une cotation', 'L’Analyste ne peut pas valider'],
    'P0326-9310': ['Tableau de bord par entité'],
    'P0326-9313': ['Historique des cotations d’un risque'],
    'P0326-9320': ['Import d’un fichier CSV valide', 'Fichier au mauvais format refusé'],
    'P0326-9330': ['Export PDF de la synthèse comité'],
    'P0326-9311': ['Filtre par niveau de criticité'],
  }
  const fileOfKey = (key) => specs.find((s) => s.includes(key)) || `tests/e2e/${key}.spec.ts`
  const base = []
  for (const [key, list] of Object.entries(titles)) for (const t of list) base.push({ title: `${t} @${key}`, file: fileOfKey(key), storyKey: key })
  const ERR_IMPORT = 'Error: expect(locator).toContainText(expected) — Expected: "5 000 lignes importées" — Received: "4 998 lignes importées, 2 rejets" — at tests/e2e/P0326-9320.spec.ts:24'
  const ERR_HISTO = 'TimeoutError: locator.click: Timeout 10000ms exceeded — waiting for getByRole(\'tab\', { name: \'Historique\' })'
  const plans = [
    { when: 6 * DAY + 3 * HOUR, skip: ['Filtre par niveau de criticité @P0326-9311', 'Export PDF de la synthèse comité @P0326-9330'], fail: { 'Import d’un fichier CSV valide @P0326-9320': ERR_IMPORT, 'Historique des cotations d’un risque @P0326-9313': ERR_HISTO } },
    { when: 3 * DAY + 2 * HOUR, skip: ['Filtre par niveau de criticité @P0326-9311'], fail: { 'Import d’un fichier CSV valide @P0326-9320': ERR_IMPORT } },
    { when: 2 * HOUR, skip: [], fail: { 'Import d’un fichier CSV valide @P0326-9320': ERR_IMPORT }, flaky: ['Tableau de bord par entité @P0326-9310'] },
  ]
  fs.mkdirSync(CAMPAIGNS_DIR, { recursive: true })
  const ids = []
  plans.forEach((p, n) => {
    const at = ago(p.when)
    const tests = base.map((t, i) => {
      const status = p.fail[t.title] ? 'failed' : p.skip.includes(t.title) ? 'skipped' : (p.flaky || []).includes(t.title) ? 'flaky' : 'passed'
      return {
        ...t,
        status,
        durationMs: status === 'skipped' ? 0 : 1800 + ((i * 739 + n * 211) % 4200),
        retries: status === 'flaky' ? 1 : status === 'failed' ? 1 : 0,
        error: p.fail[t.title] || null,
      }
    })
    const durationMs = tests.reduce((s, t) => s + t.durationMs, 0) + 6000
    const c = {
      id: stampId(at),
      at: at.toISOString(),
      finishedAt: new Date(at.getTime() + durationMs).toISOString(),
      simulated: true,
      simulatedReason: 'demo',
      status: 'done',
      by: user?.username || 'demo',
      env: { baseUrl: getTarget(DEMO_TARGET_ID)?.baseUrl || '', browser: 'msedge' },
      durationMs,
      tests,
    }
    const n2 = (s) => tests.filter((t) => t.status === s).length
    Object.assign(c, { total: tests.length, passed: n2('passed'), failed: n2('failed'), skipped: n2('skipped'), flaky: n2('flaky') })
    writeAtomic(path.join(CAMPAIGNS_DIR, `${c.id}.json`), c)
    ids.push(c.id)
  })
  return ids
}

/** 7. Performance : 2 profils k6 et 4 runs simulés (un seuil franchi). */
function seedPerf(user) {
  const baseUrl = getTarget(DEMO_TARGET_ID)?.baseUrl || 'http://127.0.0.1:3920/demo-app/'
  const profiles = [
    {
      id: 'demo-irma-tableau-de-bord',
      name: 'IRMA – Tableau de bord (charge nominale)',
      answers: { campaignName: 'IRMA – Tableau de bord (charge nominale)', campaignObjective: 'load', executorType: 'ramping-vus', virtualUsers: 50, duration: '5m', rampUpDuration: '1m', rampDownDuration: '30s', p95Ms: 800, p99Ms: 1500, maxErrorRate: 1, baseUrl, entryPaths: '/tableau-de-bord.html', scenarioDescription: '70 % tableau de bord, 30 % liste des risques', thinkTimeMin: 1, thinkTimeMax: 3, abortOnFail: 'no' },
    },
    {
      id: 'demo-irma-connexion',
      name: 'IRMA – Connexion (fumée)',
      answers: { campaignName: 'IRMA – Connexion (fumée)', campaignObjective: 'smoke', executorType: 'constant-vus', virtualUsers: 2, duration: '30s', p95Ms: 600, p99Ms: 1200, maxErrorRate: 1, baseUrl, entryPaths: '/', scenarioDescription: '100 % page de connexion', thinkTimeMin: 1, thinkTimeMax: 2, abortOnFail: 'no' },
    },
  ]
  for (const p of profiles) saveK6Profile({ id: p.id, name: p.name, answers: p.answers, notes: 'Profil de démonstration (fictif).' })

  const runs = [
    { profile: profiles[0], when: 5 * DAY, vus: 50, dur: '5m', p95: 612, p99: 1040, avg: 284, err: 0.002, rps: 41.7 },
    { profile: profiles[1], when: 4 * DAY + 2 * HOUR, vus: 2, dur: '30s', p95: 188, p99: 240, avg: 96, err: 0, rps: 3.9 },
    { profile: profiles[0], when: 2 * DAY + 1 * HOUR, vus: 50, dur: '5m', p95: 934, p99: 1690, avg: 401, err: 0.004, rps: 38.2 },
    { profile: profiles[0], when: 3 * HOUR, vus: 50, dur: '5m', p95: 655, p99: 1102, avg: 297, err: 0.001, rps: 42.3 },
  ]
  const ids = []
  for (const r of runs) {
    const started = ago(r.when)
    const durationMs = r.dur === '5m' ? 330000 : 32000
    const id = stampId(started)
    const p95Rule = `p(95)<${r.profile.answers.p95Ms}`
    const p99Rule = `p(99)<${r.profile.answers.p99Ms}`
    const thresholds = [
      { metric: 'http_req_duration', rule: p95Rule, ok: r.p95 < r.profile.answers.p95Ms, actual: r.p95 },
      { metric: 'http_req_duration', rule: p99Rule, ok: r.p99 < r.profile.answers.p99Ms, actual: r.p99 },
      { metric: 'http_req_failed', rule: 'rate<0.01', ok: r.err < 0.01, actual: r.err },
    ]
    const requests = Math.round(r.rps * durationMs / 1000)
    const meta = {
      id,
      profileId: r.profile.id,
      profileName: r.profile.name,
      builtinProfile: false,
      scriptPath: `k6/scripts/${r.profile.id}.js`,
      simulated: true,
      k6Version: '',
      status: thresholds.every((t) => t.ok) ? 'passed' : 'failed',
      phase: 'done',
      startedAt: started.toISOString(),
      finishedAt: new Date(started.getTime() + durationMs).toISOString(),
      durationMs,
      exitCode: thresholds.every((t) => t.ok) ? 0 : 99,
      overrides: {},
      config: { vus: r.vus, duration: r.dur, baseUrl },
      plannedMs: durationMs,
      thresholdsDef: { http_req_duration: [p95Rule, p99Rule], http_req_failed: ['rate<0.01'] },
      triggeredBy: user?.username || 'demo',
      reportDir: `reports/k6/${id}`,
      command: `◇ simulation de : k6 run k6/scripts/${r.profile.id}.js`,
      metrics: {
        p95: r.p95, p99: r.p99, p90: Math.round(r.p95 * 0.86), avg: r.avg, med: Math.round(r.avg * 0.8), min: 41, max: Math.round(r.p99 * 1.6),
        errorRate: r.err, rps: r.rps, requests, iterations: Math.round(requests / 3), iterationsRate: Math.round(r.rps / 3 * 10) / 10,
        vusMax: r.vus, checksRate: 1 - r.err, checksPassed: requests - Math.round(requests * r.err), checksFailed: Math.round(requests * r.err), dataReceived: requests * 18400, dataSent: requests * 920,
      },
      thresholds,
      summarySource: 'simulation',
      error: null,
      demo: true,
    }
    saveMeta(meta)
    // série par 10 s (courbe affichée dans le détail du run)
    const series = []
    for (let t = 0; t <= durationMs / 1000; t += 10) {
      const ramp = Math.min(1, t / 60)
      series.push({ t, vus: Math.max(1, Math.round(r.vus * ramp)), rps: Math.round(r.rps * ramp * 10) / 10, p95: Math.round(r.p95 * (0.75 + 0.25 * ramp) + ((t * 37) % 60) - 30), errors: 0 })
    }
    writeJsonAtomic(path.join(REPO_ROOT, 'reports', 'k6', id, 'series.json'), series)
    fs.writeFileSync(path.join(REPO_ROOT, 'reports', 'k6', id, 'console.log'), `$ ${meta.command}\n◇ Run simulé (données de démonstration).\n— Run terminé : ${meta.status === 'passed' ? 'réussi' : 'seuils non respectés'}.\n`, 'utf8')
    ids.push(id)
  }
  // référence : premier run du profil « tableau de bord »
  try {
    const st = getPerfSettings()
    savePerfSettings({ baselines: { ...(st.baselines || {}), [profiles[0].id]: ids[0] } })
  } catch { /* référence facultative */ }
  return { runIds: ids, profileIds: profiles.map((p) => p.id) }
}

/** 8. Historique d'installation plausible (une installation terminée il y a 8 jours). */
function seedInstall(user) {
  const started = ago(8 * DAY + 5 * HOUR)
  const id = stampId(started)
  const comps = [
    ['node', 'Node.js', 'v24.11.1'], ['npm', 'npm', '11.6.2'], ['npmrc', 'Configuration npm (.npmrc)', ''], ['workspace', 'Projet de test', ''],
    ['npm-playwright', 'Paquets Playwright', '1.56.1'], ['npm-gherkin', 'Paquets Gherkin', '29.0.0'], ['playwright-browsers', 'Navigateurs Playwright', 'msedge'], ['k6', 'k6', 'v1.3.0'],
  ]
  let t = started.getTime()
  const components = comps.map(([cid, label, version], i) => {
    const d = 4000 + i * 2500
    const c = {
      id: cid, label, required: true, dependsOn: [], state: i < 4 ? 'ok' : 'installed', phase: 'done', version, expected: '', message: i < 4 ? 'Déjà en place' : 'Installé',
      startedAt: new Date(t).toISOString(), finishedAt: new Date(t + d).toISOString(), durationMs: d, log: [i < 4 ? `${label} détecté ${version}`.trim() : `Installation de ${label}… terminée`],
    }
    t += d
    return c
  })
  const run = {
    id, status: 'done', dryRun: false, force: false, stacks: ['playwright', 'gherkin', 'k6'], requested: comps.map((c) => c[0]),
    user: user?.username || 'demo', host: 'POSTE-DEMO', startedAt: started.toISOString(), finishedAt: new Date(t).toISOString(), durationMs: t - started.getTime(),
    summary: { total: components.length, ok: 4, installed: components.length - 4, simulated: 0, skipped: 0, failed: 0, blocked: 0, cancelled: 0 },
    components, journal: ['Installation de démonstration (fictive).'], demo: true,
  }
  fs.mkdirSync(INSTALL_RUNS_DIR, { recursive: true })
  writeJsonAtomic(path.join(INSTALL_RUNS_DIR, `${id}.json`), run)
  return id
}

/** 0. Profil « Mon projet » de démonstration (l'ancien profil est conservé dans le manifeste et restauré au reset). */
function seedProject(manifest) {
  const current = loadWizardDefaults()
  manifest.projectBackup = current.project && typeof current.project === 'object' ? current.project : null
  const demo = getDemoFormDefaults(REPO_ROOT)
  saveWizardDefaults({
    project: {
      ...(current.project || {}),
      ...demo,
      tribu: 'Banque Horizon — Tribu Risques',
      squad: 'Squad Qualité Risques',
      onboardingComplete: true,
      onboardingCompletedAt: iso(9 * DAY),
      demo: true,
    },
  })
}

/** 9. Informations projet (démo IRMA) et 11 livrables générés, dont 3 relus et 2 approuvés. */
async function seedLivrables(user, warnings) {
  applyDemoProfile(userName(user))
  invalidateFacts()
  await generateAll(user)
  const reviewed = []
  for (const id of ['plan', 'conception', 'tracabilite']) {
    try {
      const r = await reviewDocumentById(id, user, { useAi: false })
      if (r.status === 'reviewed') reviewed.push(id)
      else {
        // relecture par règles avec des constats bloquants : on garde le document « généré »
        warnings.push(`Livrable ${id} : relecture avec constats bloquants.`)
      }
    } catch (e) {
      warnings.push(`Relecture ${id} : ${e.message}`)
    }
  }
  const approved = []
  for (const id of ['politique', 'strategie']) {
    try {
      await approveDocument(id, user)
      approved.push(id)
    } catch (e) {
      warnings.push(`Approbation ${id} : ${e.message}`)
    }
  }
  return { generated: loadCatalog().documents.length, reviewed, approved }
}

// ------------------------------------------------------------------ API

function readManifest() {
  return readJson(MANIFEST)
}

function countsNow() {
  const scan = getScanInfo()
  const triage = getTriage()
  const gherkin = Object.values(getGherkinIndex())
  let sessions = []
  try { sessions = S.listSessions() } catch { sessions = [] }
  const docs = (() => {
    try { return loadCatalog().documents.map((d) => loadDoc(d.id)).filter((d) => d.status !== 'none') } catch { return [] }
  })()
  const campaigns = listCampaigns()
  return {
    stories: scan?.count || 0,
    triage: Object.keys(triage).length,
    gherkinValidated: gherkin.filter((g) => g.status === 'validated').length,
    gherkinDraft: gherkin.filter((g) => g.status === 'draft').length,
    sessions: sessions.length,
    xray: listPushed().length,
    campaigns: campaigns.length,
    defects: deriveDefects(listCampaigns({ full: true })).length,
    perfRuns: (() => { try { return listRuns().length } catch { return 0 } })(),
    livrables: docs.length,
    livrablesReviewed: docs.filter((d) => d.status === 'reviewed').length,
    livrablesApproved: docs.filter((d) => d.status === 'approved').length,
  }
}

export function demoStatus() {
  const m = readManifest()
  return { ok: true, loaded: Boolean(m), at: m?.loadedAt || null, by: m?.by || null, counts: m ? countsNow() : null, warnings: m?.warnings || [] }
}

/** Charge le jeu complet (remplace d'abord un éventuel jeu de démo précédent). */
export async function loadDemo(user) {
  if (busy) throw Object.assign(new Error('Chargement ou réinitialisation déjà en cours.'), { status: 409 })
  busy = true
  try {
    if (readManifest()) await resetInner()
    const warnings = []
    const manifest = { version: 1, loadedAt: new Date().toISOString(), by: user?.username || 'demo', files: [], sessionIds: [], campaignIds: [], perfRunIds: [], k6ProfileIds: [], xrayIds: [], installRunId: null, storyKeys: [], warnings }
    const save = () => writeAtomic(MANIFEST, manifest)
    seedProject(manifest)
    save() // un chargement interrompu reste réinitialisable

    seedScan(user)
    manifest.storyKeys = listStories().map((s) => s.key)
    seedTriage(user)
    const g = seedGherkin(user, warnings)
    manifest.files.push(...g.features)
    const s = seedSessions(user, warnings)
    manifest.sessionIds = s.ids
    manifest.files.push(...s.specs)
    save()
    manifest.xrayIds = await seedXray(user, s.a, warnings)
    manifest.campaignIds = seedCampaigns(user, s.specs)
    const perf = seedPerf(user)
    manifest.perfRunIds = perf.runIds
    manifest.k6ProfileIds = perf.profileIds
    manifest.installRunId = seedInstall(user)
    save()
    const liv = await seedLivrables(user, warnings)
    manifest.livrables = liv
    save()
    invalidateFacts()
    return { ok: true, at: manifest.loadedAt, counts: countsNow(), warnings }
  } finally {
    busy = false
  }
}

async function resetInner() {
  const m = readManifest() || {}
  const removed = []
  const drop = (abs, label) => { if (abs && fs.existsSync(abs) && rm(abs)) removed.push(label) }
  const keys = new Set(m.storyKeys || [])

  // JIRA : le dernier scan s'il vient de la démo, historique et tri des récits de démo
  const stories = readJson(STORIES_FILE)
  if (stories?.scan?.source === 'demo') drop(STORIES_FILE, '.wizard-qa/jira/stories.json')
  const scans = readJson(SCANS_FILE)
  if (Array.isArray(scans)) {
    const kept = scans.filter((h) => h.source !== 'demo')
    if (kept.length !== scans.length) writeAtomic(SCANS_FILE, kept)
  }
  const triage = readJson(TRIAGE_FILE)
  if (triage?.decisions) {
    for (const k of Object.keys(triage.decisions)) if (keys.has(k)) delete triage.decisions[k]
    for (const k of Object.keys(triage.ai || {})) if (keys.has(k)) delete triage.ai[k]
    writeAtomic(TRIAGE_FILE, triage)
  }
  // Gherkin des récits de démo
  for (const k of keys) drop(path.join(GHERKIN_DIR, `${k}.json`), `gherkin/${k}`)
  // Sessions d'automatisation
  for (const id of m.sessionIds || []) {
    if (!S.isValidId(id)) continue
    try { S.forgetSession(id) } catch { /* déjà oubliée */ }
    drop(path.join(S.SESSIONS_DIR, id), `explore/${id}`)
  }
  // Fichiers de test générés (tests/e2e, tests/features) — uniquement ceux recensés
  for (const rel of m.files || []) drop(insideRepo(rel), rel)
  // dossiers devenus vides (tests/features/<épopée>, tests/e2e), sans remonter au-delà de tests/
  const testsRoot = path.join(REPO_ROOT, 'tests')
  for (const rel of m.files || []) {
    let dir = path.dirname(insideRepo(rel) || testsRoot)
    while (dir.startsWith(testsRoot + path.sep)) {
      try { fs.rmdirSync(dir) } catch { break }
      dir = path.dirname(dir)
    }
  }
  // Envois Xray simulés
  const xfile = path.join(XRAY_DATA_DIR, 'pushed.json')
  const pushed = readJson(xfile)
  if (pushed?.entries) {
    const ids = new Set(m.xrayIds || [])
    const kept = pushed.entries.filter((e) => !(ids.has(e.id) || (e.demo && e.simulated)))
    if (kept.length !== pushed.entries.length) writeAtomic(xfile, { ...pushed, entries: kept })
  }
  // Campagnes
  for (const id of m.campaignIds || []) if (/^\d{8}-\d{6}-[a-f0-9]{4}$/.test(id)) drop(path.join(CAMPAIGNS_DIR, `${id}.json`), `campagne ${id}`)
  // Performance
  for (const id of m.perfRunIds || []) {
    try { if (getMeta(id)) { deleteRunFiles(id); removed.push(`k6 ${id}`) } } catch { /* déjà supprimé */ }
  }
  for (const id of m.k6ProfileIds || []) {
    try { if (getK6Profile(id)) { deleteK6Profile(id); removed.push(`profil k6 ${id}`) } } catch { /* déjà supprimé */ }
  }
  try {
    const st = getPerfSettings()
    const baselines = { ...(st.baselines || {}) }
    let changed = false
    for (const id of m.k6ProfileIds || []) if (baselines[id]) { delete baselines[id]; changed = true }
    if (changed) savePerfSettings({ baselines })
  } catch { /* réglages facultatifs */ }
  // Installation fictive
  if (m.installRunId && /^[\w-]{6,40}$/.test(m.installRunId)) drop(path.join(INSTALL_RUNS_DIR, `${m.installRunId}.json`), `installation ${m.installRunId}`)
  // Livrables : documents générés et profil de démo
  if (fs.existsSync(DOCS_DIR)) drop(DOCS_DIR, '.wizard-qa/livrables/docs')
  const profile = readJson(PROFILE_FILE)
  if (profile?.demo) drop(PROFILE_FILE, '.wizard-qa/livrables/profile.json')

  // Profil « Mon projet » d'avant la démo
  if (Object.prototype.hasOwnProperty.call(m, 'projectBackup')) {
    try {
      saveWizardDefaults({ project: m.projectBackup || {} })
      removed.push('profil projet restauré')
    } catch { /* configuration en lecture seule */ }
  }
  drop(MANIFEST, '.wizard-qa/demo/manifest.json')
  invalidateFacts()
  return removed
}

/** Efface les données de la démo (sous .wizard-qa et les fichiers de test générés par la démo). */
export async function resetDemo() {
  if (busy) throw Object.assign(new Error('Chargement ou réinitialisation déjà en cours.'), { status: 409 })
  busy = true
  try {
    const removed = await resetInner()
    return { ok: true, removed: removed.length, details: removed }
  } finally {
    busy = false
  }
}


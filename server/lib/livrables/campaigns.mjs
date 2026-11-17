/**
 * Campagnes d'exécution des tests automatisés (contrat V3.2 §6.3).
 *
 *   listCampaigns({ full })            → résumés (plus récente d'abord) ; full: true → campagnes complètes (avec tests)
 *   getCampaign(id)                    → Campaign | null
 *   startCampaign({ simulate, user, baseUrl, browser }) → Campaign (statut « running », se termine en arrière-plan)
 *   runningCampaign()                  → Campaign | null
 *   deriveDefects(campaigns)           → anomalies regroupées par test (échecs successifs)
 *   listSpecFiles()                    → [{ relPath, storyKey, tests }] (specs Playwright de <REPO_ROOT>/tests)
 *
 * Exécution réelle : `playwright test --reporter=json` lancé SANS shell (process.execPath + cli.js de
 * <REPO_ROOT>/node_modules/@playwright/test), une campagne à la fois, délai maximal 15 min.
 * Simulation : résultats plausibles et déterministes à partir des récits « À automatiser », des Gherkin validés
 * et des specs existants, marqués `simulated`.
 * Stockage : <REPO_ROOT>/.wizard-qa/livrables/campaigns/<id>.json
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { spawn } from 'child_process'
import { REPO_ROOT } from '../paths.mjs'
import { writeAtomic, getStory, getScanInfo } from '../jira/stories.mjs'
import { getTriage } from '../jira/triage.mjs'
import { getGherkinIndex, readEntry } from '../gherkin/store.mjs'
import { demoBaseUrl } from '../explore/targets.mjs'

export const CAMPAIGNS_DIR = path.join(REPO_ROOT, '.wizard-qa', 'livrables', 'campaigns')
const TESTS_DIR = path.join(REPO_ROOT, 'tests')
const TIMEOUT_MS = 15 * 60 * 1000
const MAX_CAMPAIGNS = 50
const MAX_ERROR = 600
const ID_RE = /^\d{8}-\d{6}-[a-f0-9]{4}$/
const KEY_RE = /[A-Z][A-Z0-9_]*-\d+/
const TAG_RE = /@([A-Z][A-Z0-9_]*-\d+)\b/

let running = null // campagne en cours (en mémoire)

// ------------------------------------------------------------------ outils

function newId() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${crypto.randomBytes(2).toString('hex')}`
}

const fileOf = (id) => path.join(CAMPAIGNS_DIR, `${id}.json`)
const stripAnsi = (s) => String(s || '').replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
const hashNum = (text) => crypto.createHash('sha1').update(String(text)).digest().readUInt32BE(0)

/** Message d'erreur compact : lignes utiles jointes, 600 caractères au plus. */
function shortError(message) {
  const lines = stripAnsi(message).split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const text = lines.join(' — ')
  return text.length > MAX_ERROR ? `${text.slice(0, MAX_ERROR - 1)}…` : text
}

/** Clé de récit d'un test : tag @KEY-123 du titre, sinon clé dans le chemin du titre, sinon dans le nom du fichier. */
function storyKeyOf(titlePath, file) {
  for (const t of [...titlePath].reverse()) {
    const m = TAG_RE.exec(String(t))
    if (m) return m[1]
  }
  for (const t of titlePath) {
    const m = KEY_RE.exec(String(t))
    if (m) return m[0]
  }
  const m = KEY_RE.exec(path.basename(String(file || '')))
  return m ? m[0] : null
}

function save(c) {
  writeAtomic(fileOf(c.id), c)
}

function readCampaign(id) {
  try {
    const c = JSON.parse(fs.readFileSync(fileOf(id), 'utf8'))
    if (!c || c.id !== id) return null
    // campagne restée « running » sans processus (redémarrage du serveur) : affichée en erreur, sans réécriture
    if (c.status === 'running' && running?.id !== id) {
      return { ...c, status: 'error', error: 'Campagne interrompue (redémarrage du serveur).' }
    }
    return c
  } catch {
    return null
  }
}

function prune() {
  try {
    const ids = fs.readdirSync(CAMPAIGNS_DIR).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).filter((id) => ID_RE.test(id)).sort()
    for (const id of ids.slice(0, Math.max(0, ids.length - MAX_CAMPAIGNS))) fs.unlinkSync(fileOf(id))
  } catch { /* nettoyage facultatif */ }
}

function summaryOf(c) {
  return {
    id: c.id,
    at: c.at,
    finishedAt: c.finishedAt || null,
    simulated: Boolean(c.simulated),
    status: c.status,
    total: c.total || 0,
    passed: c.passed || 0,
    failed: c.failed || 0,
    skipped: c.skipped || 0,
    flaky: c.flaky || 0,
    durationMs: c.durationMs || 0,
    env: c.env?.baseUrl || '',
    browser: c.env?.browser || '',
    by: c.by || '',
  }
}

function countTests(c) {
  const n = (s) => c.tests.filter((t) => t.status === s).length
  c.total = c.tests.length
  c.passed = n('passed')
  c.failed = n('failed')
  c.skipped = n('skipped')
  c.flaky = n('flaky')
}

/** Valeur BASE_URL du fichier .env du projet de test (affichage seulement). */
function envFileBaseUrl() {
  try {
    const m = /^\s*BASE_URL\s*=\s*["']?([^"'\r\n]+)/m.exec(fs.readFileSync(path.join(REPO_ROOT, '.env'), 'utf8'))
    return m ? m[1].trim() : ''
  } catch {
    return ''
  }
}

const isDemoData = () => {
  try { return getScanInfo()?.source === 'demo' } catch { return false }
}

// ------------------------------------------------------------------ specs

/** Specs Playwright du projet de test (récursif, sans node_modules). */
export function listSpecFiles() {
  const out = []
  const walk = (dir, depth) => {
    if (depth > 6) return
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue
      const abs = path.join(dir, e.name)
      if (e.isDirectory()) walk(abs, depth + 1)
      else if (/\.(spec|test)\.(ts|js|mjs)$/.test(e.name)) {
        let text = ''
        try { text = fs.readFileSync(abs, 'utf8') } catch { /* illisible */ }
        const header = /à partir du récit ([A-Z][A-Z0-9_]*-\d+)/.exec(text)
        const fromName = KEY_RE.exec(e.name)
        out.push({
          relPath: path.relative(REPO_ROOT, abs).replace(/\\/g, '/'),
          storyKey: fromName ? fromName[0] : header ? header[1] : null,
          tests: (text.match(/\btest(?:\.only|\.fixme|\.skip)?\s*\(\s*['"`]/g) || []).length,
        })
      }
    }
  }
  walk(TESTS_DIR, 0)
  return out.sort((a, b) => a.relPath.localeCompare(b.relPath))
}

// ------------------------------------------------------------------ lecture

export function listCampaigns({ full = false } = {}) {
  let ids = []
  try {
    ids = fs.readdirSync(CAMPAIGNS_DIR).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).filter((id) => ID_RE.test(id))
  } catch {
    ids = []
  }
  const list = ids.map(readCampaign).filter(Boolean).sort((a, b) => String(b.at).localeCompare(String(a.at)))
  return full ? list : list.map(summaryOf)
}

export function getCampaign(id) {
  if (!ID_RE.test(String(id || ''))) return null
  if (running?.id === id) return running
  return readCampaign(id)
}

export function runningCampaign() {
  return running
}

// ------------------------------------------------------------------ lancement

/**
 * Lance une campagne (réelle ou simulée). Une seule à la fois : si une campagne tourne déjà, elle est renvoyée
 * avec `alreadyRunning: true`. Sans Playwright installé dans le projet, la campagne est simulée (`simulatedReason`).
 */
export function startCampaign({ simulate = false, user = '', baseUrl = '', browser = '' } = {}) {
  if (running) return { ...running, alreadyRunning: true }
  const cli = path.join(REPO_ROOT, 'node_modules', '@playwright', 'test', 'cli.js')
  let simulatedReason = ''
  if (!simulate && !fs.existsSync(cli)) {
    simulate = true
    simulatedReason = 'Playwright n\'est pas installé dans le projet de test : campagne simulée.'
  }
  const fromEnv = envFileBaseUrl()
  const url = String(baseUrl || '').trim() || fromEnv || (isDemoData() ? demoBaseUrl() : '')
  const c = {
    id: newId(),
    at: new Date().toISOString(),
    finishedAt: null,
    simulated: Boolean(simulate),
    simulatedReason,
    status: 'running',
    env: { baseUrl: url, browser: String(browser || '').trim() || 'chromium' },
    durationMs: 0,
    total: 0, passed: 0, failed: 0, skipped: 0, flaky: 0,
    tests: [],
    by: String(user || ''),
    error: '',
  }
  fs.mkdirSync(CAMPAIGNS_DIR, { recursive: true })
  save(c)
  running = c
  const job = simulate ? runSimulation(c) : runPlaywright(c, cli, { overrideBaseUrl: url && url !== fromEnv ? url : '' })
  job.catch((e) => {
    c.status = 'error'
    c.error = shortError(e?.message || String(e))
  }).finally(() => {
    c.finishedAt = new Date().toISOString()
    c.durationMs = c.durationMs || Date.parse(c.finishedAt) - Date.parse(c.at)
    try { save(c) } catch (e) { console.error('[livrables] enregistrement de la campagne :', e.message) }
    running = null
    prune()
  })
  return c
}

// ------------------------------------------------------------------ exécution réelle

/** Projet « e2e » de la configuration Playwright (le projet « bdd » demande une génération préalable). */
function projectArgs() {
  for (const name of ['playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs']) {
    try {
      const text = fs.readFileSync(path.join(REPO_ROOT, name), 'utf8')
      return /name:\s*['"]e2e['"]/.test(text) ? ['--project=e2e'] : []
    } catch { /* fichier suivant */ }
  }
  return []
}

/** Arrête le processus et ses enfants (navigateurs) ; sous Windows, taskkill /T. */
function killTree(child) {
  if (!child || child.exitCode !== null) return
  if (process.platform === 'win32') {
    try { spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }) } catch { child.kill() }
  } else {
    child.kill('SIGKILL')
  }
}

function runPlaywright(c, cli, { overrideBaseUrl }) {
  const reportFile = path.join(CAMPAIGNS_DIR, `${c.id}.report.tmp.json`)
  const env = { ...process.env, PLAYWRIGHT_JSON_OUTPUT_FILE: reportFile, PLAYWRIGHT_JSON_OUTPUT_NAME: reportFile, FORCE_COLOR: '0' }
  if (overrideBaseUrl) env.BASE_URL = overrideBaseUrl
  const args = [cli, 'test', '--reporter=json', ...projectArgs()]
  return new Promise((resolve) => {
    const started = Date.now()
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const child = spawn(process.execPath, args, { cwd: REPO_ROOT, env, shell: false, windowsHide: true })
    const timer = setTimeout(() => { timedOut = true; killTree(child) }, TIMEOUT_MS)
    child.stdout.on('data', (d) => { if (stdout.length < 20 * 1024 * 1024) stdout += d })
    child.stderr.on('data', (d) => { if (stderr.length < 64 * 1024) stderr += d })
    const finish = (code, spawnError) => {
      clearTimeout(timer)
      c.durationMs = Date.now() - started
      let raw = ''
      try { raw = fs.readFileSync(reportFile, 'utf8') } catch { raw = stdout }
      try { fs.unlinkSync(reportFile) } catch { /* absent */ }
      let report = null
      try { report = JSON.parse(raw) } catch { report = null }
      if (report) applyReport(c, report)
      if (spawnError) {
        c.status = 'error'
        c.error = shortError(`Lancement de Playwright impossible : ${spawnError.message}`)
      } else if (timedOut) {
        c.status = 'error'
        c.error = 'Délai dépassé (15 min) : campagne arrêtée.'
      } else if (!report) {
        c.status = 'error'
        c.error = shortError(stderr || stdout || `Playwright s'est arrêté (code ${code}) sans rapport JSON.`)
      } else if (!c.tests.length) {
        c.status = 'error'
        c.error = c.error || 'Aucun test exécuté (aucun spec trouvé ou configuration invalide).'
      } else {
        c.status = 'done'
      }
      resolve()
    }
    child.on('error', (e) => finish(null, e))
    child.on('close', (code) => finish(code, null))
  })
}

/** Rapport JSON de Playwright → tests de la campagne. */
function applyReport(c, report) {
  const projectDirs = new Map((report.config?.projects || []).map((p) => [p.name, p.testDir]))
  const rootDir = report.config?.rootDir || REPO_ROOT
  const tests = []
  const walk = (suite, titles) => {
    const here = suite.title && !/\.(spec|test)\.(ts|js|mjs)$/.test(suite.title) ? [...titles, suite.title] : titles
    for (const spec of suite.specs || []) {
      for (const t of spec.tests || []) {
        const results = t.results || []
        const last = results[results.length - 1] || {}
        // spec.file est relatif au rootDir de la configuration ; repli sur le testDir du projet
        const rel = spec.file || suite.file || ''
        let abs = path.resolve(rootDir, rel)
        if (!fs.existsSync(abs) && projectDirs.get(t.projectName)) abs = path.resolve(projectDirs.get(t.projectName), rel)
        const file = path.relative(REPO_ROOT, abs).replace(/\\/g, '/')
        let status = 'passed'
        if (t.status === 'unexpected') status = 'failed'
        else if (t.status === 'flaky') status = 'flaky'
        else if (t.status === 'skipped' || last.status === 'skipped') status = 'skipped'
        const err = [...results].reverse().find((r) => r.error || (r.errors || []).length)
        const message = err ? (err.error?.message || err.errors?.[0]?.message || '') : ''
        tests.push({
          title: [...here, spec.title].join(' › '),
          file,
          storyKey: storyKeyOf([...here, spec.title], file),
          status,
          durationMs: results.reduce((s, r) => s + (r.duration || 0), 0),
          retries: Math.max(0, results.length - 1),
          error: status === 'failed' || status === 'flaky' ? shortError(message) : '',
        })
      }
    }
    for (const s of suite.suites || []) walk(s, here)
  }
  for (const s of report.suites || []) walk(s, [])
  c.tests = tests
  countTests(c)
  if (report.stats?.duration) c.durationMs = Math.round(report.stats.duration)
  if ((report.errors || []).length) c.error = shortError(report.errors.map((e) => e.message || '').join('\n'))
}

// ------------------------------------------------------------------ simulation

const SIM_ERRORS = [
  'Error: expect(locator).toBeVisible() failed — Locator: getByRole(\'button\', { name: \'Exporter en PDF\' }) — Expected: visible — Received: <element(s) not found> — Timeout: 5000ms',
  'TimeoutError: page.waitForURL: Timeout 15000ms exceeded. — waiting for navigation to "**/tableau-de-bord.html" until "load"',
  'Error: expect(locator).toHaveText(expected) failed — Locator: getByRole(\'status\') — Expected: "Risque enregistré" — Received: "Erreur 500 : le service de cotation ne répond pas"',
  'Error: expect(locator).toHaveCount(expected) failed — Locator: locator(\'table tbody tr\') — Expected: 12 — Received: 11 — Timeout: 5000ms',
]

/** Noms des scénarios d'un texte Gherkin. */
function scenarioNames(text) {
  return [...String(text || '').matchAll(/^\s*(?:Scénario|Scenario|Plan du scénario|Scenario Outline)\s*:\s*(.+)$/gim)].map((m) => m[1].trim())
}

/** Tests plausibles : un par scénario Gherkin, sinon par critère d'acceptation (4 au plus), sinon un parcours nominal. */
function simulatedTests() {
  const triage = getTriage()
  const gherkin = getGherkinIndex()
  const specs = listSpecFiles()
  const keys = new Set()
  for (const [k, d] of Object.entries(triage)) if (d.decision === 'todo') keys.add(k)
  for (const [k, g] of Object.entries(gherkin)) if (g.status === 'validated') keys.add(k)
  for (const s of specs) if (s.storyKey) keys.add(s.storyKey)
  const tests = []
  for (const key of [...keys].sort()) {
    const story = getStory(key)
    const spec = specs.find((s) => s.storyKey === key)
    const file = spec?.relPath || `tests/e2e/${key}.spec.ts`
    let names = scenarioNames(readEntry(key)?.text)
    if (!names.length) {
      names = (story?.acceptanceCriteria || []).slice(0, 4).map((a) => String(a).replace(/\s+/g, ' ')
        .replace(/^Sc[ée]nario\s*:\s*/i, '').split(/\s(?:Étant donné|Etant donné|Given|Quand|When)\s/)[0].trim().slice(0, 90))
    }
    if (!names.length) names = [`Parcours nominal — ${story?.summary || key}`]
    for (const n of names) tests.push({ title: `${n} @${key}`, file, storyKey: key })
  }
  // specs sans récit : un test par spec
  for (const s of specs) if (!s.storyKey) tests.push({ title: path.basename(s.relPath).replace(/\.(spec|test)\.\w+$/, ''), file: s.relPath, storyKey: null })
  return tests
}

function runSimulation(c) {
  const base = simulatedTests()
  if (!base.length) {
    c.status = 'error'
    c.error = 'Rien à simuler : triez des récits « À automatiser », validez des scénarios Gherkin ou ajoutez des specs.'
    return Promise.resolve()
  }
  // ~85 % de réussite : 1 à 2 échecs choisis de façon déterministe (plus petits hachages), 1 test ignoré au-delà de 10 tests.
  const ranked = base.map((t) => ({ t, h: hashNum(`${t.storyKey}|${t.title}`) })).sort((a, b) => a.h - b.h)
  const nFail = base.length >= 8 ? 2 : base.length >= 2 ? 1 : 0
  const failed = new Set(ranked.slice(0, nFail).map((r) => r.t))
  const skipped = new Set(base.length > 10 ? [ranked[ranked.length - 1].t] : [])
  c.tests = base.map((t) => {
    const h = hashNum(t.title)
    const status = failed.has(t) ? 'failed' : skipped.has(t) ? 'skipped' : 'passed'
    return {
      ...t,
      status,
      durationMs: status === 'skipped' ? 0 : 800 + (h % 8200),
      retries: 0,
      error: status === 'failed' ? SIM_ERRORS[h % SIM_ERRORS.length] : '',
    }
  })
  countTests(c)
  return new Promise((resolve) => setTimeout(() => {
    c.durationMs = c.tests.reduce((s, t) => s + t.durationMs, 0)
    c.status = 'done'
    resolve()
  }, 1200))
}

// ------------------------------------------------------------------ anomalies

function severityOf(story, error, occurrences) {
  const prio = String(story?.priority || '').toLowerCase()
  if (/critique|bloquant|blocker|critical|highest/.test(prio) || /erreur 500|crash/i.test(error)) return 'bloquante'
  if (/haute|high|majeure/.test(prio) || occurrences >= 2) return 'majeure'
  return 'mineure'
}

/**
 * Anomalies dérivées des échecs des campagnes terminées, regroupées par test (fichier + titre).
 * Une anomalie est « corrigée » quand le test réussit dans une campagne postérieure à son dernier échec.
 */
export function deriveDefects(campaigns = []) {
  const done = (campaigns || []).filter((c) => c && c.status === 'done' && Array.isArray(c.tests))
    .sort((a, b) => String(a.at).localeCompare(String(b.at)))
  const byTest = new Map()
  for (const c of done) {
    for (const t of c.tests) {
      const id = `${t.file}::${t.title}`
      const d = byTest.get(id)
      if (t.status === 'failed') {
        if (d) {
          d.lastSeen = c.at
          d.occurrences += 1
          d.error = t.error || d.error
          d.status = 'ouverte'
          d.simulated = d.simulated && Boolean(c.simulated)
        } else {
          byTest.set(id, { testTitle: t.title, file: t.file, storyKey: t.storyKey || null, firstSeen: c.at, lastSeen: c.at, occurrences: 1, error: t.error || '', status: 'ouverte', simulated: Boolean(c.simulated) })
        }
      } else if (d && (t.status === 'passed' || t.status === 'flaky')) {
        d.status = 'corrigée'
      }
    }
  }
  const list = [...byTest.values()].sort((a, b) => String(a.firstSeen).localeCompare(String(b.firstSeen)) || a.testTitle.localeCompare(b.testTitle))
  return list.map((d, i) => {
    let story = null
    try { story = d.storyKey ? getStory(d.storyKey) : null } catch { story = null }
    const cause = d.error.split(' — ')[0].replace(/^(Error|TimeoutError):\s*/, '').slice(0, 90)
    return {
      id: `ANO-${String(i + 1).padStart(3, '0')}`,
      title: `${d.testTitle.replace(/\s*@[A-Z][A-Z0-9_]*-\d+/g, '')}${cause ? ` : ${cause}` : ''}`,
      storyKey: d.storyKey,
      testTitle: d.testTitle,
      file: d.file,
      firstSeen: d.firstSeen,
      lastSeen: d.lastSeen,
      occurrences: d.occurrences,
      error: d.error,
      severity: severityOf(story, d.error, d.occurrences),
      status: d.status,
      simulated: d.simulated,
    }
  })
}

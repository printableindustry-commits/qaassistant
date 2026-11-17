/**
 * Faits collectés pour les livrables ISTQB (contrat V3.2 §6.2).
 *
 *   collectFacts() → Facts   (synchrone, lecture seule ; un module en panne = fait absent + entrée dans `gaps`)
 *
 * Les chiffres et listes des documents viennent uniquement d'ici. `hash` (sha256) couvre tout le contenu sauf
 * `generatedAt` et `tools.llm` (la disponibilité de l'assistant IA varie sans changer les données de test).
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { REPO_ROOT, SERVER_CONF_DIR, CONF_DIR } from '../paths.mjs'
import { listStories, getScanInfo, getScanDetails } from '../jira/stories.mjs'
import { getTriage, suggestTriage } from '../jira/triage.mjs'
import { reviewStory } from '../jira/review.mjs'
import { getGherkinIndex, readEntry } from '../gherkin/store.mjs'
import { listSessions, flattenSteps } from '../explore/sessions.mjs'
import { listTargets } from '../explore/targets.mjs'
import { listPushed } from '../xray/history.mjs'
import { listMetas } from '../perf/store.mjs'
import { k6StateSync, detectK6 } from '../perf/k6-binary.mjs'
import { getLlmStatus } from '../llm/index.mjs'
import { listCampaigns, listSpecFiles, deriveDefects } from './campaigns.mjs'

const day = (iso) => String(iso || '').slice(0, 10)
const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0)

/** Exécute une lecture ; en cas d'échec, note la panne dans `gaps` et renvoie la valeur de repli. */
function safe(gaps, label, fn, fallback) {
  try {
    return fn()
  } catch (e) {
    gaps.push({ kind: 'module', message: `${label} illisible : ${e.message}` })
    return fallback
  }
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

function riskOf(story, decision, gherkinStatus) {
  const score = suggestTriage(story, { gherkin: gherkinStatus ? { status: gherkinStatus } : null }).score
  const prio = String(story.priority || '').toLowerCase()
  let level = score >= 60 ? 'élevé' : score >= 35 ? 'moyen' : 'faible'
  if (/critique|bloquant|blocker|critical|highest/.test(prio)) level = 'élevé'
  else if (level === 'faible' && decision === 'todo') level = 'moyen'
  return { score, level }
}

function lastResultOf(tests) {
  if (!tests.length) return 'not-run'
  if (tests.some((t) => t.status === 'failed')) return 'failed'
  if (tests.some((t) => t.status === 'passed' || t.status === 'flaky')) return 'passed'
  return 'skipped'
}

/** Clé de hachage stable : tri des clés d'objet. */
function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((o, k) => { o[k] = stable(value[k]); return o }, {})
  }
  return value
}

export function collectFacts() {
  const gaps = []
  const sources = {}

  // ---------- projet (dernier scan JIRA)
  const scan = safe(gaps, 'Scan JIRA', () => getScanInfo(), null)
  const details = safe(gaps, 'Scan JIRA', () => getScanDetails(), null)
  const demo = scan?.source === 'demo'
  let projectName = ''
  if (demo) projectName = readJson(path.join(SERVER_CONF_DIR, 'demo', 'irma-jira.json'))?.project?.name || ''
  const project = {
    key: scan?.projectKey || '',
    name: projectName,
    jiraBaseUrl: scan?.baseUrl || '',
    scanAt: scan?.scannedAt || null,
    scanMode: scan?.source || null,
  }
  const scanSource = scan ? `${demo ? 'jira-demo' : 'jira'}:scan ${day(scan.scannedAt)}` : ''
  if (!scan) gaps.push({ kind: 'no-scan', message: 'Aucun scan JIRA : lancez la prise de connaissance (page Récits) pour alimenter les documents.' })
  else sources.project = scanSource

  // ---------- outils
  const pwPkg = readJson(path.join(REPO_ROOT, 'node_modules', '@playwright', 'test', 'package.json'))
  let k6 = safe(gaps, 'Détection k6', () => k6StateSync(), null)
  if (!k6) detectK6().catch(() => {}) // préchauffe le cache pour la prochaine collecte
  const xraySaved = readJson(path.join(CONF_DIR, 'xray.json')) || {}
  const llm = safe(gaps, 'Assistant IA', () => getLlmStatus(), null)
  const targets = safe(gaps, 'Cibles d\'exploration', () => listTargets(), [])
  const tools = {
    playwright: pwPkg?.version ? { version: pwPkg.version } : null,
    k6: k6?.installed ? { version: k6.version } : null,
    xray: { mode: xraySaved.mode || 'auto', configured: Boolean(xraySaved.clientId && xraySaved.clientSecret) || xraySaved.mode === 'server' },
    llm: llm?.active ? { provider: llm.active.label || llm.active.id } : null,
    browsers: [...new Set(targets.map((t) => t.browser).filter(Boolean))].sort(),
  }
  if (tools.playwright) sources['tools.playwright'] = 'node_modules/@playwright/test'

  // ---------- données de base
  const stories0 = safe(gaps, 'Récits JIRA', () => listStories(), [])
  const triageMap = safe(gaps, 'Tri des récits', () => getTriage(), {})
  const gIndex = safe(gaps, 'Scénarios Gherkin', () => getGherkinIndex(), {})
  const sessions = safe(gaps, 'Sessions d\'exploration', () => listSessions(), [])
  const pushed = safe(gaps, 'Historique Xray', () => listPushed(), [])
  const specs = safe(gaps, 'Specs Playwright', () => listSpecFiles(), [])
  const campaignsFull = safe(gaps, 'Campagnes d\'exécution', () => listCampaigns({ full: true }), [])
  const finished = campaignsFull.filter((c) => c.status !== 'running')
  const lastCampaign = finished.find((c) => c.status === 'done') || finished[0] || null
  const lastTests = lastCampaign?.status === 'done' ? lastCampaign.tests || [] : []

  // ---------- récits
  const stories = stories0.map((s) => {
    const t = triageMap[s.key] || null
    const g = gIndex[s.key] || null
    const entry = g ? safe(gaps, `Gherkin ${s.key}`, () => readEntry(s.key), null) : null
    const review = safe(gaps, `Relecture ${s.key}`, () => reviewStory(s), { toClarify: false })
    return {
      key: s.key,
      summary: s.summary,
      epicKey: s.epic?.key || null,
      epicSummary: s.epic?.summary || '',
      status: s.status,
      priority: s.priority,
      criteriaCount: (s.acceptanceCriteria || []).length,
      toClarify: Boolean(review.toClarify),
      triage: t?.decision || null,
      triageReason: t?.reason || '',
      risk: safe(gaps, `Risque ${s.key}`, () => riskOf(s, t?.decision, g?.status), { score: 0, level: 'faible' }),
      gherkin: {
        status: g ? g.status : 'none',
        scenarios: g?.scenarios || 0,
        exportedPath: g?.exported ? entry?.exportedPath || '' : '',
      },
      automation: sessions.filter((r) => r.storyKey === s.key).map((r) => ({
        sessionId: r.id,
        status: r.status,
        relPath: r.relPath || '',
        steps: flattenSteps(r).length,
        validated: r.status === 'validated',
        target: r.target?.name || '',
      })),
      xray: pushed.filter((p) => p.storyKey === s.key).map((p) => ({
        testKey: p.testKey || '', testUrl: p.testUrl || '', simulated: Boolean(p.simulated), planKey: p.planKey || '', at: p.updatedAt || p.pushedAt,
      })),
      lastResult: lastResultOf(lastTests.filter((x) => x.storyKey === s.key)),
    }
  })
  if (stories.length) sources.stories = scanSource
  if (Object.keys(triageMap).length) sources['stories.triage'] = 'jira:triage'
  if (Object.keys(gIndex).length) sources.gherkin = 'gherkin'

  // ---------- épopées et tri
  const epics = (details?.epics || []).map((e) => ({ key: e.key, summary: e.summary, stories: stories.filter((s) => s.epicKey === e.key).length }))
  const triage = { todo: 0, later: 0, skip: 0, untriaged: 0 }
  for (const s of stories) triage[s.triage || 'untriaged'] += 1

  const gEntries = Object.values(gIndex)
  const gherkin = {
    total: gEntries.length,
    validated: gEntries.filter((g) => g.status === 'validated').length,
    draft: gEntries.filter((g) => g.status === 'draft').length,
    scenarios: gEntries.reduce((n, g) => n + (g.scenarios || 0), 0),
    exported: gEntries.filter((g) => g.exported).length,
  }

  const automation = {
    specs: specs.map((s) => ({ relPath: s.relPath, storyKey: s.storyKey, tests: s.tests })),
    sessions: {
      total: sessions.length,
      validated: sessions.filter((r) => r.status === 'validated').length,
      needsHuman: sessions.filter((r) => r.status === 'needs-human').length,
    },
    targets: targets.map((t) => ({ id: t.id, name: t.name, baseUrl: t.baseUrl, browser: t.browser, accounts: (t.accounts || []).length })),
  }
  if (specs.length) sources['automation.specs'] = 'tests (specs Playwright)'
  if (sessions.length) sources['automation.sessions'] = 'explore:sessions'
  sources['automation.targets'] = 'explore:targets'

  // ---------- campagnes et anomalies
  const campaigns = finished.map((c) => ({
    id: c.id, at: c.at, simulated: Boolean(c.simulated), total: c.total || 0, passed: c.passed || 0, failed: c.failed || 0,
    skipped: c.skipped || 0, durationMs: c.durationMs || 0, env: c.env?.baseUrl || '', browser: c.env?.browser || '',
  }))
  const defects = safe(gaps, 'Anomalies', () => deriveDefects(campaignsFull), [])
  if (campaigns.length) sources.campaigns = `playwright:campaigns (${campaigns.length})`
  if (lastCampaign) sources.lastCampaign = `${lastCampaign.simulated ? 'simulation' : 'playwright'}:campaign ${lastCampaign.id}`
  if (defects.length) sources.defects = 'dérivé des échecs des campagnes'

  // ---------- performance, Xray
  const metas = safe(gaps, 'Runs de performance', () => listMetas().filter((m) => m.status !== 'running'), [])
  const lastRun = metas[0] || null
  const perf = {
    runs: metas.length,
    last: lastRun
      ? { id: lastRun.id, profile: lastRun.profileName || '', verdict: lastRun.status, p95: lastRun.metrics?.p95 ?? null, errorRate: lastRun.metrics?.errorRate ?? null, at: lastRun.finishedAt || lastRun.startedAt }
      : null,
  }
  if (lastRun) sources.perf = `k6:run ${lastRun.id}${lastRun.simulated ? ' (simulé)' : ''}`
  const xray = {
    pushed: pushed.filter((p) => !p.simulated).length,
    simulated: pushed.filter((p) => p.simulated).length,
    plans: [...new Set(pushed.map((p) => p.planKey).filter(Boolean))].sort(),
  }
  if (pushed.length) sources.xray = 'xray:historique des envois'

  // ---------- couverture
  const specKeys = new Set(specs.map((s) => s.storyKey).filter(Boolean))
  const isAutomated = (s) => specKeys.has(s.key) || s.automation.some((a) => a.validated)
  const executed = stories.filter((s) => s.lastResult !== 'not-run')
  const automated = stories.filter(isAutomated)
  const coverage = {
    stories: stories.length,
    withCriteria: stories.filter((s) => s.criteriaCount > 0).length,
    withGherkin: stories.filter((s) => s.gherkin.status !== 'none').length,
    automated: automated.length,
    executed: executed.length,
    passed: executed.filter((s) => s.lastResult === 'passed').length,
    pctAutomated: pct(automated.length, stories.length),
    pctPassed: pct(executed.filter((s) => s.lastResult === 'passed').length, executed.length), // sur les récits exécutés
  }
  sources.coverage = 'calculé (récits, specs, sessions, dernière campagne)'

  // ---------- écarts
  for (const s of stories.filter((x) => x.triage === 'todo')) {
    if (!isAutomated(s)) gaps.push({ kind: 'todo-without-test', storyKey: s.key, message: `${s.key} est « À automatiser » mais n'a aucun test automatisé.` })
    if (s.criteriaCount && s.gherkin.status === 'none') gaps.push({ kind: 'criteria-without-scenario', storyKey: s.key, message: `${s.key} a ${s.criteriaCount} critère(s) d'acceptation sans scénario Gherkin.` })
    if (s.toClarify) gaps.push({ kind: 'to-clarify', storyKey: s.key, message: `${s.key} est à clarifier avec le PO avant d'être testé.` })
  }
  const storyKeys = new Set(stories.map((s) => s.key))
  for (const sp of specs) {
    if (!sp.storyKey || (stories.length && !storyKeys.has(sp.storyKey))) {
      gaps.push({ kind: 'test-without-story', message: `Le spec ${sp.relPath} n'est rattaché à aucun récit connu.` })
    }
  }
  if (!campaigns.length) gaps.push({ kind: 'no-campaign', message: 'Aucune campagne d\'exécution : lancez-en une (réelle ou simulée) pour alimenter le journal et les anomalies.' })

  const facts = {
    generatedAt: new Date().toISOString(),
    hash: '',
    demo,
    project,
    tools,
    stories,
    epics,
    triage,
    gherkin,
    automation,
    campaigns,
    lastCampaign,
    defects,
    perf,
    xray,
    coverage,
    gaps,
    sources,
  }
  const { generatedAt, hash, ...content } = facts
  const forHash = { ...content, tools: { ...content.tools, llm: null } }
  facts.hash = crypto.createHash('sha256').update(JSON.stringify(stable(forHash))).digest('hex')
  return facts
}

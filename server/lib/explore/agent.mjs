/**
 * Agent d'exploration (docs/V3-ARCHITECTURE.md §5.2) : dialogue avec l'IA, exploration autonome étape par étape,
 * prise de main du testeur (enregistrement), génération du code, rejeu et validation.
 *
 * Sécurité :
 *  - l'IA ne reçoit que des marqueurs {{account:<id>:username|password}} ; les mots de passe ne passent que dans le
 *    message d'initialisation du moteur navigateur et dans tests/.auth/accounts.local.json (0o600, ignoré par Git) ;
 *  - le contenu des pages est transmis à l'IA comme donnée non fiable, la réponse est validée (liste blanche) ;
 *  - tout ce qui est diffusé ou écrit passe par l'expurgation de sessions.mjs.
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { REPO_ROOT } from '../paths.mjs'
import { complete, getLlmStatus } from '../llm/index.mjs'
import { getStory } from '../jira/stories.mjs'
import { readEntry } from '../gherkin/store.mjs'
import { engineStatus, openBrowser } from './engine.mjs'
import { buildPlaywrightSpec, buildAccountsFixture, stepsFromRecording } from './codegen.mjs'
import { bestCandidate, STRATEGY_ORDER, selectorCode } from './selectors.mjs'
import * as S from './sessions.mjs'
import * as PL from './plan.mjs'
import { getTarget, secretsFor } from './targets.mjs'

export class AgentError extends Error {
  constructor(status, message, details) {
    super(message)
    this.status = status
    this.details = details
  }
}

const IDLE_CLOSE_MS = 20 * 60 * 1000
const STEP_ACTIONS = ['goto', 'click', 'fill', 'select', 'check', 'uncheck', 'press', 'hover', 'expect']
const EXPECT_KINDS = ['visible', 'hidden', 'text', 'url', 'value']
const MARKER_RE = /\{\{([^{}]+)\}\}/g
const VIEWPORT = { width: 1280, height: 800 }

// ---------- Contexte ----------
function targetFor(rec) {
  const t = getTarget(rec.target?.id, { withSecrets: true })
  if (!t) throw new AgentError(409, `L'application « ${rec.target?.name || rec.target?.id} » n'existe plus : créez une nouvelle session.`)
  if (rec.target.baseUrl !== t.baseUrl || rec.target.name !== t.name) rec.target = { id: t.id, name: t.name, baseUrl: t.baseUrl }
  // mots de passe connus de la cible : expurgés de tout ce qui est écrit, diffusé ou envoyé à l'IA (même saisis dans le chat)
  S.setSessionSecrets(rec.id, secretsFor(t, (t.accounts || []).map((a) => a.id)))
  return t
}

/** Remplace tout mot de passe connu de la cible par son marqueur avant un envoi à l'IA (filet de sécurité). */
async function safeComplete(rec, req) {
  const { signal, ...rest } = req
  return complete({ ...S.redact(rec.id, rest), ...(signal ? { signal } : {}) })
}

function accountsOf(rec, target) {
  const ids = new Set(rec.accountIds || [])
  return (target.accounts || []).filter((a) => ids.has(a.id)).map((a) => ({ id: a.id, label: a.label, notes: a.notes || '' }))
}

function storyOf(rec) {
  return getStory(rec.storyKey) || { key: rec.storyKey, summary: rec.storySummary || '', acceptanceCriteria: [], descriptionText: '' }
}

function gherkinOf(key) {
  const e = readEntry(key)
  return e && typeof e.text === 'string' ? e.text : ''
}

export function llmAvailable() {
  try { return Boolean(getLlmStatus().active) } catch { return false }
}

function log(rec, text, level = 'info') {
  S.emit(rec, 'log', { text: String(text), level, at: new Date().toISOString() })
}

function setStatus(rec, status, reason = '') {
  rec.status = status
  rec.statusReason = reason
  S.saveSession(rec)
  S.emit(rec, 'status', { status, label: S.STATUS_LABEL[status], reason })
}

function emitStep(rec, data) {
  S.emit(rec, 'step', { at: new Date().toISOString(), ...data })
}

function emitPlan(rec) {
  S.emit(rec, 'plan', { plan: rec.plan })
}

function nextStepId(rec) {
  rec.stepSeq = (rec.stepSeq || 0) + 1
  return `t${rec.stepSeq}`
}

function stepsHash(rec) {
  return crypto.createHash('sha1').update(JSON.stringify((rec.scenarios || []).map((sc) => sc.steps.map((st) => [st.action, st.selector, st.value, st.secret, st.url, st.expect])))).digest('hex')
}

// ---------- Code généré ----------
export function regenCode(rec) {
  let target
  try { target = targetFor(rec) } catch { target = { name: rec.target?.name, baseUrl: rec.target?.baseUrl, accounts: [] } }
  const accounts = (target.accounts || []).filter((a) => (rec.accountIds || []).includes(a.id))
  const story = storyOf(rec)
  const scenarios = (rec.scenarios || []).filter((sc) => sc.steps && sc.steps.length)
  const { code, relPath } = buildPlaywrightSpec({
    story: { key: rec.storyKey, summary: story.summary || rec.storySummary || '' },
    target: { name: target.name, baseUrl: target.baseUrl },
    accounts, // mots de passe transmis uniquement pour le filet de sécurité du générateur
    scenarios: scenarios.map((sc) => ({ name: sc.name, steps: sc.steps })),
  })
  rec.code = code
  rec.relPath = relPath
  S.saveSession(rec)
  S.emit(rec, 'code', { code, relPath, scenarios: rec.scenarios })
  return { code, relPath }
}

/** Synchronise les scénarios du test avec ceux du plan (mêmes identifiants, étapes orphelines retirées). */
function syncScenarios(rec) {
  const planIds = new Set(rec.plan.scenarios.flatMap((sc) => sc.steps.map((st) => st.id)))
  const prev = new Map((rec.scenarios || []).map((sc) => [sc.planScenarioId, sc]))
  rec.scenarios = rec.plan.scenarios.map((psc) => {
    const old = prev.get(psc.id)
    const steps = (old?.steps || []).filter((st) => !st.planStepId || planIds.has(st.planStepId))
    return { planScenarioId: psc.id, name: psc.name, steps }
  })
}

/** Insère les étapes d'une étape du plan à sa place (après celles des étapes précédentes du plan). */
function putSteps(rec, si, planStepId, steps) {
  syncScenarios(rec)
  const psc = rec.plan.scenarios[si]
  const sc = rec.scenarios[si]
  const order = new Map(psc.steps.map((st, i) => [st.id, i]))
  const k = order.get(planStepId) ?? 0
  sc.steps = sc.steps.filter((st) => st.planStepId !== planStepId)
  let at = 0
  sc.steps.forEach((st, i) => {
    const o = order.get(st.planStepId)
    if (o == null || o < k) at = i + 1
  })
  const planStep = psc.steps[k]
  const built = steps.map((st) => ({
    id: nextStepId(rec),
    planStepId,
    gherkin: st.gherkin ?? (planStep ? planStep.gherkin || planStep.goal : null),
    ...st,
  }))
  sc.steps.splice(at, 0, ...built)
  return built
}

// ---------- Navigateur ----------
function touch(rec) {
  const rt = S.runtimeOf(rec.id)
  if (rt.idleTimer) clearTimeout(rt.idleTimer)
  rt.idleTimer = setTimeout(() => {
    if (rt.browser && !rt.busy) {
      log(rec, 'Navigateur fermé après 20 minutes d\'inactivité.', 'warn')
      stopSession(rec, { reason: 'Inactivité prolongée.' }).catch(() => {})
    }
  }, IDLE_CLOSE_MS)
  rt.idleTimer.unref?.()
}

async function closeBrowser(rec) {
  const rt = S.runtimeOf(rec.id)
  const b = rt.browser
  rt.browser = null
  rt.stateKey = null
  if (b && !b.closed) {
    b.intentionalClose = true
    await b.close().catch(() => {})
  }
}

async function ensureBrowser(rec, opts = {}) {
  const rt = S.runtimeOf(rec.id)
  // ouvertures sérialisées : deux requêtes simultanées ne doivent pas lancer deux navigateurs (le premier serait orphelin)
  while (rt.opening) {
    try { await rt.opening } catch { /* l'appel suivant réessaie */ }
  }
  const p = openBrowserFor(rec, rt, opts)
  rt.opening = p
  try {
    return await p
  } finally {
    if (rt.opening === p) rt.opening = null
  }
}

async function openBrowserFor(rec, rt, { headless } = {}) {
  const wantHeadless = headless ?? rec.headless !== false
  if (rt.browser && !rt.browser.closed) {
    if (headless === undefined || rt.browserHeadless === wantHeadless) return rt.browser
    await closeBrowser(rec)
  }
  const status = engineStatus()
  if (!status.available) throw new AgentError(409, status.reason || 'Moteur Playwright indisponible : installez la stack Playwright depuis la page Installation.')
  const target = targetFor(rec)
  const secrets = secretsFor(target, rec.accountIds)
  const gen = rt.stopGen || 0
  log(rec, `Ouverture du navigateur (${rec.browser || target.browser || 'msedge'}${wantHeadless ? ', sans fenêtre' : ', fenêtre visible'})…`)
  const b = await openBrowser({
    browser: rec.browser || target.browser || 'msedge',
    headless: wantHeadless,
    baseUrl: target.baseUrl,
    allowedOrigins: target.allowedOrigins || [],
    secrets,
    viewport: VIEWPORT,
    onEvent: (type, data) => onEngineEvent(rec, b, type, data),
  }).catch((e) => { throw new AgentError(500, e.message) })
  if ((rt.stopGen || 0) !== gen) {
    // session arrêtée pendant l'ouverture : on ne laisse pas un navigateur sans propriétaire
    b.intentionalClose = true
    await b.close().catch(() => {})
    throw new AgentError(409, 'Session arrêtée pendant l\'ouverture du navigateur.')
  }
  rt.browser = b
  rt.browserHeadless = wantHeadless
  rt.stateKey = null
  touch(rec)
  return b
}

function onEngineEvent(rec, b, type, data) {
  const rt = S.runtimeOf(rec.id)
  if (b && rt.browser && rt.browser !== b) return // ancien navigateur
  switch (type) {
    case 'log':
      log(rec, typeof data === 'string' ? data : data?.text || '', data?.level || 'info')
      break
    case 'screenshot':
      if (data && data.dataUrl) S.emit(rec, 'screenshot', { dataUrl: data.dataUrl, size: data.size, scale: data.scale, url: data.url })
      break
    case 'navigated':
      if (data?.url && /^https?:/i.test(data.url)) rec.lastUrl = data.url
      break
    case 'recording':
      if (rec.status === 'recording') {
        rt.recording.push(data)
        S.emit(rec, 'recording', { event: publicRecEvent(data) })
      }
      break
    case 'blocked':
      log(rec, `Navigation bloquée vers ${data?.url || '?'} (origine non autorisée).`, 'warn')
      break
    case 'exit':
      if (rt.browser === b || !rt.browser) {
        rt.browser = null
        rt.stateKey = null
        if (!rt.closing && !b?.intentionalClose) log(rec, 'Le navigateur s\'est fermé.', 'warn')
      }
      break
    default:
      break
  }
}

function publicRecEvent(ev) {
  if (!ev) return null
  return {
    type: ev.type,
    selector: ev.selector ? { strategy: ev.selector.strategy, value: ev.selector.value, code: ev.selector.code } : null,
    value: ev.type === 'fill' || ev.type === 'select' ? ev.value : undefined,
    key: ev.key,
    url: ev.url,
    label: ev.element ? (ev.element.name || ev.element.label || ev.element.placeholder || ev.element.text || ev.element.tag || '') : '',
    at: ev.at,
  }
}

function selectorOfElement(el) {
  if (!el) return null
  const best = bestCandidate(el.candidates || [])
  if (!best) return null
  return { strategy: best.strategy, value: best.value, code: best.code, ...(best.exact ? { exact: true } : {}) }
}

async function snap(rec, b) {
  const s = await b.snapshot({ screenshot: true })
  if (!s || s.ok === false) return { ok: false, error: s?.error || 'Instantané de la page impossible.' }
  if (s.screenshot) S.emit(rec, 'screenshot', { dataUrl: s.screenshot, size: s.size, scale: s.scale, url: s.url })
  rec.lastUrl = s.url || rec.lastUrl
  return s
}

/** Exécute une étape du test (rejeu, restauration d'état). */
async function executeStep(b, step, baseUrl) {
  switch (step.action) {
    case 'goto': {
      let url
      try { url = new URL(step.url || step.value || '', baseUrl).toString() } catch { return { ok: false, error: 'Adresse invalide.' } }
      return b.goto(url)
    }
    case 'expect': {
      const ex = step.expect || {}
      return b.expect({ kind: ex.kind || 'visible', selector: step.selector || undefined, value: ex.value ?? step.value ?? undefined })
    }
    case 'press':
      if (!step.selector) return b.act({ action: 'press', value: step.value || 'Enter' })
      return b.act({ action: 'press', selector: step.selector, value: step.value || 'Enter' })
    default:
      if (!step.selector) return { ok: false, error: 'Sélecteur manquant : complétez l\'étape.' }
      return b.act({ action: step.action, selector: step.selector, value: step.value ?? undefined, secret: step.secret || undefined })
  }
}

/** Remet le navigateur dans l'état du scénario si (avant l'étape pi) en rejouant les étapes déjà construites. */
async function prepareScenario(rec, b, si, pi) {
  const rt = S.runtimeOf(rec.id)
  if (rt.stateKey === si) return { ok: true, replayed: 0, kept: true }
  const psc = rec.plan.scenarios[si]
  const before = new Set(psc.steps.slice(0, pi).map((st) => st.id))
  const steps = (rec.scenarios[si]?.steps || []).filter((st) => !st.planStepId || before.has(st.planStepId))
  rt.stateKey = si
  if (!steps.length) return { ok: true, replayed: 0 }
  log(rec, `Restauration de l'état du scénario « ${psc.name} » : ${steps.length} étape(s) rejouée(s).`)
  const baseUrl = targetFor(rec).baseUrl
  for (const st of steps) {
    const r = await executeStep(b, st, baseUrl)
    if (!r || r.ok === false) {
      log(rec, `Restauration interrompue (${PL.describeStepShort(st)}) : ${r?.error || 'échec'}`, 'warn')
      return { ok: false, error: r?.error, replayed: steps.length }
    }
  }
  return { ok: true, replayed: steps.length }
}

// ---------- Création ----------
export function initialPlan(rec) {
  const target = targetFor(rec)
  return PL.rulePlan({ story: storyOf(rec), gherkinText: gherkinOf(rec.storyKey), accounts: accountsOf(rec, target) })
}

// ---------- Conversation ----------
export async function chat(rec, { message, answer, reset }) {
  const rt = S.runtimeOf(rec.id)
  if (['exploring', 'recording', 'replaying'].includes(rec.status)) throw new AgentError(409, 'Impossible de modifier le plan pendant l\'exploration : arrêtez-la d\'abord.')
  const target = targetFor(rec)
  const accounts = accountsOf(rec, target)
  const story = storyOf(rec)
  const now = () => new Date().toISOString()
  if (reset) {
    rec.plan = PL.rulePlan({ story, gherkinText: gherkinOf(rec.storyKey), accounts })
    syncScenarios(rec)
    rec.chat.push({ role: 'assistant', content: 'Plan recalculé par règles à partir du Gherkin (ou des critères d\'acceptation).', at: now(), source: 'rule' })
    S.saveSession(rec)
    emitPlan(rec)
    return { reply: rec.chat[rec.chat.length - 1], plan: rec.plan }
  }
  if (answer != null) {
    const parsed = PL.parseChatAnswer(String(answer).slice(0, 60000))
    const msg = { role: 'assistant', content: parsed.text, at: now(), source: 'manual' }
    rec.chat.push(msg)
    if (parsed.plan) {
      rec.plan = PL.normalizePlan(parsed.plan, { accounts, previous: rec.plan, source: 'manual' })
      syncScenarios(rec)
      msg.planUpdated = true
    }
    S.saveSession(rec)
    if (parsed.plan) emitPlan(rec)
    return { reply: msg, plan: rec.plan }
  }
  const text = S.redact(rec.id, String(message || '').trim().slice(0, 4000))
  if (!text) throw new AgentError(400, 'Message vide.')
  const history = rec.chat.filter((m) => !m.manual)
  rec.chat.push({ role: 'user', content: text, at: now() })
  const prevStatus = rec.status
  if (['draft', 'review', 'stopped', 'failed', 'needs-human', 'validated'].includes(prevStatus)) setStatus(rec, 'planning')
  rt.busy = 'chat'
  let r
  try {
    r = await safeComplete(rec, PL.buildChatRequest({ story, gherkinText: gherkinOf(rec.storyKey), target, accounts, plan: rec.plan, history, message: text, instructions: rec.instructions }))
  } catch (e) {
    // erreur inattendue : la session ne doit pas rester bloquée en « Préparation du plan »
    setStatus(rec, prevStatus === 'planning' ? 'draft' : prevStatus)
    throw e
  } finally {
    rt.busy = null
  }
  let reply
  if (r.ok) {
    const parsed = PL.parseChatAnswer(r.text)
    reply = { role: 'assistant', content: parsed.text, at: now(), source: 'ai', provider: r.provider, model: r.model }
    if (parsed.plan) {
      rec.plan = PL.normalizePlan(parsed.plan, { accounts, previous: rec.plan, source: 'ai' })
      syncScenarios(rec)
      reply.planUpdated = true
    }
  } else {
    reply = {
      role: 'assistant',
      manual: true,
      at: now(),
      source: 'manual',
      content: 'Aucun assistant IA n\'a répondu (mode copier-coller). Le plan affiché a été établi par règles à partir du Gherkin ou des critères : '
        + 'vous pouvez le modifier directement, ou copier le prompt ci-dessous dans votre assistant et coller sa réponse.',
      reason: r.reason || '',
    }
  }
  rec.chat.push(reply)
  setStatus(rec, prevStatus === 'planning' ? 'draft' : prevStatus)
  if (reply.planUpdated) emitPlan(rec)
  return { reply, plan: rec.plan, manual: !r.ok, prompt: r.ok ? undefined : r.prompt }
}

export function updatePlan(rec, { plan, rules }) {
  if (['exploring', 'recording', 'replaying'].includes(rec.status)) throw new AgentError(409, 'Impossible de modifier le plan pendant l\'exploration : arrêtez-la d\'abord.')
  const target = targetFor(rec)
  const accounts = accountsOf(rec, target)
  let next
  if (rules) next = PL.rulePlan({ story: storyOf(rec), gherkinText: gherkinOf(rec.storyKey), accounts })
  else {
    if (!plan || !Array.isArray(plan.scenarios)) throw new AgentError(400, 'Plan invalide : { scenarios: [...] } attendu.')
    next = PL.normalizePlan(plan, { accounts, previous: rec.plan, source: 'edit' })
  }
  if (!next.scenarios.length) throw new AgentError(400, 'Le plan doit contenir au moins un scénario avec une étape.')
  rec.plan = next
  syncScenarios(rec)
  S.saveSession(rec)
  emitPlan(rec)
  regenCode(rec)
  return rec.plan
}

// ---------- Exploration ----------
export function startExploration(rec, { fromPlanStepId, restart } = {}) {
  const rt = S.runtimeOf(rec.id)
  if (['exploring', 'recording', 'replaying', 'planning'].includes(rec.status) || rt.loop) throw new AgentError(409, 'Une opération est déjà en cours sur cette session.')
  if (!rec.plan?.scenarios?.length) throw new AgentError(409, 'Aucun plan de test : décrivez d\'abord le test (étape « Expliquer le test »).')
  const status = engineStatus()
  if (!status.available) throw new AgentError(409, status.reason || 'Moteur Playwright indisponible.')
  syncScenarios(rec)
  if (restart) {
    for (const sc of rec.plan.scenarios) for (const st of sc.steps) if (st.kind !== 'context') { st.status = 'pending'; st.attempts = 0 }
    for (const sc of rec.scenarios) sc.steps = []
  }
  if (fromPlanStepId) {
    let reached = false
    for (const sc of rec.plan.scenarios) {
      for (const st of sc.steps) {
        if (st.id === fromPlanStepId) reached = true
        if (reached && st.kind !== 'context') st.status = 'pending'
      }
    }
  }
  rec.needsHuman = null
  setStatus(rec, 'exploring')
  rt.abort = new AbortController()
  rt.busy = 'exploring'
  rt.loop = exploreLoop(rec, rt.abort.signal)
    .catch((e) => {
      log(rec, `Exploration interrompue : ${e.message}`, 'error')
      if (!rt.abort?.signal.aborted) {
        setStatus(rec, 'failed', e.message)
        S.emit(rec, 'error', { message: e.message })
      }
    })
    .finally(() => {
      rt.loop = null
      rt.busy = null
    })
  return rec
}

async function exploreLoop(rec, signal) {
  const plan = rec.plan
  for (let si = 0; si < plan.scenarios.length; si++) {
    const psc = plan.scenarios[si]
    for (let pi = 0; pi < psc.steps.length; pi++) {
      if (signal.aborted) return
      const step = psc.steps[pi]
      if (step.status === 'found' || step.status === 'skipped') continue
      let b = await ensureBrowser(rec)
      const rt = S.runtimeOf(rec.id)
      if (rt.stateKey != null && rt.stateKey !== si) {
        // autre scénario : contexte neuf, comme dans le test généré
        await closeBrowser(rec)
        b = await ensureBrowser(rec)
      }
      await prepareScenario(rec, b, si, pi)
      rec.progress = { scenarioIndex: si, stepIndex: pi, iteration: 0 }
      const outcome = await runPlanStep(rec, b, si, pi, signal)
      if (outcome === 'needs-human' || signal.aborted) return
      regenCode(rec)
    }
  }
  if (signal.aborted) return
  await closeBrowser(rec)
  const count = S.flattenSteps(rec).length
  setStatus(rec, 'review', `${count} étape(s) construite(s).`)
  log(rec, `Exploration terminée : ${count} étape(s) de test construite(s). Relisez puis rejouez le test.`)
  regenCode(rec)
  S.emit(rec, 'done', { phase: 'explore', status: 'review' })
}

function markStep(rec, si, pi, status, extra = {}) {
  const st = rec.plan.scenarios[si].steps[pi]
  st.status = status
  Object.assign(st, extra)
  S.saveSession(rec)
  emitStep(rec, { phase: 'explore', scenarioIndex: si, stepIndex: pi, planStepId: st.id, status, goal: st.goal, attempts: st.attempts || 0, maxIterations: rec.maxIterations, ...extra })
}

function needsHuman(rec, si, pi, reason, attempts = []) {
  const st = rec.plan.scenarios[si].steps[pi]
  markStep(rec, si, pi, 'human', { reason })
  rec.needsHuman = {
    scenarioIndex: si,
    stepIndex: pi,
    planStepId: st.id,
    kind: st.kind,
    goal: st.goal,
    gherkin: st.gherkin || '',
    reason,
    attempts: attempts.slice(-8),
    at: new Date().toISOString(),
  }
  setStatus(rec, 'needs-human', reason)
  log(rec, `Prise de main demandée pour « ${st.goal} » : ${reason}`, 'warn')
  S.emit(rec, 'needs-human', rec.needsHuman)
  return 'needs-human'
}

async function runPlanStep(rec, b, si, pi, signal) {
  const step = rec.plan.scenarios[si].steps[pi]
  const target = targetFor(rec)
  step.attempts = 0
  markStep(rec, si, pi, 'running')
  const gherkin = step.gherkin || step.goal

  if (step.kind === 'context') {
    markStep(rec, si, pi, 'found')
    return 'found'
  }
  if (step.kind === 'goto') {
    const r = await b.goto(target.baseUrl)
    if (r && r.ok !== false) {
      putSteps(rec, si, step.id, [{ action: 'goto', url: target.baseUrl, selector: null, value: null, secret: null, expect: null, gherkin, source: 'rule', note: null }])
      await snap(rec, b)
      markStep(rec, si, pi, 'found', { source: 'rule' })
      log(rec, `Application ouverte : ${r.url || target.baseUrl}`, 'ok')
      return 'found'
    }
    return needsHuman(rec, si, pi, `Ouverture de ${target.baseUrl} impossible : ${r?.error || 'erreur inconnue'}.`)
  }

  // Règles simples (sans IA) : connexion, vérification d'un texte cité, clic sur un libellé cité
  const ruled = await tryRules(rec, b, si, pi, step)
  if (ruled === 'found') return 'found'

  if (!llmAvailable()) {
    const why = step.kind === 'check'
      ? 'Aucun assistant IA n\'est configuré et cette vérification ne peut pas être déduite automatiquement. Montrez l\'élément à vérifier (mode « Vérifier ») ou passez l\'étape.'
      : 'Aucun assistant IA n\'est configuré : cette étape doit être réalisée par vous, l\'enregistrement servira à construire le test.'
    return needsHuman(rec, si, pi, typeof ruled === 'string' && ruled !== 'none' ? `${ruled} ${why}` : why)
  }
  return aiLoop(rec, b, si, pi, signal)
}

// ---------- Règles ----------
const USER_RE = /identifiant|utilisateur|login|e-?mail|courriel|user|matricule|nom de compte|username/i
const SUBMIT_RE = /connexion|connecter|login|log in|sign in|s'identifier|s’identifier|entrer|valider|continuer/i
const CLICK_VERB_RE = /(clique|cliquer|appuie|appuyer|sélectionne|choisit|ouvre|ouvrir|accède|va sur|navigue|valide)/i

async function tryRules(rec, b, si, pi, step) {
  const gherkin = step.gherkin || step.goal
  if (step.kind === 'login') {
    const account = step.account || rec.accountIds?.[0]
    if (!account) return 'Aucun compte de démonstration sélectionné.'
    const s = await snap(rec, b)
    if (!s.ok) return s.error
    const els = s.elements || []
    const pwd = els.find((e) => e.tag === 'input' && e.type === 'password')
    if (!pwd) return 'Aucun champ mot de passe sur la page.'
    const textboxes = els.filter((e) => e.tag === 'input' && ['text', 'email', '', 'tel', undefined].includes(e.type))
    const user = textboxes.find((e) => USER_RE.test(`${e.name} ${e.label} ${e.placeholder}`)) || textboxes.filter((e) => els.indexOf(e) < els.indexOf(pwd)).pop()
    const buttons = els.filter((e) => e.role === 'button' && e.enabled !== false)
    const submit = buttons.find((e) => SUBMIT_RE.test(`${e.name} ${e.text}`)) || buttons.find((e) => e.type === 'submit')
    if (!user || !submit) return 'Formulaire de connexion non reconnu.'
    log(rec, `Règle : connexion avec le compte « ${account} ».`)
    const r1 = await b.act({ action: 'fill', ref: user.ref, value: `{{account:${account}:username}}` })
    if (!r1.ok) return r1.error
    const r2 = await b.act({ action: 'fill', ref: pwd.ref, secret: `account:${account}:password` })
    if (!r2.ok) return r2.error
    const before = s.url
    const r3 = await b.act({ action: 'click', ref: submit.ref })
    if (!r3.ok) return r3.error
    const pwdSel = r2.usedSelector || selectorOfElement(pwd)
    const gone = await b.expect({ kind: 'hidden', selector: pwdSel })
    if (!gone.ok) {
      await snap(rec, b)
      return 'La connexion par règle n\'a pas abouti (le champ mot de passe est toujours affiché).'
    }
    const steps = [
      { action: 'fill', selector: r1.usedSelector || selectorOfElement(user), value: `{{account:${account}:username}}`, secret: null, gherkin, source: 'rule', note: null, label: user.label || user.name || 'Identifiant' },
      { action: 'fill', selector: pwdSel, value: null, secret: `account:${account}:password`, gherkin, source: 'rule', note: null, label: pwd.label || pwd.name || 'Mot de passe' },
      { action: 'click', selector: r3.usedSelector || selectorOfElement(submit), value: null, secret: null, gherkin, source: 'rule', note: null, label: submit.name || 'Se connecter' },
    ]
    if (r3.url && r3.url !== before) steps.push({ action: 'expect', selector: null, expect: { kind: 'url', value: r3.url }, value: null, secret: null, gherkin, source: 'rule', note: 'Adresse atteinte après la connexion.' })
    putSteps(rec, si, step.id, steps)
    await snap(rec, b)
    markStep(rec, si, pi, 'found', { source: 'rule' })
    log(rec, 'Connexion réussie (règle).', 'ok')
    return 'found'
  }
  if (step.kind === 'check' && step.expectText) {
    const r = await b.expect({ kind: 'text', value: step.expectText })
    if (r.ok) {
      putSteps(rec, si, step.id, [{ action: 'expect', selector: null, expect: { kind: 'text', value: step.expectText }, value: null, secret: null, gherkin, source: 'rule', note: null }])
      markStep(rec, si, pi, 'found', { source: 'rule' })
      log(rec, `Vérification trouvée : « ${step.expectText} » est affiché.`, 'ok')
      return 'found'
    }
    return `Le texte « ${step.expectText} » n'apparaît pas sur la page.`
  }
  if (step.kind === 'action') {
    const q = (String(step.goal).match(/«\s*([^»]+?)\s*»|"([^"]+)"/) || [])
    const label = (q[1] || q[2] || '').trim().toLowerCase()
    if (label && CLICK_VERB_RE.test(step.goal)) {
      const s = await snap(rec, b)
      if (!s.ok) return s.error
      const hits = (s.elements || []).filter((e) => e.kind !== 'content' && ['button', 'link', 'tab', 'menuitem', 'option', 'checkbox', 'radio'].includes(e.role) && String(e.name || e.text || '').trim().toLowerCase() === label)
      if (hits.length === 1) {
        const r = await b.act({ action: 'click', ref: hits[0].ref })
        if (r.ok) {
          putSteps(rec, si, step.id, [{ action: 'click', selector: r.usedSelector || selectorOfElement(hits[0]), value: null, secret: null, gherkin, source: 'rule', note: null, label: hits[0].name }])
          await snap(rec, b)
          markStep(rec, si, pi, 'found', { source: 'rule' })
          log(rec, `Règle : clic sur « ${hits[0].name} ».`, 'ok')
          return 'found'
        }
      }
    }
  }
  return 'none'
}

// ---------- Boucle IA ----------
async function aiLoop(rec, b, si, pi, signal) {
  const step = rec.plan.scenarios[si].steps[pi]
  const psc = rec.plan.scenarios[si]
  const target = targetFor(rec)
  const accounts = accountsOf(rec, target)
  const markers = new Set(PL.accountMarkers(accounts))
  const story = storyOf(rec)
  const maxIt = rec.maxIterations || 4
  const history = []
  const attempts = []
  let failures = 0
  let iterations = 0
  let lastError = null
  const doneSteps = psc.steps.slice(0, pi).filter((s) => s.status === 'found').map((s) => s.goal)
  while (true) {
    if (signal.aborted) return 'aborted'
    if (failures >= maxIt || iterations >= maxIt * 3) {
      const reason = failures >= maxIt
        ? `L'IA n'a pas trouvé comment réaliser cette étape après ${failures} tentative(s) sans progrès${lastError ? ` (dernier problème : ${lastError})` : ''}.`
        : `L'IA n'a pas atteint l'objectif en ${iterations} actions.`
      return needsHuman(rec, si, pi, reason, attempts)
    }
    iterations++
    step.attempts = failures
    rec.progress = { scenarioIndex: si, stepIndex: pi, iteration: iterations }
    emitStep(rec, { phase: 'explore', scenarioIndex: si, stepIndex: pi, planStepId: step.id, status: 'running', iteration: iterations, failures, maxIterations: maxIt, goal: step.goal })
    const s = await snap(rec, b)
    if (!s.ok) {
      failures++
      lastError = s.error
      attempts.push(`Instantané impossible : ${s.error}`)
      continue
    }
    S.emit(rec, 'snapshot', { url: s.url, title: s.title, elements: (s.elements || []).length, iteration: iterations })
    const refs = new Set((s.elements || []).map((e) => e.ref))
    const req = PL.buildExploreRequest({ story, target, accounts, planStep: step, scenarioName: psc.name, history, doneSteps, snapshot: s, lastError, instructions: rec.instructions })
    touch(rec)
    const r = await safeComplete(rec, { ...req, signal })
    if (signal.aborted) return 'aborted'
    if (!r.ok) {
      return needsHuman(rec, si, pi, `L'assistant IA ne répond pas (${r.reason || 'mode copier-coller'}) : réalisez l'étape vous-même.`, attempts)
    }
    const v = PL.validateExploreAnswer(r.json, { refs, markers })
    if (!v.ok) {
      failures++
      lastError = v.error
      attempts.push(`Réponse refusée : ${v.error}`)
      history.push(`réponse refusée (${v.error})`)
      log(rec, `Réponse de l'IA refusée : ${v.error}`, 'warn')
      continue
    }
    const el = v.ref ? s.elements.find((e) => e.ref === v.ref) : null
    const what = `${v.action}${el ? ` sur ${el.role || el.tag} « ${el.name || el.text || el.placeholder || el.ref} »` : ''}${v.value && !String(v.value).includes('{{') ? ` (« ${String(v.value).slice(0, 60)} »)` : ''}`
    log(rec, `IA (essai ${iterations}) : ${what}${v.reason ? ` — ${v.reason}` : ''}`)
    if (v.action === 'none') {
      if (v.done) {
        if (step.kind === 'check' && !(rec.scenarios[si]?.steps || []).some((x) => x.planStepId === step.id)) {
          failures++
          lastError = 'une vérification doit produire une action « expect »'
          attempts.push('Vérification sans assertion refusée.')
          history.push('« none » refusé : utilise une action expect pour une vérification')
          continue
        }
        markStep(rec, si, pi, 'found', { source: 'ai' })
        return 'found'
      }
      failures++
      lastError = v.reason || 'objectif jugé impossible par l\'IA'
      attempts.push(`IA : ${lastError}`)
      history.push(`aucune action (${lastError})`)
      continue
    }
    const exec = await execAiAction(rec, b, v, s, step)
    if (!exec.ok) {
      failures++
      lastError = exec.error
      attempts.push(`${what} : ${exec.error}`)
      history.push(`${what} → échec : ${exec.error}`)
      log(rec, `Échec : ${exec.error}`, 'warn')
      continue
    }
    // ajout à la suite des étapes déjà trouvées pour cette étape du plan
    const prev = (rec.scenarios[si]?.steps || []).filter((x) => x.planStepId === step.id).map(({ id, planStepId, ...rest }) => rest)
    putSteps(rec, si, step.id, [...prev, ...exec.steps])
    history.push(`${what} → OK${exec.url ? ` (page : ${exec.url})` : ''}`)
    failures = 0
    lastError = exec.warning || null
    S.saveSession(rec)
    regenCode(rec)
    if (v.done && !exec.warning) {
      markStep(rec, si, pi, 'found', { source: 'ai' })
      log(rec, `Étape trouvée : ${step.goal}`, 'ok')
      return 'found'
    }
  }
}

async function execAiAction(rec, b, v, s, planStep) {
  const gherkin = planStep.gherkin || planStep.goal
  const el = v.ref ? s.elements.find((e) => e.ref === v.ref) : null
  const base = { gherkin, source: 'ai', note: v.reason || null, label: el ? el.name || el.label || el.placeholder || el.text || '' : '' }
  if (v.action === 'goto') {
    const r = await b.goto(v.value)
    if (!r || r.ok === false) return { ok: false, error: r?.error || 'navigation impossible' }
    return { ok: true, url: r.url, steps: [{ ...base, action: 'goto', url: r.url || v.value, selector: null, value: null, secret: null, expect: null }] }
  }
  if (v.action === 'expect') {
    const ex = v.expect || { kind: 'visible', ref: v.ref }
    const target = ex.ref ? s.elements.find((e) => e.ref === ex.ref) : el
    const selector = target ? selectorOfElement(target) : null
    if (['visible', 'hidden', 'value'].includes(ex.kind) && !selector) return { ok: false, error: 'aucun sélecteur fiable pour cet élément' }
    const r = await b.expect({ kind: ex.kind, selector: selector || undefined, value: ex.value ?? undefined })
    if (!r.ok) return { ok: false, error: r.error || 'vérification non satisfaite' }
    return { ok: true, steps: [{ ...base, action: 'expect', selector, value: null, secret: null, expect: { kind: ex.kind, value: ex.value ?? null } }] }
  }
  // sélecteur de la vérification facultative, calculé avant l'action (la page peut changer)
  const exEl = v.expect && v.expect.ref ? s.elements.find((e) => e.ref === v.expect.ref) : null
  const exSel = exEl ? selectorOfElement(exEl) : null
  const args = { action: v.action, ref: v.ref || undefined }
  if (v.action === 'fill') {
    if (v.secret) args.secret = v.secret
    else args.value = v.value
  } else if (v.value != null) args.value = v.value
  const r = await b.act(args)
  if (!r.ok) return { ok: false, error: r.error || 'action impossible' }
  const selector = r.usedSelector ? { strategy: r.usedSelector.strategy, value: r.usedSelector.value, code: r.usedSelector.code, ...(r.usedSelector.exact ? { exact: true } : {}) } : (el ? selectorOfElement(el) : null)
  const steps = [{
    ...base,
    action: v.action,
    selector: v.action === 'press' && !v.ref ? null : selector,
    value: v.action === 'fill' ? (v.secret ? null : v.value) : v.action === 'press' ? v.value || 'Enter' : v.action === 'select' ? v.value : null,
    secret: v.secret || null,
    expect: null,
  }]
  let warning = null
  if (v.expect) {
    const ex = v.expect
    const er = await b.expect({ kind: ex.kind, selector: exSel || undefined, value: ex.value ?? undefined })
    if (er.ok) steps.push({ ...base, action: 'expect', selector: exSel, value: null, secret: null, expect: { kind: ex.kind, value: ex.value ?? null }, label: '' })
    else warning = `vérification après l'action non satisfaite : ${er.error}`
  }
  return { ok: true, url: r.url, steps, warning }
}

// ---------- Prise de main ----------
function currentPlanStep(rec) {
  if (rec.needsHuman) {
    const sc = rec.plan.scenarios[rec.needsHuman.scenarioIndex]
    const pi = sc ? sc.steps.findIndex((st) => st.id === rec.needsHuman.planStepId) : -1
    if (pi >= 0) return { si: rec.needsHuman.scenarioIndex, pi }
  }
  for (let si = 0; si < rec.plan.scenarios.length; si++) {
    const pi = rec.plan.scenarios[si].steps.findIndex((st) => !['found', 'skipped'].includes(st.status))
    if (pi >= 0) return { si, pi }
  }
  const si = Math.max(0, rec.plan.scenarios.length - 1)
  return { si, pi: Math.max(0, (rec.plan.scenarios[si]?.steps.length || 1) - 1) }
}

export async function takeover(rec, opts = {}) {
  const rt = S.runtimeOf(rec.id)
  if (rt.takingOver) throw new AgentError(409, 'La prise de main est en cours de préparation : patientez.')
  rt.takingOver = true
  try {
    return await takeoverInner(rec, rt, opts)
  } catch (e) {
    // échec de préparation après interruption de l'exploration : la session ne reste pas « en cours »
    if (rec.status === 'exploring' && !rt.loop) setStatus(rec, 'needs-human', `Prise de main impossible : ${e.message}`)
    throw e
  } finally {
    rt.takingOver = false
  }
}

async function takeoverInner(rec, rt, { mode = 'remote', planStepId } = {}) {
  if (rec.status === 'recording') throw new AgentError(409, 'La prise de main est déjà en cours.')
  if (['replaying', 'planning'].includes(rec.status)) throw new AgentError(409, 'Une opération est en cours : attendez sa fin.')
  if (!rec.plan?.scenarios?.length) throw new AgentError(409, 'Aucun plan de test.')
  if (rec.status === 'exploring') await interrupt(rec)
  syncScenarios(rec)
  let pos = currentPlanStep(rec)
  if (planStepId) {
    rec.plan.scenarios.forEach((sc, si) => sc.steps.forEach((st, pi) => { if (st.id === planStepId) pos = { si, pi } }))
  }
  const step = rec.plan.scenarios[pos.si].steps[pos.pi]
  const wantWindow = mode === 'window'
  rt.busy = 'takeover'
  try {
    let b
    if (wantWindow) {
      if (!rt.browser || rt.browserHeadless) {
        if (rt.browser) log(rec, 'Ouverture d\'une fenêtre visible : l\'état du scénario est rejoué.')
        await closeBrowser(rec)
      }
      b = await ensureBrowser(rec, { headless: false })
    } else {
      b = await ensureBrowser(rec)
    }
    const prep = await prepareScenario(rec, b, pos.si, pos.pi)
    if (!prep.kept && !prep.replayed) {
      // rien à rejouer : on part de la page d'accueil de l'application
      await b.goto(targetFor(rec).baseUrl)
    }
    rt.recording = []
    rt.checks = []
    const r = await b.startRecording()
    if (r && r.ok === false) throw new AgentError(500, r.error || 'Démarrage de l\'enregistrement impossible.')
    rec.takeover = { mode: wantWindow ? 'window' : 'remote', scenarioIndex: pos.si, stepIndex: pos.pi, planStepId: step.id, startedAt: new Date().toISOString() }
    setStatus(rec, 'recording', wantWindow ? 'Agissez dans la fenêtre du navigateur.' : 'Agissez sur la capture.')
    log(rec, wantWindow ? 'Prise de main : agissez dans la fenêtre du navigateur, puis cliquez sur « J\'ai terminé ».' : 'Prise de main : cliquez sur la capture et saisissez le texte, puis « J\'ai terminé ».')
    const shot = await b.screenshot()
    if (shot && shot.screenshot) S.emit(rec, 'screenshot', { dataUrl: shot.screenshot, size: shot.size, scale: shot.scale, url: shot.url })
    touch(rec)
    return rec
  } finally {
    rt.busy = null
  }
}

function elementAt(elements, x, y) {
  const hits = (elements || []).filter((e) => e.box && x >= e.box.x && x <= e.box.x + e.box.w && y >= e.box.y && y <= e.box.y + e.box.h)
  hits.sort((a, b) => (a.box.w * a.box.h) - (b.box.w * b.box.h))
  return hits[0] || null
}

export async function remote(rec, body = {}) {
  if (rec.status !== 'recording') throw new AgentError(409, 'Aucune prise de main en cours : cliquez d\'abord sur « Prendre la main ».')
  const rt = S.runtimeOf(rec.id)
  const b = rt.browser
  if (!b || b.closed) throw new AgentError(409, 'Le navigateur est fermé : annulez puis reprenez la main.')
  touch(rec)
  const kind = String(body.kind || '')
  const imageWidth = Number(body.imageWidth) > 0 ? Number(body.imageWidth) : undefined
  if (kind === 'click') {
    const x = Number(body.x)
    const y = Number(body.y)
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > 5000 || y > 5000) throw new AgentError(400, 'Coordonnées de clic invalides.')
    return b.clickAt({ x, y, imageWidth })
  }
  if (kind === 'type') {
    const text = String(body.text ?? '')
    if (!text) throw new AgentError(400, 'Texte à saisir vide.')
    if (text.length > 2000) throw new AgentError(400, 'Texte trop long (2 000 caractères au plus).')
    return b.typeText(text)
  }
  if (kind === 'key') {
    const key = String(body.key || '')
    if (!/^[A-Za-z0-9+]{1,30}$/.test(key)) throw new AgentError(400, 'Touche invalide.')
    return b.pressKey(key)
  }
  if (kind === 'check') {
    const s = await b.snapshot({ screenshot: false })
    if (!s || s.ok === false) throw new AgentError(500, s?.error || 'Instantané impossible.')
    const last = rt.lastScreenshot || {}
    const scale = Number(last.scale) > 0 ? Number(last.scale) : 0.8
    const shotW = last.size?.w
    const k = imageWidth && shotW ? scale * (imageWidth / shotW) : scale
    const px = Number(body.x) / k
    const py = Number(body.y) / k
    const el = elementAt(s.elements, px, py)
    if (!el) throw new AgentError(400, 'Aucun élément reconnu à cet endroit : cliquez sur un texte, un titre ou un champ.')
    const selector = selectorOfElement(el)
    const checkKind = ['visible', 'text', 'value', 'hidden'].includes(body.checkKind) ? body.checkKind : 'visible'
    let expect = { kind: checkKind, value: null }
    if (checkKind === 'text') expect.value = String(body.value || el.name || el.text || '').slice(0, 300)
    if (checkKind === 'value') expect.value = String(body.value ?? el.value ?? '').slice(0, 300)
    if (!selector && checkKind !== 'text') throw new AgentError(400, 'Aucun sélecteur fiable pour cet élément.')
    const r = await b.expect({ kind: expect.kind, selector: selector || undefined, value: expect.value ?? undefined })
    if (!r.ok) throw new AgentError(400, `Vérification non satisfaite : ${r.error}`)
    const label = el.name || el.text || el.label || el.placeholder || el.tag
    rt.checks.push({ at: Date.now(), step: { action: 'expect', selector, value: null, secret: null, expect, source: 'human', note: null, label } })
    S.emit(rec, 'recording', { event: { type: 'expect', selector, label, kind: expect.kind, value: expect.value, at: Date.now() } })
    return { ok: true, element: { role: el.role, name: label }, selector, expect }
  }
  throw new AgentError(400, 'Action à distance inconnue : click, type, key ou check.')
}

/** Instantané allégé de la page (éléments et boîtes) : surbrillance dans « Agir ici », tests. */
export async function pageSnapshot(rec) {
  const rt = S.runtimeOf(rec.id)
  const b = rt.browser
  if (!b || b.closed) throw new AgentError(409, 'Aucun navigateur ouvert pour cette session.')
  if (rt.busy === 'exploring' || rt.busy === 'replaying') throw new AgentError(409, 'Exploration en cours : instantané indisponible.')
  touch(rec)
  const s = await snap(rec, b)
  if (!s.ok) throw new AgentError(500, s.error)
  return {
    url: s.url,
    title: s.title,
    scale: s.scale,
    size: s.size,
    elements: (s.elements || []).map((e) => ({ ref: e.ref, kind: e.kind, role: e.role, tag: e.tag, type: e.type, name: e.name || e.label || e.placeholder || e.text || '', box: e.box, inViewport: e.inViewport })),
  }
}

/** Étapes déterministes : enregistrement + vérifications ajoutées par le testeur, dans l'ordre chronologique. */
function humanSteps(events, checks, keepInitialGoto) {
  const sorted = [...events].filter(Boolean).sort((a, b) => (a.at || 0) - (b.at || 0))
  let steps = stepsFromRecording(sorted, { source: 'human' })
  const initial = sorted[0] && sorted[0].initial
  if (initial && !keepInitialGoto && steps[0] && steps[0].action === 'goto') steps = steps.slice(1)
  const offset = initial && !keepInitialGoto ? 1 : 0
  const inserts = []
  for (const c of checks || []) {
    const prefix = stepsFromRecording(sorted.filter((e) => (e.at || 0) <= c.at), { source: 'human' })
    inserts.push({ index: Math.max(0, prefix.length - offset), step: c.step })
  }
  inserts.sort((a, b) => b.index - a.index)
  for (const ins of inserts) steps.splice(Math.min(ins.index, steps.length), 0, ins.step)
  return steps
}

export async function takeoverDone(rec, opts = {}) {
  const rt = S.runtimeOf(rec.id)
  // double clic sur « J'ai terminé » : une seule interprétation à la fois (sinon étapes en double)
  if (rt.finishing) throw new AgentError(409, 'Fin de prise de main déjà en cours : patientez.')
  rt.finishing = true
  try {
    return await takeoverDoneInner(rec, rt, opts)
  } finally {
    rt.finishing = false
  }
}

async function takeoverDoneInner(rec, rt, { discard = false, skip = false, coverUntil = null, resume = true } = {}) {
  if (skip && rec.status === 'needs-human') {
    const { si, pi } = currentPlanStep(rec)
    markStep(rec, si, pi, 'skipped', { reason: 'Étape passée par le testeur.' })
    rec.needsHuman = null
    log(rec, `Étape passée : ${rec.plan.scenarios[si].steps[pi].goal}`, 'warn')
    regenCode(rec)
    return resumeAfter(rec, resume)
  }
  if (rec.status !== 'recording') throw new AgentError(409, 'Aucune prise de main en cours.')
  const b = rt.browser
  const events = b && !b.closed ? await b.stopRecording() : rt.recording
  const tk = rec.takeover || {}
  const si = tk.scenarioIndex ?? currentPlanStep(rec).si
  const pi = tk.stepIndex ?? currentPlanStep(rec).pi
  rec.takeover = null
  const psc = rec.plan.scenarios[si]
  const step = psc?.steps[pi]
  if (!step) throw new AgentError(409, 'Étape du plan introuvable.')
  if (discard) {
    rec.needsHuman = rec.needsHuman || { scenarioIndex: si, stepIndex: pi, planStepId: step.id, kind: step.kind, goal: step.goal, gherkin: step.gherkin || '', reason: 'Prise de main annulée.', attempts: [], at: new Date().toISOString() }
    rt.stateKey = null // l'état de la page a pu changer : il sera rejoué
    setStatus(rec, 'needs-human', 'Prise de main annulée.')
    S.emit(rec, 'needs-human', rec.needsHuman)
    return { rec, steps: [] }
  }
  if (skip) {
    markStep(rec, si, pi, 'skipped', { reason: 'Étape passée par le testeur.' })
    rec.needsHuman = null
    regenCode(rec)
    return resumeAfter(rec, resume)
  }
  const hasPrior = (rec.scenarios[si]?.steps || []).some((st) => {
    const k = psc.steps.findIndex((p) => p.id === st.planStepId)
    return k >= 0 && k < pi
  })
  let steps = humanSteps(events, rt.checks, step.kind === 'goto' || !hasPrior)
  if (!steps.length) {
    rec.needsHuman = rec.needsHuman || { scenarioIndex: si, stepIndex: pi, planStepId: step.id, kind: step.kind, goal: step.goal, gherkin: step.gherkin || '', reason: 'Aucune action enregistrée.', attempts: [], at: new Date().toISOString() }
    setStatus(rec, 'needs-human', 'Aucune action enregistrée.')
    S.emit(rec, 'needs-human', rec.needsHuman)
    throw new AgentError(400, 'Aucune action enregistrée : réalisez l\'étape (ou choisissez « Passer cette étape »), puis cliquez sur « J\'ai terminé ».')
  }
  const remaining = psc.steps.slice(pi).filter((st) => st.kind !== 'context' || st.id === step.id)
  let mapping = null
  let lastId = null
  let comment = ''
  if (llmAvailable()) {
    setStatus(rec, 'recording', 'L\'IA interprète l\'enregistrement…')
    let r
    try {
      r = await safeComplete(rec, PL.buildInterpretRequest({ story: storyOf(rec), planSteps: remaining, steps }))
    } catch (e) {
      r = { ok: false, reason: e.message }
    }
    if (r.ok) {
      const v = PL.validateInterpretAnswer(r.json, { count: steps.length, planIds: remaining.map((p) => p.id) })
      if (v.ok && v.mapping.length) {
        mapping = v.mapping
        lastId = v.lastPlanStepId
        comment = v.comment
      } else {
        log(rec, `Interprétation de l'IA ignorée (${v.error || 'aucune étape'}) : construction par règles.`, 'warn')
      }
    } else {
      log(rec, 'Interprétation par l\'IA indisponible : construction par règles.', 'warn')
    }
  }
  if (!mapping) {
    let last = step.id
    if (coverUntil) {
      const k = psc.steps.findIndex((st) => st.id === coverUntil)
      if (k >= pi) last = coverUntil
    }
    mapping = steps.map((_, index) => ({ index, planStepId: step.id }))
    lastId = last
  }
  // regroupement par étape du plan, dans l'ordre du plan
  const byPlan = new Map()
  for (const m of mapping) {
    if (!byPlan.has(m.planStepId)) byPlan.set(m.planStepId, [])
    const st = steps[m.index]
    const ps = psc.steps.find((p) => p.id === m.planStepId)
    byPlan.get(m.planStepId).push({ ...st, gherkin: ps ? ps.gherkin || ps.goal : st.gherkin, source: 'human' })
  }
  const lastIdx = Math.max(pi, psc.steps.findIndex((p) => p.id === lastId))
  for (let k = pi; k <= lastIdx; k++) {
    const ps = psc.steps[k]
    if (byPlan.has(ps.id)) putSteps(rec, si, ps.id, byPlan.get(ps.id))
    if (ps.status !== 'skipped') markStep(rec, si, k, 'found', { source: 'human' })
  }
  for (const [pid, list] of byPlan) {
    const k = psc.steps.findIndex((p) => p.id === pid)
    if (k > lastIdx) {
      putSteps(rec, si, pid, list)
      markStep(rec, si, k, 'found', { source: 'human' })
    }
  }
  rec.needsHuman = null
  rt.stateKey = si
  const count = mapping.length
  log(rec, `${count} étape(s) construite(s) à partir de vos actions${comment ? ` — ${comment}` : ''}.`, 'ok')
  regenCode(rec)
  return resumeAfter(rec, resume, { steps: count })
}

function resumeAfter(rec, resume, extra = {}) {
  const pending = rec.plan.scenarios.some((sc) => sc.steps.some((st) => !['found', 'skipped'].includes(st.status)))
  if (resume && pending) {
    rec.status = 'stopped' // permet la reprise
    startExploration(rec)
    return { rec, resumed: true, ...extra }
  }
  if (!pending) {
    closeBrowser(rec).catch(() => {})
    setStatus(rec, 'review', 'Toutes les étapes du plan sont couvertes.')
    S.emit(rec, 'done', { phase: 'explore', status: 'review' })
  } else {
    setStatus(rec, 'review', 'Exploration en pause.')
  }
  return { rec, resumed: false, ...extra }
}

// ---------- Édition des étapes ----------
function cleanSelector(sel, markers) {
  if (!sel || typeof sel !== 'object') return null
  if (!STRATEGY_ORDER.includes(sel.strategy)) throw new AgentError(400, `Stratégie de sélecteur inconnue : ${String(sel.strategy).slice(0, 20)}.`)
  let value = sel.value
  if (sel.strategy === 'role') {
    if (!value || typeof value !== 'object' || !value.role) throw new AgentError(400, 'Sélecteur par rôle invalide ({ role, name } attendu).')
    value = { role: String(value.role).slice(0, 40), name: value.name == null ? '' : String(value.name).slice(0, 200) }
  } else {
    value = String(value ?? '').slice(0, 500)
    if (!value) throw new AgentError(400, 'Sélecteur sans valeur.')
  }
  const out = { strategy: sel.strategy, value, ...(sel.exact === true ? { exact: true } : {}) }
  out.code = selectorCode(out)
  void markers
  return out
}

function checkValueMarkers(v, markers) {
  for (const m of String(v ?? '').matchAll(MARKER_RE)) {
    if (!markers.has(m[1]) && !/^secret:[\w-]+$/.test(m[1])) throw new AgentError(400, `Marqueur inconnu dans une valeur : {{${m[1]}}}.`)
  }
}

export function updateSteps(rec, { scenarios }) {
  if (['exploring', 'recording', 'replaying'].includes(rec.status)) throw new AgentError(409, 'Impossible de modifier les étapes pendant une exploration ou un rejeu.')
  if (!Array.isArray(scenarios)) throw new AgentError(400, 'Liste de scénarios attendue.')
  const target = targetFor(rec)
  const markers = new Set(PL.accountMarkers(accountsOf(rec, target)))
  const planScenarioIds = new Set(rec.plan.scenarios.map((s) => s.id))
  const out = []
  for (const sc of scenarios.slice(0, 20)) {
    if (!sc || !Array.isArray(sc.steps)) throw new AgentError(400, 'Scénario invalide.')
    const steps = []
    for (const st of sc.steps.slice(0, 200)) {
      if (!st || !STEP_ACTIONS.includes(st.action)) throw new AgentError(400, `Action inconnue : ${String(st?.action).slice(0, 20)}.`)
      const step = {
        id: /^t\d+$/.test(String(st.id || '')) ? st.id : nextStepId(rec),
        planStepId: st.planStepId ? String(st.planStepId).slice(0, 20) : null,
        action: st.action,
        selector: cleanSelector(st.selector, markers),
        value: st.value == null ? null : String(st.value).slice(0, 2000),
        secret: null,
        url: st.url == null ? null : String(st.url).slice(0, 1000),
        expect: null,
        gherkin: st.gherkin == null ? null : String(st.gherkin).slice(0, 300),
        source: ['ai', 'human', 'rule'].includes(st.source) ? st.source : 'human',
        note: st.note == null ? null : String(st.note).slice(0, 300),
        label: st.label == null ? '' : String(st.label).slice(0, 120),
      }
      if (st.secret) {
        const key = String(st.secret).replace(/^\{\{|\}\}$/g, '')
        if (!markers.has(key)) throw new AgentError(400, `Secret inconnu : ${key}.`)
        step.secret = key
      }
      checkValueMarkers(step.value, markers)
      if (st.expect && typeof st.expect === 'object') {
        if (!EXPECT_KINDS.includes(st.expect.kind)) throw new AgentError(400, `Vérification inconnue : ${String(st.expect.kind).slice(0, 20)}.`)
        step.expect = { kind: st.expect.kind, value: st.expect.value == null ? null : String(st.expect.value).slice(0, 1000), ...(st.expect.exact === true ? { exact: true } : {}) }
        checkValueMarkers(step.expect.value, markers)
      }
      if (step.action === 'goto' && step.url) {
        try { new URL(step.url, target.baseUrl) } catch { throw new AgentError(400, `Adresse invalide : ${step.url}.`) }
      }
      if (st.replay) step.replay = null
      steps.push(step)
    }
    const planScenarioId = planScenarioIds.has(sc.planScenarioId) ? sc.planScenarioId : null
    out.push({ planScenarioId, name: String(sc.name || 'Scénario').slice(0, 160), steps })
  }
  rec.scenarios = out
  if (rec.status === 'validated') setStatus(rec, 'review', 'Étapes modifiées après validation : revalidez le test.')
  S.saveSession(rec)
  regenCode(rec)
  return rec.scenarios
}

// ---------- Rejeu ----------
export function startReplay(rec) {
  const rt = S.runtimeOf(rec.id)
  if (S.ACTIVE_STATUSES.has(rec.status) && rec.status !== 'needs-human') throw new AgentError(409, 'Une opération est déjà en cours sur cette session.')
  if (rt.loop) throw new AgentError(409, 'Une opération est déjà en cours sur cette session.')
  if (!S.flattenSteps(rec).length) throw new AgentError(409, 'Aucune étape à rejouer : explorez d\'abord l\'application.')
  const status = engineStatus()
  if (!status.available) throw new AgentError(409, status.reason || 'Moteur Playwright indisponible.')
  rec.needsHuman = null
  setStatus(rec, 'replaying')
  rt.abort = new AbortController()
  rt.busy = 'replaying'
  rt.loop = replayLoop(rec, rt.abort.signal)
    .catch((e) => {
      log(rec, `Rejeu interrompu : ${e.message}`, 'error')
      rec.replay = { at: new Date().toISOString(), ok: false, error: e.message, passed: 0, failed: 0 }
      setStatus(rec, 'review', e.message)
      S.emit(rec, 'error', { message: e.message })
    })
    .finally(() => {
      rt.loop = null
      rt.busy = null
    })
  return rec
}

async function replayLoop(rec, signal) {
  await closeBrowser(rec)
  const target = targetFor(rec)
  const t0 = Date.now()
  let passed = 0
  let failed = 0
  let notRun = 0
  for (const sc of rec.scenarios) for (const st of sc.steps) st.replay = null
  for (let si = 0; si < rec.scenarios.length; si++) {
    const sc = rec.scenarios[si]
    if (!sc.steps.length) continue
    if (signal.aborted) return
    log(rec, `Rejeu du scénario « ${sc.name} » (${sc.steps.length} étape(s), navigateur sans fenêtre)…`)
    const b = await ensureBrowser(rec, { headless: true })
    let broken = false
    for (let j = 0; j < sc.steps.length; j++) {
      const st = sc.steps[j]
      if (signal.aborted) return
      if (broken) {
        st.replay = { ok: null, skipped: true }
        notRun++
        continue
      }
      const t = Date.now()
      const r = await executeStep(b, st, target.baseUrl)
      const ok = Boolean(r && r.ok !== false)
      st.replay = { ok, error: ok ? null : r?.error || 'échec', ms: Date.now() - t }
      if (ok) passed++
      else { failed++; broken = true }
      emitStep(rec, { phase: 'replay', scenarioIndex: si, stepIndex: j, stepId: st.id, ok, error: st.replay.error })
      if (!ok) log(rec, `Échec à l'étape ${j + 1} (${PL.describeStepShort(st)}) : ${st.replay.error}`, 'error')
    }
    await closeBrowser(rec)
  }
  const ok = failed === 0 && passed > 0
  rec.replay = { at: new Date().toISOString(), ok, passed, failed, notRun, durationMs: Date.now() - t0, hash: stepsHash(rec) }
  setStatus(rec, 'review', ok ? 'Rejeu réussi.' : `Rejeu en échec (${failed} étape(s)).`)
  log(rec, ok ? `Rejeu réussi : ${passed} étape(s) en ${Math.round((Date.now() - t0) / 1000)} s.` : `Rejeu en échec : ${failed} étape(s) en échec, ${notRun} non jouée(s).`, ok ? 'ok' : 'error')
  S.emit(rec, 'code', { code: rec.code, relPath: rec.relPath, scenarios: rec.scenarios })
  S.emit(rec, 'done', { phase: 'replay', ok, passed, failed, notRun })
}

// ---------- Validation ----------
function writeTextAtomic(file, text, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, text, mode ? { encoding: 'utf8', mode } : 'utf8')
  fs.renameSync(tmp, file)
  if (mode) { try { fs.chmodSync(file, mode) } catch { /* sans effet sous Windows */ } }
}

export function ensureGitignore(root = REPO_ROOT) {
  const file = path.join(root, '.gitignore')
  let cur = ''
  try { cur = fs.readFileSync(file, 'utf8') } catch { cur = '' }
  const lines = cur.split(/\r?\n/).map((l) => l.trim())
  if (lines.includes('tests/.auth/') || lines.includes('tests/.auth') || lines.includes('/tests/.auth/')) return false
  const eol = cur.includes('\r\n') ? '\r\n' : '\n'
  const sep = cur && !cur.endsWith('\n') ? eol : ''
  writeTextAtomic(file, `${cur}${sep}${cur ? eol : ''}# Wizard QA : comptes de démonstration locaux (jamais versionnés)${eol}tests/.auth/${eol}`)
  return true
}

export function validate(rec, user, { force = false } = {}) {
  if (S.ACTIVE_STATUSES.has(rec.status)) throw new AgentError(409, 'Terminez ou arrêtez l\'opération en cours avant de valider.')
  if (!S.flattenSteps(rec).length) throw new AgentError(409, 'Aucune étape : le test est vide.')
  const fresh = rec.replay && rec.replay.ok && rec.replay.hash === stepsHash(rec)
  if (!fresh && !force) {
    throw new AgentError(409, rec.replay && rec.replay.hash === stepsHash(rec)
      ? 'Le dernier rejeu a échoué : corrigez les étapes et rejouez le test avant de le valider.'
      : 'Rejouez le test (avec succès) avant de le valider, ou confirmez la validation sans rejeu.', { needReplay: true })
  }
  const target = targetFor(rec)
  const { code, relPath } = regenCode(rec)
  const abs = path.resolve(REPO_ROOT, relPath)
  if (!abs.startsWith(path.resolve(REPO_ROOT) + path.sep)) throw new AgentError(400, 'Chemin du test invalide.')
  writeTextAtomic(abs, code)
  // comptes locaux : seul fichier contenant les mots de passe en clair (0o600, ignoré par Git)
  const authFile = path.join(REPO_ROOT, 'tests', '.auth', 'accounts.local.json')
  let existing = {}
  try { existing = JSON.parse(fs.readFileSync(authFile, 'utf8')) || {} } catch { existing = {} }
  const selected = (target.accounts || []).filter((a) => (rec.accountIds || []).includes(a.id))
  const merged = { ...existing, ...JSON.parse(buildAccountsFixture(selected)) }
  writeTextAtomic(authFile, JSON.stringify(merged, null, 2) + '\n', 0o600)
  const gitignoreUpdated = ensureGitignore()
  rec.validatedAt = new Date().toISOString()
  rec.validatedBy = user?.username || ''
  rec.validatedWithoutReplay = !fresh
  setStatus(rec, 'validated', `Test écrit dans ${relPath}.`)
  log(rec, `Test validé : ${relPath} (comptes dans tests/.auth/accounts.local.json, ignoré par Git).`, 'ok')
  S.emit(rec, 'done', { phase: 'validate', relPath })
  return { relPath, accountsFile: 'tests/.auth/accounts.local.json', gitignoreUpdated, withoutReplay: !fresh }
}

// ---------- Arrêt ----------
async function interrupt(rec) {
  const rt = S.runtimeOf(rec.id)
  if (rt.abort) rt.abort.abort()
  if (rt.loop) {
    await Promise.race([rt.loop, new Promise((r) => setTimeout(r, 15000))])
  }
}

export async function stopSession(rec, { reason = 'Arrêt demandé par le testeur.' } = {}) {
  const rt = S.runtimeOf(rec.id)
  rt.closing = true
  rt.stopGen = (rt.stopGen || 0) + 1 // invalide un navigateur en cours d'ouverture
  try {
    if (rt.abort) rt.abort.abort()
    if (rec.status === 'recording' && rt.browser && !rt.browser.closed) await rt.browser.stopRecording().catch(() => [])
    await closeBrowser(rec)
    if (rt.loop) await Promise.race([rt.loop, new Promise((r) => setTimeout(r, 15000))])
    rec.takeover = null
    if (S.ACTIVE_STATUSES.has(rec.status)) {
      for (const sc of rec.plan.scenarios || []) for (const st of sc.steps) if (st.status === 'running') st.status = 'pending'
      rec.needsHuman = null
      setStatus(rec, 'stopped', reason)
      log(rec, `Session arrêtée : ${reason}`, 'warn')
    } else {
      S.saveSession(rec)
    }
    if (rt.idleTimer) clearTimeout(rt.idleTimer)
  } finally {
    rt.closing = false
  }
  return rec
}

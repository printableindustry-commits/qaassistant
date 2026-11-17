/**
 * Orchestrateur de l'installation : tri topologique du plan, exécution detect → install → verify,
 * un seul run à la fois, annulation, journaux persistés (.wizard-qa/install/runs/<id>.json + .log),
 * diffusion en direct (abonnés SSE) et mode simulation (dryRun ou WIZARD_INSTALL_DRY=1).
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import { REPO_ROOT } from '../paths.mjs'
import { loadPlan, componentsForStacks, normalizeStacks, knownComponents, writeJsonAtomic, readJson } from './plan.mjs'
import { getImplementation } from './components.mjs'
import {
  buildEnv, formatCommand, runProcess, killTree, download, fetchExpectedSha, sha256File,
  extractArchive, makeTempDir, removeDir, maskSecrets,
} from './system.mjs'

export const INSTALL_DIR = path.join(REPO_ROOT, '.wizard-qa', 'install')
const RUNS_DIR = path.join(INSTALL_DIR, 'runs')
const STATE_PATH = path.join(INSTALL_DIR, 'state.json')
const MAX_LOG_LINES = 3000
const FAILED = new Set(['failed', 'blocked', 'cancelled'])
const DONE_OK = new Set(['ok', 'installed', 'simulated', 'skipped'])

export class InstallError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

class CancelError extends Error {
  constructor() {
    super('Installation annulée.')
  }
}

/* ------------------------------------------------------------------ état persistant */

function loadState() {
  const saved = readJson(STATE_PATH) || {}
  return {
    stacks: Array.isArray(saved.stacks) ? saved.stacks : null,
    detectedAt: saved.detectedAt || null,
    components: saved.components && typeof saved.components === 'object' ? saved.components : {},
    lastRun: saved.lastRun || null,
  }
}

let state = loadState()
let active = null

function saveState() {
  try { writeJsonAtomic(STATE_PATH, state) } catch (e) { console.error('[install] état non enregistré :', e.message) }
}

export function getState() {
  return state
}

export function getActiveRun() {
  return active
}

function recordDetection(id, d) {
  state.components[id] = {
    state: d.state,
    version: d.version || '',
    expected: d.expected || '',
    message: d.message || '',
    detectedAt: new Date().toISOString(),
  }
}

/** Au démarrage : un run resté « en cours » appartient à un serveur arrêté. */
function markInterruptedRuns() {
  let files = []
  try { files = fs.readdirSync(RUNS_DIR).filter((f) => f.endsWith('.json')) } catch { return }
  for (const f of files) {
    const run = readJson(path.join(RUNS_DIR, f))
    if (run?.status !== 'running') continue
    run.status = 'interrupted'
    run.finishedAt = run.finishedAt || new Date().toISOString()
    for (const c of run.components || []) if (['running', 'pending'].includes(c.state)) c.state = 'cancelled'
    try { writeJsonAtomic(path.join(RUNS_DIR, f), run) } catch { /* ignoré */ }
  }
}
markInterruptedRuns()

/* ------------------------------------------------------------------ plan → ordre d'exécution */

/** Ajoute les dépendances (récursivement) des composants demandés. */
function withDependencies(ids, plan) {
  const out = new Set()
  const visit = (id) => {
    if (out.has(id) || !plan.components[id]) return
    for (const d of plan.components[id].dependsOn || []) visit(d)
    out.add(id)
  }
  ids.forEach(visit)
  return [...out]
}

/** Tri topologique stable (ordre du plan conservé à dépendances égales). */
export function topoSort(ids, plan) {
  const set = new Set(ids)
  const order = []
  const state = new Map()
  const visit = (id, trail) => {
    if (state.get(id) === 'done') return
    if (state.get(id) === 'visiting') throw new InstallError(500, `Dépendance circulaire dans le plan : ${[...trail, id].join(' → ')}`)
    state.set(id, 'visiting')
    for (const d of plan.components[id]?.dependsOn || []) if (set.has(d)) visit(d, [...trail, id])
    state.set(id, 'done')
    order.push(id)
  }
  ids.forEach((id) => visit(id, []))
  return order
}

/** Composants concernés par une demande : tout le périmètre des stacks, ou une sélection + ses dépendances. */
export function resolveTargets(plan, stacks, components) {
  const scope = componentsForStacks(plan, stacks)
  const requested = Array.isArray(components) && components.length ? knownComponents(plan, components) : null
  if (requested && !requested.length) throw new InstallError(400, 'Aucun composant connu dans la demande.')
  return { scope, requested, order: topoSort(requested ? withDependencies(requested, plan) : scope, plan) }
}

/* ------------------------------------------------------------------ contexte d'exécution */

function findFile(root, name) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name)
    if (entry.isFile() && entry.name === name) return full
    if (entry.isDirectory()) {
      const found = findFile(full, name)
      if (found) return found
    }
  }
  return null
}

/**
 * Contexte passé aux composants. Toutes les écritures et commandes passent par lui :
 * en simulation, elles sont journalisées sans être exécutées.
 */
export function makeContext({ plan, stacks, dryRun, run = null, log = () => {} }) {
  const env = buildEnv(plan)
  const cancelled = () => Boolean(run?.cancelRequested)
  const track = (child) => { if (run) run.child = child }
  const rel = (p) => path.relative(REPO_ROOT, p).replace(/\\/g, '/') || p
  const ctx = {
    plan,
    stacks,
    dryRun,
    env,
    tools: run ? run.tools : {},
    log,
    cancelled,
    async exec(cmd, args = [], opts = {}) {
      log(`$ ${formatCommand(cmd, args)}`)
      if (dryRun) {
        log('[simulation] commande non exécutée')
        return { code: 0, output: '', simulated: true }
      }
      if (cancelled()) throw new CancelError()
      const r = await runProcess(cmd, args, {
        cwd: opts.cwd,
        env: opts.env || env,
        timeoutMs: opts.timeoutMs || 10 * 60000,
        onLine: opts.quiet ? undefined : (l) => log(l),
        onChild: track,
      })
      if (run) run.child = null
      if (cancelled()) throw new CancelError()
      if (r.error) log(`[erreur] ${r.error}`)
      if (r.code !== 0 && opts.quiet) log(r.output.slice(-1500))
      return r
    },
    async write(file, content) {
      if (dryRun) {
        log(`[simulation] écriture de ${rel(file)} (${Buffer.byteLength(content)} octets)`)
        return
      }
      fs.mkdirSync(path.dirname(file), { recursive: true })
      const tmp = `${file}.${process.pid}.tmp`
      fs.writeFileSync(tmp, content, 'utf8')
      fs.renameSync(tmp, file)
      log(`Écrit : ${rel(file)}`)
    },
    async mkdir(dir) {
      if (dryRun) {
        log(`[simulation] création du dossier ${rel(dir)}`)
        return
      }
      fs.mkdirSync(dir, { recursive: true })
      log(`Dossier créé : ${rel(dir)}`)
    },
    /** Télécharge une archive, vérifie sa somme SHA-256, l'extrait et installe un dossier ou un fichier. */
    async fetchArchive({ url, sumsUrl, fileName, destDir, pickDir, pickFile }) {
      if (dryRun) {
        log(`[simulation] téléchargement de ${url}`)
        log(`[simulation] vérification SHA-256 avec ${sumsUrl}`)
        log(`[simulation] installation dans ${destDir}`)
        return
      }
      const tmp = makeTempDir('dl')
      try {
        const file = path.join(tmp, fileName)
        const opts = {
          proxy: plan.proxy?.https || plan.proxy?.http || '',
          caFile: plan.proxy?.caFile || '',
          insecure: plan.proxy?.strictSsl === false,
          signal: run?.abort.signal,
          log,
          onChild: track,
          env,
        }
        const expected = await fetchExpectedSha(sumsUrl, fileName, opts)
        await download(url, file, opts)
        if (cancelled()) throw new CancelError()
        const actual = await sha256File(file)
        if (actual !== expected) {
          throw new Error(`Somme de contrôle invalide pour ${fileName} (attendue ${expected.slice(0, 12)}…, obtenue ${actual.slice(0, 12)}…) : fichier corrompu ou miroir incorrect.`)
        }
        log('Somme de contrôle SHA-256 vérifiée.')
        const out = path.join(tmp, 'x')
        await extractArchive(file, out, { log, onChild: track })
        if (pickDir) {
          const src = pickDir(out)
          if (!fs.existsSync(src)) throw new Error(`Contenu inattendu dans l'archive ${fileName}.`)
          removeDir(destDir)
          fs.mkdirSync(path.dirname(destDir), { recursive: true })
          try { fs.renameSync(src, destDir) } catch { fs.cpSync(src, destDir, { recursive: true }) }
        }
        if (pickFile) {
          const src = findFile(out, pickFile)
          if (!src) throw new Error(`${pickFile} introuvable dans l'archive ${fileName}.`)
          fs.mkdirSync(destDir, { recursive: true })
          fs.copyFileSync(src, path.join(destDir, pickFile))
          if (process.platform !== 'win32') fs.chmodSync(path.join(destDir, pickFile), 0o755)
        }
        log(`Installé dans ${destDir}`)
      } finally {
        removeDir(tmp)
      }
    },
  }
  return ctx
}

/* ------------------------------------------------------------------ détection globale */

function componentRow(plan, id, scope, stacks) {
  const def = plan.components[id] || {}
  const impl = getImplementation(id, def)
  return {
    id,
    label: def.label || id,
    description: def.description || '',
    required: Boolean(def.required),
    dependsOn: def.dependsOn || [],
    detectOnly: Boolean(impl?.detectOnly),
    stacks: plan.base.includes(id) ? ['socle'] : stacks.filter((s) => plan.stacks[s]?.components?.includes(id)),
    inScope: scope.includes(id),
  }
}

/** Détecte les composants (périmètre des stacks, ou liste fournie) et mémorise le résultat. */
export async function detectComponents({ stacks: wanted, components } = {}) {
  const plan = loadPlan()
  const stacks = normalizeStacks(plan, wanted)
  const scope = componentsForStacks(plan, stacks)
  const only = knownComponents(plan, components)
  if (Array.isArray(components) && components.length && !only.length) throw new InstallError(400, 'Aucun composant connu dans la demande.')
  const ids = topoSort(only.length ? only : scope, plan)
  const ctx = makeContext({ plan, stacks, dryRun: true })
  const detectOne = async (id) => {
    try {
      recordDetection(id, await getImplementation(id, plan.components[id]).detect(ctx))
    } catch (e) {
      recordDetection(id, { state: 'error', version: '', message: e.message })
    }
  }
  // Node d'abord (il fixe le PATH utilisé par les autres), puis le reste en parallèle.
  if (ids.includes('node')) await detectOne('node')
  await Promise.all(ids.filter((id) => id !== 'node').map(detectOne))
  const rows = ids.map((id) => ({ ...componentRow(plan, id, scope, stacks), ...state.components[id] }))
  if (!only.length) {
    state.stacks = stacks
    state.detectedAt = new Date().toISOString()
  }
  saveState()
  return { stacks, detectedAt: state.detectedAt, components: rows, ready: isReady(plan, stacks) }
}

/** Vue courante (dernier état connu, sans détection). */
export function currentView(wanted) {
  const plan = loadPlan()
  const stacks = normalizeStacks(plan, wanted || state.stacks)
  const scope = componentsForStacks(plan, stacks)
  const rows = topoSort(scope, plan).map((id) => ({
    ...componentRow(plan, id, scope, stacks),
    ...(state.components[id] || { state: 'unknown', version: '', expected: '', message: 'Pas encore vérifié.', detectedAt: null }),
  }))
  return { stacks, detectedAt: state.detectedAt, components: rows, ready: isReady(plan, stacks) }
}

export function isReady(plan = loadPlan(), stacks = state.stacks) {
  if (!state.detectedAt) return false
  const list = componentsForStacks(plan, normalizeStacks(plan, stacks))
  return list.filter((id) => plan.components[id]?.required).every((id) => state.components[id]?.state === 'ok')
}

/* ------------------------------------------------------------------ runs */

function newRunId() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${crypto.randomBytes(2).toString('hex')}`
}

export function isValidRunId(id) {
  return /^[\w-]{6,40}$/.test(String(id || ''))
}

/** Forme publique d'un run (sans processus, abonnés ni contrôleurs). */
export function publicRun(run, { logs = true } = {}) {
  if (!run) return null
  const { child, abort, subscribers, tools, logStream, ...rest } = run
  return {
    ...rest,
    components: run.components.map((c) => (logs ? { ...c } : { ...c, log: undefined, logCount: c.log?.length || 0 })),
  }
}

function persistRun(run) {
  try { writeJsonAtomic(path.join(RUNS_DIR, `${run.id}.json`), publicRun(run)) } catch (e) { console.error('[install] run non enregistré :', e.message) }
}

function broadcast(run, event, data) {
  for (const s of run.subscribers) {
    if (s.closed) run.subscribers.delete(s)
    else s.send(event, data)
  }
}

function emitLog(run, componentId, line) {
  const text = maskSecrets(line)
  const ts = new Date().toISOString()
  const c = run.components.find((x) => x.id === componentId)
  const target = c ? c.log : run.journal
  target.push(text)
  if (target.length > MAX_LOG_LINES) target.splice(0, target.length - MAX_LOG_LINES)
  try { fs.appendFileSync(path.join(RUNS_DIR, `${run.id}.log`), `[${ts.slice(11, 19)}] [${componentId || 'run'}] ${text}\n`) } catch { /* ignoré */ }
  broadcast(run, 'log', { componentId, line: text, ts })
}

function stepPayload(c) {
  const { log, ...rest } = c
  return rest
}

function emitStep(run, c) {
  broadcast(run, 'step', stepPayload(c))
  persistRun(run)
}

export function startRun({ stacks: wanted, components, force = false, dryRun = false, user } = {}) {
  if (active) throw new InstallError(409, `Une installation est déjà en cours (${active.id}).`)
  const plan = loadPlan()
  const stacks = normalizeStacks(plan, wanted)
  if (!stacks.length) throw new InstallError(400, 'Choisissez au moins une stack.')
  const { requested, order } = resolveTargets(plan, stacks, components)
  const simulate = Boolean(dryRun) || process.env.WIZARD_INSTALL_DRY === '1'
  const run = {
    id: newRunId(),
    status: 'running',
    dryRun: simulate,
    force: Boolean(force),
    stacks,
    requested,
    user: user?.username || null,
    host: os.hostname(),
    startedAt: new Date().toISOString(),
    finishedAt: null,
    durationMs: null,
    summary: null,
    components: order.map((id) => ({
      id,
      label: plan.components[id].label || id,
      required: Boolean(plan.components[id].required),
      dependsOn: (plan.components[id].dependsOn || []).filter((d) => order.includes(d)),
      state: 'pending',
      phase: null,
      version: '',
      expected: '',
      message: '',
      startedAt: null,
      finishedAt: null,
      durationMs: null,
      log: [],
    })),
    journal: [],
    tools: {},
    child: null,
    cancelRequested: false,
    abort: new AbortController(),
    subscribers: new Set(),
  }
  fs.mkdirSync(RUNS_DIR, { recursive: true })
  active = run
  persistRun(run)
  setImmediate(() => execute(run, plan).catch((e) => {
    console.error('[install] run interrompu :', e)
    finishRun(run, 'failed', e.message)
  }))
  return run
}

async function runComponent(run, plan, c) {
  const def = plan.components[c.id]
  const impl = getImplementation(c.id, def)
  const log = (line) => emitLog(run, c.id, line)
  const ctx = makeContext({ plan, stacks: run.stacks, dryRun: run.dryRun, run, log })
  const forced = run.force && (!run.requested || run.requested.includes(c.id))
  const t0 = Date.now()
  Object.assign(c, { state: 'running', phase: 'detect', startedAt: new Date().toISOString() })
  emitStep(run, c)
  try {
    const d = await impl.detect(ctx)
    recordDetection(c.id, d)
    Object.assign(c, { version: d.version || '', expected: d.expected || '', message: d.message })
    log(`Détection : ${d.state} — ${d.message}`)
    if (d.state === 'ok' && !forced) {
      Object.assign(c, { state: 'ok', message: `Déjà en place — ${d.message}` })
    } else if (impl.detectOnly || d.state === 'skipped') {
      Object.assign(c, { state: 'skipped', message: impl.detectOnly && d.state !== 'ok' ? `${d.message} (détection seule)` : d.message })
    } else {
      Object.assign(c, { phase: 'install' })
      emitStep(run, c)
      log(forced && d.state === 'ok' ? 'Réinstallation demandée.' : `Installation : ${c.label}…`)
      await impl.install(ctx)
      if (run.cancelRequested) throw new CancelError()
      Object.assign(c, { phase: 'verify' })
      emitStep(run, c)
      if (run.dryRun) {
        Object.assign(c, { state: 'simulated', message: 'Simulation : installation et vérification non exécutées.' })
      } else {
        const v = impl.verify ? await impl.verify(ctx) : await impl.detect(ctx)
        recordDetection(c.id, v)
        log(`Vérification : ${v.state} — ${v.message}`)
        Object.assign(c, v.state === 'ok'
          ? { state: 'installed', version: v.version || c.version, message: v.message }
          : { state: 'failed', message: `Installé mais la vérification échoue : ${v.message}` })
      }
    }
  } catch (e) {
    const cancelled = run.cancelRequested || e instanceof CancelError
    Object.assign(c, { state: cancelled ? 'cancelled' : 'failed', message: cancelled ? 'Annulé.' : e.message })
    log(cancelled ? 'Annulé par l\'utilisateur.' : `[erreur] ${e.message}`)
  }
  Object.assign(c, { phase: null, finishedAt: new Date().toISOString(), durationMs: Date.now() - t0 })
  emitStep(run, c)
}

async function execute(run, plan) {
  emitLog(run, null, `${run.dryRun ? 'Simulation' : 'Installation'} sur ${run.host} — stacks : ${run.stacks.join(', ')}`)
  for (const c of run.components) {
    if (run.cancelRequested) {
      Object.assign(c, { state: 'cancelled', message: 'Annulé avant démarrage.' })
      emitStep(run, c)
      continue
    }
    const blockers = c.dependsOn.filter((d) => FAILED.has(run.components.find((x) => x.id === d)?.state))
    if (blockers.length) {
      const labels = blockers.map((d) => run.components.find((x) => x.id === d).label)
      Object.assign(c, { state: 'blocked', message: `Non traité : dépend de ${labels.join(', ')} (en échec).` })
      emitStep(run, c)
      continue
    }
    await runComponent(run, plan, c)
  }
  if (!run.cancelRequested && !run.dryRun) {
    emitLog(run, null, 'Vérification finale de tous les composants…')
    const final = await detectComponents({ stacks: run.stacks }).catch(() => null)
    run.finalCheck = final && {
      ready: final.ready,
      notOk: final.components.filter((r) => r.required && r.state !== 'ok').map((r) => ({ id: r.id, label: r.label, state: r.state, message: r.message })),
    }
  }
  const failedRequired = run.components.some((c) => c.required && FAILED.has(c.state))
  const failedOptional = run.components.some((c) => !c.required && FAILED.has(c.state))
  const status = run.cancelRequested ? 'cancelled' : failedRequired ? 'failed' : failedOptional ? 'partial' : 'succeeded'
  finishRun(run, status)
}

function summarize(run) {
  const count = (s) => run.components.filter((c) => c.state === s).length
  return {
    total: run.components.length,
    ok: count('ok'),
    installed: count('installed'),
    simulated: count('simulated'),
    skipped: count('skipped'),
    failed: count('failed'),
    blocked: count('blocked'),
    cancelled: count('cancelled'),
  }
}

function finishRun(run, status, error) {
  if (run.finishedAt) return
  run.status = status
  run.error = error || null
  run.finishedAt = new Date().toISOString()
  run.durationMs = Date.parse(run.finishedAt) - Date.parse(run.startedAt)
  run.summary = summarize(run)
  state.lastRun = { id: run.id, status, finishedAt: run.finishedAt, dryRun: run.dryRun }
  saveState()
  persistRun(run)
  emitLog(run, null, `Terminé : ${status} (${Math.round(run.durationMs / 1000)} s).`)
  broadcast(run, 'done', { id: run.id, status, summary: run.summary, finalCheck: run.finalCheck || null, dryRun: run.dryRun })
  for (const s of run.subscribers) s.close()
  run.subscribers.clear()
  if (active === run) active = null
}

export function cancelRun(id) {
  const run = active && active.id === id ? active : null
  if (!run) throw new InstallError(409, 'Ce run n\'est pas en cours.')
  run.cancelRequested = true
  run.abort.abort()
  killTree(run.child)
  emitLog(run, null, 'Annulation demandée : arrêt du processus en cours…')
  return run
}

export function getRun(id) {
  if (!isValidRunId(id)) return null
  if (active?.id === id) return active
  return readJson(path.join(RUNS_DIR, `${id}.json`))
}

export function listRuns(limit = 50) {
  let files = []
  try { files = fs.readdirSync(RUNS_DIR).filter((f) => f.endsWith('.json')) } catch { return [] }
  return files
    .sort()
    .reverse()
    .slice(0, limit)
    .map((f) => readJson(path.join(RUNS_DIR, f)))
    .filter(Boolean)
    .map((r) => ({
      id: r.id,
      status: r.id === active?.id ? 'running' : r.status,
      dryRun: r.dryRun,
      force: r.force,
      stacks: r.stacks,
      requested: r.requested,
      user: r.user,
      host: r.host,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      durationMs: r.durationMs,
      summary: r.summary,
    }))
}

export function readRunLog(id) {
  if (!isValidRunId(id)) return ''
  try { return fs.readFileSync(path.join(RUNS_DIR, `${id}.log`), 'utf8') } catch { return '' }
}

/** Abonne un flux SSE : instantané, puis événements step / log / done. */
export function subscribe(id, stream) {
  const run = getRun(id)
  if (!run) return false
  stream.send('snapshot', publicRun(run))
  if (run === active) run.subscribers.add(stream)
  else {
    stream.send('done', { id: run.id, status: run.status, summary: run.summary, finalCheck: run.finalCheck || null, dryRun: run.dryRun })
    stream.close()
  }
  return true
}

/* ------------------------------------------------------------------ aperçu */

export function previewRun({ stacks: wanted, components, force = false } = {}) {
  const plan = loadPlan()
  const stacks = normalizeStacks(plan, wanted)
  const { scope, requested, order } = resolveTargets(plan, stacks, components)
  const ctx = makeContext({ plan, stacks, dryRun: true })
  const rows = order.map((id) => {
    const impl = getImplementation(id, plan.components[id])
    const known = state.components[id]
    const forced = force && (!requested || requested.includes(id))
    let action = 'install'
    if (impl.detectOnly) action = 'detect'
    else if (!known) action = 'check'
    else if (known.state === 'ok' && !forced) action = 'skip'
    else if (known.state === 'skipped') action = 'skip'
    let commands = []
    try { commands = action === 'install' || action === 'check' ? impl.describe(ctx) : [] } catch { commands = [] }
    return { ...componentRow(plan, id, scope, stacks), state: known?.state || 'unknown', message: known?.message || '', action, commands }
  })
  return {
    stacks,
    dryRun: process.env.WIZARD_INSTALL_DRY === '1',
    host: os.hostname(),
    components: rows,
    toInstall: rows.filter((r) => r.action === 'install' || r.action === 'check').length,
  }
}

export { DONE_OK }

/**
 * Gestionnaire de runs k6 non bloquant.
 *
 *   startRun({ profileId | scriptPath, overrides: { baseUrl, vus, duration }, simulate }) → meta
 *   stopRun(id), subscribe(id, sseStream), liveState(id), runningCount()
 *
 * Mode réel : spawn('k6', ['run', '--summary-export', …, '--out', 'json=…', script], { shell: false }).
 * Les secrets (jetons, mots de passe) restent dans l'environnement du processus, jamais sur la
 * ligne de commande. Le NDJSON est suivi en continu et agrégé par seconde ; les abonnés SSE
 * reçoivent « snapshot », « tick », « log », « status » puis « done ».
 */
import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import { REPO_ROOT } from '../paths.mjs'
import { HttpError } from '../http/router.mjs'
import { appendK6Run } from '../k6-run-history.mjs'
import { buildThresholdsFromAnswers, parseJourneys } from '../k6-perf-generator.mjs'
import { createAggregator, tailFile, SERIES_LIMIT } from './aggregator.mjs'
import { parseSummary, evaluateRule, flattenThresholds, verdictOf } from './summary.mjs'
import { isValidDuration, parseDurationMs, plannedDurationMs } from './durations.mjs'
import { startSimulation, SIMULATION_MAX_MS } from './simulator.mjs'
import { detectK6, k6Env } from './k6-binary.mjs'
import { getRunnableProfile, ensureProfileScript, resolveScriptPath } from './profiles.mjs'
import { newRunId, runFile, saveMeta, getMeta, writeJsonAtomic, readRunJson, relToRepo } from './store.mjs'

const MAX_CONCURRENT = 3
const LOG_LINES = 1000
const active = new Map()

const DEFAULT_THRESHOLDS = {
  http_req_duration: ['p(95)<500'],
  http_req_failed: ['rate<0.01'],
}

function sanitizeOverrides(raw = {}) {
  const out = {}
  if (raw.baseUrl) {
    let url
    try {
      url = new URL(String(raw.baseUrl).trim())
    } catch {
      throw new HttpError(400, 'URL cible invalide : saisissez une adresse complète (https://…).')
    }
    if (!/^https?:$/.test(url.protocol)) throw new HttpError(400, 'L’URL cible doit commencer par http:// ou https://.')
    // Des identifiants dans l'URL finiraient dans la commande affichée et l'historique.
    if (url.username || url.password) {
      throw new HttpError(400, 'Ne mettez pas d’identifiants dans l’URL : configurez l’authentification du profil (variables d’environnement).')
    }
    out.baseUrl = url.toString().replace(/\/$/, '')
  }
  if (raw.vus !== undefined && raw.vus !== '' && raw.vus !== null) {
    const vus = Number(raw.vus)
    if (!Number.isInteger(vus) || vus < 1 || vus > 5000) throw new HttpError(400, 'Le nombre d’utilisateurs virtuels doit être un entier entre 1 et 5000.')
    out.vus = vus
  }
  if (raw.duration) {
    const d = String(raw.duration).trim()
    if (!isValidDuration(d)) throw new HttpError(400, 'Durée invalide : utilisez le format k6, par exemple 30s, 2m ou 1m30s.')
    out.duration = d
  }
  return out
}

/** Prépare la cible : profil (script généré) ou script existant. */
function resolveTarget({ profileId, scriptPath }) {
  if (profileId) {
    const profile = getRunnableProfile(profileId)
    if (!profile) throw new HttpError(404, 'Profil introuvable : rechargez la liste des profils.')
    const written = ensureProfileScript(profile)
    return { profile, scriptRel: written.scriptPath, scriptNote: written.manualEdits ? 'Script modifié à la main : conservé tel quel.' : '' }
  }
  const rel = resolveScriptPath(scriptPath)
  if (!rel) throw new HttpError(400, 'Script introuvable : choisissez un fichier .js du dossier k6 du projet.')
  return { profile: null, scriptRel: rel, scriptNote: '' }
}

function buildConfig(profile, overrides, scriptRel) {
  const a = profile?.answers || {}
  const executor = a.executorType || 'constant-vus'
  const config = {
    scriptPath: scriptRel,
    executor: profile ? executor : 'script',
    vus: overrides.vus || Number(a.virtualUsers) || 10,
    duration: overrides.duration || a.duration || '1m',
    rampUp: a.rampUpDuration || '',
    rampDown: a.rampDownDuration || '',
    arrivalRate: Number(a.arrivalRate) || null,
    baseUrl: overrides.baseUrl || a.baseUrl || '',
    thinkAvgS: ((Number(a.thinkTimeMin) || 1) + (Number(a.thinkTimeMax) || 2)) / 2,
    journeys: profile ? parseJourneys(a).map((j) => ({ name: j.name, weight: j.weight })) : [],
  }
  config.plannedMs = plannedDurationMs(config) || 60000
  return config
}

function k6Args(meta, target) {
  const files = meta.files
  const args = ['run', '--no-color', '--summary-export', files.summaryAbs, '--out', `json=${files.ndjsonAbs}`]
  const { overrides } = meta
  if (overrides.baseUrl) args.push('-e', `BASE_URL=${overrides.baseUrl}`)
  if (target.profile) {
    if (overrides.vus) args.push('-e', `VUS=${overrides.vus}`)
    if (overrides.duration) args.push('-e', `DURATION=${overrides.duration}`)
  } else {
    // Script libre : les options --vus/--duration s'appliquent directement.
    if (overrides.vus) args.push('--vus', String(overrides.vus))
    if (overrides.duration) args.push('--duration', overrides.duration)
  }
  args.push(path.join(REPO_ROOT, target.scriptRel))
  return args
}

function processEnv(profile) {
  const a = profile?.answers || {}
  const env = k6Env(process.env)
  if (a.useProxy === 'custom' && a.proxyUrl) {
    env.HTTP_PROXY = a.proxyUrl
    env.HTTPS_PROXY = a.proxyUrl
  } else if (a.useProxy === 'no') {
    for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy']) delete env[k]
  }
  env.K6_NO_USAGE_REPORT = 'true'
  return env
}

/** Démarre un run et rend la main immédiatement. */
export async function startRun({ profileId, scriptPath, overrides: rawOverrides, simulate, user } = {}) {
  if (!profileId && !scriptPath) throw new HttpError(400, 'Choisissez un profil ou un script à lancer.')
  const overrides = sanitizeOverrides(rawOverrides)
  const k6 = await detectK6()
  // Contrôle après l'attente : deux demandes simultanées ne dépassent pas la limite.
  if (runningCount() >= MAX_CONCURRENT) {
    throw new HttpError(409, `${MAX_CONCURRENT} runs sont déjà en cours : attendez la fin de l’un d’eux ou arrêtez-en un.`)
  }
  if (simulate === false && !k6.installed) {
    throw new HttpError(409, 'k6 n’est pas installé sur ce poste : installez-le depuis la page Installation ou lancez le test en mode simulation.')
  }
  const simulated = simulate === true || !k6.installed
  const target = resolveTarget({ profileId, scriptPath })
  const id = newRunId()
  const files = {
    summaryAbs: runFile(id, 'summary.json'),
    ndjsonAbs: runFile(id, 'metrics.ndjson'),
  }
  fs.mkdirSync(path.dirname(files.summaryAbs), { recursive: true })
  const config = buildConfig(target.profile, overrides, target.scriptRel)
  const thresholdsDef = target.profile ? buildThresholdsFromAnswers(target.profile.answers || {}) : DEFAULT_THRESHOLDS

  const meta = {
    id,
    profileId: target.profile?.id || null,
    profileName: target.profile?.name || path.basename(target.scriptRel),
    builtinProfile: Boolean(target.profile?.builtin),
    scriptPath: target.scriptRel,
    simulated,
    k6Version: simulated ? '' : k6.version,
    status: 'running',
    phase: 'preparation',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    durationMs: null,
    exitCode: null,
    overrides,
    config: { ...config, journeys: undefined },
    plannedMs: simulated ? Math.min(config.plannedMs, SIMULATION_MAX_MS) : config.plannedMs,
    thresholdsDef,
    triggeredBy: user?.username || 'inconnu',
    reportDir: relToRepo(path.dirname(files.summaryAbs)),
    files: { summaryAbs: files.summaryAbs, ndjsonAbs: files.ndjsonAbs },
  }
  const args = simulated ? null : k6Args(meta, target)
  meta.command = simulated ? `◇ simulation de : k6 run ${target.scriptRel}` : `k6 ${args.map((x) => (x.includes(' ') ? `"${x}"` : x)).join(' ')}`
  saveMeta(publicFields(meta))

  const state = createState(meta)
  active.set(id, state)
  if (target.scriptNote) log(state, target.scriptNote)
  log(state, `$ ${meta.command}`)

  state.tail = tailFile(files.ndjsonAbs, (line) => state.agg.addLine(line), 1000)
  state.ticker = setInterval(() => {
    try {
      emitTicks(state)
    } catch (e) {
      log(state, `[ERREUR] Agrégation des mesures : ${e.message}`)
    }
  }, 1000)

  if (simulated) {
    state.sim = startSimulation({
      runId: id,
      ndjsonPath: files.ndjsonAbs,
      config,
      onLog: (l) => log(state, l),
      onEnd: ({ stopped }) => finalize(state, { exitCode: null, stopped }),
    })
  } else {
    launchK6(state, args, target.profile)
  }
  return publicFields(meta)
}

function createState(meta) {
  const logStream = fs.createWriteStream(runFile(meta.id, 'console.log'), { flags: 'a' })
  // Une erreur d'écriture de la console (disque plein, fichier verrouillé) ne doit pas arrêter le serveur.
  logStream.on('error', () => {})
  return {
    meta,
    agg: createAggregator(),
    series: [],
    log: [],
    listeners: new Set(),
    logStream,
    stopRequested: false,
    finished: false,
  }
}

function launchK6(state, args, profile) {
  let child
  try {
    child = spawn('k6', args, { cwd: REPO_ROOT, env: processEnv(profile), shell: false, windowsHide: true })
  } catch (e) {
    log(state, `[ERREUR] ${e.message}`)
    finalize(state, { exitCode: null, error: `Impossible de lancer k6 : ${e.message}` })
    return
  }
  state.child = child
  const pipe = (stream) => {
    let rest = ''
    stream.setEncoding('utf8')
    stream.on('data', (chunk) => {
      const lines = (rest + chunk).split(/\r?\n|\r/)
      rest = lines.pop()
      for (const l of lines) if (l.trim()) log(state, l)
    })
    stream.on('end', () => { if (rest.trim()) log(state, rest) })
  }
  pipe(child.stdout)
  pipe(child.stderr)
  child.on('error', (e) => {
    const msg = e.code === 'ENOENT'
      ? 'k6 est introuvable dans le PATH : vérifiez l’installation (page Installation).'
      : `Erreur au lancement de k6 : ${e.message}`
    log(state, `[ERREUR] ${msg}`)
    finalize(state, { exitCode: null, error: msg })
  })
  child.on('close', (code) => finalize(state, { exitCode: code, stopped: state.stopRequested }))
}

function log(state, line) {
  const text = String(line).replace(/\u001b\[[0-9;]*m/g, '')
  state.log.push(text)
  if (state.log.length > LOG_LINES) state.log.splice(0, state.log.length - LOG_LINES)
  // Des lignes peuvent encore arriver après la clôture (fin de flux du processus) : pas d'écriture après end().
  if (!state.logStream.writableEnded) state.logStream.write(`${text}\n`)
  broadcast(state, 'log', { lines: [text] })
}

function broadcast(state, event, data) {
  for (const s of state.listeners) {
    if (s.closed) {
      state.listeners.delete(s)
      continue
    }
    try {
      s.send(event, data)
    } catch {
      state.listeners.delete(s)
    }
  }
}

function phaseOf(meta, elapsedMs) {
  const c = meta.config
  const planned = meta.plannedMs || 1
  const ratio = planned / Math.max(1, c.plannedMs || planned)
  if (c.executor === 'ramping-vus') {
    const up = parseDurationMs(c.rampUp) * ratio
    const down = parseDurationMs(c.rampDown) * ratio
    if (elapsedMs < up) return 'rampup'
    if (elapsedMs > planned - down) return 'rampdown'
  }
  return elapsedMs < 1500 ? 'rampup' : 'steady'
}

function emitTicks(state, final = false) {
  const points = state.agg.flush(final)
  if (points.length) {
    state.series.push(...points)
    if (state.series.length > SERIES_LIMIT) state.series.splice(0, state.series.length - SERIES_LIMIT)
  }
  const elapsedMs = Date.now() - Date.parse(state.meta.startedAt)
  if (!state.finished) state.meta.phase = phaseOf(state.meta, elapsedMs)
  broadcast(state, 'tick', { points, live: liveOf(state, elapsedMs) })
}

function liveOf(state, elapsedMs) {
  const last = state.series[state.series.length - 1] || null
  const recent = state.series.slice(-5)
  const avg = (k) => (recent.length ? recent.reduce((s, p) => s + (p[k] || 0), 0) / recent.length : null)
  return {
    elapsedMs,
    plannedMs: state.meta.plannedMs,
    progress: state.meta.plannedMs ? Math.min(1, elapsedMs / state.meta.plannedMs) : null,
    phase: state.meta.phase,
    vus: last?.vus ?? 0,
    rps: avg('rps'),
    p95: last?.p95 ?? null,
    errorRate: avg('errorRate'),
    checksRate: last?.checksRate ?? null,
  }
}

/** Résumé : summary.json de k6 si présent, sinon reconstitué depuis le flux (seuils réévalués). */
function buildSummary(state, durationMs) {
  const exported = readRunJson(state.meta.id, 'summary.json')
  if (exported?.metrics && !state.meta.simulated) return { summary: exported, source: 'k6' }
  const summary = state.agg.toSummary(durationMs)
  for (const { metric, rule } of flattenThresholds(state.meta.thresholdsDef)) {
    const def = summary.metrics[metric] || (summary.metrics[metric] = {})
    const res = evaluateRule(def, rule)
    def.thresholds = { ...(def.thresholds || {}), [rule]: res ? !res.ok : false }
  }
  writeJsonAtomic(state.meta.files.summaryAbs, summary)
  return { summary, source: state.meta.simulated ? 'simulation' : 'stream' }
}

/**
 * Clôture d'un run (appelée depuis des gestionnaires d'événements de processus) : une erreur
 * inattendue est consignée sur le run au lieu de faire tomber le serveur.
 */
function finalize(state, outcome) {
  if (state.finished) return
  state.finished = true
  clearInterval(state.ticker)
  try {
    complete(state, outcome)
  } catch (e) {
    const meta = state.meta
    Object.assign(meta, {
      status: 'error',
      phase: 'done',
      error: `Analyse du run impossible : ${e.message}`,
      finishedAt: meta.finishedAt || new Date().toISOString(),
    })
    try { saveMeta(publicFields(meta)) } catch { /* disque indisponible */ }
    broadcast(state, 'done', { run: publicFields(meta) })
    for (const s of state.listeners) s.close()
    state.logStream.end()
    setTimeout(() => active.delete(meta.id), 30000)
  }
}

function complete(state, { exitCode, stopped = false, error = null }) {
  const meta = state.meta
  try {
    state.tail?.stop()
  } catch { /* lecture finale best effort */ }
  emitTicks(state, true)
  const finishedAt = new Date()
  const durationMs = finishedAt - Date.parse(meta.startedAt)
  const { summary, source } = buildSummary(state, durationMs)
  const parsed = parseSummary(summary)
  const noData = !state.agg.pointsSeen && !error && !stopped
  const simulatedExit = meta.simulated ? (parsed.thresholds.some((t) => !t.ok) ? 99 : 0) : exitCode
  Object.assign(meta, {
    phase: 'done',
    finishedAt: finishedAt.toISOString(),
    durationMs,
    exitCode: simulatedExit,
    metrics: parsed.metrics,
    thresholds: parsed.thresholds,
    summarySource: source,
    error: error || (noData && exitCode !== 0 ? `k6 s’est arrêté (code ${exitCode}) sans produire de mesure : consultez la console.` : null),
  })
  meta.status = verdictOf({ thresholds: parsed.thresholds, exitCode: simulatedExit, stopped, error: meta.error })
  writeJsonAtomic(runFile(meta.id, 'series.json'), state.series)
  saveMeta(publicFields(meta))
  recordHistory(meta)
  log(state, `— Run terminé : ${STATUS_LABELS[meta.status]} (${Math.round(durationMs / 1000)} s).`)
  broadcast(state, 'done', { run: publicFields(meta) })
  for (const s of state.listeners) s.close()
  state.logStream.end()
  setTimeout(() => active.delete(meta.id), 30000)
}

export const STATUS_LABELS = {
  running: 'en cours',
  passed: 'réussi',
  failed: 'seuils non respectés',
  error: 'erreur',
  stopped: 'arrêté',
}

/** Consigne le run dans l'historique V2 (mêmes identifiants : pas de doublon à la fusion). */
function recordHistory(meta) {
  try {
    appendK6Run({
      id: meta.id,
      profileId: meta.profileId,
      profileName: meta.profileName,
      campaignName: meta.profileName,
      runAt: meta.startedAt,
      status: meta.status,
      command: meta.command,
      reportPath: meta.reportDir,
      notes: meta.simulated ? 'Exécution simulée (◇)' : 'Exécution k6',
      triggeredBy: 'perf',
      summary: {
        measured: true,
        simulated: meta.simulated,
        durationMs: meta.durationMs,
        exitCode: meta.exitCode,
        vus: meta.config.vus,
        duration: meta.config.duration,
        p95Ms: meta.metrics?.p95,
        metrics: meta.metrics,
      },
    })
  } catch { /* l'historique V2 est secondaire */ }
}

/** Méta-données publiables (sans chemins absolus). */
function publicFields(meta) {
  const { files, ...rest } = meta
  return { ...rest, files: files ? { summary: relToRepo(files.summaryAbs), ndjson: relToRepo(files.ndjsonAbs) } : undefined }
}

export function stopRun(id) {
  const state = active.get(id)
  if (!state || state.finished) {
    if (getMeta(id)) throw new HttpError(409, 'Ce run est déjà terminé.')
    throw new HttpError(404, 'Run introuvable.')
  }
  state.stopRequested = true
  log(state, 'Arrêt demandé par l’utilisateur…')
  if (state.sim) state.sim.stop()
  else if (state.child?.pid) {
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/PID', String(state.child.pid), '/T', '/F'], { windowsHide: true, shell: false })
      killer.on('error', (e) => {
        log(state, `[ERREUR] taskkill indisponible (${e.message}) : arrêt direct du processus k6.`)
        try { state.child.kill() } catch { /* déjà terminé */ }
      })
    } else {
      state.child.kill('SIGINT')
      setTimeout(() => { if (!state.finished) state.child.kill('SIGKILL') }, 15000)
    }
  }
  return publicFields(state.meta)
}

export function isActive(id) {
  const s = active.get(id)
  return Boolean(s && !s.finished)
}

export function runningCount() {
  let n = 0
  for (const s of active.values()) if (!s.finished) n += 1
  return n
}

/** État vivant d'un run (série et console en mémoire) ou null. */
export function liveState(id) {
  const s = active.get(id)
  if (!s) return null
  return { run: publicFields(s.meta), series: s.series, log: s.log.slice(-300), live: liveOf(s, Date.now() - Date.parse(s.meta.startedAt)) }
}

/** Abonne un flux SSE ; renvoie false si le run n'est pas (ou plus) actif. */
export function subscribe(id, stream) {
  const s = active.get(id)
  if (!s) return false
  stream.send('snapshot', liveState(id))
  if (s.finished) {
    stream.send('done', { run: publicFields(s.meta) })
    stream.close()
    return true
  }
  s.listeners.add(stream)
  return true
}

export { publicFields }

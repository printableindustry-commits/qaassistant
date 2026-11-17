/**
 * Mode simulation (« ◇ simulé ») : produit, sans aucune requête réseau, un flux NDJSON au format
 * de k6 (--out json) avec des métriques synthétiques plausibles, et une console imitant k6.
 * Le reste de la chaîne (agrégation, résumé, seuils, historique) est identique au mode réel.
 *
 * Modèle : la latence moyenne croît avec la charge (capacité tirée au hasard par run), les
 * durées suivent une loi log-normale, les erreurs apparaissent au-delà de la capacité.
 * La durée est ramenée à 60 s au plus ; la forme de charge (montée, palier, descente) est conservée.
 */
import fs from 'fs'
import { parseDurationMs } from './durations.mjs'

export const SIMULATION_MAX_MS = 60000
const MAX_REQ_PER_SEC = 400

function seededRandom(seedText) {
  let h = 2166136261
  for (const c of seedText) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return () => {
    h += 0x6D2B79F5
    let t = h
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function gaussian(rand) {
  const u = Math.max(rand(), 1e-9)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
}

/** Forme de charge : fraction (0..1) des VUs cibles à l'instant f (0..1 de la durée totale). */
function loadShape(config) {
  const total = config.plannedMs || 1
  if (config.executor !== 'ramping-vus') return () => 1
  const up = (parseDurationMs(config.rampUp) || 0) / total
  const down = (parseDurationMs(config.rampDown) || 0) / total
  return (f) => {
    if (up > 0 && f < up) return Math.max(0.05, f / up)
    if (down > 0 && f > 1 - down) return Math.max(0, (1 - f) / down)
    return 1
  }
}

/**
 * Démarre une simulation. config : { vus, executor, arrivalRate, plannedMs, rampUp, rampDown,
 * thinkAvgS, journeys }. Appelle onLog(ligne) et onEnd() ; renvoie { stop() }.
 */
export function startSimulation({ runId, ndjsonPath, config, onLog, onEnd }) {
  const rand = seededRandom(runId)
  const wallMs = Math.min(config.plannedMs || 30000, SIMULATION_MAX_MS)
  const seconds = Math.max(5, Math.round(wallMs / 1000))
  const capacity = 30 + rand() * 120
  const baseLatency = 70 + rand() * 120
  const shape = loadShape(config)
  const journeys = config.journeys?.length ? config.journeys : [{ name: 'navigation', weight: 100 }]
  const totalWeight = journeys.reduce((s, j) => s + j.weight, 0) || 1
  let second = 0
  let iterationsTotal = 0
  let stopped = false
  let ended = false

  const out = fs.createWriteStream(ndjsonPath, { flags: 'a' })
  out.on('error', (e) => {
    onLog(`[ERREUR] Écriture des mesures simulées impossible : ${e.message}`)
    finish()
  })
  const write = (metric, value, time, tags = {}) => {
    out.write(`${JSON.stringify({ type: 'Point', metric, data: { time, value, tags } })}\n`)
  }

  onLog('◇ Mode simulation : aucune requête n’est envoyée, les métriques sont synthétiques.')
  onLog(`  exécution : ${config.executor}, ${config.vus} VUs, durée prévue ${Math.round((config.plannedMs || 0) / 1000)} s (simulée en ${seconds} s)`)
  onLog(`  script    : ${config.scriptPath}`)
  onLog('')

  function pickJourney() {
    let r = rand() * totalWeight
    for (const j of journeys) {
      r -= j.weight
      if (r <= 0) return j.name
    }
    return journeys[0].name
  }

  function tick() {
    if (stopped || ended) return
    const f = second / seconds
    const vus = Math.max(1, Math.round(config.vus * shape(f)))
    const pressure = vus / capacity
    const meanLatency = baseLatency * (1 + 0.8 * pressure ** 2) * (1 + 0.08 * gaussian(rand))
    const burst = rand() < 0.04 ? 2.5 : 1
    const thinkS = config.thinkAvgS ?? 1.5
    const rate = config.executor === 'constant-arrival-rate' && config.arrivalRate
      ? config.arrivalRate
      : vus / (thinkS + meanLatency / 1000)
    const reqCount = Math.min(MAX_REQ_PER_SEC, Math.max(0, Math.round(rate * (0.9 + 0.2 * rand()))))
    const errorProb = Math.min(0.6, 0.002 + Math.max(0, pressure - 1) * 0.04 + (burst > 1 ? 0.01 : 0))
    const now = Date.now()
    const time = new Date(now).toISOString()

    write('vus', vus, time)
    write('vus_max', config.vus, time)
    let failed = 0
    for (let i = 0; i < reqCount; i += 1) {
      const t = new Date(now + Math.floor((i / Math.max(1, reqCount)) * 990)).toISOString()
      const tags = { parcours: pickJourney(), method: 'GET', status: '200' }
      const isError = rand() < errorProb
      const d = Math.max(3, meanLatency * burst * Math.exp(0.45 * gaussian(rand) - 0.1))
      if (isError) {
        failed += 1
        tags.status = rand() < 0.5 ? '503' : '500'
      }
      write('http_reqs', 1, t, tags)
      write('http_req_duration', Math.round(d * 100) / 100, t, tags)
      write('http_req_failed', isError ? 1 : 0, t, tags)
      write('checks', isError ? 0 : 1, t, { check: 'statut 2xx/3xx' })
      write('checks', 1, t, { check: 'corps non vide' })
      write('iterations', 1, t)
      write('data_received', 1800 + Math.round(rand() * 2400), t)
      write('data_sent', 220, t)
    }
    iterationsTotal += reqCount
    second += 1
    if (second % 5 === 0 || second === seconds) {
      const elapsed = `${Math.floor(second / 60)}m${String(second % 60).padStart(2, '0')}.0s`
      onLog(`running (${elapsed}), ${String(vus).padStart(3)}/${config.vus} VUs, ${iterationsTotal} complete and 0 interrupted iterations${failed ? ` — ${failed} erreur(s) sur la dernière seconde` : ''}`)
    }
    if (second >= seconds) finish()
  }

  const timer = setInterval(tick, 1000)
  function finish() {
    if (ended) return
    ended = true
    clearInterval(timer)
    if (out.destroyed) onEnd({ stopped })
    else out.end(() => onEnd({ stopped }))
  }

  return {
    stop() {
      if (stopped) return
      stopped = true
      onLog('◇ Arrêt demandé : simulation interrompue.')
      finish()
    },
  }
}

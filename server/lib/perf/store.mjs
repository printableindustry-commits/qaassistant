/**
 * Stockage du module performance.
 *  - Runs : <REPO_ROOT>/reports/k6/<runId>/ (meta.json, summary.json, metrics.ndjson, series.json, console.log)
 *  - Réglages : CONF_DIR/perf/settings.json ({ baselines: { profileId: runId }, regressionPct })
 * Un index en mémoire des méta-données (chargé une fois) garde getPerfSummary() synchrone et rapide.
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { REPO_ROOT, CONF_DIR } from '../paths.mjs'

export const RUNS_DIR = path.join(REPO_ROOT, 'reports', 'k6')
const SETTINGS_FILE = path.join(CONF_DIR, 'perf', 'settings.json')
const DEFAULT_SETTINGS = { baselines: {}, regressionPct: 10 }
const RUN_ID_RE = /^\d{8}-\d{6}-[a-f0-9]{4}$/

const index = new Map()
let loaded = false

/** Pause synchrone courte (renommage refusé par un antivirus ou OneDrive sous Windows). */
function pauseSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** Écriture atomique d'un texte : fichier temporaire puis renommage (réessayé si verrouillé). */
export function writeFileAtomic(file, text, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`
  fs.writeFileSync(tmp, text, { encoding: 'utf8', mode })
  for (let attempt = 0; ; attempt += 1) {
    try {
      fs.renameSync(tmp, file)
      return
    } catch (e) {
      if (attempt >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) {
        try { fs.unlinkSync(tmp) } catch { /* déjà absent */ }
        throw e
      }
      pauseSync(40 * (attempt + 1))
    }
  }
}

export function writeJsonAtomic(file, data, mode) {
  writeFileAtomic(file, `${JSON.stringify(data, null, 2)}\n`, mode)
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

export function isValidRunId(id) {
  return typeof id === 'string' && RUN_ID_RE.test(id)
}

/** Identifiant lisible et triable : 20261117-143012-ab12. */
export function newRunId() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  return `${stamp}-${crypto.randomBytes(2).toString('hex')}`
}

export function runDir(id) {
  if (!isValidRunId(id)) throw new Error('Identifiant de run invalide')
  return path.join(RUNS_DIR, id)
}

export const runFile = (id, name) => path.join(runDir(id), name)
export const relToRepo = (abs) => path.relative(REPO_ROOT, abs).replace(/\\/g, '/')

/** Charge l'index ; un run resté « running » sans processus (redémarrage) est marqué interrompu. */
function ensureLoaded() {
  if (loaded) return
  loaded = true
  if (!fs.existsSync(RUNS_DIR)) return
  for (const name of fs.readdirSync(RUNS_DIR)) {
    if (!isValidRunId(name)) continue
    const meta = readJson(path.join(RUNS_DIR, name, 'meta.json'))
    if (!meta) continue
    if (meta.status === 'running') {
      meta.status = 'error'
      meta.error = 'Exécution interrompue : le serveur a redémarré pendant le test.'
      meta.finishedAt = meta.finishedAt || meta.updatedAt || meta.startedAt
      writeJsonAtomic(path.join(RUNS_DIR, name, 'meta.json'), meta)
    }
    index.set(meta.id, meta)
  }
}

export function saveMeta(meta) {
  ensureLoaded()
  meta.updatedAt = new Date().toISOString()
  writeJsonAtomic(runFile(meta.id, 'meta.json'), meta)
  index.set(meta.id, meta)
  return meta
}

export function getMeta(id) {
  ensureLoaded()
  return isValidRunId(id) ? index.get(id) || null : null
}

/** Méta-données des runs, du plus récent au plus ancien. */
export function listMetas() {
  ensureLoaded()
  return [...index.values()].sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))
}

export function readRunJson(id, name) {
  return isValidRunId(id) ? readJson(runFile(id, name)) : null
}

export function readRunText(id, name, maxBytes = 200000) {
  if (!isValidRunId(id)) return ''
  try {
    const file = runFile(id, name)
    const size = fs.statSync(file).size
    const fd = fs.openSync(file, 'r')
    const len = Math.min(size, maxBytes)
    const buf = Buffer.alloc(len)
    fs.readSync(fd, buf, 0, len, size - len)
    fs.closeSync(fd)
    return buf.toString('utf8')
  } catch {
    return ''
  }
}

export function deleteRunFiles(id) {
  ensureLoaded()
  fs.rmSync(runDir(id), { recursive: true, force: true })
  index.delete(id)
}

export function getSettings() {
  const raw = readJson(SETTINGS_FILE, {}) || {}
  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    baselines: { ...(raw.baselines || {}) },
  }
}

export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch }
  writeJsonAtomic(SETTINGS_FILE, next)
  return next
}

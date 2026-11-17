/**
 * Sessions d'exploration : persistance, flux d'événements et contrat pour Xray (docs/V3-ARCHITECTURE.md §5.2).
 *
 * Stockage : <REPO_ROOT>/.wizard-qa/explore/sessions/<id>/
 *   session.json  — état complet (sans aucun mot de passe : les valeurs connues sont remplacées par leur marqueur)
 *   events.jsonl  — journal des événements (tronqué au-delà de ~1,5 Mo ; les captures n'y figurent pas)
 *   shots/*.jpg   — dernières captures (20 au plus)
 *
 * Une session interrompue par un redémarrage du serveur est relue avec le statut « stopped ».
 *   getSessionArtifact(id) → { id, storyKey, status, relPath, code, steps, scenarios, target: { name, baseUrl } } | null
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { REPO_ROOT } from '../paths.mjs'
import { writeAtomic } from '../jira/stories.mjs'

export const SESSIONS_DIR = path.join(REPO_ROOT, '.wizard-qa', 'explore', 'sessions')
export const STATUSES = ['draft', 'planning', 'exploring', 'needs-human', 'recording', 'review', 'replaying', 'validated', 'failed', 'stopped']
export const ACTIVE_STATUSES = new Set(['planning', 'exploring', 'needs-human', 'recording', 'replaying'])
export const STATUS_LABEL = {
  draft: 'Brouillon',
  planning: 'Préparation du plan',
  exploring: 'Exploration en cours',
  'needs-human': 'Prise de main attendue',
  recording: 'Enregistrement du testeur',
  review: 'À relire',
  replaying: 'Rejeu en cours',
  validated: 'Validé',
  failed: 'Échec',
  stopped: 'Arrêté',
}
const ID_RE = /^[a-z0-9][a-z0-9-]{5,80}$/
const MAX_EVENTS_BYTES = 1.5 * 1024 * 1024
const KEEP_EVENT_LINES = 1500
const MAX_SHOTS = 20
const SHOT_MIN_INTERVAL_MS = 2500

const records = new Map()   // id → enregistrement en mémoire (sessions créées ou relues par ce processus)
const runtimes = new Map()  // id → { listeners, secrets, browser, … } (non persisté)

const dirOf = (id) => path.join(SESSIONS_DIR, id)
const fileOf = (id) => path.join(dirOf(id), 'session.json')

export function isValidId(id) {
  return ID_RE.test(String(id || ''))
}

/** État d'exécution non persisté (navigateur, écouteurs, secrets connus). */
export function runtimeOf(id) {
  let rt = runtimes.get(id)
  if (!rt) {
    rt = { listeners: new Set(), secrets: new Map(), browser: null, lastScreenshot: null, lastShotSavedAt: 0, shotSeq: 0, busy: null, abort: null, recording: [] }
    runtimes.set(id, rt)
  }
  return rt
}

/** Secrets de la session (valeur → marqueur) : servent uniquement à expurger ce qui est écrit ou diffusé. */
export function setSessionSecrets(id, secrets) {
  const rt = runtimeOf(id)
  rt.secrets = new Map()
  for (const [key, val] of Object.entries(secrets || {})) {
    if (val && String(val).length >= 3 && key.endsWith(':password')) rt.secrets.set(String(val), `{{${key}}}`)
  }
}

function redactString(s, rt) {
  if (typeof s !== 'string' || !rt || !rt.secrets.size || s.startsWith('data:image/')) return s
  let out = s
  for (const [val, marker] of rt.secrets) if (out.includes(val)) out = out.split(val).join(marker)
  return out
}

export function redact(id, value) {
  const rt = runtimes.get(id)
  if (!rt || !rt.secrets.size) return value
  return JSON.parse(JSON.stringify(value, (k, v) => (typeof v === 'string' ? redactString(v, rt) : v)))
}

// ---------- Persistance ----------
function persist(rec) {
  rec.updatedAt = new Date().toISOString()
  writeAtomic(fileOf(rec.id), redact(rec.id, rec))
}

export function saveSession(rec) {
  records.set(rec.id, rec)
  persist(rec)
  return rec
}

function load(id) {
  if (!isValidId(id)) return null
  if (records.has(id)) return records.get(id)
  let rec
  try {
    rec = JSON.parse(fs.readFileSync(fileOf(id), 'utf8'))
  } catch {
    return null
  }
  if (!rec || rec.id !== id) return null
  // session interrompue par un redémarrage du serveur
  if (ACTIVE_STATUSES.has(rec.status)) {
    rec.status = 'stopped'
    rec.statusReason = 'Session interrompue par un redémarrage du serveur.'
    rec.needsHuman = null
    try { persist(rec) } catch { /* lecture seule */ }
  }
  records.set(id, rec)
  return rec
}

export function getSession(id) {
  return load(String(id || ''))
}

export function newSessionId() {
  const d = new Date()
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`
  return `${stamp}-${crypto.randomBytes(3).toString('hex')}`
}

export function createSession(fields) {
  const now = new Date().toISOString()
  const rec = {
    id: newSessionId(),
    version: 1,
    status: 'draft',
    statusReason: '',
    createdAt: now,
    updatedAt: now,
    chat: [],
    plan: { source: 'rule', scenarios: [] },
    scenarios: [],
    progress: { scenarioIndex: 0, stepIndex: 0, iteration: 0 },
    needsHuman: null,
    code: '',
    relPath: '',
    replay: null,
    validatedAt: null,
    validatedBy: null,
    lastUrl: '',
    ...fields,
  }
  fs.mkdirSync(dirOf(rec.id), { recursive: true })
  return saveSession(rec)
}

/** Toutes les sessions (récentes d'abord), éventuellement filtrées par récit. */
export function listSessions({ storyKey } = {}) {
  let ids = []
  try {
    ids = fs.readdirSync(SESSIONS_DIR).filter(isValidId)
  } catch {
    ids = []
  }
  for (const id of records.keys()) if (!ids.includes(id)) ids.push(id)
  const key = storyKey ? String(storyKey).toUpperCase() : null
  return ids.map(load).filter(Boolean)
    .filter((r) => !key || r.storyKey === key)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
}

export function canAccess(rec, user) {
  if (!rec || !user) return false
  return user.role === 'admin' || rec.createdBy === user.username
}

/** Session active (navigateur ouvert ou statut actif) d'un utilisateur sur une cible. */
export function findActive({ targetId, username }) {
  for (const rec of records.values()) {
    if (rec.createdBy !== username || rec.target?.id !== targetId) continue
    const rt = runtimes.get(rec.id)
    if (ACTIVE_STATUSES.has(rec.status) || (rt && rt.browser && !rt.browser.closed)) return rec
  }
  return null
}

// ---------- Événements ----------
function appendEvent(rec, type, data) {
  const file = path.join(dirOf(rec.id), 'events.jsonl')
  const line = JSON.stringify({ at: new Date().toISOString(), type, data }) + '\n'
  try {
    fs.mkdirSync(dirOf(rec.id), { recursive: true })
    fs.appendFileSync(file, line, 'utf8')
    const size = fs.statSync(file).size
    if (size > MAX_EVENTS_BYTES) {
      const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
      const kept = lines.slice(-KEEP_EVENT_LINES)
      const tmp = `${file}.tmp`
      fs.writeFileSync(tmp, JSON.stringify({ at: new Date().toISOString(), type: 'log', data: { text: `Journal tronqué : ${lines.length - kept.length} événement(s) plus ancien(s) supprimé(s).` } }) + '\n' + kept.join('\n') + '\n', 'utf8')
      fs.renameSync(tmp, file)
    }
  } catch { /* journal facultatif */ }
}

function saveShot(rec, rt, dataUrl) {
  const now = Date.now()
  if (now - rt.lastShotSavedAt < SHOT_MIN_INTERVAL_MS) return null
  rt.lastShotSavedAt = now
  const m = /^data:image\/jpeg;base64,(.+)$/.exec(String(dataUrl || ''))
  if (!m) return null
  try {
    const dir = path.join(dirOf(rec.id), 'shots')
    fs.mkdirSync(dir, { recursive: true })
    const name = `${String(++rt.shotSeq).padStart(5, '0')}-${now}.jpg`
    fs.writeFileSync(path.join(dir, name), Buffer.from(m[1], 'base64'))
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jpg')).sort()
    for (const f of files.slice(0, Math.max(0, files.length - MAX_SHOTS))) fs.unlinkSync(path.join(dir, f))
    return name
  } catch {
    return null
  }
}

/** Diffuse un événement aux abonnés (SSE) et l'inscrit au journal (expurgé). */
export function emit(rec, type, data) {
  const rt = runtimeOf(rec.id)
  const safe = redact(rec.id, data)
  if (type === 'screenshot') {
    rt.lastScreenshot = safe
    const file = saveShot(rec, rt, safe && safe.dataUrl)
    if (file) appendEvent(rec, 'screenshot', { file, url: safe.url || '' })
  } else if (type !== 'snapshot-image') {
    appendEvent(rec, type, safe)
  }
  for (const fn of rt.listeners) {
    try { fn(type, safe) } catch { /* abonné fermé */ }
  }
}

export function subscribe(id, fn) {
  const rt = runtimeOf(id)
  rt.listeners.add(fn)
  return () => rt.listeners.delete(fn)
}

/** Derniers événements du journal (hors captures), pour réafficher l'historique. */
export function readEvents(id, { limit = 200 } = {}) {
  if (!isValidId(id)) return []
  try {
    const lines = fs.readFileSync(path.join(dirOf(id), 'events.jsonl'), 'utf8').split('\n').filter(Boolean)
    return lines.slice(-limit).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  } catch {
    return []
  }
}

// ---------- Vues ----------
export function flattenSteps(rec) {
  return (rec.scenarios || []).flatMap((sc) => (sc.steps || []).map((st) => ({ ...st, scenario: sc.name })))
}

export function publicSession(rec) {
  if (!rec) return null
  const rt = runtimes.get(rec.id)
  // jamais de mot de passe en clair dans une réponse (même s'il a été saisi dans le chat par le testeur)
  return {
    ...redact(rec.id, rec),
    statusLabel: STATUS_LABEL[rec.status] || rec.status,
    browserOpen: Boolean(rt && rt.browser && !rt.browser.closed),
    browserHeadless: rt && rt.browser ? Boolean(rt.browserHeadless) : null,
    busy: rt ? rt.busy : null,
    stepCount: flattenSteps(rec).length,
  }
}

export function summarySession(rec) {
  return {
    id: rec.id,
    storyKey: rec.storyKey,
    status: rec.status,
    statusLabel: STATUS_LABEL[rec.status] || rec.status,
    target: rec.target ? { id: rec.target.id, name: rec.target.name } : null,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
    createdBy: rec.createdBy,
    stepCount: flattenSteps(rec).length,
    relPath: rec.relPath || '',
    validatedAt: rec.validatedAt || null,
    replayOk: rec.replay ? Boolean(rec.replay.ok) : null,
  }
}

/** Contrat pour Xray (§5.2). */
export function getSessionArtifact(id) {
  const rec = getSession(id)
  if (!rec) return null
  return {
    id: rec.id,
    storyKey: rec.storyKey,
    status: rec.status,
    relPath: rec.relPath || '',
    code: rec.code || '',
    steps: flattenSteps(rec),
    scenarios: rec.scenarios || [],
    target: rec.target ? { name: rec.target.name, baseUrl: rec.target.baseUrl } : null,
  }
}

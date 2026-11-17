/**
 * Stockage local des récits scannés : <REPO_ROOT>/.wizard-qa/jira/stories.json (+ scans.json, historique).
 * Contrat (docs/V3-ARCHITECTURE.md §4.2) :
 *   listStories({ q, status, epic, label }) → Story[] (filtrés, triés par clé)
 *   getStory(key)                           → Story | null
 *   getScanInfo()                           → { scannedAt, projectKey, jql, count, source, baseUrl } | null
 */
import fs from 'fs'
import path from 'path'
import { REPO_ROOT } from '../paths.mjs'

export const JIRA_DATA_DIR = path.join(REPO_ROOT, '.wizard-qa', 'jira')
const STORIES_FILE = path.join(JIRA_DATA_DIR, 'stories.json')
const HISTORY_FILE = path.join(JIRA_DATA_DIR, 'scans.json')
const HISTORY_MAX = 30

let cache = { mtimeMs: -1, data: null }

/** Pause synchrone courte (nouvelle tentative de renommage sous Windows). */
function pauseSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** Écriture JSON atomique (.tmp puis rename) ; mode 0o600 pour un fichier contenant un secret. */
export function writeAtomic(file, data, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), mode ? { encoding: 'utf8', mode } : 'utf8')
  // Sous Windows (OneDrive, antivirus, lecture en cours), le remplacement peut échouer brièvement (EPERM / EBUSY).
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(tmp, file)
      return
    } catch (e) {
      if (attempt >= 4 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) {
        try { fs.unlinkSync(tmp) } catch { /* déjà absent */ }
        throw e
      }
      pauseSync(100 * (attempt + 1))
    }
  }
}

function load() {
  let stat
  try {
    stat = fs.statSync(STORIES_FILE)
  } catch {
    cache = { mtimeMs: -1, data: null }
    return null
  }
  if (cache.data && cache.mtimeMs === stat.mtimeMs) return cache.data
  try {
    const data = JSON.parse(fs.readFileSync(STORIES_FILE, 'utf8'))
    cache = { mtimeMs: stat.mtimeMs, data }
    return data
  } catch {
    return null
  }
}

/** Normalise pour la recherche : minuscules, sans accents. */
export function fold(text) {
  return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** Tri naturel des clés : P0326-9 avant P0326-10. */
export function compareKeys(a, b) {
  const [pa, na] = String(a).split(/-(?=\d+$)/)
  const [pb, nb] = String(b).split(/-(?=\d+$)/)
  if (pa !== pb) return pa.localeCompare(pb)
  return (Number(na) || 0) - (Number(nb) || 0) || String(a).localeCompare(String(b))
}

function matches(story, { q, status, epic, label }) {
  if (status) {
    const wanted = String(status).split(',').map(fold)
    if (!wanted.includes(fold(story.status))) return false
  }
  if (epic) {
    if (epic === 'none' ? story.epic : story.epic?.key !== epic) return false
  }
  if (label && !(story.labels || []).some((l) => fold(l) === fold(label))) return false
  if (q) {
    const hay = fold([story.key, story.summary, story.descriptionText, ...(story.acceptanceCriteria || [])].join('\n'))
    if (!fold(q).split(/\s+/).filter(Boolean).every((term) => hay.includes(term))) return false
  }
  return true
}

export function listStories(filters = {}) {
  const data = load()
  if (!data) return []
  if (!Array.isArray(data.stories)) return []
  return data.stories.filter((s) => matches(s, filters || {})).sort((a, b) => compareKeys(a.key, b.key))
}

export function getStory(key) {
  const data = load()
  if (!data || !key) return null
  const k = String(key).toUpperCase()
  return (Array.isArray(data.stories) ? data.stories : []).find((s) => String(s.key).toUpperCase() === k) || null
}

export function getScanInfo() {
  const scan = load()?.scan
  if (!scan) return null
  return {
    scannedAt: scan.scannedAt,
    projectKey: scan.projectKey,
    jql: scan.jql,
    count: scan.count,
    source: scan.source,
    baseUrl: scan.baseUrl,
    deployment: scan.deployment || '',
    url: scan.url || '',
  }
}

/** Détails internes du dernier scan (épopées, champs détectés, durée…). */
export function getScanDetails() {
  const data = load()
  return data ? { scan: data.scan, epics: data.epics || [] } : null
}

export function getScanHistory() {
  try {
    const list = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'))
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

/** Enregistre le résultat d'un scan (remplace le précédent) et l'ajoute à l'historique. */
export function saveScanResult({ scan, stories, epics }) {
  const sorted = [...stories].sort((a, b) => compareKeys(a.key, b.key))
  const full = { ...scan, count: sorted.length }
  writeAtomic(STORIES_FILE, { version: 1, scan: full, epics, stories: sorted })
  cache = { mtimeMs: -1, data: null }
  const history = [{
    scannedAt: full.scannedAt,
    source: full.source,
    projectKey: full.projectKey,
    jql: full.jql,
    count: full.count,
    withCriteria: sorted.filter((s) => s.acceptanceCriteria.length).length,
    durationMs: full.durationMs,
    user: full.user || '',
  }, ...getScanHistory()].slice(0, HISTORY_MAX)
  writeAtomic(HISTORY_FILE, history)
  return full
}

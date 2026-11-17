/**
 * Stockage des scénarios Gherkin : <REPO_ROOT>/.wizard-qa/gherkin/<CLÉ>.json
 * (texte, statut draft/validated, générateur, versions précédentes) et export des fichiers .feature
 * dans <REPO_ROOT>/tests/features/<épopée>/<CLÉ>.feature.
 *
 * Contrat (docs/V3-ARCHITECTURE.md §4.3) :
 *   getGherkinIndex() → { [storyKey]: { status, scenarios, updatedAt, generatedBy, … } }
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { REPO_ROOT } from '../paths.mjs'
import { writeAtomic, getStory } from '../jira/stories.mjs'
import { analyzeGherkin } from './parse.mjs'

export const GHERKIN_DIR = path.join(REPO_ROOT, '.wizard-qa', 'gherkin')
export const FEATURES_DIR = path.join(REPO_ROOT, 'tests', 'features')
const KEY_RE = /^[A-Z][A-Z0-9_]*-\d+$/
const MAX_VERSIONS = 20
const MAX_TEXT = 400 * 1024

const cache = new Map() // clé → { mtimeMs, entry }

/** Clé de récit normalisée ou null (protège aussi les chemins de fichiers). */
export function normalizeKey(key) {
  const k = String(key || '').trim().toUpperCase()
  return KEY_RE.test(k) ? k : null
}

const fileOf = (key) => path.join(GHERKIN_DIR, `${key}.json`)
const hashOf = (text) => crypto.createHash('sha1').update(String(text || '')).digest('hex')

export function slugify(text, fallback = 'sans-epopee') {
  const s = String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '')
  return s || fallback
}

export function readEntry(key) {
  const k = normalizeKey(key)
  if (!k) return null
  let stat
  try {
    stat = fs.statSync(fileOf(k))
  } catch {
    cache.delete(k)
    return null
  }
  const hit = cache.get(k)
  if (hit && hit.mtimeMs === stat.mtimeMs) return hit.entry
  try {
    const entry = JSON.parse(fs.readFileSync(fileOf(k), 'utf8'))
    cache.set(k, { mtimeMs: stat.mtimeMs, entry })
    return entry
  } catch {
    return null
  }
}

function persist(entry) {
  writeAtomic(fileOf(entry.key), entry)
  cache.delete(entry.key)
  return entry
}

/** L'export sur disque correspond-il au texte actuel (et le fichier existe-t-il encore) ? */
export function isExported(entry) {
  if (!entry?.exportedAt || !entry.exportedPath || entry.exportedHash !== hashOf(entry.text)) return false
  return fs.existsSync(path.resolve(REPO_ROOT, entry.exportedPath))
}

function summaryOf(entry) {
  return {
    status: entry.status,
    scenarios: entry.scenarios || 0,
    updatedAt: entry.updatedAt,
    generatedBy: entry.generatedBy,
    edited: Boolean(entry.edited),
    valid: entry.counts ? entry.counts.error === 0 : null,
    errors: entry.counts?.error || 0,
    warnings: entry.counts?.warning || 0,
    exported: isExported(entry),
    exportedAt: entry.exportedAt || null,
  }
}

export function getGherkinIndex() {
  let files
  try {
    files = fs.readdirSync(GHERKIN_DIR).filter((f) => f.endsWith('.json'))
  } catch {
    return {}
  }
  const index = {}
  for (const f of files) {
    const entry = readEntry(f.slice(0, -5))
    if (entry?.key && typeof entry.text === 'string') index[entry.key] = summaryOf(entry)
  }
  return index
}

function snapshot(entry) {
  return { text: entry.text, status: entry.status, generatedBy: entry.generatedBy, provider: entry.provider || '', savedAt: entry.updatedAt, savedBy: entry.updatedBy || '' }
}

/**
 * Enregistre un texte (nouveau brouillon par défaut) ; la version précédente est conservée.
 * meta : { generatedBy: 'llm'|'template'|'manual'|'edit', provider, model, user, warnings, status }
 */
export function saveFeature(key, text, meta = {}) {
  const k = normalizeKey(key)
  if (!k) throw new Error(`Clé de récit invalide : ${key}`)
  const body = String(text ?? '').replace(/\r\n/g, '\n')
  if (body.length > MAX_TEXT) throw new Error('Texte Gherkin trop volumineux (400 Ko au plus).')
  const prev = readEntry(k)
  const now = new Date().toISOString()
  const analysis = analyzeGherkin(body, { storyKey: k })
  const isEdit = meta.generatedBy === 'edit'
  // Enregistrement sans modification : on garde le statut (un récit validé le reste).
  if (isEdit && prev && prev.text === body) return { entry: prev, analysis, unchanged: true }
  const versions = prev ? [...(prev.versions || [])] : []
  if (prev && prev.text !== body) versions.unshift(snapshot(prev))
  const entry = {
    version: 1,
    key: k,
    text: body,
    status: meta.status || 'draft',
    generatedBy: isEdit ? prev?.generatedBy || 'edit' : meta.generatedBy || 'edit',
    provider: isEdit ? prev?.provider || '' : meta.provider || '',
    model: isEdit ? prev?.model || '' : meta.model || '',
    edited: isEdit ? Boolean(prev) : false,
    warnings: isEdit ? prev?.warnings || [] : meta.warnings || [],
    scenarios: analysis.scenarios,
    cases: analysis.cases,
    counts: analysis.counts,
    createdAt: prev?.createdAt || now,
    updatedAt: now,
    updatedBy: meta.user || '',
    generatedAt: isEdit ? prev?.generatedAt || now : now,
    validatedAt: null,
    validatedBy: '',
    exportedAt: prev?.exportedAt || null,
    exportedHash: prev?.exportedHash || null,
    exportedPath: prev?.exportedPath || null,
    versions: versions.slice(0, MAX_VERSIONS),
  }
  persist(entry)
  return { entry, analysis }
}

/** Passe un brouillon au statut « validé » si l'analyse ne relève aucune erreur. */
export function validateFeature(key, user) {
  const entry = readEntry(key)
  if (!entry) return { ok: false, notFound: true }
  const analysis = analyzeGherkin(entry.text, { storyKey: entry.key })
  if (!analysis.valid) return { ok: false, analysis }
  const next = { ...entry, status: 'validated', validatedAt: new Date().toISOString(), validatedBy: user || '', counts: analysis.counts, scenarios: analysis.scenarios }
  persist(next)
  return { ok: true, entry: next, analysis }
}

/** Restaure une version précédente (elle devient un brouillon). */
export function restoreVersion(key, index, user) {
  const entry = readEntry(key)
  const v = entry?.versions?.[index]
  if (!v) return null
  return saveFeature(entry.key, v.text, { generatedBy: v.generatedBy || 'edit', provider: v.provider, user, warnings: [] })
}

// ---------------------------------------------------------------- export .feature

/** Chemin d'export d'un récit (dossier = épopée). */
export function exportPathFor(key, story = getStory(key)) {
  const epic = story?.epic
  const folder = epic ? slugify(epic.summary, slugify(epic.key)) : 'sans-epopee'
  return path.join(FEATURES_DIR, folder, `${key}.feature`)
}

const rel = (abs) => path.relative(REPO_ROOT, abs).replace(/\\/g, '/')

const pauseSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

/** Écriture atomique d'un texte ; sous Windows (OneDrive, antivirus, éditeur ouvert), le renommage est retenté. */
function writeTextAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, text, 'utf8')
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

function writeError(e) {
  if (['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) return 'Fichier verrouillé (ouvert dans un éditeur, OneDrive ou antivirus) : réessayez.'
  return `Écriture impossible : ${e.message}`
}

/** Supprime l'ancien fichier exporté si le récit a changé d'épopée (uniquement sous tests/features). */
function removeStale(previous, current) {
  if (!previous || previous === current) return
  const abs = path.resolve(REPO_ROOT, previous)
  if (!abs.startsWith(FEATURES_DIR + path.sep)) return
  try { fs.unlinkSync(abs) } catch { /* déjà absent */ }
}

/**
 * Exporte les fichiers .feature. Par défaut : tous les récits validés.
 * Renvoie { written: [{ key, path, status }], skipped: [{ key, reason }], dir }.
 */
export function exportFeatures({ keys, includeDrafts = false } = {}) {
  const wanted = Array.isArray(keys) && keys.length ? keys.map(normalizeKey).filter(Boolean) : Object.keys(getGherkinIndex())
  const written = []
  const skipped = []
  for (const key of wanted) {
    const entry = readEntry(key)
    if (!entry) { skipped.push({ key, reason: 'Aucun scénario enregistré.' }); continue }
    if (entry.status !== 'validated' && !includeDrafts) { skipped.push({ key, reason: 'Brouillon non validé.' }); continue }
    const target = exportPathFor(key)
    const text = entry.text.endsWith('\n') ? entry.text : `${entry.text}\n`
    try {
      writeTextAtomic(target, text)
      removeStale(entry.exportedPath, rel(target))
      persist({ ...entry, exportedAt: new Date().toISOString(), exportedHash: hashOf(entry.text), exportedPath: rel(target) })
    } catch (e) {
      skipped.push({ key, reason: writeError(e) })
      continue
    }
    written.push({ key, path: rel(target), status: entry.status })
  }
  return { written, skipped, dir: rel(FEATURES_DIR) }
}

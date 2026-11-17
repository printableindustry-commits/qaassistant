/**
 * Modèle Word de l'entreprise pour l'export des livrables.
 *
 *   getModel()                    → { path, name, savedAt, savedBy, size, summary } | null
 *   saveModel(buffer, name, by)   → idem (vérifie un .docx OOXML avec word/document.xml, 30 Mo au plus,
 *                                   et qu'un livrable d'essai se construit sur ce modèle)
 *   deleteModel()                 → true si un modèle a été retiré
 *   loadModel()                   → modèle analysé (docx-model.mjs openModel), mis en cache, ou null
 *
 * Fichiers : <REPO_ROOT>/.wizard-qa/livrables/modele-word.docx (+ modele-word.json : nom d'origine, date).
 * Le modèle reste sur ce poste : il n'est ni versionné ni copié dans server/ (il peut contenir des
 * noms et des contenus internes).
 */
import fs from 'fs'
import path from 'path'
import { HttpError } from '../http/router.mjs'
import { LIVRABLES_DIR } from './store.mjs'
import { openModel, describeModel, coverInfo, markdownToModelDocx } from './docx-model.mjs'

export const MODEL_FILE = path.join(LIVRABLES_DIR, 'modele-word.docx')
const META_FILE = path.join(LIVRABLES_DIR, 'modele-word.json')
export const MAX_MODEL_BYTES = 30 * 1024 * 1024

let cache = null // { key, model }

function readMeta() {
  try {
    return JSON.parse(fs.readFileSync(META_FILE, 'utf8'))
  } catch {
    return {}
  }
}

function writeFileAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, data)
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(tmp, file)
      return
    } catch (e) {
      // OneDrive / antivirus : le remplacement peut échouer brièvement sous Windows
      if (attempt >= 4 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) {
        try { fs.unlinkSync(tmp) } catch { /* déjà absent */ }
        throw e
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100 * (attempt + 1))
    }
  }
}

/** Modèle analysé, relu seulement si le fichier a changé. */
export function loadModel() {
  let stat
  try {
    stat = fs.statSync(MODEL_FILE)
  } catch {
    cache = null
    return null
  }
  const key = `${stat.size}:${stat.mtimeMs}`
  if (cache?.key === key) return cache.model
  const model = openModel(fs.readFileSync(MODEL_FILE))
  cache = { key, model }
  return model
}

export function getModel() {
  let stat
  try {
    stat = fs.statSync(MODEL_FILE)
  } catch {
    return null
  }
  const meta = readMeta()
  let summary = null
  let error = null
  try {
    summary = describeModel(loadModel())
  } catch (e) {
    error = e.message
  }
  return {
    path: MODEL_FILE,
    name: meta.name || path.basename(MODEL_FILE),
    savedAt: meta.savedAt || stat.mtime.toISOString(),
    savedBy: meta.savedBy || '',
    size: stat.size,
    summary,
    error,
  }
}

function cleanName(name) {
  const base = path.basename(String(name || '').replace(/\\/g, '/')).replace(/[\u0000-\u001f<>:"|?*]+/g, '').trim().slice(0, 200)
  return base || 'modele.docx'
}

/** Vérifie puis enregistre le modèle ; HttpError 400/413 s'il est refusé. */
export function saveModel(buffer, name, by = '') {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new HttpError(400, 'Fichier vide : déposez un document Word (.docx).')
  if (buffer.length > MAX_MODEL_BYTES) throw new HttpError(413, `Modèle trop volumineux (${Math.round(buffer.length / 1048576)} Mo, 30 Mo au plus).`)
  if (buffer.readUInt32LE(0) !== 0x04034b50) throw new HttpError(400, 'Ce fichier n\'est pas un document Word .docx (archive OOXML attendue ; les .doc et .dotm ne sont pas pris en charge).')
  let model
  try {
    model = openModel(buffer)
    // essai complet : un livrable fictif doit se construire sur ce modèle
    const cover = coverInfo({ entry: { id: 'essai', short: 'ESS', title: 'Essai', purpose: 'Essai', audience: 'Essai', ref: '' }, profile: { responsableTest: 'Essai' }, version: 1 })
    markdownToModelDocx('# Essai\n\n## Section\n\nTexte.\n\n- puce\n\n| A | B |\n|---|---|\n| 1 | 2 |\n', model, cover)
  } catch (e) {
    throw new HttpError(400, `Modèle Word inutilisable : ${e.message}`)
  }
  writeFileAtomic(MODEL_FILE, buffer)
  writeFileAtomic(META_FILE, JSON.stringify({ name: cleanName(name), savedAt: new Date().toISOString(), savedBy: by, size: buffer.length }, null, 2))
  cache = null
  return { ...getModel(), summary: describeModel(model) }
}

export function deleteModel() {
  cache = null
  let removed = false
  for (const f of [MODEL_FILE, META_FILE]) {
    try {
      fs.unlinkSync(f)
      if (f === MODEL_FILE) removed = true
    } catch (e) {
      if (e.code !== 'ENOENT') throw e
    }
  }
  return removed
}

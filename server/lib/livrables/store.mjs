/**
 * Stockage des livrables (contrat V3.2 §6.5).
 *   <REPO_ROOT>/.wizard-qa/livrables/docs/<id>.json
 *     { id, status: 'none'|'generated'|'edited'|'reviewed'|'approved',
 *       versions: [{ n, at, by, kind: 'generated'|'edited', markdown, factsHash, profileHash, templateHash }],
 *       review, approval: { by, at, version } }   (20 versions conservées au plus)
 *   Modèles : server/conf/livrables/templates/<id>.md (référence), surcharge <REPO_ROOT>/.wizard-qa/livrables/templates/<id>.md
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { REPO_ROOT, SERVER_DIR } from '../paths.mjs'
import { writeAtomic } from '../jira/stories.mjs'

export const LIVRABLES_DIR = path.join(REPO_ROOT, '.wizard-qa', 'livrables')
const DOCS_DIR = path.join(LIVRABLES_DIR, 'docs')
const OVERRIDE_DIR = path.join(LIVRABLES_DIR, 'templates')
const CONF_DIR = path.join(SERVER_DIR, 'conf', 'livrables')
const MAX_VERSIONS = 20

export function sha256(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value ?? null)).digest('hex')
}

// --- catalogue et modèles --------------------------------------------------

let catalogCache = null
export function loadCatalog() {
  if (!catalogCache) catalogCache = JSON.parse(fs.readFileSync(path.join(CONF_DIR, 'catalog.json'), 'utf8'))
  return catalogCache
}

export function catalogEntry(id) {
  return loadCatalog().documents.find((d) => d.id === id) || null
}

function safeId(id) {
  if (!/^[a-z0-9-]{1,40}$/.test(String(id)) || !catalogEntry(id)) return null
  return id
}

export function loadTemplate(id) {
  if (!safeId(id)) return null
  const reference = fs.readFileSync(path.join(CONF_DIR, 'templates', `${id}.md`), 'utf8')
  let override = null
  try {
    override = fs.readFileSync(path.join(OVERRIDE_DIR, `${id}.md`), 'utf8')
  } catch { /* pas de surcharge */ }
  const source = override ?? reference
  return { id, source, reference, overridden: override != null, hash: sha256(source).slice(0, 16) }
}

export function saveTemplateOverride(id, markdown) {
  fs.mkdirSync(OVERRIDE_DIR, { recursive: true })
  fs.writeFileSync(path.join(OVERRIDE_DIR, `${id}.md`), String(markdown).replace(/\r\n/g, '\n'), 'utf8')
}

export function deleteTemplateOverride(id) {
  try {
    fs.unlinkSync(path.join(OVERRIDE_DIR, `${id}.md`))
    return true
  } catch {
    return false
  }
}

// --- documents -------------------------------------------------------------

export function loadDoc(id) {
  const empty = { id, status: 'none', versions: [], review: null, approval: null }
  if (!safeId(id)) return empty
  try {
    const data = JSON.parse(fs.readFileSync(path.join(DOCS_DIR, `${id}.json`), 'utf8'))
    return { ...empty, ...data, versions: Array.isArray(data.versions) ? data.versions : [] }
  } catch {
    return empty
  }
}

function saveDoc(doc) {
  writeAtomic(path.join(DOCS_DIR, `${doc.id}.json`), doc)
}

export function latestVersion(doc) {
  return doc.versions[doc.versions.length - 1] || null
}

/** Ajoute une version (générée ou modifiée) ; toute nouvelle version annule la relecture et l'approbation. */
export function addVersion(id, { kind, markdown, by, factsHash, profileHash, templateHash, missing = [] }) {
  const doc = loadDoc(id)
  const last = latestVersion(doc)
  const version = {
    n: (last?.n || 0) + 1,
    at: new Date().toISOString(),
    by: by || 'wizard-qa',
    kind,
    markdown: String(markdown),
    factsHash,
    profileHash,
    templateHash,
    missing,
  }
  doc.versions = [...doc.versions, version].slice(-MAX_VERSIONS)
  doc.status = kind === 'edited' ? 'edited' : 'generated'
  doc.review = null
  doc.approval = null
  saveDoc(doc)
  return doc
}

export function setReview(id, review) {
  const doc = loadDoc(id)
  const last = latestVersion(doc)
  doc.review = { ...review, version: last?.n || null }
  if (doc.status !== 'approved') doc.status = review.blocking ? (last?.kind === 'edited' ? 'edited' : 'generated') : 'reviewed'
  saveDoc(doc)
  return doc
}

export function setApproval(id, by) {
  const doc = loadDoc(id)
  const last = latestVersion(doc)
  if (!last) return null
  doc.approval = { by, at: new Date().toISOString(), version: last.n }
  doc.status = 'approved'
  saveDoc(doc)
  return doc
}

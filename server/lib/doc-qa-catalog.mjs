import fs from 'fs'
import path from 'path'
import { DOC_QA_DIR } from './paths.mjs'

const TEMPLATES_CONF = 'doc-qa-templates.conf.json'

export function getCatalog() {
  const file = path.join(DOC_QA_DIR, TEMPLATES_CONF)
  if (!fs.existsSync(file)) return null
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')).wizardCatalog || null
  } catch {
    return null
  }
}

export function findCatalogDocument(docId) {
  const catalog = getCatalog()
  return catalog?.documents?.find((d) => String(d.id) === String(docId)) || null
}

export function findCatalogChapter(docId, chapterId) {
  const catalog = getCatalog()
  const doc = findCatalogDocument(docId)
  const chapter = doc?.chapters?.find((c) => String(c.id) === String(chapterId))
  return { catalog, doc, chapter }
}

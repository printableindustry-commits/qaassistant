import fs from 'fs'
import path from 'path'
import { spawnPython } from './python-runner.mjs'
import { savePageDefaults, getPageDefaults } from './wizard-defaults.mjs'
import { findCatalogChapter } from './doc-qa-catalog.mjs'
import { resolveDocumentDocxPath, scanDocumentForWizard } from './doc-qa-document-scan.mjs'

const FILL_SCRIPT = 'fill-doc-qa-chapter.py'
const BACKUP_DIR = 'doc-qa-backups'

function fillScriptPath() {
  return path.join(DOC_QA_DIR, FILL_SCRIPT)
}

function backupDirAbs() {
  return path.join(CONF_DIR, BACKUP_DIR)
}

export function applyChapterBlockToDocument({ docId, chapterId, content }) {
  const text = String(content || '').trim()
  if (!text) throw new Error('Bloc vide — collez le contenu généré par l\'IA')

  const { doc, chapter } = findCatalogChapter(docId, chapterId)
  if (!doc || !chapter) {
    throw new Error(`Chapitre introuvable : ${docId} / ${chapterId}`)
  }

  const resolved = resolveDocumentDocxPath(doc)
  if (!resolved) {
    throw new Error(`Fichier Word introuvable pour le livrable ${docId}`)
  }

  const script = fillScriptPath()
  if (!fs.existsSync(script)) {
    throw new Error(`Script d'injection introuvable : ${script}`)
  }

  fs.mkdirSync(CONF_DIR, { recursive: true })
  const tmpContent = path.join(CONF_DIR, `fill-${docId}-${chapterId}-${Date.now()}.md`)
  fs.writeFileSync(tmpContent, text, 'utf8')

  const r = spawnPython([
      script,
      '--docx', resolved.absolute,
      '--chapter-title', chapter.title,
      '--content-file', tmpContent,
      '--backup-dir', backupDirAbs(),
      '--json-out',
    ])

  try { fs.unlinkSync(tmpContent) } catch { /* ignore */ }

  let result
  try {
    result = JSON.parse((r.stdout || '').trim() || '{}')
  } catch {
    result = { ok: false, error: r.stderr || r.stdout || 'Injection Word échouée' }
  }

  if (r.status !== 0 || !result.ok) {
    throw new Error(result.error || r.stderr || 'Injection Word échouée (python-docx requis)')
  }

  const filledAt = new Date().toISOString()
  const docQa = getPageDefaults('docQa') || {}
  const chapterFills = { ...(docQa.chapterFills || {}) }
  const key = `${docId}:${chapterId}`
  chapterFills[key] = {
    filledAt,
    docxPath: resolved.relative,
    chapterTitle: chapter.title,
    paragraphsReplaced: result.paragraphsReplaced,
    paragraphsAdded: result.paragraphsAdded,
    tablesUpdated: result.tablesUpdated,
    backupPath: result.backupPath
      ? path.relative(path.dirname(CONF_DIR), result.backupPath).replace(/\\/g, '/')
      : null,
    contentPreview: text.slice(0, 200),
  }
  savePageDefaults('docQa', { chapterFills, lastChapterFillAt: filledAt })

  let scanResult = null
  try {
    scanResult = scanDocumentForWizard(doc)
  } catch {
    /* rescan optionnel */
  }

  return {
    ok: true,
    docId,
    chapterId,
    chapterTitle: chapter.title,
    docxPath: resolved.relative,
    filledAt,
    backupRelative: chapterFills[key].backupPath,
    fillStats: {
      paragraphsReplaced: result.paragraphsReplaced,
      paragraphsAdded: result.paragraphsAdded,
      tablesUpdated: result.tablesUpdated,
    },
    scan: scanResult ? { scannedAt: scanResult.scannedAt } : null,
    fillScript: relPath(PATH_CFG.docQaDir, FILL_SCRIPT),
  }
}

export function getChapterFillState(docId, chapterId) {
  const docQa = getPageDefaults('docQa') || {}
  return docQa.chapterFills?.[`${docId}:${chapterId}`] || null
}

export function listChapterFillStates(doc) {
  const docQa = getPageDefaults('docQa') || {}
  const fills = docQa.chapterFills || {}
  const out = {}
  for (const ch of doc.chapters || []) {
    const f = fills[`${doc.id}:${ch.id}`]
    if (f) out[ch.id] = f
  }
  return out
}

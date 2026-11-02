import fs from 'fs'
import path from 'path'
import { CONF_DIR, DOC_QA_DIR, LIVRABLES_DIR, REPO_ROOT, relPath, PATH_CFG } from './paths.mjs'
import { savePageDefaults, getPageDefaults } from './wizard-defaults.mjs'
import { extractDocxText } from './docx-text-extract.mjs'

const SCANS_DIR = 'doc-qa-scans'
const PROMPT_PARAMS_FILE = 'doc-qa-prompt-params.json'

const PLACEHOLDER_RE = /^(Indiquer|Préciser|Renseigner|Documenter|Lister|Décrire|Donner|Présenter|Ajouter|Mentionner|Expliquer|Identifier|Signaler|Compléter)/i

function scansDirAbs() {
  return path.join(CONF_DIR, SCANS_DIR)
}

function promptParamsPath() {
  return path.join(CONF_DIR, PROMPT_PARAMS_FILE)
}

function normalizeTitle(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function extractDocxPlainText(absPath) {
  const raw = extractDocxText(absPath)
  if (!raw) {
    throw new Error('Lecture Word impossible (Python requis)')
  }
  return raw.split('\n').map((line) => line.trim()).filter(Boolean).join('\n')
}

export function resolveDocumentDocxPath(doc) {
  if (!doc?.id) return null
  const id = String(doc.id)
  const candidates = []

  if (doc.file) {
    candidates.push(path.join(LIVRABLES_DIR, doc.file))
    candidates.push(path.join(DOC_QA_DIR, 'Modèle Word', doc.file))
    candidates.push(path.join(DOC_QA_DIR, 'Modèle Word', 'Exemple', doc.file))
  }

  for (const dir of [LIVRABLES_DIR, path.join(DOC_QA_DIR, 'Modèle Word')]) {
    if (!fs.existsSync(dir)) continue
    const fuzzy = fs.readdirSync(dir).find((f) => f.startsWith(`${id}_`) && f.toLowerCase().endsWith('.docx'))
    if (fuzzy) candidates.unshift(path.join(dir, fuzzy))
  }

  const seen = new Set()
  for (const abs of candidates) {
    const key = abs.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    if (fs.existsSync(abs)) {
      return {
        absolute: abs,
        relative: path.relative(REPO_ROOT, abs).replace(/\\/g, '/'),
        fileName: path.basename(abs),
      }
    }
  }
  return null
}

function isPlaceholderLine(line) {
  const t = String(line || '').trim()
  if (!t) return false
  if (PLACEHOLDER_RE.test(t)) return true
  if (t.length > 180 && /ex\.|exemple|préciser|indiquer/i.test(t)) return true
  return false
}

function analyzeSectionLines(lines) {
  const placeholders = []
  const content = []
  for (const line of lines) {
    if (isPlaceholderLine(line)) placeholders.push(line)
    else content.push(line)
  }
  let completion = 'empty'
  if (content.length && placeholders.length) completion = 'partial'
  else if (content.length) completion = 'filled'
  else if (placeholders.length) completion = 'placeholder_only'

  const excerpt = content.join('\n').slice(0, 2000)
  const placeholderExcerpt = placeholders.join('\n').slice(0, 1500)

  return {
    paragraphCount: lines.length,
    placeholderCount: placeholders.length,
    contentLineCount: content.length,
    completion,
    existingContentExcerpt: excerpt,
    placeholderExcerpt,
    scanSummary: completion === 'filled'
      ? `${content.length} paragraphe(s) rédigé(s) détecté(s)`
      : completion === 'partial'
        ? `${content.length} paragraphe(s) rédigé(s), ${placeholders.length} consigne(s) placeholder`
        : completion === 'placeholder_only'
          ? `${placeholders.length} consigne(s) placeholder — chapitre à rédiger`
          : 'Section vide ou non identifiée',
  }
}

function splitLinesByChapters(lines, chapters) {
  const nonEmpty = lines.map((l) => l.trim()).filter(Boolean)
  const indices = chapters.map((ch) => {
    const norm = normalizeTitle(ch.title)
    const idx = nonEmpty.findIndex((line) => {
      const ln = normalizeTitle(line)
      return ln === norm || ln.startsWith(norm) || norm.startsWith(ln)
    })
    return { chapter: ch, index: idx }
  })

  const found = indices.filter((x) => x.index >= 0).sort((a, b) => a.index - b.index)
  const result = {}

  for (let i = 0; i < found.length; i += 1) {
    const { chapter, index } = found[i]
    const end = i + 1 < found.length ? found[i + 1].index : nonEmpty.length
    const sectionLines = nonEmpty.slice(index + 1, end)
    result[chapter.id] = analyzeSectionLines(sectionLines)
  }

  for (const ch of chapters) {
    if (!result[ch.id]) {
      result[ch.id] = analyzeSectionLines([])
    }
  }

  return result
}

function loadPromptParams() {
  const file = promptParamsPath()
  if (!fs.existsSync(file)) return {}
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return {}
  }
}

function savePromptParams(all) {
  fs.mkdirSync(CONF_DIR, { recursive: true })
  fs.writeFileSync(promptParamsPath(), `${JSON.stringify(all, null, '\t')}\n`, 'utf8')
}

function buildEnrichedPromptHint(chapter, analysis) {
  const parts = []
  if (analysis.completion === 'filled') {
    parts.push(`Le scan Word montre un contenu déjà rédigé pour « ${chapter.title} » — améliorez et complétez sans effacer les faits existants.`)
  } else if (analysis.completion === 'partial') {
    parts.push(`Le scan Word mélange contenu rédigé et consignes placeholder pour « ${chapter.title} » — conserver le rédigé, remplacer les consignes grises.`)
  } else {
    parts.push(`Le scan Word indique que « ${chapter.title} » est à rédiger (consignes placeholder ou section vide).`)
  }
  if (analysis.existingContentExcerpt) {
    parts.push(`Extrait existant : ${analysis.existingContentExcerpt.slice(0, 400)}…`)
  }
  return parts.join(' ')
}

export function loadDocumentScan(docId) {
  const file = path.join(scansDirAbs(), `${docId}.json`)
  if (!fs.existsSync(file)) return null
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

export function getChapterScanParams(docId, chapterId) {
  const params = loadPromptParams()
  const docParams = params?.[docId]
  const ch = docParams?.chapters?.[chapterId]
  if (!ch) return null
  return {
    ...ch,
    scannedAt: docParams.scannedAt,
    sourcePath: docParams.sourcePath,
    resolvedFile: docParams.resolvedFile,
  }
}

export function scanDocumentForWizard(doc) {
  if (!doc) throw new Error('Document catalogue introuvable')

  const resolved = resolveDocumentDocxPath(doc)
  if (!resolved) {
    throw new Error(`Fichier Word introuvable pour le livrable ${doc.id} (${doc.file})`)
  }

  const rawText = extractDocxPlainText(resolved.absolute)
  const lines = rawText.split('\n')
  const chapters = doc.chapters || []
  const chapterAnalysis = splitLinesByChapters(lines, chapters)
  const scannedAt = new Date().toISOString()

  const chaptersOut = {}
  for (const ch of chapters) {
    const analysis = chapterAnalysis[ch.id] || analyzeSectionLines([])
    chaptersOut[ch.id] = {
      title: ch.title,
      ...analysis,
      enrichedPromptHint: buildEnrichedPromptHint(ch, analysis),
      tableHeaders: ch.tableHeaders || [],
    }
  }

  const scanRecord = {
    docId: doc.id,
    file: doc.file,
    resolvedFile: resolved.fileName,
    sourcePath: resolved.relative,
    scannedAt,
    lineCount: lines.length,
    charCount: rawText.length,
    chapters: chaptersOut,
    scanConfigPath: relPath(PATH_CFG.localConfDir, PROMPT_PARAMS_FILE),
    scanDataPath: relPath(PATH_CFG.localConfDir, SCANS_DIR, `${doc.id}.json`),
  }

  fs.mkdirSync(scansDirAbs(), { recursive: true })
  fs.writeFileSync(path.join(scansDirAbs(), `${doc.id}.json`), `${JSON.stringify(scanRecord, null, '\t')}\n`, 'utf8')

  const allParams = loadPromptParams()
  allParams[doc.id] = {
    scannedAt,
    sourcePath: resolved.relative,
    resolvedFile: resolved.fileName,
    chapters: Object.fromEntries(
      Object.entries(chaptersOut).map(([id, c]) => [id, {
        completion: c.completion,
        enrichedPromptHint: c.enrichedPromptHint,
        existingContentExcerpt: c.existingContentExcerpt,
        placeholderExcerpt: c.placeholderExcerpt,
        placeholderCount: c.placeholderCount,
        contentLineCount: c.contentLineCount,
        scanSummary: c.scanSummary,
      }]),
    ),
  }
  savePromptParams(allParams)

  const docQa = getPageDefaults('docQa') || {}
  const documentScans = { ...(docQa.documentScans || {}) }
  documentScans[doc.id] = { scannedAt, sourcePath: resolved.relative, scanDataPath: scanRecord.scanDataPath }
  savePageDefaults('docQa', { documentScans, lastDocumentScanAt: scannedAt })

  return { ok: true, ...scanRecord }
}

export function mergeScanIntoDocuments(documents = []) {
  return documents.map((doc) => {
    const scan = loadDocumentScan(doc.id)
    const chapters = (doc.chapters || []).map((ch) => {
      const fromScan = scan?.chapters?.[ch.id]
      return {
        ...ch,
        scan: fromScan
          ? {
              scannedAt: scan.scannedAt,
              completion: fromScan.completion,
              scanSummary: fromScan.scanSummary,
              sourcePath: scan.sourcePath,
            }
          : null,
      }
    })
    return {
      ...doc,
      scannedAt: scan?.scannedAt || null,
      sourcePath: scan?.sourcePath || null,
      chapters,
    }
  })
}

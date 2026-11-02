import fs from 'fs'
import path from 'path'
import { REPO_ROOT } from './paths.mjs'

const PROGRESS_DIR = path.join(REPO_ROOT, '.wizard-qa')
const PROGRESS_FILE = path.join(PROGRESS_DIR, 'doc-qa-progress.json')
const PROMPTS_DIR = path.join(PROGRESS_DIR, 'doc-qa-prompts')

export const CHAPTER_STATUSES = new Set([
  'todo',
  'prompt_generated',
  'ai_response_pasted',
  'ready_to_apply',
  'applied',
  'review_needed',
  'error',
])

const STATUS_LABELS = {
  todo: 'À compléter',
  prompt_generated: 'Prompt généré',
  ai_response_pasted: 'Réponse IA collée',
  ready_to_apply: 'Prêt à appliquer',
  applied: 'Appliqué au document',
  review_needed: 'À relire',
  error: 'Erreur',
}

const DOC_STATUS_LABELS = {
  not_started: 'Non commencé',
  in_progress: 'En cours',
  review: 'À relire',
  done: 'Terminé',
  error: 'Erreur',
}

function chapterKey(docId, chapterId) {
  return `${docId}:${chapterId}`
}

function defaultChapterProgress(docId, chapterId) {
  return {
    documentId: docId,
    chapterId,
    status: 'todo',
    lastPromptGeneratedAt: null,
    lastAiResponsePastedAt: null,
    lastAppliedAt: null,
    missingFields: [],
    completionRatio: 0,
    hasTodoMarkers: false,
    notes: '',
    lastError: null,
  }
}

export function loadDocQaProgress() {
  if (!fs.existsSync(PROGRESS_FILE)) {
    return { version: '1.0.0', chapters: {}, lastAction: null }
  }
  try {
    const data = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'))
    return { version: data.version || '1.0.0', chapters: data.chapters || {}, lastAction: data.lastAction || null }
  } catch {
    return { version: '1.0.0', chapters: {}, lastAction: null }
  }
}

function saveDocQaProgress(data) {
  fs.mkdirSync(PROGRESS_DIR, { recursive: true })
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(data, null, 2), 'utf8')
}

export function getChapterProgress(docId, chapterId, store = loadDocQaProgress()) {
  const key = chapterKey(docId, chapterId)
  return store.chapters[key] || defaultChapterProgress(docId, chapterId)
}

export function updateChapterProgress(docId, chapterId, patch = {}) {
  const store = loadDocQaProgress()
  const key = chapterKey(docId, chapterId)
  const current = store.chapters[key] || defaultChapterProgress(docId, chapterId)
  const next = { ...current, ...patch, documentId: docId, chapterId }
  if (patch.status && !CHAPTER_STATUSES.has(patch.status)) {
    throw new Error(`Statut chapitre invalide : ${patch.status}`)
  }
  store.chapters[key] = next
  if (patch.status === 'applied') {
    store.lastAction = {
      type: 'applied',
      docId,
      chapterId,
      at: patch.lastAppliedAt || new Date().toISOString(),
    }
  } else if (patch.status === 'prompt_generated') {
    store.lastAction = {
      type: 'prompt_generated',
      docId,
      chapterId,
      at: patch.lastPromptGeneratedAt || new Date().toISOString(),
    }
  }
  saveDocQaProgress(store)
  return next
}

export function getChapterStatusLabel(status) {
  return STATUS_LABELS[status] || status
}

export function computeDocumentStatus(doc) {
  const chapters = doc.chapters || []
  if (!chapters.length) return { status: 'not_started', label: DOC_STATUS_LABELS.not_started, done: 0, total: 0 }
  let done = 0
  let hasError = false
  let hasProgress = false
  let needsReview = false
  for (const ch of chapters) {
    const st = ch.progress?.status || 'todo'
    if (st === 'applied') done += 1
    if (st === 'error') hasError = true
    if (st !== 'todo') hasProgress = true
    if (st === 'review_needed') needsReview = true
  }
  let status = 'not_started'
  if (hasError) status = 'error'
  else if (done === chapters.length) status = 'done'
  else if (needsReview) status = 'review'
  else if (hasProgress || done > 0) status = 'in_progress'
  return {
    status,
    label: DOC_STATUS_LABELS[status],
    done,
    total: chapters.length,
    ratio: chapters.length ? Math.round((done / chapters.length) * 100) : 0,
  }
}

export function buildDashboard(documents = []) {
  let totalChapters = 0
  let completedChapters = 0
  let todoChapters = 0
  let reviewChapters = 0
  const docSummaries = []

  for (const doc of documents) {
    const ds = doc.documentStatus || computeDocumentStatus(doc)
    totalChapters += ds.total
    completedChapters += ds.done
    for (const ch of doc.chapters || []) {
      const st = ch.progress?.status || 'todo'
      if (st === 'todo') todoChapters += 1
      if (st === 'review_needed') reviewChapters += 1
    }
    docSummaries.push({
      id: doc.id,
      title: doc.coverTitle,
      status: ds.status,
      statusLabel: ds.label,
      done: ds.done,
      total: ds.total,
      ratio: ds.ratio,
    })
  }

  const store = loadDocQaProgress()
  return {
    title: 'Documentation QA — Avancement',
    documents: docSummaries,
    totals: {
      chapters: totalChapters,
      completed: completedChapters,
      todo: todoChapters,
      review: reviewChapters,
    },
    lastAction: store.lastAction,
  }
}

function redactForSave(text) {
  return String(text || '')
    .replace(/Authorization:\s*Bearer\s+\S+/gi, 'Authorization: Bearer [REDACTED]')
    .replace(/_authToken\s*=\s*\S+/gi, '_authToken=[REDACTED]')
    .replace(/\b(token|secret|password)\s*[:=]\s*\S+/gi, '$1=[REDACTED]')
}

export function saveChapterPromptArchive({ docId, chapterId, prompt, meta = {} } = {}) {
  fs.mkdirSync(PROMPTS_DIR, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const fileName = `${docId}__${chapterId}__${ts}.md`
  const filePath = path.join(PROMPTS_DIR, fileName)
  const header = `---
documentId: ${docId}
chapterId: ${chapterId}
generatedAt: ${new Date().toISOString()}
templateVersion: ${meta.templateVersion || '2.0'}
missingFields: ${JSON.stringify(meta.missingFields || [])}
---

`
  fs.writeFileSync(filePath, header + redactForSave(prompt), 'utf8')
  return {
    fileName,
    relativePath: path.join('.wizard-qa/doc-qa-prompts', fileName).replace(/\\/g, '/'),
  }
}

export function mergeProgressIntoDocuments(documents) {
  const store = loadDocQaProgress()
  return documents.map((doc) => {
    const chapters = (doc.chapters || []).map((ch) => {
      const progress = getChapterProgress(doc.id, ch.id, store)
      return {
        ...ch,
        progress,
        statusLabel: getChapterStatusLabel(progress.status),
      }
    })
    const withChapters = { ...doc, chapters }
    return {
      ...withChapters,
      documentStatus: computeDocumentStatus(withChapters),
    }
  })
}

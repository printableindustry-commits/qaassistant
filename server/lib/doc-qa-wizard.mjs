import fs from 'fs'
import path from 'path'
import { getProjectProfile } from './project-profile.mjs'
import { readOnboardingSnapshot } from './onboarding-snapshot.mjs'
import { savePageDefaults, getPageDefaults } from './wizard-defaults.mjs'
import {
  buildCopilotDocPrompt as buildDocPromptBody,
  buildCopilotChapterPrompt,
  PROMPT_TEMPLATE_VERSION,
} from './doc-qa-copilot-prompt.mjs'
import { analyzeChapterReadiness, formatMissingForPrompt } from './doc-qa-readiness.mjs'
import {
  buildDashboard,
  mergeProgressIntoDocuments,
  saveChapterPromptArchive,
  updateChapterProgress,
  getChapterProgress,
} from './doc-qa-progress.mjs'
import {
  loadProjectSourcesForDocPrompt,
  formatSourcesBlock,
  listAvailableSourceNames,
} from './doc-qa-project-sources.mjs'
import { estimatePromptTokens } from './debug-diagnosis.mjs'
import { DOC_QA_DIR, CONF_DIR, DOC_REPORTS_DIR, LIVRABLES_DIR, relPath, PATH_CFG } from './paths.mjs'
import {
  scanDocumentForWizard,
  mergeScanIntoDocuments,
  getChapterScanParams,
} from './doc-qa-document-scan.mjs'
import { listChapterFillStates, applyChapterBlockToDocument } from './doc-qa-document-fill.mjs'

export { applyChapterBlockToDocument }

const TEMPLATES_CONF = 'doc-qa-templates.conf.json'
const DOC_PROMPT_FILE = 'PROMPT_DOCUMENTATION_QA.md'
const CHAPTER_PROMPTS_DIR = 'doc-prompts'

function loadTemplatesConfig() {
  const file = path.join(DOC_QA_DIR, TEMPLATES_CONF)
  if (!fs.existsSync(file)) {
    return { wizardCatalog: null, identificationFields: [] }
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return { wizardCatalog: null, identificationFields: [] }
  }
}

import {
  findCatalogChapter,
  findCatalogDocument,
  getCatalog,
} from './doc-qa-catalog.mjs'

export { findCatalogChapter, findCatalogDocument, getCatalog }

function formatDateFr(d = new Date()) {
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  return `${dd}/${mm}/${yyyy}`
}

function buildOnboardingSummary(project, snapshot) {
  const prise = snapshot?.priseConnaissance || {}
  return {
    tribu: project.tribu || prise.tribu || '',
    squad: project.squad || prise.squad || '',
    poName: project.poName || prise.poName || '',
    baName: project.baName || prise.baName || '',
    scrumMasterName: project.scrumMasterName || prise.scrumMasterName || '',
    qaName: project.qaName || prise.qaName || '',
    productCode: project.productCode || prise.productCode || '',
    solutionCode: project.solutionCode || prise.solutionCode || '',
    applicationLabel: project.applicationLabel || prise.applicationLabel || '',
    recommendedStack: project.recommendedStack || '',
    recommendedStackLabel: project.recommendedStackLabel || project.recommendedStack || '',
    onboardingComplete: Boolean(project.onboardingComplete),
    onboardingCompletedAt: project.onboardingCompletedAt || null,
    snapshotPath: project.onboardingSnapshotPath || '.wizard-qa/conf/onboarding.snapshot.json',
  }
}

function buildPrefillIdentification(project) {
  const authors = [project.qaName, project.baName, project.poName].filter(Boolean).join(', ')
  const projectRef = [project.productCode, project.solutionCode].filter(Boolean).join(' — ')
  const stack = project.recommendedStackLabel || project.recommendedStack || ''

  return {
    application: project.applicationLabel || '',
    projet: projectRef,
    versionTestee: '',
    environnement: '',
    date: formatDateFr(),
    redaction: authors,
    stackTest: stack,
    referenceSpec: '',
  }
}

function enrichDocumentsWithScanAndFill(docs) {
  return mergeScanIntoDocuments(docs).map((doc) => {
    const fills = listChapterFillStates(doc)
    return {
      ...doc,
      chapters: (doc.chapters || []).map((ch) => ({
        ...ch,
        fill: fills[ch.id] || null,
      })),
    }
  })
}

function mapCatalogDocuments() {
  const catalog = getCatalog()
  return (catalog?.documents || [])
    .filter((d) => /^\d{2}$/.test(String(d.id)))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .map((doc) => ({
      id: doc.id,
      file: doc.file,
      coverTitle: doc.coverTitle,
      coverSubtitle: doc.coverSubtitle,
      wizardSection: doc.wizardSection,
      chapters: (doc.chapters || []).map((ch) => ({
        id: ch.id,
        title: ch.title,
        focus: ch.focus,
        dataToProvide: ch.dataToProvide,
        expectedQuality: ch.expectedQuality,
        tableHeaders: ch.tableHeaders || [],
        promptHint: ch.promptHint || '',
        whyImportant: ch.whyImportant || ch.focus || '',
      })),
    }))
}

export function getDocWizardDocuments() {
  const docs = mapCatalogDocuments()
  const withMeta = enrichDocumentsWithScanAndFill(docs)
  const documents = mergeProgressIntoDocuments(withMeta)

  return {
    ok: true,
    documents,
    documentCount: docs.length,
    livrablesDir: relPath(PATH_CFG.livrablesDir),
    templatesPath: relPath(PATH_CFG.docQaDir, TEMPLATES_CONF),
  }
}

export function getDocWizardContext() {
  const project = getProjectProfile()
  const snapshot = readOnboardingSnapshot()
  const docQa = getPageDefaults('docQa') || {}
  const onboarding = buildOnboardingSummary(project, snapshot)
  const prefill = buildPrefillIdentification(project)
  const { documents } = getDocWizardDocuments()
  const dashboard = buildDashboard(documents)
  const projectSources = loadProjectSourcesForDocPrompt()

  return {
    ok: true,
    onboarding,
    prefill,
    documents,
    dashboard,
    availableSourceNames: listAvailableSourceNames(projectSources),
    livrablesDir: relPath(PATH_CFG.livrablesDir),
    templatesPath: relPath(PATH_CFG.docQaDir, TEMPLATES_CONF),
    lastPromptAt: docQa.lastPromptAt || null,
    livrablesTourHidden: Boolean(docQa.livrablesTourHidden),
    promptTemplateVersion: PROMPT_TEMPLATE_VERSION,
  }
}

export function getDocQaDashboard() {
  const { documents } = getDocWizardDocuments()
  return { ok: true, dashboard: buildDashboard(documents) }
}

export function getChapterReadiness(docId, chapterId, userNotes = '') {
  const { doc, chapter } = findCatalogChapter(docId, chapterId)
  if (!doc || !chapter) throw new Error(`Chapitre introuvable : ${docId} / ${chapterId}`)
  const project = getProjectProfile()
  const snapshot = readOnboardingSnapshot()
  const onboarding = buildOnboardingSummary(project, snapshot)
  const prefill = buildPrefillIdentification(project)
  const scanParams = getChapterScanParams(docId, chapterId)
  const readiness = analyzeChapterReadiness({
    chapter,
    onboarding,
    prefill,
    scanParams,
    userNotes,
  })
  const progress = getChapterProgress(docId, chapterId)
  return {
    ok: true,
    docId,
    chapterId,
    readiness,
    progress,
    availableSourceNames: listAvailableSourceNames(loadProjectSourcesForDocPrompt()),
  }
}

export function patchDocQaProgress(body = {}) {
  const { docId, chapterId, status, notes, missingFields, hasTodoMarkers, completionRatio } = body
  if (!docId || !chapterId) throw new Error('docId et chapterId requis')
  const patch = {}
  if (status) patch.status = status
  if (notes != null) patch.notes = String(notes)
  if (missingFields) patch.missingFields = missingFields
  if (hasTodoMarkers != null) patch.hasTodoMarkers = Boolean(hasTodoMarkers)
  if (completionRatio != null) patch.completionRatio = completionRatio
  const now = new Date().toISOString()
  if (status === 'prompt_generated') patch.lastPromptGeneratedAt = now
  if (status === 'ai_response_pasted') patch.lastAiResponsePastedAt = now
  if (status === 'applied') patch.lastAppliedAt = now
  const progress = updateChapterProgress(docId, chapterId, patch)
  return { ok: true, progress }
}

export function buildChapterDocPrompt(body = {}) {
  const docId = body.docId
  const chapterId = body.chapterId
  const { catalog, doc, chapter } = findCatalogChapter(docId, chapterId)
  if (!doc || !chapter) {
    throw new Error(`Chapitre introuvable : ${docId} / ${chapterId}`)
  }

  const project = getProjectProfile()
  const snapshot = readOnboardingSnapshot()
  const onboarding = buildOnboardingSummary(project, snapshot)
  const prefill = buildPrefillIdentification(project)

  const scanParams = getChapterScanParams(docId, chapterId)
  const userNotes = body.userNotes || body.notes || ''
  const projectSources = loadProjectSourcesForDocPrompt()
  const readiness = analyzeChapterReadiness({
    chapter,
    onboarding,
    prefill,
    scanParams,
    userNotes,
  })

  const result = buildCopilotChapterPrompt({
    doc,
    chapter,
    agentModel: body.agentModel || 'Claude Sonnet 4.6',
    onboarding,
    prefill,
    catalog,
    userNotes,
    scanParams,
    livrablesDir: relPath(PATH_CFG.livrablesDir),
    projectSources,
    missingInformation: formatMissingForPrompt(readiness),
    readiness,
  })

  const tokenMeta = estimatePromptTokens(result.prompt)
  const now = new Date().toISOString()
  const archive = saveChapterPromptArchive({
    docId,
    chapterId,
    prompt: result.prompt,
    meta: {
      templateVersion: PROMPT_TEMPLATE_VERSION,
      missingFields: readiness.missingFields,
    },
  })
  updateChapterProgress(docId, chapterId, {
    status: 'prompt_generated',
    lastPromptGeneratedAt: now,
    missingFields: readiness.missingFields,
    completionRatio: readiness.completionRatio,
  })

  return {
    ok: true,
    ...result,
    ...tokenMeta,
    readiness,
    promptArchive: archive,
  }
}

export function saveChapterPromptToFile(docId, chapterId, prompt) {
  const archive = saveChapterPromptArchive({ docId, chapterId, prompt, meta: { templateVersion: PROMPT_TEMPLATE_VERSION } })
  const dir = path.join(CONF_DIR, CHAPTER_PROMPTS_DIR)
  fs.mkdirSync(dir, { recursive: true })
  const fileName = `${docId}_${chapterId}.md`
  const filePath = path.join(dir, fileName)
  fs.writeFileSync(filePath, String(prompt || ''), 'utf8')
  const now = new Date().toISOString()
  const docQa = getPageDefaults('docQa') || {}
  const chapterPrompts = { ...(docQa.chapterPrompts || {}) }
  chapterPrompts[`${docId}:${chapterId}`] = {
    at: now,
    path: relPath(PATH_CFG.localConfDir, CHAPTER_PROMPTS_DIR, fileName),
    archivePath: archive.relativePath,
  }
  savePageDefaults('docQa', { chapterPrompts, lastChapterPromptAt: now })
  return {
    fileName,
    relativePath: relPath(PATH_CFG.localConfDir, CHAPTER_PROMPTS_DIR, fileName),
    archivePath: archive.relativePath,
  }
}

export function applyChapterBlockWithProgress({ docId, chapterId, content }) {
  const text = String(content || '').trim()
  const todoCount = (text.match(/\[À COMPLÉTER\]/gi) || []).length
  const result = applyChapterBlockToDocument({ docId, chapterId, content: text })
  updateChapterProgress(docId, chapterId, {
    status: todoCount > 0 ? 'review_needed' : 'applied',
    lastAppliedAt: new Date().toISOString(),
    hasTodoMarkers: todoCount > 0,
    completionRatio: todoCount > 0 ? 85 : 100,
  })
  return { ...result, todoMarkerCount: todoCount }
}

export function buildFullDocPrompt(body = {}) {
  const ctx = getDocWizardContext()
  const project = getProjectProfile()
  const catalog = getCatalog()
  const documents = ctx.documents || []

  const result = buildDocPromptBody({
    title: body.title || 'Documentation QA — pré-remplissage livrables Word',
    agentModel: body.agentModel || 'Claude Sonnet 4.6',
    project,
    onboarding: ctx.onboarding,
    answers: {},
    answersResolved: {},
    questionnaireSections: [],
    prefill: ctx.prefill,
    catalog,
    documents,
    userEnrichment: body.userEnrichment || body.enrichment || '',
    livrablesDir: relPath(PATH_CFG.livrablesDir),
    templatesPath: relPath(PATH_CFG.docQaDir, TEMPLATES_CONF),
  })

  const tokenMeta = estimatePromptTokens(result.prompt)
  return { ...result, ...tokenMeta, prefill: ctx.prefill }
}

export function saveDocPromptToFile(prompt) {
  fs.mkdirSync(CONF_DIR, { recursive: true })
  fs.mkdirSync(DOC_REPORTS_DIR, { recursive: true })

  const confPath = path.join(CONF_DIR, DOC_PROMPT_FILE)
  const reportPath = path.join(DOC_REPORTS_DIR, DOC_PROMPT_FILE)
  const text = String(prompt || '')
  fs.writeFileSync(confPath, text, 'utf8')
  fs.writeFileSync(reportPath, text, 'utf8')

  const now = new Date().toISOString()
  savePageDefaults('docQa', { lastPromptAt: now, lastPromptPath: relPath(PATH_CFG.localConfDir, DOC_PROMPT_FILE) })

  return {
    fileName: DOC_PROMPT_FILE,
    confPath,
    reportPath,
    relativePath: relPath(PATH_CFG.localConfDir, DOC_PROMPT_FILE),
    reportRelativePath: relPath(PATH_CFG.docReportsDir, DOC_PROMPT_FILE),
    livrablesDir: LIVRABLES_DIR,
  }
}

// Compatibilité API legacy questionnaire
export function getDocWizardQuestionnaire() {
  return getDocWizardDocuments()
}

export function saveDocWizardAnswers() {
  return { ok: true, validation: { ok: true, missing: [] } }
}

export function scanDocWizardDocument(docId) {
  const doc = findCatalogDocument(docId)
  if (!doc) throw new Error(`Livrable ${docId} introuvable dans le catalogue`)
  return scanDocumentForWizard(doc)
}

import { buildCopilotDebugPrompt } from './copilot-debug-prompt.mjs'
import { buildDebugDiagnosis, buildPreflight } from './debug-diagnosis.mjs'
import {
  writeVerboseLog,
  collectScopeVerboseBundle,
  savePromptMarkdown,
  normalizeDebugScope,
} from './debug-verbose-logs.mjs'
import {
  startDebugSession,
  getSessionStatus,
  appendSessionEnrichment,
  appendSessionPromptFile,
  appendSessionLogFile,
  saveSessionPromptSnapshot,
  resolveDebugSession,
  getActiveSession,
} from './debug-session.mjs'
import { appendResolvedCase } from './debug-agent-memory.mjs'
import { getAdapterSuggestedQuestions } from './debug-page-adapters.mjs'

export function collectVerboseFromClient(body = {}) {
  const scope = normalizeDebugScope(body.scope)
  const pageLog = String(body.pageLog || body.log || '')
  const lastExecution = String(body.lastExecution || '')
  const combined = [pageLog, lastExecution].filter(Boolean).join('\n\n--- dernière exécution ---\n\n')
  const hasError = /ERREUR|ERROR|échec|failed|KO\b/i.test(combined)

  const logEntry = writeVerboseLog(scope, {
    kind: body.kind || 'collect',
    output: combined || '(aucune sortie page)',
    ok: !hasError,
    command: body.command || '',
    summary: body.summary || `Collecte DEBUG — ${scope}`,
    meta: {
      pagePath: body.pagePath || '—',
      sessionHint: body.sessionId || '—',
    },
  })

  return { scope, logEntry, combined }
}

export function buildFullDebugPrompt(body = {}) {
  const scope = normalizeDebugScope(body.scope)
  const verboseBundle = collectScopeVerboseBundle(scope)
  const diagnosis = buildDebugDiagnosis({
    scope,
    log: body.log || body.pageLog || '',
    error: body.error || '',
    verboseBundle,
  })

  const result = buildCopilotDebugPrompt({
    title: body.title || `Debug ${scope} — Wizard QA`,
    context: body.context || '',
    log: body.log || body.pageLog || '',
    error: body.error || diagnosis.lastError || '',
    environment: body.environment || {},
    stepsToReproduce: body.stepsToReproduce || body.steps || [],
    suggestedQuestions: body.suggestedQuestions || body.questions || getAdapterSuggestedQuestions(scope),
    enrich: body.enrich !== false,
    scope,
    hookDir: body.hookDir,
    includeSecrets: Boolean(body.includeSecrets),
    agentModel: body.agentModel || 'Claude Sonnet 4.6',
    userEnrichment: body.userEnrichment || body.enrichment || '',
    verboseBundle,
    diagnosis,
  })

  return {
    ...result,
    preflight: buildPreflight(diagnosis),
    hasWizardSection: result.prompt.includes('Configuration Wizard'),
    verboseBundle,
  }
}

export function startPageDebugFlow(body = {}) {
  const scope = normalizeDebugScope(body.scope)
  const { logEntry, combined } = collectVerboseFromClient(body)
  const { session, created } = startDebugSession({
    scope,
    pagePath: body.pagePath || '',
    pageTitle: body.pageTitle || scope,
  })
  appendSessionLogFile(logEntry.relativePath)

  const built = buildFullDebugPrompt({
    ...body,
    scope,
    log: combined || body.log,
  })

  const snap = saveSessionPromptSnapshot(session.sessionId, session.iteration + 1, built.prompt)
  appendSessionPromptFile(snap.relativePath)

  return {
    session,
    created,
    logEntry,
    ...built,
    promptFile: snap,
  }
}

export function regeneratePageDebugPrompt(body = {}) {
  const scope = normalizeDebugScope(body.scope)
  const enrichment = String(body.userEnrichment || body.enrichment || '').trim()
  if (enrichment) appendSessionEnrichment(enrichment)

  const { logEntry, combined } = collectVerboseFromClient({
    ...body,
    kind: 'regenerate',
    pageLog: body.pageLog || body.log,
  })
  appendSessionLogFile(logEntry.relativePath)

  const built = buildFullDebugPrompt({
    ...body,
    scope,
    log: combined || body.log,
    userEnrichment: enrichment,
  })

  const active = getActiveSession()
  let promptFile = null
  if (active) {
    const snap = saveSessionPromptSnapshot(active.sessionId, (active.iteration || 0) + 1, built.prompt)
    appendSessionPromptFile(snap.relativePath)
    promptFile = snap
  }

  return { ...built, logEntry, promptFile }
}

export function resolvePageDebugSession(body = {}) {
  const active = getActiveSession()
  if (!active) return { ok: false, error: 'Aucune session DEBUG active' }

  const built = buildFullDebugPrompt({
    scope: active.scope,
    userEnrichment: (active.enrichments || []).map((e) => e.text).join('\n'),
  })

  const resolved = resolveDebugSession({
    resolution: body.resolution || body.feedback || 'Problème résolu par l\'utilisateur',
    diagnosis: built.diagnosis,
  })

  appendResolvedCase({
    scope: active.scope,
    sessionId: active.sessionId,
    resolution: body.resolution || body.feedback || '',
    enrichments: active.enrichments || [],
    diagnosis: built.diagnosis,
    logFiles: active.logFiles || [],
    promptFiles: active.promptFiles || [],
  })

  return { ok: true, session: resolved }
}

export function saveDebugPromptToFile(scope, prompt) {
  return savePromptMarkdown(scope, prompt)
}

export { getSessionStatus }

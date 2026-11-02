import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { REPO_ROOT } from './paths.mjs'

export const DEBUG_SESSIONS_REL = '.wizard-qa/conf/debug-sessions'

function getSessionsRoot() {
  const dir = path.join(REPO_ROOT, DEBUG_SESSIONS_REL)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function activePath() {
  return path.join(getSessionsRoot(), 'active.json')
}

function sessionDir(sessionId) {
  return path.join(getSessionsRoot(), sessionId)
}

function readJson(abs, fallback = null) {
  if (!fs.existsSync(abs)) return fallback
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJson(abs, data) {
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, JSON.stringify(data, null, 2), 'utf8')
}

export function getActiveSession() {
  return readJson(activePath(), null)
}

export function getSessionStatus({ scope, pagePath } = {}) {
  const active = getActiveSession()
  if (!active) return { active: false }
  const sameScope = !scope || active.scope === scope
  const samePage = !pagePath || active.pagePath === pagePath
  return {
    active: sameScope && samePage,
    session: active,
  }
}

export function startDebugSession({ scope, pagePath, pageTitle = '' } = {}) {
  const existing = getActiveSession()
  if (existing && existing.scope === scope && existing.pagePath === pagePath) {
    return { session: existing, created: false }
  }

  const sessionId = randomUUID().slice(0, 8)
  const now = new Date().toISOString()
  const session = {
    sessionId,
    scope,
    pagePath,
    pageTitle,
    startedAt: now,
    updatedAt: now,
    iteration: 0,
    enrichments: [],
    promptFiles: [],
    logFiles: [],
  }

  const dir = sessionDir(sessionId)
  fs.mkdirSync(dir, { recursive: true })
  writeJson(path.join(dir, 'manifest.json'), session)
  writeJson(activePath(), session)
  return { session, created: true }
}

export function updateDebugSession(patch = {}) {
  const active = getActiveSession()
  if (!active) return null
  const session = {
    ...active,
    ...patch,
    updatedAt: new Date().toISOString(),
  }
  writeJson(path.join(sessionDir(session.sessionId), 'manifest.json'), session)
  writeJson(activePath(), session)
  return session
}

export function appendSessionEnrichment(text) {
  const active = getActiveSession()
  if (!active) return null
  const enrichments = [...(active.enrichments || [])]
  const entry = { at: new Date().toISOString(), text: String(text || '').trim() }
  if (entry.text) enrichments.push(entry)
  return updateDebugSession({ enrichments })
}

export function appendSessionPromptFile(relativePath) {
  const active = getActiveSession()
  if (!active) return null
  const promptFiles = [...(active.promptFiles || []), relativePath]
  const iteration = (active.iteration || 0) + 1
  return updateDebugSession({ promptFiles, iteration })
}

export function appendSessionLogFile(relativePath) {
  const active = getActiveSession()
  if (!active) return null
  const logFiles = [...(active.logFiles || []), relativePath]
  return updateDebugSession({ logFiles })
}

export function saveSessionPromptSnapshot(sessionId, iteration, prompt) {
  const dir = sessionDir(sessionId)
  fs.mkdirSync(dir, { recursive: true })
  const fileName = `prompt-${String(iteration).padStart(3, '0')}.md`
  const abs = path.join(dir, fileName)
  fs.writeFileSync(abs, String(prompt || ''), 'utf8')
  return {
    fileName,
    absolutePath: abs,
    relativePath: path.join(DEBUG_SESSIONS_REL, sessionId, fileName).replace(/\\/g, '/'),
  }
}

export function resolveDebugSession({ resolution = '', diagnosis = null } = {}) {
  const active = getActiveSession()
  if (!active) return null
  const resolved = {
    ...active,
    resolvedAt: new Date().toISOString(),
    resolution: String(resolution || '').trim(),
    diagnosis,
    status: 'resolved',
  }
  writeJson(path.join(sessionDir(active.sessionId), 'manifest.json'), resolved)
  if (fs.existsSync(activePath())) fs.unlinkSync(activePath())
  return resolved
}

export function loadSessionManifest(sessionId) {
  return readJson(path.join(sessionDir(sessionId), 'manifest.json'), null)
}

export function listSessionPrompts(sessionId) {
  const dir = sessionDir(sessionId)
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter((f) => f.startsWith('prompt-') && f.endsWith('.md'))
    .sort()
    .map((f) => ({
      fileName: f,
      absolutePath: path.join(dir, f),
      relativePath: path.join(DEBUG_SESSIONS_REL, sessionId, f).replace(/\\/g, '/'),
    }))
}

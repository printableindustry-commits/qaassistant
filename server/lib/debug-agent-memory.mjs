import fs from 'fs'
import path from 'path'
import { REPO_ROOT } from './paths.mjs'

export const DEBUG_MEMORY_REL = '.wizard-qa/conf/debug-agent-memory'

function getMemoryRoot() {
  const dir = path.join(REPO_ROOT, DEBUG_MEMORY_REL)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function scopeJsonlPath(scope) {
  return path.join(getMemoryRoot(), `${scope}.jsonl`)
}

function indexPath() {
  return path.join(getMemoryRoot(), 'index.json')
}

function globalInstructionsPath() {
  return path.join(getMemoryRoot(), 'global.instructions.md')
}

function readIndex() {
  const abs = indexPath()
  if (!fs.existsSync(abs)) return { entries: [] }
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf8'))
  } catch {
    return { entries: [] }
  }
}

function writeIndex(data) {
  fs.writeFileSync(indexPath(), JSON.stringify(data, null, 2), 'utf8')
}

export function appendResolvedCase({
  scope,
  sessionId,
  resolution = '',
  enrichments = [],
  diagnosis = null,
  logFiles = [],
  promptFiles = [],
} = {}) {
  const entry = {
    at: new Date().toISOString(),
    scope,
    sessionId,
    resolution,
    enrichments,
    diagnosis,
    logFiles,
    promptFiles,
  }

  const jsonl = scopeJsonlPath(scope)
  fs.appendFileSync(jsonl, `${JSON.stringify(entry)}\n`, 'utf8')

  const index = readIndex()
  index.entries = [
    {
      at: entry.at,
      scope,
      sessionId,
      summary: String(resolution || diagnosis?.summary || 'Cas DEBUG résolu').slice(0, 200),
    },
    ...(index.entries || []),
  ].slice(0, 100)
  writeIndex(index)

  appendGlobalInstructions(scope, entry)
  return entry
}

function appendGlobalInstructions(scope, entry) {
  const lines = [
    '',
    `## ${entry.at} — ${scope}`,
    entry.resolution ? `- Résolution : ${entry.resolution}` : '',
    ...(entry.enrichments || []).map((e) => `- Enrichissement : ${e.text || e}`),
    ...(entry.diagnosis?.hypotheses || []).slice(0, 3).map((h) => `- Hypothèse : ${h}`),
  ].filter(Boolean)

  const abs = globalInstructionsPath()
  const prev = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '# Mémoire DEBUG agent — instructions cumulées\n'
  fs.writeFileSync(abs, `${prev.trimEnd()}\n${lines.join('\n')}\n`, 'utf8')
}

export function getScopeMemoryExcerpt(scope, { limit = 5 } = {}) {
  const jsonl = scopeJsonlPath(scope)
  if (!fs.existsSync(jsonl)) return []
  const lines = fs.readFileSync(jsonl, 'utf8').trim().split('\n').filter(Boolean)
  return lines.slice(-limit).map((line) => {
    try {
      return JSON.parse(line)
    } catch {
      return null
    }
  }).filter(Boolean)
}

export function getMemoryBlockForPrompt(scope) {
  const cases = getScopeMemoryExcerpt(scope, { limit: 3 })
  const globalAbs = globalInstructionsPath()
  const globalText = fs.existsSync(globalAbs)
    ? fs.readFileSync(globalAbs, 'utf8').slice(-4000)
    : ''

  if (!cases.length && !globalText) {
    return '_Aucune mémoire DEBUG enregistrée pour ce scope._'
  }

  const caseLines = cases.map((c, i) => {
    const enrich = (c.enrichments || []).map((e) => e.text || e).join(' ; ')
    return `${i + 1}. **${c.at}** — ${c.resolution || 'résolu'}${enrich ? ` (${enrich})` : ''}`
  }).join('\n')

  return `${caseLines ? `### Cas résolus récents (${scope})\n${caseLines}\n\n` : ''}${globalText ? `### Instructions cumulées\n${globalText}` : ''}`.trim()
}

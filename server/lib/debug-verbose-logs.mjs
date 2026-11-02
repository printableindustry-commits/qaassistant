import fs from 'fs'
import path from 'path'
import { REPO_ROOT } from './paths.mjs'
import { formatLogDisplayTime, formatLogFileName } from './debug-log-format.mjs'
import { collectScopeAdapterBundle } from './debug-page-adapters.mjs'

export const DEBUG_LOGS_REL = '.wizard-qa/logs/debug'

export const DEBUG_SCOPES = new Set([
  'hook-git',
  'sync-jira',
  'node-install',
  'npmrc',
  'npm-install',
  'doc-qa',
])

const SCOPE_LABELS = {
  'hook-git': 'Hook_Git',
  'sync-jira': 'Sync_JIRA',
  'node-install': 'Node_Install',
  npmrc: 'Npmrc',
  'npm-install': 'Npm_Install',
  'doc-qa': 'Doc_QA',
}

export function normalizeDebugScope(scope) {
  const s = String(scope || '').trim().toLowerCase()
  if (!DEBUG_SCOPES.has(s)) {
    throw new Error(`Scope DEBUG inconnu : ${scope}`)
  }
  return s
}

export function getDebugLogDir(scope) {
  const normalized = normalizeDebugScope(scope)
  const dir = path.join(REPO_ROOT, DEBUG_LOGS_REL, normalized)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function writeVerboseLog(scope, {
  kind = 'verbose',
  output = '',
  ok = false,
  command = '',
  exitCode = null,
  summary = '',
  meta = {},
} = {}) {
  const normalized = normalizeDebugScope(scope)
  const dir = getDebugLogDir(normalized)
  const now = new Date()
  const label = `Log_${SCOPE_LABELS[normalized] || normalized}_${kind}`
  const fileName = formatLogFileName(label, now)
  const filePath = path.join(dir, fileName)
  const displayTime = formatLogDisplayTime(now)

  const metaLines = Object.entries(meta || {})
    .map(([k, v]) => `- **${k}** : ${String(v ?? '—')}`)
    .join('\n')

  const content = `# Log DEBUG — ${normalized} (${kind})

| Champ | Valeur |
|-------|--------|
| Horodatage | ${displayTime} |
| Scope | \`${normalized}\` |
| Fichier | \`${fileName}\` |
| Statut | **${ok ? 'OK' : 'KO'}** |
| Code retour | ${exitCode ?? (ok ? 0 : 1)} |
| Commande | \`${command || '—'}\` |

${summary ? `## Résumé\n\n${summary}\n` : ''}
${metaLines ? `\n## Métadonnées\n\n${metaLines}\n` : ''}
## Sortie console (verbose)

\`\`\`text
${String(output || '(aucune sortie)').trimEnd()}
\`\`\`

---
*Généré par Wizard QA Assistant — Prompt DEBUG Copilot*
`

  fs.writeFileSync(filePath, content, 'utf8')
  const relativePath = path.join(DEBUG_LOGS_REL, normalized, fileName).replace(/\\/g, '/')
  return { fileName, filePath, relativePath, displayTime, scope: normalized }
}

export function listVerboseLogs(scope, { limit = 15 } = {}) {
  const dir = getDebugLogDir(scope)
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const abs = path.join(dir, f)
      const st = fs.statSync(abs)
      return {
        fileName: f,
        absolutePath: abs,
        relativePath: path.join(DEBUG_LOGS_REL, normalizeDebugScope(scope), f).replace(/\\/g, '/'),
        mtime: st.mtimeMs,
        size: st.size,
      }
    })
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit)
}

function readTail(absPath, maxChars = 10000) {
  if (!absPath || !fs.existsSync(absPath)) return ''
  try {
    const raw = fs.readFileSync(absPath, 'utf8')
    if (raw.length <= maxChars) return raw
    return `…(tronqué, ${raw.length} car. au total)\n${raw.slice(-maxChars)}`
  } catch (err) {
    return `(lecture impossible : ${err.message})`
  }
}

export function collectScopeVerboseBundle(scope) {
  const normalized = normalizeDebugScope(scope)
  const logs = listVerboseLogs(normalized, { limit: 5 })
  const adapterBundle = collectScopeAdapterBundle(normalized)
  const excerpts = logs.map((f) => ({
    fileName: f.fileName,
    relativePath: f.relativePath,
    excerpt: readTail(f.absolutePath, 6000),
  }))

  const combined = excerpts
    .map((e) => `── ${e.fileName} ──\n${e.excerpt}`)
    .join('\n\n')

  return {
    scope: normalized,
    logDir: getDebugLogDir(normalized),
    logDirRelative: path.join(DEBUG_LOGS_REL, normalized).replace(/\\/g, '/'),
    recentLogs: logs,
    excerpts,
    combinedOutput: combined.trim(),
    adapterBundle,
  }
}

export function savePromptMarkdown(scope, prompt, { sessionId = '', iteration = 1 } = {}) {
  const normalized = normalizeDebugScope(scope)
  const dir = getDebugLogDir(normalized)
  const suffix = sessionId ? `_session-${sessionId}` : ''
  const fileName = formatLogFileName(`Prompt_DEBUG${suffix}_iter${iteration}`)
  const filePath = path.join(dir, fileName)
  fs.writeFileSync(filePath, String(prompt || ''), 'utf8')
  return {
    fileName,
    filePath,
    relativePath: path.join(DEBUG_LOGS_REL, normalized, fileName).replace(/\\/g, '/'),
  }
}

import fs from 'fs'
import path from 'path'

const DEFAULT_KEYS = [
  'project', 'label', 'exclude_dirs', 'jira_indexation_delay_sec',
  'suite_link_type', 'terminal_mode',
]

const ENV_KEYS = [
  'HOOK_ENVIRONMENT', 'JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_TOKEN',
  'HTTPS_PROXY', 'XRAY_CLIENT_ID', 'XRAY_CLIENT_SECRET',
]

export function parseEnvFile(content) {
  const env = {}
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
  }
  return env
}

export function serializeEnv(env) {
  const lines = [
    '# Credentials JIRA / Xray — NE PAS COMMITER',
    '# Modifié via portail poste travail',
  ]
  for (const key of ENV_KEYS) {
    lines.push(`${key}=${env[key] ?? ''}`)
  }
  lines.push('')
  return lines.join('\n')
}

export function parseDefaultsFromConf(content) {
  const defaults = {}
  let inDefaults = false
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (line.match(/^\[(.+)\]$/)) {
      inDefaults = line === '[defaults]'
      continue
    }
    if (!inDefaults || !line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    defaults[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
  }
  return defaults
}

export function mergeDefaultsInConf(content, updates) {
  const lines = content.split('\n')
  let inDefaults = false
  const updatedKeys = new Set()

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    const secMatch = trimmed.match(/^\[(.+)\]$/)
    if (secMatch) {
      inDefaults = secMatch[1] === 'defaults'
      continue
    }
    if (!inDefaults) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1 || trimmed.startsWith('#')) continue
    const key = trimmed.slice(0, eq).trim()
    if (key in updates) {
      lines[i] = `${key}=${updates[key]}`
      updatedKeys.add(key)
    }
  }

  if (updatedKeys.size < Object.keys(updates).length) {
    let defaultsIdx = lines.findIndex(l => l.trim() === '[defaults]')
    if (defaultsIdx === -1) {
      lines.unshift('', '[defaults]')
      defaultsIdx = lines.length - 1
    }
    let insertAt = defaultsIdx + 1
    for (const [key, val] of Object.entries(updates)) {
      if (updatedKeys.has(key)) continue
      lines.splice(insertAt, 0, `${key}=${val}`)
      insertAt++
    }
  }

  return lines.join('\n')
}

export function loadHookConfig(hookDir) {
  const envPath = path.join(hookDir, '.env')
  const confPath = path.join(hookDir, 'hooks.conf')
  const envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : ''
  const confContent = fs.existsSync(confPath) ? fs.readFileSync(confPath, 'utf8') : ''
  const env = parseEnvFile(envContent)
  const defaults = confContent ? parseDefaultsFromConf(confContent) : {}

  return {
    hookDir,
    envPath,
    confPath,
    env: Object.fromEntries(ENV_KEYS.map(k => [k, env[k] ?? ''])),
    defaults: Object.fromEntries(DEFAULT_KEYS.map(k => [k, defaults[k] ?? ''])),
    confExists: fs.existsSync(confPath),
    envExists: fs.existsSync(envPath),
  }
}

export function saveHookSimple(hookDir, { env, defaults }) {
  const envPath = path.join(hookDir, '.env')
  const confPath = path.join(hookDir, 'hooks.conf')

  if (!fs.existsSync(confPath)) {
    throw new Error(`hooks.conf introuvable : ${confPath}`)
  }

  const confContent = fs.readFileSync(confPath, 'utf8')
  const envUpdates = {}
  for (const key of ENV_KEYS) {
    if (env && key in env) envUpdates[key] = env[key] ?? ''
  }
  const defaultUpdates = {}
  for (const key of DEFAULT_KEYS) {
    if (defaults && key in defaults) defaultUpdates[key] = defaults[key] ?? ''
  }

  fs.writeFileSync(envPath, serializeEnv(envUpdates), 'utf8')
  fs.writeFileSync(confPath, mergeDefaultsInConf(confContent, defaultUpdates), 'utf8')

  return { envPath, confPath }
}

/** Fusionne des clés dans le .env du hook sans exiger hooks.conf. */
export function mergeHookEnv(hookDir, patch = {}) {
  if (!hookDir || !fs.existsSync(hookDir)) {
    return { written: false, reason: 'Dossier hook introuvable' }
  }
  const envPath = path.join(hookDir, '.env')
  const existing = fs.existsSync(envPath)
    ? parseEnvFile(fs.readFileSync(envPath, 'utf8'))
    : {}
  const merged = Object.fromEntries(ENV_KEYS.map((k) => [k, existing[k] ?? '']))
  for (const [key, value] of Object.entries(patch)) {
    if (ENV_KEYS.includes(key) && value != null && String(value).trim()) {
      merged[key] = String(value).trim()
    }
  }
  fs.writeFileSync(envPath, serializeEnv(merged), 'utf8')
  return { written: true, envPath }
}

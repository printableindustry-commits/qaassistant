import fs from 'fs'
import path from 'path'
import { SERVER_CONF_DIR } from './paths.mjs'

const TEMPLATE_PATH = path.join(SERVER_CONF_DIR, 'npmrc.template')

export function getNpmrcPath() {
  const home = process.env.USERPROFILE || process.env.HOME || ''
  if (!home) throw new Error('USERPROFILE / HOME introuvable')
  return path.join(home, '.npmrc')
}

export function getDisplayPath() {
  return '%USERPROFILE%\\.npmrc'
}

export function parseNpmrc(content) {
  const fields = {
    email: '',
    'always-auth': 'true',
    registry: '',
    authToken: '',
    SASS_BINARY_SITE: '',
    'strict-ssl': 'false',
    proxy: '',
    'https-proxy': '',
    noproxy: '',
  }
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    if (trimmed.startsWith('//') && trimmed.includes('_authToken=')) {
      fields.authToken = trimmed.split('_authToken=').slice(1).join('_authToken=')
      continue
    }
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const val = trimmed.slice(eq + 1).trim()
    if (key in fields) fields[key] = val
  }
  return fields
}

const DEFAULT_REGISTRY = 'https://registry.saas.cagip.group.gca/artifactory/api/npm/cats-npm-virtual/'
const DEFAULT_SASS_SITE = 'https://repository.saas.cagip.group.gca/artifactory/npm-github-generic-remote/download'
const DEFAULT_AUTH_PREFIX = '//registry.saas.cagip.group.gca/artifactory/api/npm/:_authToken='

export function emptyFields() {
  return {
    email: '',
    'always-auth': 'true',
    registry: '',
    authToken: '',
    SASS_BINARY_SITE: '',
    'strict-ssl': 'false',
    proxy: '',
    'https-proxy': '',
    noproxy: '',
  }
}

/**
 * Préfixe d'authentification du registre : le jeton n'est jamais envoyé à un autre hôte que celui du registre.
 * Le préfixe historique CAGIP est conservé pour ce registre.
 */
export function authPrefixFor(registry) {
  try {
    const u = new URL(registry || DEFAULT_REGISTRY)
    if (u.host === new URL(DEFAULT_REGISTRY).host) return DEFAULT_AUTH_PREFIX
    return `//${u.host}${u.pathname.endsWith('/') ? u.pathname : `${u.pathname}/`}:_authToken=`
  } catch {
    return DEFAULT_AUTH_PREFIX
  }
}

function appendOptionalLines(lines, fields, keys) {
  for (const key of keys) {
    const val = String(fields[key] ?? '').trim()
    if (val) lines.push(`${key}=${val}`)
  }
}

export function buildNpmrc(fields, { bare = false, exact = false } = {}) {
  const useExact = bare || exact
  const registry = useExact ? (fields.registry || '') : (fields.registry || DEFAULT_REGISTRY)
  const sass = useExact ? (fields.SASS_BINARY_SITE || '') : (fields.SASS_BINARY_SITE || DEFAULT_SASS_SITE)
  const lines = [
    `email=${fields.email || ''}`,
    `always-auth=${fields['always-auth'] ?? 'true'}`,
    `registry=${registry}`,
  ]
  if (useExact || fields.authToken || registry) {
    lines.push(`${authPrefixFor(registry)}${fields.authToken || ''}`)
  }
  if (useExact || fields.SASS_BINARY_SITE || !useExact) {
    lines.push(`SASS_BINARY_SITE=${sass}`)
  }
  lines.push(`strict-ssl=${fields['strict-ssl'] ?? 'false'}`)
  appendOptionalLines(lines, fields, ['proxy', 'https-proxy', 'noproxy'])
  lines.push('')
  return lines.join('\n')
}

export function previewNpmrc(fields, options = {}) {
  return buildNpmrc(fields, { exact: true, ...options })
}

export function writeNpmrc(fields, { bare = false, exact = false } = {}) {
  const npmrcPath = getNpmrcPath()
  const content = buildNpmrc(fields, { bare, exact })
  fs.writeFileSync(npmrcPath, content, 'utf8')
  return { path: npmrcPath, content, bare, exact }
}

export function readNpmrc() {
  const npmrcPath = getNpmrcPath()
  const exists = fs.existsSync(npmrcPath)
  const content = exists ? fs.readFileSync(npmrcPath, 'utf8') : ''
  return {
    path: npmrcPath,
    displayPath: getDisplayPath(),
    exists,
    content,
    fields: parseNpmrc(content || fs.readFileSync(TEMPLATE_PATH, 'utf8')),
  }
}

function formatArchiveStamp(date = new Date()) {
  const pad = n => String(n).padStart(2, '0')
  return [
    pad(date.getDate()),
    pad(date.getMonth() + 1),
    date.getFullYear(),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('_')
}

export function archiveNpmrc() {
  const npmrcPath = getNpmrcPath()
  if (!fs.existsSync(npmrcPath)) {
    throw new Error('Aucun fichier .npmrc à archiver')
  }
  const dir = path.dirname(npmrcPath)
  const fileName = `.npmrc_${formatArchiveStamp()}`
  let archivePath = path.join(dir, fileName)
  if (fs.existsSync(archivePath)) {
    archivePath = path.join(dir, `${fileName}_${Date.now()}`)
  }
  fs.renameSync(npmrcPath, archivePath)
  const archivedName = path.basename(archivePath)
  return {
    path: archivePath,
    fileName: archivedName,
    displayPath: `%USERPROFILE%\\${archivedName}`,
  }
}

export function readTemplate() {
  return {
    content: fs.readFileSync(TEMPLATE_PATH, 'utf8'),
    fields: parseNpmrc(fs.readFileSync(TEMPLATE_PATH, 'utf8')),
  }
}

export function readEmptyTemplate() {
  const fields = emptyFields()
  return {
    content: buildNpmrc(fields, { bare: true }),
    fields,
    bare: true,
  }
}

export function writeEmptyNpmrc() {
  return writeNpmrc(emptyFields(), { bare: true })
}

/** Toutes les paires clé=valeur d'un .npmrc (commentaires ignorés). */
export function readNpmrcValues(content) {
  const values = {}
  for (const line of String(content || '').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#') || t.startsWith(';')) continue
    const eq = t.indexOf('=')
    if (eq > 0) values[t.slice(0, eq).trim()] = t.slice(eq + 1).trim()
  }
  return values
}

/**
 * Fusionne des clés dans %USERPROFILE%\.npmrc sans toucher aux autres lignes
 * (jetons, @scope:registry, cafile… sont conservés). Une valeur null supprime la clé.
 * Sauvegarde l'ancien fichier (.npmrc.wizard-backup) avant toute modification ; écriture atomique.
 * Renvoie { path, changed: string[], backup }.
 */
export function mergeNpmrcValues(updates, { dryRun = false } = {}) {
  const npmrcPath = getNpmrcPath()
  const before = fs.existsSync(npmrcPath) ? fs.readFileSync(npmrcPath, 'utf8') : ''
  const lines = before ? before.replace(/^\uFEFF/, '').split(/\r?\n/) : []
  const changed = []
  for (const [key, raw] of Object.entries(updates)) {
    if (!/^[^\s=#;]+$/.test(key)) throw new Error(`Clé .npmrc invalide : ${key}`)
    // Une valeur sur plusieurs lignes injecterait d'autres clés : on ne garde que la première ligne.
    const value = raw == null ? null : String(raw).split(/[\r\n]/)[0].trim()
    const idx = lines.findIndex((l) => {
      const t = l.trim()
      const eq = t.indexOf('=')
      return eq > 0 && !t.startsWith('#') && !t.startsWith(';') && t.slice(0, eq).trim() === key
    })
    if (value === null) {
      if (idx >= 0) { lines.splice(idx, 1); changed.push(key) }
      continue
    }
    const line = `${key}=${value}`
    if (idx >= 0) {
      if (lines[idx].trim() !== line) { lines[idx] = line; changed.push(key) }
    } else {
      while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
      lines.push(line)
      changed.push(key)
    }
  }
  if (!changed.length || dryRun) return { path: npmrcPath, changed, backup: null }
  let backup = null
  if (before) {
    backup = `${npmrcPath}.wizard-backup`
    fs.writeFileSync(backup, before, { encoding: 'utf8', mode: 0o600 })
  }
  const tmp = `${npmrcPath}.${process.pid}.tmp`
  fs.writeFileSync(tmp, `${lines.join('\n').replace(/\n+$/, '')}\n`, { encoding: 'utf8', mode: 0o600 })
  fs.renameSync(tmp, npmrcPath)
  return { path: npmrcPath, changed, backup }
}

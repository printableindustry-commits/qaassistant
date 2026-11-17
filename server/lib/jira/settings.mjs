/**
 * Réglages de connexion JIRA : <CONF_DIR>/jira.json (mode 0o600).
 * Valeurs par défaut reprises du .env / hooks.conf du Hook Git, puis du profil projet.
 * Le jeton n'est jamais renvoyé en clair (maskSettings).
 */
import fs from 'fs'
import path from 'path'
import { CONF_DIR, HOOK_DIR } from '../paths.mjs'
import { loadHookConfig } from '../hook-config.mjs'
import { getProjectProfile } from '../project-profile.mjs'
import { writeAtomic } from './stories.mjs'

const FILE = path.join(CONF_DIR, 'jira.json')
const MASK = '••••'
export const DEFAULT_ISSUE_TYPES = ['Story', 'Récit']

const EMPTY = {
  baseUrl: '',
  deployment: 'auto',       // 'auto' | 'cloud' | 'server'
  authType: 'auto',         // 'auto' | 'basic' (e-mail + jeton) | 'bearer' (jeton d'accès personnel)
  email: '',
  token: '',
  projectKey: '',
  jql: '',
  issueTypes: DEFAULT_ISSUE_TYPES,
  acceptanceField: '',
  proxy: '',
}

function readSaved() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'))
  } catch {
    return {}
  }
}

/** Valeurs proposées tant que l'utilisateur n'a rien enregistré. */
function inheritedDefaults() {
  const out = {}
  const from = []
  try {
    if (fs.existsSync(HOOK_DIR)) {
      const hook = loadHookConfig(HOOK_DIR)
      if (hook.env.JIRA_BASE_URL) out.baseUrl = hook.env.JIRA_BASE_URL
      if (hook.env.JIRA_EMAIL) out.email = hook.env.JIRA_EMAIL
      if (hook.env.JIRA_TOKEN) out.token = hook.env.JIRA_TOKEN
      if (hook.env.HTTPS_PROXY) out.proxy = hook.env.HTTPS_PROXY
      if (hook.defaults.project) out.projectKey = hook.defaults.project
      if (Object.keys(out).length) from.push('hook')
    }
  } catch { /* Hook absent ou illisible : on ignore */ }
  try {
    const profile = getProjectProfile()
    if (!out.baseUrl && profile.jiraBaseUrl) { out.baseUrl = profile.jiraBaseUrl; from.push('profil') }
    if (!out.projectKey && profile.productCode) { out.projectKey = profile.productCode; if (!from.includes('profil')) from.push('profil') }
  } catch { /* profil illisible */ }
  if (out.baseUrl) {
    try { out.baseUrl = normalizeBaseUrl(out.baseUrl) } catch { delete out.baseUrl }
  }
  return { values: out, from }
}

/** Réglages effectifs (secrets en clair : usage serveur uniquement). */
export function loadSettings() {
  const saved = readSaved()
  const inherited = inheritedDefaults()
  const settings = { ...EMPTY, ...inherited.values, ...saved }
  if (!Array.isArray(settings.issueTypes) || !settings.issueTypes.length) settings.issueTypes = DEFAULT_ISSUE_TYPES
  return { settings, saved: Object.keys(saved).length > 0, inheritedFrom: inherited.from }
}

export function isConfigured(settings = loadSettings().settings) {
  return Boolean(settings.baseUrl && settings.token)
}

export function maskSecret(value) {
  if (!value) return ''
  return `${MASK}${String(value).slice(-4)}`
}

/** Masque le mot de passe d'une adresse de proxy, même mal formée (« utilisateur:secret@hote:port »). */
function maskProxy(value) {
  if (!value) return ''
  return String(value).replace(/^((?:[a-z][a-z0-9+.-]*:\/\/)?[^:@/\s]*:)[^@\s]*@/i, `$1${MASK}@`)
}

/** Version publiable (route GET) : jeton et mot de passe du proxy masqués. */
export function maskSettings(settings) {
  return { ...settings, token: maskSecret(settings.token), hasToken: Boolean(settings.token), proxy: maskProxy(settings.proxy) }
}

function normalizeBaseUrl(raw) {
  let value = String(raw || '').trim().replace(/\/+$/, '')
  if (!value) return ''
  // « jira.entreprise.fr » saisi sans protocole : https:// par défaut.
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `https://${value}`
  let u
  try {
    u = new URL(value)
  } catch {
    throw new Error('URL JIRA invalide : saisissez une adresse complète, par exemple https://monentreprise.atlassian.net')
  }
  if (!/^https?:$/.test(u.protocol)) throw new Error('L’URL JIRA doit commencer par https:// (ou http:// pour un serveur interne)')
  // On retire les chemins d'écran collés par erreur (/browse/…, /jira/software/…), mais on garde le
  // chemin de contexte d'un JIRA Server / Data Center (https://intranet.entreprise.fr/jira) : sans lui,
  // l'API serait appelée au mauvais endroit et l'URL collée sur la page Récits ne correspondrait jamais.
  let pathname = u.pathname
  if (/\.(atlassian\.net|jira\.com|jira-dev\.com)$/i.test(u.hostname)) {
    pathname = '' // JIRA Cloud : l'instance est toujours à la racine de l'hôte.
  } else {
    const cut = pathname.search(/\/(browse|projects|secure|issues|plugins|rest|servicedesk|dashboards|login\.jsp|issuenavigator)(\/|$)|\/[^/]+\.jspa(\/|$)|\/jira\/(software|core|servicedesk|your-work|for-you)(\/|$)/i)
    if (cut >= 0) pathname = pathname.slice(0, cut)
  }
  return `${u.origin}${pathname}`.replace(/\/+$/, '')
}

function pick(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback
}

/** Valide et fusionne une saisie avec les réglages actuels (sans écrire). Les champs masqués sont conservés. */
export function mergeSettings(current, input = {}) {
  const next = { ...current }
  if ('baseUrl' in input) next.baseUrl = normalizeBaseUrl(input.baseUrl)
  if ('deployment' in input) next.deployment = pick(input.deployment, ['auto', 'cloud', 'server'], 'auto')
  if ('authType' in input) next.authType = pick(input.authType, ['auto', 'basic', 'bearer'], 'auto')
  if ('email' in input) next.email = String(input.email || '').trim()
  // Un jeton masqué renvoyé tel quel (« ••••abcd ») signifie « inchangé » ; une saisie vide aussi.
  const token = String(input.token ?? '').trim()
  if ('token' in input && token && !token.includes('•')) next.token = token
  if (input.clearToken) next.token = ''
  if ('projectKey' in input) {
    const key = String(input.projectKey || '').trim().toUpperCase()
    if (key && !/^[A-Z][A-Z0-9_]{1,19}$/.test(key)) throw new Error('Clé projet invalide : lettres majuscules et chiffres, par exemple P0326 ou IRMA')
    next.projectKey = key
  }
  if ('jql' in input) {
    const jql = String(input.jql || '').trim()
    if (jql.length > 4000) throw new Error('Requête JQL trop longue (4 000 caractères au plus)')
    next.jql = jql
  }
  if ('issueTypes' in input) {
    const list = Array.isArray(input.issueTypes) ? input.issueTypes : String(input.issueTypes || '').split(',')
    const clean = list.map((t) => String(t).trim()).filter(Boolean).slice(0, 10)
    next.issueTypes = clean.length ? clean : DEFAULT_ISSUE_TYPES
  }
  if ('acceptanceField' in input) next.acceptanceField = String(input.acceptanceField || '').trim().slice(0, 120)
  if ('proxy' in input && !String(input.proxy || '').includes(MASK)) {
    const proxy = String(input.proxy || '').trim()
    if (proxy) {
      try { new URL(proxy) } catch { throw new Error('Adresse de proxy invalide : http://hote:port attendu') }
    }
    next.proxy = proxy
  }
  return next
}

export function saveSettings(input) {
  const { settings } = loadSettings()
  const next = mergeSettings(settings, input)
  const stored = Object.fromEntries(Object.keys(EMPTY).map((k) => [k, next[k]]))
  stored.updatedAt = new Date().toISOString()
  writeAtomic(FILE, stored, 0o600)
  try { fs.chmodSync(FILE, 0o600) } catch { /* Windows : sans effet */ }
  return next
}

/** JQL proposée pour un projet et des types d'issues. */
export function proposedJql(settings) {
  const key = settings.projectKey || 'CLE'
  const types = (settings.issueTypes || DEFAULT_ISSUE_TYPES).map((t) => `"${t.replace(/"/g, '\\"')}"`).join(', ')
  return `project = "${key}" AND issuetype in (${types}) ORDER BY key ASC`
}

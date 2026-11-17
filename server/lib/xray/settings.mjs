/**
 * Réglages Xray : <CONF_DIR>/xray.json (mode 0o600, secret client masqué en lecture).
 *
 *   loadXraySettings()          → { settings, saved, inheritedFrom }   (secret en clair : usage serveur)
 *   maskXraySettings(settings)  → version publiable (clientSecret masqué)
 *   saveXraySettings(input)     → réglages fusionnés et enregistrés
 *
 * Valeurs par défaut : identifiants XRAY_CLIENT_ID / XRAY_CLIENT_SECRET du Hook Git (.env) ou du profil
 * projet (hors valeurs de démonstration), plan de test du profil projet.
 */
import fs from 'fs'
import path from 'path'
import { CONF_DIR } from '../paths.mjs'
import { writeAtomic } from '../jira/stories.mjs'
import { maskSecret } from '../jira/settings.mjs'

const FILE = path.join(CONF_DIR, 'xray.json')
const MASK = '••••'

/** Adresses Xray Cloud par région (la valeur « global » répartit automatiquement). */
export const XRAY_REGIONS = [
  { id: 'global', label: 'Mondiale (par défaut)', url: 'https://xray.cloud.getxray.app' },
  { id: 'eu', label: 'Europe', url: 'https://eu.xray.cloud.getxray.app' },
  { id: 'us', label: 'États-Unis', url: 'https://us.xray.cloud.getxray.app' },
  { id: 'au', label: 'Australie', url: 'https://au.xray.cloud.getxray.app' },
]

export const XRAY_DEFAULTS = {
  mode: 'auto',                 // 'auto' | 'cloud' | 'server'
  cloudBaseUrl: XRAY_REGIONS[0].url,
  clientId: '',
  clientSecret: '',
  testIssueType: 'Test',
  testPlanIssueType: 'Test Plan',
  linkType: 'Test',             // type de lien JIRA (sens sortant « tests » : le Test « tests » le récit)
  defaultTestPlanKey: '',
  playwrightTestType: 'Generic',
  gherkinTestType: 'Cucumber',
  labels: ['wizard-qa', 'playwright'],
}

const KEYS = Object.keys(XRAY_DEFAULTS)
const ISSUE_KEY_RE = /^[A-Z][A-Z0-9_]*-\d+$/

function readSaved() {
  try {
    const data = JSON.parse(fs.readFileSync(FILE, 'utf8'))
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {}
  } catch {
    return {}
  }
}

/** Valeurs de démonstration livrées avec l'application : jamais reprises comme identifiants réels. */
async function demoValues() {
  try {
    const mod = await import('../demo-defaults.mjs')
    const d = mod.getDemoFormDefaults()
    return new Set([d.xrayClientId, d.xrayClientSecret, ...(d.testPlans || []).map((p) => p.planKey)].filter(Boolean))
  } catch {
    return new Set()
  }
}

let inheritedCache = null

/** Identifiants Xray déjà connus du Hook Git ou du profil projet (lu une fois, rechargé après enregistrement). */
async function inheritedDefaults() {
  if (inheritedCache) return inheritedCache
  const out = {}
  const from = []
  const demo = await demoValues()
  const usable = (v) => {
    const s = String(v || '').trim()
    return s && !demo.has(s) ? s : ''
  }
  try {
    const { getJiraSyncSettings, getProjectProfile } = await import('../project-profile.mjs')
    const sync = getJiraSyncSettings()
    if (usable(sync.xrayClientId) && usable(sync.xrayClientSecret)) {
      out.clientId = usable(sync.xrayClientId)
      out.clientSecret = usable(sync.xrayClientSecret)
      from.push('hook')
    }
    const profile = getProjectProfile()
    const plan = usable(profile?.testPlans?.[0]?.planKey).toUpperCase()
    if (plan && ISSUE_KEY_RE.test(plan)) {
      out.defaultTestPlanKey = plan
      if (!from.includes('profil')) from.push('profil')
    }
  } catch { /* profil ou Hook illisible : on ignore */ }
  inheritedCache = { values: out, from }
  return inheritedCache
}

/** Réglages effectifs (secret en clair : usage serveur uniquement). */
export async function loadXraySettings() {
  const saved = readSaved()
  const inherited = await inheritedDefaults()
  const settings = { ...XRAY_DEFAULTS, ...inherited.values }
  for (const k of KEYS) if (k in saved) settings[k] = saved[k]
  if (!Array.isArray(settings.labels)) settings.labels = XRAY_DEFAULTS.labels
  return { settings, saved: Object.keys(saved).length > 0, inheritedFrom: inherited.from }
}

export function regionOf(url) {
  const clean = String(url || '').replace(/\/+$/, '')
  return XRAY_REGIONS.find((r) => r.url === clean)?.id || 'custom'
}

/** Version publiable : secret masqué (« ••••abcd »). */
export function maskXraySettings(settings) {
  return {
    ...settings,
    clientSecret: maskSecret(settings.clientSecret),
    hasClientSecret: Boolean(settings.clientSecret),
    region: regionOf(settings.cloudBaseUrl),
  }
}

function pick(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback
}

function cleanName(value, label, fallback) {
  const s = String(value ?? '').trim()
  if (!s) return fallback
  if (s.length > 80 || /[\r\n"\\]/.test(s)) throw new Error(`${label} invalide (80 caractères au plus, sans guillemets).`)
  return s
}

function normalizeCloudUrl(raw) {
  let value = String(raw || '').trim().replace(/\/+$/, '')
  if (!value) return XRAY_DEFAULTS.cloudBaseUrl
  const region = XRAY_REGIONS.find((r) => r.id === value)
  if (region) return region.url
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `https://${value}`
  let u
  try {
    u = new URL(value)
  } catch {
    throw new Error('Adresse Xray Cloud invalide : par exemple https://xray.cloud.getxray.app')
  }
  if (!/^https?:$/.test(u.protocol)) throw new Error('L’adresse Xray Cloud doit commencer par https://')
  return `${u.origin}${u.pathname}`.replace(/\/+$/, '').replace(/\/api\/v[12]$/, '')
}

/** Valide et fusionne une saisie (sans écrire). Un secret masqué renvoyé tel quel signifie « inchangé ». */
export function mergeXraySettings(current, input = {}) {
  const next = { ...current }
  if ('mode' in input) next.mode = pick(input.mode, ['auto', 'cloud', 'server'], 'auto')
  if ('region' in input && input.region && input.region !== 'custom') next.cloudBaseUrl = normalizeCloudUrl(input.region)
  if ('cloudBaseUrl' in input && (!input.region || input.region === 'custom')) next.cloudBaseUrl = normalizeCloudUrl(input.cloudBaseUrl)
  if ('clientId' in input) {
    const id = String(input.clientId || '').trim()
    if (id.length > 200 || /\s/.test(id)) throw new Error('Identifiant client Xray invalide.')
    next.clientId = id
  }
  const secret = String(input.clientSecret ?? '').trim()
  if ('clientSecret' in input && secret && !secret.includes(MASK.charAt(0))) {
    if (secret.length > 400) throw new Error('Secret client Xray trop long.')
    next.clientSecret = secret
  }
  if (input.clearClientSecret) next.clientSecret = ''
  if ('testIssueType' in input) next.testIssueType = cleanName(input.testIssueType, 'Type d’issue Test', XRAY_DEFAULTS.testIssueType)
  if ('testPlanIssueType' in input) next.testPlanIssueType = cleanName(input.testPlanIssueType, 'Type d’issue Plan de test', XRAY_DEFAULTS.testPlanIssueType)
  if ('linkType' in input) next.linkType = cleanName(input.linkType, 'Type de lien', XRAY_DEFAULTS.linkType)
  if ('playwrightTestType' in input) next.playwrightTestType = cleanName(input.playwrightTestType, 'Type Xray des tests Playwright', XRAY_DEFAULTS.playwrightTestType)
  if ('gherkinTestType' in input) next.gherkinTestType = cleanName(input.gherkinTestType, 'Type Xray des tests Gherkin', XRAY_DEFAULTS.gherkinTestType)
  if ('defaultTestPlanKey' in input) {
    const key = String(input.defaultTestPlanKey || '').trim().toUpperCase()
    if (key && !ISSUE_KEY_RE.test(key)) throw new Error('Clé du plan de test par défaut invalide (par exemple IRMA-120).')
    next.defaultTestPlanKey = key
  }
  if ('labels' in input) {
    const list = Array.isArray(input.labels) ? input.labels : String(input.labels || '').split(/[,;\s]+/)
    next.labels = [...new Set(list.map((l) => String(l).trim()).filter(Boolean))].slice(0, 10)
    if (next.labels.some((l) => l.length > 60)) throw new Error('Étiquette trop longue (60 caractères au plus).')
  }
  return next
}

export async function saveXraySettings(input) {
  const { settings } = await loadXraySettings()
  const next = mergeXraySettings(settings, input)
  const stored = Object.fromEntries(KEYS.map((k) => [k, next[k]]))
  stored.updatedAt = new Date().toISOString()
  writeAtomic(FILE, stored, 0o600)
  try { fs.chmodSync(FILE, 0o600) } catch { /* Windows : sans effet */ }
  inheritedCache = null
  return next
}

export const hasCloudCredentials = (s) => Boolean(s.clientId && s.clientSecret)

/**
 * Mode Xray retenu sans appel réseau : 'cloud' | 'server'.
 * En automatique : Cloud si l'hôte JIRA est un *.atlassian.net ou si le déploiement JIRA est Cloud.
 */
export function guessMode(settings, jiraSettings = {}, deployment = '') {
  if (settings.mode === 'cloud' || settings.mode === 'server') return settings.mode
  const dep = deployment || jiraSettings.deployment
  if (dep === 'cloud') return 'cloud'
  if (dep === 'server') return 'server'
  try {
    if (/\.atlassian\.net$/i.test(new URL(jiraSettings.baseUrl).hostname)) return 'cloud'
  } catch { /* URL absente */ }
  return hasCloudCredentials(settings) ? 'cloud' : 'server'
}

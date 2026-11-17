/**
 * Configuration de l'assistant IA : <CONF_DIR>/llm.json (mode 0600, écriture atomique).
 *
 *   loadConfig()            → configuration complète (secrets en clair, usage serveur uniquement)
 *   publicConfig()          → même forme, secrets masqués (« ••••abcd »), pour les réponses GET
 *   saveConfig(patch)       → fusionne un correctif venu de l'interface, valide et enregistre
 *   bridgeTokens()          → jetons d'appairage acceptés par le pont (fichier + WIZARD_BRIDGE_TOKEN)
 *   regenerateBridgeToken() → nouveau jeton (l'ancien est aussitôt refusé)
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { CONF_DIR } from '../paths.mjs'
import { HttpError } from '../http/router.mjs'

export const CONFIG_PATH = path.join(CONF_DIR, 'llm.json')

export const PROVIDER_IDS = ['vscode-lm', 'copilot-cli', 'openai-compatible', 'anthropic', 'manual']

export const PROVIDER_LABELS = {
  'vscode-lm': 'Copilot local (VS Code)',
  'copilot-cli': 'GitHub Copilot CLI',
  'openai-compatible': 'API compatible OpenAI',
  anthropic: 'Anthropic (Claude)',
  manual: 'Copier-coller',
}

/** Champs secrets : jamais renvoyés en clair. */
const SECRET_FIELDS = { 'openai-compatible': ['apiKey'], anthropic: ['apiKey'] }
const MASK = '••••'

export const DEFAULT_CONFIG = Object.freeze({
  version: 1,
  order: [...PROVIDER_IDS],
  timeoutMs: 120000,
  providers: {
    'vscode-lm': { enabled: true, family: '', timeoutMs: 120000 },
    'copilot-cli': {
      enabled: true,
      command: 'copilot',
      args: ['-p', '{prompt}', '--no-color'],
      modelArgs: ['--model', '{model}'],
      model: '',
      allowTools: [],
      timeoutMs: 180000,
    },
    'openai-compatible': { enabled: false, baseUrl: '', apiKey: '', model: '', apiVersion: '2024-10-21', timeoutMs: 120000 },
    anthropic: { enabled: false, baseUrl: 'https://api.anthropic.com', apiKey: '', model: 'claude-sonnet-5-5', timeoutMs: 120000 },
    manual: { enabled: true },
  },
  bridge: { token: '' },
})

let cache = null

const clone = (v) => JSON.parse(JSON.stringify(v))
const newToken = () => crypto.randomBytes(24).toString('base64url')

function merge(base, extra) {
  const out = clone(base)
  if (!extra || typeof extra !== 'object') return out
  if (Array.isArray(extra.order)) out.order = extra.order
  if (Number.isFinite(extra.timeoutMs)) out.timeoutMs = extra.timeoutMs
  for (const id of PROVIDER_IDS) out.providers[id] = { ...out.providers[id], ...(extra.providers?.[id] || {}) }
  out.bridge = { ...out.bridge, ...(extra.bridge || {}) }
  out.order = normalizeOrder(out.order)
  return out
}

/** Ordre de priorité : identifiants connus, sans doublon, complété par les manquants ; « manual » toujours en dernier. */
function normalizeOrder(order) {
  const seen = new Set()
  const list = (Array.isArray(order) ? order : []).filter((id) => PROVIDER_IDS.includes(id) && id !== 'manual' && !seen.has(id) && seen.add(id))
  for (const id of PROVIDER_IDS) if (id !== 'manual' && !seen.has(id)) list.push(id)
  return [...list, 'manual']
}

function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 })
  fs.renameSync(tmp, file)
  try { fs.chmodSync(file, 0o600) } catch { /* sans effet sous Windows */ }
}

export function loadConfig() {
  if (cache) return cache
  let raw = null
  try {
    if (fs.existsSync(CONFIG_PATH)) raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  } catch (e) {
    console.error(`[llm] llm.json illisible, valeurs par défaut utilisées : ${e.message}`)
  }
  cache = merge(DEFAULT_CONFIG, raw)
  if (!cache.bridge.token) {
    cache.bridge.token = newToken()
    try { writeAtomic(CONFIG_PATH, cache) } catch (e) { console.error(`[llm] écriture de llm.json impossible : ${e.message}`) }
  }
  return cache
}

export function maskSecret(value) {
  const s = String(value || '')
  if (!s) return ''
  return MASK + s.slice(-4)
}

/** Configuration sans aucun secret en clair. */
export function publicConfig() {
  const cfg = clone(loadConfig())
  for (const [id, fields] of Object.entries(SECRET_FIELDS)) {
    for (const f of fields) {
      cfg.providers[id][`${f}Set`] = Boolean(cfg.providers[id][f])
      cfg.providers[id][f] = maskSecret(cfg.providers[id][f])
    }
  }
  cfg.bridge = {
    token: maskSecret(cfg.bridge.token),
    envToken: Boolean(process.env.WIZARD_BRIDGE_TOKEN),
  }
  cfg.path = CONFIG_PATH
  return cfg
}

/** Toutes les valeurs secrètes connues, pour les retirer des messages d'erreur. */
export function secretValues() {
  const cfg = loadConfig()
  const list = [cfg.bridge.token, process.env.WIZARD_BRIDGE_TOKEN]
  for (const [id, fields] of Object.entries(SECRET_FIELDS)) for (const f of fields) list.push(cfg.providers[id][f])
  return list.filter((s) => s && s.length >= 6)
}

export function scrubSecrets(text) {
  let out = String(text ?? '')
  for (const s of secretValues()) out = out.split(s).join(maskSecret(s))
  return out.replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/g, '$1' + MASK)
}

// ------------------------------------------------------------------ validation du correctif

const clampMs = (v, min, max, label) => {
  const n = Number(v)
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${label} : valeur attendue entre ${min / 1000} et ${max / 1000} secondes.`)
  return Math.round(n)
}

const str = (v, max = 500) => String(v ?? '').trim().slice(0, max)

function httpUrl(v, label) {
  const s = str(v, 1000).replace(/\/+$/, '')
  if (!s) return ''
  let u
  try { u = new URL(s) } catch { throw new HttpError(400, `${label} : adresse invalide (attendu http:// ou https://).`) }
  if (!['http:', 'https:'].includes(u.protocol)) throw new HttpError(400, `${label} : seuls http:// et https:// sont acceptés.`)
  return s
}

function stringList(v, label, max = 30) {
  if (v == null) return []
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw new HttpError(400, `${label} : liste de textes attendue.`)
  return v.map((x) => x.slice(0, 400)).filter((x) => x.length).slice(0, max)
}

/** Nom ou chemin d'exécutable : pas de séparateur de commande, pas d'argument. */
function commandName(v) {
  const s = str(v, 400)
  if (!s) return 'copilot'
  if (/[\r\n"<>|&;^`$%*?]/.test(s)) throw new HttpError(400, 'Commande Copilot CLI : caractères interdits (indiquez seulement le nom ou le chemin de l\'exécutable).')
  // Un interpréteur recevrait le prompt des utilisateurs comme du code à exécuter.
  const base = path.basename(s).toLowerCase().replace(/\.(exe|cmd|bat|com|ps1)$/, '')
  if (INTERPRETERS.has(base)) throw new HttpError(400, `Commande Copilot CLI : « ${base} » est un interpréteur de commandes, refusé (le prompt serait exécuté).`)
  return s
}

const INTERPRETERS = new Set(['cmd', 'powershell', 'pwsh', 'bash', 'sh', 'zsh', 'dash', 'fish', 'wsl', 'node', 'deno', 'bun',
  'python', 'python3', 'py', 'perl', 'ruby', 'php', 'wscript', 'cscript', 'mshta', 'rundll32', 'regsvr32', 'env', 'npx', 'npm'])

/** Secret : valeur masquée ou absente → inchangé ; chaîne vide → effacé. */
function secret(next, current) {
  if (next === undefined || next === null) return current
  const s = String(next).trim()
  // Valeur masquée renvoyée telle quelle (ou abîmée par un mauvais encodage) : on garde l'actuelle.
  if (s.includes('•') || s.includes('�')) return current
  if (!/^[!-~]*$/.test(s)) throw new HttpError(400, 'Clé d\'API : caractères non valides (copiez-la sans espace ni accent).')
  return s.slice(0, 500)
}

const PROVIDER_PATCHERS = {
  'vscode-lm': (p, cur) => ({
    enabled: p.enabled ?? cur.enabled,
    family: p.family !== undefined ? str(p.family, 80) : cur.family,
    timeoutMs: p.timeoutMs !== undefined ? clampMs(p.timeoutMs, 10000, 600000, 'Délai Copilot local') : cur.timeoutMs,
  }),
  'copilot-cli': (p, cur) => {
    const args = p.args !== undefined ? stringList(p.args, 'Arguments Copilot CLI') : cur.args
    if (!args.some((a) => a.includes('{prompt}'))) throw new HttpError(400, 'Arguments Copilot CLI : le gabarit doit contenir {prompt}.')
    return {
      enabled: p.enabled ?? cur.enabled,
      command: p.command !== undefined ? commandName(p.command) : cur.command,
      args,
      modelArgs: p.modelArgs !== undefined ? stringList(p.modelArgs, 'Arguments du modèle') : cur.modelArgs,
      model: p.model !== undefined ? str(p.model, 120) : cur.model,
      allowTools: p.allowTools !== undefined ? stringList(p.allowTools, 'Outils autorisés') : cur.allowTools,
      timeoutMs: p.timeoutMs !== undefined ? clampMs(p.timeoutMs, 10000, 900000, 'Délai Copilot CLI') : cur.timeoutMs,
    }
  },
  'openai-compatible': (p, cur) => ({
    enabled: p.enabled ?? cur.enabled,
    baseUrl: p.baseUrl !== undefined ? httpUrl(p.baseUrl, 'URL de l\'API') : cur.baseUrl,
    apiKey: secret(p.apiKey, cur.apiKey),
    model: p.model !== undefined ? str(p.model, 160) : cur.model,
    apiVersion: p.apiVersion !== undefined ? str(p.apiVersion, 40) : cur.apiVersion,
    timeoutMs: p.timeoutMs !== undefined ? clampMs(p.timeoutMs, 5000, 600000, 'Délai API compatible OpenAI') : cur.timeoutMs,
  }),
  anthropic: (p, cur) => ({
    enabled: p.enabled ?? cur.enabled,
    baseUrl: p.baseUrl !== undefined ? (httpUrl(p.baseUrl, 'URL Anthropic') || DEFAULT_CONFIG.providers.anthropic.baseUrl) : cur.baseUrl,
    apiKey: secret(p.apiKey, cur.apiKey),
    model: p.model !== undefined ? (str(p.model, 120) || DEFAULT_CONFIG.providers.anthropic.model) : cur.model,
    timeoutMs: p.timeoutMs !== undefined ? clampMs(p.timeoutMs, 5000, 600000, 'Délai Anthropic') : cur.timeoutMs,
  }),
  manual: () => ({ enabled: true }),
}

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v)

export function saveConfig(patch = {}) {
  if (!isObject(patch)) throw new HttpError(400, 'Réglages : objet JSON attendu.')
  if (patch.providers !== undefined && !isObject(patch.providers)) throw new HttpError(400, 'Réglages des fournisseurs : objet attendu.')
  for (const [id, p] of Object.entries(patch.providers || {})) {
    if (!isObject(p)) throw new HttpError(400, `Réglages de ${providerLabel(id)} : objet attendu.`)
  }
  const cur = loadConfig()
  const next = clone(cur)
  if (patch.order !== undefined) {
    if (!Array.isArray(patch.order)) throw new HttpError(400, 'Ordre de priorité : liste attendue.')
    next.order = normalizeOrder(patch.order)
  }
  if (patch.timeoutMs !== undefined) next.timeoutMs = clampMs(patch.timeoutMs, 5000, 900000, 'Délai global')
  for (const [id, p] of Object.entries(patch.providers || {})) {
    if (!PROVIDER_PATCHERS[id]) throw new HttpError(400, `Fournisseur inconnu : ${id}`)
    if (p.enabled !== undefined) p.enabled = Boolean(p.enabled)
    next.providers[id] = { ...cur.providers[id], ...PROVIDER_PATCHERS[id](p || {}, cur.providers[id]) }
  }
  writeAtomic(CONFIG_PATH, next)
  cache = next
  return next
}

export function bridgeTokens() {
  return [loadConfig().bridge.token, process.env.WIZARD_BRIDGE_TOKEN].filter(Boolean)
}

export function regenerateBridgeToken() {
  const cfg = clone(loadConfig())
  cfg.bridge.token = newToken()
  writeAtomic(CONFIG_PATH, cfg)
  cache = cfg
  return cfg.bridge.token
}

export function providerLabel(id) {
  return PROVIDER_LABELS[id] || id
}

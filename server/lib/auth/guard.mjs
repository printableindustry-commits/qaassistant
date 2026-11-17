/**
 * Garde HTTP de l'application web : contrôle de l'hôte (anti DNS rebinding), de l'origine
 * (anti requêtes intersites) et de la session. Appelé en tête de chaque requête par portail.mjs.
 *
 * Mode intégré (--embedded, lancé par l'extension VS Code) : poste mono-utilisateur, les requêtes
 * locales sont rattachées à l'utilisateur « vscode » ; le contrôle d'origine reste actif.
 */
import { parseCookies, SESSION_COOKIE, userFromToken } from './auth.mjs'

const PUBLIC_PATHS = new Set([
  '/login.html',
  '/api/auth/login',
  '/api/auth/session',
  '/api/health',
  '/favicon.ico',
  '/demo-app',
])
// '/demo-app/' : application de démonstration IRMA (fichiers statiques uniquement, explorée par le moteur Playwright)
const PUBLIC_PREFIXES = ['/assets/prisme/', '/assets/logo-qa', '/assets/fonts/', '/demo-app/']
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

const EMBEDDED_USER = { username: 'vscode', displayName: 'Utilisateur VS Code', role: 'admin', embedded: true }

// Pont de l'extension VS Code (Copilot local) : sans session, chaque route vérifie le jeton d'appairage.
// La gestion du jeton (/api/llm/bridge/token/…) reste réservée aux sessions administrateur.
const BRIDGE_PREFIX = '/api/llm/bridge/'
const BRIDGE_PRIVATE_PREFIX = '/api/llm/bridge/token/'

export function isPublicPath(pathname) {
  if (pathname.startsWith(BRIDGE_PREFIX)) {
    return !pathname.startsWith(BRIDGE_PRIVATE_PREFIX) && pathname !== BRIDGE_PRIVATE_PREFIX.slice(0, -1)
  }
  return PUBLIC_PATHS.has(pathname) || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))
}

function hostName(hostHeader = '') {
  const h = String(hostHeader).toLowerCase()
  if (h.startsWith('[')) return h.slice(0, h.indexOf(']') + 1)
  return h.split(':')[0]
}

function allowedHosts() {
  return String(process.env.PORTAIL_ALLOWED_HOSTS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}

/** Hôte accepté : boucle locale, ou liste PORTAIL_ALLOWED_HOSTS (« * » = tout accepter). */
export function isHostAllowed(hostHeader) {
  const name = hostName(hostHeader)
  if (LOOPBACK.has(name)) return true
  const list = allowedHosts()
  return list.includes('*') || list.includes(name)
}

export function isWebviewOrigin(origin = '') {
  return /^vscode-webview:\/\//i.test(origin)
}

/** Une requête modifiante doit venir de la même origine (ou de la webview VS Code). */
export function isOriginAllowed(req) {
  if (SAFE_METHODS.has(req.method)) return true
  const origin = req.headers.origin
  if (origin) {
    if (isWebviewOrigin(origin)) return true
    try {
      return new URL(origin).host.toLowerCase() === String(req.headers.host || '').toLowerCase()
    } catch {
      return false
    }
  }
  // Pas d'en-tête Origin : client non navigateur (curl, extension) ou navigateur ancien.
  return req.headers['sec-fetch-site'] !== 'cross-site'
}

export function corsHeaders(req) {
  const origin = req.headers.origin
  if (!origin || !isWebviewOrigin(origin)) return {}
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  }
}

export function sessionToken(req) {
  return parseCookies(req.headers.cookie)[SESSION_COOKIE] || ''
}

/**
 * Résout l'utilisateur et décide si la requête passe.
 * Renvoie { ok:true, user } ou { ok:false, status, error, redirect? }.
 */
export function authorize(req, pathname, { embedded = false } = {}) {
  if (!isHostAllowed(req.headers.host)) {
    return { ok: false, status: 421, error: 'Hôte non autorisé (définissez PORTAIL_ALLOWED_HOSTS).' }
  }
  if (!isOriginAllowed(req)) {
    return { ok: false, status: 403, error: 'Origine de la requête refusée.' }
  }
  const user = userFromToken(sessionToken(req)) || (embedded ? EMBEDDED_USER : null)
  if (user || isPublicPath(pathname)) return { ok: true, user }
  const isPage = req.method === 'GET' && (pathname === '/' || pathname.endsWith('.html'))
  if (isPage) {
    const next = encodeURIComponent(req.url || '/')
    return { ok: false, status: 302, redirect: `/login.html?next=${next}` }
  }
  return { ok: false, status: 401, error: 'Session expirée : reconnectez-vous.' }
}

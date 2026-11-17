/**
 * Client REST JIRA, sans dépendance :
 *   - JIRA Cloud (API v3, Basic e-mail:jeton, recherche /rest/api/3/search/jql paginée par nextPageToken) ;
 *   - JIRA Server / Data Center (API v2, Bearer jeton d'accès personnel, /rest/api/2/search paginé par startAt).
 * Détection du déploiement via /rest/api/2/serverInfo, proxy HTTPS (tunnel CONNECT), délai de 30 s,
 * nouvelles tentatives sur 429/503 (Retry-After) et messages d'erreur explicites.
 *
 *   const client = await createJiraClient(settings)
 *   await client.myself()
 *   for await (const page of client.search(jql, fields)) { … }
 */
import http from 'http'
import https from 'https'
import tls from 'tls'

const TIMEOUT_MS = 30000
const MAX_RETRIES = 3
const MAX_WAIT_MS = 30000
const PAGE_SIZE = 100

export class JiraError extends Error {
  constructor(message, { status = 0, code = '', hint = '' } = {}) {
    super(message)
    this.status = status
    this.code = code
    this.hint = hint
  }
}

// ---------------------------------------------------------------- proxy

function proxyFor(target, proxySetting) {
  const raw = proxySetting || process.env.HTTPS_PROXY || process.env.https_proxy || ''
  if (!raw || target.protocol !== 'https:') return null
  const noProxy = (process.env.NO_PROXY || process.env.no_proxy || '').split(',').map((s) => s.trim()).filter(Boolean)
  const host = target.hostname
  if (noProxy.some((n) => n === '*' || host === n || host.endsWith(n.replace(/^\*?\./, '.')))) return null
  try {
    return new URL(raw)
  } catch {
    return null
  }
}

function openTunnel(proxy, host, port) {
  return new Promise((resolve, reject) => {
    const headers = { Host: `${host}:${port}` }
    if (proxy.username) {
      const cred = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`
      headers['Proxy-Authorization'] = `Basic ${Buffer.from(cred).toString('base64')}`
    }
    const lib = proxy.protocol === 'https:' ? https : http
    const req = lib.request({
      host: proxy.hostname,
      port: proxy.port || (proxy.protocol === 'https:' ? 443 : 80),
      method: 'CONNECT',
      path: `${host}:${port}`,
      headers,
      timeout: TIMEOUT_MS,
    })
    req.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy()
        const auth = res.statusCode === 407
        reject(new JiraError(auth ? 'Le proxy demande une authentification (407).' : `Le proxy a refusé la connexion (${res.statusCode}).`, {
          code: 'PROXY',
          hint: auth ? 'Ajoutez l’identifiant et le mot de passe dans l’adresse du proxy : http://utilisateur:motdepasse@hote:port.' : 'Vérifiez l’adresse du proxy dans les réglages ou la variable HTTPS_PROXY.',
        }))
        return
      }
      const secure = tls.connect({ socket, servername: host })
      secure.once('secureConnect', () => resolve(secure))
      secure.once('error', reject)
    })
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })))
    req.on('error', (e) => reject(e.code ? e : Object.assign(e, { code: 'PROXY' })))
    req.end()
  })
}

// ---------------------------------------------------------------- erreurs lisibles

const CERT_CODES = /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER|DEPTH_ZERO|ERR_TLS/i

function networkError(e, url) {
  if (e instanceof JiraError) return e
  const host = url.hostname
  const code = e.code || ''
  if (CERT_CODES.test(code) || CERT_CODES.test(e.message || '')) {
    return new JiraError(`Certificat HTTPS de ${host} non reconnu (${code || e.message}).`, {
      code: 'CERT',
      hint: 'Le réseau de l’entreprise utilise sans doute sa propre autorité de certification : exportez-la (fichier .pem) et démarrez le portail avec la variable NODE_EXTRA_CA_CERTS pointant vers ce fichier.',
    })
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return new JiraError(`Serveur ${host} introuvable.`, { code: 'DNS', hint: 'Vérifiez l’URL JIRA et votre connexion (VPN, proxy d’entreprise).' })
  }
  if (code === 'ECONNREFUSED') return new JiraError(`Connexion refusée par ${host}.`, { code: 'REFUSED', hint: 'Le serveur ne répond pas sur ce port : vérifiez l’URL ou le proxy.' })
  if (code === 'ETIMEDOUT' || code === 'ECONNRESET' || code === 'TIMEOUT') {
    return new JiraError(`Aucune réponse de ${host} en ${TIMEOUT_MS / 1000} s.`, { code: 'TIMEOUT', hint: 'Le réseau est peut-être filtré : renseignez le proxy de l’entreprise dans les réglages, ou réessayez plus tard.' })
  }
  if (code === 'PROXY') return new JiraError(`Proxy injoignable : ${e.message}`, { code: 'PROXY', hint: 'Vérifiez l’adresse du proxy (http://hote:port).' })
  return new JiraError(`Erreur réseau vers ${host} : ${e.message}`, { code: code || 'NETWORK' })
}

function jiraMessages(body) {
  try {
    const data = JSON.parse(body)
    const list = [...(data.errorMessages || []), ...Object.values(data.errors || {})]
    return list.join(' ; ')
  } catch {
    return ''
  }
}

function httpError(status, body, url) {
  const detail = jiraMessages(body)
  const suffix = detail ? ` Détail JIRA : ${detail}` : ''
  switch (status) {
    case 400: return new JiraError(`Requête refusée par JIRA (400).${suffix}`, { status, code: 'BAD_REQUEST', hint: 'Vérifiez la syntaxe de la requête JQL, les types d’issues et la clé projet.' })
    case 401: return new JiraError('Authentification refusée (401).', { status, code: 'AUTH', hint: 'JIRA Cloud : e-mail du compte Atlassian + jeton d’API (id.atlassian.com › Sécurité › Jetons d’API). JIRA Server / Data Center : jeton d’accès personnel (Profil › Jetons d’accès personnels).' })
    case 403: return new JiraError(`Accès refusé (403).${suffix}`, { status, code: 'FORBIDDEN', hint: 'Le compte n’a pas le droit « Parcourir les projets », ou JIRA exige un CAPTCHA après plusieurs échecs : connectez-vous une fois dans le navigateur puis réessayez.' })
    case 404: return new JiraError(`Ressource introuvable (404) : ${url.pathname}.${suffix}`, { status, code: 'NOT_FOUND', hint: 'Vérifiez l’URL de base (sans /browse ni /jira/software) et la clé projet.' })
    case 429: return new JiraError('JIRA limite le nombre d’appels (429) : nouvelles tentatives épuisées.', { status, code: 'RATE_LIMIT', hint: 'Réessayez dans quelques minutes ou réduisez le périmètre JQL.' })
    default:
      if (status >= 500) return new JiraError(`JIRA est indisponible (${status}).${suffix}`, { status, code: 'SERVER', hint: 'Réessayez dans quelques minutes.' })
      return new JiraError(`Réponse inattendue de JIRA (${status}).${suffix}`, { status, code: 'HTTP' })
  }
}

// ---------------------------------------------------------------- requête brute

async function rawRequest(url, { method = 'GET', headers = {}, body, proxy } = {}) {
  const tunnelProxy = proxyFor(url, proxy)
  let tunnel = null
  try {
    if (tunnelProxy) tunnel = await openTunnel(tunnelProxy, url.hostname, url.port || 443)
  } catch (e) {
    throw networkError(e, url)
  }
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body))
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http
    const req = lib.request(url, {
      method,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'WizardQA/3',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
        ...headers,
      },
      ...(tunnel ? { createConnection: () => tunnel, agent: false } : {}),
    }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }))
      res.on('error', (e) => reject(networkError(e, url)))
    })
    req.setTimeout(TIMEOUT_MS, () => req.destroy(Object.assign(new Error('timeout'), { code: 'TIMEOUT' })))
    req.on('error', (e) => reject(networkError(e, url)))
    if (payload) req.write(payload)
    req.end()
  })
}

function retryDelay(res, attempt) {
  const header = Number(res.headers['retry-after'])
  const ms = Number.isFinite(header) && header > 0 ? header * 1000 : 1000 * 2 ** attempt
  return Math.min(ms, MAX_WAIT_MS)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------- client

function authHeader(settings, deployment) {
  const type = settings.authType && settings.authType !== 'auto' ? settings.authType : deployment === 'cloud' ? 'basic' : 'bearer'
  if (type === 'basic') {
    if (!settings.email) throw new JiraError('Adresse e-mail (ou identifiant) manquante pour l’authentification JIRA.', { code: 'CONFIG', hint: 'JIRA Cloud demande l’e-mail du compte Atlassian associé au jeton d’API.' })
    return `Basic ${Buffer.from(`${settings.email}:${settings.token}`).toString('base64')}`
  }
  return `Bearer ${settings.token}`
}

/** Détecte Cloud ou Server / Data Center (deploymentType de serverInfo, puis nom d'hôte). */
async function detectDeployment(base, settings) {
  const url = new URL(`${base}/rest/api/2/serverInfo`)
  try {
    const res = await rawRequest(url, { proxy: settings.proxy })
    if (res.status === 200) {
      const info = JSON.parse(res.body)
      return { deployment: /cloud/i.test(info.deploymentType || '') ? 'cloud' : 'server', info }
    }
  } catch (e) {
    if (e instanceof JiraError && ['DNS', 'CERT', 'TIMEOUT', 'REFUSED', 'PROXY'].includes(e.code)) throw e
  }
  return { deployment: /\.atlassian\.net$/i.test(url.hostname) ? 'cloud' : 'server', info: null }
}

export async function createJiraClient(settings) {
  if (!settings?.baseUrl) throw new JiraError('URL JIRA non renseignée.', { code: 'CONFIG', hint: 'Renseignez l’adresse de votre JIRA dans l’étape « Connexion JIRA ».' })
  if (!settings.token) throw new JiraError('Jeton JIRA non renseigné.', { code: 'CONFIG', hint: 'Créez un jeton d’API (Cloud) ou un jeton d’accès personnel (Server) et saisissez-le dans les réglages.' })
  const base = settings.baseUrl.replace(/\/+$/, '')
  const detected = settings.deployment === 'cloud' || settings.deployment === 'server'
    ? { deployment: settings.deployment, info: null }
    : await detectDeployment(base, settings)
  const deployment = detected.deployment
  const api = deployment === 'cloud' ? '/rest/api/3' : '/rest/api/2'
  const authorization = authHeader(settings, deployment)

  async function request(pathAndQuery, { method = 'GET', body } = {}) {
    const url = new URL(`${base}${pathAndQuery}`)
    for (let attempt = 0; ; attempt++) {
      const res = await rawRequest(url, { method, body, headers: { Authorization: authorization }, proxy: settings.proxy })
      if ((res.status === 429 || res.status === 503) && attempt < MAX_RETRIES) {
        await sleep(retryDelay(res, attempt))
        continue
      }
      if (res.status < 200 || res.status >= 300) throw httpError(res.status, res.body, url)
      if (!res.body) return null
      try {
        return JSON.parse(res.body)
      } catch {
        throw new JiraError('Réponse JIRA illisible (HTML au lieu de JSON).', { code: 'NOT_JSON', hint: 'L’URL pointe sans doute vers une page de connexion (SSO) ou un portail : utilisez l’adresse directe de JIRA.' })
      }
    }
  }

  /** Recherche paginée : itère sur les pages { issues, total|null, loaded }. */
  async function* search(jql, fields) {
    let loaded = 0
    if (deployment === 'cloud') {
      let nextPageToken = ''
      do {
        const qs = new URLSearchParams({ jql, maxResults: String(PAGE_SIZE), fields: fields.join(',') })
        if (nextPageToken) qs.set('nextPageToken', nextPageToken)
        const page = await request(`/rest/api/3/search/jql?${qs}`)
        loaded += (page.issues || []).length
        yield { issues: page.issues || [], total: null, loaded }
        nextPageToken = page.nextPageToken || ''
      } while (nextPageToken)
      return
    }
    let startAt = 0
    let total = 0
    do {
      const qs = new URLSearchParams({ jql, startAt: String(startAt), maxResults: String(PAGE_SIZE), fields: fields.join(',') })
      const page = await request(`/rest/api/2/search?${qs}`)
      const issues = page.issues || []
      total = page.total ?? issues.length
      loaded += issues.length
      startAt += issues.length
      yield { issues, total, loaded }
      if (!issues.length) break
    } while (startAt < total)
  }

  /** Nombre approximatif de résultats (Cloud uniquement ; null si indisponible). */
  async function count(jql) {
    if (deployment !== 'cloud') return null
    try {
      const r = await request('/rest/api/3/search/approximate-count', { method: 'POST', body: { jql } })
      return typeof r?.count === 'number' ? r.count : null
    } catch {
      return null
    }
  }

  async function projects() {
    if (deployment === 'cloud') {
      const out = []
      for (let startAt = 0; startAt < 2000; startAt += 100) {
        const page = await request(`/rest/api/3/project/search?startAt=${startAt}&maxResults=100&orderBy=key`)
        out.push(...(page.values || []))
        if (page.isLast || !(page.values || []).length) break
      }
      return out
    }
    return (await request('/rest/api/2/project')) || []
  }

  return {
    deployment,
    serverInfo: detected.info,
    baseUrl: base,
    request,
    search,
    count,
    projects,
    myself: () => request(`${api}/myself`),
    fields: () => request('/rest/api/2/field'),
    project: (key) => request(`${api}/project/${encodeURIComponent(key)}`),
  }
}

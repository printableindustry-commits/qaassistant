/**
 * Routeur HTTP minimal pour les modules de la V3 (Prisme).
 *
 *   const router = createRouter()
 *   router.get('/api/jira/stories/:key', async (ctx) => ctx.json(200, getStory(ctx.params.key)))
 *   if (await router.handle(req, res, url)) return
 *
 * Chaque module expose `register(router)` dans son fichier routes.mjs ; portail.mjs les monte tous.
 * Le contexte (ctx) donne : req, res, url, params, query, user, body() (JSON, 2 Mo max),
 * json(status, data), text(status, body, type), sse() pour un flux d'événements.
 */

const MAX_BODY_BYTES = 2 * 1024 * 1024

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message)
    this.status = status
    this.details = details
  }
}

function compile(pattern) {
  const keys = []
  const source = pattern
    .split('/')
    .map((seg) => {
      if (seg.startsWith(':')) {
        keys.push(seg.slice(1))
        return '([^/]+)'
      }
      if (seg === '*') {
        keys.push('rest')
        return '(.*)'
      }
      return seg.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    })
    .join('/')
  return { regex: new RegExp(`^${source}/?$`), keys }
}

export function readJsonBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > limit) {
        reject(new HttpError(413, 'Requête trop volumineuse'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      if (!chunks.length) return resolve({})
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new HttpError(400, 'JSON invalide'))
      }
    })
    req.on('error', reject)
  })
}

function makeContext(req, res, url, params, user) {
  let bodyPromise = null
  return {
    req,
    res,
    url,
    params,
    query: Object.fromEntries(url.searchParams.entries()),
    user,
    body() {
      if (!bodyPromise) bodyPromise = readJsonBody(req)
      return bodyPromise
    },
    json(status, data) {
      if (res.headersSent) return
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify(data))
    },
    text(status, body, type = 'text/plain; charset=utf-8', extraHeaders = {}) {
      if (res.headersSent) return
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...extraHeaders })
      res.end(body)
    },
    /** Flux Server-Sent Events : renvoie { send(event, data), close(), closed }. */
    sse() {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      })
      res.write(': ok\n\n')
      const stream = {
        closed: false,
        send(event, data) {
          if (stream.closed) return
          res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        },
        close() {
          if (stream.closed) return
          stream.closed = true
          res.end()
        },
      }
      const ping = setInterval(() => !stream.closed && res.write(': ping\n\n'), 15000)
      req.on('close', () => {
        clearInterval(ping)
        stream.closed = true
      })
      return stream
    },
  }
}

export function createRouter() {
  const routes = []

  function add(method, pattern, handler, options = {}) {
    routes.push({ method, ...compile(pattern), pattern, handler, options })
  }

  return {
    routes,
    get: (p, h, o) => add('GET', p, h, o),
    post: (p, h, o) => add('POST', p, h, o),
    put: (p, h, o) => add('PUT', p, h, o),
    patch: (p, h, o) => add('PATCH', p, h, o),
    delete: (p, h, o) => add('DELETE', p, h, o),

    /** Renvoie true si une route a répondu. `user` vient du garde d'authentification. */
    async handle(req, res, url, user = null) {
      for (const route of routes) {
        if (route.method !== req.method) continue
        const m = url.pathname.match(route.regex)
        if (!m) continue
        if (route.options.role && user?.role !== route.options.role) {
          const ctx = makeContext(req, res, url, {}, user)
          ctx.json(403, { ok: false, error: 'Droits insuffisants' })
          return true
        }
        const params = {}
        try {
          route.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]) })
        } catch {
          makeContext(req, res, url, {}, user).json(400, { ok: false, error: 'Adresse mal formée' })
          return true
        }
        const ctx = makeContext(req, res, url, params, user)
        try {
          const out = await route.handler(ctx)
          if (out !== undefined && !res.headersSent) ctx.json(200, out)
        } catch (e) {
          const status = e instanceof HttpError ? e.status : 500
          if (status >= 500) console.error(`[router] ${req.method} ${url.pathname}:`, e)
          ctx.json(status, { ok: false, error: e.message || String(e), details: e.details })
        }
        return true
      }
      return false
    },
  }
}

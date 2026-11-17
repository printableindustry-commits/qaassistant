/**
 * Données de démonstration (jeu fictif IRMA / « Banque Horizon ») — voir seed.mjs et docs/demo/DEMO.md.
 *   GET  /api/demo/status → { ok, loaded, at, counts }
 *   POST /api/demo/load   (admin) → { ok, at, counts, warnings }
 *   POST /api/demo/reset  (admin) → { ok, removed }
 */
import { HttpError } from '../http/router.mjs'
import { loadDemo, resetDemo, demoStatus } from './seed.mjs'

function wrap(fn) {
  return async (ctx) => {
    try {
      return await fn(ctx)
    } catch (e) {
      if (e instanceof HttpError) throw e
      throw new HttpError(e.status || 500, e.message || String(e))
    }
  }
}

export function register(router) {
  router.get('/api/demo/status', wrap(() => demoStatus()))
  router.post('/api/demo/load', wrap((ctx) => loadDemo(ctx.user)), { role: 'admin' })
  router.post('/api/demo/reset', wrap(() => resetDemo()), { role: 'admin' })
}

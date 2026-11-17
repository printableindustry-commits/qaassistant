/**
 * Visite guidée (autodémo encadrée) : script servi à prisme-tour.js (docs/demo/VISITE-GUIDEE.md).
 *   GET /api/demo/visite   { ok, titre, etapes: [...] }
 *
 * Lu dans cet ordre : WIZARD_DEMO_VISITE=<fichier>, sinon server/conf/demo/visite.json.
 * Un fichier fautif est écarté (journal [visite]) et le script embarqué est utilisé.
 */
import fs from 'node:fs'
import path from 'node:path'
import { SERVER_CONF_DIR } from '../paths.mjs'
import { HttpError } from '../http/router.mjs'

const EMBEDDED = path.join(SERVER_CONF_DIR, 'demo', 'visite.json')

function readScript(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  const etapes = raw.etapes || raw.steps
  if (!Array.isArray(etapes) || !etapes.length) throw new Error('aucune étape')
  return { titre: raw.titre || raw.title || 'Visite guidée', etapes }
}

export function loadVisite() {
  const custom = process.env.WIZARD_DEMO_VISITE
  if (custom) {
    try {
      return readScript(path.resolve(custom))
    } catch (e) {
      console.warn(`[visite] ${custom} écarté (${e.message}) : script embarqué utilisé.`)
    }
  }
  try {
    return readScript(EMBEDDED)
  } catch (e) {
    throw new HttpError(500, `Script de visite illisible : ${e.message}`)
  }
}

export function register(router) {
  router.get('/api/demo/visite', () => ({ ok: true, ...loadVisite() }))
}

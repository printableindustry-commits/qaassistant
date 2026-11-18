/**
 * Visite guidée et démo rejouée : scripts servis à prisme-tour.js (docs/demo/VISITE-GUIDEE.md).
 *   GET /api/demo/visite   { ok, titre, etapes: [...] }   visite commentée (halo sur les écrans)
 *   GET /api/demo/rejeu    { ok, titre, etapes: [...] }   bouton « Démo » : actions jouées dans l'application
 *
 * Lu dans cet ordre : WIZARD_DEMO_VISITE / WIZARD_DEMO_REJEU=<fichier>, sinon server/conf/demo/<nom>.json.
 * Un fichier fautif est écarté (journal [visite]) et le script embarqué est utilisé.
 */
import fs from 'node:fs'
import path from 'node:path'
import { SERVER_CONF_DIR } from '../paths.mjs'
import { HttpError } from '../http/router.mjs'

const SCRIPTS = {
  visite: { file: 'visite.json', env: 'WIZARD_DEMO_VISITE', titre: 'Visite guidée' },
  rejeu: { file: 'demo-rejeu.json', env: 'WIZARD_DEMO_REJEU', titre: 'Démo Wizard QA' },
}

function readScript(file, titre) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  const etapes = raw.etapes || raw.steps
  if (!Array.isArray(etapes) || !etapes.length) throw new Error('aucune étape')
  return { titre: raw.titre || raw.title || titre, etapes }
}

export function loadScript(name = 'visite') {
  const def = SCRIPTS[name]
  if (!def) throw new HttpError(404, `Script de démo inconnu : ${name}`)
  const custom = process.env[def.env]
  if (custom) {
    try {
      return readScript(path.resolve(custom), def.titre)
    } catch (e) {
      console.warn(`[visite] ${custom} écarté (${e.message}) : script embarqué utilisé.`)
    }
  }
  try {
    return readScript(path.join(SERVER_CONF_DIR, 'demo', def.file), def.titre)
  } catch (e) {
    throw new HttpError(500, `Script de démo illisible : ${e.message}`)
  }
}

export const loadVisite = () => loadScript('visite')

export function register(router) {
  router.get('/api/demo/visite', () => ({ ok: true, ...loadScript('visite') }))
  router.get('/api/demo/rejeu', () => ({ ok: true, ...loadScript('rejeu') }))
}

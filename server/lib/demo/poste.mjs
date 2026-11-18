/**
 * État SIMULÉ du poste pendant la démonstration (◇ démonstration).
 *
 * Quand la démo est chargée, seed.mjs écrit <REPO_ROOT>/.wizard-qa/demo/poste.json : les écrans historiques
 * (Préparer mon poste, .npmrc, npm, k6, Hook Git, Sync JIRA…) lisent alors cet état fictif au lieu de sonder
 * le poste (node -v, npm -v, k6 version, dépôt git…). Rien n'est installé ni modifié sur le vrai poste ;
 * POST /api/demo/reset supprime le fichier et les écrans reviennent à la détection réelle.
 *
 *   demoPoste()             → contenu de poste.json, ou null hors démo (lecture mise en cache, sans exception)
 *   assertNotDemoPoste(op)  → lève une erreur 409 si l'opération écrirait l'état fictif sur le vrai poste
 */
import fs from 'fs'
import path from 'path'
import { REPO_ROOT } from '../paths.mjs'

export const DEMO_POSTE_FILE = path.join(REPO_ROOT, '.wizard-qa', 'demo', 'poste.json')
export const DEMO_MARK = '◇ démonstration'

let cache = { mtimeMs: -1, value: null }

export function demoPoste() {
  let st
  try {
    st = fs.statSync(DEMO_POSTE_FILE)
  } catch {
    cache = { mtimeMs: -1, value: null }
    return null
  }
  if (st.mtimeMs !== cache.mtimeMs) {
    let value = null
    try { value = JSON.parse(fs.readFileSync(DEMO_POSTE_FILE, 'utf8')) } catch { value = null }
    cache = { mtimeMs: st.mtimeMs, value }
  }
  return cache.value
}

export function assertNotDemoPoste(operation) {
  if (!demoPoste()) return
  throw Object.assign(new Error(`${operation} : indisponible pendant la démonstration (état du poste simulé ${DEMO_MARK}). Réinitialisez la démo dans Réglages → Démonstration pour agir sur le vrai poste.`), { status: 409 })
}

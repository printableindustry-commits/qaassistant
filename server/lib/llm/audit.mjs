/**
 * Journal d'audit minimal des appels à l'IA : date, fournisseur, usage, durée, succès.
 * Jamais de contenu (prompt, réponse) ni de secret. Fichier JSON Lines, rotation à 1 Mo.
 */
import fs from 'fs'
import path from 'path'
import { REPO_ROOT } from '../paths.mjs'

const AUDIT_DIR = path.join(REPO_ROOT, '.wizard-qa', 'llm')
export const AUDIT_PATH = path.join(AUDIT_DIR, 'audit.jsonl')
const MAX_BYTES = 1024 * 1024

export function audit({ provider, purpose, durationMs, ok, code, model }) {
  const entry = {
    at: new Date().toISOString(),
    provider,
    purpose: String(purpose || 'chat').slice(0, 40),
    durationMs: Math.round(durationMs || 0),
    ok: Boolean(ok),
  }
  if (model) entry.model = String(model).slice(0, 80)
  if (code) entry.code = String(code).slice(0, 40)
  try {
    fs.mkdirSync(AUDIT_DIR, { recursive: true })
    if (fs.existsSync(AUDIT_PATH) && fs.statSync(AUDIT_PATH).size > MAX_BYTES) {
      fs.renameSync(AUDIT_PATH, `${AUDIT_PATH}.1`)
    }
    fs.appendFileSync(AUDIT_PATH, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600 })
  } catch (e) {
    console.error(`[llm] journal d'audit indisponible : ${e.message}`)
  }
}

/** Dernières entrées, les plus récentes d'abord. */
export function readAudit(limit = 100) {
  try {
    if (!fs.existsSync(AUDIT_PATH)) return []
    const lines = fs.readFileSync(AUDIT_PATH, 'utf8').trim().split('\n').filter(Boolean)
    return lines.slice(-limit).reverse().map((l) => {
      try { return JSON.parse(l) } catch { return null }
    }).filter(Boolean)
  } catch {
    return []
  }
}

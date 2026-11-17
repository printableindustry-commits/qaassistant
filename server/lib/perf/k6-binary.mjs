/**
 * Détection du binaire k6 (PATH complété : installation portable, WinGet, Program Files…).
 * Résultat mis en cache 60 s ; l'état synchrone sert au statut de page et au résumé.
 */
import { probeK6, withK6Path } from '../stack-command-runner.mjs'

const TTL_MS = 60000
let cache = { at: 0, value: null, pending: null }

export async function detectK6({ force = false } = {}) {
  const fresh = cache.value && Date.now() - cache.at < TTL_MS
  if (fresh && !force) return cache.value
  if (cache.pending) return cache.pending
  cache.pending = probeK6(process.env)
    .then((r) => ({
      installed: Boolean(r.k6Present),
      version: r.k6Present ? String(r.k6Version).split(/\s+/)[0].replace(/^v/, '') : '',
      detail: r.k6Present ? String(r.k6Version) : '',
      checkedAt: new Date().toISOString(),
    }))
    .catch(() => ({ installed: false, version: '', checkedAt: new Date().toISOString() }))
    .then((value) => {
      cache = { at: Date.now(), value, pending: null }
      return value
    })
  return cache.pending
}

/** Dernier état connu (null tant qu'aucune détection n'a eu lieu). */
export function k6StateSync() {
  return cache.value
}

/** Environnement d'exécution de k6 (PATH complété). */
export function k6Env(base = process.env) {
  return withK6Path(base)
}

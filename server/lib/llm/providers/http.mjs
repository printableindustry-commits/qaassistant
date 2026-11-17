/**
 * Appel HTTP JSON commun aux fournisseurs d'API (OpenAI compatible, Anthropic).
 * Traduit les erreurs réseau et HTTP en ProviderError lisibles, sans jamais citer de secret.
 */
import { ProviderError } from '../prompt.mjs'
import { scrubSecrets } from '../config.mjs'

const HTTP_HINTS = {
  400: 'requête refusée par l\'API (modèle ou paramètres invalides)',
  401: 'clé d\'API refusée',
  403: 'accès refusé (droits de la clé ou du modèle)',
  404: 'adresse ou modèle introuvable',
  408: 'délai dépassé côté API',
  413: 'prompt trop volumineux pour l\'API',
  429: 'quota ou limite de débit atteint',
  500: 'erreur interne du fournisseur',
  502: 'passerelle indisponible',
  503: 'service momentanément indisponible',
  529: 'service surchargé',
}

function apiMessage(data) {
  const e = data?.error
  if (typeof e === 'string') return e
  return e?.message || data?.message || ''
}

export async function postJson(url, { headers = {}, body, signal }) {
  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
      body: JSON.stringify(body),
      signal,
    })
  } catch (e) {
    if (e?.name === 'AbortError' || e?.name === 'TimeoutError') throw e
    const cause = e?.cause?.code || e?.cause?.message || e?.message || 'erreur réseau'
    throw new ProviderError('network', `Serveur injoignable (${scrubSecrets(cause)}) : vérifiez l'URL, le proxy et que le service est démarré.`)
  }
  const raw = await res.text()
  let data = null
  try { data = raw ? JSON.parse(raw) : null } catch { data = null }
  if (!res.ok) {
    const hint = HTTP_HINTS[res.status] || 'erreur HTTP'
    const detail = scrubSecrets(apiMessage(data) || raw.slice(0, 200)).replace(/\s+/g, ' ').trim()
    throw new ProviderError(`http_${res.status}`, `HTTP ${res.status} — ${hint}${detail ? ` : ${detail.slice(0, 300)}` : ''}`)
  }
  if (!data) throw new ProviderError('bad_response', 'Réponse de l\'API illisible (JSON attendu).')
  return data
}

export function isLocalUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host) || host.endsWith('.localhost')
  } catch {
    return false
  }
}

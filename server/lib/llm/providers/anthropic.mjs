/**
 * Fournisseur « anthropic » : API Messages (POST /v1/messages).
 * En-têtes : x-api-key, anthropic-version: 2023-06-01. Modèle par défaut : claude-sonnet-5-5.
 */
import { ProviderError } from '../prompt.mjs'
import { postJson } from './http.mjs'

export const id = 'anthropic'
export const API_VERSION = '2023-06-01'

function apiKey(cfg) {
  return cfg.apiKey || process.env.ANTHROPIC_API_KEY || ''
}

export function availability(cfg) {
  if (!cfg.enabled) return { available: false, reason: 'Désactivé dans les réglages.' }
  if (!apiKey(cfg)) return { available: false, reason: 'Clé d\'API à renseigner (ou variable ANTHROPIC_API_KEY).' }
  return { available: true, reason: 'Clé d\'API renseignée.', model: cfg.model }
}

/** L'API exige une alternance utilisateur / assistant commençant par l'utilisateur. */
function alternate(messages) {
  const out = []
  for (const m of messages) {
    const last = out[out.length - 1]
    if (last && last.role === m.role) last.content += `\n\n${m.content}`
    else out.push({ role: m.role, content: m.content })
  }
  if (out[0]?.role !== 'user') out.unshift({ role: 'user', content: '(début de la conversation)' })
  return out
}

export async function run({ system, messages, maxTokens, signal }, cfg) {
  const base = String(cfg.baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '')
  const body = { model: cfg.model || 'claude-sonnet-5-5', max_tokens: maxTokens, messages: alternate(messages) }
  if (system) body.system = system
  const data = await postJson(`${base}/v1/messages`, {
    headers: { 'x-api-key': apiKey(cfg), 'anthropic-version': API_VERSION },
    body,
    signal,
  })
  const text = (data.content || []).filter((b) => b?.type === 'text').map((b) => b.text).join('')
  if (!text.trim()) {
    const why = data.stop_reason === 'refusal' ? 'le modèle a refusé de répondre' : 'réponse vide'
    throw new ProviderError('empty', `Anthropic : ${why}.`)
  }
  return { text, model: data.model || body.model }
}

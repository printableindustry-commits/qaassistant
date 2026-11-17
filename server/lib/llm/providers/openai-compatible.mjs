/**
 * Fournisseur « openai-compatible » : toute API /chat/completions.
 *   OpenAI          https://api.openai.com/v1
 *   GitHub Models   https://models.github.ai/inference          (jeton GitHub, modèle « openai/gpt-4.1 »)
 *   Azure OpenAI    https://<ressource>.openai.azure.com/openai/deployments/<déploiement>
 *   Ollama          http://localhost:11434/v1                    (sans clé)
 *   LM Studio       http://localhost:1234/v1                     (sans clé)
 */
import { ProviderError } from '../prompt.mjs'
import { postJson, isLocalUrl } from './http.mjs'

export const id = 'openai-compatible'

const isAzure = (baseUrl) => /\.openai\.azure\.com|\.cognitiveservices\.azure\.com/i.test(baseUrl)

function apiKey(cfg) {
  return cfg.apiKey || process.env.OPENAI_API_KEY || ''
}

export function endpoint(cfg) {
  const base = String(cfg.baseUrl || '').replace(/\/+$/, '')
  const url = new URL(/\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`)
  if (isAzure(base) && !url.searchParams.has('api-version')) url.searchParams.set('api-version', cfg.apiVersion || '2024-10-21')
  return url.toString()
}

export function availability(cfg) {
  if (!cfg.enabled) return { available: false, reason: 'Désactivé dans les réglages.' }
  if (!cfg.baseUrl) return { available: false, reason: 'URL de l\'API à renseigner.' }
  if (!cfg.model && !isAzure(cfg.baseUrl)) return { available: false, reason: 'Modèle à renseigner.' }
  if (!apiKey(cfg) && !isLocalUrl(cfg.baseUrl)) return { available: false, reason: 'Clé d\'API à renseigner (ou variable OPENAI_API_KEY).' }
  return { available: true, reason: `Prêt : ${new URL(cfg.baseUrl).host}`, model: cfg.model || 'déploiement Azure' }
}

export async function run({ system, messages, maxTokens, signal }, cfg) {
  const key = apiKey(cfg)
  const headers = {}
  if (key) {
    if (isAzure(cfg.baseUrl)) headers['api-key'] = key
    else headers.Authorization = `Bearer ${key}`
  }
  const body = {
    messages: [...(system ? [{ role: 'system', content: system }] : []), ...messages],
    max_tokens: maxTokens,
    temperature: 0.2,
    stream: false,
  }
  if (cfg.model) body.model = cfg.model
  const data = await postJson(endpoint(cfg), { headers, body, signal })
  const choice = data.choices?.[0]
  const content = choice?.message?.content
  const text = Array.isArray(content) ? content.map((c) => c?.text || '').join('') : content
  if (typeof text !== 'string' || !text.trim()) {
    const why = choice?.finish_reason === 'content_filter' ? 'réponse bloquée par le filtre de contenu' : 'réponse vide'
    throw new ProviderError('empty', `L'API a renvoyé une ${why}.`)
  }
  return { text, model: data.model || cfg.model || '' }
}

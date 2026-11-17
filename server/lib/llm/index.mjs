/**
 * Assistant IA — point d'entrée commun à tous les modules (contrat V3 §4.1).
 *
 *   const r = await complete({ purpose, system, messages, json, maxTokens, signal, provider })
 *   // { ok:true, text, provider, model, durationMs }  ou  { ok:false, manual:true, provider:'manual', prompt, reason }
 *   getLlmStatus() // { active: { id, label, model } | null, providers: [{ id, label, available, reason }] }
 *
 * Les fournisseurs sont essayés dans l'ordre de priorité configuré (llm.json) ; un échec passe au suivant.
 * Si aucun ne répond, le prompt complet est renvoyé pour un copier-coller manuel.
 */
import { performance } from 'perf_hooks'
import { loadConfig, providerLabel, PROVIDER_IDS, scrubSecrets } from './config.mjs'
import { normalizeMessages, splitSystem, flattenPrompt, extractJson, ProviderError } from './prompt.mjs'
import { audit } from './audit.mjs'
import * as vscodeLm from './providers/vscode-lm.mjs'
import * as copilotCli from './providers/copilot-cli.mjs'
import * as openaiCompatible from './providers/openai-compatible.mjs'
import * as anthropic from './providers/anthropic.mjs'

const PROVIDERS = {
  'vscode-lm': vscodeLm,
  'copilot-cli': copilotCli,
  'openai-compatible': openaiCompatible,
  anthropic,
}

const MIN_TIMEOUT_MS = 1000
const MAX_TIMEOUT_MS = 15 * 60 * 1000

export { PROVIDER_IDS }

/** Disponibilité d'un fournisseur (synchrone, sans réseau). */
export function providerAvailability(id) {
  if (id === 'manual') return { available: true, reason: 'Toujours disponible : le prompt est fourni à copier.' }
  const impl = PROVIDERS[id]
  if (!impl) return { available: false, reason: 'Fournisseur inconnu.' }
  try {
    return impl.availability(loadConfig().providers[id])
  } catch (e) {
    return { available: false, reason: `Configuration invalide : ${e.message}` }
  }
}

export function getLlmStatus() {
  const cfg = loadConfig()
  const providers = cfg.order.map((id) => {
    const a = providerAvailability(id)
    return { id, label: providerLabel(id), available: Boolean(a.available), reason: a.reason || '', model: a.model || '' }
  })
  const first = providers.find((p) => p.available && p.id !== 'manual')
  return {
    active: first ? { id: first.id, label: first.label, model: first.model || '' } : null,
    providers,
  }
}

function isAbort(e) {
  return e?.name === 'AbortError' || e?.name === 'TimeoutError'
}

function timeoutFor(requested, providerCfg, cfg) {
  const ms = Number(requested ?? providerCfg?.timeoutMs ?? cfg.timeoutMs)
  return Math.min(Math.max(Number.isFinite(ms) ? ms : cfg.timeoutMs, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS)
}

/** Appelle un fournisseur ; résout { ok, ... } sans lever d'exception. */
async function attempt(id, input, cfg, callerSignal) {
  const pcfg = cfg.providers[id]
  const timeoutMs = timeoutFor(input.timeoutMs, pcfg, cfg)
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  const signal = callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal
  const t0 = performance.now()
  try {
    const r = await PROVIDERS[id].run({ ...input, signal, timeoutMs }, pcfg)
    return { ok: true, text: r.text, model: r.model || '', durationMs: Math.round(performance.now() - t0) }
  } catch (e) {
    const durationMs = Math.round(performance.now() - t0)
    if (callerSignal?.aborted) return { ok: false, code: 'aborted', error: 'Requête annulée.', durationMs }
    if (isAbort(e)) return { ok: false, code: 'timeout', error: `Délai dépassé (${Math.round(timeoutMs / 1000)} s).`, durationMs }
    if (!(e instanceof ProviderError)) console.error(`[llm] erreur inattendue du fournisseur ${id} :`, e)
    return { ok: false, code: e.code || 'error', error: scrubSecrets(e.message || String(e)), durationMs }
  }
}

function withJson(text) {
  const ex = extractJson(text)
  return ex.ok ? { text: ex.text, json: ex.value } : { text, json: null, jsonError: 'La réponse ne contient pas de JSON valide.' }
}

/**
 * Appel à l'assistant IA. Ne lève une exception que pour une erreur de programmation
 * (messages absents ou mal formés, fournisseur inconnu).
 */
export async function complete(options = {}) {
  const { purpose = 'chat', system = '', json = false, maxTokens = 4000, signal, provider, timeoutMs } = options
  const messages = normalizeMessages(options.messages)
  if (provider !== undefined && provider !== null && !PROVIDER_IDS.includes(provider)) {
    throw new TypeError(`complete() : fournisseur inconnu « ${provider} ».`)
  }
  const cfg = loadConfig()
  const split = splitSystem({ system, messages, json })
  const prompt = flattenPrompt(split)
  const attempts = []
  const manual = (reason, extra = {}) => ({ ok: false, manual: true, provider: 'manual', prompt, reason, attempts, ...extra })

  if (provider === 'manual') return manual('Mode copier-coller demandé.')

  const input = {
    purpose,
    system: split.system,
    messages: split.messages,
    prompt,
    maxTokens: Math.min(Math.max(Number(maxTokens) || 4000, 16), 64000),
    timeoutMs,
  }
  const candidates = provider ? [provider] : cfg.order.filter((id) => id !== 'manual')

  for (const id of candidates) {
    const av = providerAvailability(id)
    if (!av.available) {
      if (provider) attempts.push({ provider: id, ok: false, skipped: true, error: av.reason })
      continue
    }
    if (signal?.aborted) return manual('Requête annulée.', { aborted: true })
    const r = await attempt(id, input, cfg, signal)
    audit({ provider: id, purpose, durationMs: r.durationMs, ok: r.ok, code: r.code, model: r.model })
    if (r.ok) {
      const out = { ok: true, text: r.text, provider: id, model: r.model, durationMs: r.durationMs }
      return json ? { ...out, ...withJson(r.text) } : out
    }
    attempts.push({ provider: id, ok: false, code: r.code, error: r.error, durationMs: r.durationMs })
    if (r.code === 'aborted') return manual('Requête annulée.', { aborted: true })
  }

  if (!attempts.length) return manual('Aucun fournisseur d\'IA disponible : mode copier-coller.')
  const detail = attempts.map((a) => `${providerLabel(a.provider)} : ${a.error}`).join(' ; ')
  return manual(attempts.every((a) => a.skipped) ? `Fournisseur indisponible — ${detail}` : `Échec de l'appel — ${detail}`)
}

/** Relance la détection de Copilot CLI (asynchrone, réseau local uniquement). */
export function refreshDetection(force = false) {
  return copilotCli.detect({ command: loadConfig().providers['copilot-cli'].command, force })
}

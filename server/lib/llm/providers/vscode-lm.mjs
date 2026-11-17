/**
 * Fournisseur « vscode-lm » : Copilot local, relayé par l'extension VS Code (voir ../bridge.mjs).
 */
import { ProviderError } from '../prompt.mjs'
import { bridgeAvailability, submit } from '../bridge.mjs'

export const id = 'vscode-lm'

export function availability(cfg) {
  if (!cfg.enabled) return { available: false, reason: 'Désactivé dans les réglages.' }
  const a = bridgeAvailability()
  return cfg.family && a.available ? { ...a, model: cfg.family } : a
}

export async function run({ purpose, system, messages, maxTokens, signal, timeoutMs }, cfg) {
  // Délai du pont légèrement plus court : son message explique où la requête s'est arrêtée.
  const r = await submit({ purpose, system, messages, maxTokens, family: cfg.family || '', timeoutMs: Math.max(timeoutMs - 500, 500), signal })
  if (!r.ok) {
    if (r.code === 'aborted' && signal?.aborted) throw signal.reason || new DOMException('Annulé', 'AbortError')
    throw new ProviderError(r.code || 'error', r.error)
  }
  return { text: r.text, model: r.model || cfg.family || 'copilot' }
}

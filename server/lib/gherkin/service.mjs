/**
 * Orchestration de la génération d'un récit : modèle intégré, assistant IA ou automatique.
 *
 *   generateForStory(story, { mode: 'auto'|'llm'|'template', provider, user, signal })
 *     → { ok: true, entry, analysis, usedMode, provider, model, retried, notice, manualPrompt? }
 *     | { ok: false, manual: true, prompt, reason }   (mode « llm » sans fournisseur disponible)
 *     | { ok: false, error }
 */
import { getLlmStatus } from '../llm/index.mjs'
import { getProjectProfile } from '../project-profile.mjs'
import { generateFromTemplate } from './template.mjs'
import { generateWithLlm, manualPrompt } from './prompt.mjs'
import { saveFeature } from './store.mjs'

export const MODES = ['auto', 'llm', 'template']

// Récits en cours de génération (page et lot partagent ce verrou : pas deux générations simultanées d'un même récit).
const generating = new Set()
export const isGenerating = (key) => generating.has(key)

/** Exécute fn sous verrou ; renvoie null si le récit est déjà en cours de génération. */
export async function withGenerationLock(key, fn) {
  if (generating.has(key)) return null
  generating.add(key)
  try {
    return await fn()
  } finally {
    generating.delete(key)
  }
}

function profile() {
  try {
    return getProjectProfile()
  } catch {
    return {}
  }
}

/** Un assistant IA (autre que le copier-coller) est-il disponible ? */
export function llmAvailable() {
  try {
    return Boolean(getLlmStatus().active)
  } catch {
    return false
  }
}

function fromTemplate(story, user, notice) {
  const p = profile()
  const r = generateFromTemplate(story, { applicationLabel: p.applicationLabel })
  const { entry, analysis } = saveFeature(story.key, r.text, { generatedBy: 'template', user, warnings: r.warnings })
  return { ok: true, entry, analysis, usedMode: 'template', provider: 'template', model: '', retried: false, notice, warnings: r.warnings }
}

async function fromLlm(story, { provider, user, signal }) {
  const r = await generateWithLlm(story, { provider, signal, profile: profile() })
  if (!r.ok) return r
  const notice = r.analysis.valid
    ? (r.retried ? 'Réponse corrigée automatiquement après une première proposition invalide.' : null)
    : 'La réponse de l\'assistant contient encore des erreurs : corrigez-les avant de valider.'
  const { entry, analysis } = saveFeature(story.key, r.text, { generatedBy: 'llm', provider: r.provider, model: r.model, user })
  return { ok: true, entry, analysis, usedMode: 'llm', provider: r.provider, model: r.model, durationMs: r.durationMs, retried: r.retried, notice }
}

export async function generateForStory(story, { mode = 'auto', provider, user, signal } = {}) {
  if (mode === 'template') return fromTemplate(story, user, null)
  if (mode === 'llm') return fromLlm(story, { provider, user, signal })

  // Automatique : IA si un fournisseur répond, sinon modèle intégré (le prompt reste proposé).
  if (!llmAvailable() && !provider) {
    const out = fromTemplate(story, user, 'Aucun assistant IA disponible : scénarios produits par le modèle intégré.')
    out.manualPrompt = await manualPrompt(story, { profile: profile() })
    return out
  }
  const r = await fromLlm(story, { provider, user, signal })
  if (r.ok) return r
  if (r.aborted) return { ok: false, error: 'Génération annulée.' }
  const out = fromTemplate(story, user, `Assistant IA indisponible (${r.reason || r.error}) : modèle intégré utilisé.`)
  if (r.prompt) out.manualPrompt = r.prompt
  return out
}

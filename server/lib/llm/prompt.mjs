/**
 * Mise en forme des prompts et extraction du JSON dans les réponses.
 */

export const JSON_INSTRUCTION = 'Réponds UNIQUEMENT par un JSON valide (objet ou tableau), sans texte avant ni après, sans bloc de code Markdown.'

export class ProviderError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

/** Valide et normalise les messages ; une forme invalide est une erreur de programmation. */
export function normalizeMessages(messages) {
  if (!Array.isArray(messages) || !messages.length) throw new TypeError('complete() : messages doit être un tableau non vide.')
  return messages.map((m, i) => {
    const role = m?.role
    if (!['user', 'assistant', 'system'].includes(role)) throw new TypeError(`complete() : rôle invalide pour le message ${i} (${role}).`)
    if (typeof m.content !== 'string') throw new TypeError(`complete() : le contenu du message ${i} doit être une chaîne.`)
    return { role, content: m.content }
  })
}

/** Regroupe les consignes système (paramètre + messages « system ») et la consigne JSON. */
export function splitSystem({ system, messages, json }) {
  const parts = [system, ...messages.filter((m) => m.role === 'system').map((m) => m.content)]
  if (json) parts.push(JSON_INSTRUCTION)
  return {
    system: parts.filter((s) => s && String(s).trim()).join('\n\n'),
    messages: messages.filter((m) => m.role !== 'system'),
  }
}

/** Prompt texte unique (copier-coller, Copilot CLI). */
export function flattenPrompt({ system, messages }) {
  const out = []
  if (system) out.push(`## Consignes\n\n${system}`)
  if (messages.length === 1 && messages[0].role === 'user') {
    out.push(system ? `## Demande\n\n${messages[0].content}` : messages[0].content)
  } else {
    out.push('## Conversation')
    for (const m of messages) out.push(`### ${m.role === 'user' ? 'Utilisateur' : 'Assistant'}\n\n${m.content}`)
    out.push('Réponds au dernier message de l\'utilisateur.')
  }
  return out.join('\n\n')
}

function tryParse(s) {
  try {
    return { ok: true, value: JSON.parse(s) }
  } catch {
    return { ok: false }
  }
}

/** Plus grand bloc équilibré {…} ou […] à partir de `start`, en tenant compte des chaînes. */
function balancedFrom(text, start) {
  const open = text[start]
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inStr = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (inStr) {
      if (c === '\\') i++
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === open) depth++
    else if (c === close && --depth === 0) return text.slice(start, i + 1)
  }
  return null
}

/**
 * Extraction robuste : réponse brute, bloc ```json```, puis premier objet/tableau équilibré.
 * Renvoie { ok:true, value, text } ou { ok:false }.
 */
export function extractJson(raw) {
  const text = String(raw || '').trim().replace(/^﻿/, '')
  const direct = tryParse(text)
  if (direct.ok) return { ...direct, text }
  for (const m of text.matchAll(/```(?:json|JSON)?\s*\n?([\s\S]*?)```/g)) {
    const inner = m[1].trim()
    const r = tryParse(inner)
    if (r.ok) return { ...r, text: inner }
  }
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{' && text[i] !== '[') continue
    const chunk = balancedFrom(text, i)
    if (!chunk) continue
    const r = tryParse(chunk)
    if (r.ok) return { ...r, text: chunk }
    // Virgules finales tolérées (erreur fréquente des modèles).
    const relaxed = tryParse(chunk.replace(/,\s*([}\]])/g, '$1'))
    if (relaxed.ok) return { ...relaxed, text: JSON.stringify(relaxed.value, null, 2) }
  }
  return { ok: false }
}

/** Retire les codes de couleur ANSI d'une sortie de terminal. */
export function stripAnsi(text) {
  // eslint-disable-next-line no-control-regex
  return String(text || '').replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07]*\x07/g, '')
}

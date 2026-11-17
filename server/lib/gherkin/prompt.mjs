/**
 * Générateur IA : prompt français riche, sortie stricte entre marqueurs, contrôle (analyse + qualité)
 * et une seule relance automatique avec la liste des erreurs.
 *
 *   buildGherkinPrompt(story)             → { system, user }
 *   extractFeature(text)                  → { ok, text, reason }
 *   generateWithLlm(story, { provider, signal, profile })
 *     → { ok: true, text, analysis, provider, model, durationMs, retried }
 *     | { ok: false, manual: true, prompt, reason }   (aucun fournisseur : copier-coller)
 *     | { ok: false, error }
 */
import { complete } from '../llm/index.mjs'
import { getProjectProfile } from '../project-profile.mjs'
import { getScanInfo } from '../jira/stories.mjs'
import { analyzeGherkin } from './parse.mjs'

export const MARK_START = '=== DÉBUT FEATURE ==='
export const MARK_END = '=== FIN FEATURE ==='
const START_RE = /^[ \t]*={3,}[ \t]*D[ÉEé]BUT[ \t]+FEATURE[ \t]*={3,}[ \t]*$/imu
const END_RE = /^[ \t]*={3,}[ \t]*FIN[ \t]+FEATURE[ \t]*={3,}[ \t]*$/imu
const MAX_DESCRIPTION = 6000
const MAX_TOKENS = 6000

export const SYSTEM_PROMPT = [
  'Tu es analyste QA senior dans une équipe agile. Tu rédiges des scénarios de test BDD en Gherkin, en français, à partir d\'un récit JIRA.',
  '',
  'Règles de rédaction :',
  '1. Première ligne : « # language: fr ». Mots-clés français uniquement : Fonctionnalité, Contexte, Règle, Scénario, Plan du scénario, Exemples, Soit / Étant donné, Quand, Alors, Et, Mais.',
  '2. Étiquettes : la clé du récit (ex. @PROJ-12) et celle de l\'épopée sur la ligne au-dessus de « Fonctionnalité: ». Chaque scénario porte @smoke (un ou deux parcours essentiels) ou @regression, plus @cas-erreur pour un cas négatif.',
  '3. Couvre chaque critère d\'acceptation par au moins un scénario, puis ajoute les cas limites et négatifs qui en découlent directement.',
  '4. N\'invente aucune règle métier : si une information manque, écris un commentaire « # Question PO : … » juste au-dessus du scénario concerné.',
  '5. Chaque scénario contient au moins un « Quand » (une seule action principale) et un « Alors » observable et vérifiable.',
  '6. Utilise « Plan du scénario » + « Exemples » quand plusieurs jeux de données suivent le même parcours ; chaque <paramètre> des étapes est une colonne du tableau.',
  '7. Style déclaratif métier : aucun sélecteur CSS, XPath, URL, nom de champ technique ni détail d\'implémentation.',
  '8. Titres de scénarios uniques et explicites ; données de test concrètes et réalistes (montants, dates, profils).',
  '9. Les préconditions communes à tous les scénarios vont dans un « Contexte ».',
  '',
  `Format de réponse : uniquement le contenu du fichier .feature, entre une ligne « ${MARK_START} » et une ligne « ${MARK_END} ». Aucun texte avant ni après, pas de bloc de code Markdown.`,
].join('\n')

function projectContext(profile) {
  const p = profile || safeProfile()
  const scan = getScanInfo()
  const rows = [
    ['Application', p.applicationLabel],
    ['Code produit', p.productCode],
    ['Tribu', p.tribu],
    ['Squad', p.squad],
    ['Projet JIRA', scan?.projectKey],
  ].filter(([, v]) => v)
  return rows.length ? rows.map(([k, v]) => `- ${k} : ${v}`).join('\n') : '- (non renseigné)'
}

function safeProfile() {
  try {
    return getProjectProfile()
  } catch {
    return {}
  }
}

const list = (items) => (items && items.length ? items.join(', ') : '—')

/** Construit les consignes et la demande pour un récit. */
export function buildGherkinPrompt(story, { profile } = {}) {
  const criteria = story.acceptanceCriteria || []
  const description = String(story.descriptionText || '').trim()
  const parts = [
    '## Contexte du projet',
    projectContext(profile),
    '',
    `## Récit ${story.key} — ${story.summary}`,
    `- Type : ${story.issueType || 'Story'} · statut : ${story.status || '—'} · priorité : ${story.priority || '—'}`,
    `- Épopée : ${story.epic ? `${story.epic.key} — ${story.epic.summary}` : 'aucune'}`,
    `- Étiquettes : ${list(story.labels)} · composants : ${list(story.components)} · versions : ${list(story.fixVersions)}`,
    '',
    '### Description',
    description ? (description.length > MAX_DESCRIPTION ? `${description.slice(0, MAX_DESCRIPTION)}\n[…description tronquée]` : description) : '(vide)',
    '',
    `### Critères d'acceptation${story.acceptanceCriteriaSource === 'field' ? ' (champ dédié)' : story.acceptanceCriteriaSource === 'description' ? ' (extraits de la description)' : ''}`,
    criteria.length ? criteria.map((c, i) => `${i + 1}. ${String(c).replace(/\n/g, '\n   ')}`).join('\n') : 'Aucun critère formalisé : déduis les comportements attendus de la description et signale chaque hypothèse par « # Question PO : … ».',
  ]
  if (story.links?.length) {
    parts.push('', '### Récits liés', ...story.links.map((l) => `- ${l.type || 'lien'} ${l.direction === 'inward' ? '←' : '→'} ${l.key} : ${l.summary || ''}`))
  }
  if (story.subtasks?.length) {
    parts.push('', '### Sous-tâches', ...story.subtasks.map((t) => `- ${t.key} : ${t.summary} (${t.status || '—'})`))
  }
  parts.push('', `Rédige la fonctionnalité Gherkin complète du récit ${story.key}, avec les étiquettes @${story.key}${story.epic ? ` et @${story.epic.key}` : ''}.`)
  return { system: SYSTEM_PROMPT, user: parts.join('\n') }
}

/** Extrait le contenu .feature d'une réponse (marqueurs, bloc de code, ou texte brut). */
export function extractFeature(raw) {
  const text = String(raw || '').replace(/\r\n/g, '\n').trim()
  if (!text) return { ok: false, text: '', reason: 'Réponse vide.' }
  // Marqueurs tolérants : accents perdus (« DEBUT »), casse ou espaces modifiés par l'assistant.
  const start = text.match(START_RE)
  if (start) {
    const after = text.slice(start.index + start[0].length)
    const end = after.match(END_RE)
    const inner = stripFence(end ? after.slice(0, end.index) : after).trim()
    if (!inner) return { ok: false, text: '', reason: 'Le bloc entre les marqueurs est vide.' }
    return { ok: true, text: `${inner}\n`, marked: Boolean(end) }
  }
  const fence = text.match(/```(?:gherkin|feature|cucumber)?\s*\n([\s\S]*?)```/i)
  if (fence) return { ok: true, text: fence[1].trim() + '\n', marked: false }
  const lines = text.split('\n')
  const first = lines.findIndex((l) => /^\s*(#\s*language\s*:|@|Fonctionnalité\s*:|Feature\s*:)/i.test(l))
  if (first > -1) {
    const rest = lines.slice(first).join('\n')
    const end = rest.match(END_RE)
    return { ok: true, text: `${(end ? rest.slice(0, end.index) : rest).trim()}\n`, marked: false }
  }
  return { ok: false, text: '', reason: 'Aucune fonctionnalité Gherkin trouvée dans la réponse.' }
}

function stripFence(s) {
  return s.replace(/^\s*```[\w-]*\s*\n/, '').replace(/\n\s*```\s*$/, '')
}

function correctionMessage(extracted, analysis) {
  if (!extracted.ok) {
    return `Ta réponse ne contient pas de fonctionnalité exploitable (${extracted.reason}). Renvoie le fichier .feature complet entre « ${MARK_START} » et « ${MARK_END} ».`
  }
  const errors = analysis.problems.filter((p) => p.severity === 'error').slice(0, 20)
  return [
    'Le fichier proposé contient des erreurs bloquantes :',
    ...errors.map((p) => `- ligne ${p.line} : ${p.message}`),
    '',
    `Corrige-les et renvoie le fichier .feature complet, toujours entre « ${MARK_START} » et « ${MARK_END} ».`,
  ].join('\n')
}

function check(raw, storyKey) {
  const extracted = extractFeature(raw)
  const analysis = extracted.ok ? analyzeGherkin(extracted.text, { storyKey }) : null
  return { extracted, analysis, valid: Boolean(analysis?.valid) }
}

/** Génération par l'assistant IA, avec une relance automatique si la réponse est invalide. */
export async function generateWithLlm(story, { provider, signal, profile } = {}) {
  const { system, user } = buildGherkinPrompt(story, { profile })
  const messages = [{ role: 'user', content: user }]
  const first = await complete({ purpose: 'gherkin', system, messages, maxTokens: MAX_TOKENS, signal, provider })
  if (!first.ok) {
    if (first.manual) return { ok: false, manual: true, prompt: first.prompt, reason: first.reason, aborted: Boolean(first.aborted) }
    return { ok: false, error: first.reason || 'Échec de l\'appel à l\'assistant IA.' }
  }
  let best = { ...check(first.text, story.key), meta: first }
  let retried = false
  if (!best.valid) {
    retried = true
    const second = await complete({
      purpose: 'gherkin',
      system,
      messages: [...messages, { role: 'assistant', content: first.text }, { role: 'user', content: correctionMessage(best.extracted, best.analysis) }],
      maxTokens: MAX_TOKENS,
      signal,
      provider: provider || first.provider,
    })
    if (second.ok) {
      const candidate = { ...check(second.text, story.key), meta: second }
      const errorsOf = (c) => (c.analysis ? c.analysis.counts.error : Infinity)
      if (errorsOf(candidate) <= errorsOf(best)) best = candidate
    }
  }
  if (!best.extracted.ok) return { ok: false, error: `L'assistant IA n'a pas renvoyé de Gherkin exploitable : ${best.extracted.reason}`, retried }
  return {
    ok: true,
    text: best.extracted.text,
    analysis: best.analysis,
    provider: best.meta.provider,
    model: best.meta.model || '',
    durationMs: best.meta.durationMs,
    retried,
  }
}

/** Prompt complet à copier (mode manuel), sans appeler de fournisseur. */
export async function manualPrompt(story, { profile } = {}) {
  const { system, user } = buildGherkinPrompt(story, { profile })
  const r = await complete({ purpose: 'gherkin', system, messages: [{ role: 'user', content: user }], provider: 'manual' })
  return r.prompt
}

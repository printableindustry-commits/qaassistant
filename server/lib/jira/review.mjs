/**
 * Relecture QA d'un récit par règles : signale ce qui empêche d'écrire des tests fiables
 * (critère absent ou vague, description vide, cas d'erreur non décrit, points ouverts…)
 * et formule les questions à poser au PO.
 *
 *   reviewStory(story) → { flags: [{ code, label, severity: 'high'|'medium'|'info', detail }], questions: string[], toClarify }
 */

/** Expression « mot entier » compatible avec les lettres accentuées (\b ne les reconnaît pas). */
function words(source) {
  return new RegExp(`(?<![\\p{L}\\d])(?:${source})(?![\\p{L}\\d])`, 'iu')
}

// Termes non mesurables : chacun appelle une question précise.
const VAGUE_TERMS = [
  { re: words('rapide(?:s|ment)?'), word: 'rapide', measurable: true, ask: 'quel temps de réponse maximal attendez-vous (par exemple 2 s au 95e centile) et pour combien d’utilisateurs simultanés ?' },
  { re: words('performante?s?'), word: 'performant', measurable: true, ask: 'quels seuils mesurables (temps de réponse, volume traité, charge) définissent « performant » ?' },
  { re: words('simple(?:s|ment)?'), word: 'simple', measurable: true, ask: 'qu’entendez-vous par « simple » : nombre d’étapes ou de clics maximal, profils d’utilisateurs concernés ?' },
  { re: words('facile(?:s|ment)?'), word: 'facile', ask: 'comment vérifier que c’est « facile » : parcours cible, nombre d’actions, aide attendue ?' },
  { re: words('intuiti(?:f|ve|fs|ves)'), word: 'intuitif', ask: 'quel critère observable rend l’écran « intuitif » (libellés, ordre des champs, aide contextuelle) ?' },
  { re: words('ergonomiques?|convivial(?:e|es)?|user[- ]friendly'), word: 'ergonomique', ask: 'quelles règles d’ergonomie précises (charte, accessibilité RGAA, maquette de référence) faut-il vérifier ?' },
  { re: words('correctement|comme il faut|de mani[eè]re appropri[ée]e|adapt[ée]e?s?'), word: 'correctement', ask: 'quel est le résultat attendu exact (valeurs, messages, état final) ?' },
  { re: words('si possible|au besoin|si besoin|[ée]ventuellement|le cas [ée]ch[ée]ant'), word: 'si besoin', ask: 'ce comportement est-il obligatoire ou optionnel, et dans quelles conditions précises ?' },
  { re: /(?:^|\s)(?:etc\.?|\.\.\.|…)(?=\s|$)/iu, word: 'etc.', ask: 'pouvez-vous compléter la liste laissée ouverte ?' },
]

const OPEN_POINT_RE = /(?<![\p{L}\d])(?:tbd|todo|à d[ée]finir|à confirmer|à pr[ée]ciser|à valider|en attente de)(?![\p{L}\d])|\?\?/iu
const NEGATIVE_RE = /(?<![\p{L}\d])(?:erreur|refus|rejet|invalide|incorrect|interdit|bloqu|impossible|[ée]chec|[ée]choue|non autoris|inexistant|vide|d[ée]pass|expir|alerte|anomalie|not allowed|error|invalid|denied|fail)/iu
const MEASURE_RE = /\d+\s*(?:ms|s|sec|secondes?|minutes?|clics?|[ée]tapes?|%)(?![\p{L}])/iu
// Exigences de performance, de la plus parlante (seuil chiffré) à la plus générale.
const PERF_PATTERNS = [
  /(?:en moins de|sous|inf[ée]rieur à)\s+\d+(?:[.,]\d+)?\s*(?:ms|s|sec|secondes?|minutes?)(?![\p{L}])/iu,
  /\d+\s*(?:utilisateurs?|users?|connexions?)\s+(?:simultan[ée]s|concurrent(?:e|s)?)/iu,
  /\d+\s*(?:requ[êe]tes?|transactions?)\s+par seconde/iu,
  /temps de r[ée]ponse\s+(?:inf[ée]rieur|maximal|<)/iu,
]
const perfMatch = (text) => PERF_PATTERNS.find((re) => re.test(text)) || null
const EARLY_STATUS_RE = /^(backlog|brouillon|draft|nouveau|new|ouvert|open|à affiner|en affinage)$/i
const DEPENDS_RE = /est bloqu|is blocked|d[ée]pend de|depends on/i

const SEVERITY_ORDER = { high: 0, medium: 1, info: 2 }

/** Phrase qui contient la correspondance (pour citer le récit dans la question). */
function snippet(text, re, size = 110) {
  const m = re.exec(text)
  if (!m) return ''
  const before = text.slice(0, m.index)
  const start = Math.max(before.lastIndexOf('\n'), before.search(/[.!?;]\s[^.!?;]*$/) + 1, 0)
  const rest = text.slice(m.index)
  const endRel = rest.search(/[.!?;\n]/)
  const sentence = text.slice(start, endRel === -1 ? undefined : m.index + endRel).replace(/^[\s.!?;:-]+/, '').trim()
  return sentence.length > size ? `${sentence.slice(0, size - 1)}…` : sentence
}

/** Termes vagues regroupés par phrase : une question par passage cité. */
function vagueFindings(story) {
  const texts = story.acceptanceCriteria.length ? story.acceptanceCriteria : [story.descriptionText || '']
  const byExcerpt = new Map()
  for (const term of VAGUE_TERMS) {
    for (const text of texts) {
      if (!term.re.test(text)) continue
      const excerpt = snippet(text, term.re)
      if (term.measurable && MEASURE_RE.test(excerpt)) continue
      const entry = byExcerpt.get(excerpt) || { excerpt, terms: [] }
      entry.terms.push(term)
      byExcerpt.set(excerpt, entry)
      break
    }
  }
  return [...byExcerpt.values()]
}

function flag(code, label, severity, detail = '') {
  return { code, label, severity, detail }
}

export function reviewStory(story) {
  const flags = []
  const questions = []
  const title = `« ${story.summary} »`
  const ac = story.acceptanceCriteria || []
  const allText = [story.descriptionText || '', ...ac].join('\n')

  if (!ac.length) {
    flags.push(flag('no-criteria', 'Sans critère d’acceptation', 'high'))
    questions.push(`${story.key} — Pouvez-vous formuler les critères d’acceptation de ${title} : cas nominal, cas d’erreur et règles de gestion ?`)
  }
  if ((story.descriptionText || '').trim().length < 40) {
    flags.push(flag('no-description', story.descriptionText ? 'Description très courte' : 'Sans description', 'high'))
    questions.push(`${story.key} — Quel est le besoin métier derrière ${title} : qui l’utilise, dans quel contexte, et quelle valeur est attendue ?`)
  }
  for (const v of vagueFindings(story)) {
    const label = v.terms.map((t) => `« ${t.word} »`).join(', ')
    flags.push(flag('vague', `Critère vague : ${label}`, 'medium', v.excerpt))
    questions.push(`${story.key} — « ${v.excerpt} » : ${v.terms.map((t) => t.ask).join(' Et ')}`)
  }
  if (ac.length && !NEGATIVE_RE.test(ac.join('\n'))) {
    flags.push(flag('no-error-case', 'Aucun cas d’erreur décrit', 'medium'))
    questions.push(`${story.key} — Que doit-il se passer en cas d’erreur ou de donnée invalide pour ${title} (message affiché, état conservé, journalisation) ?`)
  }
  if (OPEN_POINT_RE.test(allText)) {
    const excerpt = snippet(allText, OPEN_POINT_RE)
    flags.push(flag('open-point', 'Points encore ouverts', 'medium', excerpt))
    questions.push(`${story.key} — Point non tranché (« ${excerpt} ») : quelle est la décision, et quand sera-t-elle prise ?`)
  }
  const perf = perfMatch(allText)
  if (perf) {
    const excerpt = snippet(allText, perf)
    flags.push(flag('performance', 'Exigence de performance : prévoir un test de charge', 'info', excerpt))
    questions.push(`${story.key} — Pour l’exigence « ${excerpt} » : sur quel environnement, avec quel volume de données et quel profil de montée en charge faut-il la valider ?`)
  }
  if (!story.epic) flags.push(flag('no-epic', 'Rattaché à aucune épopée', 'info'))
  if (EARLY_STATUS_RE.test(story.status || '')) flags.push(flag('early-status', `Statut « ${story.status} » : contenu susceptible d’évoluer`, 'info'))
  const blockers = (story.links || []).filter((l) => DEPENDS_RE.test(l.type))
  if (blockers.length) flags.push(flag('blocked', `Dépend de ${blockers.map((b) => b.key).join(', ')}`, 'info'))

  flags.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
  return { flags, questions, toClarify: flags.some((f) => f.severity !== 'info') }
}

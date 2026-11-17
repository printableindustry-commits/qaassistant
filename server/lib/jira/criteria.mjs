/**
 * Critères d'acceptation : extraction depuis un champ dédié ou une section de la description,
 * découpage en critères (puces, numéros, blocs Étant donné/Quand/Alors ou Given/When/Then).
 */

const SECTION_RE = /^(crit[eè]res?\s+d['’]\s?acceptation|crit[eè]res?\s+d['’]\s?acceptance|acceptance\s+criteria|crit[eè]res?|r[eè]gles?\s+de\s+gestion|ca|ac)\s*(?:\([^)]*\))?\s*(?::\s*(.*))?$/i

// Titres d'autres sections qui terminent une section de critères.
const OTHER_SECTION_RE = /^(contexte|description|objectifs?|besoin|en tant que|notes?|remarques?|hors\s+p[ée]rim[eè]tre|maquettes?|d[ée]pendances?|donn[ée]es\s+de\s+test|questions?|points?\s+ouverts?|risques?|liens?|annexes?|definition of done|d[ée]finition\s+de\s+fini|out of scope|context|notes)\s*:?\s*$/i

const GIVEN_RE = /^(?:[-*•]\s*|\d+[.)]\s*)?([ée]tant donn[ée]e?s?(?: que| qu['’])?|soit|sachant que|given)(?![\p{L}\d])/iu
const STEP_RE = /^(?:[-*•]\s*|\d+[.)]\s*)?(quand|lorsqu['’]|lorsque|alors|et|mais|when|then|and|but)(?![\p{L}\d])/iu
const SCENARIO_RE = /^(?:[-*•]\s*)?(sc[ée]nario|scenario|plan du sc[ée]nario|scenario outline)\s*\d*\s*:\s*(.*)$/i
const ITEM_RE = /^(\s*)(?:[-*•▪◦]|\d+[.)]|[a-z][.)]|(?:ca|ac|cr|rg)\s*-?\s*\d+\s*[:.)-])\s+(.*)$/i

function cleanHeading(line) {
  return line.replace(/^#+\s*/, '').replace(/^\*+|\*+$/g, '').replace(/^[-–]\s*/, '').trim()
}

function isHeading(line) {
  return /^#{1,6}\s/.test(line)
}

/** Repère la section « critères » dans un texte ; renvoie ses lignes ou null. */
export function findCriteriaSection(text) {
  const lines = String(text || '').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim()
    if (!raw) continue
    const heading = cleanHeading(raw)
    const m = heading.match(SECTION_RE)
    if (!m) continue
    const section = []
    if (m[2] && m[2].trim()) section.push(m[2].trim())
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j]
      const t = line.trim()
      if (isHeading(t) || OTHER_SECTION_RE.test(cleanHeading(t))) break
      section.push(line)
    }
    if (section.some((l) => l.trim())) return section
  }
  return null
}

/** Regroupe les blocs Gherkin : un critère par Scénario / Étant donné. */
function splitGherkin(lines) {
  const out = []
  let current = null
  let title = ''
  const flush = () => { if (current && current.length) out.push(current.join('\n')); current = null }
  for (const raw of lines) {
    const line = raw.trim().replace(/^[-*•]\s+/, '')
    if (!line) continue
    const sc = line.match(SCENARIO_RE)
    if (sc) { flush(); title = sc[2].trim(); current = title ? [`Scénario : ${title}`] : []; continue }
    if (GIVEN_RE.test(line)) {
      if (current && current.some((l) => GIVEN_RE.test(l) || STEP_RE.test(l))) flush()
      if (!current) current = []
      current.push(line)
      continue
    }
    if (!current) current = []
    current.push(line)
  }
  flush()
  return out
}

/** Découpe une liste à puces / numérotée ; les lignes de continuation rejoignent l'élément courant. */
function splitItems(lines) {
  const out = []
  let baseIndent = null
  for (const raw of lines) {
    if (!raw.trim()) continue
    const m = raw.match(ITEM_RE)
    if (m) {
      const indent = m[1].length
      if (baseIndent == null) baseIndent = indent
      if (indent > baseIndent && out.length) out[out.length - 1] += `\n  - ${m[2].trim()}`
      else out.push(m[2].trim())
    } else if (out.length) {
      out[out.length - 1] += ` ${raw.trim()}`
    } else {
      out.push(raw.trim())
    }
  }
  return out
}

/** Découpe un bloc de texte en critères individuels. */
export function splitCriteria(text) {
  const lines = Array.isArray(text) ? text : String(text || '').split('\n')
  const meaningful = lines.filter((l) => l.trim())
  if (!meaningful.length) return []
  const gherkinLines = meaningful.filter((l) => GIVEN_RE.test(l.trim()) || STEP_RE.test(l.trim()) || SCENARIO_RE.test(l.trim()))
  if (gherkinLines.some((l) => GIVEN_RE.test(l.trim()) || SCENARIO_RE.test(l.trim())) && gherkinLines.length >= 2) {
    return splitGherkin(meaningful).map(tidyCriterion).filter(Boolean)
  }
  if (meaningful.some((l) => ITEM_RE.test(l))) return splitItems(meaningful).map(tidyCriterion).filter(Boolean)
  // Texte libre : un critère par paragraphe.
  return String(lines.join('\n')).split(/\n\s*\n/).map((p) => tidyCriterion(p.replace(/\s*\n\s*/g, ' '))).filter(Boolean)
}

function tidyCriterion(text) {
  return String(text || '').replace(/[ \t]+/g, ' ').replace(/^[:\-–\s]+/, '').trim()
}

/** Blocs Gherkin présents dans la description sans titre de section. */
function looseGherkin(text) {
  const lines = String(text || '').split('\n')
  if (!lines.some((l) => GIVEN_RE.test(l.trim())) || !lines.some((l) => /^(?:[-*•]\s*)?(alors|then)(?![\p{L}\d])/iu.test(l.trim()))) return []
  return splitGherkin(lines.filter((l) => GIVEN_RE.test(l.trim()) || STEP_RE.test(l.trim()) || SCENARIO_RE.test(l.trim())))
}

/**
 * Critères d'un récit : champ dédié en priorité, sinon section de la description.
 * Renvoie { criteria: string[], source: 'field'|'description'|'none' }.
 */
export function extractAcceptanceCriteria({ fieldText, descriptionText }) {
  const fromField = splitCriteria(fieldText)
  if (fromField.length) return { criteria: fromField, source: 'field' }
  const section = findCriteriaSection(descriptionText)
  if (section) {
    const criteria = splitCriteria(section)
    if (criteria.length) return { criteria, source: 'description' }
  }
  const loose = looseGherkin(descriptionText).map(tidyCriterion).filter(Boolean)
  if (loose.length) return { criteria: loose, source: 'description' }
  return { criteria: [], source: 'none' }
}

/** Format dominant des critères (pour les statistiques). */
export function criteriaFormat(criteria = []) {
  if (!criteria.length) return 'none'
  if (criteria.some((c) => GIVEN_RE.test(c) || /^Scénario/.test(c))) return 'gherkin'
  return 'list'
}

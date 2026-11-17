/**
 * Analyseur Gherkin (français et anglais) et contrôles qualité.
 *
 *   parseGherkin(text)            → { language, declaredLanguage, feature, comments, errors }
 *   lintGherkin(parsed, { storyKey }) → problèmes de qualité [{ line, severity, code, message }]
 *   analyzeGherkin(text, options) → { valid, language, problems, counts, scenarios, cases, outline }
 *
 * Les mots-clés des deux langues sont reconnus quel que soit l'en-tête « # language: » ;
 * un mélange de langues est simplement signalé.
 */

const KEYWORDS = {
  feature: { fr: ['Fonctionnalité'], en: ['Feature', 'Business Need', 'Ability'] },
  background: { fr: ['Contexte'], en: ['Background'] },
  rule: { fr: ['Règle'], en: ['Rule'] },
  outline: { fr: ['Plan du scénario', 'Plan du Scénario', 'Plan du scenario'], en: ['Scenario Outline', 'Scenario Template'] },
  scenario: { fr: ['Scénario', 'Exemple'], en: ['Scenario', 'Example'] },
  examples: { fr: ['Exemples'], en: ['Examples', 'Scenarios'] },
}

const STEP_KEYWORDS = {
  given: {
    fr: ['Étant donné que', 'Étant donné qu\'', 'Étant données', 'Étant donnée', 'Étant donnés', 'Étant donné',
      'Etant donné que', 'Etant donné qu\'', 'Etant données', 'Etant donnée', 'Etant donnés', 'Etant donné',
      'Sachant que', 'Sachant qu\'', 'Sachant', 'Soit'],
    en: ['Given'],
  },
  when: { fr: ['Quand', 'Lorsque', 'Lorsqu\''], en: ['When'] },
  then: { fr: ['Alors', 'Donc'], en: ['Then'] },
  and: { fr: ['Et que', 'Et qu\'', 'Et'], en: ['And'] },
  but: { fr: ['Mais que', 'Mais qu\'', 'Mais'], en: ['But'] },
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const byLength = (a, b) => b.kw.length - a.kw.length

/** Remplace l'apostrophe typographique pour la reconnaissance des mots-clés. */
const plainQuotes = (s) => s.replace(/[’‘]/g, '\'')

function headerMatchers() {
  const list = []
  for (const [type, langs] of Object.entries(KEYWORDS)) {
    for (const [lang, words] of Object.entries(langs)) for (const kw of words) list.push({ type, lang, kw })
  }
  return list.sort(byLength).map((m) => ({ ...m, re: new RegExp(`^${escapeRe(m.kw)}\\s*:(.*)$`, 'i') }))
}

function stepMatchers() {
  const list = [{ type: 'star', lang: '', kw: '*' }]
  for (const [type, langs] of Object.entries(STEP_KEYWORDS)) {
    for (const [lang, words] of Object.entries(langs)) for (const kw of words) list.push({ type, lang, kw })
  }
  return list.sort(byLength).map((m) => {
    // « qu' » colle au mot suivant ; les autres mots-clés sont suivis d'une espace (ou de la fin de ligne).
    const tail = m.kw.endsWith('\'') ? '' : '(?=\\s|$)'
    return { ...m, re: new RegExp(`^${escapeRe(m.kw)}${tail}`, m.type === 'star' ? '' : 'i') }
  })
}

const HEADERS = headerMatchers()
const STEPS = stepMatchers()

export function matchHeader(trimmed) {
  const line = plainQuotes(trimmed)
  for (const m of HEADERS) {
    const r = line.match(m.re)
    // Mots-clés anglais : casse d'origine ; français : majuscule initiale exigée
    // (évite de prendre « scénario : … » d'une description pour un en-tête).
    const ok = m.lang === 'fr' ? trimmed[0] === trimmed[0].toUpperCase() : line.startsWith(m.kw)
    if (r && ok) return { type: m.type, lang: m.lang, keyword: trimmed.slice(0, m.kw.length), name: r[1].trim() }
  }
  return null
}

export function matchStep(trimmed) {
  const line = plainQuotes(trimmed)
  for (const m of STEPS) {
    const r = line.match(m.re)
    if (!r) continue
    if (m.lang === 'en' && !line.startsWith(m.kw)) continue
    // « Et » / « Soit » en minuscules en début de phrase ne sont pas des mots-clés.
    if (m.lang === 'fr' && trimmed[0] !== trimmed[0].toUpperCase()) continue
    return { keywordType: m.type, lang: m.lang, keyword: trimmed.slice(0, m.kw.length), text: trimmed.slice(m.kw.length).trim() }
  }
  return null
}

/** Cellules d'une ligne de tableau « | a | b | » (gère \| et \\). */
export function parseRow(trimmed) {
  const cells = []
  let cur = ''
  for (let i = 1; i < trimmed.length; i++) {
    const c = trimmed[i]
    if (c === '\\' && i + 1 < trimmed.length) {
      const n = trimmed[i + 1]
      cur += n === 'n' ? '\n' : n
      i++
    } else if (c === '|') {
      cells.push(cur.trim())
      cur = ''
    } else {
      cur += c
    }
  }
  return { cells, closed: trimmed.endsWith('|') && trimmed.length > 1 }
}

function parseTags(trimmed, line, errors) {
  const body = trimmed.replace(/\s#.*$/, '')
  const tags = []
  for (const t of body.split(/\s+/).filter(Boolean)) {
    if (!/^@[^@\s]+$/.test(t)) errors.push({ line, message: `Étiquette invalide « ${t} » : une étiquette commence par @ et ne contient pas d'espace.` })
    else tags.push({ name: t, line })
  }
  return tags
}

// ---------------------------------------------------------------- analyse syntaxique

export function parseGherkin(source) {
  const lines = String(source ?? '').replace(/^﻿/, '').split(/\r?\n/)
  const errors = []
  const comments = []
  const langCount = { fr: 0, en: 0 }
  const s = {
    feature: null,
    rule: null,
    block: null,       // contexte ou scénario courant
    step: null,        // dernière étape (pour tableau / docstring)
    examples: null,    // bloc Exemples courant
    tags: [],
    tagLine: 0,
    declaredLanguage: null,
  }
  const err = (line, message) => errors.push({ line, message })

  const container = () => s.rule || s.feature
  const ensureFeature = (line) => {
    if (s.feature) return s.feature
    err(line, 'La « Fonctionnalité : » doit précéder tout autre élément.')
    s.feature = { type: 'feature', keyword: 'Fonctionnalité', name: '', description: '', tags: [], line, children: [], implicit: true }
    return s.feature
  }
  const takeTags = () => {
    const t = s.tags
    s.tags = []
    return t
  }
  const descTarget = () => {
    if (s.examples) return s.examples.table ? null : s.examples
    if (s.block) return s.block.steps.length ? null : s.block
    if (s.rule) return s.rule.children.length ? null : s.rule
    if (s.feature) return s.feature.children.length ? null : s.feature
    return null
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const line = i + 1
    const t = raw.trim()

    // Docstring : on lit jusqu'au délimiteur fermant.
    if (t.startsWith('"""') || t.startsWith('```')) {
      const delim = t.slice(0, 3)
      const indent = raw.indexOf(delim)
      const contentType = t.slice(3).trim()
      const body = []
      let closed = false
      for (i = i + 1; i < lines.length; i++) {
        if (lines[i].trim() === delim) { closed = true; break }
        body.push(lines[i].slice(Math.min(indent, lines[i].search(/\S|$/))))
      }
      if (!closed) err(line, `Bloc de texte (${delim}) non refermé.`)
      if (s.step && !s.examples && !s.step.dataTable && !s.step.docString) s.step.docString = { contentType, content: body.join('\n'), line }
      else err(line, 'Bloc de texte inattendu : il doit suivre directement une étape.')
      continue
    }

    if (!t) {
      const d = descTarget()
      if (d && d.description) d.description += '\n'
      continue
    }

    if (t.startsWith('#')) {
      const lang = t.match(/^#\s*language\s*:\s*([\w-]+)/i)
      if (lang && !s.feature && !s.declaredLanguage) s.declaredLanguage = lang[1].toLowerCase()
      comments.push({ line, text: t })
      continue
    }

    if (t.startsWith('@')) {
      if (!s.tags.length) s.tagLine = line
      s.tags.push(...parseTags(t, line, errors))
      continue
    }

    if (t.startsWith('|')) {
      const { cells, closed } = parseRow(t)
      if (!closed) err(line, 'Ligne de tableau non refermée par « | ».')
      const row = { cells, line }
      const table = s.examples
        ? (s.examples.table ||= { header: null, rows: [], line })
        : s.step && !s.step.docString ? (s.step.dataTable ||= { rows: [], line }) : null
      if (!table) {
        err(line, 'Tableau inattendu : il doit suivre une étape ou un bloc « Exemples ».')
        continue
      }
      if (s.examples && !table.header) {
        table.header = row
        continue
      }
      const width = (table.header || table.rows[0])?.cells.length
      if (width != null && width !== cells.length) err(line, `Nombre de colonnes incohérent : ${cells.length} au lieu de ${width}.`)
      table.rows.push(row)
      continue
    }

    const header = matchHeader(t)
    if (header) {
      langCount[header.lang] = (langCount[header.lang] || 0) + 1
      handleHeader(header, line)
      continue
    }

    const step = matchStep(t)
    if (step) {
      if (step.lang) langCount[step.lang] = (langCount[step.lang] || 0) + 1
      if (s.tags.length) {
        err(s.tagLine, 'Étiquettes sans élément : elles doivent précéder une Fonctionnalité, une Règle, un Scénario ou des Exemples.')
        s.tags = []
      }
      if (!s.block) err(line, `Étape « ${step.keyword} » hors d'un scénario.`)
      else if (s.examples) err(line, 'Étape après le bloc « Exemples » : les étapes doivent précéder les exemples.')
      else {
        s.step = { ...step, line }
        delete s.step.lang
        s.block.steps.push(s.step)
      }
      continue
    }

    const d = descTarget()
    if (d && !s.tags.length) d.description = d.description ? `${d.description}${d.description.endsWith('\n') ? '' : '\n'}${t}` : t
    else err(line, `Ligne non reconnue : « ${t.length > 60 ? `${t.slice(0, 60)}…` : t} ». Attendu : un mot-clé Gherkin (Soit, Quand, Alors, Et…).`)
  }

  if (s.tags.length) err(s.tagLine, 'Étiquettes en fin de fichier, sans élément associé.')

  function handleHeader(hd, line) {
    const base = { keyword: hd.keyword, name: hd.name, description: '', line }
    if (hd.type === 'feature') {
      if (s.feature && !s.feature.implicit) {
        err(line, 'Une seule « Fonctionnalité » par fichier.')
        return
      }
      s.feature = { type: 'feature', ...base, tags: takeTags(), children: s.feature?.children || [] }
      s.rule = s.block = s.step = s.examples = null
      return
    }
    const feature = ensureFeature(line)
    if (hd.type === 'rule') {
      s.rule = { type: 'rule', ...base, tags: takeTags(), children: [] }
      feature.children.push(s.rule)
      s.block = s.step = s.examples = null
      return
    }
    if (hd.type === 'background') {
      if (s.tags.length) err(s.tagLine, 'Un « Contexte » ne porte pas d\'étiquettes.')
      s.tags = []
      const parent = container()
      if (parent.children.some((c) => c.type !== 'background')) err(line, 'Le « Contexte » doit précéder les scénarios.')
      if (parent.children.some((c) => c.type === 'background')) err(line, 'Un seul « Contexte » par fonctionnalité ou règle.')
      s.block = { type: 'background', ...base, steps: [] }
      parent.children.push(s.block)
      s.step = s.examples = null
      return
    }
    if (hd.type === 'scenario' || hd.type === 'outline') {
      s.block = { type: 'scenario', outline: hd.type === 'outline', ...base, tags: takeTags(), steps: [], examples: [] }
      container().children.push(s.block)
      s.step = s.examples = null
      return
    }
    if (hd.type === 'examples') {
      if (!s.block || s.block.type !== 'scenario') {
        err(line, 'Bloc « Exemples » hors d\'un plan du scénario.')
        s.tags = []
        return
      }
      s.block.outline = true
      s.examples = { ...base, tags: takeTags(), table: null }
      s.block.examples.push(s.examples)
    }
  }

  const detected = langCount.fr >= langCount.en ? (langCount.fr ? 'fr' : null) : 'en'
  return {
    declaredLanguage: s.declaredLanguage,
    language: s.declaredLanguage || detected || 'fr',
    detectedLanguage: detected,
    mixedLanguages: langCount.fr > 0 && langCount.en > 0,
    feature: s.feature,
    comments,
    errors,
  }
}

// ---------------------------------------------------------------- parcours de l'arbre

/** Scénarios (avec leur contexte et leur règle) dans l'ordre du fichier. */
export function eachScenario(feature) {
  const out = []
  if (!feature) return out
  const walk = (children, rule) => {
    for (const c of children) {
      if (c.type === 'rule') walk(c.children, c)
      else if (c.type === 'scenario') out.push({ scenario: c, rule })
    }
  }
  walk(feature.children, null)
  return out
}

function backgrounds(feature) {
  const out = []
  const visit = (children) => children.forEach((c) => {
    if (c.type === 'background') out.push(c)
    if (c.type === 'rule') visit(c.children)
  })
  if (feature) visit(feature.children)
  return out
}

/** Nombre de cas exécutés : un par scénario simple, une ligne d'exemple par cas pour un plan. */
export function countCases(feature) {
  return eachScenario(feature).reduce((n, { scenario }) => {
    if (!scenario.outline) return n + 1
    return n + scenario.examples.reduce((m, ex) => m + (ex.table?.rows.length || 0), 0)
  }, 0)
}

/** Type effectif de chaque étape (Et / Mais héritent du précédent). */
function resolvedTypes(steps) {
  let last = null
  return steps.map((st) => {
    if (['and', 'but', 'star'].includes(st.keywordType)) return last || 'given'
    last = st.keywordType
    return last
  })
}

function placeholdersOf(step) {
  const texts = [step.text]
  if (step.docString) texts.push(step.docString.content)
  if (step.dataTable) step.dataTable.rows.forEach((r) => texts.push(...r.cells))
  const set = new Set()
  for (const tx of texts) for (const m of String(tx).matchAll(/<([^<>\n]+)>/g)) set.add(m[1].trim())
  return set
}

const FILE_EXT = /\.(csv|xlsx?|pdf|json|xml|txt|docx?|zip|png|jpe?g)\b/i
const TECHNICAL = [
  { re: /\bhttps?:\/\/\S+|\bwww\.[a-z0-9-]+\.[a-z]{2,}/i, what: 'une URL' },
  { re: /(^|\s)\/(api|v\d+|rest)\/\S*/i, what: 'un chemin d\'API' },
  { re: /\/\/[a-z*]+\[|\bxpath\b/i, what: 'une expression XPath' },
  { re: /\[(data-[\w-]+|id|class|name|aria-[\w-]+)\s*[=\]]/i, what: 'un sélecteur d\'attribut' },
  { re: /(^|[\s"'«(])#[a-z][\w-]*(?=[\s"'».,)]|$)/i, what: 'un sélecteur CSS (#id)' },
  { re: /(^|[\s"'«(])\.[a-z][\w-]*(?=[\s"'».,)]|$)/i, what: 'un sélecteur CSS (.classe)', skip: FILE_EXT },
  { re: /\b(div|span|button|input|li|ul|td|tr|select)\s*(>|\.[a-z]|#[a-z]|\[)/i, what: 'un sélecteur CSS' },
  { re: /\b(getElementById|querySelector|css selector|localStorage)\b/i, what: 'un détail d\'implémentation' },
]

// Termes non vérifiables dans un résultat attendu.
const VAGUE_RE = /(?<![\p{L}\d])(rapides?|rapidement|simples?|facilement|faciles?|correctement|conviviale?s?|intuiti(?:f|ve|fs|ves)|ergonomiques?|optimale?s?|optimaux|adéquate?s?|appropriée?s?|etc|si possible|quickly|easily|properly|user[- ]friendly)(?![\p{L}\d])/iu

function technicalHint(text) {
  for (const rule of TECHNICAL) {
    const m = String(text).match(rule.re)
    if (m && !(rule.skip && rule.skip.test(m[0]))) return rule.what
  }
  return null
}

// ---------------------------------------------------------------- contrôles qualité

/**
 * Contrôles qualité sur un résultat de parseGherkin.
 * severity : 'error' (bloque la validation), 'warning' (à relire), 'info'.
 */
export function lintGherkin(parsed, { storyKey } = {}) {
  const out = []
  const add = (line, severity, code, message) => out.push({ line, severity, code, message })
  const feature = parsed.feature
  if (!feature) {
    add(1, 'error', 'no-feature', 'Aucune « Fonctionnalité : » : le fichier est vide ou incomplet.')
    return out
  }
  if (!feature.name) add(feature.line, 'warning', 'feature-name', 'La fonctionnalité n\'a pas de titre.')

  const scenarios = eachScenario(feature)
  if (!scenarios.length) add(feature.line, 'error', 'no-scenario', 'Aucun scénario dans la fonctionnalité.')

  for (const bg of backgrounds(feature)) {
    const types = resolvedTypes(bg.steps)
    if (types.some((tp) => tp === 'when' || tp === 'then')) add(bg.line, 'warning', 'background-action', 'Le « Contexte » ne devrait contenir que des préconditions (Soit / Étant donné).')
    bg.steps.forEach((st) => { if (!st.text) add(st.line, 'error', 'empty-step', 'Étape vide.') })
  }

  const names = new Map()
  for (const { scenario: sc } of scenarios) {
    const label = sc.name ? `« ${sc.name} »` : `ligne ${sc.line}`
    if (!sc.name) add(sc.line, 'warning', 'scenario-name', 'Scénario sans titre.')
    else {
      const k = sc.name.toLowerCase().replace(/\s+/g, ' ')
      if (names.has(k)) add(sc.line, 'warning', 'duplicate-name', `Titre de scénario en double (déjà utilisé ligne ${names.get(k)}).`)
      else names.set(k, sc.line)
    }
    if (!sc.steps.length) {
      add(sc.line, 'error', 'empty-scenario', `Le scénario ${label} ne contient aucune étape.`)
      continue
    }
    const types = resolvedTypes(sc.steps)
    if (!types.includes('when')) add(sc.line, 'error', 'missing-when', `Le scénario ${label} n'a pas d'étape « Quand » (action).`)
    if (!types.includes('then')) add(sc.line, 'error', 'missing-then', `Le scénario ${label} n'a pas d'étape « Alors » (résultat attendu).`)
    if (['and', 'but'].includes(sc.steps[0].keywordType)) add(sc.steps[0].line, 'warning', 'leading-and', `« ${sc.steps[0].keyword} » ne peut pas ouvrir un scénario.`)
    const firstThen = types.indexOf('then')
    const lateGiven = types.findIndex((tp, i) => tp === 'given' && i > 0 && types.slice(0, i).includes('when'))
    if (lateGiven > -1) add(sc.steps[lateGiven].line, 'info', 'step-order', 'Précondition après une action : préférez l\'ordre Soit → Quand → Alors.')
    if (firstThen > -1 && types.slice(firstThen).includes('when') && types.filter((tp) => tp === 'when').length > 1) {
      add(sc.line, 'info', 'multiple-actions', `Le scénario ${label} enchaîne plusieurs actions : envisagez de le scinder.`)
    }
    sc.steps.forEach((st, i) => {
      if (!st.text) add(st.line, 'error', 'empty-step', `Étape « ${st.keyword} » sans texte.`)
      const hint = technicalHint(st.text)
      if (hint) add(st.line, 'warning', 'technical-step', `Étape trop technique (${hint}) : décrivez le comportement métier, pas l'implémentation.`)
      const vague = types[i] === 'then' && st.text.match(VAGUE_RE)
      if (vague) add(st.line, 'warning', 'vague-outcome', `Résultat non vérifiable (« ${vague[0]} ») : précisez un critère mesurable (délai, valeur, message).`)
    })
    lintPlaceholders(sc, label, add)
  }

  if (storyKey) {
    const want = `@${storyKey}`.toLowerCase()
    const all = [...feature.tags, ...scenarios.flatMap(({ scenario, rule }) => [...scenario.tags, ...(rule?.tags || [])])]
    if (!all.some((tg) => tg.name.toLowerCase() === want)) add(feature.line, 'warning', 'story-tag', `Étiquette @${storyKey} absente : elle relie les scénarios au récit JIRA.`)
  }
  if (parsed.mixedLanguages) add(1, 'info', 'mixed-language', 'Mots-clés français et anglais mélangés : harmonisez la langue du fichier.')
  if (parsed.declaredLanguage && parsed.detectedLanguage && parsed.declaredLanguage !== parsed.detectedLanguage && !parsed.mixedLanguages) {
    add(1, 'warning', 'language', `L'en-tête annonce « ${parsed.declaredLanguage} » mais les mots-clés sont en « ${parsed.detectedLanguage} ».`)
  }
  return out
}

function lintPlaceholders(sc, label, add) {
  const used = new Set()
  sc.steps.forEach((st) => placeholdersOf(st).forEach((p) => used.add(p)))
  if (!sc.outline) {
    if (used.size) add(sc.line, 'warning', 'placeholder-without-examples', `Le scénario ${label} utilise ${[...used].map((p) => `<${p}>`).join(', ')} sans bloc « Exemples ».`)
    return
  }
  if (!sc.examples.length) {
    add(sc.line, 'error', 'outline-without-examples', `Le plan du scénario ${label} n'a pas de bloc « Exemples ».`)
    return
  }
  for (const ex of sc.examples) {
    if (!ex.table?.header) {
      add(ex.line, 'error', 'empty-examples', 'Bloc « Exemples » sans tableau.')
      continue
    }
    if (!ex.table.rows.length) add(ex.line, 'error', 'empty-examples', 'Bloc « Exemples » sans ligne de données.')
    const cols = new Set(ex.table.header.cells)
    const missing = [...used].filter((p) => !cols.has(p))
    if (missing.length) add(ex.line, 'error', 'missing-placeholder', `Colonne(s) absente(s) des exemples : ${missing.map((p) => `<${p}>`).join(', ')}.`)
    const unused = [...cols].filter((c) => !used.has(c))
    if (unused.length) add(ex.table.header.line, 'warning', 'unused-column', `Colonne(s) jamais utilisée(s) dans les étapes : ${unused.join(', ')}.`)
  }
}

// ---------------------------------------------------------------- synthèse

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 }

/** Analyse complète d'un texte : syntaxe + qualité, prête pour l'API. */
export function analyzeGherkin(text, options = {}) {
  const parsed = parseGherkin(text)
  const problems = [
    ...parsed.errors.map((e) => ({ line: e.line, severity: 'error', code: 'syntax', message: e.message })),
    ...lintGherkin(parsed, options),
  ].sort((a, b) => a.line - b.line || SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
  const counts = { error: 0, warning: 0, info: 0 }
  problems.forEach((p) => { counts[p.severity] += 1 })
  const scenarios = eachScenario(parsed.feature)
  return {
    valid: counts.error === 0,
    language: parsed.language,
    feature: parsed.feature ? { name: parsed.feature.name, line: parsed.feature.line, tags: parsed.feature.tags.map((t) => t.name) } : null,
    problems,
    counts,
    scenarios: scenarios.length,
    cases: countCases(parsed.feature),
    outline: scenarios.map(({ scenario: sc, rule }) => ({
      name: sc.name,
      line: sc.line,
      keyword: sc.keyword,
      outline: sc.outline,
      rule: rule?.name || null,
      tags: sc.tags.map((t) => t.name),
      steps: sc.steps.length,
      examples: sc.examples.reduce((m, ex) => m + (ex.table?.rows.length || 0), 0),
    })),
  }
}

/**
 * Générateur par modèle intégré (sans IA) : transforme les critères d'acceptation d'un récit en
 * fonctionnalité Gherkin française.
 *
 *   generateFromTemplate(story, { applicationLabel }) → { text, warnings, scenarios }
 *
 * - critères déjà rédigés en Gherkin : normalisés (mots-clés français, titres, étiquettes) ;
 * - critères en puces ou en phrases : un scénario par critère, Soit / Quand / Alors déduits par règles ;
 * - aucun critère : squelette à compléter et avertissement.
 */
import { matchHeader, matchStep } from './parse.mjs'

const FR_KEYWORD = { given: 'Étant donné', when: 'Quand', then: 'Alors', and: 'Et', but: 'Mais', star: 'Et' }
const NEGATIVE_RE = /\b(ne (?:peut|peuvent|doit|doivent|sont|est) pas|impossible|refus(?:é|ée|és|ées)?|rejet(?:é|ée|és|ées)|interdit|bloqu[ée]|erreur|invalide|non autoris)/i
// Écran nommé (« … ») ou tableau de bord : sert à déduire l'action « il ouvre … ».
const SCREEN_RE = /\b(?:(l['’]écran|la page|la liste|le formulaire|la fiche|la vue|le menu|l['’]onglet)\s+(« [^»]{1,40} »)|(le tableau de bord))/i
const KNOWN_PROFILES = ['analyste', 'valideur', 'administrateur', 'utilisateur', 'gestionnaire', 'responsable', 'auditeur', 'superviseur', 'contrôleur', 'lecteur', 'invité']
const PROFILES_RE = /\s*pour les profils\s+([^.;:]+?)(?=[.;:]|$)/i

const trimEnd = (s) => String(s || '').trim().replace(/[\s.;:,]+$/, '')
const lowerFirst = (s) => (s && !/^[A-ZÀ-Ý]{2}/.test(s) ? s[0].toLowerCase() + s.slice(1) : s)
const upperFirst = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s)
const stripMarkup = (s) => String(s || '').replace(/[*_]{1,2}([^*_]+)[*_]{1,2}/g, '$1').replace(/\s+/g, ' ').trim()

/** Titre court (70 caractères au plus, coupé sur un mot). */
export function shortTitle(text, max = 70) {
  const t = trimEnd(stripMarkup(text).replace(/^(il|elle)\s+/i, ''))
  if (t.length <= max) return upperFirst(t)
  const cut = t.slice(0, max)
  return `${upperFirst(cut.slice(0, cut.lastIndexOf(' ') > 30 ? cut.lastIndexOf(' ') : max).replace(/[\s,;:]+$/, ''))}…`
}

/** Une ligne de description ne doit pas être prise pour un mot-clé. */
function safeDescription(line) {
  const t = line.trim()
  if (!t) return ''
  if (matchStep(t) || matchHeader(t) || /^[#@|]|^"""|^```/.test(t)) return `– ${t}`
  return t
}

function looksGherkin(criterion) {
  return String(criterion).split('\n').some((l) => {
    const st = matchStep(upperFirst(l.trim().replace(/^[-*•]\s*/, '')))
    return st && ['given', 'when', 'then'].includes(st.keywordType)
  })
}

// ---------------------------------------------------------------- contexte du récit

/** « En tant qu'analyste risques, je veux… » → rôle et phrase du récit. */
function userStory(description) {
  const m = stripMarkup(description).match(/en tant qu(?:e|['’])\s*([^,]+?),\s*je (?:veux|souhaite|dois|peux)[^.]*\.?/i)
  if (!m) return { role: null, sentence: null }
  return { role: trimEnd(m[1]).replace(/^(un|une|le|la|l['’])\s+/i, ''), sentence: trimEnd(m[0]) + '.' }
}

function defaultGiven(ctx) {
  if (ctx.role) return `un utilisateur connecté avec le profil « ${ctx.role} »`
  return `un utilisateur connecté à ${ctx.application}`
}

// ---------------------------------------------------------------- critères Gherkin

/** Normalise un critère déjà rédigé en Gherkin. Renvoie { title, steps, english }. */
function normalizeGherkinCriterion(criterion) {
  let title = ''
  const steps = []
  let english = false
  const lines = String(criterion).split('\n').flatMap((l) => (l.trim().startsWith('|') ? [l]
    // « Étant donné X, quand Y, alors Z » sur une seule ligne.
    : l.replace(/,\s+(quand|lorsque|lorsqu['’]|alors|et|mais|when|then|and|but)\s+/gi, '\n$1 ').split('\n')))
  for (const raw of lines) {
    const t = raw.trim().replace(/^[-*•]\s*/, '')
    if (!t) continue
    const head = t.match(/^(sc[ée]nario|scenario|exemple|example)\s*\d*\s*:\s*(.*)$/i)
    if (head) {
      title = head[2].trim()
      continue
    }
    // Tableau de données rattaché à l'étape précédente.
    if (t.startsWith('|') && steps.length) {
      steps.push({ table: true, text: t.endsWith('|') ? t : `${t} |` })
      continue
    }
    const st = matchStep(upperFirst(t))
    if (st) {
      if (st.lang === 'en') english = true
      const keyword = st.lang === 'fr' ? upperFirst(st.keyword) : FR_KEYWORD[st.keywordType]
      const type = st.keywordType
      steps.push({ keyword, type, text: trimEnd(st.text) })
    } else if (steps.length) {
      steps.push({ keyword: 'Et', type: 'and', text: trimEnd(t) })
    }
  }
  return { title, steps, english }
}

function effectiveTypes(steps) {
  let last = 'given'
  return steps.map((s) => (s.table || ['and', 'but', 'star'].includes(s.type) ? last : (last = s.type)))
}

// ---------------------------------------------------------------- critères en texte libre

function whenFromCondition(word, cond) {
  const w = word.toLowerCase()
  if (w === 'après') {
    const d = cond.match(/^(\d+)\s+(secondes?|minutes?|heures?|jours?)(.*)$/i)
    return d ? `${d[1]} ${d[2]} s'écoulent${d[3]}` : `l'étape « ${cond} » est terminée`
  }
  if (w.startsWith('en cas')) return `survient le cas suivant : ${cond}`
  return cond
}

/** Déduit Soit / Quand / Alors d'un critère rédigé en phrase. */
function deriveScenario(criterion, ctx) {
  const [head, ...subs] = String(criterion).split('\n')
  const extra = subs.map((s) => trimEnd(s.replace(/^\s*-\s*/, ''))).filter(Boolean)
  let text = trimEnd(stripMarkup(head))
  let given = defaultGiven(ctx)
  let when = null
  let then = null
  let profiles = null

  const prof = text.match(PROFILES_RE)
  if (prof) {
    const list = prof[1].split(/\s*,\s*|\s+et\s+|\s+ou\s+/).map((p) => p.trim()).filter(Boolean)
    if (list.length > 1) {
      profiles = list
      text = trimEnd(text.replace(PROFILES_RE, ''))
      given = 'un utilisateur connecté avec le profil « <profil> »'
    }
  }

  const cond = text.match(/^(si|lorsque|lorsqu['’]|quand|dès que|en cas d['’]|en cas de|après)\s*(.+?),\s*(?:alors\s+)?(.+)$/i)
  const actor = text.match(/^(?:[Uu]ne?|[Ll]e|[Ll]a|[Ll]['’])\s*([A-ZÀ-Ý][\p{L}-]+)\s+(.+?)(?:\s*;\s*(.+))?$/u)
  if (cond) {
    when = whenFromCondition(cond[1].replace(/['’]$/, ''), cond[2].trim())
    then = cond[3]
  } else if (actor && actor[3]) {
    given = `un utilisateur connecté avec le profil « ${actor[1]} »`
    when = `il ${actor[2]}`
    then = actor[3]
  } else if (actor && ctx.profiles.has(actor[1].toLowerCase())) {
    given = `un utilisateur connecté avec le profil « ${actor[1]} »`
    when = `il utilise la fonctionnalité « ${ctx.summary} »`
    then = `il ${actor[2]}`
  } else {
    const screen = text.match(SCREEN_RE)
    when = screen ? `il ouvre ${screen[3] ? 'le tableau de bord' : `${screen[1].toLowerCase()} ${screen[2]}`}` : `il utilise la fonctionnalité « ${ctx.summary} »`
    then = text
  }
  return {
    title: shortTitle(text),
    negative: NEGATIVE_RE.test(text),
    outline: profiles ? { column: 'profil', values: profiles } : null,
    steps: [
      { keyword: 'Soit', type: 'given', text: given },
      { keyword: 'Quand', type: 'when', text: lowerFirst(trimEnd(when)) },
      { keyword: 'Alors', type: 'then', text: lowerFirst(trimEnd(then)) },
      ...extra.map((e) => ({ keyword: 'Et', type: 'and', text: lowerFirst(e) })),
    ],
  }
}

// ---------------------------------------------------------------- assemblage

function uniqueTitle(title, used) {
  let t = title || 'Scénario sans titre'
  let n = 2
  while (used.has(t.toLowerCase())) t = `${title} (${n++})`
  used.add(t.toLowerCase())
  return t
}

function renderScenario(sc, tags) {
  const out = [`  ${tags.join(' ')}`, `  ${sc.outline ? 'Plan du scénario' : 'Scénario'}: ${sc.title}`]
  if (sc.comment) out.push(`    # ${sc.comment}`)
  for (const st of sc.steps) out.push(st.table ? `      ${st.text}` : `    ${st.keyword} ${st.text}`.replace(/\s+$/, ''))
  if (sc.outline) {
    const width = Math.max(sc.outline.column.length, ...sc.outline.values.map((v) => v.length))
    out.push('', '    Exemples:', `      | ${sc.outline.column.padEnd(width)} |`)
    sc.outline.values.forEach((v) => out.push(`      | ${v.replace(/\|/g, '\\|').padEnd(width)} |`))
  }
  return out.join('\n')
}

/** Complète un scénario normalisé auquel il manque l'action ou le résultat. */
function completeSteps(sc, ctx, warnings, index) {
  const types = effectiveTypes(sc.steps)
  const missing = []
  if (!types.includes('when')) {
    const at = types.indexOf('then')
    sc.steps.splice(at < 0 ? sc.steps.length : at, 0, { keyword: 'Quand', type: 'when', text: `il utilise la fonctionnalité « ${ctx.summary} »` })
    missing.push('l\'action (Quand)')
  }
  if (!effectiveTypes(sc.steps).includes('then')) {
    sc.steps.push({ keyword: 'Alors', type: 'then', text: 'le résultat attendu est conforme au critère d\'acceptation' })
    missing.push('le résultat attendu (Alors)')
  }
  if (missing.length) {
    sc.comment = `À préciser : ${missing.join(' et ')} absent(s) du critère d'origine.`
    warnings.push(`Critère ${index + 1} : ${missing.join(' et ')} ajouté(s) par défaut, à préciser.`)
  }
}

export function generateFromTemplate(story, { applicationLabel } = {}) {
  const warnings = []
  const { role, sentence } = userStory(story.descriptionText)
  const ctx = {
    role,
    // Profils reconnus comme sujet d'un critère (« Un Valideur peut… »).
    profiles: new Set(KNOWN_PROFILES),
    // Une seule ligne : un titre JIRA multiligne casserait la « Fonctionnalité : ».
    summary: trimEnd(String(story.summary || '').replace(/\s+/g, ' ')) || story.key,
    application: applicationLabel ? `l'application ${applicationLabel}` : 'l\'application',
  }
  const criteria = (story.acceptanceCriteria || []).map((c) => String(c || '').trim()).filter(Boolean)
  const scenarios = []

  criteria.forEach((criterion, i) => {
    if (looksGherkin(criterion)) {
      const n = normalizeGherkinCriterion(criterion)
      if (n.english) warnings.push(`Critère ${i + 1} rédigé en anglais : mots-clés traduits, texte conservé (à traduire si besoin).`)
      const thenStep = n.steps.find((s) => s.type === 'then')
      const sc = { title: upperFirst(n.title) || shortTitle(thenStep?.text || n.steps[0]?.text || ctx.summary), steps: n.steps, negative: NEGATIVE_RE.test(criterion) }
      if (!sc.steps.some((s) => s.type === 'given')) sc.steps.unshift({ keyword: 'Soit', type: 'given', text: defaultGiven(ctx) })
      completeSteps(sc, ctx, warnings, i)
      scenarios.push(sc)
    } else {
      scenarios.push(deriveScenario(criterion, ctx))
    }
  })

  if (!criteria.length) {
    warnings.push('Aucun critère d\'acceptation dans le récit : squelette à compléter avec le PO avant validation.')
    scenarios.push({
      title: `${ctx.summary} — cas nominal`,
      comment: 'À compléter : aucun critère d\'acceptation dans JIRA.',
      steps: [
        { keyword: 'Soit', text: defaultGiven(ctx) },
        { keyword: 'Quand', text: `il utilise la fonctionnalité « ${ctx.summary} »` },
        { keyword: 'Alors', text: 'le résultat attendu, à préciser avec le PO, est obtenu' },
      ],
    }, {
      title: `${ctx.summary} — cas d'erreur`,
      negative: true,
      comment: 'À compléter : règle de gestion à confirmer avec le PO.',
      steps: [
        { keyword: 'Soit', text: defaultGiven(ctx) },
        { keyword: 'Quand', text: 'il saisit une donnée invalide' },
        { keyword: 'Alors', text: 'un message d\'erreur explicite est affiché' },
      ],
    })
  }

  const used = new Set()
  const highPriority = /critique|bloquant|haute|highest|high|critical/i.test(story.priority || '')
  const body = scenarios.map((sc, i) => {
    sc.title = uniqueTitle(sc.title, used)
    // Premier scénario = parcours de fumée ; les autres alimentent la non-régression.
    const tags = [i === 0 ? '@smoke' : '@regression']
    if (sc.negative) tags.push('@cas-erreur')
    if (highPriority && i === 0) tags.push('@critique')
    return renderScenario(sc, tags)
  })

  const featureTags = [`@${story.key}`]
  if (story.epic?.key) featureTags.push(`@${story.epic.key}`)
  const description = [sentence ? safeDescription(sentence) : null, `Récit JIRA : ${story.key}${story.url ? ` (${story.url})` : ''}`].filter(Boolean)

  const text = [
    '# language: fr',
    `# Généré par le modèle intégré de Wizard QA à partir de ${criteria.length} critère(s) d'acceptation : à relire avant validation.`,
    featureTags.join(' '),
    `Fonctionnalité: ${ctx.summary}`,
    ...description.map((l) => `  ${l}`),
    '',
    body.join('\n\n'),
    '',
  ].join('\n')

  return { text, warnings, scenarios: scenarios.length }
}

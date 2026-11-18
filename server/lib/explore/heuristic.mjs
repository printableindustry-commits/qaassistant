/**
 * Explorateur heuristique (docs/V3-ARCHITECTURE.md §5.2) : réalise une étape du plan SANS assistant IA.
 *
 * À partir de l'objectif de l'étape (texte Gherkin ou plan) et de l'instantané de la page :
 *  - découpe l'étape en intention (cliquer, saisir, choisir, cocher, vérifier, naviguer, état) et en mots-clés
 *    (sans mots vides FR/EN, accents normalisés, quelques équivalences anglais → français) ;
 *  - note chaque élément (mots-clés retrouvés dans nom / libellé / placeholder / texte, rôle compatible,
 *    visibilité, unicité du sélecteur) ;
 *  - essaie les meilleurs candidats un par un en exécutant l'action réelle, puis juge le progrès
 *    (changement d'adresse, nouveau message, champ rempli, page atteinte qui correspond à l'objectif…).
 *
 * Aucun secret en clair : un champ d'identifiant ou de mot de passe reçoit un marqueur {{account:…}}.
 * Module sans dépendance : les accès au navigateur passent par l'objet `b` (engine.mjs) fourni par agent.mjs.
 */
import { bestCandidate } from './selectors.mjs'

// ---------- Texte ----------
export function norm(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’‘`]/g, '\'').toLowerCase()
}

const STOP = new Set((
  // français
  'le la les l un une des du de d au aux a à et ou en dans sur sous par pour avec sans ce cet cette ces son sa ses '
  + 'leur leurs mon ma mes ton ta tes notre nos votre vos il elle ils elles on je tu nous vous qui que quoi dont ou '
  + 'est sont etre ete fait faire peut peuvent doit doivent bien plus moins tres tout tous toute toutes '
  + 'puis alors quand lorsque lorsqu soit etant donne donnee donnees et mais si ne pas n y se s qu c j m t aucun aucune '
  + 'utilisateur utilisatrice analyste valideur gestionnaire administrateur agent testeur client usager '
  + 'connecte connectee page ecran bouton lien champ zone affiche affichee affiches affichees apparait '
  + 'clique cliquer clic appuie appuyer saisit saisir saisie renseigne renseigner tape taper entre entrer remplit remplir '
  + 'choisit choisir selectionne selectionner coche cocher decoche decocher ouvre ouvrir accede acceder va aller '
  + 'navigue naviguer consulte consulter voit voir visible visibles verifie verifier presente contient contenir '
  + 'nouveau nouvelle seul seule seulement aussi deja encore ensuite apres avant celui celle '
  + 'utilise utiliser fonctionnalite fonction fois deux trois '
  // anglais
  + 'the an of to in on at by for with without from into and or not no is are be been being was were it its '
  + 'he she they them his her their this that these those there then when given user analyst admin tester '
  + 'clicks click opens open goes go visits visit navigates navigate sees see views view displayed display shown '
  + 'shows show enters enter types type fills fill selects select chooses choose checks check page screen button '
  + 'link field has have can should must will directly uses use feature times one two three'
).split(/\s+/).filter(Boolean))

// équivalences anglais → français (les récits peuvent être en anglais, l'application en français)
const SYN = {
  risk: 'risque', risks: 'risque', dashboard: 'tableau', board: 'tableau', history: 'historique', rating: 'cotation',
  ratings: 'cotation', rated: 'cotation', author: 'auteur', comment: 'commentaire', comments: 'commentaire',
  access: 'acces', denied: 'refuse', error: 'erreur', list: 'liste', lists: 'liste', export: 'exporter',
  save: 'enregistrer', saved: 'enregistre', search: 'rechercher', filter: 'filtre', filters: 'filtre', level: 'niveau',
  levels: 'niveau', new: 'nouveau', declare: 'declarer', create: 'declarer', login: 'connexion', logout: 'deconnecter',
  sign: 'connecter', password: 'passe', username: 'identifiant', entity: 'entite', amount: 'montant', description: 'description',
  notifications: 'notifications', help: 'aide', profile: 'profil', confirm: 'confirmer', cancel: 'annuler', validate: 'valider',
  detail: 'detail', details: 'detail', message: 'message', success: 'succes', owner: 'porteur', label: 'libelle',
  title: 'libelle', name: 'libelle', report: 'synthese', summary: 'synthese', critical: 'critique', high: 'eleve',
  medium: 'modere', low: 'faible', date: 'date', period: 'periode', reference: 'reference',
}

export function tokens(s) {
  return norm(s).split(/[^a-z0-9]+/).filter(Boolean)
}

function stem(t) {
  let w = SYN[t] || t
  if (w.length > 4 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1)
  if (w.length > 5 && w.endsWith('e')) w = w.slice(0, -1)
  return w
}

/** Deux mots se correspondent : égaux, ou même début (5 lettres) pour les mots longs (détail / details, historique / history). */
function same(a, b) {
  if (a === b) return true
  if (/^\d+$/.test(a) || /^\d+$/.test(b)) return false
  const n = Math.min(a.length, b.length)
  return n >= 5 && a.slice(0, 5) === b.slice(0, 5)
}

export function keywords(s) {
  const out = []
  for (const t of tokens(s)) {
    if (STOP.has(t)) continue
    if (t.length < 3 && !/^\d+$/.test(t)) continue
    const w = stem(t)
    if (!out.includes(w)) out.push(w)
  }
  return out
}

function stems(s) {
  return tokens(s).map(stem)
}

function matchCount(kws, words) {
  let n = 0
  for (const k of kws) if (words.some((w) => same(k, w))) n++
  return n
}

// ---------- Intention ----------
const VERBS = [
  ['verify', /\b(s'affiche|est affiche|sont affiche|affiche|voit|voir|visible|apparait|apparaissent|contient|indique|liste|presente|recoit|displayed|shows|sees|lists|contains|appears|visible|is shown)/],
  ['check', /\b(coche|cocher|cochee|active la case|check the|checks the|ticks)\b/],
  ['fill', /\b(saisit|saisir|saisi|renseigne|renseigner|tape|taper|entre (le|la|un|une|l)|remplit|remplir|indique (le|la|un|une)|types|enters|fills|inputs|writes)\b/],
  ['select', /\b(choisit|choisir|selectionne|selectionner|filtre sur|selects|chooses|picks)\b/],
  ['navigate', /\b(ouvre|ouvrir|accede|acceder|va sur|va dans|va a|se rend|navigue|consulte|affiche la page|revient|opens|open|goes to|go to|navigates|visits|accesses|returns to)\b/],
  ['click', /\b(clique|cliquer|clic|appuie|appuyer|valide|valider|enregistre|enregistrer|soumet|soumettre|confirme|confirmer|exporte|exporter|declare|declarer|supprime|supprimer|annule|annuler|utilise|deconnecte|clicks|click|presses|press|submits|submit|saves|save|confirms|exports|deletes|cancels|uses)\b/],
]

/**
 * Analyse d'une étape : { intent, keywords, quoted, numbers, negative }.
 * intent : 'verify' | 'check' | 'fill' | 'select' | 'navigate' | 'click' | 'state' (précondition sans verbe d'action)
 */
export function parseStep({ kind, goal, gherkin }) {
  const raw = String(goal || gherkin || '')
  const n = norm(raw)
  const quoted = []
  for (const m of raw.matchAll(/«\s*([^»]+?)\s*»|"([^"]+)"|“([^”]+)”/g)) quoted.push((m[1] || m[2] || m[3]).trim())
  const unquoted = raw.replace(/«[^»]*»|"[^"]*"|“[^”]*”/g, ' ')
  const numbers = (unquoted.match(/\d+(?:[.,]\d+)?/g) || []).filter((x) => x.length < 12)
  let intent = null
  if (kind === 'check') intent = 'verify'
  else {
    for (const [name, re] of VERBS) {
      if (name === 'verify') continue
      if (re.test(n)) { intent = name; break }
    }
    // précondition (« Étant donné … ») : on ne la réalise que si un élément y correspond nettement
    if (/^(etant donne|given|soit)\b/.test(norm(gherkin || ''))) intent = 'state'
    if (!intent) intent = /\b(il|elle|l'analyste|l'utilisateur|he|she|they)\b/.test(n) ? 'click' : 'state'
  }
  const negative = /(\bne |\bn'|\bpas\b|\baucune?\b|\bsans\b|\bjamais\b|\bnot\b|\bno\b|\bwithout\b|\bnever\b|\bcannot\b|\bcan't\b)/.test(n)
  const kws = keywords(unquoted)
  const quotedKws = quoted.flatMap((q) => keywords(q))
  return { intent, keywords: [...new Set([...kws, ...quotedKws])], quoted, numbers, negative, text: raw }
}

// ---------- Notation ----------
const ROLES = {
  click: ['button', 'link', 'menuitem', 'tab', 'option', 'checkbox', 'radio', 'switch', 'treeitem'],
  navigate: ['link', 'tab', 'menuitem', 'button'],
  state: ['link', 'tab', 'menuitem', 'button'],
  fill: ['textbox', 'searchbox', 'spinbutton', 'combobox'],
  select: ['combobox', 'listbox', 'radio', 'option', 'tab', 'button'],
  check: ['checkbox', 'switch', 'radio'],
}

function elementText(el) {
  return [el.name, el.label, el.placeholder, el.text, el.testid ? String(el.testid).replace(/[-_]+/g, ' ') : ''].filter(Boolean).join(' ')
}

function isFillable(el) {
  if (el.tag === 'textarea') return true
  if (el.tag !== 'input') return el.role === 'textbox' || el.role === 'searchbox'
  return !['checkbox', 'radio', 'submit', 'button', 'reset', 'file', 'hidden', 'image', 'range', 'color'].includes(el.type || 'text')
}

function roleFits(intent, el) {
  if (intent === 'fill') return isFillable(el)
  if (intent === 'select') return el.tag === 'select' || ROLES.select.includes(el.role)
  if (intent === 'check') return ROLES.check.includes(el.role) || (el.tag === 'input' && ['checkbox', 'radio'].includes(el.type))
  return (ROLES[intent] || ROLES.click).includes(el.role) && !isFillable(el)
}

/** Note un élément pour une étape analysée ; renvoie null s'il n'est pas un candidat. */
export function scoreElement(p, el, here = []) {
  if (!el || el.kind === 'content' || el.enabled === false) return null
  if (!roleFits(p.intent, el)) return null
  const words = stems(elementText(el))
  if (!words.length && p.intent !== 'fill') return null
  const name = norm(el.name || el.text || el.label || el.placeholder || '').trim()
  let score = 0
  const hit = matchCount(p.keywords, words)
  // un mot-clé déjà porté par le titre de la page courante compte peu : on cherche ce qui manque encore
  const fresh = matchCount(p.keywords.filter((k) => !here.some((w) => same(k, w))), words)
  score += fresh * 3 + (hit - fresh)
  for (const q of p.quoted) {
    const nq = norm(q).trim()
    if (nq && name === nq) score += 12
    else if (nq && name.includes(nq)) score += 6
    else if (nq && p.intent === 'select' && (el.options || []).some((o) => norm(o).trim() === nq)) score += 8
  }
  // éléments concis : « Risques » plutôt que « Déclarer un risque » pour « les risques »
  if (hit && words.length) score += Math.min(1.5, hit / words.length)
  if (p.intent === 'navigate' && el.role === 'link') score += 1
  if (p.intent === 'click' && el.role === 'button') score += 0.5
  if (el.inViewport) score += 0.3
  const best = bestCandidate(el.candidates || [])
  if (best && best.unique) score += 0.5
  else score -= 1.5
  return { el, score, hit }
}

/** Candidats classés (meilleur d'abord) ; seuil minimal pour éviter les clics au hasard. */
export function rankElements(p, elements, here = []) {
  const out = []
  for (const el of elements || []) {
    const s = scoreElement(p, el, here)
    if (!s) continue
    const quotedHit = p.quoted.length && s.score >= 6
    const strong = p.intent === 'state' ? s.hit >= 2 || quotedHit : s.hit >= 1 || quotedHit
    if (!strong) continue
    out.push(s)
  }
  out.sort((a, b) => b.score - a.score)
  return out
}

// ---------- Valeurs de test ----------
function today(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const USER_RE = /identifiant|utilisateur|login|e-?mail|courriel|username|user/
const PWD_RE = /mot de passe|password|mdp/

/** Valeur à saisir : valeur citée, nombre cité, marqueur de compte ou valeur plausible selon le type du champ. */
export function fillValue(p, el, account) {
  const desc = norm(elementText(el))
  if (el.type === 'password' || PWD_RE.test(desc)) return account ? { secret: `account:${account}:password` } : null
  if (USER_RE.test(desc) && el.type !== 'search' && account && !p.quoted.length) return { value: `{{account:${account}:username}}` }
  if (p.quoted.length) return { value: p.quoted[0] }
  if (el.type === 'date') return { value: today(-1) }
  if (el.type === 'datetime-local') return { value: `${today(-1)}T10:00` }
  if (el.type === 'time') return { value: '10:00' }
  if (el.type === 'number' || /montant|nombre|quantite|prix|taux|amount|number|exposition|\(€\)|eur/.test(desc)) return { value: p.numbers[0] || '1000' }
  if (p.numbers.length) return { value: p.numbers[0] }
  if (el.type === 'email' || /e-?mail|courriel/.test(desc)) return { value: 'test.wizardqa@example.org' }
  if (el.type === 'tel' || /telephone|phone/.test(desc)) return { value: '0102030405' }
  if (el.type === 'url') return { value: 'https://example.org' }
  if (el.type === 'search' || el.role === 'searchbox') return { value: p.keywords.filter((k) => !words(desc).includes(k))[0] || 'test' }
  return { value: 'Test Wizard QA automatisé' }
}

function words(s) { return stems(s) }

function pickOption(p, el) {
  const opts = (el.options || []).filter(Boolean)
  for (const q of p.quoted) {
    const nq = norm(q).trim()
    const o = opts.find((x) => norm(x).trim() === nq) || opts.find((x) => norm(x).includes(nq))
    if (o) return o
  }
  let best = null
  let bestHit = 0
  for (const o of opts) {
    const h = matchCount(p.keywords, stems(o))
    if (h > bestHit) { best = o; bestHit = h }
  }
  return best
}

// ---------- Jugement ----------
function pageWords(s) {
  return stems([s.title, s.text].join(' '))
}

function headingWords(s) {
  const hs = (s.elements || []).filter((e) => e.role === 'heading' || /^h[1-3]$/.test(e.tag || '')).map((e) => e.name || e.text)
  return stems([s.title, ...hs].join(' '))
}

function messages(s) {
  return (s.elements || []).filter((e) => ['alert', 'status', 'dialog', 'alertdialog'].includes(e.role) && (e.name || e.text)).map((e) => norm(e.name || e.text).trim())
}

function coverage(kws, ws) {
  if (!kws.length) return 0
  return matchCount(kws, ws) / kws.length
}

/** Lignes de texte de la page qui correspondent le mieux aux mots-clés (pour une vérification). */
export function bestLines(p, text, max = 2) {
  const lines = (Array.isArray(text) ? text : String(text || '').split(/\n+/)).map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l.length >= 3 && l.length <= 120)
  const scored = []
  const seen = new Set()
  for (const l of lines) {
    if (seen.has(l)) continue
    seen.add(l)
    const h = matchCount(p.keywords, stems(l))
    if (h) scored.push({ line: l, hit: h, density: h / Math.max(1, stems(l).length) })
  }
  scored.sort((a, b) => b.hit - a.hit || b.density - a.density || a.line.length - b.line.length)
  return scored.slice(0, max)
}

// ---------- Boucle ----------
/**
 * Réalise l'étape. ctx = {
 *   b, step, account, maxIterations, signal,
 *   snap: () => instantané, selectorOf: (el) => sélecteur,
 *   onTry: ({ iteration, maxIterations, what, el, ref, text }) => Promise (journal, événement, annotation),
 *   onResult: ({ iteration, ok, what, detail }) }
 * → { ok: true, steps } | { ok: false, reason, attempts, steps }
 */
export async function runHeuristic(ctx) {
  const { b, step } = ctx
  const maxIt = ctx.maxIterations || 4
  const p = parseStep(step)
  const gherkin = step.gherkin || step.goal
  const base = { gherkin, source: 'heuristic', note: null }
  const attempts = []
  const built = []
  if (!p.keywords.length && !p.quoted.length) {
    return { ok: false, reason: 'L\'heuristique ne trouve aucun mot-clé exploitable dans l\'étape.', attempts, steps: built, parsed: p }
  }
  if (p.intent === 'verify') return verify(ctx, p, base, maxIt)
  if (p.intent === 'state' && p.negative) {
    return { ok: false, reason: 'Précondition de données (absence, refus) : l\'heuristique ne peut pas la créer dans l\'application.', attempts, steps: built, parsed: p }
  }
  const tried = new Set()
  let iteration = 0
  while (iteration < maxIt) {
    if (ctx.signal?.aborted) return { ok: false, aborted: true, reason: 'Exploration arrêtée.', attempts, steps: built, parsed: p }
    const s = await ctx.snap()
    if (!s || s.ok === false) return { ok: false, reason: s?.error || 'Instantané impossible.', attempts, steps: built, parsed: p }
    const here = ['navigate', 'state'].includes(p.intent) ? headingWords(s) : []
    const ranked = rankElements(p, s.elements, here).filter((c) => !tried.has(keyOf(c.el)))
    if (!ranked.length) {
      if (!attempts.length) attempts.push(`Aucun élément de la page ne correspond à « ${p.keywords.slice(0, 6).join(', ')} » (${intentLabel(p.intent)}).`)
      break
    }
    const c = ranked[0]
    tried.add(keyOf(c.el))
    iteration++
    const r = await tryElement(ctx, p, s, c.el, { iteration, maxIt, base })
    attempts.push(r.what + (r.ok ? (r.done ? ' : objectif atteint' : ' : progrès') : ` : ${r.error || 'sans effet'}`))
    if (r.ok) {
      built.push(...r.steps)
      if (r.done) return { ok: true, steps: built, attempts, parsed: p }
    }
  }
  const reason = attempts.length
    ? `L'heuristique n'a pas réalisé l'étape après ${iteration} essai(s) (${intentLabel(p.intent)} ; mots-clés : ${p.keywords.slice(0, 6).join(', ')}).`
    : 'L\'heuristique n\'a trouvé aucun élément correspondant.'
  return { ok: false, reason, attempts, steps: built, parsed: p }
}

function keyOf(el) {
  const best = bestCandidate(el.candidates || [])
  return best ? best.code : `${el.role}|${el.name}|${el.ref}`
}

export function intentLabel(intent) {
  return { click: 'clic', navigate: 'navigation', fill: 'saisie', select: 'choix', check: 'case à cocher', verify: 'vérification', state: 'précondition' }[intent] || intent
}

function describeEl(el) {
  const role = { button: 'bouton', link: 'lien', textbox: 'champ', searchbox: 'recherche', combobox: 'liste', checkbox: 'case', radio: 'option', tab: 'onglet', menuitem: 'menu' }[el.role] || el.role || el.tag
  return `${role} « ${String(el.name || el.label || el.placeholder || el.text || el.ref).slice(0, 60)} »`
}

async function tryElement(ctx, p, s, el, { iteration, maxIt, base }) {
  const { b } = ctx
  const selector = ctx.selectorOf(el)
  const label = el.name || el.label || el.placeholder || el.text || ''
  let action = 'click'
  let args = { action: 'click', ref: el.ref }
  let value = null
  let secret = null
  if (p.intent === 'fill' || (isFillable(el) && p.intent !== 'select')) {
    const v = fillValue(p, el, ctx.account)
    if (!v) return { ok: false, what: `saisie dans ${describeEl(el)}`, error: 'aucune valeur sûre à saisir' }
    action = 'fill'
    value = v.value ?? null
    secret = v.secret || null
    args = { action, ref: el.ref, ...(secret ? { secret } : { value }) }
  } else if (el.tag === 'select') {
    const opt = pickOption(p, el)
    if (!opt) return { ok: false, what: `choix dans ${describeEl(el)}`, error: 'aucune option ne correspond' }
    action = 'select'
    value = opt
    args = { action, ref: el.ref, value }
  } else if (p.intent === 'check' && (el.role === 'checkbox' || el.type === 'checkbox')) {
    action = p.negative ? 'uncheck' : 'check'
    args = { action, ref: el.ref }
  }
  const shown = action === 'fill' ? (secret ? ' (mot de passe masqué)' : value && !String(value).includes('{{') ? ` « ${String(value).slice(0, 40)} »` : ' (identifiant)') : action === 'select' ? ` « ${value} »` : ''
  const verb = { click: 'clic sur', fill: 'saisie dans', select: 'choix dans', check: 'coche', uncheck: 'décoche' }[action]
  const what = `${verb} ${describeEl(el)}${shown}`
  await ctx.onTry({ iteration, maxIterations: maxIt, what, ref: el.ref })
  const before = { url: s.url, msgs: messages(s), text: s.text || '', value: el.value, expanded: el.expanded }
  const r = await b.act(args)
  if (!r || !r.ok) return { ok: false, what, error: r?.error || 'action impossible' }
  const usedSel = r.usedSelector ? { strategy: r.usedSelector.strategy, value: r.usedSelector.value, code: r.usedSelector.code, ...(r.usedSelector.exact ? { exact: true } : {}) } : selector
  const out = [{ ...base, action, selector: usedSel, value: action === 'fill' || action === 'select' ? value : null, secret, url: null, expect: null, label }]
  // jugement du progrès
  if (action === 'fill' || action === 'select' || action === 'check' || action === 'uncheck') {
    if (action === 'fill' && !secret && value != null && !String(value).includes('{{') && usedSel) {
      const ok = await b.expect({ kind: 'value', selector: usedSel, value: String(value) })
      if (!ok.ok) return { ok: false, what, error: 'le champ n\'a pas pris la valeur' }
    }
    return { ok: true, done: true, what, steps: out }
  }
  if (['radio', 'checkbox', 'switch', 'option', 'tab'].includes(el.role)) return { ok: true, done: true, what, steps: out }
  const after = await ctx.snap()
  if (!after || after.ok === false) return { ok: true, done: true, what, steps: out }
  const urlChanged = Boolean(after.url && before.url && after.url !== before.url)
  const newMsgs = messages(after).filter((m) => !before.msgs.includes(m))
  const goneErrors = before.msgs.length && !messages(after).some((m) => before.msgs.includes(m))
  const expandedNow = (after.elements || []).some((e) => e.expanded === true) && before.expanded !== true
  const landing = coverage(p.keywords, headingWords(after))
  const textChanged = (after.text || '') !== before.text
  if (p.intent === 'navigate' || p.intent === 'state') {
    if (urlChanged && landing < coverage(p.keywords, headingWords(s))) {
      // fausse piste : la page atteinte correspond moins à l'objectif que la précédente, on y revient
      await b.goto(before.url)
      return { ok: false, what, error: 'page atteinte moins pertinente, retour à la page précédente' }
    }
    if (urlChanged || textChanged) {
      if (landing >= need(p) || (urlChanged && iteration >= maxIt)) {
        out.push({ ...base, action: 'expect', selector: null, value: null, secret: null, url: null, expect: { kind: 'url', value: urlPart(after.url) }, label: '' })
        return { ok: true, done: true, what, steps: out }
      }
      return { ok: true, done: false, what, steps: out }
    }
    // déjà sur la bonne page : le clic n'a rien changé mais l'objectif est atteint
    if (landing >= need(p)) return { ok: true, done: true, what, steps: out }
    return { ok: false, what, error: 'aucun changement de page' }
  }
  if (urlChanged || newMsgs.length || goneErrors || expandedNow || textChanged) {
    if (newMsgs.length) {
      const m = (messages(after).length && (after.elements || []).find((e) => ['alert', 'status', 'dialog', 'alertdialog'].includes(e.role) && newMsgs.includes(norm(e.name || e.text).trim())))
      const txt = m ? String(m.name || m.text).replace(/\s+/g, ' ').trim().slice(0, 80) : ''
      if (txt && m.role !== 'dialog') out.push({ ...base, action: 'expect', selector: null, value: null, secret: null, url: null, expect: { kind: 'text', value: txt }, label: '', note: 'Message affiché après l\'action.' })
    } else if (urlChanged) {
      out.push({ ...base, action: 'expect', selector: null, value: null, secret: null, url: null, expect: { kind: 'url', value: urlPart(after.url) }, label: '' })
    }
    return { ok: true, done: true, what, steps: out }
  }
  return { ok: false, what, error: 'aucun effet visible (adresse, message, contenu inchangés)' }
}

/** Part des mots-clés à retrouver dans le titre de la page atteinte (tous s'il y en a deux ou moins). */
function need(p) {
  return p.keywords.length <= 2 ? 1 : 0.6
}

function urlPart(u) {
  try {
    const x = new URL(u)
    return x.pathname.split('/').pop() || x.pathname
  } catch { return String(u || '') }
}

async function verify(ctx, p, base, maxIt) {
  const { b } = ctx
  const attempts = []
  const s = await ctx.snap()
  if (!s || s.ok === false) return { ok: false, reason: s?.error || 'Instantané impossible.', attempts, steps: [], parsed: p }
  const pageText = norm(s.text || '')
  let iteration = 0
  // 1. texte cité (orthographe de la page conservée)
  for (const q of p.quoted) {
    if (iteration >= maxIt) break
    const nq = norm(q).replace(/\s+/g, ' ').trim()
    const idx = pageText.replace(/\s+/g, ' ').indexOf(nq)
    if (idx < 0 || nq.length < 3) { attempts.push(`texte « ${q} » absent de la page`); continue }
    const flat = String(s.text || '').replace(/\s+/g, ' ')
    const exact = flat.slice(idx, idx + nq.length) || q
    iteration++
    const what = `vérification du texte « ${exact.slice(0, 60)} »`
    await ctx.onTry({ iteration, maxIterations: maxIt, what, text: exact })
    const r = await b.expect({ kind: 'text', value: exact })
    attempts.push(`${what} : ${r.ok ? 'OK' : r.error}`)
    if (r.ok) return { ok: true, steps: [{ ...base, action: 'expect', selector: null, value: null, secret: null, url: null, expect: { kind: 'text', value: exact }, label: '' }], attempts, parsed: p }
  }
  if (p.negative) {
    return { ok: false, reason: 'Vérification négative (absence, refus) : l\'heuristique ne peut pas la déduire sans risque de faux positif.', attempts, steps: [], parsed: p }
  }
  // 2. mots-clés : la page doit en contenir au moins la moitié, puis on vérifie les lignes qui en portent le plus
  const names = (s.elements || []).map((e) => e.name || '').join(' ')
  const cov = coverage(p.keywords, stems(`${s.title} ${s.text} ${names}`))
  if (cov < 0.5) {
    const missing = p.keywords.filter((k) => !stems(`${s.title} ${s.text} ${names}`).some((w) => same(k, w)))
    attempts.push(`mots-clés retrouvés sur la page : ${Math.round(cov * 100)} % (absents : ${missing.slice(0, 6).join(', ')})`)
    return { ok: false, reason: `Vérification non trouvée : la page ne contient que ${Math.round(cov * 100)} % des mots-clés attendus (absents : ${missing.slice(0, 5).join(', ')}).`, attempts, steps: [], parsed: p }
  }
  const lines = bestLines(p, s.lines && s.lines.length ? s.lines : s.text, maxIt).filter((l) => l.hit >= Math.min(2, p.keywords.length))
  const steps = []
  for (const l of lines) {
    if (iteration >= maxIt || steps.length >= 2) break
    iteration++
    const what = `vérification du texte « ${l.line.slice(0, 60)} » (${l.hit} mot(s)-clé(s))`
    await ctx.onTry({ iteration, maxIterations: maxIt, what, text: l.line })
    const r = await b.expect({ kind: 'text', value: l.line })
    attempts.push(`${what} : ${r.ok ? 'OK' : r.error}`)
    if (r.ok) steps.push({ ...base, action: 'expect', selector: null, value: null, secret: null, url: null, expect: { kind: 'text', value: l.line }, label: '' })
  }
  // élément nommé (région, tableau, titre) qui porte les mots-clés : vérification de visibilité
  if (!steps.length && iteration < maxIt) {
    const named = (s.elements || []).map((e) => ({ e, hit: matchCount(p.keywords, stems(e.name || '')) })).filter((x) => x.hit >= 2).sort((a, b2) => b2.hit - a.hit)[0]
    const sel = named ? ctx.selectorOf(named.e) : null
    if (sel) {
      iteration++
      const what = `vérification de ${describeEl(named.e)} visible`
      await ctx.onTry({ iteration, maxIterations: maxIt, what, ref: named.e.ref })
      const r = await b.expect({ kind: 'visible', selector: sel })
      attempts.push(`${what} : ${r.ok ? 'OK' : r.error}`)
      if (r.ok) steps.push({ ...base, action: 'expect', selector: sel, value: null, secret: null, url: null, expect: { kind: 'visible', value: null }, label: named.e.name || '' })
    }
  }
  if (steps.length) return { ok: true, steps, attempts, parsed: p }
  return { ok: false, reason: 'Vérification non trouvée : aucun texte de la page ne porte assez de mots-clés de l\'étape.', attempts, steps: [], parsed: p }
}

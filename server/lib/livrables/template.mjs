/**
 * Moteur de modèles des livrables (contrat V3.2 §6.5), sans dépendance.
 *
 *   const { markdown, missing } = renderTemplate(source, { facts, profile, doc, now }, { fields })
 *
 * Syntaxe :
 *   {{chemin}}                  valeur (ex. facts.coverage.pctAutomated, profile.organisation, this.key)
 *   {{chemin|Texte par défaut}} valeur ou texte par défaut
 *   {{chemin|pct}}              filtres : pct, date, datetime, count, join, upper, lower, duree, ouinon
 *   {{#each chemin}}…{{else}}…{{/each}}   boucle ({{this}}, {{this.x}}, {{@index}} base 0, {{@n}} base 1)
 *   {{#if chemin}}…{{else}}…{{/if}}       {{#unless chemin}}…{{/unless}}
 *
 * Une valeur `profile.*` absente et sans défaut produit le marqueur
 * **[À compléter : <libellé> — Informations projet › <étape>]** et une entrée dans `missing`.
 * Une valeur de fait absente produit « — » (jamais de vide silencieux).
 * Dans une ligne de tableau Markdown, les « | » et retours à la ligne des valeurs sont neutralisés.
 */

const FILTERS = new Set(['pct', 'date', 'datetime', 'count', 'join', 'upper', 'lower', 'duree', 'ouinon'])

// --- analyse ---------------------------------------------------------------

function tokenize(src) {
  const tokens = []
  const re = /\{\{\s*([#/]?)([^}]*?)\s*\}\}/g
  let last = 0
  let m
  while ((m = re.exec(src))) {
    if (m.index > last) tokens.push({ type: 'text', value: src.slice(last, m.index) })
    const lineStart = src.lastIndexOf('\n', m.index - 1) + 1
    const inTable = src.slice(lineStart, m.index).trimStart().startsWith('|')
    const sigil = m[1]
    const body = m[2].trim()
    if (sigil === '#') {
      const [kw, ...rest] = body.split(/\s+/)
      tokens.push({ type: 'open', kw, arg: rest.join(' ') })
    } else if (sigil === '/') {
      tokens.push({ type: 'close', kw: body })
    } else if (body === 'else') {
      tokens.push({ type: 'else' })
    } else {
      tokens.push({ type: 'var', expr: body, inTable })
    }
    last = re.lastIndex
  }
  if (last < src.length) tokens.push({ type: 'text', value: src.slice(last) })
  stripStandalone(tokens)
  return tokens
}

/** Une balise de bloc seule sur sa ligne ne laisse pas de ligne vide (indispensable dans les tableaux). */
function stripStandalone(tokens) {
  tokens.forEach((t, i) => {
    if (!['open', 'close', 'else'].includes(t.type)) return
    const prev = tokens[i - 1]
    const next = tokens[i + 1]
    const prevOk = !prev || (prev.type === 'text' && /(^|\n)[ \t]*$/.test(prev.value))
    const nextOk = !next || (next.type === 'text' && /^[ \t]*(\r?\n|$)/.test(next.value))
    if (!prevOk || !nextOk) return
    if (prev) prev.value = prev.value.replace(/[ \t]*$/, '')
    if (next) next.value = next.value.replace(/^[ \t]*\r?\n?/, '')
  })
}

function parse(src) {
  const root = { children: [] }
  const stack = [{ node: root, target: root.children }]
  for (const t of tokenize(src)) {
    const top = stack[stack.length - 1]
    if (t.type === 'open') {
      if (!['each', 'if', 'unless'].includes(t.kw)) throw new Error(`Bloc inconnu {{#${t.kw}}}`)
      const node = { type: t.kw, arg: t.arg, children: [], otherwise: [] }
      top.target.push(node)
      stack.push({ node, target: node.children })
    } else if (t.type === 'else') {
      if (stack.length === 1) throw new Error('{{else}} hors d\'un bloc')
      top.target = top.node.otherwise
    } else if (t.type === 'close') {
      if (stack.length === 1 || top.node.type !== t.kw) throw new Error(`{{/${t.kw}}} inattendu`)
      stack.pop()
    } else {
      top.target.push(t)
    }
  }
  if (stack.length > 1) throw new Error(`Bloc {{#${stack[stack.length - 1].node.type}}} non fermé`)
  return root.children
}

// --- évaluation ------------------------------------------------------------

function getPath(obj, path) {
  let cur = obj
  for (const part of path.split('.')) {
    if (cur == null) return undefined
    cur = cur[part]
  }
  return cur
}

/** Résout un chemin : variables de boucle, puis `this`, puis racine du contexte. */
function resolve(path, scopes) {
  const scope = scopes[scopes.length - 1]
  if (path === 'this') return scope.this
  if (path === '@index') return scope.index
  if (path === '@n') return scope.index == null ? undefined : scope.index + 1
  if (path.startsWith('this.')) return getPath(scope.this, path.slice(5))
  return getPath(scopes[0].this, path)
}

export function isEmpty(v) {
  return v == null || v === '' || (Array.isArray(v) && v.length === 0) ||
    (typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && Object.keys(v).length === 0)
}

function fmtDate(v, withTime) {
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v)
  const opts = { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Paris' }
  if (withTime) Object.assign(opts, { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleString('fr-FR', opts)
}

function applyFilter(name, v) {
  switch (name) {
    case 'pct': {
      const n = Number(v)
      return Number.isFinite(n) ? `${Math.round(n)} %` : v
    }
    case 'date': return isEmpty(v) ? v : fmtDate(v, false)
    case 'datetime': return isEmpty(v) ? v : fmtDate(v, true)
    case 'count': return Array.isArray(v) ? v.length : v && typeof v === 'object' ? Object.keys(v).length : Number(v) || 0
    case 'join': return Array.isArray(v) ? v.map(stringify).join(', ') : v
    case 'upper': return v == null ? v : String(v).toUpperCase()
    case 'lower': return v == null ? v : String(v).toLowerCase()
    case 'duree': {
      const ms = Number(v)
      if (!Number.isFinite(ms)) return v
      const s = Math.round(ms / 1000)
      return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`
    }
    case 'ouinon': return v ? 'oui' : 'non'
    default: return v
  }
}

function stringify(v) {
  if (v == null) return ''
  if (Array.isArray(v)) return v.map(stringify).join(', ')
  if (typeof v === 'object') return v.label || v.name || v.title || v.key || JSON.stringify(v)
  if (typeof v === 'boolean') return v ? 'oui' : 'non'
  return String(v)
}

function cellSafe(s) {
  return s.replace(/\r?\n+/g, ' ').replace(/\|/g, '\\|')
}

function evalVar(tok, scopes, env) {
  const [path, ...pipes] = tok.expr.split('|').map((s) => s.trim())
  let v = resolve(path, scopes)
  let fallback
  for (const p of pipes) {
    if (FILTERS.has(p)) v = applyFilter(p, v)
    else fallback = p
  }
  let out
  if (isEmpty(v) && v !== 0) {
    if (fallback !== undefined) out = fallback
    else if (path.startsWith('profile.')) out = env.markMissing(path.slice(8))
    else out = '—'
  } else {
    out = stringify(v)
  }
  return tok.inTable ? cellSafe(out) : out
}

function run(nodes, scopes, env) {
  let out = ''
  for (const n of nodes) {
    if (n.type === 'text') out += n.value
    else if (n.type === 'var') out += evalVar(n, scopes, env)
    else if (n.type === 'if' || n.type === 'unless') {
      const v = resolve(n.arg, scopes)
      const truthy = !isEmpty(v) && v !== false && v !== 0
      out += run((n.type === 'if' ? truthy : !truthy) ? n.children : n.otherwise, scopes, env)
    } else if (n.type === 'each') {
      const v = resolve(n.arg, scopes)
      const list = Array.isArray(v) ? v : v && typeof v === 'object' ? Object.entries(v).map(([key, value]) => ({ key, value })) : []
      if (!list.length) out += run(n.otherwise, scopes, env)
      list.forEach((item, index) => {
        out += run(n.children, [...scopes, { this: item, index }], env)
      })
    }
  }
  return out
}

/**
 * Rend un modèle. `fields` : { [champ]: { label, step } } (questionnaire) pour les marqueurs « À compléter ».
 * Renvoie { markdown, missing: [{ field, label, step }] }.
 */
export function renderTemplate(source, context, { fields = {} } = {}) {
  const missing = new Map()
  const env = {
    markMissing(field) {
      const f = fields[field] || {}
      const label = f.label || field
      const step = f.step || 'Informations projet'
      if (!missing.has(field)) missing.set(field, { field, label, step })
      return `**[À compléter : ${label} — Informations projet › ${step}]**`
    },
  }
  const markdown = run(parse(source), [{ this: context, index: null }], env)
    .replace(/\n{3,}/g, '\n\n')
  return { markdown, missing: [...missing.values()] }
}

/** Vérifie la syntaxe d'un modèle (édition) : { ok, error }. */
export function checkTemplate(source) {
  try {
    parse(String(source))
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

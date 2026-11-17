/**
 * Sélecteurs Playwright : construction des candidats classés à partir de la description d'un élément
 * (calculée dans la page par recorder/inpage.js), code Playwright lisible, et résolution en Locator.
 *
 * Module pur (aucune dépendance) : utilisé par le processus enfant (runner) et par codegen.mjs.
 *
 * Candidat : { strategy: 'testid'|'role'|'label'|'placeholder'|'text'|'css', value, exact?, code, unique }
 *   - role : value = { role, name } (exact porté par le candidat)
 *   - autres : value = chaîne
 */

export const STRATEGY_ORDER = ['testid', 'role', 'label', 'placeholder', 'text', 'css']

// Rôles pour lesquels un sélecteur par rôle + nom est pertinent
const NAMED_ROLES = new Set([
  'button', 'link', 'textbox', 'searchbox', 'checkbox', 'radio', 'combobox', 'listbox', 'option', 'tab',
  'menuitem', 'menuitemcheckbox', 'menuitemradio', 'switch', 'spinbutton', 'slider', 'heading', 'treeitem',
  'row', 'cell', 'gridcell', 'columnheader', 'dialog', 'alert', 'status', 'img', 'navigation', 'region',
])

const MAX_TEXT = 80

/** Littéral de chaîne JavaScript entre apostrophes simples, correctement échappé. */
export function jsString(value) {
  const json = JSON.stringify(String(value ?? ''))
  return "'" + json.slice(1, -1).replace(/\\"/g, '"').replace(/'/g, "\\'") + "'"
}

/** Échappe une chaîne pour une expression régulière. */
export function escapeRegex(s) {
  return String(s ?? '').replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
}

function clean(s, max = MAX_TEXT) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > max ? '' : t
}

/** Code Playwright (expression) d'un sélecteur. Renvoie '' si le sélecteur est invalide. */
export function selectorCode(sel, pageVar = 'page') {
  if (!sel || !sel.strategy) return ''
  const v = sel.value
  const exact = sel.exact === true
  switch (sel.strategy) {
    case 'testid':
      return `${pageVar}.getByTestId(${jsString(v)})`
    case 'role': {
      const r = normalizeRoleValue(v)
      if (!r) return ''
      if (!r.name) return `${pageVar}.getByRole(${jsString(r.role)})`
      const opts = `{ name: ${jsString(r.name)}${exact || r.exact ? ', exact: true' : ''} }`
      return `${pageVar}.getByRole(${jsString(r.role)}, ${opts})`
    }
    case 'label':
      return `${pageVar}.getByLabel(${jsString(v)}${exact ? ', { exact: true }' : ''})`
    case 'placeholder':
      return `${pageVar}.getByPlaceholder(${jsString(v)}${exact ? ', { exact: true }' : ''})`
    case 'text':
      return `${pageVar}.getByText(${jsString(v)}${exact ? ', { exact: true }' : ''})`
    case 'css':
      return `${pageVar}.locator(${jsString(v)})`
    default:
      return ''
  }
}

/** Accepte { role, name } ou une chaîne « button|Valider » / « button "Valider" ». */
export function normalizeRoleValue(v) {
  if (!v) return null
  if (typeof v === 'object') {
    if (!v.role) return null
    return { role: String(v.role), name: v.name == null ? '' : String(v.name), exact: v.exact === true }
  }
  const s = String(v).trim()
  let m = s.match(/^([a-z]+)\s*\|\s*(.*)$/i)
  if (m) return { role: m[1].toLowerCase(), name: m[2], exact: false }
  m = s.match(/^([a-z]+)\s*(?:\[name=)?\s*["'](.*)["']\]?$/i)
  if (m) return { role: m[1].toLowerCase(), name: m[2], exact: false }
  if (/^[a-z]+$/i.test(s)) return { role: s.toLowerCase(), name: '', exact: false }
  return null
}

/** Résout un sélecteur { strategy, value, exact } en Locator Playwright (null si invalide). */
export function locatorFor(page, sel) {
  if (!sel || !sel.strategy) return null
  const v = sel.value
  const exact = sel.exact === true
  switch (sel.strategy) {
    case 'testid':
      return v ? page.getByTestId(String(v)) : null
    case 'role': {
      const r = normalizeRoleValue(v)
      if (!r) return null
      if (!r.name) return page.getByRole(r.role)
      return page.getByRole(r.role, { name: r.name, exact: exact || r.exact })
    }
    case 'label':
      return v ? page.getByLabel(String(v), { exact }) : null
    case 'placeholder':
      return v ? page.getByPlaceholder(String(v), { exact }) : null
    case 'text':
      return v ? page.getByText(String(v), { exact }) : null
    case 'css':
      return v ? page.locator(String(v)) : null
    case 'ref':
      return /^e\d+$/.test(String(v)) ? page.locator(`[data-wqa-ref="${v}"]`) : null
    default:
      return null
  }
}

/**
 * Candidats classés (testid > role+name > label > placeholder > text > css) à partir d'une description :
 * { tag, type, role, name, label, placeholder, text, testid, css, counts: { testid, role, label, placeholder, text, css } }
 * `counts` est l'estimation d'unicité calculée dans la page (vérifiée ensuite par Playwright si possible).
 * Chaque stratégie peut produire une variante exacte (exact: true), utilisée si la variante simple n'est pas unique.
 */
export function buildCandidates(desc) {
  if (!desc) return []
  const out = []
  const counts = desc.counts || {}
  const push = (strategy, value, extra = {}) => {
    const c = { strategy, value, ...extra }
    c.code = selectorCode(c)
    if (!c.code) return
    const n = counts[strategy + (extra.exact ? 'Exact' : '')] ?? counts[strategy]
    c.unique = typeof n === 'number' ? n === 1 : false
    c.estimated = true
    out.push(c)
  }
  if (desc.testid) push('testid', String(desc.testid))
  const name = clean(desc.name)
  if (desc.role && NAMED_ROLES.has(desc.role) && name) {
    push('role', { role: desc.role, name })
    push('role', { role: desc.role, name }, { exact: true, variant: true })
  }
  const label = clean(desc.label)
  if (label) {
    push('label', label)
    push('label', label, { exact: true, variant: true })
  }
  const placeholder = clean(desc.placeholder)
  if (placeholder) push('placeholder', placeholder)
  const text = clean(desc.text, 60)
  const textual = !['input', 'select', 'textarea'].includes(desc.tag)
  if (text && textual) push('text', text, { exact: true })
  if (desc.css) push('css', String(desc.css))
  return out
}

/**
 * Vérifie l'unicité des candidats avec Playwright (count() == 1) et retire les variantes inutiles :
 * la variante exacte n'est conservée que si la variante simple n'est pas unique.
 */
export async function verifyCandidates(page, candidates, { timeoutMs = 1500 } = {}) {
  const checked = await Promise.all(candidates.map(async (c) => {
    try {
      const loc = locatorFor(page, c)
      if (!loc) return { ...c, unique: false }
      const n = await withTimeout(loc.count(), timeoutMs)
      return { ...c, unique: n === 1, count: n, estimated: false }
    } catch {
      return { ...c }
    }
  }))
  return pruneVariants(checked)
}

/** Sans vérification Playwright : on garde l'estimation de la page et on retire les variantes inutiles. */
export function pruneVariants(candidates) {
  const out = []
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]
    if (c.variant) {
      const base = out[out.length - 1]
      const sameBase = base && base.strategy === c.strategy && !base.variant
      if (sameBase && base.unique) continue
      if (sameBase && !c.unique) continue
      if (sameBase) out.pop()
    }
    const { variant, ...rest } = c
    void variant
    out.push(rest)
  }
  return out
}

/** Meilleur candidat : le premier unique dans l'ordre de priorité, sinon le premier. */
export function bestCandidate(candidates) {
  if (!candidates || !candidates.length) return null
  const u = candidates.find((c) => c.unique)
  const c = u || candidates[0]
  return { strategy: c.strategy, value: c.value, exact: c.exact === true || undefined, code: c.code, unique: !!c.unique }
}

function withTimeout(promise, ms) {
  let t
  return Promise.race([
    promise.finally(() => clearTimeout(t)),
    new Promise((_, reject) => { t = setTimeout(() => reject(new Error('délai dépassé')), ms) }),
  ])
}

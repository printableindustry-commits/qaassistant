/**
 * Génération du test Playwright (docs/V3-ARCHITECTURE.md §5.2).
 *
 *   buildPlaywrightSpec({ story, target, accounts, scenarios }) → { code, relPath }
 *   buildAccountsFixture(accounts) → contenu JSON de tests/.auth/accounts.local.json (non versionné)
 *   stepsFromRecording(events, opts) → Step[] (règles déterministes, sans IA)
 *
 * Le code généré ne contient jamais de mot de passe : les comptes sont lus à l'exécution dans
 * tests/.auth/accounts.local.json ou dans QA_ACCOUNT_<ID>_USERNAME / QA_ACCOUNT_<ID>_PASSWORD.
 */
import { jsString, escapeRegex, selectorCode, bestCandidate } from './selectors.mjs'

const MARKER_RE = /\{\{((?:account|secret):[^{}]+)\}\}/g
// Code de sélecteur fourni tel quel : accepté seulement s'il se réduit à un appel avec des littéraux de chaîne
// (sinon « page.locator('a'), require('child_process')… » passerait : injection de code dans le test généré).
const JS_STR = "'(?:[^'\\\\\\n\\r\\u2028\\u2029]|\\\\.)*'"
const SAFE_CODE_RE = new RegExp(
  `^page\\.(?:(?:getByTestId|getByLabel|getByPlaceholder|getByText|getByTitle|getByAltText|locator)\\(${JS_STR}(?:, \\{ exact: true \\})?\\)` +
  `|getByRole\\(${JS_STR}(?:, \\{ name: ${JS_STR}(?:, exact: true)? \\})?\\))` +
  '(?:\\.(?:first|last)\\(\\)|\\.nth\\(\\d+\\))?$')

const SOURCE_LABEL = { ai: 'IA', human: 'testeur', rule: 'règle' }

// sauts de ligne, y compris U+2028 et U+2029 (interdits dans un commentaire // généré)
const LINE_BREAKS = new RegExp('[\\r\\n' + String.fromCharCode(0x2028, 0x2029) + ']+', 'g')

function oneLine(s) {
  return String(s ?? '').replace(LINE_BREAKS, ' ').replace(/\s+/g, ' ').trim()
}

export function safeFileKey(key) {
  return String(key || 'sans-cle').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+/, '') || 'sans-cle'
}

/** Identifiant de variable d'environnement pour un compte : « agent-2 » → « AGENT_2 ». */
export function accountEnvId(id) {
  return String(id || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

/** Expression TypeScript d'une valeur saisie : marqueurs → compte('id').username|password. */
function valueExpr(value, secret, passwordMap) {
  if (secret && !value) value = `{{${String(secret).replace(/^\{\{|\}\}$/g, '')}}}`
  let s = String(value ?? '')
  // filet de sécurité : un mot de passe connu ne doit jamais apparaître en clair
  for (const [pwd, marker] of passwordMap) {
    if (pwd && s.includes(pwd)) s = s.split(pwd).join(marker)
  }
  const parts = []
  let last = 0
  for (const m of s.matchAll(MARKER_RE)) {
    if (m.index > last) parts.push(jsString(s.slice(last, m.index)))
    parts.push(markerExpr(m[1]))
    last = m.index + m[0].length
  }
  if (last < s.length || !parts.length) parts.push(jsString(s.slice(last)))
  return parts.join(' + ')
}

function markerExpr(key) {
  const m = key.match(/^account:([^:]+):(username|password)$/)
  if (m) return `compte(${jsString(m[1])}).${m[2]}`
  const name = key.replace(/^secret:/, '')
  return `secret(${jsString(name)})`
}

function locatorExpr(selector) {
  if (!selector) return null
  if (selector.strategy && selector.strategy !== 'ref') {
    const code = selectorCode(selector)
    if (code) return code
  }
  const code = String(selector.code || '').trim()
  if (code && SAFE_CODE_RE.test(code) && !code.includes('${')) return code
  return null
}

function relativeUrl(url, baseUrl) {
  const u = String(url || '')
  if (!u) return null
  if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) return { rel: u }
  try {
    const abs = new URL(u)
    const base = new URL(baseUrl)
    const basePath = base.pathname.endsWith('/') ? base.pathname : base.pathname.replace(/[^/]*$/, '')
    if (abs.origin === base.origin && abs.pathname.startsWith(basePath)) {
      return { rel: abs.pathname.slice(basePath.length) + abs.search + abs.hash }
    }
    return { abs: abs.toString() }
  } catch {
    return { abs: u }
  }
}

function urlPattern(url, baseUrl) {
  const v = String(url || '')
  try {
    const abs = new URL(v, baseUrl || undefined)
    return abs.pathname + abs.search
  } catch {
    return v
  }
}

function stepLines(step, ctx) {
  const lines = []
  const sel = step.selector ? locatorExpr(step.selector) : null
  const needSel = (what) => {
    if (sel) return false
    lines.push(`throw new Error(${jsString(`Sélecteur manquant pour l'étape « ${what} » : complétez-le dans Wizard QA.`)})`)
    return true
  }
  const v = () => valueExpr(step.value, step.secret, ctx.passwordMap)
  switch (step.action) {
    case 'goto': {
      const r = relativeUrl(step.url || step.value || '', ctx.baseUrl)
      if (!r) lines.push('await page.goto(BASE_URL)')
      else if (r.rel != null) lines.push(r.rel ? `await page.goto(urlDe(${jsString(r.rel)}))` : 'await page.goto(BASE_URL)')
      else lines.push(`await page.goto(${jsString(r.abs)})`)
      break
    }
    case 'click':
      if (!needSel('clic')) lines.push(`await ${sel}.click()`)
      break
    case 'hover':
      if (!needSel('survol')) lines.push(`await ${sel}.hover()`)
      break
    case 'fill':
      if (!needSel('saisie')) lines.push(`await ${sel}.fill(${v()})`)
      break
    case 'select':
      if (!needSel('choix')) lines.push(`await ${sel}.selectOption(${v()})`)
      break
    case 'check':
      if (!needSel('case à cocher')) lines.push(`await ${sel}.check()`)
      break
    case 'uncheck':
      if (!needSel('case à décocher')) lines.push(`await ${sel}.uncheck()`)
      break
    case 'press': {
      const key = jsString(step.value || step.key || 'Enter')
      lines.push(sel ? `await ${sel}.press(${key})` : `await page.keyboard.press(${key})`)
      break
    }
    case 'expect': {
      const ex = step.expect || {}
      const kind = ex.kind || 'visible'
      const value = ex.value ?? step.value
      if (kind === 'url') {
        lines.push(`await expect(page).toHaveURL(new RegExp(${jsString(escapeRegex(urlPattern(value, ctx.baseUrl)))}))`)
      } else if (kind === 'text' && !sel) {
        lines.push(`await expect(page.locator('body')).toContainText(${valueExpr(value, null, ctx.passwordMap)})`)
      } else if (needSel(`vérification ${kind}`)) {
        // ligne déjà ajoutée
      } else if (kind === 'visible') {
        lines.push(`await expect(${sel}).toBeVisible()`)
      } else if (kind === 'hidden') {
        lines.push(`await expect(${sel}).toBeHidden()`)
      } else if (kind === 'text') {
        lines.push(ex.exact
          ? `await expect(${sel}).toHaveText(${valueExpr(value, null, ctx.passwordMap)})`
          : `await expect(${sel}).toContainText(${valueExpr(value, null, ctx.passwordMap)})`)
      } else if (kind === 'value') {
        lines.push(`await expect(${sel}).toHaveValue(${valueExpr(value, ex.secret, ctx.passwordMap)})`)
      } else {
        lines.push(`// Vérification non prise en charge : ${oneLine(kind)}`)
      }
      break
    }
    default:
      lines.push(`// Action non prise en charge : ${oneLine(step.action)}`)
  }
  return lines
}

/**
 * Spec @playwright/test lisible.
 * { story: { key, summary }, target: { name, baseUrl }, accounts: [{ id, label }], scenarios: [{ name, steps }] }
 */
export function buildPlaywrightSpec({ story = {}, target = {}, accounts = [], scenarios = [] } = {}) {
  const key = story.key || 'SANS-CLE'
  const summary = oneLine(story.summary || '')
  const baseUrl = target.baseUrl || 'http://127.0.0.1/'
  const relPath = `tests/e2e/${safeFileKey(key)}.spec.ts`
  const passwordMap = new Map()
  for (const a of accounts || []) {
    if (a && a.password) passwordMap.set(String(a.password), `{{account:${a.id}:password}}`)
  }
  const ctx = { baseUrl, passwordMap }
  const usedAccounts = new Set()
  const usedSecrets = new Set()
  for (const sc of scenarios) {
    for (const st of sc.steps || []) {
      const text = `${st.value ?? ''} ${st.secret ? `{{${st.secret}}}` : ''} ${st.expect && st.expect.value != null ? st.expect.value : ''}`
      for (const m of text.matchAll(MARKER_RE)) {
        const am = m[1].match(/^account:([^:]+):/)
        if (am) usedAccounts.add(am[1])
        else usedSecrets.add(m[1].replace(/^secret:/, ''))
      }
    }
  }

  const L = []
  L.push(`// Test généré par Wizard QA à partir du récit ${oneLine(key)}${summary ? ` — ${summary}` : ''}.`)
  L.push(`// Application testée : ${oneLine(target.name || 'cible')} (${oneLine(baseUrl)}).`)
  L.push('// Comptes de démonstration : lus dans tests/.auth/accounts.local.json (non versionné) ou dans les variables')
  L.push('// QA_ACCOUNT_<ID>_USERNAME / QA_ACCOUNT_<ID>_PASSWORD. Aucun mot de passe n\'est écrit dans ce fichier.')
  if (usedAccounts.size) {
    const labels = [...usedAccounts].map((id) => {
      const a = (accounts || []).find((x) => x.id === id)
      return a && a.label ? `${id} (${oneLine(a.label)})` : id
    })
    L.push(`// Comptes utilisés : ${labels.join(', ')}.`)
  }
  L.push("import { test, expect } from '@playwright/test'")
  L.push("import * as fs from 'fs'")
  L.push("import * as path from 'path'")
  L.push('')
  L.push(`const BASE_URL = process.env.QA_BASE_URL || ${jsString(baseUrl)}`)
  L.push('')
  L.push('type Compte = { username: string, password: string }')
  L.push('let comptesLocaux: Record<string, Compte> | null = null')
  L.push('')
  L.push('function lireComptesLocaux(): Record<string, Compte> {')
  L.push('  if (comptesLocaux) return comptesLocaux')
  L.push("  const fichiers = [path.resolve(process.cwd(), 'tests/.auth/accounts.local.json')]")
  L.push("  if (typeof __dirname !== 'undefined') fichiers.push(path.resolve(__dirname, '../.auth/accounts.local.json'))")
  L.push('  for (const f of fichiers) {')
  L.push('    if (fs.existsSync(f)) {')
  L.push("      comptesLocaux = JSON.parse(fs.readFileSync(f, 'utf8'))")
  L.push('      return comptesLocaux as Record<string, Compte>')
  L.push('    }')
  L.push('  }')
  L.push('  comptesLocaux = {}')
  L.push('  return comptesLocaux')
  L.push('}')
  L.push('')
  L.push('/** Compte de démonstration : variables QA_ACCOUNT_<ID>_USERNAME|PASSWORD, sinon fichier local. */')
  L.push('function compte(id: string): Compte {')
  L.push("  const cle = id.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')")
  L.push('  const local = lireComptesLocaux()[id] || ({} as Partial<Compte>)')
  L.push('  const username = process.env[`QA_ACCOUNT_${cle}_USERNAME`] || local.username')
  L.push('  const password = process.env[`QA_ACCOUNT_${cle}_PASSWORD`] || local.password')
  L.push('  if (!username || !password) {')
  L.push('    throw new Error(`Compte de démonstration « ${id} » introuvable : renseignez tests/.auth/accounts.local.json ou QA_ACCOUNT_${cle}_USERNAME / QA_ACCOUNT_${cle}_PASSWORD.`)')
  L.push('  }')
  L.push('  return { username, password }')
  L.push('}')
  if (usedSecrets.size) {
    L.push('')
    L.push('/** Secret complémentaire : variable QA_SECRET_<NOM>. */')
    L.push('function secret(nom: string): string {')
    L.push("  const cle = 'QA_SECRET_' + nom.toUpperCase().replace(/[^A-Z0-9]+/g, '_')")
    L.push('  const v = process.env[cle]')
    L.push('  if (!v) throw new Error(`Secret « ${nom} » manquant : définissez ${cle}.`)')
    L.push('  return v')
    L.push('}')
  }
  L.push('')
  L.push('function urlDe(chemin: string): string {')
  L.push('  return new URL(chemin, BASE_URL).toString()')
  L.push('}')
  L.push('')
  L.push(`test.describe(${jsString(`${key}${summary ? ` — ${summary}` : ''}`)}, () => {`)
  const list = scenarios.length ? scenarios : [{ name: 'Scénario', steps: [] }]
  list.forEach((sc, i) => {
    if (i > 0) L.push('')
    const name = oneLine(sc.name) || `Scénario ${i + 1}`
    L.push(`  test(${jsString(name)}, async ({ page }) => {`)
    const steps = sc.steps || []
    if (!steps.length) L.push('    // Aucune étape : à compléter.')
    let lastGherkin = null
    let lastSource = null
    for (const st of steps) {
      const g = oneLine(st.gherkin)
      const src = st.source || 'rule'
      if (g && g !== lastGherkin) {
        L.push(`    // ${g} (source : ${SOURCE_LABEL[src] || oneLine(src)})`)
        lastGherkin = g
        lastSource = src
      } else if (!g && src !== lastSource) {
        L.push(`    // Étapes ${src === 'human' ? 'enregistrées par le testeur' : src === 'ai' ? 'trouvées par l\'IA' : 'déduites par règles'} (source : ${SOURCE_LABEL[src] || oneLine(src)})`)
        lastSource = src
      }
      if (st.note) L.push(`    // Remarque : ${oneLine(st.note)}`)
      for (const line of stepLines(st, ctx)) L.push('    ' + line)
    }
    L.push('  })')
  })
  L.push('})')
  L.push('')
  return { code: L.join('\n'), relPath }
}

/**
 * Contenu du fichier local des comptes (tests/.auth/accounts.local.json, à ne pas versionner, mode 0o600).
 * accounts : [{ id, label, username, password }]
 */
export function buildAccountsFixture(accounts = []) {
  const out = {}
  for (const a of accounts) {
    if (!a || !a.id) continue
    out[a.id] = { username: String(a.username ?? ''), password: String(a.password ?? '') }
    if (a.label) out[a.id].label = String(a.label)
  }
  return JSON.stringify(out, null, 2) + '\n'
}

// ---------- Enregistrement → étapes (règles, sans IA) ----------
const FIELD_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'listbox', 'spinbutton', 'slider'])

function selOf(ev) {
  if (ev.selector) return ev.selector
  return bestCandidate(ev.candidates || [])
}
function keyOf(ev) {
  const s = selOf(ev)
  return s ? s.code || JSON.stringify([s.strategy, s.value]) : ''
}
function isFieldClick(ev) {
  const el = ev.element || {}
  if (el.tag === 'select' || el.tag === 'textarea') return true
  if (el.tag === 'input' && !['button', 'submit', 'reset', 'image', 'checkbox', 'radio', 'file'].includes(el.type)) return true
  return FIELD_ROLES.has(el.role) && el.tag !== 'button'
}
function isToggle(ev) {
  const el = ev.element || {}
  return (el.tag === 'input' && (el.type === 'checkbox' || el.type === 'radio')) || el.role === 'checkbox' || el.role === 'radio' || el.role === 'switch'
}
function describeEl(ev) {
  const el = ev.element || {}
  return oneLine(el.name || el.label || el.placeholder || el.text || el.tag || '')
}

/**
 * Étapes déterministes à partir des événements de l'enregistreur :
 * navigation initiale → goto ; saisies successives fusionnées ; clics redondants (sur un champ, avant une case
 * à cocher, double clic) supprimés ; Tab et soumissions implicites ignorées ; navigation consécutive à une
 * action → vérification d'adresse.
 */
export function stepsFromRecording(events = [], { source = 'human' } = {}) {
  const evs = [...events].filter(Boolean).sort((a, b) => (a.at || 0) - (b.at || 0))
  const steps = []
  let currentUrl = null
  let lastActionAt = 0
  const mk = (action, ev, extra = {}) => ({
    action,
    selector: ev && ev.type !== 'navigate' ? (selOf(ev) ? { strategy: selOf(ev).strategy, value: selOf(ev).value, code: selOf(ev).code, ...(selOf(ev).exact ? { exact: true } : {}) } : null) : null,
    value: null,
    secret: null,
    url: ev ? ev.url || null : null,
    expect: null,
    gherkin: null,
    source,
    note: (ev && ev.note) || null,
    ...extra,
  })
  for (let i = 0; i < evs.length; i++) {
    const ev = evs[i]
    const next = evs[i + 1]
    switch (ev.type) {
      case 'navigate': {
        const url = ev.url
        if (!url) break
        if (!steps.length) {
          steps.push(mk('goto', ev, { url, note: null }))
          currentUrl = url
          break
        }
        const same = (() => {
          try { const a = new URL(url); const b = new URL(currentUrl); return a.pathname + a.search === b.pathname + b.search && a.origin === b.origin } catch { return url === currentUrl }
        })()
        currentUrl = url
        if (same) break
        if (ev.at && lastActionAt && ev.at - lastActionAt <= 15000) {
          const prev = steps[steps.length - 1]
          if (prev && prev.action === 'expect' && prev.expect && prev.expect.kind === 'url') steps.pop()
          steps.push(mk('expect', ev, { selector: null, url, expect: { kind: 'url', value: url }, note: 'Navigation consécutive à l\'action précédente.' }))
        } else {
          steps.push(mk('goto', ev, { url }))
        }
        break
      }
      case 'click': {
        lastActionAt = ev.at || lastActionAt
        if (isFieldClick(ev)) break
        if (isToggle(ev) && next && ['check', 'uncheck'].includes(next.type) && keyOf(next) === keyOf(ev)) break
        const prev = steps[steps.length - 1]
        const prevEv = evs[i - 1]
        if (prev && prev.action === 'click' && prevEv && prevEv.type === 'click' && keyOf(prevEv) === keyOf(ev) && (ev.at || 0) - (prevEv.at || 0) < 500) break
        steps.push(mk('click', ev))
        break
      }
      case 'fill': {
        lastActionAt = ev.at || lastActionAt
        const prev = steps[steps.length - 1]
        const step = mk('fill', ev, { value: ev.value ?? '', secret: ev.secret || null })
        if (prev && prev.action === 'fill' && prev.selector && step.selector && prev.selector.code === step.selector.code) {
          steps[steps.length - 1] = step
        } else {
          steps.push(step)
        }
        break
      }
      case 'select':
        lastActionAt = ev.at || lastActionAt
        steps.push(mk('select', ev, { value: ev.value ?? '' }))
        break
      case 'check':
      case 'uncheck': {
        lastActionAt = ev.at || lastActionAt
        const prev = steps[steps.length - 1]
        if (prev && (prev.action === 'check' || prev.action === 'uncheck') && prev.selector && keyOf(ev) && prev.selector.code === selOf(ev)?.code) steps.pop()
        steps.push(mk(ev.type, ev))
        break
      }
      case 'press': {
        lastActionAt = ev.at || lastActionAt
        const key = (ev.key || ev.value) === ' ' ? 'Space' : ev.key || ev.value
        if (key === 'Tab') break
        steps.push(mk('press', ev, { value: key }))
        break
      }
      case 'submit':
        // la soumission découle du clic ou de la touche Entrée précédents
        lastActionAt = ev.at || lastActionAt
        break
      default:
        break
    }
  }
  // libellés lisibles pour l'interface (non utilisés par le code généré)
  for (const st of steps) {
    if (!st.note && st.action !== 'goto' && st.action !== 'expect') {
      const src = events.find((e) => e && selOf(e) && st.selector && selOf(e).code === st.selector.code)
      if (src) st.label = describeEl(src)
    }
  }
  return steps
}

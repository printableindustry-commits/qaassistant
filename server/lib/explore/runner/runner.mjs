/**
 * Processus enfant du moteur d'exploration (lancé par engine.mjs, cwd = REPO_ROOT, sans shell).
 *
 * Protocole : lignes JSON.
 *   stdin  : { id, cmd, args }      (la première commande est « init », qui porte les secrets : jamais argv/env)
 *   stdout : { id, ok: true, result } | { id, ok: false, error } | { event, data }
 * Événements : log, screenshot, recording, navigated, blocked, exit.
 *
 * Sécurité :
 *   - toute chaîne sortante est expurgée des mots de passe connus (remplacés par leur marqueur) ;
 *   - les navigations hors des origines autorisées sont bloquées (route/abort) et signalées ;
 *   - si le parent disparaît (stdin fermé ou PID absent), le navigateur est fermé et le processus s'arrête.
 */
import fs from 'fs'
import crypto from 'crypto'
import readline from 'readline'
import { createRequire } from 'module'
import { buildCandidates, verifyCandidates, pruneVariants, bestCandidate, locatorFor } from '../selectors.mjs'

const require = createRequire(import.meta.url)
const INPAGE = fs.readFileSync(new URL('../recorder/inpage.js', import.meta.url), 'utf8')

const ACTION_TIMEOUT = 5000
const MARKER_RE = /\{\{((?:account|secret):[^{}]+)\}\}/g

const state = {
  pw: null,
  browser: null,
  context: null,
  page: null,
  cdp: null,
  browserId: null,
  headless: true,
  baseUrl: '',
  allowed: new Set(),
  secrets: new Map(), // 'account:agent:password' → valeur
  recording: false,
  events: [],
  pendingFill: null,
  pendingTimer: null,
  queue: Promise.resolve(),
  lastUsernameAccount: null,
  shot: { scale: 1, w: 0, h: 0, lastHash: '', busy: false, timer: null, lastAt: 0 },
  lastAllowedUrl: '',
  lastBlockedAt: 0,
  closing: false,
}

// ---------- Sortie expurgée ----------
function redactString(s) {
  if (typeof s !== 'string' || s.startsWith('data:image/')) return s
  let out = s
  for (const [key, val] of state.secrets) {
    if (!val || val.length < 4) continue
    if (!key.endsWith(':password') && !key.startsWith('secret:')) continue
    if (out.includes(val)) out = out.split(val).join(`{{${key}}}`)
  }
  return out
}
function send(obj) {
  if (process.stdout.destroyed) return
  try {
    process.stdout.write(JSON.stringify(obj, (k, v) => (typeof v === 'string' ? redactString(v) : v)) + '\n')
  } catch { /* sortie fermée */ }
}
function emit(event, data) {
  send({ event, data })
}
function log(text, level = 'info') {
  emit('log', { level, text: String(text) })
}

function shortError(e) {
  const msg = String((e && e.message) || e || 'Erreur inconnue')
  const first = msg.split('\n')[0].replace(/\u001b\[[0-9;]*m/g, '')
  if (/Timeout \d+ms exceeded|TimeoutError|délai dépassé/i.test(msg)) {
    return `Délai dépassé : l'élément n'a pas pu être actionné (masqué, désactivé, recouvert ou absent ?). Détail : ${first.slice(0, 200)}`
  }
  if (/strict mode violation/i.test(msg)) return `Sélecteur ambigu : plusieurs éléments correspondent. Détail : ${first.slice(0, 200)}`
  if (/net::ERR_BLOCKED_BY_CLIENT/.test(msg)) return 'Navigation refusée : origine hors des origines autorisées de la cible.'
  if (/Target page, context or browser has been closed|Target closed/i.test(msg)) return 'Le navigateur ou la page a été fermé.'
  return first.slice(0, 300)
}

// ---------- Origines ----------
function originOf(u) {
  try { return new URL(u).origin } catch { return '' }
}
function isAllowedUrl(u) {
  if (!u) return false
  if (/^(about:|data:|blob:|chrome-error:|chrome:|edge:)/i.test(u)) return true
  const o = originOf(u)
  return !!o && state.allowed.has(o)
}
function resolveUrl(u) {
  try { return new URL(u, state.baseUrl || undefined).toString() } catch { return '' }
}

// ---------- Secrets ----------
function substitute(text) {
  if (text == null) return { ok: true, value: '' }
  let missing = null
  const value = String(text).replace(MARKER_RE, (m, key) => {
    if (!state.secrets.has(key)) { missing = key; return m }
    return state.secrets.get(key)
  })
  if (missing) return { ok: false, error: `Secret inconnu : {{${missing}}} (compte non sélectionné ou mot de passe non renseigné).` }
  return { ok: true, value }
}
function resolveSecretValue(value, secret) {
  if (secret) {
    const key = String(secret).replace(/^\{\{|\}\}$/g, '')
    if (!state.secrets.has(key)) return { ok: false, error: `Secret inconnu : {{${key}}}.` }
    return { ok: true, value: state.secrets.get(key) }
  }
  return substitute(value)
}

// Valeur saisie → marqueur si elle correspond à un secret connu (ou si le champ est un mot de passe)
function maskValue(value, isPassword) {
  const v = String(value ?? '')
  for (const [key, val] of state.secrets) {
    if (val && v === val) {
      if (key.endsWith(':username')) state.lastUsernameAccount = key.split(':')[1]
      return { value: `{{${key}}}`, secret: key }
    }
  }
  if (isPassword) {
    let key = null
    if (state.lastUsernameAccount && state.secrets.has(`account:${state.lastUsernameAccount}:password`)) {
      key = `account:${state.lastUsernameAccount}:password`
    } else {
      key = [...state.secrets.keys()].find((k) => k.endsWith(':password')) || 'secret:mot-de-passe'
    }
    return { value: `{{${key}}}`, secret: key, guessed: !v || state.secrets.get(key) !== v }
  }
  // saisie partielle d'un mot de passe dans un champ en clair : masquée
  for (const [key, val] of state.secrets) {
    // seuil : la moitié du mot de passe (5 caractères au moins) pour éviter de masquer une recherche courte (« ges »)
    const min = Math.min(val ? val.length : 0, Math.max(5, Math.ceil((val ? val.length : 0) / 2)))
    if (key.endsWith(':password') && val && v.length >= min && val.startsWith(v)) return { value: '{{masqué}}', partial: true }
  }
  return { value: redactString(v) }
}

// ---------- Captures ----------
async function capture() {
  const page = state.page
  const vp = page.viewportSize() || { width: 1280, height: 800 }
  const scale = Math.min(1, 1024 / vp.width)
  let data = null
  let usedScale = scale
  try {
    if (!state.cdp) state.cdp = await state.context.newCDPSession(page)
    const scroll = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }))
    const r = await withTimeout(state.cdp.send('Page.captureScreenshot', {
      format: 'jpeg', quality: 60,
      clip: { x: scroll.x, y: scroll.y, width: vp.width, height: vp.height, scale },
    }), 8000)
    data = r.data
  } catch {
    state.cdp = null
    const buf = await page.screenshot({ type: 'jpeg', quality: 60, timeout: 8000 })
    data = buf.toString('base64')
    usedScale = 1
  }
  state.shot.scale = usedScale
  state.shot.w = Math.round(vp.width * usedScale)
  state.shot.h = Math.round(vp.height * usedScale)
  return { dataUrl: 'data:image/jpeg;base64,' + data, size: { w: state.shot.w, h: state.shot.h }, scale: usedScale, hash: crypto.createHash('md5').update(data).digest('hex') }
}

async function pushScreenshot({ onlyIfChanged = false } = {}) {
  if (state.shot.busy || !state.page || state.closing) return null
  state.shot.busy = true
  try {
    const s = await capture()
    if (onlyIfChanged && s.hash === state.shot.lastHash) return null
    state.shot.lastHash = s.hash
    state.shot.lastAt = Date.now()
    emit('screenshot', { dataUrl: s.dataUrl, size: s.size, scale: s.scale, url: state.page.url() })
    return s
  } catch {
    return null
  } finally {
    state.shot.busy = false
  }
}

async function settle() {
  try { await state.page.waitForLoadState('domcontentloaded', { timeout: 5000 }) } catch { /* ignoré */ }
  await new Promise((r) => setTimeout(r, 250))
}

async function ensureInjected() {
  const has = await state.page.evaluate(() => typeof window.__wqa === 'object').catch(() => false)
  if (!has) await state.page.evaluate(INPAGE).catch(() => {})
}

// ---------- Lancement ----------
async function cmdInit(args) {
  state.headless = args.headless !== false
  state.baseUrl = args.baseUrl || ''
  for (const o of [args.baseUrl, ...(args.allowedOrigins || [])]) {
    const origin = originOf(o)
    if (origin) state.allowed.add(origin)
  }
  for (const [k, v] of Object.entries(args.secrets || {})) {
    if (v != null && v !== '') state.secrets.set(String(k).replace(/^\{\{|\}\}$/g, ''), String(v))
  }
  state.pw = require(args.modulePath)
  const chromium = state.pw.chromium
  if (!chromium) throw new Error('Module Playwright invalide (chromium absent).')
  const viewport = args.viewport && args.viewport.width ? { width: Number(args.viewport.width), height: Number(args.viewport.height) || 800 } : { width: 1280, height: 800 }
  const order = Array.isArray(args.browsers) && args.browsers.length ? args.browsers : ['msedge', 'chrome', 'chromium']
  const errors = []
  for (const id of order) {
    const opts = { headless: state.headless, timeout: 60000 }
    if (id === 'msedge' || id === 'chrome') opts.channel = id
    if (!state.headless) opts.args = [`--window-size=${viewport.width + 16},${viewport.height + 120}`]
    try {
      state.browser = await chromium.launch(opts)
      state.browserId = id
      break
    } catch (e) {
      errors.push(`${id} : ${shortError(e)}`)
    }
  }
  if (!state.browser) throw new Error('Impossible de lancer un navigateur. ' + errors.join(' | '))
  if (errors.length) log(`Navigateur de repli utilisé (${state.browserId}). ${errors.join(' | ')}`, 'warn')
  state.browser.on('disconnected', () => {
    if (!state.closing) {
      emit('exit', { reason: 'Le navigateur a été fermé.' })
      shutdown(0)
    }
  })
  state.context = await state.browser.newContext({ viewport, locale: 'fr-FR', acceptDownloads: false })
  state.context.setDefaultTimeout(ACTION_TIMEOUT)
  await state.context.addInitScript({ content: INPAGE })
  await state.context.exposeBinding('__wqaEmit', (source, payload) => {
    if (!state.recording || !source || source.page !== state.page) return
    state.queue = state.queue.then(() => onRecorderEvent(payload)).catch(() => {})
  })
  await state.context.exposeBinding('__wqaState', () => state.recording)
  await state.context.route('**/*', async (route) => {
    const req = route.request()
    let url = ''
    try { url = req.url() } catch { /* ignoré */ }
    if (req.isNavigationRequest() && !isAllowedUrl(url)) {
      state.lastBlockedAt = Date.now()
      emit('blocked', { url, reason: 'origine non autorisée' })
      log(`Navigation bloquée vers ${originOf(url) || url} : origine hors des origines autorisées de la cible.`, 'warn')
      await route.abort('blockedbyclient').catch(() => {})
      return
    }
    await route.continue().catch(() => {})
  })
  state.context.on('page', (p) => {
    if (state.page && p !== state.page) {
      log('Fenêtre surgissante fermée (le moteur pilote une seule page).', 'warn')
      p.close().catch(() => {})
    }
  })
  state.page = await state.context.newPage()
  state.page.on('framenavigated', (frame) => {
    if (frame !== state.page.mainFrame()) return
    const url = frame.url()
    if (/^chrome-error:/i.test(url) && Date.now() - state.lastBlockedAt < 5000 && state.lastAllowedUrl) {
      // navigation refusée : retour à la dernière page autorisée
      state.page.goto(state.lastAllowedUrl, { waitUntil: 'domcontentloaded' }).catch(() => {})
      return
    }
    if (isAllowedUrl(url) && !/^(about:|chrome-error:)/i.test(url)) state.lastAllowedUrl = url
    state.page.title().catch(() => '').then((title) => emit('navigated', { url, title }))
    if (state.recording && /^https?:/i.test(url)) {
      state.queue = state.queue.then(() => {
        flushFill()
        recordEvent({ type: 'navigate', url, at: Date.now() })
      }).catch(() => {})
    }
  })
  state.page.on('dialog', (d) => {
    log(`Boîte de dialogue du navigateur (${d.type()}) : « ${d.message().slice(0, 200)} » — acceptée automatiquement.`, 'warn')
    d.accept().catch(() => {})
  })
  log(`Navigateur prêt (${state.browserId}${state.headless ? ', sans fenêtre' : ''}).`)
  return { browser: state.browserId, version: state.browser.version(), headless: state.headless, allowedOrigins: [...state.allowed] }
}

// ---------- Commandes ----------
async function cmdGoto({ url }) {
  const target = resolveUrl(url || state.baseUrl)
  if (!target) return { ok: false, error: `Adresse invalide : ${url}` }
  // goto piloté (IA, rejeu) : http(s) uniquement. Une page data:/blob: fabriquée (suggérée par un contenu de page)
  // pourrait recevoir un mot de passe via fill puis l'exfiltrer par une sous-requête.
  if (!/^https?:/i.test(target) || !isAllowedUrl(target)) {
    log(`Navigation refusée vers ${originOf(target) || target} : origine hors des origines autorisées.`, 'warn')
    emit('blocked', { url: target, reason: 'origine non autorisée' })
    return { ok: false, url: state.page.url(), error: `Navigation refusée : ${originOf(target) || target} ne fait pas partie des origines autorisées de la cible.` }
  }
  try {
    await state.page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await settle()
    pushScreenshot()
    return { ok: true, url: state.page.url(), title: await state.page.title() }
  } catch (e) {
    return { ok: false, url: state.page.url(), error: shortError(e) }
  }
}

async function cmdSnapshot({ screenshot = true, limit } = {}) {
  await ensureInjected()
  const snap = await state.page.evaluate((lim) => window.__wqa.snapshot({ limit: lim }), Number(limit) || 150)
  const page = state.page
  // Vérification d'unicité par Playwright (count() == 1), par lots
  const elements = []
  const BATCH = 25
  for (let i = 0; i < snap.elements.length; i += BATCH) {
    const chunk = snap.elements.slice(i, i + BATCH)
    const verified = await Promise.all(chunk.map(async (el) => {
      const cands = await verifyCandidates(page, buildCandidates(el.desc), { timeoutMs: 2000 })
      const { desc, ...rest } = el
      void desc
      return { ...rest, candidates: cands.map(publicCandidate) }
    }))
    elements.push(...verified)
  }
  const out = { ok: true, url: snap.url, title: snap.title, viewport: snap.viewport, scroll: snap.scroll, text: snap.text, truncated: snap.truncated, elements }
  if (screenshot) {
    const s = await capture().catch(() => null)
    if (s) {
      out.screenshot = s.dataUrl
      out.size = s.size
      out.scale = s.scale
      state.shot.lastHash = s.hash
    }
  }
  return out
}

function publicCandidate(c) {
  const o = { strategy: c.strategy, value: c.value, code: c.code, unique: !!c.unique }
  if (c.exact) o.exact = true
  if (typeof c.count === 'number') o.count = c.count
  return o
}

async function resolveTarget({ ref, selector }) {
  let loc = null
  if (ref) {
    if (!/^e\d+$/.test(String(ref))) return { error: `Référence invalide : ${ref}` }
    loc = state.page.locator(`[data-wqa-ref="${ref}"]`)
  } else if (selector) {
    loc = locatorFor(state.page, selector)
    if (!loc) return { error: 'Sélecteur invalide (stratégie ou valeur manquante).' }
  } else {
    return { error: 'Aucun élément visé (ref ou selector requis).' }
  }
  let n = 0
  try { n = await loc.count() } catch (e) { return { error: shortError(e) } }
  if (n === 0) return { error: ref ? `Élément ${ref} introuvable (la page a peut-être changé : refaites un instantané).` : 'Aucun élément ne correspond au sélecteur.' }
  if (n > 1) return { error: `Sélecteur ambigu : ${n} éléments correspondent.`, count: n }
  return { loc }
}

async function selectorForLocator(loc) {
  try {
    await ensureInjected()
    const desc = await loc.evaluate((el) => (window.__wqa ? window.__wqa.describe(el) : null), null, { timeout: 2000 })
    if (!desc) return null
    const cands = await verifyCandidates(state.page, buildCandidates(desc), { timeoutMs: 1500 })
    const best = bestCandidate(cands)
    return best ? { strategy: best.strategy, value: best.value, code: best.code, unique: best.unique, ...(best.exact ? { exact: true } : {}) } : null
  } catch {
    return null
  }
}

async function cmdAct(args) {
  const action = args.action
  const allowed = ['click', 'fill', 'select', 'check', 'uncheck', 'press', 'hover']
  if (!allowed.includes(action)) return { ok: false, error: `Action inconnue : ${action}` }
  if (action === 'press' && !args.ref && !args.selector) {
    try {
      await state.page.keyboard.press(String(args.value || 'Enter'))
      await settle()
      pushScreenshot()
      return { ok: true, usedSelector: null, url: state.page.url() }
    } catch (e) {
      return { ok: false, error: shortError(e) }
    }
  }
  const t = await resolveTarget(args)
  if (t.error) return { ok: false, error: t.error }
  const loc = t.loc
  const usedSelector = await selectorForLocator(loc)
  let val = null
  if (['fill', 'select', 'press'].includes(action)) {
    const r = resolveSecretValue(args.value, args.secret)
    if (!r.ok) return { ok: false, error: r.error, usedSelector }
    val = r.value
  }
  const timeout = Math.min(Number(args.timeoutMs) || ACTION_TIMEOUT, 15000)
  try {
    switch (action) {
      case 'click': await loc.click({ timeout }); break
      case 'hover': await loc.hover({ timeout }); break
      case 'fill': await loc.fill(val, { timeout }); break
      case 'check': await loc.check({ timeout }); break
      case 'uncheck': await loc.uncheck({ timeout }); break
      case 'press': await loc.press(val || 'Enter', { timeout }); break
      case 'select':
        try { await loc.selectOption({ label: val }, { timeout }) } catch { await loc.selectOption(val, { timeout }) }
        break
    }
  } catch (e) {
    return { ok: false, error: shortError(e), usedSelector, url: state.page.url() }
  }
  await settle()
  pushScreenshot()
  return { ok: true, usedSelector, url: state.page.url() }
}

async function poll(fn, timeout) {
  const end = Date.now() + timeout
  let last = null
  while (Date.now() < end) {
    try {
      last = await fn()
      if (last.ok) return last
    } catch (e) {
      last = { ok: false, error: shortError(e) }
    }
    await new Promise((r) => setTimeout(r, 150))
  }
  return last || { ok: false, error: 'Délai dépassé.' }
}
const normSpace = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()

async function cmdExpect(args) {
  const kind = args.kind
  const timeout = Math.min(Number(args.timeoutMs) || ACTION_TIMEOUT, 15000)
  let expected = ''
  if (args.value != null) {
    const r = substitute(args.value)
    if (!r.ok) return { ok: false, error: r.error }
    expected = r.value
  }
  if (kind === 'url') {
    return poll(async () => {
      const u = state.page.url()
      return u.includes(expected) ? { ok: true, actual: u } : { ok: false, error: `L'adresse ${u} ne contient pas « ${expected} ».`, actual: u }
    }, timeout)
  }
  if (!args.selector && !args.ref) {
    if (kind === 'text') {
      return poll(async () => {
        const txt = normSpace(await state.page.locator('body').innerText({ timeout: 1000 }))
        return txt.includes(normSpace(expected)) ? { ok: true } : { ok: false, error: `Texte « ${expected} » absent de la page.` }
      }, timeout)
    }
    return { ok: false, error: 'Sélecteur requis pour cette vérification.' }
  }
  const loc = args.ref ? state.page.locator(`[data-wqa-ref="${args.ref}"]`) : locatorFor(state.page, args.selector)
  if (!loc) return { ok: false, error: 'Sélecteur invalide.' }
  if (kind === 'hidden') {
    return poll(async () => {
      const n = await loc.count()
      if (n === 0) return { ok: true }
      const vis = await loc.first().isVisible()
      return vis ? { ok: false, error: 'L\'élément est encore visible.' } : { ok: true }
    }, timeout)
  }
  const one = async () => {
    const n = await loc.count()
    if (n === 0) return { ok: false, error: 'Élément introuvable.' }
    if (n > 1) return { ok: false, error: `Sélecteur ambigu : ${n} éléments correspondent.` }
    return null
  }
  if (kind === 'visible') {
    return poll(async () => (await one()) || ((await loc.isVisible()) ? { ok: true } : { ok: false, error: 'L\'élément n\'est pas visible.' }), timeout)
  }
  if (kind === 'text') {
    return poll(async () => {
      const bad = await one()
      if (bad) return bad
      const txt = normSpace(await loc.innerText({ timeout: 1000 }))
      return txt.includes(normSpace(expected)) ? { ok: true, actual: txt.slice(0, 200) } : { ok: false, error: `Texte attendu « ${expected} », obtenu « ${txt.slice(0, 120)} ».` }
    }, timeout)
  }
  if (kind === 'value') {
    return poll(async () => {
      const bad = await one()
      if (bad) return bad
      const v = await loc.inputValue({ timeout: 1000 })
      return v === expected ? { ok: true } : { ok: false, error: 'La valeur du champ ne correspond pas.' }
    }, timeout)
  }
  return { ok: false, error: `Vérification inconnue : ${kind}` }
}

// ---------- Enregistrement ----------
function targetKey(ev) {
  return (ev.selector && ev.selector.code) || (ev.candidates[0] && ev.candidates[0].code) || ''
}
function recordEvent(ev) {
  state.events.push(ev)
  emit('recording', ev)
}
function flushFill() {
  if (state.pendingTimer) { clearTimeout(state.pendingTimer); state.pendingTimer = null }
  const p = state.pendingFill
  if (!p) return
  state.pendingFill = null
  recordEvent(p)
}

async function onRecorderEvent(payload) {
  if (!payload || !state.recording) return
  let candidates = []
  if (payload.desc) {
    const estimated = pruneVariants(buildCandidates(payload.desc))
    candidates = estimated
    // vérification Playwright si la page n'a pas changé depuis l'événement
    if (state.page.url() === payload.url && payload.kind !== 'submit') {
      try {
        const raw = buildCandidates(payload.desc)
        const v = await verifyCandidates(state.page, raw, { timeoutMs: 800 })
        // élément disparu (count 0) : on garde l'estimation de la page
        if (v.some((c) => c.count > 0)) candidates = v.map((c) => (c.count === 0 ? { ...c, unique: false } : c))
      } catch { /* estimation conservée */ }
    }
  }
  candidates = candidates.map(publicCandidate)
  const best = bestCandidate(candidates)
  const d = payload.desc || {}
  const ev = {
    type: payload.kind,
    candidates,
    selector: best ? { strategy: best.strategy, value: best.value, code: best.code, unique: best.unique, ...(best.exact ? { exact: true } : {}) } : null,
    element: payload.desc ? { role: d.role, name: d.name, tag: d.tag, type: d.type, label: d.label, placeholder: d.placeholder, text: (d.text || '').slice(0, 80) } : null,
    url: payload.url,
    at: payload.at,
  }
  if (payload.kind === 'fill') {
    const m = maskValue(payload.value, payload.isPassword)
    ev.value = m.value
    if (m.secret) ev.secret = m.secret
    if (m.guessed) ev.note = 'Champ mot de passe : compte déduit, à vérifier.'
    // fusion des saisies successives sur le même champ (valeur finale)
    if (state.pendingFill && targetKey(state.pendingFill) === targetKey(ev)) {
      state.pendingFill = ev
    } else {
      flushFill()
      state.pendingFill = ev
    }
    if (state.pendingTimer) clearTimeout(state.pendingTimer)
    state.pendingTimer = setTimeout(() => { state.queue = state.queue.then(flushFill) }, 700)
    return
  }
  flushFill()
  if (payload.kind === 'select') {
    ev.value = redactString(String(payload.value ?? ''))
    if (payload.optionValue != null) ev.optionValue = redactString(String(payload.optionValue))
  }
  if (payload.kind === 'press') ev.key = payload.key
  recordEvent(ev)
}

async function cmdStartRecording() {
  state.recording = true
  state.events = []
  state.pendingFill = null
  state.lastUsernameAccount = null
  await state.page.evaluate(() => window.__wqa && window.__wqa.setBadge(true)).catch(() => {})
  const url = state.page.url()
  if (/^https?:/i.test(url)) recordEvent({ type: 'navigate', url, at: Date.now(), initial: true })
  if (state.shot.timer) clearInterval(state.shot.timer)
  state.shot.timer = setInterval(() => {
    if (state.recording) pushScreenshot({ onlyIfChanged: true })
  }, 1500)
  log('Enregistrement démarré : vos actions sont capturées.')
  pushScreenshot()
  return { ok: true, recording: true }
}

async function cmdStopRecording() {
  await state.queue.catch(() => {})
  await new Promise((r) => setTimeout(r, 50))
  await state.queue.catch(() => {})
  flushFill()
  state.recording = false
  if (state.shot.timer) { clearInterval(state.shot.timer); state.shot.timer = null }
  await state.page.evaluate(() => window.__wqa && window.__wqa.setBadge(false)).catch(() => {})
  log(`Enregistrement terminé : ${state.events.length} événement(s).`)
  return { ok: true, events: state.events }
}

async function cmdClickAt({ x, y, imageWidth, button }) {
  const scale = imageWidth && state.shot.w ? state.shot.scale * (Number(imageWidth) / state.shot.w) : state.shot.scale || 1
  const px = Number(x) / scale
  const py = Number(y) / scale
  if (!Number.isFinite(px) || !Number.isFinite(py)) return { ok: false, error: 'Coordonnées invalides.' }
  try {
    await state.page.mouse.click(px, py, { button: button === 'right' ? 'right' : 'left' })
    await settle()
    await pushScreenshot()
    return { ok: true, x: Math.round(px), y: Math.round(py), url: state.page.url() }
  } catch (e) {
    return { ok: false, error: shortError(e) }
  }
}

async function cmdTypeText({ text }) {
  const r = substitute(text)
  if (!r.ok) return { ok: false, error: r.error }
  try {
    await state.page.keyboard.type(r.value, { delay: 15 })
    await new Promise((res) => setTimeout(res, 150))
    await pushScreenshot()
    return { ok: true, url: state.page.url() }
  } catch (e) {
    return { ok: false, error: shortError(e) }
  }
}

const KEY_RE = /^((Control|Shift|Alt|Meta)\+)*(Enter|Tab|Escape|Backspace|Delete|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Home|End|PageUp|PageDown|Space|F\d{1,2}|[A-Za-z0-9])$/
async function cmdPressKey({ key }) {
  const k = String(key || '')
  if (!KEY_RE.test(k)) return { ok: false, error: `Touche non prise en charge : ${k}` }
  try {
    await state.page.keyboard.press(k === 'Space' ? ' ' : k)
    await settle()
    await pushScreenshot()
    return { ok: true, url: state.page.url() }
  } catch (e) {
    return { ok: false, error: shortError(e) }
  }
}

async function cmdScreenshot() {
  const s = await capture()
  state.shot.lastHash = s.hash
  return { ok: true, screenshot: s.dataUrl, size: s.size, scale: s.scale, url: state.page.url() }
}

function cmdSecrets({ secrets }) {
  for (const [k, v] of Object.entries(secrets || {})) {
    const key = String(k).replace(/^\{\{|\}\}$/g, '')
    if (v == null || v === '') state.secrets.delete(key)
    else state.secrets.set(key, String(v))
  }
  return { ok: true, count: state.secrets.size }
}

// ---------- Boucle principale ----------
const HANDLERS = {
  init: cmdInit,
  goto: cmdGoto,
  snapshot: cmdSnapshot,
  act: cmdAct,
  expect: cmdExpect,
  startRecording: cmdStartRecording,
  stopRecording: cmdStopRecording,
  clickAt: cmdClickAt,
  typeText: cmdTypeText,
  pressKey: cmdPressKey,
  screenshot: cmdScreenshot,
  secrets: cmdSecrets,
  ping: async () => ({ ok: true, pid: process.pid }),
  close: async () => { setTimeout(() => shutdown(0), 10); return { ok: true } },
}

async function handle(msg) {
  const { id, cmd, args } = msg
  const fn = HANDLERS[cmd]
  if (!fn) return send({ id, ok: false, error: `Commande inconnue : ${cmd}` })
  if (cmd !== 'init' && cmd !== 'ping' && cmd !== 'close' && !state.page) return send({ id, ok: false, error: 'Navigateur non initialisé.' })
  try {
    const result = await fn(args || {})
    send({ id, ok: true, result })
  } catch (e) {
    send({ id, ok: false, error: shortError(e) })
  }
}

async function shutdown(code) {
  if (state.closing) return
  state.closing = true
  state.recording = false
  if (state.shot.timer) clearInterval(state.shot.timer)
  const t = setTimeout(() => process.exit(code), 5000)
  try { if (state.browser) await state.browser.close() } catch { /* ignoré */ }
  clearTimeout(t)
  emit('exit', { code })
  process.exit(code)
}

const rl = readline.createInterface({ input: process.stdin })
rl.on('line', (line) => {
  if (!line.trim()) return
  let msg
  try { msg = JSON.parse(line) } catch { return log('Message illisible reçu par le moteur.', 'warn') }
  handle(msg)
})
// Parent disparu : stdin fermé
process.stdin.on('end', () => shutdown(0))
process.stdin.on('close', () => shutdown(0))
// Ceinture et bretelles : PID parent absent
const parentPid = Number(process.env.WQA_PARENT_PID) || process.ppid
setInterval(() => {
  try { process.kill(parentPid, 0) } catch { shutdown(0) }
}, 2000).unref()
process.on('uncaughtException', (e) => log(`Erreur interne du moteur : ${shortError(e)}`, 'error'))
process.on('unhandledRejection', (e) => log(`Erreur interne du moteur : ${shortError(e)}`, 'error'))

function withTimeout(promise, ms) {
  let t
  return Promise.race([
    promise.finally(() => clearTimeout(t)),
    new Promise((_, reject) => { t = setTimeout(() => reject(new Error('délai dépassé')), ms) }),
  ])
}

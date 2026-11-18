/*
 * Script injecté dans les pages explorées (addInitScript) par le moteur Wizard QA.
 *  - window.__wqa.snapshot() : éléments interactifs visibles + description pour les sélecteurs ;
 *  - window.__wqa.describe(el) : rôle, nom accessible, libellé, texte, data-testid, CSS court et
 *    estimation d'unicité de chaque stratégie (vérifiée ensuite par Playwright) ;
 *  - enregistreur : capture clic, saisie, choix, cases, touches Entrée/Tab/Échap, soumission,
 *    et les transmet au moteur via la liaison window.__wqaEmit (les valeurs des champs mot de passe
 *    sont remplacées par un marqueur côté moteur, jamais renvoyées telles quelles).
 * Les éléments de l'interface de l'enregistreur portent data-wqa-ui et sont ignorés.
 * Le contenu de la page est une donnée : ce script ne lit aucune consigne dans la page.
 */
;(function () {
  'use strict'
  if (window.__wqa) return
  if (window.top !== window) return

  const MAX_ELEMENTS = 150
  const MAX_TEXT = 80
  const UI_ATTR = 'data-wqa-ui'
  const REF_ATTR = 'data-wqa-ref'
  let refSeq = 0
  let seq = 0

  const INTERACTIVE = [
    'a[href]', 'button', 'input:not([type="hidden"])', 'select', 'textarea', 'summary',
    '[role="button"]', '[role="link"]', '[role="tab"]', '[role="menuitem"]', '[role="menuitemcheckbox"]',
    '[role="menuitemradio"]', '[role="checkbox"]', '[role="radio"]', '[role="switch"]', '[role="option"]',
    '[role="combobox"]', '[role="textbox"]', '[role="searchbox"]', '[role="treeitem"]', '[role="slider"]',
    '[onclick]', '[data-testid]', '[contenteditable=""]', '[contenteditable="true"]', '[tabindex]:not([tabindex="-1"])',
  ].join(',')
  // Contenus utiles aux vérifications (titres, messages)
  const CONTENT = 'h1, h2, h3, [role="alert"], [role="status"], [aria-live]:not([aria-live="off"]), [role="dialog"], dialog[open]'

  const NAME_FROM_CONTENT = new Set(['button', 'link', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option',
    'heading', 'cell', 'gridcell', 'columnheader', 'rowheader', 'checkbox', 'radio', 'switch', 'treeitem', 'tooltip', 'row'])
  const NAMED_ROLES = new Set(['button', 'link', 'textbox', 'searchbox', 'checkbox', 'radio', 'combobox', 'listbox', 'option',
    'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'switch', 'spinbutton', 'slider', 'heading', 'treeitem', 'row',
    'cell', 'gridcell', 'columnheader', 'dialog', 'alert', 'status', 'img', 'navigation', 'region'])

  function norm(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim()
  }
  function trunc(s, n) {
    const t = norm(s)
    return t.length > n ? t.slice(0, n - 1) + '…' : t
  }
  function isUi(el) {
    return !!(el && el.closest && el.closest('[' + UI_ATTR + ']'))
  }

  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false
    if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false
    const r = el.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) {
      // case à cocher stylée : l'input peut être minuscule mais son libellé visible
      return false
    }
    const st = getComputedStyle(el)
    return st.visibility !== 'hidden' && st.display !== 'none'
  }
  function isAriaHidden(el) {
    return !!(el.closest && el.closest('[aria-hidden="true"]'))
  }

  function roleOf(el) {
    const explicit = norm(el.getAttribute('role')).split(' ')[0]
    if (explicit && explicit !== 'presentation' && explicit !== 'none') return explicit
    const tag = el.tagName.toLowerCase()
    const type = (el.getAttribute('type') || '').toLowerCase()
    switch (tag) {
      case 'a': return el.hasAttribute('href') ? 'link' : ''
      case 'button': return 'button'
      case 'input':
        if (['button', 'submit', 'reset', 'image'].includes(type)) return 'button'
        if (type === 'checkbox') return 'checkbox'
        if (type === 'radio') return 'radio'
        if (type === 'range') return 'slider'
        if (type === 'number') return 'spinbutton'
        if (type === 'search') return el.hasAttribute('list') ? 'combobox' : 'searchbox'
        if (['', 'text', 'email', 'tel', 'url', 'password'].includes(type)) return el.hasAttribute('list') ? 'combobox' : 'textbox'
        return ''
      case 'select': return el.multiple || Number(el.getAttribute('size')) > 1 ? 'listbox' : 'combobox'
      case 'textarea': return 'textbox'
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': return 'heading'
      case 'img': return el.getAttribute('alt') === '' ? '' : 'img'
      case 'option': return 'option'
      case 'tr': return 'row'
      case 'td': return 'cell'
      case 'th': return 'columnheader'
      case 'nav': return 'navigation'
      case 'dialog': return 'dialog'
      case 'table': return 'table'
      case 'ul': case 'ol': return 'list'
      case 'li': return 'listitem'
      case 'summary': return 'button'
      default: return ''
    }
  }

  function textOf(node, depth) {
    if (depth > 8) return ''
    let out = ''
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        out += child.nodeValue
      } else if (child.nodeType === 1) {
        const c = child
        if (isUi(c)) continue
        const tag = c.tagName.toLowerCase()
        if (tag === 'script' || tag === 'style' || tag === 'template') continue
        if (c.getAttribute('aria-hidden') === 'true') continue
        const st = getComputedStyle(c)
        if (st.display === 'none' || st.visibility === 'hidden') continue
        const al = c.getAttribute('aria-label')
        if (al && norm(al)) { out += ' ' + al + ' '; continue }
        if (tag === 'img') { out += ' ' + (c.getAttribute('alt') || '') + ' '; continue }
        const block = st.display !== 'inline'
        out += (block ? ' ' : '') + textOf(c, depth + 1) + (block ? ' ' : '')
      }
    }
    return out
  }

  function labelsText(el) {
    const parts = []
    const lb = el.getAttribute('aria-labelledby')
    if (lb) {
      for (const id of lb.split(/\s+/)) {
        const t = document.getElementById(id)
        if (t) parts.push(norm(textOf(t, 0)))
      }
      if (parts.filter(Boolean).length) return norm(parts.join(' '))
    }
    if (el.labels && el.labels.length) {
      for (const l of el.labels) parts.push(norm(textOf(l, 0)))
      return norm(parts.join(' '))
    }
    return ''
  }

  function nameOf(el, role) {
    const lb = el.getAttribute('aria-labelledby')
    if (lb) {
      const t = lb.split(/\s+/).map((id) => document.getElementById(id)).filter(Boolean).map((n) => norm(textOf(n, 0))).join(' ')
      if (norm(t)) return norm(t)
    }
    const al = norm(el.getAttribute('aria-label'))
    if (al) return al
    const tag = el.tagName.toLowerCase()
    const type = (el.getAttribute('type') || '').toLowerCase()
    if (tag === 'input' && ['button', 'submit', 'reset'].includes(type)) {
      return norm(el.value || el.getAttribute('value') || (type === 'submit' ? 'Submit' : type === 'reset' ? 'Reset' : ''))
    }
    if (tag === 'input' && type === 'image') return norm(el.getAttribute('alt') || el.getAttribute('title'))
    if (tag === 'img') return norm(el.getAttribute('alt') || el.getAttribute('title'))
    if (['input', 'select', 'textarea'].includes(tag)) {
      const l = labelsText(el)
      if (l) return l
      return norm(el.getAttribute('title') || el.getAttribute('placeholder'))
    }
    if (NAME_FROM_CONTENT.has(role)) {
      const t = norm(textOf(el, 0))
      if (t) return t
    }
    if (tag === 'table') {
      const cap = el.querySelector('caption')
      if (cap) return norm(textOf(cap, 0))
    }
    if (tag === 'fieldset') {
      const lg = el.querySelector('legend')
      if (lg) return norm(textOf(lg, 0))
    }
    return norm(el.getAttribute('title'))
  }

  function labelOf(el) {
    const t = labelsText(el)
    if (t) return t
    return norm(el.getAttribute('aria-label'))
  }

  function ownText(el) {
    const tag = el.tagName.toLowerCase()
    if (['input', 'select', 'textarea'].includes(tag)) return ''
    return norm(textOf(el, 0))
  }

  function cssEscape(s) {
    return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/[^\w-]/g, '\\$&')
  }
  function qsaCount(sel) {
    try { return document.querySelectorAll(sel).length } catch (e) { return 0 }
  }
  function looksGenerated(id) {
    return /\d{3,}|^[a-f0-9-]{16,}$|^(ember|react|ng|mui|radix|headlessui)[-_:]/i.test(id) || id.includes(':')
  }
  const STATE_CLASS = /^(is-|has-|active$|selected$|open$|focus|hover|disabled$|ng-|css-|sc-|jsx-)/
  function shortCss(el) {
    const tag = el.tagName.toLowerCase()
    if (el.id && /^[A-Za-z][\w-]*$/.test(el.id) && !looksGenerated(el.id)) {
      const s = '#' + cssEscape(el.id)
      if (qsaCount(s) === 1) return s
    }
    const nameAttr = el.getAttribute('name')
    if (nameAttr && ['input', 'select', 'textarea', 'button'].includes(tag)) {
      const s = tag + '[name="' + nameAttr.replace(/"/g, '\\"') + '"]'
      if (qsaCount(s) === 1) return s
    }
    const classes = Array.from(el.classList || []).filter((c) => !STATE_CLASS.test(c) && /^[A-Za-z][\w-]*$/.test(c)).slice(0, 2)
    let base = tag + classes.map((c) => '.' + cssEscape(c)).join('')
    if (tag === 'input' && el.getAttribute('type')) base += '[type="' + el.getAttribute('type') + '"]'
    if (qsaCount(base) === 1) return base
    // ancre : parent identifié
    let p = el.parentElement
    for (let i = 0; p && i < 4; i++, p = p.parentElement) {
      if (p.id && /^[A-Za-z][\w-]*$/.test(p.id) && !looksGenerated(p.id)) {
        const s = '#' + cssEscape(p.id) + ' ' + base
        if (qsaCount(s) === 1) return s
        break
      }
    }
    // dernier recours : position parmi les frères
    const parent = el.parentElement
    if (parent) {
      const same = Array.from(parent.children).filter((c) => c.tagName === el.tagName)
      const idx = same.indexOf(el) + 1
      const pTag = parent.tagName.toLowerCase()
      const pId = parent.id && /^[A-Za-z][\w-]*$/.test(parent.id) && !looksGenerated(parent.id) ? '#' + cssEscape(parent.id) : pTag
      return pId + ' > ' + tag + ':nth-of-type(' + idx + ')'
    }
    return base
  }

  // Index des rôles de la page (reconstruit à chaque appel public, mis en cache le temps de l'appel)
  let roleIndex = null
  function buildRoleIndex() {
    const list = []
    const all = document.querySelectorAll('*')
    const max = Math.min(all.length, 6000)
    for (let i = 0; i < max; i++) {
      const el = all[i]
      if (isUi(el)) continue
      const role = roleOf(el)
      if (!role || !NAMED_ROLES.has(role)) continue
      list.push({ el, role, name: null })
    }
    return list
  }
  function roleCounts(role, name) {
    if (!roleIndex) roleIndex = buildRoleIndex()
    let sub = 0
    let exact = 0
    const lower = name.toLowerCase()
    for (const it of roleIndex) {
      if (it.role !== role) continue
      if (it.visible == null) it.visible = isVisible(it.el) && !isAriaHidden(it.el)
      if (!it.visible) continue
      if (it.name == null) it.name = nameOf(it.el, it.role)
      if (it.name === name) exact++
      if (it.name.toLowerCase().includes(lower)) sub++
    }
    return { sub, exact }
  }
  function labelCounts(label) {
    let sub = 0
    let exact = 0
    const lower = label.toLowerCase()
    for (const el of document.querySelectorAll('input, select, textarea, [aria-label], [aria-labelledby]')) {
      if (isUi(el)) continue
      const l = labelOf(el)
      if (!l) continue
      if (l === label) exact++
      if (l.toLowerCase().includes(lower)) sub++
    }
    return { sub, exact }
  }
  function placeholderCount(ph) {
    let n = 0
    const lower = ph.toLowerCase()
    for (const el of document.querySelectorAll('[placeholder]')) {
      if ((el.getAttribute('placeholder') || '').toLowerCase().includes(lower)) n++
    }
    return n
  }
  function textCount(text) {
    // éléments « les plus profonds » dont le texte normalisé est exactement `text`
    let n = 0
    const all = document.body ? document.body.querySelectorAll('*') : []
    const max = Math.min(all.length, 6000)
    for (let i = 0; i < max; i++) {
      const el = all[i]
      if (isUi(el)) continue
      const tag = el.tagName.toLowerCase()
      if (tag === 'script' || tag === 'style') continue
      if (norm(el.textContent) !== text) continue
      let deeper = false
      for (const c of el.children) { if (norm(c.textContent) === text) { deeper = true; break } }
      if (!deeper && isVisible(el)) n++
    }
    return n
  }

  function describe(el, opts) {
    const fast = opts && opts.fast
    const tag = el.tagName.toLowerCase()
    const type = tag === 'input' ? (el.getAttribute('type') || 'text').toLowerCase() : (el.getAttribute('type') || '')
    const role = roleOf(el)
    const name = trunc(nameOf(el, role), 120)
    const label = trunc(labelOf(el), 120)
    const placeholder = trunc(el.getAttribute('placeholder'), 120)
    const text = trunc(ownText(el), 120)
    const testid = el.getAttribute('data-testid') || ''
    const css = shortCss(el)
    const counts = {}
    if (testid) counts.testid = qsaCount('[data-testid="' + testid.replace(/"/g, '\\"') + '"]')
    if (role && name && name.length <= MAX_TEXT && !fast) {
      const c = roleCounts(role, name)
      counts.role = c.sub
      counts.roleExact = c.exact
    }
    if (label && label.length <= MAX_TEXT && !fast) {
      const c = labelCounts(label)
      counts.label = c.sub
      counts.labelExact = c.exact
    }
    if (placeholder) counts.placeholder = placeholderCount(placeholder)
    if (text && text.length <= 60 && !fast) counts.textExact = textCount(text)
    counts.css = qsaCount(css)
    return { tag, type, role, name, label, placeholder, text, testid, css, counts }
  }

  function ensureRef(el) {
    let r = el.getAttribute(REF_ATTR)
    if (!r) {
      refSeq++
      r = 'e' + refSeq
      // éviter les collisions après navigation SPA
      while (document.querySelector('[' + REF_ATTR + '="' + r + '"]')) { refSeq++; r = 'e' + refSeq }
      el.setAttribute(REF_ATTR, r)
    }
    return r
  }

  function snapshot(options) {
    roleIndex = null
    const limit = (options && options.limit) || MAX_ELEMENTS
    const seen = new Set()
    const nodes = []
    const push = (el, kind) => {
      if (seen.has(el) || isUi(el)) return
      seen.add(el)
      nodes.push({ el, kind })
    }
    for (const el of document.querySelectorAll(INTERACTIVE)) push(el, 'interactive')
    for (const el of document.querySelectorAll(CONTENT)) push(el, 'content')
    // ordre du document
    nodes.sort((a, b) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
    const vw = window.innerWidth
    const vh = window.innerHeight
    const elements = []
    let skipped = 0
    for (const { el, kind } of nodes) {
      let visible = isVisible(el) && !isAriaHidden(el)
      // case à cocher / bouton radio masqués derrière un libellé stylé
      if (!visible && el.tagName === 'INPUT' && ['checkbox', 'radio'].includes(el.type) && el.labels && el.labels[0] && isVisible(el.labels[0])) visible = true
      if (!visible) continue
      if (elements.length >= limit) { skipped++; continue }
      const r = el.getBoundingClientRect()
      // unicité vérifiée ensuite par Playwright (count()), inutile de l'estimer ici
      const d = describe(el, { fast: true })
      const tag = d.tag
      const isPassword = tag === 'input' && d.type === 'password'
      const item = {
        ref: ensureRef(el),
        kind,
        role: d.role,
        name: trunc(d.name, MAX_TEXT),
        tag,
        type: d.type,
        text: trunc(d.text, MAX_TEXT),
        label: trunc(d.label, MAX_TEXT),
        placeholder: trunc(d.placeholder, MAX_TEXT),
        testid: d.testid,
        visible: true,
        enabled: !(el.disabled || el.getAttribute('aria-disabled') === 'true'),
        inViewport: r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw,
        box: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
        desc: d,
      }
      if (tag === 'input' && ['checkbox', 'radio'].includes(d.type)) item.checked = !!el.checked
      else if (['input', 'textarea'].includes(tag) && !isPassword) item.value = trunc(el.value, MAX_TEXT)
      else if (isPassword) item.filled = !!el.value
      if (tag === 'select') {
        item.value = trunc(el.selectedOptions && el.selectedOptions[0] ? el.selectedOptions[0].textContent : '', MAX_TEXT)
        item.options = Array.from(el.options).slice(0, 30).map((o) => trunc(o.textContent, 60))
      }
      if (el.getAttribute('aria-expanded')) item.expanded = el.getAttribute('aria-expanded') === 'true'
      elements.push(item)
    }
    roleIndex = null
    const bodyText = document.body ? trunc(document.body.innerText, 3000) : ''
    // lignes visibles (titres, légendes, en-têtes de tableau, messages) : vérifications de l'explorateur heuristique
    const lines = []
    if (document.body) {
      for (const l of String(document.body.innerText || '').split(/\n+/)) {
        const t = norm(l)
        if (t && t.length <= 160 && lines.indexOf(t) < 0) lines.push(t)
        if (lines.length >= 200) break
      }
    }
    return {
      url: location.href,
      title: document.title,
      viewport: { w: vw, h: vh },
      scroll: { x: Math.round(window.scrollX), y: Math.round(window.scrollY) },
      elements,
      truncated: skipped,
      text: bodyText,
      lines,
    }
  }

  function describeForEvent(el) {
    roleIndex = null
    const d = describe(el)
    roleIndex = null
    return d
  }

  // ---------- Enregistreur ----------
  function emit(payload) {
    try {
      if (typeof window.__wqaEmit !== 'function') return
      seq++
      payload.seq = seq
      payload.at = Date.now()
      payload.url = location.href
      window.__wqaEmit(payload)
    } catch (e) { /* liaison indisponible */ }
  }
  const ACTIONABLE = 'a, button, input, select, textarea, label, summary, [role], [onclick], [data-testid], [contenteditable=""], [contenteditable="true"]'
  function actionable(target) {
    if (!target || target.nodeType !== 1) target = target && target.parentElement
    if (!target) return null
    const el = target.closest(ACTIONABLE)
    if (!el) return target
    // un libellé qui enveloppe un champ : on vise le champ
    if (el.tagName === 'LABEL' && el.control) return el.control
    return el
  }

  // Dernière touche enregistrée : un clic « clavier » (detail 0) qui la suit est déjà couvert par la touche
  // (soumission implicite par Entrée, bouton activé par Entrée ou Espace) et n'est pas enregistré.
  let lastKey = null
  document.addEventListener('click', (e) => {
    if (!e.isTrusted || e.button !== 0) return
    if (e.detail === 0 && lastKey && Date.now() - lastKey.at < 1000) return
    const el = actionable(e.target)
    if (!el || isUi(el)) return
    emit({ kind: 'click', desc: describeForEvent(el), tag: el.tagName.toLowerCase(), inputType: el.type || '' })
  }, true)

  document.addEventListener('input', (e) => {
    const el = e.target
    if (!el || el.nodeType !== 1 || isUi(el)) return
    const tag = el.tagName.toLowerCase()
    const type = (el.type || '').toLowerCase()
    if (tag === 'select' || ['checkbox', 'radio', 'file', 'range', 'color'].includes(type)) return
    const editable = el.isContentEditable
    if (!(tag === 'input' || tag === 'textarea' || editable)) return
    emit({
      kind: 'fill',
      desc: describeForEvent(el),
      value: editable ? el.innerText : el.value,
      isPassword: type === 'password',
    })
  }, true)

  document.addEventListener('change', (e) => {
    const el = e.target
    if (!el || el.nodeType !== 1 || isUi(el)) return
    const tag = el.tagName.toLowerCase()
    const type = (el.type || '').toLowerCase()
    if (tag === 'select') {
      const opt = el.selectedOptions && el.selectedOptions[0]
      emit({ kind: 'select', desc: describeForEvent(el), value: opt ? norm(opt.textContent) : el.value, optionValue: el.value })
    } else if (type === 'checkbox' || type === 'radio') {
      emit({ kind: el.checked ? 'check' : 'uncheck', desc: describeForEvent(el) })
    }
  }, true)

  document.addEventListener('keydown', (e) => {
    const el = e.target && e.target.nodeType === 1 ? e.target : document.activeElement
    // Espace n'est enregistrée que sur un bouton ou un lien (ailleurs, c'est une saisie ou une case gérée par « change »)
    const buttonLike = el && el.matches && el.matches('button, a[href], [role="button"], [role="link"], [role="tab"], [role="menuitem"], input[type="button"], input[type="submit"]')
    if (!['Enter', 'Tab', 'Escape'].includes(e.key) && !(e.key === ' ' && buttonLike)) return
    if (el && isUi(el)) return
    if (e.key === 'Enter' || e.key === ' ') lastKey = { key: e.key, at: Date.now() }
    const target = el && el !== document.body ? el : null
    emit({ kind: 'press', key: e.key, desc: target ? describeForEvent(target) : null })
  }, true)

  document.addEventListener('submit', (e) => {
    const el = e.target
    if (!el || isUi(el)) return
    emit({ kind: 'submit', desc: describeForEvent(el) })
  }, true)

  // Badge « Enregistrement en cours » (interface de l'enregistreur, ignorée par la capture)
  function setBadge(on) {
    let b = document.getElementById('__wqa-badge')
    if (!on) { if (b) b.remove(); return }
    if (b || !document.body) return
    b = document.createElement('div')
    b.id = '__wqa-badge'
    b.setAttribute(UI_ATTR, '1')
    b.setAttribute('aria-hidden', 'true')
    b.textContent = '● Enregistrement Wizard QA'
    b.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:2147483647;pointer-events:none;background:#B42318;' +
      'color:#fff;font:600 12px/1.2 system-ui,sans-serif;padding:4px 8px;border-radius:10px;opacity:.85'
    document.body.appendChild(b)
  }
  function initBadge() {
    try {
      if (typeof window.__wqaState === 'function') {
        Promise.resolve(window.__wqaState()).then((on) => setBadge(!!on)).catch(() => {})
      }
    } catch (e) { /* ignoré */ }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initBadge)
  else initBadge()

  Object.defineProperty(window, '__wqa', {
    value: Object.freeze({ snapshot, describe: describeForEvent, ensureRef, setBadge }),
    enumerable: false,
    configurable: false,
    writable: false,
  })
})()

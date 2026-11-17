/*
 * PRISME — utilitaires d'interface partagés par toutes les pages (window.Prisme).
 * Chargé dans <head> par le serveur, avant les scripts de page.
 *
 *   Prisme.api('/api/jira/stories')                 → JSON (erreur levée si !ok ; 401 → page de connexion)
 *   Prisme.h('div', { class: 'p-card' }, 'texte')   → construit un élément DOM
 *   Prisme.icon('download')                          → <svg> du jeu d'icônes
 *   Prisme.toast('Enregistré'), Prisme.confirm('Supprimer ?'), Prisme.modal({...})
 *   Prisme.tabs(...), Prisme.stepper(...), Prisme.badge(...), Prisme.kpi(...), Prisme.empty(...)
 */
;(function () {
  'use strict'

  document.documentElement.classList.add('p-on')

  // Icônes : tracés 24×24, trait (style Lucide).
  const ICONS = {
    gauge: '<path d="M12 14l4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
    compass: '<circle cx="12" cy="12" r="10"/><path d="m16.24 7.76-2.12 6.36-6.36 2.12 2.12-6.36 6.36-2.12z"/>',
    listChecks: '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
    activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    gitBranch: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="6" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/><path d="M6 9v6"/>',
    fileText: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v5h5"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/>',
    sparkles: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    settings: '<path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M1 14h6"/><path d="M9 8h6"/><path d="M17 16h6"/>',
    book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
    help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
    chevronRight: '<path d="m9 18 6-6-6-6"/>',
    chevronDown: '<path d="m6 9 6 6 6-6"/>',
    arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    checkCircle: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4 12 14.01l-3-3"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    xCircle: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    play: '<path d="m6 3 14 9-14 9V3z"/>',
    stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/>',
    filter: '<path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/>',
    terminal: '<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>',
    package: '<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
    server: '<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><path d="M6 6h.01"/><path d="M6 18h.01"/>',
    key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><path d="m2 2 20 20"/>',
    flask: '<path d="M9 3h6"/><path d="M10 9V3"/><path d="M14 9V3"/><path d="M10 9 4.5 18.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9"/><path d="M7 15h10"/>',
    bot: '<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M12 8V4"/><circle cx="12" cy="3" r="1"/><path d="M8 14h.01"/><path d="M16 14h.01"/><path d="M9 18h6"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    layers: '<path d="m12 2 10 5-10 5L2 7Z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
    zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
    target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    barChart: '<path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-4"/>',
    wand: '<path d="m15 4-1 1"/><path d="m21 10-1 1"/><path d="M18 4v2"/><path d="M20 7h-2"/><path d="m3 21 12-12"/><path d="m14 4 6 6"/>',
    folder: '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
    menu: '<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>',
  }

  function icon(name, size) {
    const ns = 'http://www.w3.org/2000/svg'
    const svg = document.createElementNS(ns, 'svg')
    svg.setAttribute('viewBox', '0 0 24 24')
    svg.setAttribute('fill', 'none')
    svg.setAttribute('stroke', 'currentColor')
    svg.setAttribute('stroke-width', '1.8')
    svg.setAttribute('stroke-linecap', 'round')
    svg.setAttribute('stroke-linejoin', 'round')
    svg.setAttribute('aria-hidden', 'true')
    // Taille par défaut en attribut : les règles CSS des composants la remplacent, mais une icône
    // placée dans un conteneur sans style ne s'étire plus sur toute la largeur.
    svg.setAttribute('width', size || 16)
    svg.setAttribute('height', size || 16)
    svg.innerHTML = ICONS[name] || ICONS.info
    return svg
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  }

  /**
   * h('button', { class: 'p-btn', onclick: fn, dataset: { id: 1 } }, 'Libellé', otherNode)
   * Les enfants null/false sont ignorés ; les tableaux sont aplatis ; les chaînes deviennent du texte.
   */
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag)
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue
      if (k === 'class' || k === 'className') el.className = v
      else if (k === 'dataset') Object.assign(el.dataset, v)
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v)
      else if (k === 'html') el.innerHTML = v
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v)
      else if (v === true) el.setAttribute(k, '')
      else el.setAttribute(k, v)
    }
    append(el, children)
    return el
  }

  function append(el, children) {
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false) continue
      el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)))
    }
    return el
  }

  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild)
    return el
  }

  const apiBase = () => String(window.__WIZARD_API_BASE__ || '').replace(/\/$/, '')

  function goLogin() {
    if (location.pathname === '/login.html') return
    location.href = `/login.html?next=${encodeURIComponent(location.pathname + location.search)}`
  }

  /** Appel JSON. Lève une Error (avec .status et .data) si le statut HTTP n'est pas 2xx ou si ok === false. */
  async function api(path, opts = {}) {
    const init = { method: opts.method || (opts.body !== undefined ? 'POST' : 'GET'), headers: {}, credentials: 'same-origin', signal: opts.signal }
    if (opts.body !== undefined) {
      init.headers['Content-Type'] = 'application/json'
      init.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)
    }
    const res = await fetch(apiBase() + path, init)
    if (res.status === 401 && !opts.allow401) {
      goLogin()
      throw Object.assign(new Error('Session expirée'), { status: 401 })
    }
    const type = res.headers.get('content-type') || ''
    const data = type.includes('json') ? await res.json().catch(() => ({})) : await res.text()
    if (!res.ok || (data && typeof data === 'object' && data.ok === false)) {
      const msg = (data && (data.error || data.message)) || `Erreur ${res.status}`
      throw Object.assign(new Error(msg), { status: res.status, data })
    }
    return data
  }

  /**
   * Flux SSE : Prisme.stream('/api/install/runs/123/events', { step: fn, log: fn, done: fn }, onError)
   * Renvoie l'EventSource (appeler .close()).
   */
  function stream(path, handlers, onError) {
    const es = new EventSource(apiBase() + path, { withCredentials: true })
    for (const [event, fn] of Object.entries(handlers || {})) {
      es.addEventListener(event, (e) => {
        let data = null
        try { data = JSON.parse(e.data) } catch { data = e.data }
        fn(data, e)
      })
    }
    es.onerror = (e) => { if (onError) onError(e, es) }
    return es
  }

  let toastHost = null
  function toast(message, kind = 'ok', ms = 4200) {
    if (!toastHost) {
      toastHost = h('div', { class: 'p-toasts', role: 'status', 'aria-live': 'polite' })
      document.body.appendChild(toastHost)
    }
    const name = kind === 'error' ? 'xCircle' : kind === 'warn' ? 'alert' : 'checkCircle'
    const el = h('div', { class: `p-toast ${kind}` }, icon(name), h('div', null, message))
    toastHost.appendChild(el)
    setTimeout(() => el.remove(), ms)
    return el
  }

  /**
   * Modale. actions : [{ label, kind: 'primary'|'danger'|'ghost', onClick(close) → false pour garder ouvert }]
   * Renvoie { close, root, body }.
   */
  function modal({ title, body, actions = [], wide = false, onClose } = {}) {
    const close = () => {
      overlay.remove()
      document.removeEventListener('keydown', onKey)
      if (onClose) onClose()
    }
    const onKey = (e) => { if (e.key === 'Escape') close() }
    const bodyEl = h('div', { class: 'p-modal-body' }, body)
    const foot = actions.length
      ? h('div', { class: 'p-modal-foot' }, actions.map((a) => h('button', {
        class: `p-btn ${a.kind ? `p-btn--${a.kind}` : ''}`,
        type: 'button',
        onclick: async (e) => {
          const keep = a.onClick ? await a.onClick(close, e) : undefined
          if (keep !== false) close()
        },
      }, a.icon ? icon(a.icon) : null, a.label)))
      : null
    const box = h('div', { class: `p-modal ${wide ? 'p-modal--wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title || '' },
      h('div', { class: 'p-modal-head' }, h('h2', null, title || ''), h('button', { class: 'p-icon-btn', type: 'button', 'aria-label': 'Fermer', onclick: close }, icon('x'))),
      bodyEl,
      foot)
    const overlay = h('div', { class: 'p-overlay', onmousedown: (e) => { if (e.target === overlay) close() } }, box)
    document.body.appendChild(overlay)
    document.addEventListener('keydown', onKey)
    const focusable = box.querySelector('input, textarea, select, .p-btn--primary')
    if (focusable) setTimeout(() => focusable.focus(), 30)
    return { close, root: box, body: bodyEl }
  }

  function confirmDialog(message, { title = 'Confirmer', okLabel = 'Confirmer', danger = false } = {}) {
    return new Promise((resolve) => {
      let answered = false
      modal({
        title,
        body: h('p', { style: { margin: 0 } }, message),
        actions: [
          { label: 'Annuler', kind: 'ghost', onClick: () => { answered = true; resolve(false) } },
          { label: okLabel, kind: danger ? 'danger-solid' : 'primary', onClick: () => { answered = true; resolve(true) } },
        ],
        onClose: () => { if (!answered) resolve(false) },
      })
    })
  }

  /**
   * Onglets : tabs(container, [{ id, label, count, tone }], activeId, onChange)
   * Renvoie { set(activeId), update(items) }.
   */
  function tabs(container, items, active, onChange) {
    let current = active
    let list = items
    function render() {
      clear(container)
      container.classList.add('p-tabs')
      container.setAttribute('role', 'tablist')
      for (const it of list) {
        container.appendChild(h('button', {
          class: `p-tab ${it.id === current ? 'active' : ''}`,
          type: 'button',
          role: 'tab',
          'aria-selected': it.id === current ? 'true' : 'false',
          onclick: () => { current = it.id; render(); onChange && onChange(it.id) },
        }, it.icon ? icon(it.icon, 15) : null, it.label, it.count != null ? h('span', { class: `p-tab-count ${it.tone || ''}` }, String(it.count)) : null))
      }
    }
    render()
    return { set(id) { current = id; render() }, update(next) { list = next; render() }, get: () => current }
  }

  /** Stepper : stepper([{ label, sub, state: 'done'|'current'|'todo'|'failed'|'running'|'skipped', onClick }]) */
  function stepper(steps) {
    const root = h('div', { class: 'p-stepper' })
    steps.forEach((s, i) => {
      if (i > 0) root.appendChild(h('div', { class: `p-step-line ${steps[i - 1].state === 'done' ? 'done' : ''}` }))
      const dot = h('span', { class: 'p-step-dot' }, s.state === 'done' ? icon('check') : s.state === 'failed' ? '!' : String(i + 1))
      root.appendChild(h(s.onClick ? 'button' : 'div', {
        class: `p-step ${s.state || 'todo'}`,
        type: s.onClick ? 'button' : null,
        onclick: s.onClick || null,
      }, dot, h('span', null, h('div', { class: 'p-step-label' }, s.label), s.sub ? h('div', { class: 'p-step-sub' }, s.sub) : null)))
    })
    return root
  }

  const badge = (text, tone = '', title) => h('span', { class: `p-badge ${tone}`, title }, text)
  const dot = (tone = '') => h('span', { class: `p-dot ${tone}` })
  const status = (text, tone = '') => h('span', { class: `p-status ${tone}` }, dot(tone), text)

  function kpi({ label, value, unit, detail, tone = '', href }) {
    return h(href ? 'a' : 'div', { class: `p-kpi ${tone}`, href },
      h('div', { class: 'p-kpi-label' }, label),
      h('div', { class: 'p-kpi-value' }, value ?? '—', unit ? h('small', null, unit) : null),
      detail ? h('div', { class: 'p-kpi-detail' }, detail) : null)
  }

  function card({ title, sub, icon: iconName, tone, actions, body, flush = false, className = '' }) {
    const head = title ? h('div', { class: 'p-card-head' },
      iconName ? h('span', { class: `p-tile ${tone || ''}` }, icon(iconName)) : null,
      h('div', { class: 'p-card-title' }, h('div', null, h('div', null, title), sub ? h('div', { class: 'p-card-sub' }, sub) : null)),
      actions || null) : null
    return h('section', { class: `p-card ${className}` }, head, h('div', { class: flush ? 'p-card-body p-card-body--flush' : 'p-card-body' }, body))
  }

  function empty(title, text, iconName = 'layers', action) {
    return h('div', { class: 'p-empty' }, icon(iconName), h('div', { class: 'p-empty-title' }, title), text ? h('div', null, text) : null, action || null)
  }

  function banner(kind, content, iconName) {
    const map = { info: 'info', warn: 'alert', error: 'xCircle', blue: 'info' }
    return h('div', { class: `p-banner p-banner--${kind}` }, icon(iconName || map[kind] || 'info'), h('div', null, content))
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const ta = h('textarea', { style: { position: 'fixed', opacity: 0 } })
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
    }
    toast('Copié dans le presse-papiers')
  }

  /** Met un bouton en attente pendant une promesse. */
  async function busy(button, fn) {
    if (button) {
      button.classList.add('is-busy')
      button.disabled = true
    }
    try {
      return await fn()
    } finally {
      if (button) {
        button.classList.remove('is-busy')
        button.disabled = false
      }
    }
  }

  function fmtDate(value) {
    if (!value) return '—'
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return String(value)
    return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  function fmtAgo(value) {
    if (!value) return '—'
    const s = Math.round((Date.now() - new Date(value).getTime()) / 1000)
    if (s < 60) return `il y a ${Math.max(s, 1)} s`
    if (s < 3600) return `il y a ${Math.round(s / 60)} min`
    if (s < 86400) return `il y a ${Math.round(s / 3600)} h`
    return `il y a ${Math.round(s / 86400)} j`
  }

  function fmtDuration(ms) {
    if (ms == null) return '—'
    if (ms < 1000) return `${Math.round(ms)} ms`
    const s = ms / 1000
    if (s < 60) return `${s.toFixed(1)} s`
    return `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`
  }

  /** Coloration Gherkin (FR et EN) → HTML sûr. */
  function gherkinHtml(text) {
    const kw = /^(\s*)(Fonctionnalité|Feature|Contexte|Background|Scénario|Scenario|Plan du scénario|Plan du Scénario|Scenario Outline|Exemples|Examples|Règle|Rule|Étant donné que|Étant donné qu'|Étant donné|Etant donné|Soit|Sachant que|Quand|Lorsque|Lorsqu'|Alors|Et que|Et qu'|Et|Mais que|Mais|Given|When|Then|And|But)(\b|:|\s)/
    return String(text || '').split(/\r?\n/).map((line) => {
      if (/^\s*#/.test(line)) return `<span class="cmt">${esc(line)}</span>`
      if (/^\s*@/.test(line)) return `<span class="tag">${esc(line)}</span>`
      if (/^\s*\|/.test(line)) return `<span class="tbl">${esc(line)}</span>`
      const m = line.match(kw)
      let out = m ? `${esc(m[1])}<span class="kw">${esc(m[2])}</span>${esc(line.slice(m[1].length + m[2].length))}` : esc(line)
      out = out.replace(/&quot;([^&]*?)&quot;/g, '<span class="str">&quot;$1&quot;</span>')
      return out
    }).join('\n')
  }

  /**
   * Attend le shell (rail, en-tête, modèle, utilisateur). Les scripts de page s'exécutent avant le
   * shell (chargé en defer) : ils doivent démarrer par « Prisme.whenShell().then(init) ».
   * Résout { model, user, pageId, page } (objet vide sur une page sans shell).
   */
  function whenShell() {
    return new Promise((resolve) => {
      const done = () => resolve(window.Prisme.shell ? window.Prisme.shell.ready : {})
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', done)
      else done()
    })
  }

  window.Prisme = Object.assign(window.Prisme || {}, {
    whenShell,
    ICONS, icon, esc, h, append, clear, api, stream, toast, modal, confirm: confirmDialog,
    tabs, stepper, badge, dot, status, kpi, card, empty, banner, copy, busy,
    fmtDate, fmtAgo, fmtDuration, gherkinHtml, goLogin,
  })
})()

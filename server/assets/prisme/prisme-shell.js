/*
 * PRISME — shell de l'application : rail d'icônes, en-tête (fil d'Ariane, titre, recherche Ctrl K,
 * utilisateur), bandeau de statut et guide de page. Injecté par le serveur dans toutes les pages
 * (sauf data-shell="none"), il enveloppe le contenu existant du <body> dans <main class="p-content">.
 *
 * API pour les pages : Prisme.shell.ready (Promise<{ model, user, pageId, page }>),
 * Prisme.shell.setActions(...nodes), Prisme.shell.setTitle(titre), Prisme.shell.refreshStrip().
 * Attributs facultatifs sur <body> : data-title, data-crumb, data-guide="off".
 */
;(function () {
  'use strict'
  const P = window.Prisme
  if (!P || document.querySelector('.p-rail')) return
  const { h, icon } = P
  const VER = ((document.currentScript && document.currentScript.src) || '').match(/[?&]v=([^&]+)/)?.[1] || ''

  let resolveReady
  const ready = new Promise((r) => { resolveReady = r })
  const state = { model: null, user: null, pageId: null, page: null }

  const normPath = (p) => {
    const x = String(p || '/').split(/[?#]/)[0]
    return x === '/index.html' ? '/' : x.replace(/\/$/, '') || '/'
  }

  function findPage(model) {
    const here = normPath(location.pathname)
    for (const [id, page] of Object.entries(model.pages || {})) {
      const paths = [page.path, ...(page.match || [])].map(normPath)
      if (paths.includes(here)) return { id, page }
    }
    return { id: null, page: null }
  }

  function initials(name) {
    return String(name || '?').split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join('') || '?'
  }

  // ---------------------------------------------------------------- squelette

  const body = document.body
  body.classList.add('p-app')
  const content = h('main', { class: 'p-content', id: 'p-content' })
  while (body.firstChild) content.appendChild(body.firstChild)

  const railNav = h('nav', { class: 'p-rail-nav', 'aria-label': 'Navigation principale' })
  const railFoot = h('div', { class: 'p-rail-foot' })
  const rail = h('aside', { class: 'p-rail' },
    h('a', { class: 'p-rail-brand', href: '/', title: 'Wizard QA — Pilotage' },
      h('img', { src: '/assets/logo-qa.png', alt: 'Wizard QA' })),
    railNav,
    railFoot)

  const crumb = h('div', { class: 'p-crumb' })
  const title = h('h1', { class: 'p-title' }, body.dataset.title || document.title.replace(/\s*[—-]\s*Wizard QA.*$/i, '') || 'Wizard QA')
  const actions = h('div', { class: 'p-row', id: 'p-header-actions' })
  const userBtn = h('button', { class: 'p-user', type: 'button', 'aria-haspopup': 'menu' },
    h('span', { class: 'p-avatar' }, '…'),
    h('span', { class: 'p-user-meta' }, h('div', { class: 'p-user-name' }, '…'), h('div', { class: 'p-user-role' }, '')))
  const header = h('header', { class: 'p-header' },
    h('div', { class: 'p-header-titles' }, crumb, title),
    actions,
    h('button', { class: 'p-btn p-btn--sm p-btn--primary p-tour-launch', type: 'button', title: 'Démo : rejoue l’application pas à pas, actions annotées (données fictives)', onclick: () => startDemo() },
      icon('play'), h('span', null, 'Démo')),
    h('button', { class: 'p-search', type: 'button', onclick: () => openPalette() },
      icon('search'), h('span', null, 'Rechercher ou lancer…'), h('span', { class: 'p-kbd' }, 'Ctrl K')),
    h('a', { class: 'p-icon-btn', href: '/wiki.html', title: 'Aide' }, icon('help')),
    userBtn)
  const strip = h('div', { class: 'p-strip', role: 'status' }, h('span', { class: 'p-strip-item' }, h('span', { class: 'p-spinner' }), 'Lecture de l’état du poste…'))

  const main = h('div', { class: 'p-shell-main' }, header, strip, content)
  body.appendChild(rail)
  body.appendChild(main)

  // ---------------------------------------------------------------- rendu

  function renderRail(model) {
    P.clear(railNav)
    const current = state.pageId
    for (const item of model.rail || []) {
      if (item.sep) {
        railNav.appendChild(h('div', { class: 'p-rail-sep' }))
        continue
      }
      if (item.role && state.user?.role !== item.role) continue
      const active = (item.match || [item.id]).includes(current)
      const st = model.statuses?.[item.id]
      const badge = item.id !== 'home' && st?.state === 'blocked'
        ? null
        : (st?.count ? h('span', { class: `p-rail-badge ${st.tone || ''}` }, String(st.count)) : null)
      railNav.appendChild(h('a', {
        class: `p-rail-item ${active ? 'active' : ''}`,
        href: item.path,
        title: model.pages?.[item.id]?.label || item.label,
        'aria-current': active ? 'page' : null,
      }, icon(item.icon), h('span', null, item.label), badge))
    }
  }

  function renderHeader() {
    const page = state.page
    const section = body.dataset.crumb || page?.section || ''
    P.clear(crumb)
    crumb.append(h('a', { href: '/' }, 'Wizard QA'))
    if (section) crumb.append(h('span', { class: 'sep' }, '›'), section)
    if (page && !body.dataset.title) {
      title.textContent = page.label
      document.title = `${page.label} — Wizard QA`
    }
  }

  /** Nom affiché dans l'en-tête quand les données de démo sont chargées ou qu'une démo tourne (personne fictive). */
  const DEMO_NAME = 'Camille DURAND'
  const tourRunning = () => { try { return Boolean(sessionStorage.getItem('p-tour')) } catch { return false } }

  function renderUser() {
    const real = state.user
    if (!real) return
    const u = state.demoLoaded || tourRunning() ? { ...real, displayName: DEMO_NAME } : real
    userBtn.querySelector('.p-avatar').textContent = initials(u.displayName || u.username)
    userBtn.querySelector('.p-user-name').textContent = u.displayName || u.username
    userBtn.querySelector('.p-user-role').textContent = u.role === 'admin' ? 'Administrateur' : 'Utilisateur'
    railFoot.replaceChildren(h('a', { class: 'p-rail-item', href: '/reglages.html', title: 'Mon compte' },
      h('span', { class: 'p-avatar', style: { width: '28px', height: '28px', fontSize: '11px' } }, initials(u.displayName || u.username))))
  }

  function renderGuide() {
    const g = state.page?.guide
    if (!g || body.dataset.guide === 'off' || content.querySelector('.p-guide')) return
    const key = `p-guide:${state.pageId}`
    let open = true
    try { open = localStorage.getItem(key) !== 'closed' } catch { /* stockage indisponible */ }
    const det = h('details', { class: 'p-guide', open: open || null },
      h('summary', null, icon('info'), `Guide — ${g.goal}`),
      h('div', { class: 'p-guide-body' },
        g.youDo?.length ? h('ol', null, g.youDo.map((t) => h('li', null, t))) : null,
        g.after ? h('div', null, h('b', null, 'Ensuite : '), g.after) : null))
    det.addEventListener('toggle', () => {
      try { localStorage.setItem(key, det.open ? 'open' : 'closed') } catch { /* ignoré */ }
    })
    const host = content.querySelector('.p-page') || content
    host.insertBefore(det, host.firstChild)
  }

  async function refreshStrip() {
    let items = null
    try {
      const data = await P.api('/api/dashboard/strip')
      items = data.items
    } catch {
      items = null
    }
    if (!items) {
      const st = state.model?.statuses || {}
      const tone = (s) => (s?.state === 'done' ? 'mint' : s?.state === 'blocked' ? 'red' : s?.state === 'todo' ? 'amber' : '')
      items = [
        { label: `Node : ${st['node-install']?.message || '—'}`, tone: tone(st['node-install']), href: '/installation.html' },
        { label: `Playwright : ${st['playwright-install']?.message || '—'}`, tone: tone(st['playwright-install']), href: '/installation.html' },
        { label: `k6 : ${st['k6-install']?.message || '—'}`, tone: tone(st['k6-install']), href: '/installation.html' },
        { label: `JIRA : ${st['hook-git']?.message || '—'}`, tone: tone(st['hook-git']), href: '/hook-git.html' },
      ]
    }
    if (state.user?.demo) {
      items = [{ label: 'Compte de démonstration — changez le mot de passe', tone: 'amber', href: '/reglages.html', icon: 'alert' }, ...items]
    }
    P.clear(strip)
    strip.append(h('span', { class: 'p-strip-item mint' }, h('span', { class: 'p-dot live' }), 'Poste local'))
    for (const it of items) {
      strip.append(h(it.href ? 'a' : 'span', { class: `p-strip-item ${it.tone || ''}`, href: it.href || null, title: it.title || null },
        it.icon ? icon(it.icon, 13) : null, it.label))
    }
  }

  // ---------------------------------------------------------------- menu utilisateur

  let menuEl = null
  function closeMenu() {
    if (menuEl) menuEl.remove()
    menuEl = null
  }
  userBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    if (menuEl) return closeMenu()
    const r = userBtn.getBoundingClientRect()
    menuEl = h('div', { class: 'p-menu', role: 'menu', style: { top: `${r.bottom + 6}px`, right: `${Math.max(8, window.innerWidth - r.right)}px`, position: 'fixed' } },
      h('div', { class: 'p-faint', style: { padding: '6px 9px 8px' } }, state.user ? `Connecté : ${state.user.username}` : ''),
      h('a', { class: 'p-menu-item', href: '/reglages.html', role: 'menuitem' }, icon('settings'), 'Mon compte et utilisateurs'),
      h('a', { class: 'p-menu-item', href: '/ia.html', role: 'menuitem' }, icon('sparkles'), 'Assistant IA'),
      h('div', { class: 'p-menu-sep' }),
      state.user?.embedded ? null : h('button', { class: 'p-menu-item', type: 'button', role: 'menuitem', onclick: logout }, icon('logout'), 'Se déconnecter'))
    document.body.appendChild(menuEl)
  })
  document.addEventListener('click', (e) => { if (menuEl && !menuEl.contains(e.target)) closeMenu() })

  async function logout() {
    try { await P.api('/api/auth/logout', { method: 'POST', body: {} }) } catch { /* déjà déconnecté */ }
    location.href = '/login.html'
  }

  // ---------------------------------------------------------------- palette de commandes (Ctrl K)

  function paletteCommands() {
    const model = state.model || { pages: {} }
    const pages = Object.entries(model.pages).map(([id, p]) => ({
      group: 'Pages', label: p.label, sub: p.section || '', icon: (model.rail || []).find((r) => (r.match || []).includes(id))?.icon || 'chevronRight', href: p.path,
    }))
    const acts = [
      { group: 'Actions', label: 'Lancer l’installation complète du poste', icon: 'download', href: '/installation.html?run=1' },
      { group: 'Actions', label: 'Scanner les récits JIRA', icon: 'refresh', href: '/connaissance.html#scan' },
      { group: 'Actions', label: 'Générer les scénarios Gherkin', icon: 'wand', href: '/recits.html' },
      { group: 'Actions', label: 'Lancer un test de charge k6', icon: 'play', href: '/perf.html' },
      { group: 'Actions', label: 'Configurer l’assistant IA (Copilot local…)', icon: 'sparkles', href: '/ia.html' },
      { group: 'Actions', label: 'Démo : tout rejouer (actions annotées)', sub: 'Démonstration', icon: 'play', run: () => startDemo() },
      { group: 'Actions', label: 'Visite guidée commentée (sans action)', sub: 'Démonstration', icon: 'play', run: () => startTour() },
    ]
    if (!state.user?.embedded) acts.push({ group: 'Actions', label: 'Se déconnecter', icon: 'logout', run: logout })
    return [...acts, ...pages]
  }

  function openPalette() {
    if (document.querySelector('.p-palette')) return
    const input = h('input', { type: 'text', placeholder: 'Page, action ou clé de récit (ex. PROJ-12)…', 'aria-label': 'Rechercher' })
    const list = h('div', { class: 'p-palette-list', role: 'listbox' })
    const box = h('div', { class: 'p-modal p-palette' }, h('div', { class: 'p-palette-input' }, icon('search'), input, h('span', { class: 'p-kbd' }, 'Échap')), list)
    const overlay = h('div', { class: 'p-overlay', onmousedown: (e) => { if (e.target === overlay) close() } }, box)
    let items = []
    let active = 0
    let storyTimer = null
    let stories = []

    function close() {
      overlay.remove()
      document.removeEventListener('keydown', onKey, true)
    }
    function run(it) {
      close()
      if (it.run) it.run()
      else if (it.href) location.href = it.href
    }
    function render() {
      const q = input.value.trim().toLowerCase()
      const all = [...stories, ...paletteCommands()]
      items = q ? all.filter((c) => `${c.label} ${c.sub || ''}`.toLowerCase().includes(q)) : all
      items = items.slice(0, 40)
      active = Math.min(active, Math.max(items.length - 1, 0))
      P.clear(list)
      let group = null
      items.forEach((it, i) => {
        if (it.group !== group) {
          group = it.group
          list.appendChild(h('div', { class: 'p-palette-group p-section-label' }, group))
        }
        list.appendChild(h('div', {
          class: `p-palette-item ${i === active ? 'active' : ''}`,
          role: 'option',
          onmousemove: () => { if (active !== i) { active = i; render() } },
          onclick: () => run(it),
        }, icon(it.icon || 'chevronRight'), h('span', null, it.label), it.sub ? h('span', { class: 'p-palette-item-sub' }, it.sub) : null))
      })
      if (!items.length) list.appendChild(P.empty('Aucun résultat', 'Essayez un autre mot-clé.', 'search'))
    }
    function searchStories() {
      clearTimeout(storyTimer)
      const q = input.value.trim()
      if (q.length < 2) {
        stories = []
        return
      }
      storyTimer = setTimeout(async () => {
        try {
          const data = await P.api(`/api/jira/stories?q=${encodeURIComponent(q)}&limit=8`)
          stories = (data.stories || []).map((s) => ({ group: 'Récits', label: `${s.key} — ${s.summary}`, icon: 'listChecks', href: `/recits.html?key=${encodeURIComponent(s.key)}` }))
          render()
        } catch {
          stories = []
        }
      }, 180)
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); close() }
      else if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, items.length - 1); render() }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); render() }
      else if (e.key === 'Enter' && items[active]) { e.preventDefault(); run(items[active]) }
    }
    input.addEventListener('input', () => { active = 0; render(); searchStories() })
    document.addEventListener('keydown', onKey, true)
    document.body.appendChild(overlay)
    render()
    input.focus()
  }

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault()
      openPalette()
    }
  })

  // ---------------------------------------------------------------- visite guidée (prisme-tour.js)

  let tourLoading = null
  function loadTour() {
    if (P.tour) return Promise.resolve(P.tour)
    if (!tourLoading) {
      tourLoading = new Promise((resolve, reject) => {
        const s = document.createElement('script')
        s.src = `/assets/prisme/prisme-tour.js${VER ? `?v=${VER}` : ''}`
        s.onload = () => (P.tour ? resolve(P.tour) : reject(new Error('Visite guidée indisponible')))
        s.onerror = () => reject(new Error('Visite guidée indisponible'))
        document.head.appendChild(s)
      })
    }
    return tourLoading
  }

  function startTour(fromId) {
    loadTour().then((t) => t.start(fromId)).catch((e) => P.toast(e.message || 'Visite guidée indisponible', 'error'))
  }

  /**
   * Bouton « Démo » (« Tout rejouer ») : charge le jeu fictif IRMA s'il n'est pas chargé, puis lance le script
   * « rejeu » dont les actions sont jouées dans l'application. Des récits réels déjà scannés : confirmation d'abord.
   */
  let demoStarting = false
  async function startDemo(fromId) {
    if (demoStarting) return
    demoStarting = true
    try {
      const status = await P.api('/api/demo/status')
      if (!status.loaded) {
        const stories = await P.api('/api/jira/stories?limit=1').catch(() => null)
        const reel = stories?.total > 0 && stories.scan?.source !== 'demo'
        if (reel && !(await P.confirm('Des récits réels sont présents. La démo charge le jeu fictif IRMA (Banque Horizon) à leur place ; Réglages › Démonstration › Réinitialiser restaure ensuite « Mon projet ».', { title: 'Lancer la démo', okLabel: 'Charger la démo' }))) return
        P.toast('Chargement des données de démonstration…', 'ok', 2500)
        await P.api('/api/demo/load', { method: 'POST', body: {} })
      }
      state.demoLoaded = true
      renderUser()
      const t = await loadTour()
      await t.start(fromId, 'rejeu')
    } catch (e) {
      P.toast(e.status === 403 ? 'Le chargement de la démo est réservé aux administrateurs.' : (e.message || 'Démo indisponible'), 'error')
    } finally {
      demoStarting = false
    }
  }

  /** ?visite=1 / ?demo=1 (ou =<id d'étape>) lance la visite ou la démo ; sinon une visite en cours dans l'onglet reprend. */
  function bootTour() {
    const params = new URLSearchParams(location.search)
    for (const [key, run] of [['demo', startDemo], ['visite', startTour]]) {
      const wanted = params.get(key)
      if (wanted == null) continue
      params.delete(key)
      const qs = params.toString()
      history.replaceState(null, '', `${location.pathname}${qs ? `?${qs}` : ''}${location.hash}`)
      return run(wanted && wanted !== '1' && wanted !== 'true' ? wanted : undefined)
    }
    let running = false
    try { running = Boolean(sessionStorage.getItem('p-tour')) } catch { /* stockage indisponible */ }
    if (running) loadTour().then((t) => t.restore()).catch((e) => console.error('[visite]', e))
  }

  // ---------------------------------------------------------------- démarrage

  async function boot() {
    const [model, session, demo] = await Promise.all([
      P.api('/api/app/model').catch(() => null),
      P.api('/api/auth/session').catch(() => null),
      P.api('/api/demo/status').catch(() => null),
    ])
    state.demoLoaded = Boolean(demo?.loaded)
    state.model = model || { pages: {}, rail: [], statuses: {} }
    state.user = session?.user || null
    Object.assign(state, findPage(state.model))
    renderRail(state.model)
    renderHeader()
    renderUser()
    renderGuide()
    refreshStrip()
    resolveReady({ ...state })
    bootTour()
  }

  P.shell = {
    ready,
    setActions(...nodes) {
      P.clear(actions)
      P.append(actions, nodes)
    },
    setTitle(text) {
      title.textContent = text
      document.title = `${text} — Wizard QA`
    },
    refreshStrip,
    openPalette,
    startTour,
    startDemo,
    loadTour,
    get state() { return { ...state } },
  }

  boot().catch((e) => {
    console.error('[prisme-shell]', e)
    resolveReady({ ...state })
  })
})()

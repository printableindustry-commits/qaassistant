/*
 * Écran Performance (k6) : lancer un test de charge, le suivre en direct, analyser le résultat,
 * comparer deux runs et transformer les exigences des récits en profils de charge.
 * Aucune bibliothèque : graphiques SVG construits à la main, DOM via Prisme.h.
 */
;(function () {
  'use strict'
  const P = window.Prisme
  const { h } = P
  const SVG_NS = 'http://www.w3.org/2000/svg'

  const state = {
    tab: 'launch',
    profiles: [],
    scripts: [],
    k6: null,
    settings: { regressionPct: 10, baselines: {} },
    runs: [],
    requirements: null,
    reqDemo: false,          // analyse des récits de démonstration à la demande
    selected: null,          // id du profil ou 'script:<chemin>'
    mode: 'auto',            // auto | real | simulate
    current: null,           // détail du run affiché dans « Lancer »
    es: null,
    runsFilter: { profileId: '', status: '' },
    runDetail: null,         // détail affiché sous l'historique
    compare: { a: '', b: '', result: null, series: null },
  }
  const refs = {}

  // ------------------------------------------------------------------ formats

  const nf = (v, d = 0) => (v == null || Number.isNaN(v) ? '—' : Number(v).toLocaleString('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: 0 }))
  const fmtMs = (v) => (v == null ? '—' : v >= 1000 ? `${nf(v / 1000, 2)} s` : `${nf(v, v < 10 ? 1 : 0)} ms`)
  const fmtPct = (v, d = 2) => (v == null ? '—' : `${nf(v * 100, d)} %`)
  const fmtRps = (v) => (v == null ? '—' : `${nf(v, v < 10 ? 1 : 0)} req/s`)
  const fmtClock = (ms) => {
    const s = Math.max(0, Math.round((ms || 0) / 1000))
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  }
  const OBJECTIVES = { smoke: 'Fumée', load: 'Charge', stress: 'Stress', spike: 'Pic', soak: 'Endurance', breakpoint: 'Point de rupture' }
  const EXECUTORS = {
    'constant-vus': 'VUs constants',
    'ramping-vus': 'Montée progressive',
    'constant-arrival-rate': 'Taux d’arrivée constant',
    'shared-iterations': 'Itérations partagées',
    'per-vu-iterations': 'Itérations par VU',
    script: 'Script libre',
  }
  const STATUS = {
    running: { label: 'En cours', tone: 'blue', icon: 'play' },
    passed: { label: 'Réussi', tone: 'mint', icon: 'checkCircle' },
    failed: { label: 'Seuils non respectés', tone: 'red', icon: 'xCircle' },
    error: { label: 'Erreur', tone: 'red', icon: 'alert' },
    stopped: { label: 'Arrêté', tone: 'amber', icon: 'stop' },
  }
  const statusBadge = (s) => {
    const st = STATUS[s] || STATUS.error
    return h('span', { class: `p-status ${st.tone}` }, h('span', { class: `p-dot ${st.tone} ${s === 'running' ? 'live' : ''}` }), st.label)
  }
  const simBadge = () => P.badge('◇ simulé', 'purple', 'Métriques synthétiques : k6 n’a pas été exécuté')
  const METRIC_LABELS = {
    http_req_duration: 'Durée des requêtes',
    http_req_failed: 'Requêtes en échec',
    http_reqs: 'Débit',
    checks: 'Vérifications',
    iterations: 'Itérations',
  }
  const fmtThresholdActual = (t) => {
    if (t.actual == null) return '—'
    if (t.metric === 'http_req_duration' || /duration|waiting/.test(t.metric)) return fmtMs(t.actual)
    if (/rate/.test(t.rule) && t.actual <= 1) return fmtPct(t.actual)
    return nf(t.actual, 2)
  }

  function save(key, value) {
    try { localStorage.setItem(`perf.${key}`, value) } catch { /* stockage indisponible */ }
  }
  function load(key) {
    try { return localStorage.getItem(`perf.${key}`) } catch { return null }
  }

  // ------------------------------------------------------------------ graphiques SVG

  function svg(tag, attrs = {}, ...children) {
    const el = document.createElementNS(SVG_NS, tag)
    for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v)
    for (const c of children) if (c) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c)
    return el
  }

  function niceMax(v) {
    if (!v || v <= 0) return 1
    const p = 10 ** Math.floor(Math.log10(v))
    return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v)
  }

  /**
   * Graphique en ligne : series = [{ points: [{ t, v }], cls }]. Une seule échelle (un seul axe Y).
   * Survol : réticule et infobulle avec la valeur la plus proche.
   */
  function lineChart({ title, series, format, threshold, current, legend }) {
    const W = 420, H = 150, L = 44, R = 10, T = 10, B = 22
    const all = series.flatMap((s) => s.points).filter((p) => p.v != null)
    const tMax = Math.max(10, ...all.map((p) => p.t))
    const vMax = niceMax(Math.max(threshold || 0, ...all.map((p) => p.v)) * 1.1)
    const x = (t) => L + (t / tMax) * (W - L - R)
    const y = (v) => T + (1 - v / vMax) * (H - T - B)
    const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': title })
    for (let i = 0; i <= 4; i += 1) {
      const v = (vMax / 4) * i
      root.appendChild(svg('line', { class: 'grid', x1: L, x2: W - R, y1: y(v), y2: y(v) }))
      root.appendChild(svg('text', { class: 'axis', x: L - 6, y: y(v) + 3, 'text-anchor': 'end' }, format(v, true)))
    }
    for (const f of [0, 0.5, 1]) {
      root.appendChild(svg('text', { class: 'axis', x: x(tMax * f), y: H - 6, 'text-anchor': f === 0 ? 'start' : f === 1 ? 'end' : 'middle' }, fmtClock(tMax * f * 1000)))
    }
    if (threshold) {
      root.appendChild(svg('line', { class: 'threshold', x1: L, x2: W - R, y1: y(threshold), y2: y(threshold) }))
      root.appendChild(svg('text', { class: 'threshold-label', x: W - R, y: y(threshold) - 4, 'text-anchor': 'end' }, `seuil ${format(threshold)}`))
    }
    series.forEach((s, i) => {
      const pts = s.points.filter((p) => p.v != null)
      if (!pts.length) return
      const d = pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')
      if (i === 0 && series.length === 1) {
        root.appendChild(svg('path', { class: 'area', d: `${d} L${x(pts[pts.length - 1].t).toFixed(1)},${y(0)} L${x(pts[0].t).toFixed(1)},${y(0)} Z` }))
      }
      root.appendChild(svg('path', { class: `line ${s.cls || ''}`, d }))
    })
    addHover(root, series, { x, y, L, R, T, B, W, H, tMax, format })
    return h('div', { class: 'perf-chart' },
      h('div', { class: 'perf-chart-head' }, h('span', { class: 'perf-chart-title' }, title), current != null ? h('span', { class: 'perf-chart-value' }, current) : null),
      legend || null,
      root)
  }

  function addHover(root, series, g) {
    const cursor = svg('line', { class: 'cursor', y1: g.T, y2: g.H - g.B, visibility: 'hidden' })
    const dot = svg('circle', { class: 'dot', r: 4, visibility: 'hidden' })
    const tipBg = svg('rect', { class: 'tip-bg', rx: 4, height: 20, visibility: 'hidden' })
    const tip = svg('text', { class: 'tip', visibility: 'hidden' })
    const hit = svg('rect', { x: g.L, y: g.T, width: g.W - g.L - g.R, height: g.H - g.T - g.B, fill: 'transparent' })
    root.append(cursor, dot, tipBg, tip, hit)
    const main = series[series.length - 1].points.filter((p) => p.v != null)
    const hide = () => [cursor, dot, tipBg, tip].forEach((e) => e.setAttribute('visibility', 'hidden'))
    hit.addEventListener('mouseleave', hide)
    hit.addEventListener('mousemove', (e) => {
      if (!main.length) return
      const box = root.getBoundingClientRect()
      const px = ((e.clientX - box.left) / box.width) * g.W
      const t = ((px - g.L) / (g.W - g.L - g.R)) * g.tMax
      const p = main.reduce((best, q) => (Math.abs(q.t - t) < Math.abs(best.t - t) ? q : best), main[0])
      const cx = g.x(p.t)
      const cy = g.y(p.v)
      const others = series.slice(0, -1).map((s) => s.points.find((q) => q.t === p.t)).filter((q) => q && q.v != null)
      const label = `${fmtClock(p.t * 1000)} · ${g.format(p.v)}${others.length ? ` (réf. ${g.format(others[0].v)})` : ''}`
      cursor.setAttribute('x1', cx)
      cursor.setAttribute('x2', cx)
      dot.setAttribute('cx', cx)
      dot.setAttribute('cy', cy)
      tip.textContent = label
      const width = label.length * 5.6 + 12
      const tx = Math.min(Math.max(cx - width / 2, g.L), g.W - g.R - width)
      tipBg.setAttribute('x', tx)
      tipBg.setAttribute('y', g.T)
      tipBg.setAttribute('width', width)
      tip.setAttribute('x', tx + 6)
      tip.setAttribute('y', g.T + 14)
      ;[cursor, dot, tipBg, tip].forEach((el) => el.setAttribute('visibility', 'visible'))
    })
  }

  function runCharts(run, series) {
    const pts = (k, f = (v) => v) => series.map((p) => ({ t: p.t, v: p[k] == null ? null : f(p[k]) }))
    const last = series[series.length - 1] || {}
    const p95Limit = p95Threshold(run)
    const errLimit = errorThreshold(run)
    return h('div', { class: 'perf-charts' },
      lineChart({ title: 'Utilisateurs virtuels', series: [{ points: pts('vus') }], format: (v) => nf(v), current: nf(last.vus) }),
      lineChart({ title: 'Requêtes par seconde', series: [{ points: pts('rps') }], format: (v) => nf(v, v < 10 ? 1 : 0), current: last.rps != null ? fmtRps(last.rps) : '—' }),
      lineChart({ title: 'Temps de réponse p95', series: [{ points: pts('p95') }], format: (v, axis) => (axis ? nf(v) : fmtMs(v)), threshold: p95Limit, current: fmtMs(last.p95) }),
      lineChart({ title: 'Taux d’erreur HTTP', series: [{ points: pts('errorRate', (v) => v * 100), cls: 'red' }], format: (v) => `${nf(v, 1)} %`, threshold: errLimit != null ? errLimit * 100 : null, current: fmtPct(last.errorRate, 1) }))
  }

  function ruleLimit(run, metric, re) {
    const rules = [].concat(run?.thresholdsDef?.[metric] || []).map((r) => (typeof r === 'string' ? r : r?.threshold))
    for (const r of rules) {
      const m = String(r || '').match(re)
      if (m) return Number(m[1])
    }
    return null
  }
  const p95Threshold = (run) => ruleLimit(run, 'http_req_duration', /^p\(95\)\s*<=?\s*([\d.]+)/)
  const errorThreshold = (run) => ruleLimit(run, 'http_req_failed', /^rate\s*<=?\s*([\d.]+)/)

  // ------------------------------------------------------------------ données

  async function loadProfiles() {
    const data = await P.api('/api/perf/profiles')
    state.profiles = data.profiles
    state.scripts = data.scripts
    state.k6 = data.k6
    state.settings = data.settings
    const remembered = load('profile')
    const valid = (id) => id && (state.profiles.some((p) => p.id === id) || (id.startsWith('script:') && state.scripts.includes(id.slice(7))))
    if (!valid(state.selected)) state.selected = valid(remembered) ? remembered : state.profiles[0]?.id || null
  }

  async function loadRuns() {
    const data = await P.api('/api/perf/runs?limit=300')
    state.runs = data.runs
  }

  async function loadRequirements() {
    try {
      state.requirements = await P.api(`/api/perf/requirements${state.reqDemo ? '?demo=1' : ''}`)
    } catch (e) {
      state.requirements = { items: [], error: e.message }
    }
  }

  // ------------------------------------------------------------------ squelette

  function renderShell() {
    const app = document.getElementById('app')
    P.clear(app)
    refs.banner = h('div')
    refs.kpis = h('div', { class: 'p-kpis' })
    refs.tabs = h('div')
    refs.panels = {
      launch: h('div', { class: 'perf-panel p-stack', style: { gap: '16px' } }),
      runs: h('div', { class: 'perf-panel p-stack', style: { gap: '16px' }, hidden: true }),
      compare: h('div', { class: 'perf-panel p-stack', style: { gap: '16px' }, hidden: true }),
      reqs: h('div', { class: 'perf-panel p-stack', style: { gap: '16px' }, hidden: true }),
    }
    P.append(app, [
      h('p', { class: 'p-page-intro' }, 'Lancez un test de charge k6 à partir d’un profil, suivez-le en direct, puis comparez-le à la référence du profil. Sans k6 installé, l’écran fonctionne en mode simulation (◇) pour se familiariser avec le parcours.'),
      refs.banner, refs.kpis, refs.tabs,
      Object.values(refs.panels),
    ])
    refs.tabsCtl = P.tabs(refs.tabs, tabItems(), state.tab, switchTab)
  }

  function tabItems() {
    const failed = state.runs.filter((r) => r.status === 'failed' || r.status === 'error').length
    const running = state.runs.filter((r) => r.status === 'running').length
    return [
      { id: 'launch', label: 'Lancer', icon: 'play', count: running || null, tone: running ? '' : null },
      { id: 'runs', label: 'Runs', icon: 'listChecks', count: state.runs.length, tone: failed ? 'amber' : '' },
      { id: 'compare', label: 'Comparer', icon: 'barChart' },
      { id: 'reqs', label: 'Exigences des récits', icon: 'fileText', count: state.requirements ? state.requirements.items.length : '…' },
    ]
  }

  function switchTab(id) {
    state.tab = id
    save('tab', id)
    for (const [k, el] of Object.entries(refs.panels)) el.hidden = k !== id
    if (refs.tabsCtl.get() !== id) refs.tabsCtl.set(id)
    if (id === 'runs') renderRuns()
    if (id === 'compare') renderCompare()
    if (id === 'reqs') renderRequirements()
  }

  function refreshHeader() {
    refs.tabsCtl.update(tabItems())
    renderBanner()
    renderKpis()
  }

  function renderBanner() {
    P.clear(refs.banner)
    const k6 = state.k6
    if (!k6) return
    if (k6.installed) {
      refs.banner.appendChild(h('div', { class: 'p-row' },
        P.status(`k6 ${k6.version || ''} installé`.replace(/\s+/g, ' '), 'mint'),
        h('span', { class: 'p-faint' }, 'Les runs exécutent réellement k6 ; le mode simulation reste disponible pour une démonstration.')))
      return
    }
    refs.banner.appendChild(P.banner('warn', [
      h('b', null, 'k6 n’est pas installé sur ce poste. '),
      'Les tests seront lancés en ',
      h('b', null, 'mode simulation ◇'),
      ' : métriques synthétiques, aucune requête envoyée. ',
      h('a', { href: '/installation.html' }, 'Installer k6'),
      ' · ',
      h('a', { href: '#', onclick: (e) => { e.preventDefault(); recheckK6(e.target) } }, 'Vérifier de nouveau'),
    ]))
  }

  async function recheckK6(link) {
    link.textContent = 'Vérification…'
    try {
      state.k6 = (await P.api('/api/perf/k6?refresh=1')).k6
      P.toast(state.k6.installed ? `k6 ${state.k6.version} détecté` : 'k6 toujours introuvable', state.k6.installed ? 'ok' : 'warn')
    } catch (e) {
      P.toast(e.message, 'error')
    }
    renderBanner()
    renderLaunch()
  }

  function renderKpis() {
    P.clear(refs.kpis)
    const done = state.runs.filter((r) => r.status !== 'running')
    const last = done[0]
    const simulated = state.runs.filter((r) => r.simulated).length
    const passed = done.filter((r) => r.status === 'passed').length
    const p95Limit = last ? state.profiles.find((p) => p.id === last.profileId)?.p95Ms : null
    P.append(refs.kpis, [
      P.kpi({ label: 'Profils de charge', value: state.profiles.length, detail: `${state.profiles.filter((p) => !p.builtin).length} personnalisés · ${state.profiles.filter((p) => p.builtin).length} prêts à l’emploi` }),
      P.kpi({ label: 'Runs', value: state.runs.length, detail: simulated ? `dont ${simulated} simulés` : 'historique complet' }),
      P.kpi({ label: 'Taux de réussite', value: done.length ? nf((passed / done.length) * 100) : '—', unit: done.length ? '%' : '', tone: done.length && passed / done.length < 0.8 ? 'amber' : 'mint', detail: `${passed}/${done.length} runs terminés` }),
      P.kpi({
        label: 'Dernier run',
        value: last ? STATUS[last.status]?.label || last.status : '—',
        tone: last ? (last.status === 'passed' ? 'mint' : last.status === 'stopped' ? 'amber' : 'red') : '',
        detail: last ? `${last.profileName} · ${P.fmtAgo(last.startedAt)}${last.simulated ? ' · ◇ simulé' : ''}` : 'Aucun run pour l’instant',
      }),
      P.kpi({
        label: 'p95 du dernier run',
        value: last?.metrics?.p95 != null ? nf(last.metrics.p95) : '—',
        unit: last?.metrics?.p95 != null ? 'ms' : '',
        tone: p95Limit && last?.metrics?.p95 > p95Limit ? 'red' : '',
        detail: p95Limit ? `seuil ${nf(p95Limit)} ms` : 'temps de réponse',
      }),
    ])
  }

  // ------------------------------------------------------------------ onglet « Lancer »

  function selectedProfile() {
    return state.profiles.find((p) => p.id === state.selected) || null
  }

  function renderLaunch() {
    const panel = refs.panels.launch
    P.clear(panel)
    refs.runSlot = h('div', { class: 'p-stack', style: { gap: '16px' } })
    panel.appendChild(h('div', { class: 'p-grid p-grid-aside' }, profileListCard(), runFormCard()))
    panel.appendChild(refs.runSlot)
    if (state.current) renderCurrentRun()
  }

  function profileItem(p) {
    const baseline = p.baselineRunId ? h('span', { class: 'perf-star', title: 'Ce profil a un run de référence' }, '★') : null
    return h('button', {
      type: 'button',
      class: `perf-profile ${state.selected === p.id ? 'active' : ''}`,
      'aria-pressed': state.selected === p.id ? 'true' : 'false',
      onclick: () => { state.selected = p.id; save('profile', p.id); renderLaunch() },
    },
    h('span', { class: 'perf-profile-name' }, p.name, baseline),
    p.description ? h('span', { class: 'perf-profile-desc' }, p.description) : null,
    h('span', { class: 'p-row' },
      p.objective ? P.badge(OBJECTIVES[p.objective] || p.objective, 'teal') : null,
      P.badge(`${p.vus} VUs`, 'outline'),
      P.badge(p.duration, 'outline'),
      P.badge(`p95 < ${nf(p.p95Ms)} ms`, 'outline'),
      p.storyKeys.length ? P.badge(p.storyKeys.join(', '), 'blue') : null))
  }

  function profileListCard() {
    const own = state.profiles.filter((p) => !p.builtin)
    const builtin = state.profiles.filter((p) => p.builtin)
    const body = h('div', { class: 'p-stack', style: { gap: '12px' } },
      h('div', { class: 'p-section-label' }, `Vos profils (${own.length})`),
      own.length
        ? h('div', { class: 'perf-profiles' }, own.map(profileItem))
        : h('div', { class: 'p-faint' }, 'Aucun profil personnalisé : créez-en un dans « Scénarios k6 » ou depuis les exigences des récits.'),
      h('div', { class: 'p-section-label' }, 'Prêts à l’emploi'),
      h('div', { class: 'perf-profiles' }, builtin.map(profileItem)),
      state.scripts.length ? h('div', { class: 'p-field' },
        h('label', { for: 'perf-script' }, 'Ou un script k6 du projet'),
        h('select', {
          id: 'perf-script',
          class: 'p-select',
          onchange: (e) => {
            if (!e.target.value) return
            state.selected = `script:${e.target.value}`
            save('profile', state.selected)
            renderLaunch()
          },
        }, h('option', { value: '' }, '— Choisir un script —'),
        state.scripts.map((s) => h('option', { value: s, selected: state.selected === `script:${s}` }, s)))) : null)
    return P.card({
      title: 'Profil de charge',
      sub: 'Choisissez ce que le test doit simuler',
      icon: 'layers',
      actions: h('a', { class: 'p-btn p-btn--sm p-btn--ghost', href: '/k6-wizard.html' }, P.icon('edit'), 'Éditer'),
      body,
    })
  }

  function modeSelector() {
    const installed = Boolean(state.k6?.installed)
    const modes = [
      { id: 'auto', label: 'Automatique', title: installed ? 'k6 réel' : 'Simulation (k6 absent)' },
      { id: 'real', label: 'k6 réel', title: installed ? 'Exécute réellement k6' : 'Indisponible : k6 n’est pas installé', disabled: !installed },
      { id: 'simulate', label: '◇ Simulation', title: 'Métriques synthétiques, aucune requête' },
    ]
    if (!installed && state.mode === 'real') state.mode = 'auto'
    return h('div', { class: 'p-seg', role: 'radiogroup', 'aria-label': 'Mode d’exécution' }, modes.map((m) => h('button', {
      type: 'button',
      role: 'radio',
      'aria-checked': state.mode === m.id ? 'true' : 'false',
      class: state.mode === m.id ? 'active' : '',
      title: m.title,
      disabled: m.disabled || null,
      onclick: () => { state.mode = m.id; save('mode', m.id); renderLaunch() },
    }, m.label)))
  }

  function runFormCard() {
    const p = selectedProfile()
    const script = state.selected?.startsWith('script:') ? state.selected.slice(7) : null
    if (!p && !script) {
      return P.card({ title: 'Paramètres du run', icon: 'settings', body: P.empty('Aucun profil sélectionné', 'Choisissez un profil à gauche.', 'layers') })
    }
    const willSimulate = state.mode === 'simulate' || (state.mode === 'auto' && !state.k6?.installed)
    // « Relancer » reprend les surcharges du run d'origine (une seule fois).
    const prefill = state.prefill?.selected === state.selected ? state.prefill : {}
    state.prefill = null
    const url = h('input', { class: 'p-input', id: 'perf-url', type: 'url', placeholder: p?.baseUrl || 'URL définie dans le script', value: prefill.baseUrl || load(`url.${state.selected}`) || '' })
    const vus = h('input', { class: 'p-input', id: 'perf-vus', type: 'number', min: 1, max: 5000, placeholder: p ? String(p.vus) : 'selon le script', value: prefill.vus || null })
    const duration = h('input', { class: 'p-input', id: 'perf-duration', type: 'text', placeholder: p?.duration || 'selon le script', value: prefill.duration || null, pattern: '^(\\d+(ms|s|m|h))+$' })
    const launchBtn = h('button', { class: 'p-btn p-btn--primary p-btn--lg', type: 'button' }, P.icon('play'), willSimulate ? 'Lancer la simulation' : 'Lancer le test')
    launchBtn.addEventListener('click', () => launch(launchBtn, { url, vus, duration }))

    const details = p ? h('div', { class: 'p-stack' },
      h('dl', { class: 'p-dl' },
        h('dt', null, 'Exécution'), h('dd', null, EXECUTORS[p.executor] || p.executor, p.executor === 'ramping-vus' && p.rampUp ? ` · montée ${p.rampUp}, descente ${p.rampDown || '—'}` : '', p.arrivalRate && p.executor === 'constant-arrival-rate' ? ` · ${p.arrivalRate} itérations/s` : ''),
        h('dt', null, 'Cible'), h('dd', { class: 'p-mono' }, p.baseUrl || '—'),
        h('dt', null, 'Seuils'), h('dd', null, h('span', { class: 'p-row' }, Object.entries(p.thresholds).flatMap(([m, rules]) => rules.map((r) => P.badge(`${METRIC_LABELS[m] || m} ${r}`, 'outline'))))),
        h('dt', null, 'Script'), h('dd', { class: 'p-mono' }, p.scriptPath, p.scriptExists ? '' : h('span', { class: 'p-faint' }, ' (généré au lancement)')),
        h('dt', null, 'Référence'), h('dd', null, p.baselineRunId ? h('a', { href: '#', onclick: (e) => { e.preventDefault(); openRun(p.baselineRunId) } }, `★ ${p.baselineRunId}`) : h('span', { class: 'p-faint' }, 'aucune — définissez-la depuis un run réussi'))),
      p.journeys.length > 1 || (p.journeys[0] && p.journeys[0].weight !== 100) ? h('div', { class: 'p-stack', style: { gap: '4px' } },
        h('div', { class: 'p-section-label' }, 'Parcours pondérés'),
        h('div', { class: 'perf-weights', title: p.journeys.map((j) => `${j.name} ${j.weight} %`).join(' · ') }, p.journeys.map((j) => h('span', { style: { flex: String(j.weight) } }))),
        h('div', { class: 'p-faint' }, p.journeys.map((j) => `${j.name} ${nf(j.weight)} %`).join(' · '))) : null)
      : h('div', { class: 'p-faint' }, 'Script libre : les seuils et scénarios sont ceux définis dans le fichier. Les surcharges VUs et durée sont passées à k6 (--vus, --duration).')

    return P.card({
      title: p ? p.name : script,
      sub: p ? (p.builtin ? 'Profil prêt à l’emploi' : 'Profil personnalisé') : 'Script du projet',
      icon: 'zap',
      actions: p ? h('button', { class: 'p-btn p-btn--sm p-btn--ghost', type: 'button', onclick: () => showScript(p) }, P.icon('fileText'), 'Voir le script') : null,
      body: h('div', { class: 'p-stack', style: { gap: '14px' } },
        details,
        h('hr', { class: 'p-divider' }),
        h('div', { class: 'p-form-grid' },
          h('div', { class: 'p-field span-2' }, h('label', { for: 'perf-url' }, 'URL cible (facultatif)'), url, h('div', { class: 'p-hint' }, 'Remplace BASE_URL pour ce run seulement, par exemple l’environnement de recette.')),
          h('div', { class: 'p-field' }, h('label', { for: 'perf-vus' }, 'Utilisateurs virtuels'), vus),
          h('div', { class: 'p-field' }, h('label', { for: 'perf-duration' }, 'Durée du palier'), duration, h('div', { class: 'p-hint' }, 'Format k6 : 30s, 2m, 1m30s.'))),
        h('div', { class: 'p-row p-row--between' },
          h('div', { class: 'p-row' }, h('span', { class: 'p-label', style: { margin: 0 } }, 'Mode'), modeSelector()),
          launchBtn),
        willSimulate ? h('div', { class: 'p-faint' }, '◇ Simulation : la durée est ramenée à 60 s au plus, les métriques sont synthétiques et clairement étiquetées.') : null),
    })
  }

  async function showScript(p) {
    try {
      const data = await P.api(`/api/perf/profiles/${encodeURIComponent(p.id)}/script`)
      P.modal({
        title: `Script k6 — ${p.name}`,
        wide: true,
        body: h('div', { class: 'p-stack' },
          h('div', { class: 'p-faint' }, data.exists ? `Fichier ${data.scriptPath}` : `Aperçu — sera écrit dans ${data.scriptPath} au premier lancement`),
          h('pre', { class: 'p-code perf-script' }, data.content)),
        actions: [
          { label: 'Copier', icon: 'copy', kind: 'ghost', onClick: () => { P.copy(data.content); return false } },
          { label: 'Fermer', kind: 'primary' },
        ],
      })
    } catch (e) {
      P.toast(`Script indisponible : ${e.message}`, 'error')
    }
  }

  async function launch(button, inputs) {
    const p = selectedProfile()
    const overrides = {}
    if (inputs.url.value.trim()) overrides.baseUrl = inputs.url.value.trim()
    if (inputs.vus.value) overrides.vus = Number(inputs.vus.value)
    if (inputs.duration.value.trim()) overrides.duration = inputs.duration.value.trim()
    if (overrides.baseUrl) save(`url.${state.selected}`, overrides.baseUrl)
    const body = { overrides }
    if (p) body.profileId = p.id
    else body.scriptPath = state.selected.slice(7)
    if (state.mode === 'simulate') body.simulate = true
    if (state.mode === 'real') body.simulate = false
    await P.busy(button, async () => {
      try {
        const res = await P.api('/api/perf/runs', { body })
        P.toast(res.run.simulated ? 'Simulation démarrée (◇)' : 'Test de charge démarré')
        await attachRun(res.runId)
        loadRuns().then(refreshHeader).catch(() => {})
      } catch (e) {
        P.toast(e.message, 'error', 7000)
      }
    })
  }

  // ------------------------------------------------------------------ run en direct

  async function attachRun(id, { scroll = true } = {}) {
    if (state.es) state.es.close()
    state.es = null
    try {
      state.current = await P.api(`/api/perf/runs/${encodeURIComponent(id)}`)
    } catch (e) {
      P.toast(`Run introuvable : ${e.message}`, 'error')
      return
    }
    history.replaceState(null, '', `#run=${id}`)
    if (state.tab !== 'launch') switchTab('launch')
    renderCurrentRun()
    if (scroll) refs.runSlot.scrollIntoView({ behavior: 'smooth', block: 'start' })
    if (state.current.run.status === 'running') openStream(id)
  }

  function openStream(id) {
    const es = P.stream(`/api/perf/runs/${encodeURIComponent(id)}/events`, {
      snapshot: (d) => {
        if (!state.current || state.current.run.id !== id) return
        state.current.series = d.series || []
        state.current.live = d.live
        state.current.run = d.run || state.current.run
        if (d.log) { state.current.log = d.log; fillConsole(refs.live, d.log) }
        updateLive()
      },
      tick: (d) => {
        if (!state.current || state.current.run.id !== id) return
        if (d.points?.length) state.current.series.push(...d.points)
        state.current.live = d.live
        updateLive()
      },
      log: (d) => appendConsole(refs.live, d.lines || []),
      done: async () => {
        es.close()
        if (state.es === es) state.es = null
        try {
          state.current = await P.api(`/api/perf/runs/${encodeURIComponent(id)}`)
        } catch { /* conserve l'état connu */ }
        renderCurrentRun()
        const st = STATUS[state.current.run.status]
        P.toast(`Run terminé : ${st?.label || state.current.run.status}`, state.current.run.status === 'passed' ? 'ok' : 'warn')
        await Promise.all([loadRuns(), loadProfiles()]).catch(() => {})
        refreshHeader()
        P.shell?.refreshStrip?.()
      },
    }, () => {
      if (es.readyState === EventSource.CLOSED) P.toast('Flux en direct interrompu : rechargez la page pour vous reconnecter.', 'warn')
    })
    state.es = es
  }

  function phaseSteps(run, phase) {
    const ramping = run.config?.executor === 'ramping-vus'
    const steps = [
      { id: 'preparation', label: 'Préparation', sub: 'script et lancement' },
      { id: 'rampup', label: 'Montée en charge' },
      { id: 'steady', label: 'Palier' },
      ramping ? { id: 'rampdown', label: 'Descente' } : null,
      { id: 'done', label: 'Analyse', sub: 'résumé et seuils' },
    ].filter(Boolean)
    const idx = Math.max(0, steps.findIndex((s) => s.id === phase))
    return steps.map((s, i) => {
      let st = i < idx ? 'done' : i === idx ? 'running' : 'todo'
      if (phase === 'done' && i === idx) st = run.status === 'passed' ? 'done' : run.status === 'stopped' ? 'skipped' : 'failed'
      if (phase === 'done' && i === idx && run.status !== 'passed') s.sub = STATUS[run.status]?.label
      return { label: s.label, sub: s.sub, state: st }
    })
  }

  function renderCurrentRun() {
    P.clear(refs.runSlot)
    refs.live = null
    if (!state.current) return
    refs.runSlot.appendChild(runView(state.current, { live: state.current.run.status === 'running', closable: true }))
  }

  /** Vue d'un run : en direct (refs mises à jour à chaque seconde) ou terminé. */
  function runView(detail, { live = false, closable = false } = {}) {
    const run = detail.run
    const v = {}           // éléments propres à cette vue (la vue en direct est exposée dans refs.live)
    const actions = h('div', { class: 'p-row perf-actions' })
    if (live) {
      const stopBtn = h('button', { class: 'p-btn p-btn--danger p-btn--sm', type: 'button' }, P.icon('stop'), 'Arrêter')
      stopBtn.addEventListener('click', () => stopRun(stopBtn, run.id))
      actions.appendChild(stopBtn)
    } else {
      if (run.profileId && run.metrics && run.source !== 'v2') {
        actions.appendChild(run.isBaseline
          ? h('button', { class: 'p-btn p-btn--sm p-btn--ghost', type: 'button', onclick: (e) => setBaseline(e.currentTarget, run.profileId, null, detail) }, P.icon('x'), 'Retirer la référence')
          : h('button', { class: 'p-btn p-btn--sm', type: 'button', onclick: (e) => setBaseline(e.currentTarget, run.profileId, run.id, detail) }, P.icon('target'), 'Définir comme référence'))
      }
      if (run.metrics) actions.appendChild(h('button', { class: 'p-btn p-btn--sm', type: 'button', onclick: () => compareWith(run) }, P.icon('barChart'), 'Comparer'))
      actions.appendChild(h('button', { class: 'p-btn p-btn--sm p-btn--ghost', type: 'button', onclick: () => relaunch(run) }, P.icon('refresh'), 'Relancer'))
    }
    if (closable && !live) {
      actions.appendChild(h('button', { class: 'p-icon-btn', type: 'button', 'aria-label': 'Fermer', onclick: () => { state.current = null; history.replaceState(null, '', location.pathname); renderCurrentRun() } }, P.icon('x')))
    }

    const meta = h('div', { class: 'perf-run-meta' },
      h('span', null, 'Démarré ', h('b', null, P.fmtDate(run.startedAt))),
      run.durationMs ? h('span', null, 'Durée ', h('b', null, P.fmtDuration(run.durationMs))) : null,
      run.config?.vus ? h('span', null, 'Charge ', h('b', null, `${run.config.vus} VUs · ${run.config.duration || '—'}`)) : null,
      run.config?.baseUrl ? h('span', null, 'Cible ', h('b', { class: 'p-mono' }, run.config.baseUrl)) : null,
      run.k6Version ? h('span', null, 'k6 ', h('b', null, run.k6Version)) : null,
      run.reportDir ? h('span', null, 'Rapport ', h('b', { class: 'p-mono' }, run.reportDir)) : null)

    const body = h('div', { class: 'p-stack', style: { gap: '14px' } }, meta)
    if (run.source !== 'v2') {
      v.stepper = h('div')
      v.stepper.appendChild(P.stepper(phaseSteps(run, live ? detail.live?.phase || run.phase : 'done')))
      body.appendChild(v.stepper)
    }
    if (live) {
      v.progress = h('div', { class: 'perf-progress' })
      v.liveKpis = h('div', { class: 'p-kpis' })
      body.append(v.progress, v.liveKpis)
    } else {
      body.appendChild(resultSection(detail))
    }
    v.charts = h('div')
    if (run.source !== 'v2') body.appendChild(v.charts)
    if (run.source === 'v2' && !run.metrics) body.appendChild(P.banner('info', 'Run de l’écran « Scénarios k6 » (V2) enregistré sans métriques mesurées : seuls le statut et la date sont connus.'))
    v.console = h('pre', { class: 'p-log', 'aria-live': 'off' })
    if (run.source !== 'v2') {
      body.appendChild(h('details', { class: 'perf-console', open: live || run.status === 'error' || null },
        h('summary', null, 'Console k6'), v.console))
      fillConsole(v, detail.log || [])
    }

    const card = P.card({
      title: h('span', { class: 'p-row' }, `Run ${run.profileName}`, statusBadge(run.status), run.simulated ? simBadge() : null, run.isBaseline ? P.badge('★ référence', 'amber') : null),
      sub: run.id,
      icon: 'activity',
      tone: run.status === 'passed' ? '' : run.status === 'running' ? 'blue' : run.status === 'stopped' ? 'amber' : 'red',
      actions,
      body,
    })
    if (live) {
      refs.live = v
      setTimeout(updateLive, 0)
    } else {
      setTimeout(() => drawCharts(v, detail), 0)
    }
    return card
  }

  function drawCharts(view, detail) {
    if (!view?.charts || !detail.series) return
    P.clear(view.charts)
    if (!detail.series.length) {
      view.charts.appendChild(h('div', { class: 'p-faint' }, detail.run.status === 'running' ? 'En attente des premières mesures…' : 'Aucune mesure par seconde enregistrée pour ce run.'))
      return
    }
    view.charts.appendChild(runCharts(detail.run, detail.series))
  }

  function updateLive() {
    const d = state.current
    const view = refs.live
    if (!d || !view?.liveKpis) return
    const live = d.live || {}
    const run = d.run
    const p95Limit = p95Threshold(run)
    const errLimit = errorThreshold(run)
    P.clear(view.liveKpis)
    P.append(view.liveKpis, [
      P.kpi({ label: 'Utilisateurs virtuels', value: nf(live.vus), detail: `cible ${run.config?.vus ?? '—'}` }),
      P.kpi({ label: 'Requêtes / s', value: live.rps != null ? nf(live.rps, live.rps < 10 ? 1 : 0) : '—', detail: 'moyenne glissante 5 s' }),
      P.kpi({ label: 'p95', value: live.p95 != null ? nf(live.p95) : '—', unit: 'ms', tone: p95Limit && live.p95 > p95Limit ? 'red' : '', detail: p95Limit ? `seuil ${nf(p95Limit)} ms` : 'dernière seconde' }),
      P.kpi({ label: 'Erreurs', value: live.errorRate != null ? nf(live.errorRate * 100, 2) : '—', unit: '%', tone: errLimit != null && live.errorRate > errLimit ? 'red' : '', detail: errLimit != null ? `seuil ${nf(errLimit * 100, 2)} %` : '' }),
      P.kpi({ label: 'Vérifications', value: live.checksRate != null ? nf(live.checksRate * 100, 1) : '—', unit: '%', detail: 'checks réussis' }),
    ])
    P.clear(view.progress)
    const pct = Math.round((live.progress || 0) * 100)
    P.append(view.progress, [
      h('span', { class: 'p-mono' }, fmtClock(live.elapsedMs)),
      h('div', { class: 'p-meter', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('div', { class: 'p-meter-fill', style: { width: `${pct}%` } })),
      h('span', { class: 'p-mono' }, fmtClock(live.plannedMs)),
      h('span', { class: 'p-faint' }, live.progress >= 1 ? 'fin des itérations en cours…' : `${pct} %`),
    ])
    if (view.stepper) {
      P.clear(view.stepper)
      view.stepper.appendChild(P.stepper(phaseSteps(run, live.phase || run.phase)))
    }
    drawCharts(view, d)
  }

  function lineClass(line) {
    if (/^\$ /.test(line)) return 'cmd'
    if (/\b(ERRO|ERREUR|error|✗)\b|✗/i.test(line)) return 'err'
    if (/\b(WARN|avertissement)\b|◇/i.test(line)) return 'warn'
    if (/✓|Run terminé : réussi/.test(line)) return 'ok'
    return ''
  }
  function fillConsole(view, lines) {
    if (!view?.console) return
    P.clear(view.console)
    appendConsole(view, lines)
  }
  function appendConsole(view, lines) {
    if (!view?.console) return
    const atBottom = view.console.scrollTop + view.console.clientHeight >= view.console.scrollHeight - 20
    for (const l of lines) view.console.appendChild(h('span', { class: lineClass(l) }, `${l}\n`))
    while (view.console.childNodes.length > 800) view.console.removeChild(view.console.firstChild)
    if (atBottom) view.console.scrollTop = view.console.scrollHeight
  }

  async function stopRun(button, id) {
    const ok = await P.confirm('Arrêter ce run ? Les mesures déjà collectées sont conservées et le résumé sera calculé à partir du flux.', { title: 'Arrêter le run', okLabel: 'Arrêter', danger: true })
    if (!ok) return
    await P.busy(button, async () => {
      try {
        await P.api(`/api/perf/runs/${encodeURIComponent(id)}/stop`, { method: 'POST', body: {} })
        P.toast('Arrêt demandé')
      } catch (e) {
        P.toast(e.message, 'error')
      }
    })
  }

  function relaunch(run) {
    if (run.profileId && state.profiles.some((p) => p.id === run.profileId)) state.selected = run.profileId
    else if (run.scriptPath && state.scripts.includes(run.scriptPath)) state.selected = `script:${run.scriptPath}`
    state.prefill = { selected: state.selected, ...(run.overrides || {}) }
    state.current = null
    switchTab('launch')
    renderLaunch()
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // ------------------------------------------------------------------ résultat

  function resultSection(detail) {
    const run = detail.run
    const m = run.metrics
    const out = h('div', { class: 'p-stack', style: { gap: '14px' } })
    if (run.error) out.appendChild(P.banner('error', [h('b', null, 'Erreur : '), run.error, ' Consultez la console ci-dessous ; vérifiez l’URL cible et le script.']))
    const verdict = {
      passed: ['info', 'Tous les seuils sont respectés.'],
      failed: ['error', `${(run.thresholds || []).filter((t) => !t.ok).length} seuil(s) non respecté(s) : le système ne tient pas les objectifs du profil.`],
      stopped: ['warn', 'Run arrêté avant la fin : résumé calculé sur la période exécutée.'],
      error: ['error', 'Le run n’a pas pu aller au bout.'],
    }[run.status]
    if (verdict && !run.error) out.appendChild(P.banner(verdict[0], [h('b', null, `${STATUS[run.status].label}. `), verdict[1], run.simulated ? ' (◇ résultat simulé)' : '']))
    if (!m) return out
    const p95Limit = p95Threshold(run)
    out.appendChild(h('div', { class: 'p-kpis' },
      P.kpi({ label: 'p95', value: nf(m.p95), unit: 'ms', tone: p95Limit && m.p95 > p95Limit ? 'red' : 'mint', detail: `p99 ${fmtMs(m.p99)} · p90 ${fmtMs(m.p90)}` }),
      P.kpi({ label: 'Temps moyen', value: nf(m.avg), unit: 'ms', detail: `médiane ${fmtMs(m.med)} · max ${fmtMs(m.max)}` }),
      P.kpi({ label: 'Taux d’échec', value: m.errorRate != null ? nf(m.errorRate * 100, 2) : '—', unit: '%', tone: m.errorRate > (errorThreshold(run) ?? 0.01) ? 'red' : '', detail: `${nf(m.requests)} requêtes` }),
      P.kpi({ label: 'Débit', value: m.rps != null ? nf(m.rps, 1) : '—', unit: 'req/s', detail: `${nf(m.iterations)} itérations` }),
      P.kpi({ label: 'VUs max', value: nf(m.vusMax), detail: m.checksRate != null ? `checks ${fmtPct(m.checksRate, 1)}` : '' })))
    if (run.thresholds?.length) out.appendChild(thresholdTable(run.thresholds))
    if (detail.baseline) out.appendChild(baselineBlock(detail.baseline))
    if (run.summarySource && run.summarySource !== 'k6') {
      out.appendChild(h('div', { class: 'p-faint' }, run.summarySource === 'simulation'
        ? '◇ Résumé calculé à partir des métriques simulées.'
        : 'Résumé reconstitué à partir du flux de mesures (k6 n’a pas écrit summary.json, par exemple après un arrêt forcé).'))
    }
    return out
  }

  function thresholdTable(thresholds) {
    return h('div', { class: 'perf-table-wrap' }, h('table', { class: 'p-table' },
      h('thead', null, h('tr', null, h('th', null, 'Seuil'), h('th', null, 'Métrique'), h('th', { class: 'num' }, 'Mesuré'), h('th', null, 'Résultat'))),
      h('tbody', null, thresholds.map((t) => h('tr', { class: t.ok ? '' : 'critical' },
        h('td', { class: 'p-mono' }, t.rule),
        h('td', null, METRIC_LABELS[t.metric] || t.metric, h('span', { class: 'p-faint' }, ` (${t.metric})`)),
        h('td', { class: 'num' }, fmtThresholdActual(t)),
        h('td', null, t.ok ? P.status('Respecté', 'mint') : P.status('Non respecté', 'red')))))))
  }

  function baselineBlock(cmp) {
    const tone = cmp.verdict === 'regression' ? 'error' : cmp.verdict === 'improvement' ? 'info' : 'blue'
    const text = cmp.verdict === 'regression'
      ? `Régression par rapport à la référence (${cmp.regressions} indicateur(s) au-delà de ${nf(cmp.regressionPct)} %).`
      : cmp.verdict === 'improvement' ? 'Amélioration par rapport à la référence.' : `Stable par rapport à la référence (écarts sous ${nf(cmp.regressionPct)} %).`
    return h('div', { class: 'p-stack' }, P.banner(tone, [h('b', null, 'Comparaison à la référence : '), text]), compareTable(cmp.rows.filter((r) => r.better)))
  }

  function fmtMetric(row, v) {
    if (v == null) return '—'
    if (row.unit === 'ms') return fmtMs(v)
    if (row.unit === '%') return fmtPct(v)
    if (row.unit === 'req/s') return fmtRps(v)
    return nf(v)
  }

  function fmtDelta(row) {
    if (row.delta == null) return '—'
    const sign = row.delta > 0 ? '+' : row.delta < 0 ? '−' : ''
    const abs = Math.abs(row.delta)
    if (row.unit === '%') return `${sign}${nf(abs * 100, 2)} pt`
    if (row.unit === 'ms') return `${sign}${fmtMs(abs)}`
    if (row.unit === 'req/s') return `${sign}${nf(abs, 1)} req/s`
    return `${sign}${nf(abs)}`
  }

  const VERDICT = {
    regression: () => P.badge('▼ régression', 'red'),
    improvement: () => P.badge('▲ amélioration', 'mint'),
    stable: () => P.badge('= stable', ''),
    info: () => h('span', { class: 'p-faint' }, 'information'),
  }

  function compareTable(rows) {
    return h('div', { class: 'perf-table-wrap' }, h('table', { class: 'p-table' },
      h('thead', null, h('tr', null, h('th', null, 'Indicateur'), h('th', { class: 'num' }, 'Référence (A)'), h('th', { class: 'num' }, 'Candidat (B)'), h('th', { class: 'num' }, 'Écart'), h('th', { class: 'num' }, 'Écart %'), h('th', null, 'Verdict'))),
      h('tbody', null, rows.map((r) => h('tr', { class: r.verdict === 'regression' ? 'critical' : '' },
        h('td', null, r.label),
        h('td', { class: 'num' }, fmtMetric(r, r.a)),
        h('td', { class: 'num' }, fmtMetric(r, r.b)),
        h('td', { class: `num ${r.verdict === 'regression' ? 'delta-bad' : r.verdict === 'improvement' ? 'delta-good' : ''}` }, fmtDelta(r)),
        h('td', { class: 'num' }, r.deltaPct == null ? '—' : `${r.deltaPct > 0 ? '+' : ''}${nf(r.deltaPct, 1)} %`),
        h('td', null, VERDICT[r.verdict]()))))))
  }

  async function setBaseline(button, profileId, runId, detail) {
    await P.busy(button, async () => {
      try {
        await P.api(`/api/perf/profiles/${encodeURIComponent(profileId)}/baseline`, { method: 'PUT', body: { runId } })
        P.toast(runId ? 'Run défini comme référence du profil' : 'Référence retirée')
        await Promise.all([loadProfiles(), loadRuns()])
        const fresh = await P.api(`/api/perf/runs/${encodeURIComponent(detail.run.id)}`)
        if (state.current?.run.id === fresh.run.id) { state.current = fresh; renderCurrentRun() }
        if (state.runDetail?.run.id === fresh.run.id) { state.runDetail = fresh; renderRuns() }
        refreshHeader()
      } catch (e) {
        P.toast(e.message, 'error')
      }
    })
  }

  function compareWith(run) {
    const ref = state.profiles.find((p) => p.id === run.profileId)?.baselineRunId
    const previous = state.runs.find((r) => r.id !== run.id && r.profileId === run.profileId && r.metrics && r.startedAt < run.startedAt)
    state.compare.b = run.id
    state.compare.a = ref && ref !== run.id ? ref : previous?.id || ''
    state.compare.result = null
    switchTab('compare')
  }

  async function openRun(id) {
    const r = state.runs.find((x) => x.id === id)
    if (r?.status === 'running') return attachRun(id)
    try {
      state.runDetail = await P.api(`/api/perf/runs/${encodeURIComponent(id)}`)
      switchTab('runs')
      setTimeout(() => refs.runDetail?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
    } catch (e) {
      P.toast(e.message, 'error')
    }
  }

  // ------------------------------------------------------------------ onglet « Runs »

  function renderRuns() {
    const panel = refs.panels.runs
    P.clear(panel)
    const f = state.runsFilter
    const profilesInRuns = [...new Map(state.runs.filter((r) => r.profileId).map((r) => [r.profileId, r.profileName])).entries()]
    let rows = state.runs
    if (f.profileId) rows = rows.filter((r) => r.profileId === f.profileId)
    if (f.status) rows = rows.filter((r) => r.status === f.status)

    const chips = ['', 'passed', 'failed', 'error', 'stopped', 'running'].map((s) => {
      const n = s ? state.runs.filter((r) => r.status === s).length : state.runs.length
      if (s && !n) return null
      return h('button', { type: 'button', class: `p-chip ${f.status === s ? 'active' : ''}`, onclick: () => { f.status = s; renderRuns() } }, s ? STATUS[s].label : 'Tous', ` · ${n}`)
    })
    const toolbar = h('div', { class: 'p-toolbar' },
      h('select', { class: 'p-select', 'aria-label': 'Filtrer par profil', onchange: (e) => { f.profileId = e.target.value; renderRuns() } },
        h('option', { value: '' }, 'Tous les profils'),
        profilesInRuns.map(([id, name]) => h('option', { value: id, selected: f.profileId === id }, name))),
      h('div', { class: 'p-row' }, chips),
      h('span', { class: 'p-spacer' }),
      h('span', { class: 'p-toolbar-count' }, `${rows.length} run(s)`),
      h('button', { class: 'p-btn p-btn--sm p-btn--ghost', type: 'button', onclick: async (e) => { await P.busy(e.currentTarget, async () => { await loadRuns(); refreshHeader(); renderRuns() }) } }, P.icon('refresh'), 'Actualiser'))

    const table = rows.length ? h('div', { class: 'perf-table-wrap' }, h('table', { class: 'p-table' },
      h('thead', null, h('tr', null,
        h('th', null, 'Date'), h('th', null, 'Profil'), h('th', null, 'Verdict'), h('th', { class: 'num' }, 'Durée'),
        h('th', { class: 'num' }, 'VUs'), h('th', { class: 'num' }, 'p95'), h('th', { class: 'num' }, 'Erreurs'), h('th', { class: 'num' }, 'Débit'),
        h('th', null, 'Seuils'), h('th', null, ''))),
      h('tbody', null, rows.map((r) => h('tr', {
        class: `clickable ${state.runDetail?.run.id === r.id ? 'selected' : ''} ${r.status === 'failed' || r.status === 'error' ? 'critical' : ''}`,
        tabindex: 0,
        onclick: () => openRun(r.id),
        onkeydown: (e) => { if (e.key === 'Enter') openRun(r.id) },
      },
      h('td', { class: 'p-nowrap' }, P.fmtDate(r.startedAt)),
      h('td', null, h('span', { class: 'p-row' }, r.profileName, r.isBaseline ? h('span', { class: 'perf-star', title: 'Run de référence' }, '★') : null, r.simulated ? simBadge() : null, r.source === 'v2' ? P.badge('V2', 'outline') : null)),
      h('td', null, statusBadge(r.status)),
      h('td', { class: 'num' }, r.durationMs ? P.fmtDuration(r.durationMs) : '—'),
      h('td', { class: 'num' }, nf(r.vus)),
      h('td', { class: 'num' }, fmtMs(r.metrics?.p95)),
      h('td', { class: 'num' }, fmtPct(r.metrics?.errorRate)),
      h('td', { class: 'num' }, r.metrics?.rps != null ? nf(r.metrics.rps, 1) : '—'),
      h('td', null, r.thresholdsTotal ? (r.thresholdsFailed ? P.badge(`${r.thresholdsFailed}/${r.thresholdsTotal} KO`, 'red') : P.badge(`${r.thresholdsTotal}/${r.thresholdsTotal} OK`, 'mint')) : h('span', { class: 'p-faint' }, '—')),
      h('td', { class: 'p-nowrap' }, r.metrics ? h('button', {
        class: 'p-btn p-btn--sm p-btn--ghost',
        type: 'button',
        title: 'Comparer ce run',
        onclick: (e) => { e.stopPropagation(); compareWith(r) },
      }, P.icon('barChart'), 'Comparer') : null)))))) : P.empty(
      state.runs.length ? 'Aucun run ne correspond aux filtres' : 'Aucun run pour l’instant',
      state.runs.length ? 'Modifiez les filtres ci-dessus.' : 'Lancez un premier test depuis l’onglet « Lancer » (la simulation suffit pour découvrir l’écran).',
      'activity',
      state.runs.length ? null : h('button', { class: 'p-btn p-btn--primary', type: 'button', onclick: () => switchTab('launch') }, P.icon('play'), 'Lancer un test'))

    panel.appendChild(P.card({ title: 'Historique des runs', sub: 'Runs de cet écran et de « Scénarios k6 », du plus récent au plus ancien', icon: 'listChecks', flush: true, body: h('div', null, h('div', { style: { padding: '10px 14px 0' } }, toolbar), table) }))
    refs.runDetail = h('div')
    panel.appendChild(refs.runDetail)
    if (state.runDetail) {
      const detail = state.runDetail
      const view = runView(detail, { live: false })
      const del = detail.run.source !== 'v2' && detail.run.status !== 'running'
        ? h('button', { class: 'p-btn p-btn--sm p-btn--danger', type: 'button', onclick: (e) => deleteRun(e.currentTarget, detail.run) }, P.icon('trash'), 'Supprimer')
        : null
      if (del) view.querySelector('.perf-actions')?.appendChild(del)
      refs.runDetail.appendChild(view)
    }
  }

  async function deleteRun(button, run) {
    const ok = await P.confirm(`Supprimer définitivement le run ${run.id} et ses fichiers de rapport (${run.reportDir}) ? Cette action est irréversible.`, { title: 'Supprimer le run', okLabel: 'Supprimer', danger: true })
    if (!ok) return
    await P.busy(button, async () => {
      try {
        await P.api(`/api/perf/runs/${encodeURIComponent(run.id)}`, { method: 'DELETE' })
        P.toast('Run supprimé')
        state.runDetail = null
        await Promise.all([loadRuns(), loadProfiles()])
        refreshHeader()
        renderRuns()
      } catch (e) {
        P.toast(e.message, 'error')
      }
    })
  }

  // ------------------------------------------------------------------ onglet « Comparer »

  function runOption(r, selected) {
    const label = `${P.fmtDate(r.startedAt)} — ${r.profileName}${r.simulated ? ' ◇' : ''}${r.isBaseline ? ' ★' : ''} — ${STATUS[r.status]?.label || r.status}${r.metrics?.p95 != null ? ` — p95 ${Math.round(r.metrics.p95)} ms` : ''}`
    return h('option', { value: r.id, selected: selected === r.id }, label)
  }

  function renderCompare() {
    const panel = refs.panels.compare
    P.clear(panel)
    const candidates = state.runs.filter((r) => r.metrics && r.status !== 'running')
    if (candidates.length < 2) {
      panel.appendChild(P.card({ title: 'Comparer deux runs', icon: 'barChart', body: P.empty('Il faut au moins deux runs terminés', 'Lancez un profil deux fois (par exemple avant et après une livraison) pour mesurer l’écart.', 'barChart', h('button', { class: 'p-btn p-btn--primary', type: 'button', onclick: () => switchTab('launch') }, P.icon('play'), 'Lancer un test')) }))
      return
    }
    const c = state.compare
    if (!c.b) c.b = candidates[0].id
    if (!c.a) {
      const b = candidates.find((r) => r.id === c.b)
      const ref = state.profiles.find((p) => p.id === b?.profileId)?.baselineRunId
      c.a = ref && ref !== c.b ? ref : candidates.find((r) => r.id !== c.b && r.profileId === b?.profileId)?.id || candidates.find((r) => r.id !== c.b).id
    }
    const selA = h('select', { class: 'p-select', id: 'cmp-a', onchange: (e) => { c.a = e.target.value; runCompare() } }, candidates.map((r) => runOption(r, c.a)))
    const selB = h('select', { class: 'p-select', id: 'cmp-b', onchange: (e) => { c.b = e.target.value; runCompare() } }, candidates.map((r) => runOption(r, c.b)))
    const pct = h('input', { class: 'p-input perf-inline-num', id: 'cmp-pct', type: 'number', min: 1, max: 100, step: 1, value: state.settings.regressionPct })
    const saveBtn = h('button', { class: 'p-btn p-btn--sm', type: 'button', title: 'Utiliser ce seuil par défaut' }, P.icon('save'), 'Par défaut')
    saveBtn.addEventListener('click', () => saveThreshold(saveBtn, pct))
    pct.addEventListener('change', runCompare)
    const swap = h('button', { class: 'p-btn p-btn--sm p-btn--ghost', type: 'button', onclick: () => { [c.a, c.b] = [c.b, c.a]; renderCompare() } }, P.icon('refresh'), 'Inverser')

    refs.compareOut = h('div', { class: 'p-stack', style: { gap: '14px' } })
    panel.appendChild(P.card({
      title: 'Comparer deux runs',
      sub: 'B est comparé à A ; une régression est signalée au-delà du seuil',
      icon: 'barChart',
      body: h('div', { class: 'p-stack', style: { gap: '12px' } },
        h('div', { class: 'p-form-grid' },
          h('div', { class: 'p-field' }, h('label', { for: 'cmp-a' }, 'A — référence'), selA),
          h('div', { class: 'p-field' }, h('label', { for: 'cmp-b' }, 'B — candidat'), selB)),
        h('div', { class: 'p-row' }, h('label', { class: 'p-label', for: 'cmp-pct', style: { margin: 0 } }, 'Seuil de régression (%)'), pct, saveBtn, h('span', { class: 'p-spacer' }), swap)),
    }))
    panel.appendChild(refs.compareOut)
    runCompare()
  }

  async function saveThreshold(button, input) {
    await P.busy(button, async () => {
      try {
        const res = await P.api('/api/perf/settings', { method: 'PUT', body: { regressionPct: Number(input.value) } })
        state.settings = res.settings
        P.toast(`Seuil de régression par défaut : ${res.settings.regressionPct} %`)
      } catch (e) {
        P.toast(e.message, 'error')
      }
    })
  }

  async function runCompare() {
    const c = state.compare
    const out = refs.compareOut
    if (!out) return
    P.clear(out)
    if (!c.a || !c.b || c.a === c.b) {
      out.appendChild(P.banner('info', 'Choisissez deux runs différents.'))
      return
    }
    out.appendChild(h('div', { class: 'p-row p-faint' }, h('span', { class: 'p-spinner' }), 'Comparaison en cours…'))
    const pct = Number(document.getElementById('cmp-pct')?.value) || state.settings.regressionPct
    try {
      const [res, da, db] = await Promise.all([
        P.api(`/api/perf/compare?a=${encodeURIComponent(c.a)}&b=${encodeURIComponent(c.b)}&threshold=${pct}`),
        P.api(`/api/perf/runs/${encodeURIComponent(c.a)}`),
        P.api(`/api/perf/runs/${encodeURIComponent(c.b)}`),
      ])
      P.clear(out)
      const tone = res.verdict === 'regression' ? 'error' : res.verdict === 'improvement' ? 'info' : 'blue'
      const msg = res.verdict === 'regression'
        ? `Régression : ${res.regressions} indicateur(s) se dégradent de plus de ${nf(res.regressionPct)} %${res.thresholdChanges.some((t) => t.before && !t.after) ? ', et des seuils auparavant respectés ne le sont plus' : ''}.`
        : res.verdict === 'improvement' ? `Amélioration : ${res.improvements} indicateur(s) progressent de plus de ${nf(res.regressionPct)} %.` : `Stable : aucun écart significatif au-delà de ${nf(res.regressionPct)} %.`
      out.appendChild(P.banner(tone, [h('b', null, msg), !res.sameProfile ? ' Attention : les deux runs n’utilisent pas le même profil.' : '', res.a.simulated || res.b.simulated ? ' ◇ Au moins un des runs est simulé.' : '']))
      const body = h('div', { class: 'p-stack', style: { gap: '14px' } }, compareTable(res.rows))
      if (res.thresholdChanges.length) {
        body.appendChild(h('div', { class: 'p-stack' },
          h('div', { class: 'p-section-label' }, 'Seuils dont le résultat change'),
          h('div', { class: 'p-row' }, res.thresholdChanges.map((t) => P.badge(`${t.metric} ${t.rule} : ${t.before ? 'respecté' : 'non respecté'} → ${t.after ? 'respecté' : 'non respecté'}`, t.after ? 'mint' : 'red')))))
      }
      if (da.series?.length || db.series?.length) {
        const pts = (s) => (s || []).map((p) => ({ t: p.t, v: p.p95 }))
        body.appendChild(h('div', { class: 'perf-charts' },
          lineChart({
            title: 'Temps de réponse p95 au fil du test',
            series: [{ points: pts(da.series), cls: 'a' }, { points: pts(db.series), cls: 'b' }],
            format: (v, axis) => (axis ? nf(v) : fmtMs(v)),
            legend: h('div', { class: 'perf-legend' }, h('span', null, h('i', { class: 'a' }), 'A — référence'), h('span', null, h('i'), 'B — candidat')),
          }),
          lineChart({
            title: 'Requêtes par seconde',
            series: [{ points: (da.series || []).map((p) => ({ t: p.t, v: p.rps })), cls: 'a' }, { points: (db.series || []).map((p) => ({ t: p.t, v: p.rps })), cls: 'b' }],
            format: (v) => nf(v, 1),
            legend: h('div', { class: 'perf-legend' }, h('span', null, h('i', { class: 'a' }), 'A — référence'), h('span', null, h('i'), 'B — candidat')),
          })))
      }
      const bProfile = state.profiles.find((p) => p.id === res.b.profileId)
      const canSetBaseline = bProfile && res.sameProfile && bProfile.baselineRunId !== res.b.id && res.b.status === 'passed'
      out.appendChild(P.card({
        title: `${res.b.profileName} : B comparé à A`,
        sub: `A ${P.fmtDate(res.a.startedAt)}${res.a.simulated ? ' ◇' : ''} · B ${P.fmtDate(res.b.startedAt)}${res.b.simulated ? ' ◇' : ''}`,
        icon: 'barChart',
        actions: canSetBaseline ? h('button', { class: 'p-btn p-btn--sm', type: 'button', onclick: (e) => setBaseline(e.currentTarget, res.b.profileId, res.b.id, db).then(renderCompare) }, P.icon('target'), 'Faire de B la référence') : null,
        body,
      }))
    } catch (e) {
      P.clear(out)
      out.appendChild(P.banner('error', [h('b', null, 'Comparaison impossible : '), e.message]))
    }
  }

  // ------------------------------------------------------------------ onglet « Exigences des récits »

  function renderRequirements() {
    const panel = refs.panels.reqs
    P.clear(panel)
    const data = state.requirements
    if (!data) {
      panel.appendChild(h('div', { class: 'p-row p-faint' }, h('span', { class: 'p-spinner' }), 'Analyse des récits…'))
      return
    }
    if (data.error) {
      panel.appendChild(P.banner('error', [h('b', null, 'Analyse impossible : '), data.error, ' ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); reloadRequirements() } }, 'Réessayer')]))
      return
    }
    panel.appendChild(P.banner(data.source === 'demo' ? 'warn' : 'blue', data.source === 'demo'
      ? [h('b', null, state.reqDemo ? 'Récits de démonstration (projet IRMA). ' : 'Récits de démonstration. '), state.reqDemo ? h('a', { href: '#', onclick: (e) => { e.preventDefault(); state.reqDemo = false; reloadRequirements() } }, 'Revenir à vos récits JIRA') : 'Scannez vos récits JIRA depuis la page Récits pour analyser vos propres exigences.']
      : [h('b', null, `${data.analyzed} récits analysés`), data.scannedAt ? ` (scan du ${P.fmtDate(data.scannedAt)})` : '', ' : description et critères d’acceptation.']))
    panel.appendChild(h('div', { class: 'p-row p-row--between' },
      h('div', { class: 'p-muted' }, `${data.items.length} récit(s) porteur(s) d’une exigence de performance sur ${data.analyzed} analysé(s). Règles : « en moins de N s/ms », « N utilisateurs simultanés », « N requêtes par seconde », « disponibilité de N % », pic, endurance.`),
      h('button', { class: 'p-btn p-btn--sm p-btn--ghost', type: 'button', onclick: (e) => P.busy(e.currentTarget, reloadRequirements) }, P.icon('refresh'), 'Réanalyser')))
    if (!data.items.length) {
      panel.appendChild(P.empty('Aucune exigence de performance détectée', 'Aucun récit ne mentionne de temps de réponse, de nombre d’utilisateurs simultanés, de débit ou de disponibilité chiffrés. Ajoutez-les aux critères d’acceptation (par exemple « la liste s’affiche en moins de 2 s pour 200 utilisateurs simultanés »).', 'fileText',
        data.demoAvailable ? h('button', { class: 'p-btn', type: 'button', onclick: () => { state.reqDemo = true; reloadRequirements() } }, P.icon('eye'), 'Voir un exemple avec les récits de démonstration') : null))
      return
    }
    panel.appendChild(h('div', { class: 'perf-req-list' }, data.items.map(requirementCard)))
  }

  async function reloadRequirements() {
    state.requirements = null
    renderRequirements()
    await loadRequirements()
    refreshHeader()
    renderRequirements()
  }

  function requirementCard(item) {
    const p = item.proposal
    const vus = h('input', { class: 'p-input', type: 'number', min: 1, value: p.vus, 'aria-label': 'Utilisateurs virtuels' })
    const duration = h('input', { class: 'p-input', type: 'text', value: p.duration, 'aria-label': 'Durée' })
    const p95 = h('input', { class: 'p-input', type: 'number', min: 1, value: p.p95Ms, 'aria-label': 'Seuil p95 (ms)' })
    const action = item.profile
      ? h('div', { class: 'p-row' },
        P.status(`Profil « ${item.profile.name} »`, 'mint'),
        h('button', { class: 'p-btn p-btn--sm p-btn--primary', type: 'button', onclick: () => { state.selected = item.profile.id; save('profile', item.profile.id); switchTab('launch'); renderLaunch() } }, P.icon('play'), 'Lancer'))
      : h('button', { class: 'p-btn p-btn--primary p-btn--sm', type: 'button', onclick: (e) => createFromStory(e.currentTarget, item, { vus: Number(vus.value), duration: duration.value.trim(), p95Ms: Number(p95.value) }) }, P.icon('plus'), 'Créer le profil')
    return P.card({
      title: h('span', null, /^https?:\/\//i.test(item.url || '') ? h('a', { href: item.url, target: '_blank', rel: 'noopener noreferrer' }, item.key) : item.key, ' — ', item.summary),
      sub: [item.epic?.summary, item.status].filter(Boolean).join(' · '),
      icon: 'fileText',
      tone: 'blue',
      body: h('div', { class: 'p-stack', style: { gap: '10px' } },
        h('div', { class: 'p-row' }, item.requirements.map((r) => P.badge(`${r.label} : ${r.display}`, r.type === 'response' ? 'teal' : r.type === 'availability' ? 'purple' : 'blue'))),
        h('div', { class: 'p-stack', style: { gap: '4px' } }, item.requirements.map((r) => h('div', { class: 'perf-req-match' }, h('b', null, `${r.label} — `), `« ${r.excerpt} »`))),
        h('hr', { class: 'p-divider' }),
        h('div', { class: 'p-section-label' }, `Profil proposé : ${OBJECTIVES[p.objective] || p.objective} · ${EXECUTORS[p.executorType] || p.executorType}`),
        h('div', { class: 'p-form-grid' },
          h('div', { class: 'p-field' }, h('label', null, 'Utilisateurs virtuels'), vus),
          h('div', { class: 'p-field' }, h('label', null, 'Durée du palier'), duration),
          h('div', { class: 'p-field' }, h('label', null, 'Seuil p95 (ms)'), p95),
          h('div', { class: 'p-field' }, h('label', null, 'Erreurs tolérées'), h('div', { class: 'p-input', style: { display: 'flex', alignItems: 'center', background: 'var(--p-surface-soft)' } }, `< ${nf(p.maxErrorRate, 2)} %`))),
        h('div', { class: 'p-faint' }, 'Chemins : ', h('span', { class: 'p-mono' }, p.entryPaths.join('  '))),
        h('ul', { class: 'perf-req-rationale' }, p.rationale.map((r) => h('li', null, r))),
        h('div', { class: 'p-row p-row--between' }, h('span', { class: 'p-faint' }, item.source === 'demo' ? 'Récit de démonstration' : 'Récit JIRA'), action)),
    })
  }

  async function createFromStory(button, item, overrides) {
    await P.busy(button, async () => {
      try {
        const res = await P.api(`/api/perf/requirements/${encodeURIComponent(item.key)}/profile`, { body: overrides })
        P.toast(`Profil « ${res.profile.name} » créé`)
        await Promise.all([loadProfiles(), loadRequirements()])
        state.selected = res.profile.id
        save('profile', res.profile.id)
        refreshHeader()
        renderRequirements()
        renderLaunch()
      } catch (e) {
        P.toast(e.message, 'error', 7000)
      }
    })
  }

  // ------------------------------------------------------------------ démarrage

  async function init() {
    P.shell?.setActions?.(
      h('a', { class: 'p-btn p-btn--ghost', href: '/k6-wizard.html' }, P.icon('edit'), 'Scénarios k6'),
      h('button', { class: 'p-btn', type: 'button', onclick: (e) => P.busy(e.currentTarget, refreshAll) }, P.icon('refresh'), 'Actualiser'))
    state.mode = ['auto', 'real', 'simulate'].includes(load('mode')) ? load('mode') : 'auto'
    const savedTab = load('tab')
    state.tab = ['launch', 'runs', 'compare', 'reqs'].includes(savedTab) ? savedTab : 'launch'
    try {
      await Promise.all([loadProfiles(), loadRuns()])
    } catch (e) {
      const app = document.getElementById('app')
      P.clear(app)
      app.appendChild(P.banner('error', [h('b', null, 'Impossible de charger l’écran Performance : '), e.message, ' ', h('a', { href: location.pathname }, 'Recharger')]))
      return
    }
    renderShell()
    refreshHeader()
    renderLaunch()
    switchTab(state.tab)
    loadRequirements().then(() => { refreshHeader(); if (state.tab === 'reqs') renderRequirements() })

    const fromHash = (location.hash.match(/run=([\w-]+)/) || [])[1]
    const running = state.runs.find((r) => r.status === 'running')
    if (fromHash && state.runs.some((r) => r.id === fromHash)) await attachRun(fromHash, { scroll: false })
    else if (running) await attachRun(running.id, { scroll: false })
  }

  async function refreshAll() {
    await Promise.all([loadProfiles(), loadRuns(), loadRequirements()])
    refreshHeader()
    renderLaunch()
    if (state.tab !== 'launch') switchTab(state.tab)
  }

  P.whenShell().then(init)
})()

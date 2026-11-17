/*
 * Récits et Gherkin : liste des récits scannés (maître) et, pour le récit choisi (détail),
 * critères d'acceptation, génération des scénarios (IA ou modèle intégré), relecture, validation, export.
 * Lien profond : /recits.html?key=PROJ-12
 */
;(function () {
  'use strict'
  const P = window.Prisme
  const { h } = P

  const TABS = [
    { id: 'all', label: 'Tous' },
    { id: 'none', label: 'Sans scénario' },
    { id: 'draft', label: 'Brouillons' },
    { id: 'validated', label: 'Validés' },
  ]
  const GENERATOR_LABEL = { llm: 'Assistant IA', template: 'Modèle intégré', manual: 'IA (copier-coller)', edit: 'Saisie manuelle' }
  const SEVERITY = { error: { icon: 'xCircle', label: 'Erreur' }, warning: { icon: 'alert', label: 'Avertissement' }, info: { icon: 'info', label: 'Conseil' } }
  const VIEW_KEY = 'wizardqa.recits.view'

  const state = {
    user: null,
    stories: [],
    index: {},
    summary: null,
    scan: null,
    featuresDir: 'tests/features',
    llm: null,                   // GET /api/llm/status
    filters: { q: '', epic: '', status: '' },
    tab: 'all',
    key: null,
    detail: null,                // GET /api/gherkin/:key
    text: '',
    dirty: false,
    analysis: null,              // dernière analyse (en direct)
    busy: null,                  // 'llm' | 'template' | 'save' | 'validate' | 'export'
    view: readView(),
    batch: null,                 // { jobId, total, items: Map, summary, error, es }
  }
  const ui = {}
  const app = document.getElementById('app')
  let lintTimer = null
  let lintSeq = 0

  P.whenShell().then(init)

  // ------------------------------------------------------------ démarrage et données

  async function init(ready) {
    state.user = ready?.user || null
    try {
      await Promise.all([loadStories(), loadIndex(), loadLlm()])
    } catch (e) {
      P.clear(app)
      app.appendChild(errorBanner(e, 'Impossible de charger les récits.'))
      app.appendChild(h('div', null, h('button', { class: 'p-btn', type: 'button', onclick: () => location.reload() }, P.icon('refresh'), 'Réessayer')))
      return
    }
    buildLayout()
    const wanted = new URLSearchParams(location.search).get('key')
    const first = wanted && state.stories.find((s) => s.key.toUpperCase() === wanted.toUpperCase())
    if (first) select(first.key, { force: true })
    else if (wanted) P.toast(`Récit ${wanted} introuvable dans le dernier scan.`, 'warn')
    if (!first && state.stories.length) select(visibleStories()[0]?.key || state.stories[0].key, { force: true, silentUrl: true })
    if (state.batchInfo) attachBatch(state.batchInfo.jobId, state.batchInfo.total)
    window.addEventListener('beforeunload', (e) => {
      if (!state.dirty) return
      e.preventDefault()
      e.returnValue = ''
    })
  }

  async function loadStories() {
    const r = await P.api('/api/jira/stories')
    state.stories = r.stories || []
  }

  async function loadIndex() {
    const r = await P.api('/api/gherkin')
    state.index = r.index || {}
    state.summary = r.summary
    state.scan = r.scan
    state.featuresDir = r.featuresDir || state.featuresDir
    state.batchInfo = r.batch
  }

  async function loadLlm() {
    try {
      state.llm = await P.api('/api/llm/status')
    } catch {
      state.llm = null
    }
  }

  async function refreshIndex() {
    try {
      await loadIndex()
    } catch {
      return
    }
    renderSummary()
    renderTabs()
    renderList()
  }

  function readView() {
    try {
      const v = localStorage.getItem(VIEW_KEY)
      return ['split', 'edit', 'preview'].includes(v) ? v : 'split'
    } catch {
      return 'split'
    }
  }

  // ------------------------------------------------------------ filtres

  const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

  function matchesFilters(s) {
    const f = state.filters
    if (f.epic && (f.epic === 'none' ? s.epic : s.epic?.key !== f.epic)) return false
    if (f.status && s.status !== f.status) return false
    if (f.q) {
      const hay = fold([s.key, s.summary, s.descriptionText, ...(s.acceptanceCriteria || []), ...(s.labels || [])].join('\n'))
      if (!fold(f.q).split(/\s+/).filter(Boolean).every((t) => hay.includes(t))) return false
    }
    return true
  }

  function inTab(s, tab) {
    const e = state.index[s.key]
    if (tab === 'none') return !e
    if (tab === 'draft') return e?.status === 'draft'
    if (tab === 'validated') return e?.status === 'validated'
    return true
  }

  const filtered = () => state.stories.filter(matchesFilters)
  const visibleStories = () => filtered().filter((s) => inTab(s, state.tab))

  // ------------------------------------------------------------ mise en page

  function buildLayout() {
    P.clear(app)
    renderActions()
    app.appendChild(h('p', { class: 'p-page-intro' },
      'Transformez chaque récit JIRA en scénarios de test Gherkin : générez-les avec l’assistant IA (Copilot ou autre) ou le modèle intégré, relisez-les, validez-les puis exportez les fichiers .feature dans le projet de test.'))
    if (!state.stories.length) {
      app.appendChild(noStories())
      return
    }
    ui.batch = h('div')
    ui.summary = h('div', { class: 'p-kpis' })
    ui.toolbar = toolbar()
    ui.tabs = h('div')
    ui.list = h('div', { class: 'p-list rc-list', role: 'listbox', 'aria-label': 'Récits' })
    ui.detail = h('div', { class: 'rc-detail' })
    app.append(ui.batch, ui.summary, ui.toolbar, ui.tabs,
      h('div', { class: 'p-grid p-grid-aside rc-layout' },
        P.card({ className: 'rc-list-card', flush: true, body: ui.list }),
        ui.detail))
    ui.tabsCtl = P.tabs(ui.tabs, tabItems(), state.tab, (id) => {
      state.tab = id
      renderList()
    })
    renderSummary()
    renderList()
    renderDetail()
  }

  function renderActions() {
    if (!P.shell) return
    if (!state.stories.length) {
      P.shell.setActions(h('a', { class: 'p-btn p-btn--primary', href: '/connaissance.html' }, P.icon('compass'), 'Prise de connaissance'))
      return
    }
    P.shell.setActions(
      h('button', { class: 'p-btn', type: 'button', onclick: exportValidated }, P.icon('download'), 'Exporter les validés'),
      h('button', { class: 'p-btn p-btn--primary', type: 'button', onclick: openBatchDialog }, P.icon('wand'), 'Générer pour tous les récits sans scénario'))
  }

  function noStories() {
    const btn = h('button', { class: 'p-btn p-btn--primary', type: 'button', onclick: (e) => runDemoScan(e.currentTarget) }, P.icon('play'), 'Lancer le scan de démonstration')
    return P.card({
      body: P.empty('Aucun récit scanné',
        'Les récits et leurs critères d’acceptation viennent du scan JIRA. Lancez-le depuis la prise de connaissance, ou essayez tout de suite avec le projet de démonstration IRMA.',
        'listChecks',
        h('div', { class: 'p-row', style: { justifyContent: 'center', marginTop: '10px' } },
          btn, h('a', { class: 'p-btn', href: '/connaissance.html#connexion' }, P.icon('link'), 'Connecter JIRA'))),
    })
  }

  async function runDemoScan(button) {
    await P.busy(button, async () => {
      try {
        const r = await P.api('/api/jira/scan', { body: { mode: 'demo' } })
        await new Promise((resolve, reject) => {
          const es = P.stream(`/api/jira/scan/${r.jobId}/events`, {
            done: () => { es.close(); resolve() },
            error: (d) => { es.close(); reject(new Error(d?.message || 'Échec du scan.')) },
          }, () => { es.close(); reject(new Error('Connexion au suivi du scan perdue.')) })
        })
        P.toast('Scan de démonstration terminé')
        location.reload()
      } catch (e) {
        P.toast(e.message, 'error', 7000)
      }
    })
  }

  // ------------------------------------------------------------ indicateurs, barre de filtres, onglets

  function renderSummary() {
    if (!ui.summary) return
    const s = state.summary || {}
    const pct = s.total ? Math.round((s.covered / s.total) * 100) : 0
    P.clear(ui.summary)
    ui.summary.append(
      P.kpi({ label: 'Récits', value: s.total ?? 0, detail: s.withoutCriteria ? `${s.withoutCriteria} sans critère d’acceptation` : 'Tous ont des critères', tone: '' }),
      P.kpi({ label: 'Couverture Gherkin', value: pct, unit: '%', detail: `${s.covered ?? 0} récit(s) avec scénarios` }),
      P.kpi({ label: 'Brouillons à relire', value: s.drafts ?? 0, detail: s.withErrors ? `${s.withErrors} avec erreurs` : 'Aucune erreur bloquante', tone: s.drafts ? 'amber' : '' }),
      P.kpi({ label: 'Validés', value: s.validated ?? 0, detail: s.total ? `sur ${s.total} récits` : '', tone: s.validated && s.validated === s.total ? 'mint' : '' }),
      P.kpi({ label: 'Exportés', value: s.exported ?? 0, detail: `${state.featuresDir}/` }))
  }

  function toolbar() {
    const epics = new Map()
    state.stories.forEach((s) => { if (s.epic) epics.set(s.epic.key, s.epic.summary) })
    const statuses = [...new Set(state.stories.map((s) => s.status).filter(Boolean))].sort()
    const search = h('input', {
      class: 'p-input', type: 'search', placeholder: 'Rechercher (clé, titre, critère…)', 'aria-label': 'Rechercher un récit',
      oninput: (e) => { state.filters.q = e.target.value; refreshFilters() },
    })
    const epicSel = h('select', { class: 'p-select', 'aria-label': 'Épopée', onchange: (e) => { state.filters.epic = e.target.value; refreshFilters() } },
      h('option', { value: '' }, 'Toutes les épopées'),
      [...epics].map(([k, v]) => h('option', { value: k }, `${k} — ${v}`)),
      state.stories.some((s) => !s.epic) ? h('option', { value: 'none' }, 'Sans épopée') : null)
    const statusSel = h('select', { class: 'p-select', 'aria-label': 'Statut JIRA', onchange: (e) => { state.filters.status = e.target.value; refreshFilters() } },
      h('option', { value: '' }, 'Tous les statuts JIRA'),
      statuses.map((s) => h('option', { value: s }, s)))
    ui.count = h('span', { class: 'p-toolbar-count' })
    const scan = state.scan
    return h('div', { class: 'p-toolbar' }, P.icon('filter'), search, epicSel, statusSel, ui.count, h('span', { class: 'p-spacer' }),
      scan ? h('span', { class: 'p-muted', style: { fontSize: '12px' } },
        `Scan ${scan.source === 'demo' ? 'de démonstration' : 'JIRA'} · ${P.fmtAgo(scan.scannedAt)}`) : null)
  }

  function refreshFilters() {
    renderTabs()
    renderList()
  }

  function tabItems() {
    const base = filtered()
    return TABS.map((t) => ({
      ...t,
      count: base.filter((s) => inTab(s, t.id)).length,
      tone: t.id === 'draft' ? 'amber' : t.id === 'validated' ? 'mint' : '',
    }))
  }

  function renderTabs() {
    if (ui.tabsCtl) ui.tabsCtl.update(tabItems())
  }

  // ------------------------------------------------------------ liste maître

  function gherkinBadge(key) {
    const e = state.index[key]
    if (!e) return P.badge('Aucun scénario', 'outline')
    if (e.status === 'validated') return e.exported ? P.badge('Exporté', 'teal') : P.badge('Validé', 'mint')
    if (e.errors) return P.badge(`${e.errors} erreur${e.errors > 1 ? 's' : ''}`, 'red')
    return P.badge('Brouillon', 'amber')
  }

  function renderList() {
    if (!ui.list) return
    const list = visibleStories()
    ui.count.textContent = `${list.length} récit${list.length > 1 ? 's' : ''}`
    P.clear(ui.list)
    if (!list.length) {
      ui.list.appendChild(P.empty('Aucun récit', state.tab === 'none' ? 'Tous les récits filtrés ont déjà des scénarios.' : 'Aucun récit ne correspond aux filtres.', 'search'))
      return
    }
    let group = null
    for (const s of list) {
      const g = s.epic ? `${s.epic.key} · ${s.epic.summary}` : 'Sans épopée'
      if (g !== group && !state.filters.epic) {
        group = g
        ui.list.appendChild(h('div', { class: 'p-list-group p-ellipsis', title: g }, g))
      }
      const n = s.acceptanceCriteria?.length || 0
      ui.list.appendChild(h('button', {
        class: `p-list-item ${s.key === state.key ? 'active' : ''}`,
        type: 'button',
        role: 'option',
        'aria-selected': s.key === state.key ? 'true' : 'false',
        dataset: { key: s.key },
        onclick: () => select(s.key),
      },
      h('div', { class: 'rc-item-top' }, h('span', { class: 'rc-item-key' }, s.key), gherkinBadge(s.key)),
      h('div', { class: 'p-list-item-title rc-item-title' }, s.summary),
      h('div', { class: 'p-list-item-meta' }, `${s.status || '—'} · ${n ? `${n} critère${n > 1 ? 's' : ''}` : 'aucun critère'}`)))
    }
  }

  function markActive() {
    ui.list?.querySelectorAll('.p-list-item').forEach((el) => {
      const on = el.dataset.key === state.key
      el.classList.toggle('active', on)
      el.setAttribute('aria-selected', on ? 'true' : 'false')
    })
  }

  // ------------------------------------------------------------ sélection d'un récit

  async function select(key, { force = false, silentUrl = false } = {}) {
    if (!force && key === state.key) return
    if (state.dirty && !(await P.confirm('Les modifications du Gherkin ne sont pas enregistrées. Les abandonner ?', { title: 'Modifications non enregistrées', okLabel: 'Abandonner', danger: true }))) return
    // Une analyse en direct encore en attente concerne l'ancien récit : on l'abandonne.
    clearTimeout(lintTimer)
    lintSeq += 1
    state.key = key
    state.detail = null
    state.dirty = false
    state.analysis = null
    if (!silentUrl) history.replaceState(null, '', `${location.pathname}?key=${encodeURIComponent(key)}`)
    markActive()
    renderDetail()
    try {
      const d = await P.api(`/api/gherkin/${encodeURIComponent(key)}`)
      if (state.key !== key) return
      state.detail = d
      state.text = d.entry?.text || ''
      state.analysis = d.analysis
    } catch (e) {
      if (state.key !== key) return
      state.detail = { error: e }
    }
    renderDetail()
  }

  const story = () => state.detail?.story || state.stories.find((s) => s.key === state.key) || null
  const entry = () => state.detail?.entry || null

  // ------------------------------------------------------------ détail

  function renderDetail() {
    if (!ui.detail) return
    P.clear(ui.detail)
    if (!state.key) {
      ui.detail.appendChild(P.card({ body: P.empty('Choisissez un récit', 'Sélectionnez un récit dans la liste pour voir ses critères et ses scénarios.', 'listChecks') }))
      return
    }
    if (state.detail?.error) {
      ui.detail.append(errorBanner(state.detail.error, 'Impossible de charger le récit.'),
        h('div', null, h('button', { class: 'p-btn', type: 'button', onclick: () => select(state.key, { force: true }) }, P.icon('refresh'), 'Réessayer')))
      return
    }
    const s = story()
    if (!s) return
    ui.detail.append(headCard(s), P.card({ className: 'rc-stepper', body: P.stepper(stepItems(s)) }))
    if (!state.detail) {
      ui.detail.appendChild(P.card({ body: h('div', { class: 'p-empty' }, h('span', { class: 'p-spinner' }), h('div', null, 'Chargement des scénarios…')) }))
      return
    }
    ui.detail.append(h('div', { class: 'p-grid p-grid-2' }, descriptionCard(s), criteriaCard(s)), editorCard(s))
  }

  function headCard(s) {
    // Lien JIRA : uniquement http(s), jamais un « javascript: » venu des données scannées.
    const link = s.source === 'jira' && /^https?:\/\//i.test(s.url || '')
      ? h('a', { class: 'p-btn p-btn--sm', href: s.url, target: '_blank', rel: 'noopener noreferrer' }, P.icon('external'), 'Ouvrir dans JIRA')
      : s.source === 'demo' ? P.badge('Donnée de démonstration', 'purple') : null
    return P.card({
      body: h('div', null,
        h('div', { class: 'p-row p-row--between' },
          h('span', { class: 'rc-head-key' }, `${s.issueType || 'Récit'} · ${s.key}`),
          link),
        h('h2', { class: 'rc-head-title' }, s.summary),
        h('div', { class: 'p-row' },
          P.badge(s.status || 'Statut inconnu', 'blue', 'Statut JIRA'),
          s.priority ? P.badge(`Priorité ${s.priority}`, /critique|haute|high|critical/i.test(s.priority) ? 'red' : 'outline') : null,
          s.epic ? P.badge(`${s.epic.key} · ${s.epic.summary}`, 'purple', 'Épopée') : P.badge('Sans épopée', 'outline'),
          (s.labels || []).map((l) => h('span', { class: 'p-tag' }, l)),
          (s.fixVersions || []).length ? h('span', { class: 'p-muted', style: { fontSize: '12px' } }, `Version : ${s.fixVersions.join(', ')}`) : null,
          s.assignee ? h('span', { class: 'p-muted', style: { fontSize: '12px' } }, `Assigné à ${s.assignee}`) : null)),
    })
  }

  function stepItems(s) {
    const e = entry()
    const errors = state.analysis?.counts?.error || 0
    const n = s.acceptanceCriteria?.length || 0
    const generating = state.busy === 'llm' || state.busy === 'template'
    const validated = e?.status === 'validated' && !state.dirty
    const exported = validated && e.exported
    return [
      { label: 'Récit', sub: s.status || '', state: 'done' },
      { label: 'Critères', sub: n ? `${n} critère${n > 1 ? 's' : ''}` : 'Aucun : à clarifier', state: n ? 'done' : 'failed' },
      { label: 'Génération', sub: generating ? 'En cours…' : e ? GENERATOR_LABEL[e.generatedBy] || e.generatedBy : 'À lancer', state: generating ? 'running' : e ? 'done' : 'current' },
      { label: 'Relecture', sub: !e ? '' : errors ? `${errors} erreur${errors > 1 ? 's' : ''}` : 'Sans erreur', state: !e ? 'todo' : validated ? 'done' : errors ? 'failed' : 'current' },
      { label: 'Validé', sub: validated ? P.fmtAgo(e.validatedAt) : '', state: validated ? 'done' : 'todo' },
      { label: 'Exporté', sub: exported ? 'Fichier à jour' : e?.exportedAt ? 'À réexporter' : '', state: exported ? 'done' : validated ? 'current' : 'todo' },
    ]
  }

  function descriptionCard(s) {
    const related = []
    if (s.links?.length) related.push(h('div', null, h('b', null, 'Liens : '), s.links.map((l) => `${l.key} (${l.type || 'lien'})`).join(', ')))
    if (s.subtasks?.length) related.push(h('div', null, h('b', null, 'Sous-tâches : '), s.subtasks.map((t) => `${t.key} ${t.summary}`).join(' · ')))
    return P.card({
      title: 'Description',
      icon: 'fileText',
      tone: 'grey',
      body: h('div', null,
        s.descriptionText ? h('p', { class: 'rc-description' }, s.descriptionText) : h('p', { class: 'p-muted', style: { margin: 0 } }, 'Description vide dans JIRA.'),
        related.length ? h('div', { class: 'rc-related' }, related) : null),
    })
  }

  function criteriaCard(s) {
    const list = s.acceptanceCriteria || []
    const source = { field: 'champ dédié', description: 'extraits de la description', none: '' }[s.acceptanceCriteriaSource] || ''
    return P.card({
      title: 'Critères d’acceptation',
      sub: list.length ? `${list.length} critère${list.length > 1 ? 's' : ''}${source ? ` · ${source}` : ''}` : null,
      icon: 'listChecks',
      tone: list.length ? '' : 'amber',
      body: list.length
        ? h('ol', { class: 'rc-criteria' }, list.map((c) => h('li', null, c)))
        : P.banner('warn', h('div', null, h('b', null, 'Aucun critère d’acceptation.'),
          h('div', null, 'Le modèle intégré produira un squelette à compléter ; l’assistant IA signalera ses hypothèses par « # Question PO ». Pensez à faire préciser le récit.'))),
    })
  }

  // ------------------------------------------------------------ éditeur Gherkin

  function aiStatus() {
    const a = state.llm?.active
    if (a) return h('span', { class: 'rc-ai', title: 'Fournisseur d’IA utilisé en priorité' }, P.icon('bot'), 'IA : ', h('b', null, a.label), a.model ? ` · ${a.model}` : '')
    return h('span', { class: 'rc-ai' }, P.icon('bot'), 'IA : aucun fournisseur actif — mode copier-coller · ', h('a', { href: '/ia.html' }, 'configurer'))
  }

  function editorCard(s) {
    const e = entry()
    const sub = e
      ? `${e.status === 'validated' ? 'Validé' : 'Brouillon'} · ${GENERATOR_LABEL[e.generatedBy] || e.generatedBy}${e.provider && !['template', 'manual'].includes(e.provider) ? ` (${providerLabel(e.provider)})` : ''}${e.edited ? ', modifié à la main' : ''} · ${P.fmtAgo(e.updatedAt)}`
      : 'Aucun scénario pour ce récit'
    const genActions = h('div', { class: 'p-row' },
      button('Générer (IA)', 'sparkles', 'p-btn--primary', (ev) => generate('llm', ev.currentTarget), state.busy === 'llm'),
      button('Générer (modèle)', 'wand', '', (ev) => generate('template', ev.currentTarget), state.busy === 'template'))
    if (!e && !state.dirty && !state.text) {
      return P.card({
        title: 'Scénarios Gherkin', sub, icon: 'flask', actions: aiStatus(),
        body: P.empty('Pas encore de scénario',
          'Générez une première version avec l’assistant IA (Copilot local en priorité) ou avec le modèle intégré, sans IA, à partir des critères d’acceptation.',
          'sparkles',
          h('div', { class: 'p-row', style: { justifyContent: 'center', marginTop: '10px' } }, genActions,
            h('button', { class: 'p-btn p-btn--ghost', type: 'button', onclick: startBlank }, P.icon('edit'), 'Écrire à la main'),
            h('button', { class: 'p-btn p-btn--ghost', type: 'button', onclick: openManualFromPrompt }, P.icon('copy'), 'Copier le prompt'))),
      })
    }

    ui.source = h('textarea', {
      class: 'p-textarea rc-source', spellcheck: 'false', 'aria-label': 'Texte Gherkin',
      oninput: onEdit,
      onkeydown: onEditorKey,
    })
    ui.source.value = state.text
    ui.preview = h('pre', { class: 'p-code p-gherkin rc-preview', 'aria-label': 'Aperçu coloré' })
    ui.problems = h('div')
    ui.saveBtn = button('Enregistrer', 'save', '', (ev) => save(ev.currentTarget), state.busy === 'save')
    ui.saveBtn.disabled = !state.dirty
    const viewSeg = h('div', { class: 'p-seg', role: 'group', 'aria-label': 'Affichage' },
      [['edit', 'Édition'], ['split', 'Côte à côte'], ['preview', 'Aperçu']].map(([id, label]) => h('button', {
        type: 'button', class: state.view === id ? 'active' : '', onclick: () => setView(id),
      }, label)))
    ui.editor = h('div', { class: `rc-editor mode-${state.view}` }, ui.source, ui.preview)
    updatePreview()
    renderProblems()

    const validated = e?.status === 'validated' && !state.dirty
    const card = P.card({
      title: 'Scénarios Gherkin',
      sub,
      icon: 'flask',
      actions: aiStatus(),
      body: h('div', null,
        h('div', { class: 'rc-editor-bar' }, genActions, h('span', { class: 'p-spacer' }), viewSeg),
        e?.warnings?.length ? P.banner('info', h('div', null, h('b', null, 'À relire : '), e.warnings.join(' '))) : null,
        ui.editor,
        ui.problems),
      className: 'rc-editor-card',
    })
    card.appendChild(h('div', { class: 'p-card-foot' },
      ui.saveBtn,
      button(validated ? 'Validé' : 'Valider', 'checkCircle', validated ? '' : 'p-btn--primary', (ev) => validate(ev.currentTarget), state.busy === 'validate', validated),
      button('Exporter', 'download', '', (ev) => exportOne(ev.currentTarget), state.busy === 'export'),
      h('span', { class: 'p-spacer' }),
      e?.versions?.length ? h('button', { class: 'p-btn p-btn--ghost p-btn--sm', type: 'button', onclick: openHistory }, P.icon('clock'), `Historique (${e.versions.length})`) : null,
      h('button', { class: 'p-btn p-btn--ghost p-btn--sm', type: 'button', onclick: openManualFromPrompt, title: 'Copier le prompt pour un assistant externe et coller sa réponse' }, P.icon('copy'), 'Prompt manuel'),
      h('button', { class: 'p-btn p-btn--ghost p-btn--sm', type: 'button', onclick: () => P.copy(state.text) }, P.icon('copy'), 'Copier'),
      e?.exportedPath ? h('span', { class: 'p-muted', style: { fontSize: '12px' }, title: 'Fichier exporté' }, e.exportedPath) : h('span', { class: 'p-muted', style: { fontSize: '12px' } }, state.detail.exportPath)))
    return card
  }

  function button(label, iconName, kind, onclick, isBusy = false, disabled = false) {
    const b = h('button', { class: `p-btn ${kind} ${isBusy ? 'is-busy' : ''}`, type: 'button', onclick }, P.icon(iconName), label)
    b.disabled = Boolean(isBusy || disabled || (state.busy && !isBusy))
    return b
  }

  function providerLabel(id) {
    return state.llm?.providers?.find((p) => p.id === id)?.label || id
  }

  function setView(view) {
    state.view = view
    try { localStorage.setItem(VIEW_KEY, view) } catch { /* stockage indisponible */ }
    ui.editor.className = `rc-editor mode-${view}`
    ui.editor.parentNode.querySelectorAll('.p-seg button').forEach((b, i) => b.classList.toggle('active', ['edit', 'split', 'preview'][i] === view))
  }

  function updatePreview() {
    if (ui.preview) ui.preview.innerHTML = P.gherkinHtml(state.text) || '<span class="cmt"># Rien à afficher</span>'
  }

  function onEdit() {
    state.text = ui.source.value
    if (!state.dirty) {
      state.dirty = true
      renderDirtyState()
    }
    updatePreview()
    clearTimeout(lintTimer)
    lintTimer = setTimeout(lintNow, 350)
  }

  function onEditorKey(e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault()
      if (state.dirty) save(ui.saveBtn)
      return
    }
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault()
      const el = ui.source
      const start = el.selectionStart
      el.setRangeText('  ', start, el.selectionEnd, 'end')
      onEdit()
    }
  }

  function renderDirtyState() {
    if (ui.saveBtn) ui.saveBtn.disabled = !state.dirty || Boolean(state.busy)
    const stepCard = ui.detail.querySelector('.rc-stepper .p-card-body')
    if (stepCard) P.clear(stepCard).appendChild(P.stepper(stepItems(story())))
  }

  async function lintNow() {
    const seq = ++lintSeq
    try {
      const r = await P.api('/api/gherkin/lint', { body: { text: state.text, key: state.key } })
      if (seq !== lintSeq) return
      state.analysis = r
      renderProblems()
      renderDirtyState()
    } catch { /* l'analyse en direct est facultative */ }
  }

  function renderProblems() {
    if (!ui.problems) return
    P.clear(ui.problems)
    const a = state.analysis
    if (!a) return
    const c = a.counts
    const head = h('div', { class: 'p-row', style: { marginTop: '12px' } },
      a.valid ? P.status('Syntaxe et contrôles qualité : aucune erreur bloquante', 'mint') : P.status(`${c.error} erreur${c.error > 1 ? 's' : ''} bloquante${c.error > 1 ? 's' : ''}`, 'red'),
      c.warning ? P.badge(`${c.warning} avertissement${c.warning > 1 ? 's' : ''}`, 'amber') : null,
      c.info ? P.badge(`${c.info} conseil${c.info > 1 ? 's' : ''}`, 'blue') : null,
      h('span', { class: 'p-spacer' }),
      h('span', { class: 'p-muted', style: { fontSize: '12px' } }, `${a.scenarios} scénario${a.scenarios > 1 ? 's' : ''} · ${a.cases} cas`))
    ui.problems.appendChild(head)
    if (a.outline?.length) {
      ui.problems.appendChild(h('div', { class: 'rc-outline' }, a.outline.map((sc) => h('button', {
        class: 'p-chip', type: 'button', title: `Ligne ${sc.line} — ${sc.tags.join(' ')}`, onclick: () => goToLine(sc.line),
      }, P.icon(sc.outline ? 'layers' : 'play'), h('span', null, sc.name || '(sans titre)'), sc.outline ? h('small', null, `${sc.examples} ex.`) : null))))
    }
    if (a.problems.length) {
      ui.problems.appendChild(h('div', { class: 'rc-problems' }, a.problems.map((p) => h('button', {
        class: `rc-problem ${p.severity}`, type: 'button', onclick: () => goToLine(p.line), title: SEVERITY[p.severity].label,
      }, P.icon(SEVERITY[p.severity].icon), h('span', { class: 'rc-problem-line' }, `ligne ${p.line}`), h('span', null, p.message)))))
    }
  }

  /** Place le curseur sur une ligne du texte source. */
  function goToLine(line) {
    if (!ui.source) return
    if (state.view === 'preview') setView('split')
    const lines = ui.source.value.split('\n')
    const start = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0)
    const end = start + (lines[line - 1] || '').length
    ui.source.focus()
    ui.source.setSelectionRange(start, end)
    const lh = parseFloat(getComputedStyle(ui.source).lineHeight) || 19
    ui.source.scrollTop = Math.max(0, (line - 4) * lh)
  }

  function startBlank() {
    const s = story()
    const tags = [`@${s.key}`, s.epic ? `@${s.epic.key}` : null].filter(Boolean).join(' ')
    state.text = `# language: fr\n${tags}\nFonctionnalité: ${s.summary}\n\n  @smoke\n  Scénario: \n    Soit \n    Quand \n    Alors \n`
    state.dirty = true
    renderDetail()
    lintNow()
    setTimeout(() => goToLine(6), 50)
  }

  // ------------------------------------------------------------ actions

  /** Applique la réponse d'une route qui renvoie { entry, analysis }. */
  function applyEntry(r) {
    state.detail = { ...state.detail, entry: r.entry }
    state.text = r.entry.text
    state.analysis = r.analysis
    state.dirty = false
  }

  async function withBusy(kind, fn) {
    state.busy = kind
    renderDetail()
    try {
      return await fn()
    } finally {
      state.busy = null
      renderDetail()
      refreshIndex()
    }
  }

  async function generate(mode) {
    const e = entry()
    if (e || state.dirty) {
      const msg = e?.status === 'validated'
        ? 'Ce récit a des scénarios validés. Une nouvelle génération crée un brouillon (la version actuelle reste dans l’historique).'
        : 'Les scénarios actuels seront remplacés par une nouvelle proposition (la version enregistrée reste dans l’historique).'
      if (!(await P.confirm(msg, { title: 'Régénérer les scénarios ?', okLabel: 'Générer' }))) return
    }
    const key = state.key
    const slow = mode === 'llm' ? setTimeout(() => P.toast('L’assistant IA rédige les scénarios : cela peut prendre une à deux minutes.', 'ok', 6000), 2500) : null
    await withBusy(mode, async () => {
      try {
        const r = await P.api(`/api/gherkin/${encodeURIComponent(key)}/generate`, { body: { mode } })
        if (state.key !== key) return
        if (r.manual) {
          openManual(r.prompt, r.reason)
          return
        }
        applyEntry(r)
        const label = r.usedMode === 'llm' ? `l’assistant IA (${providerLabel(r.provider)}${r.model ? ` · ${r.model}` : ''})` : 'le modèle intégré'
        P.toast(`${r.analysis.scenarios} scénario${r.analysis.scenarios > 1 ? 's' : ''} généré${r.analysis.scenarios > 1 ? 's' : ''} par ${label}`)
        if (r.notice) P.toast(r.notice, r.analysis.valid ? 'warn' : 'error', 7000)
      } catch (err) {
        P.toast(messageOf(err), 'error', 8000)
      } finally {
        clearTimeout(slow)
      }
    })
  }

  async function save() {
    const key = state.key
    await withBusy('save', async () => {
      try {
        const r = await P.api(`/api/gherkin/${encodeURIComponent(key)}`, { method: 'PUT', body: { featureText: state.text } })
        if (state.key !== key) return
        applyEntry(r)
        P.toast(r.analysis.valid ? 'Brouillon enregistré' : `Brouillon enregistré, ${r.analysis.counts.error} erreur(s) à corriger avant validation`, r.analysis.valid ? 'ok' : 'warn')
      } catch (err) {
        P.toast(messageOf(err), 'error', 7000)
      }
    })
  }

  async function validate() {
    const key = state.key
    await withBusy('validate', async () => {
      try {
        if (state.dirty) applyEntry(await P.api(`/api/gherkin/${encodeURIComponent(key)}`, { method: 'PUT', body: { featureText: state.text } }))
        const r = await P.api(`/api/gherkin/${encodeURIComponent(key)}/validate`, { method: 'POST' })
        if (state.key !== key) return
        applyEntry(r)
        P.toast(`Scénarios de ${key} validés`)
      } catch (err) {
        const analysis = err.data?.details?.analysis
        if (analysis) state.analysis = analysis
        P.toast(`${messageOf(err)} Cliquez sur un problème pour aller à la ligne concernée.`, 'error', 8000)
      }
    })
  }

  async function exportOne() {
    const e = entry()
    if (!e) return
    let includeDrafts = false
    if (e.status !== 'validated') {
      const ok = await P.confirm('Ce récit n’est pas validé. Exporter tout de même le brouillon enregistré dans le projet de test ?', { title: 'Exporter un brouillon ?', okLabel: 'Exporter le brouillon' })
      if (!ok) return
      includeDrafts = true
    } else if (state.dirty) {
      const ok = await P.confirm('Vos modifications ne sont pas enregistrées : c’est la version validée qui sera exportée. Continuer ?', { title: 'Modifications non enregistrées', okLabel: 'Exporter la version validée' })
      if (!ok) return
    }
    const key = state.key
    await withBusy('export', async () => {
      try {
        const r = await P.api('/api/gherkin/export', { body: { keys: [key], includeDrafts } })
        const w = r.written[0]
        if (w) {
          state.detail = { ...state.detail, entry: { ...state.detail.entry, exported: true, exportedAt: new Date().toISOString(), exportedPath: w.path } }
          P.toast(`Exporté : ${w.path}`)
        } else {
          P.toast(r.skipped[0]?.reason || 'Rien à exporter.', 'warn')
        }
      } catch (err) {
        P.toast(messageOf(err), 'error', 7000)
      }
    })
  }

  async function exportValidated(ev) {
    const btn = ev?.currentTarget
    await P.busy(btn, async () => {
      try {
        const r = await P.api('/api/gherkin/export', { body: {} })
        await refreshIndex()
        if (state.key && r.written.some((w) => w.key === state.key)) select(state.key, { force: true, silentUrl: true })
        const drafts = r.skipped.filter((s) => /Brouillon/.test(s.reason)).length
        const failures = r.skipped.filter((s) => !/Brouillon|Aucun scénario/.test(s.reason))
        P.modal({
          title: 'Export des scénarios validés',
          body: h('div', null,
            r.written.length
              ? P.banner('info', h('div', null, h('b', null, `${r.written.length} fichier${r.written.length > 1 ? 's' : ''} .feature écrit${r.written.length > 1 ? 's' : ''}`), ` dans ${r.dir}/`))
              : P.banner('warn', 'Aucun récit validé à exporter : validez d’abord des scénarios.'),
            r.written.length ? h('ul', { class: 'rc-export-list' }, r.written.map((w) => h('li', null, h('code', null, w.path)))) : null,
            failures.length ? P.banner('error', h('div', null, h('b', null, `${failures.length} fichier${failures.length > 1 ? 's' : ''} non écrit${failures.length > 1 ? 's' : ''}`),
              h('ul', { class: 'rc-export-list' }, failures.map((f) => h('li', null, h('code', null, f.key), ` : ${f.reason}`))))) : null,
            drafts ? h('p', { class: 'p-muted' }, `${drafts} brouillon${drafts > 1 ? 's' : ''} non exporté${drafts > 1 ? 's' : ''} : validez-les pour les inclure.`) : null),
          actions: [{ label: 'Fermer', kind: 'primary' }],
        })
      } catch (err) {
        P.toast(messageOf(err), 'error', 7000)
      }
    })
  }

  // ------------------------------------------------------------ mode manuel (copier-coller)

  async function openManualFromPrompt() {
    try {
      const r = await P.api(`/api/gherkin/${encodeURIComponent(state.key)}/prompt`)
      openManual(r.prompt, null)
    } catch (err) {
      P.toast(messageOf(err), 'error')
    }
  }

  function openManual(prompt, reason) {
    const key = state.key
    const promptArea = h('textarea', { class: 'p-textarea', rows: '9', readonly: true, 'aria-label': 'Prompt à copier' })
    promptArea.value = prompt
    const answer = h('textarea', { class: 'p-textarea', rows: '10', placeholder: 'Collez ici la réponse complète de l’assistant (marqueurs « === DÉBUT FEATURE === » compris).', 'aria-label': 'Réponse de l’assistant' })
    const errorBox = h('div', { class: 'rc-manual-error' })
    P.modal({
      title: `Génération par copier-coller — ${key}`,
      wide: true,
      body: h('div', null,
        P.banner('blue', h('div', null,
          h('b', null, reason ? 'Aucun assistant IA n’a pu répondre automatiquement.' : 'Utilisez l’assistant IA de votre choix.'),
          h('div', null, reason ? `${reason} ` : '', 'Copiez le prompt dans Copilot Chat (ou un autre assistant), puis collez sa réponse ci-dessous : elle sera analysée et enregistrée comme brouillon.'))),
        h('div', { class: 'rc-manual-step' },
          h('div', { class: 'p-row p-row--between' }, h('label', { class: 'p-label' }, '1. Prompt à copier'),
            h('button', { class: 'p-btn p-btn--sm', type: 'button', onclick: () => P.copy(prompt) }, P.icon('copy'), 'Copier le prompt')),
          promptArea),
        h('div', { class: 'rc-manual-step' }, h('label', { class: 'p-label' }, '2. Réponse de l’assistant'), answer),
        errorBox),
      actions: [
        { label: 'Annuler', kind: 'ghost' },
        {
          label: 'Analyser et enregistrer',
          kind: 'primary',
          icon: 'check',
          onClick: async (close, ev) => {
            P.clear(errorBox)
            if (!answer.value.trim()) {
              errorBox.appendChild(P.banner('warn', 'Collez d’abord la réponse de l’assistant.'))
              return false
            }
            try {
              const r = await P.busy(ev.currentTarget, () => P.api(`/api/gherkin/${encodeURIComponent(key)}/manual-answer`, { body: { text: answer.value } }))
              if (state.key === key) {
                applyEntry(r)
                renderDetail()
              }
              refreshIndex()
              P.toast(r.analysis.valid ? 'Réponse enregistrée comme brouillon' : `Réponse enregistrée : ${r.analysis.counts.error} erreur(s) à corriger`, r.analysis.valid ? 'ok' : 'warn')
              return true
            } catch (err) {
              errorBox.appendChild(errorBanner(err, 'Réponse refusée.'))
              return false
            }
          },
        },
      ],
    })
  }

  // ------------------------------------------------------------ historique

  function openHistory() {
    const e = entry()
    if (!e?.versions?.length) return
    const m = P.modal({
      title: `Historique de ${e.key}`,
      wide: true,
      body: h('table', { class: 'p-table' },
        h('thead', null, h('tr', null, h('th', null, 'Enregistrée'), h('th', null, 'Origine'), h('th', null, 'Statut'), h('th', null, 'Par'), h('th', null, ''))),
        h('tbody', null, e.versions.map((v) => h('tr', null,
          h('td', null, P.fmtDate(v.savedAt)),
          h('td', null, GENERATOR_LABEL[v.generatedBy] || v.generatedBy || '—'),
          h('td', null, v.status === 'validated' ? P.badge('Validé', 'mint') : P.badge('Brouillon', 'amber')),
          h('td', null, v.savedBy || '—'),
          h('td', { style: { textAlign: 'right' } },
            h('button', { class: 'p-btn p-btn--sm p-btn--ghost', type: 'button', onclick: () => showVersion(v) }, P.icon('eye'), 'Voir'),
            h('button', { class: 'p-btn p-btn--sm', type: 'button', onclick: () => { m.close(); restore(v.index) } }, P.icon('refresh'), 'Restaurer')))))),
      actions: [{ label: 'Fermer', kind: 'ghost' }],
    })
  }

  function showVersion(v) {
    const pre = h('pre', { class: 'p-code p-gherkin', style: { maxHeight: '60vh' } })
    pre.innerHTML = P.gherkinHtml(v.text)
    P.modal({ title: `Version du ${P.fmtDate(v.savedAt)}`, wide: true, body: pre, actions: [{ label: 'Fermer', kind: 'ghost' }] })
  }

  async function restore(index) {
    if (state.dirty && !(await P.confirm('Les modifications en cours seront perdues. Restaurer cette version ?', { okLabel: 'Restaurer', danger: true }))) return
    const key = state.key
    await withBusy('save', async () => {
      try {
        const r = await P.api(`/api/gherkin/${encodeURIComponent(key)}/restore`, { body: { index } })
        if (state.key !== key) return
        applyEntry(r)
        P.toast('Version restaurée comme brouillon')
      } catch (err) {
        P.toast(messageOf(err), 'error')
      }
    })
  }

  // ------------------------------------------------------------ génération par lot

  function openBatchDialog() {
    if (state.batch && !state.batch.summary) {
      P.toast('Une génération par lot est déjà en cours.', 'warn')
      return
    }
    const keys = state.stories.filter((s) => !state.index[s.key]).map((s) => s.key)
    if (!keys.length) {
      P.toast('Tous les récits ont déjà des scénarios.', 'ok')
      return
    }
    const hasAi = Boolean(state.llm?.active)
    let mode = hasAi ? 'auto' : 'template'
    const choices = [
      { id: 'auto', title: 'Automatique', text: hasAi ? `Assistant IA (${state.llm.active.label}), modèle intégré en secours.` : 'Modèle intégré (aucun assistant IA disponible).' },
      { id: 'llm', title: 'Assistant IA uniquement', text: hasAi ? 'Un récit en échec reste sans scénario.' : 'Indisponible : configurez un fournisseur.', disabled: !hasAi },
      { id: 'template', title: 'Modèle intégré', text: 'Instantané, sans IA, à partir des critères d’acceptation.' },
    ]
    const radios = h('div', { class: 'p-stack' }, choices.map((c) => h('label', { class: 'p-check', style: { alignItems: 'flex-start', opacity: c.disabled ? 0.55 : 1 } },
      h('input', { type: 'radio', name: 'rc-batch-mode', value: c.id, checked: c.id === mode, disabled: c.disabled, onchange: () => { mode = c.id } }),
      h('span', null, h('b', null, c.title), h('br'), h('span', { class: 'p-muted' }, c.text)))))
    P.modal({
      title: 'Générer les scénarios manquants',
      body: h('div', null,
        h('p', { style: { marginTop: 0 } }, `${keys.length} récit${keys.length > 1 ? 's' : ''} sans scénario : ${keys.slice(0, 6).join(', ')}${keys.length > 6 ? '…' : ''}`),
        radios,
        h('p', { class: 'p-hint' }, 'Les scénarios produits sont des brouillons à relire. Les récits déjà couverts ne sont pas modifiés.')),
      actions: [
        { label: 'Annuler', kind: 'ghost' },
        { label: 'Lancer la génération', kind: 'primary', icon: 'play', onClick: () => { startBatch(keys, mode) } },
      ],
    })
  }

  async function startBatch(keys, mode) {
    try {
      const r = await P.api('/api/gherkin/batch', { body: { keys, mode } })
      if (r.alreadyRunning) P.toast('Une génération par lot était déjà en cours : suivi repris.', 'warn')
      attachBatch(r.jobId, r.total)
    } catch (err) {
      P.toast(messageOf(err), 'error', 7000)
    }
  }

  function attachBatch(jobId, total) {
    if (state.batch?.es) state.batch.es.close()
    state.batch = { jobId, total, items: new Map(), current: null, summary: null, error: null }
    renderBatch()
    const b = state.batch
    b.es = P.stream(`/api/gherkin/batch/${jobId}/events`, {
      start: (d) => { b.total = d.total; renderBatch() },
      item: (d) => {
        b.items.set(d.key, d)
        b.current = d.state === 'running' ? d : b.current
        renderBatch()
        if (d.state !== 'running') {
          refreshIndex()
          if (d.key === state.key && d.state === 'done' && !state.dirty) select(d.key, { force: true, silentUrl: true })
        }
      },
      done: (d) => {
        b.summary = d.summary
        b.current = null
        b.es.close()
        renderBatch()
        refreshIndex()
        P.toast(d.summary.cancelled ? 'Génération par lot arrêtée' : `Génération terminée : ${d.summary.done} récit(s) traité(s)`, d.summary.failed ? 'warn' : 'ok')
      },
      error: (d) => {
        b.error = d?.message || 'Échec de la génération par lot.'
        b.es.close()
        renderBatch()
      },
    }, () => {
      if (b.summary || b.error) return
      b.error = 'Connexion au suivi perdue (le serveur a peut-être redémarré).'
      b.es.close()
      renderBatch()
    })
  }

  function renderBatch() {
    if (!ui.batch) return
    P.clear(ui.batch)
    const b = state.batch
    if (!b) return
    const finished = [...b.items.values()].filter((i) => i.state !== 'running')
    const pct = b.total ? Math.round((finished.length / b.total) * 100) : 0
    const running = !b.summary && !b.error
    const title = b.error ? 'Génération par lot interrompue' : b.summary ? (b.summary.cancelled ? 'Génération par lot arrêtée' : 'Génération par lot terminée') : 'Génération par lot en cours'
    const sub = b.summary
      ? `${b.summary.done} généré(s) · ${b.summary.skipped} conservé(s) · ${b.summary.failed} en échec${b.summary.llm ? ` · ${b.summary.llm} par l’IA` : ''}${b.summary.template ? ` · ${b.summary.template} par le modèle` : ''}`
      : `${finished.length} / ${b.total} récits${b.current ? ` · ${b.current.key} ${b.current.summary || ''}` : ''}`
    const actions = running
      ? h('button', { class: 'p-btn p-btn--sm', type: 'button', onclick: cancelBatch }, P.icon('stop'), 'Arrêter')
      : h('button', { class: 'p-btn p-btn--sm p-btn--ghost', type: 'button', onclick: () => { state.batch = null; renderBatch() } }, P.icon('x'), 'Masquer')
    const rows = [...b.items.values()].filter((i) => i.state !== 'running').reverse().map((i) => h('div', { class: 'rc-batch-row' },
      i.state === 'done' ? P.badge(i.errors ? `${i.errors} erreur(s)` : `${i.scenarios} scénario(s)`, i.errors ? 'red' : 'mint')
        : i.state === 'skipped' ? P.badge('Conservé', 'outline') : P.badge('Échec', 'red'),
      h('a', { class: 'rc-item-key', href: `?key=${encodeURIComponent(i.key)}`, onclick: (e) => { e.preventDefault(); select(i.key) } }, i.key),
      h('span', { class: 'p-muted' }, i.state === 'done' ? `${i.usedMode === 'llm' ? 'Assistant IA' : 'Modèle intégré'}${i.message ? ` — ${i.message}` : ''}` : i.message || '')))
    ui.batch.appendChild(P.card({
      title,
      sub,
      icon: running ? 'refresh' : b.error ? 'alert' : 'checkCircle',
      tone: b.error ? 'red' : running ? 'blue' : '',
      actions,
      body: h('div', null,
        h('div', { class: 'p-meter' }, h('div', { class: `p-meter-fill ${b.error ? 'red' : ''}`, style: { width: `${b.summary ? 100 : pct}%` } })),
        b.error ? h('div', { style: { marginTop: '10px' } }, P.banner('error', b.error)) : null,
        rows.length ? h('div', { class: 'rc-batch-log' }, rows) : null),
    }))
  }

  async function cancelBatch() {
    if (!state.batch) return
    try {
      await P.api(`/api/gherkin/batch/${state.batch.jobId}/cancel`, { method: 'POST' })
      P.toast('Arrêt demandé : le récit en cours se termine.', 'warn')
    } catch (err) {
      P.toast(messageOf(err), 'error')
    }
  }

  // ------------------------------------------------------------ erreurs

  function messageOf(err) {
    const hint = err?.data?.details?.hint
    return `${err?.message || 'Erreur inattendue.'}${hint ? ` ${hint}` : ''}`
  }

  function errorBanner(e, fallback) {
    const hint = e?.data?.details?.hint
    return P.banner('error', h('div', null,
      h('b', null, e?.message || fallback),
      hint ? h('div', { style: { marginTop: '4px' } }, hint) : null))
  }
})()

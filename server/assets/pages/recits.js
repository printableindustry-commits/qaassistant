/*
 * Récits et Gherkin : source JIRA (URL du projet), tri des récits (à automatiser, plus tard, ignorés),
 * liste des récits (maître) et, pour le récit choisi (détail), décision de test, critères d'acceptation,
 * génération des scénarios (IA ou modèle intégré), relecture, validation, export, automatisation Playwright.
 * Lien profond : /recits.html?key=PROJ-12
 */
;(function () {
  'use strict'
  const P = window.Prisme
  const { h } = P

  const TABS = [
    { id: 'triage', label: 'À trier', icon: 'filter' },
    { id: 'todo', label: 'À automatiser', icon: 'zap' },
    { id: 'later', label: 'Plus tard', icon: 'clock' },
    { id: 'skip', label: 'Ignorés', icon: 'eyeOff' },
    { id: 'all', label: 'Tous' },
  ]
  const GHERKIN_FILTERS = [
    { id: '', label: 'Gherkin : tous' },
    { id: 'none', label: 'Sans scénario' },
    { id: 'draft', label: 'Brouillons' },
    { id: 'validated', label: 'Validés' },
  ]
  const DECISION = {
    todo: { label: 'À automatiser', tone: 'mint', icon: 'zap', verb: 'À automatiser' },
    later: { label: 'Plus tard', tone: 'amber', icon: 'clock', verb: 'Plus tard' },
    skip: { label: 'Ignoré', tone: 'outline', icon: 'eyeOff', verb: 'Ignorer' },
  }
  const URL_EXAMPLES = [
    { label: 'Cloud · tableau', url: 'https://monentreprise.atlassian.net/jira/software/projects/CLE/boards/12' },
    { label: 'Cloud · backlog', url: 'https://monentreprise.atlassian.net/jira/software/c/projects/CLE/boards/12/backlog' },
    { label: 'Server · ticket', url: 'https://jira.monentreprise.fr/browse/CLE-123' },
    { label: 'Server · tableau (contexte /jira)', url: 'https://intranet.monentreprise.fr/jira/secure/RapidBoard.jspa?rapidView=42&projectKey=CLE' },
    { label: 'Filtre JQL', url: 'https://jira.monentreprise.fr/issues/?jql=project%20%3D%20CLE%20AND%20status%20%3D%20%22En%20recette%22' },
    { label: 'Démo IRMA', url: 'https://jira.demo.irma.local/browse/P0326-9301' },
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
    jira: null,                  // GET /api/jira/settings
    triage: {},                  // { clé: { decision, reason, updatedAt, by } }
    suggestions: {},             // { clé: { score, suggestion, reasons, factors } }
    ai: {},                      // { clé: { suggestion, score, reason, provider, at } }
    counts: null,
    filters: { q: '', epic: '', status: '', gherkin: '' },
    tab: 'triage',
    selected: new Set(),
    key: null,
    detail: null,                // GET /api/gherkin/:key
    text: '',
    dirty: false,
    analysis: null,              // dernière analyse (en direct)
    busy: null,                  // 'llm' | 'template' | 'save' | 'validate' | 'export'
    view: readView(),
    batch: null,                 // { jobId, total, items: Map, summary, error, es }
    source: {
      open: false,               // carte « Source des récits » dépliée
      url: '',
      parsed: null,              // réponse de /api/jira/parse-url
      parseError: '',
      creds: null,               // { baseUrl, projectKey, deployment, canEdit } quand des identifiants sont requis
      job: null,                 // { status, lines, percent, message, error, es }
    },
  }
  const ui = {}
  const app = document.getElementById('app')
  let lintTimer = null
  let lintSeq = 0
  let parseTimer = null
  let parseSeq = 0

  P.whenShell().then(init)

  // ------------------------------------------------------------ démarrage et données

  async function init(ready) {
    state.user = ready?.user || null
    try {
      await Promise.all([loadStories(), loadIndex(), loadLlm(), loadJiraSettings(), loadTriage()])
    } catch (e) {
      P.clear(app)
      app.appendChild(errorBanner(e, 'Impossible de charger les récits.'))
      app.appendChild(h('div', null, h('button', { class: 'p-btn', type: 'button', onclick: () => location.reload() }, P.icon('refresh'), 'Réessayer')))
      return
    }
    state.source.url = defaultSourceUrl()
    state.source.open = !state.stories.length
    state.tab = defaultTab()
    buildLayout()
    const wanted = new URLSearchParams(location.search).get('key')
    const first = wanted && state.stories.find((s) => s.key.toUpperCase() === wanted.toUpperCase())
    if (first) {
      if (!inTab(first, state.tab)) switchTab('all')
      select(first.key, { force: true })
    } else if (wanted) {
      P.toast(`Récit ${wanted} introuvable dans le dernier scan.`, 'warn')
    }
    if (!first && state.stories.length) select(visibleStories()[0]?.key || state.stories[0].key, { force: true, silentUrl: true })
    if (state.batchInfo) attachBatch(state.batchInfo.jobId, state.batchInfo.total)
    if (state.source.url && state.source.open) parseNow()
    window.addEventListener('beforeunload', (e) => {
      if (!state.dirty) return
      e.preventDefault()
      e.returnValue = ''
    })
  }

  async function loadStories() {
    const r = await P.api('/api/jira/stories')
    state.stories = r.stories || []
    state.scan = r.scan || state.scan
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

  async function loadJiraSettings() {
    try {
      state.jira = await P.api('/api/jira/settings')
    } catch {
      state.jira = null
    }
  }

  async function loadTriage() {
    try {
      applyTriagePayload(await P.api('/api/jira/triage'))
    } catch {
      // Le tri est un complément : la page reste utilisable sans lui.
      state.triage = {}
      state.suggestions = {}
    }
  }

  function applyTriagePayload(r) {
    if (!r) return
    if (r.triage) state.triage = r.triage
    if (r.suggestions) state.suggestions = r.suggestions
    if (r.ai) state.ai = r.ai
    if (r.counts) state.counts = r.counts
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

  function defaultTab() {
    const untriaged = state.stories.filter((s) => !decisionOf(s.key)).length
    if (untriaged) return 'triage'
    if (state.stories.some((s) => decisionOf(s.key) === 'todo')) return 'todo'
    return 'all'
  }

  function defaultSourceUrl() {
    const scan = state.scan
    if (scan?.url) return scan.url
    const s = state.jira?.settings
    if (scan?.source === 'jira' && scan.baseUrl && scan.projectKey) return `${scan.baseUrl}/browse/${scan.projectKey}`
    if (s?.baseUrl && s.projectKey) return `${s.baseUrl}/browse/${s.projectKey}`
    return ''
  }

  // ------------------------------------------------------------ filtres

  const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const decisionOf = (key) => state.triage[key]?.decision || null

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

  function matchesGherkin(s, filter) {
    const e = state.index[s.key]
    if (filter === 'none') return !e
    if (filter === 'draft') return e?.status === 'draft'
    if (filter === 'validated') return e?.status === 'validated'
    return true
  }

  function inTab(s, tab) {
    const d = decisionOf(s.key)
    if (tab === 'triage') return !d
    if (tab === 'todo' || tab === 'later' || tab === 'skip') return d === tab
    return true
  }

  const filtered = () => state.stories.filter(matchesFilters)
  const visibleStories = () => filtered().filter((s) => matchesGherkin(s, state.filters.gherkin) && inTab(s, state.tab))

  // ------------------------------------------------------------ mise en page

  function buildLayout() {
    P.clear(app)
    renderActions()
    app.appendChild(h('p', { class: 'p-page-intro' },
      'Scannez les récits de votre projet JIRA, choisissez ceux qui méritent un test automatisé, puis transformez-les en scénarios Gherkin et en tests Playwright, validés par vous avant l’envoi dans JIRA / Xray.'))
    ui.srcHost = h('div', { class: 'rc-src-host' })
    app.appendChild(ui.srcHost)
    renderSource()
    if (!state.stories.length) {
      app.appendChild(howItWorks())
      ui.list = null
      ui.detail = null
      return
    }
    ui.batch = h('div')
    ui.summary = h('div', { class: 'p-kpis' })
    ui.toolbar = toolbar()
    ui.tabs = h('div', { class: 'rc-tabs' })
    ui.bulk = h('div', { class: 'rc-bulk', role: 'toolbar', 'aria-label': 'Actions de tri' })
    ui.list = h('div', { class: 'p-list rc-list', role: 'listbox', 'aria-label': 'Récits', 'aria-multiselectable': 'false', onkeydown: onListKey })
    ui.detail = h('div', { class: 'rc-detail' })
    app.append(ui.batch, ui.summary, ui.toolbar, ui.tabs, ui.bulk,
      h('div', { class: 'p-grid p-grid-aside rc-layout' },
        P.card({ className: 'rc-list-card', flush: true, body: ui.list }),
        ui.detail))
    ui.tabsCtl = P.tabs(ui.tabs, tabItems(), state.tab, (id) => {
      state.tab = id
      renderList()
      renderBulk()
    })
    renderSummary()
    renderBulk()
    renderList()
    renderDetail()
  }

  function switchTab(id) {
    state.tab = id
    if (ui.tabsCtl) ui.tabsCtl.set(id)
    renderList()
    renderBulk()
  }

  function renderActions() {
    if (!P.shell) return
    if (!state.stories.length) {
      P.shell.setActions(h('button', { class: 'p-btn', type: 'button', onclick: (e) => runDemoScan(e.currentTarget) }, P.icon('flask'), 'Essayer avec la démo'))
      return
    }
    P.shell.setActions(
      h('button', { class: 'p-btn', type: 'button', onclick: exportValidated }, P.icon('download'), 'Exporter les validés'),
      h('button', { class: 'p-btn p-btn--primary', type: 'button', onclick: openBatchDialog, title: 'Génère les scénarios des récits « À automatiser » qui n’en ont pas encore' }, P.icon('wand'), 'Générer les scénarios'))
  }

  function howItWorks() {
    const step = (n, title, text) => h('div', { class: 'rc-how-step' }, h('span', { class: 'rc-how-num' }, String(n)), h('div', null, h('b', null, title), h('div', { class: 'p-muted' }, text)))
    return P.card({
      title: 'Du récit au test automatisé',
      sub: 'Le parcours en quatre étapes',
      icon: 'compass',
      tone: 'grey',
      body: h('div', { class: 'rc-how' },
        step(1, 'Collez l’URL du projet', 'Tableau, backlog, ticket ou filtre : Wizard QA en déduit l’instance et le projet.'),
        step(2, 'Triez les récits', 'Une suggestion explique pour chaque récit s’il vaut la peine d’être automatisé ; vous décidez.'),
        step(3, 'Automatisez', 'Scénarios Gherkin puis exploration Playwright de l’application, avec prise de main si l’IA bloque.'),
        step(4, 'Validez et envoyez', 'Le test validé part dans JIRA / Xray, relié au récit et, si besoin, à un plan de test.')),
    })
  }

  // ------------------------------------------------------------ source des récits (URL JIRA)

  function renderSource() {
    if (!ui.srcHost) return
    P.clear(ui.srcHost)
    const src = state.source
    const scan = state.scan
    if (scan && !src.open) {
      ui.srcHost.appendChild(sourceSummary(scan))
      return
    }
    ui.srcHost.appendChild(sourceForm())
  }

  function hostOf(url) {
    try { return new URL(url).host } catch { return url || '' }
  }

  function sourceSummary(scan) {
    const job = state.source.job
    const running = job?.status === 'running'
    const demo = scan.source === 'demo'
    const instance = demo ? 'jira.demo.irma.local' : hostOf(scan.baseUrl)
    const card = P.card({
      className: 'rc-src-card rc-src-card--compact',
      body: h('div', null,
        h('div', { class: 'rc-src-summary' },
          h('span', { class: 'p-tile' }, P.icon('link')),
          h('div', { class: 'rc-src-summary-text' },
            h('div', { class: 'rc-src-summary-title' },
              h('b', null, scan.projectKey ? `Projet ${scan.projectKey}` : 'Requête personnalisée'),
              demo ? P.badge('Démonstration', 'purple') : P.badge(scan.deployment === 'cloud' ? 'JIRA Cloud' : 'JIRA', 'blue')),
            h('div', { class: 'p-muted rc-src-summary-meta' },
              `${instance} · ${scan.count} récit${scan.count > 1 ? 's' : ''} · scanné ${P.fmtAgo(scan.scannedAt)}`,
              scan.url ? h('span', { class: 'p-ellipsis rc-src-url', title: scan.url }, ` · ${scan.url}`) : null)),
          h('div', { class: 'rc-src-summary-actions' },
            h('button', { class: 'p-btn p-btn--sm', type: 'button', disabled: running, onclick: rescan }, P.icon('refresh'), running ? 'Scan en cours…' : 'Rescanner'),
            h('button', { class: 'p-btn p-btn--sm p-btn--ghost', type: 'button', disabled: running, onclick: () => { state.source.open = true; renderSource(); focusUrl() } }, P.icon('edit'), 'Changer de projet'))),
        jobView()),
    })
    return card
  }

  function sourceForm() {
    const src = state.source
    const running = src.job?.status === 'running'
    ui.urlInput = h('input', {
      class: 'p-input rc-url-input',
      type: 'url',
      inputmode: 'url',
      autocomplete: 'off',
      spellcheck: 'false',
      placeholder: 'https://monentreprise.atlassian.net/jira/software/projects/CLE/boards/12',
      'aria-label': 'URL du projet JIRA',
      'aria-describedby': 'rc-url-detect',
      disabled: running,
      oninput: (e) => {
        src.url = e.target.value
        src.creds = null
        scheduleParse()
      },
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); scanFromUrl(ui.scanBtn) } },
    })
    ui.urlInput.value = src.url
    ui.detect = h('div', { class: 'rc-detect', id: 'rc-url-detect', 'aria-live': 'polite' })
    renderDetect()
    ui.scanBtn = h('button', { class: 'p-btn p-btn--primary', type: 'button', disabled: running, onclick: (e) => scanFromUrl(e.currentTarget) },
      P.icon('search'), running ? 'Scan en cours…' : 'Scanner les récits')
    const examples = h('div', { class: 'rc-examples' },
      h('span', { class: 'p-hint' }, 'Exemples :'),
      URL_EXAMPLES.map((ex) => h('button', {
        class: 'p-chip', type: 'button', title: ex.url, disabled: running,
        onclick: () => { src.url = ex.url; src.creds = null; ui.urlInput.value = ex.url; parseNow(); ui.urlInput.focus() },
      }, ex.label)))
    const cancel = state.scan
      ? h('button', { class: 'p-btn p-btn--ghost', type: 'button', disabled: running, onclick: () => { src.open = false; src.creds = null; renderSource() } }, 'Annuler')
      : null
    return P.card({
      className: 'rc-src-card',
      title: 'Source des récits',
      sub: 'Collez l’URL de votre projet JIRA (tableau, backlog ou ticket)',
      icon: 'link',
      body: h('div', { class: 'rc-src-body' },
        h('label', { class: 'rc-url-label', for: 'rc-url' }, 'URL du projet JIRA'),
        h('div', { class: 'rc-url-row' }, Object.assign(ui.urlInput, { id: 'rc-url' }), ui.scanBtn),
        ui.detect,
        examples,
        h('div', { class: 'rc-src-foot' },
          h('span', { class: 'p-hint' }, 'Ouvrez votre projet dans JIRA et copiez l’adresse de la barre du navigateur : Cloud (…atlassian.net) ou Server / Data Center, avec ou sans /jira.'),
          h('span', { class: 'p-spacer' }),
          h('a', { href: '#', class: 'rc-demo-link', onclick: (e) => { e.preventDefault(); if (!running) runDemoScan(e.currentTarget) } }, P.icon('flask'), 'Essayer avec les données de démo'),
          cancel),
        src.creds ? credentialsForm(src.creds) : null,
        jobView()),
    })
  }

  function focusUrl() {
    setTimeout(() => { ui.urlInput?.focus(); ui.urlInput?.select() }, 30)
    if (state.source.url) parseNow()
  }

  function scheduleParse() {
    clearTimeout(parseTimer)
    parseTimer = setTimeout(parseNow, 300)
  }

  async function parseNow() {
    clearTimeout(parseTimer)
    const src = state.source
    const seq = ++parseSeq
    const url = src.url.trim()
    if (!url) {
      src.parsed = null
      src.parseError = ''
      renderDetect()
      return
    }
    try {
      const r = await P.api('/api/jira/parse-url', { body: { url } })
      if (seq !== parseSeq) return
      src.parsed = r
      src.parseError = ''
    } catch (e) {
      if (seq !== parseSeq) return
      src.parsed = null
      src.parseError = e.status === 401 ? '' : e.message
    }
    renderDetect()
  }

  function renderDetect() {
    if (!ui.detect) return
    P.clear(ui.detect)
    const src = state.source
    if (src.parseError) {
      ui.detect.className = 'rc-detect is-error'
      ui.detect.append(P.icon('alert'), h('span', null, src.parseError))
      return
    }
    const r = src.parsed
    if (!r) {
      ui.detect.className = 'rc-detect is-idle'
      ui.detect.append(P.icon('info'), h('span', null, 'Le projet, l’instance et le type d’écran sont reconnus pendant la saisie.'))
      return
    }
    const p = r.parsed
    ui.detect.className = 'rc-detect is-ok'
    ui.detect.append(
      P.icon('checkCircle'),
      h('span', null, h('b', null, p.projectKey ? `Projet reconnu : ${p.projectKey}` : 'Adresse reconnue'), r.label ? ` · ${r.label}` : ''),
      P.badge(`${p.host} · ${r.demo ? 'démonstration' : p.deployment === 'cloud' ? 'Cloud' : 'Server / Data Center'}`, r.demo ? 'purple' : 'blue', 'Instance JIRA'),
      r.ready
        ? P.badge(r.demo ? 'Aucun identifiant requis' : 'Connexion enregistrée', 'mint')
        : P.badge(r.sameInstance ? 'Jeton à saisir' : 'Identifiants à saisir', 'amber', 'Un e-mail et un jeton d’API seront demandés au lancement du scan'))
    for (const w of p.warnings || []) ui.detect.append(h('span', { class: 'p-hint' }, w))
  }

  function credentialsForm(creds) {
    const cloud = creds.deployment === 'cloud'
    const tokenHelp = cloud
      ? 'https://id.atlassian.com/manage-profile/security/api-tokens'
      : /^https?:\/\//i.test(creds.baseUrl) ? `${creds.baseUrl}/secure/ViewProfile.jspa?selectedTab=com.atlassian.pats.pats-plugin:jira-user-personal-access-tokens` : null
    if (creds.canEdit === false) {
      return h('div', { class: 'rc-creds' }, P.banner('warn', h('div', null,
        h('b', null, `Identifiants requis pour ${hostOf(creds.baseUrl)}.`),
        h('div', null, 'Seul un administrateur de Wizard QA peut enregistrer une connexion JIRA. Demandez-lui de la configurer (Réglages → JIRA), ou essayez avec les données de démonstration.'))))
    }
    const email = h('input', { class: 'p-input', type: 'email', name: 'jira-email', autocomplete: 'username', 'aria-label': cloud ? 'E-mail du compte Atlassian' : 'E-mail du compte JIRA (facultatif)', placeholder: 'prenom.nom@entreprise.fr', value: state.jira?.settings && sameBase(state.jira.settings.baseUrl, creds.baseUrl) ? state.jira.settings.email || '' : '' })
    const token = h('input', { class: 'p-input', type: 'password', name: 'jira-token', autocomplete: 'new-password', placeholder: cloud ? 'Jeton d’API Atlassian' : 'Jeton d’accès personnel', 'aria-label': 'Jeton JIRA' })
    const eye = h('button', {
      class: 'p-icon-btn', type: 'button', 'aria-label': 'Afficher le jeton',
      onclick: () => {
        const show = token.type === 'password'
        token.type = show ? 'text' : 'password'
        eye.setAttribute('aria-label', show ? 'Masquer le jeton' : 'Afficher le jeton')
        P.clear(eye).appendChild(P.icon(show ? 'eyeOff' : 'eye'))
      },
    }, P.icon('eye'))
    const errorBox = h('div')
    const save = h('button', { class: 'p-btn p-btn--primary', type: 'submit' }, P.icon('lock'), 'Enregistrer et scanner')
    const form = h('form', {
      class: 'rc-creds',
      autocomplete: 'off',
      onsubmit: async (e) => {
        e.preventDefault()
        P.clear(errorBox)
        if (cloud && !email.value.trim()) {
          errorBox.appendChild(P.banner('warn', 'Sur JIRA Cloud, l’e-mail du compte Atlassian est obligatoire avec le jeton d’API.'))
          email.focus()
          return
        }
        if (!token.value.trim()) {
          errorBox.appendChild(P.banner('warn', 'Saisissez le jeton.'))
          token.focus()
          return
        }
        await P.busy(save, async () => {
          try {
            const changing = !sameBase(state.jira?.settings?.baseUrl, creds.baseUrl)
            const body = { baseUrl: creds.baseUrl, email: email.value.trim(), token: token.value.trim() }
            if (creds.projectKey) body.projectKey = creds.projectKey
            // Nouvelle instance : on repart de la détection automatique et sans JQL propre à l'ancienne.
            if (changing) Object.assign(body, { deployment: 'auto', authType: 'auto', jql: '' })
            state.jira = await P.api('/api/jira/settings', { method: 'PUT', body })
            token.value = ''
            state.source.creds = null
            P.toast('Connexion JIRA enregistrée (jeton conservé sur ce poste, jamais réaffiché)')
            await parseNow()
            await scanFromUrl(null)
          } catch (err) {
            errorBox.appendChild(errorBanner(err, 'Enregistrement impossible.'))
          }
        })
      },
    },
    P.banner('blue', h('div', null,
      h('b', null, `Accès en lecture à ${hostOf(creds.baseUrl)}`),
      h('div', null, cloud
        ? 'JIRA Cloud : e-mail de votre compte Atlassian et jeton d’API. Le jeton est enregistré sur ce poste (fichier protégé) et n’est jamais réaffiché.'
        : 'JIRA Server / Data Center : jeton d’accès personnel (l’e-mail est facultatif). Le jeton est enregistré sur ce poste (fichier protégé) et n’est jamais réaffiché.'))),
    h('div', { class: 'p-form-grid' },
      h('div', { class: 'p-field' }, h('label', null, cloud ? 'E-mail du compte' : 'E-mail (facultatif)'), email),
      h('div', { class: 'p-field' }, h('label', null, cloud ? 'Jeton d’API' : 'Jeton d’accès personnel'), h('div', { class: 'p-pwd' }, token, eye),
        tokenHelp ? h('a', { class: 'p-hint', href: tokenHelp, target: '_blank', rel: 'noopener noreferrer' }, 'Créer un jeton', P.icon('external', 12)) : null)),
    errorBox,
    h('div', { class: 'p-row' }, save,
      h('button', { class: 'p-btn p-btn--ghost', type: 'button', onclick: () => { state.source.creds = null; renderSource() } }, 'Annuler'),
      h('span', { class: 'p-spacer' }),
      h('a', { href: '#', class: 'rc-demo-link', onclick: (e) => { e.preventDefault(); runDemoScan(e.currentTarget) } }, P.icon('flask'), 'Utiliser plutôt les données de démo')))
    setTimeout(() => (email.value ? token : email).focus(), 30)
    return form
  }

  const sameBase = (a, b) => String(a || '').replace(/\/+$/, '').toLowerCase() === String(b || '').replace(/\/+$/, '').toLowerCase()

  function jobView() {
    const job = state.source.job
    if (!job) return null
    const failed = job.status === 'error'
    const head = h('div', { class: 'rc-job-head' },
      job.status === 'running' ? h('span', { class: 'p-spinner' }) : P.icon(job.status === 'done' ? 'checkCircle' : 'xCircle'),
      h('span', { class: 'p-strong' }, job.status === 'running' ? (job.message || 'Scan en cours…') : job.status === 'done' ? 'Scan terminé' : 'Le scan a échoué'),
      job.percent != null && job.status === 'running' ? h('span', { class: 'p-faint' }, `${job.percent} %`) : null)
    const width = job.status === 'done' ? 100 : job.percent ?? (job.status === 'running' ? 8 : 100)
    const lines = job.lines.slice(-40)
    return h('div', { class: 'rc-job' },
      head,
      h('div', { class: 'p-meter' }, h('div', { class: `p-meter-fill ${failed ? 'red' : ''}`, style: { width: `${width}%` } })),
      lines.length ? h('pre', { class: 'p-log rc-job-log' }, lines.map((l) => h('div', { class: l.kind || '' }, `${l.at ? `${new Date(l.at).toLocaleTimeString('fr-FR')}  ` : ''}${l.text}`))) : null,
      failed && job.error ? h('div', { class: 'p-stack' },
        errorBanner({ message: job.error.message, data: { details: { hint: job.error.hint } } }, 'Le scan a échoué.'),
        h('div', { class: 'p-row' },
          h('button', { class: 'p-btn', type: 'button', onclick: () => { state.source.job = null; state.source.open = true; renderSource(); focusUrl() } }, P.icon('edit'), 'Corriger l’URL'),
          job.retry ? h('button', { class: 'p-btn', type: 'button', onclick: job.retry }, P.icon('refresh'), 'Réessayer') : null,
          h('a', { href: '#', class: 'rc-demo-link', onclick: (e) => { e.preventDefault(); runDemoScan(e.currentTarget) } }, P.icon('flask'), 'Essayer avec les données de démo'))) : null)
  }

  async function scanFromUrl(button) {
    const src = state.source
    const url = (ui.urlInput?.value ?? src.url).trim()
    src.url = url
    if (!url) {
      src.parseError = 'Collez d’abord l’URL d’un écran de votre projet JIRA (tableau, backlog ou ticket).'
      renderDetect()
      ui.urlInput?.focus()
      return
    }
    if (src.parsed?.demo && state.scan?.source === 'jira' && !(await confirmReplaceJira())) return
    await P.busy(button, async () => {
      try {
        const r = await P.api('/api/jira/scan', { body: { url } })
        if (r.alreadyRunning) P.toast('Un scan est déjà en cours : affichage de sa progression', 'warn')
        followScan(r.jobId, r.label ? `Scan de ${r.label}` : 'Scan des récits', () => scanFromUrl(null))
      } catch (e) {
        if (e.data?.needsCredentials) {
          src.creds = { baseUrl: e.data.baseUrl, projectKey: e.data.projectKey, deployment: e.data.deployment, canEdit: e.data.canEdit }
          src.open = true
          renderSource()
          return
        }
        src.parseError = e.message
        renderDetect()
        P.toast(messageOf(e), 'error', 7000)
      }
    })
  }

  function confirmReplaceJira() {
    return P.confirm(`Les ${state.scan.count} récits scannés depuis JIRA seront remplacés par les données de démonstration (les décisions de tri sont conservées). Continuer ?`,
      { title: 'Remplacer le scan JIRA', okLabel: 'Remplacer par la démonstration' })
  }

  async function runDemoScan(button) {
    if (state.source.job?.status === 'running') return
    if (state.scan?.source === 'jira' && !(await confirmReplaceJira())) return
    await P.busy(button?.tagName === 'BUTTON' ? button : null, async () => {
      try {
        const r = await P.api('/api/jira/scan', { body: { mode: 'demo' } })
        state.source.creds = null
        followScan(r.jobId, 'Scan des données de démonstration', () => runDemoScan(null))
      } catch (e) {
        P.toast(messageOf(e), 'error', 7000)
      }
    })
  }

  function rescan() {
    const scan = state.scan
    if (!scan) return
    if (scan.url) {
      state.source.url = scan.url
      scanFromUrl(null)
      return
    }
    if (scan.source === 'demo') {
      runDemoScan(null)
      return
    }
    const body = { mode: 'jira' }
    if (scan.projectKey) body.projectKey = scan.projectKey
    else if (scan.jql) body.jql = scan.jql
    P.api('/api/jira/scan', { body })
      .then((r) => followScan(r.jobId, 'Nouveau scan', rescan))
      .catch((e) => P.toast(messageOf(e), 'error', 7000))
  }

  function followScan(jobId, title, retry) {
    const src = state.source
    if (src.job?.es) src.job.es.close()
    const job = { status: 'running', lines: [], percent: null, message: `${title}…`, error: null, retry }
    src.job = job
    renderSource()
    let finished = false
    job.es = P.stream(`/api/jira/scan/${encodeURIComponent(jobId)}/events`, {
      progress: (d) => {
        job.message = d.message
        job.percent = d.percent
        job.lines.push({ text: d.message, at: d.at })
        renderSource()
      },
      done: async (d) => {
        finished = true
        job.es.close()
        job.status = 'done'
        job.lines.push({ text: `Scan terminé : ${d.summary.stories} récits, ${d.summary.withCriteria} avec critères, ${d.summary.epics} épopées.`, kind: 'ok' })
        P.toast(`Scan terminé : ${d.summary.stories} récits analysés`)
        await reloadAfterScan()
      },
      error: (d, e) => {
        if (!e?.data) return // erreur de transport : gérée plus bas
        finished = true
        job.es.close()
        job.status = 'error'
        job.error = d
        job.lines.push({ text: d.message, kind: 'err' })
        renderSource()
      },
    }, () => {
      if (finished) return
      if (job.es.readyState === EventSource.CLOSED) {
        job.status = 'error'
        job.error = { message: 'Le suivi du scan a été interrompu.', hint: 'Rechargez la page : les récits apparaîtront si le scan a abouti.' }
        renderSource()
      }
    })
    // En cas de reconnexion, le serveur rejoue tout l'historique : on repart d'un journal vide.
    job.es.addEventListener('open', () => { if (!finished) job.lines = [] })
  }

  async function reloadAfterScan() {
    if (state.dirty && !(await P.confirm('Le scan est terminé. Recharger la liste des récits ? Les modifications non enregistrées du Gherkin seront perdues.', { title: 'Recharger les récits', okLabel: 'Recharger', danger: true }))) {
      renderSource()
      return
    }
    try {
      await Promise.all([loadStories(), loadIndex(), loadJiraSettings(), loadTriage()])
    } catch (e) {
      P.toast(messageOf(e), 'error', 7000)
      return
    }
    state.dirty = false
    state.source.open = false
    state.source.url = defaultSourceUrl() || state.source.url
    state.selected.clear()
    state.tab = defaultTab()
    state.filters = { q: '', epic: '', status: '', gherkin: '' }
    const keep = state.key && state.stories.find((s) => s.key === state.key)
    state.key = null
    buildLayout()
    P.shell?.refreshStrip?.()
    const target = keep ? keep.key : visibleStories()[0]?.key || state.stories[0]?.key
    if (target) select(target, { force: true, silentUrl: !keep })
    setTimeout(() => {
      if (state.source.job?.status === 'done') {
        state.source.job = null
        renderSource()
      }
    }, 6000)
  }

  // ------------------------------------------------------------ indicateurs, barre de filtres, onglets

  function renderSummary() {
    if (!ui.summary) return
    const s = state.summary || {}
    const pct = s.total ? Math.round((s.covered / s.total) * 100) : 0
    const c = triageCounts()
    P.clear(ui.summary)
    ui.summary.append(
      P.kpi({ label: 'Récits', value: s.total ?? state.stories.length, detail: s.withoutCriteria ? `${s.withoutCriteria} sans critère d’acceptation` : 'Tous ont des critères', tone: '' }),
      P.kpi({ label: 'À automatiser', value: c.todo, detail: c.untriaged ? `${c.untriaged} récit${c.untriaged > 1 ? 's' : ''} à trier` : 'Tous les récits sont triés', tone: c.untriaged ? 'amber' : 'mint' }),
      P.kpi({ label: 'Couverture Gherkin', value: pct, unit: '%', detail: `${s.covered ?? 0} récit(s) avec scénarios` }),
      P.kpi({ label: 'Brouillons à relire', value: s.drafts ?? 0, detail: s.withErrors ? `${s.withErrors} avec erreurs` : 'Aucune erreur bloquante', tone: s.drafts ? 'amber' : '' }),
      P.kpi({ label: 'Validés', value: s.validated ?? 0, detail: s.exported ? `${s.exported} exporté(s) dans ${state.featuresDir}/` : s.total ? `sur ${s.total} récits` : '', tone: s.validated && s.validated === s.total ? 'mint' : '' }))
  }

  function triageCounts() {
    const c = { untriaged: 0, todo: 0, later: 0, skip: 0 }
    for (const s of state.stories) {
      const d = decisionOf(s.key)
      if (d) c[d] += 1
      else c.untriaged += 1
    }
    return c
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
    ui.gherkinSel = h('select', { class: 'p-select', 'aria-label': 'Scénarios Gherkin', onchange: (e) => { state.filters.gherkin = e.target.value; refreshFilters() } })
    renderGherkinOptions()
    ui.count = h('span', { class: 'p-toolbar-count' })
    return h('div', { class: 'p-toolbar' }, P.icon('filter'), search, epicSel, statusSel, ui.gherkinSel, ui.count)
  }

  /** Filtre Gherkin avec compteurs (dans l'onglet de tri courant). */
  function renderGherkinOptions() {
    if (!ui.gherkinSel) return
    const base = filtered().filter((s) => inTab(s, state.tab))
    P.clear(ui.gherkinSel)
    for (const f of GHERKIN_FILTERS) {
      const n = base.filter((s) => matchesGherkin(s, f.id)).length
      ui.gherkinSel.appendChild(h('option', { value: f.id, selected: f.id === state.filters.gherkin }, `${f.label} (${n})`))
    }
  }

  function refreshFilters() {
    renderTabs()
    renderList()
    renderBulk()
  }

  function tabItems() {
    const base = filtered().filter((s) => matchesGherkin(s, state.filters.gherkin))
    return TABS.map((t) => ({
      ...t,
      count: base.filter((s) => inTab(s, t.id)).length,
      tone: t.id === 'triage' ? 'amber' : t.id === 'todo' ? 'mint' : '',
    }))
  }

  function renderTabs() {
    if (ui.tabsCtl) ui.tabsCtl.update(tabItems())
  }

  // ------------------------------------------------------------ actions groupées de tri

  function renderBulk() {
    if (!ui.bulk) return
    renderGherkinOptions()
    P.clear(ui.bulk)
    const visible = visibleStories()
    // La sélection ne garde que des récits existants.
    for (const k of [...state.selected]) if (!state.stories.some((s) => s.key === k)) state.selected.delete(k)
    const n = state.selected.size
    const allVisible = visible.length > 0 && visible.every((s) => state.selected.has(s.key))
    const someVisible = visible.some((s) => state.selected.has(s.key))
    const all = h('input', {
      type: 'checkbox', 'aria-label': 'Sélectionner tous les récits affichés', checked: allVisible,
      onchange: (e) => {
        visible.forEach((s) => (e.target.checked ? state.selected.add(s.key) : state.selected.delete(s.key)))
        renderBulk()
        renderList()
      },
    })
    all.indeterminate = someVisible && !allVisible
    const act = (decision, label, iconName, kind = '') => h('button', {
      class: `p-btn p-btn--sm ${kind}`, type: 'button', disabled: !n, onclick: (e) => bulkDecide(decision, e.currentTarget),
    }, P.icon(iconName), label)
    // P.append ignore les null (Element.append les afficherait en texte).
    P.append(ui.bulk, [
      h('label', { class: 'p-check rc-bulk-all' }, all, h('span', null, n ? `${n} sélectionné${n > 1 ? 's' : ''}` : 'Tout sélectionner')),
      act('todo', 'À automatiser', 'zap', 'rc-act-todo'),
      act('later', 'Plus tard', 'clock'),
      act('skip', 'Ignorer', 'eyeOff'),
      act(null, 'Réinitialiser', 'refresh', 'p-btn--ghost'),
      n ? h('button', { class: 'p-btn p-btn--sm p-btn--ghost', type: 'button', onclick: () => { state.selected.clear(); renderBulk(); renderList() } }, P.icon('x'), 'Désélectionner') : null,
      h('span', { class: 'p-spacer' }),
      h('button', { class: 'p-btn p-btn--sm', type: 'button', onclick: (e) => openApplySuggestions(e.currentTarget), title: 'Applique la suggestion des règles aux récits sans décision (ou à la sélection)' }, P.icon('listChecks'), 'Appliquer les suggestions'),
      h('button', { class: 'p-btn p-btn--sm', type: 'button', onclick: (e) => classifyWithAi(e.currentTarget), title: 'Demande à l’assistant IA de classer les récits sans décision (ou la sélection)' }, P.icon('sparkles'), 'Classer avec l’IA')])
  }

  async function bulkDecide(decision, button) {
    const keys = [...state.selected]
    if (!keys.length) return
    await P.busy(button, async () => {
      try {
        const r = await P.api('/api/jira/triage/bulk', { body: { keys, decision } })
        applyTriagePayload(r)
        state.selected.clear()
        afterTriageChange()
        P.toast(decision ? `${keys.length} récit${keys.length > 1 ? 's' : ''} classé${keys.length > 1 ? 's' : ''} « ${DECISION[decision].label} »` : `Décision réinitialisée pour ${keys.length} récit${keys.length > 1 ? 's' : ''}`)
      } catch (e) {
        P.toast(messageOf(e), 'error', 7000)
      }
    })
  }

  function afterTriageChange() {
    renderSummary()
    renderTabs()
    renderBulk()
    renderList()
    renderDecision()
  }

  function openApplySuggestions() {
    const selection = [...state.selected]
    const targets = selection.length
      ? state.stories.filter((s) => state.selected.has(s.key))
      : state.stories.filter((s) => !decisionOf(s.key))
    if (!targets.length) {
      P.toast('Tous les récits ont déjà une décision : sélectionnez ceux à reclasser.', 'ok')
      return
    }
    const by = { todo: [], later: [], skip: [] }
    targets.forEach((s) => { const sug = state.suggestions[s.key]; if (sug) by[sug.suggestion].push(s) })
    const recap = h('div', { class: 'rc-recap' }, ['todo', 'later', 'skip'].map((d) => h('div', { class: `rc-recap-item rc-recap--${d}` },
      h('div', { class: 'rc-recap-num' }, String(by[d].length)), h('div', null, DECISION[d].label))))
    const rows = targets.map((s) => {
      const sug = state.suggestions[s.key]
      return h('tr', null,
        h('td', { class: 'p-mono' }, s.key),
        h('td', null, h('div', { class: 'p-ellipsis rc-recap-title', title: s.summary }, s.summary)),
        h('td', null, sug ? suggestionChip(sug) : '—'),
        h('td', null, decisionOf(s.key) ? decisionBadge(decisionOf(s.key)) : h('span', { class: 'p-faint' }, 'aucune')))
    })
    P.modal({
      title: 'Appliquer les suggestions',
      wide: true,
      body: h('div', null,
        h('p', { style: { marginTop: 0 } }, selection.length
          ? `La suggestion des règles remplacera la décision des ${targets.length} récit(s) sélectionné(s).`
          : `La suggestion des règles sera appliquée aux ${targets.length} récit(s) sans décision. Les décisions déjà prises ne changent pas.`),
        recap,
        h('div', { class: 'rc-recap-table' }, h('table', { class: 'p-table' },
          h('thead', null, h('tr', null, h('th', null, 'Récit'), h('th', null, 'Titre'), h('th', null, 'Suggestion'), h('th', null, 'Décision actuelle'))),
          h('tbody', null, rows))),
        h('p', { class: 'p-hint' }, 'Vous pourrez corriger chaque décision ensuite, une par une ou par sélection.')),
      actions: [
        { label: 'Annuler', kind: 'ghost' },
        {
          label: `Appliquer à ${targets.length} récit${targets.length > 1 ? 's' : ''}`,
          kind: 'primary',
          icon: 'check',
          onClick: async (close, ev) => {
            try {
              const body = selection.length ? { applySuggestions: true, keys: selection, overwrite: true } : { applySuggestions: true }
              const r = await P.busy(ev.currentTarget, () => P.api('/api/jira/triage/bulk', { body }))
              applyTriagePayload(r)
              state.selected.clear()
              afterTriageChange()
              P.toast(`${r.applied} suggestion${r.applied > 1 ? 's' : ''} appliquée${r.applied > 1 ? 's' : ''}`)
              return true
            } catch (e) {
              P.toast(messageOf(e), 'error', 7000)
              return false
            }
          },
        },
      ],
    })
  }

  async function classifyWithAi(button) {
    const keys = [...state.selected]
    if (!keys.length && !state.stories.some((s) => !decisionOf(s.key))) {
      P.toast('Tous les récits ont déjà une décision : sélectionnez ceux à faire reclasser par l’IA.', 'ok')
      return
    }
    const slow = setTimeout(() => P.toast('L’assistant IA analyse les récits : cela peut prendre une minute.', 'ok', 6000), 2500)
    try {
      const r = await P.busy(button, () => P.api('/api/jira/triage/ai', { body: keys.length ? { keys } : {} }))
      if (r.manual) openAiManual(r)
      else showAiResults(r)
    } catch (e) {
      P.toast(messageOf(e), 'error', 8000)
    } finally {
      clearTimeout(slow)
    }
  }

  function openAiManual(r) {
    const promptArea = h('textarea', { class: 'p-textarea', rows: '8', readonly: true, 'aria-label': 'Prompt à copier' })
    promptArea.value = r.prompt || ''
    const answer = h('textarea', { class: 'p-textarea', rows: '8', placeholder: '{"items":[{"key":"CLE-1","decision":"todo","score":80,"reason":"…"}]}', 'aria-label': 'Réponse JSON de l’assistant' })
    const errorBox = h('div', { class: 'rc-manual-error' })
    P.modal({
      title: 'Classement par l’IA — copier-coller',
      wide: true,
      body: h('div', null,
        P.banner(r.invalid ? 'warn' : 'blue', h('div', null,
          h('b', null, r.invalid ? 'La réponse de l’IA n’a pas pu être exploitée.' : 'Aucun assistant IA n’a pu répondre automatiquement.'),
          h('div', null, `${r.reason || ''} Copiez le prompt dans Copilot Chat (ou un autre assistant), puis collez sa réponse JSON ci-dessous.`))),
        r.truncated ? h('p', { class: 'p-hint' }, `${r.keys.length} récits envoyés ; ${r.truncated} autre(s) seront à classer dans un second temps.`) : null,
        h('div', { class: 'rc-manual-step' },
          h('div', { class: 'p-row p-row--between' }, h('label', { class: 'p-label' }, '1. Prompt à copier'),
            h('button', { class: 'p-btn p-btn--sm', type: 'button', onclick: () => P.copy(r.prompt || '') }, P.icon('copy'), 'Copier le prompt')),
          promptArea),
        h('div', { class: 'rc-manual-step' }, h('label', { class: 'p-label' }, '2. Réponse JSON de l’assistant'), answer),
        errorBox),
      actions: [
        { label: 'Annuler', kind: 'ghost' },
        {
          label: 'Analyser la réponse',
          kind: 'primary',
          icon: 'check',
          onClick: async (close, ev) => {
            P.clear(errorBox)
            if (!answer.value.trim()) {
              errorBox.appendChild(P.banner('warn', 'Collez d’abord la réponse de l’assistant.'))
              return false
            }
            try {
              const res = await P.busy(ev.currentTarget, () => P.api('/api/jira/triage/ai', { body: { keys: r.keys, answer: answer.value } }))
              setTimeout(() => showAiResults(res), 0)
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

  function showAiResults(r) {
    if (r.ai) state.ai = r.ai
    renderList()
    renderDecision()
    const chosen = new Set(r.items.filter((it) => !decisionOf(it.key) || state.selected.has(it.key)).map((it) => it.key))
    const story = (k) => state.stories.find((s) => s.key === k)
    const rows = r.items.map((it) => h('tr', null,
      h('td', null, h('input', { type: 'checkbox', checked: chosen.has(it.key), 'aria-label': `Appliquer à ${it.key}`, onchange: (e) => (e.target.checked ? chosen.add(it.key) : chosen.delete(it.key)) })),
      h('td', { class: 'p-mono' }, it.key),
      h('td', null, h('div', { class: 'p-ellipsis rc-recap-title', title: story(it.key)?.summary || '' }, story(it.key)?.summary || '')),
      h('td', null, decisionBadge(it.suggestion), it.score != null ? h('span', { class: 'p-faint' }, ` ${it.score}`) : null),
      h('td', { class: 'rc-ai-reason' }, it.reason || '—'),
      h('td', null, decisionOf(it.key) ? decisionBadge(decisionOf(it.key)) : h('span', { class: 'p-faint' }, 'aucune'))))
    P.modal({
      title: `Proposition de l’IA${r.provider && r.provider !== 'manual' ? ` (${providerLabel(r.provider)}${r.model ? ` · ${r.model}` : ''})` : ''}`,
      wide: true,
      body: h('div', null,
        h('p', { style: { marginTop: 0 } }, `${r.items.length} récit${r.items.length > 1 ? 's' : ''} classé${r.items.length > 1 ? 's' : ''}. Cochez les propositions à appliquer : elles deviennent vos décisions, modifiables ensuite.`),
        r.missing?.length ? P.banner('warn', `Sans réponse de l’IA : ${r.missing.join(', ')}.`) : null,
        r.truncated ? P.banner('info', `${r.truncated} récit(s) supplémentaire(s) n’ont pas été envoyés (40 au plus par demande) : relancez le classement pour la suite.`) : null,
        h('div', { class: 'rc-recap-table' }, h('table', { class: 'p-table' },
          h('thead', null, h('tr', null, h('th', null, ''), h('th', null, 'Récit'), h('th', null, 'Titre'), h('th', null, 'IA'), h('th', null, 'Raison'), h('th', null, 'Décision actuelle'))),
          h('tbody', null, rows)))),
      actions: [
        { label: 'Fermer', kind: 'ghost' },
        {
          label: 'Appliquer la sélection',
          kind: 'primary',
          icon: 'check',
          onClick: async (close, ev) => {
            const items = r.items.filter((it) => chosen.has(it.key)).map((it) => ({ key: it.key, decision: it.suggestion, reason: `IA : ${it.reason || DECISION[it.suggestion].label}` }))
            if (!items.length) return true
            try {
              const res = await P.busy(ev.currentTarget, () => P.api('/api/jira/triage/bulk', { body: { items } }))
              applyTriagePayload(res)
              state.selected.clear()
              afterTriageChange()
              P.toast(`${items.length} décision${items.length > 1 ? 's' : ''} appliquée${items.length > 1 ? 's' : ''}`)
              return true
            } catch (e) {
              P.toast(messageOf(e), 'error', 7000)
              return false
            }
          },
        },
      ],
    })
  }

  // ------------------------------------------------------------ liste maître

  function gherkinBadge(key) {
    const e = state.index[key]
    if (!e) return P.badge('Aucun scénario', 'outline')
    if (e.status === 'validated') return e.exported ? P.badge('Exporté', 'teal') : P.badge('Validé', 'mint')
    if (e.errors) return P.badge(`${e.errors} erreur${e.errors > 1 ? 's' : ''}`, 'red')
    return P.badge('Brouillon', 'amber')
  }

  function decisionBadge(decision) {
    const d = DECISION[decision]
    return d ? h('span', { class: `p-badge ${d.tone} rc-decision-badge` }, P.icon(d.icon, 12), d.label) : null
  }

  /** Suggestion (règles) : pastille en pointillés, raisons au survol. */
  function suggestionChip(sug, { compact = false } = {}) {
    if (!sug) return null
    const d = DECISION[sug.suggestion]
    return h('span', {
      class: `rc-sug rc-sug--${sug.suggestion}`,
      title: `Suggestion : ${d.label} (score ${sug.score}/100)\n${(sug.reasons || []).join('\n')}`,
    }, compact ? '' : 'Suggéré : ', d.label, h('b', null, String(sug.score)))
  }

  function renderList() {
    if (!ui.list) return
    const list = visibleStories()
    ui.count.textContent = `${list.length} récit${list.length > 1 ? 's' : ''}`
    renderGherkinOptions()
    P.clear(ui.list)
    if (!list.length) {
      const msg = {
        triage: 'Tous les récits filtrés sont triés. Retrouvez-les dans « À automatiser », « Plus tard » ou « Ignorés ».',
        todo: 'Aucun récit « À automatiser » : triez les récits depuis l’onglet « À trier ».',
        later: 'Aucun récit gardé pour plus tard.',
        skip: 'Aucun récit ignoré.',
      }[state.tab] || 'Aucun récit ne correspond aux filtres.'
      ui.list.appendChild(P.empty('Aucun récit', msg, state.tab === 'triage' ? 'checkCircle' : 'search'))
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
      const d = decisionOf(s.key)
      const checked = state.selected.has(s.key)
      const check = h('input', {
        type: 'checkbox', checked, 'aria-label': `Sélectionner ${s.key}`,
        onclick: (e) => e.stopPropagation(),
        onkeydown: (e) => e.stopPropagation(),
        onchange: (e) => {
          if (e.target.checked) state.selected.add(s.key)
          else state.selected.delete(s.key)
          e.target.closest('.rc-item')?.classList.toggle('is-checked', e.target.checked)
          renderBulk()
        },
      })
      ui.list.appendChild(h('div', {
        class: `p-list-item rc-item ${s.key === state.key ? 'active' : ''} ${checked ? 'is-checked' : ''}`,
        role: 'option',
        tabindex: s.key === state.key ? '0' : '-1',
        'aria-selected': s.key === state.key ? 'true' : 'false',
        dataset: { key: s.key },
        onclick: () => select(s.key),
      },
      h('label', { class: 'rc-item-check', onclick: (e) => e.stopPropagation() }, check),
      h('div', { class: 'rc-item-main' },
        h('div', { class: 'rc-item-top' },
          h('span', { class: 'rc-item-key' }, s.key),
          h('span', { class: 'rc-item-badges' }, d ? decisionBadge(d) : suggestionChip(state.suggestions[s.key], { compact: true }), gherkinBadge(s.key))),
        h('div', { class: 'p-list-item-title rc-item-title' }, s.summary),
        h('div', { class: 'p-list-item-meta' }, `${s.issueType && !/^(story|r[ée]cit)$/i.test(s.issueType) ? `${s.issueType} · ` : ''}${s.status || '—'} · ${n ? `${n} critère${n > 1 ? 's' : ''}` : 'aucun critère'}`))))
    }
    // Au moins un élément atteignable au clavier.
    if (!ui.list.querySelector('.rc-item[tabindex="0"]')) ui.list.querySelector('.rc-item')?.setAttribute('tabindex', '0')
  }

  /** Clavier dans la liste : flèches (récit précédent / suivant), Début / Fin, Entrée ou Espace (ouvrir), X (cocher). */
  function onListKey(e) {
    const item = e.target.closest?.('.rc-item')
    if (!item) return
    const items = [...ui.list.querySelectorAll('.rc-item')]
    const i = items.indexOf(item)
    let next = null
    if (e.key === 'ArrowDown') next = items[i + 1]
    else if (e.key === 'ArrowUp') next = items[i - 1]
    else if (e.key === 'Home') next = items[0]
    else if (e.key === 'End') next = items[items.length - 1]
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      select(item.dataset.key)
      return
    } else if (e.key.toLowerCase() === 'x') {
      e.preventDefault()
      item.querySelector('input[type="checkbox"]')?.click()
      return
    }
    if (!next) return
    e.preventDefault()
    items.forEach((el) => el.setAttribute('tabindex', '-1'))
    next.setAttribute('tabindex', '0')
    next.focus()
    select(next.dataset.key)
  }

  function markActive() {
    ui.list?.querySelectorAll('.p-list-item').forEach((el) => {
      const on = el.dataset.key === state.key
      el.classList.toggle('active', on)
      el.setAttribute('aria-selected', on ? 'true' : 'false')
      el.setAttribute('tabindex', on ? '0' : '-1')
    })
  }

  // ------------------------------------------------------------ sélection d'un récit

  async function select(key, { force = false, silentUrl = false } = {}) {
    if (!force && key === state.key) return
    if (state.dirty && !(await P.confirm('Les modifications du Gherkin ne sont pas enregistrées. Les abandonner ?', { title: 'Modifications non enregistrées', okLabel: 'Abandonner', danger: true }))) {
      markActive()
      return
    }
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
    ui.decision = null
    if (!state.key) {
      ui.detail.appendChild(P.card({ body: P.empty('Choisissez un récit', 'Sélectionnez un récit dans la liste pour voir sa suggestion de tri, ses critères et ses scénarios.', 'listChecks') }))
      return
    }
    if (state.detail?.error) {
      ui.detail.append(errorBanner(state.detail.error, 'Impossible de charger le récit.'),
        h('div', null, h('button', { class: 'p-btn', type: 'button', onclick: () => select(state.key, { force: true }) }, P.icon('refresh'), 'Réessayer')))
      return
    }
    const s = story()
    if (!s) return
    ui.decision = h('div')
    ui.detail.append(headCard(s), ui.decision, P.card({ className: 'rc-stepper', body: P.stepper(stepItems(s)) }))
    renderDecision()
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

  /** Bloc « Décision de test » : suggestion expliquée, trois boutons, raison, puis la suite (Playwright, Xray). */
  function renderDecision() {
    if (!ui.decision || !ui.decision.isConnected) return
    const s = story()
    if (!s) return
    P.clear(ui.decision)
    const key = s.key
    const current = state.triage[key] || null
    const sug = state.suggestions[key]
    const ai = state.ai[key]
    const reason = h('input', { class: 'p-input', type: 'text', maxlength: '500', placeholder: 'Raison (facultatif) : par exemple « parcours critique du comité »', 'aria-label': 'Raison de la décision', value: current?.reason || '' })
    const choose = (decision) => async (ev) => {
      await P.busy(ev.currentTarget, async () => {
        try {
          const wasTriage = state.tab === 'triage' && !current
          const before = visibleStories().map((x) => x.key)
          const r = await P.api(`/api/jira/triage/${encodeURIComponent(key)}`, { method: 'PUT', body: { decision, reason: reason.value } })
          if (r.entry) state.triage[key] = r.entry
          else delete state.triage[key]
          afterTriageChange()
          P.toast(decision ? `${key} : ${DECISION[decision].label}` : `${key} : décision réinitialisée`)
          // Tri à la chaîne : dans « À trier », on passe au récit suivant.
          if (wasTriage && decision && state.key === key && !state.dirty) {
            const i = before.indexOf(key)
            const nextKey = before.slice(i + 1).find((k) => !decisionOf(k)) || before.slice(0, i).find((k) => !decisionOf(k))
            if (nextKey) select(nextKey)
          }
        } catch (e) {
          P.toast(messageOf(e), 'error', 7000)
        }
      })
    }
    const seg = h('div', { class: 'rc-decide', role: 'group', 'aria-label': 'Décision de test' },
      ['todo', 'later', 'skip'].map((d) => h('button', {
        type: 'button',
        class: `p-btn rc-decide-btn rc-decide--${d} ${current?.decision === d ? 'active' : ''} ${!current && sug?.suggestion === d ? 'is-suggested' : ''}`,
        'aria-pressed': current?.decision === d ? 'true' : 'false',
        title: !current && sug?.suggestion === d ? 'Suggestion des règles' : '',
        onclick: choose(d),
      }, P.icon(DECISION[d].icon), DECISION[d].verb)),
      current ? h('button', { type: 'button', class: 'p-btn p-btn--ghost p-btn--sm', onclick: choose(null), title: 'Revenir dans « À trier »' }, P.icon('refresh'), 'Réinitialiser') : null)

    const factors = (sug?.factors || []).map((f) => h('li', { class: f.points > 0 ? 'plus' : 'minus' },
      h('span', { class: 'rc-factor-pts' }, `${f.points > 0 ? '+' : '−'}${Math.abs(f.points)}`), h('span', null, f.label)))
    const explain = sug ? h('details', { class: 'rc-explain' },
      h('summary', null,
        h('span', null, 'Suggestion des règles : '), h('b', null, DECISION[sug.suggestion].label),
        h('span', { class: 'rc-score' }, h('span', { class: `rc-score-fill rc-score--${sug.suggestion}`, style: { width: `${sug.score}%` } })),
        h('span', { class: 'p-faint' }, `${sug.score}/100 · pourquoi ?`)),
      h('ul', { class: 'rc-factors' }, factors),
      h('div', { class: 'p-hint' }, 'Score de départ 50 ; « À automatiser » à partir de 60, « Plus tard » de 35 à 59, « Ignorer » en dessous.')) : null
    const aiLine = ai ? h('div', { class: 'rc-ai-line' }, P.icon('sparkles'),
      h('span', null, 'Proposition de l’IA : '), decisionBadge(ai.suggestion), ai.reason ? h('span', { class: 'p-muted' }, ` ${ai.reason}`) : null) : null

    const g = state.index[key]
    const validated = g?.status === 'validated'
    const xray = window.XrayPush
    const next = h('div', { class: 'rc-next' },
      current?.decision === 'todo'
        ? h('a', { class: 'p-btn p-btn--primary', href: `/automatisation.html?key=${encodeURIComponent(key)}` }, P.icon('play'), 'Automatiser avec Playwright')
        : h('span', { class: 'p-hint' }, current?.decision ? `Récit classé « ${DECISION[current.decision].label} ».` : 'Classez ce récit « À automatiser » pour lancer l’exploration Playwright de l’application.'),
      validated
        ? h('button', {
          class: 'p-btn', type: 'button', disabled: !xray,
          title: xray ? 'Crée (ou met à jour) le ticket Test Cucumber dans JIRA / Xray, relié au récit' : 'Module d’envoi JIRA / Xray indisponible sur ce poste',
          onclick: () => window.XrayPush?.open({ storyKey: key, source: { kind: 'gherkin' }, onDone: () => refreshIndex() }),
        }, P.icon('upload'), 'Envoyer dans JIRA / Xray')
        : null)

    ui.decision.appendChild(P.card({
      className: 'rc-decision-card',
      title: 'Décision de test',
      sub: current
        ? `${DECISION[current.decision].label}${current.by ? ` · par ${current.by}` : ''} · ${P.fmtAgo(current.updatedAt)}${current.reason ? ` · ${current.reason}` : ''}`
        : 'À trier : ce récit mérite-t-il un test automatisé ?',
      icon: current ? DECISION[current.decision].icon : 'filter',
      tone: current?.decision === 'todo' ? '' : current ? 'grey' : 'amber',
      body: h('div', { class: 'p-stack rc-decision' }, seg, reason, explain, aiLine, next),
    }))
  }

  function stepItems(s) {
    const e = entry()
    const errors = state.analysis?.counts?.error || 0
    const n = s.acceptanceCriteria?.length || 0
    const generating = state.busy === 'llm' || state.busy === 'template'
    const validated = e?.status === 'validated' && !state.dirty
    const exported = validated && e.exported
    const d = decisionOf(s.key)
    return [
      { label: 'Tri', sub: d ? DECISION[d].label : 'À décider', state: d === 'todo' ? 'done' : d ? 'skipped' : 'current' },
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
    const without = state.stories.filter((s) => !state.index[s.key])
    if (!without.length) {
      P.toast('Tous les récits ont déjà des scénarios.', 'ok')
      return
    }
    // Par défaut : uniquement les récits triés « À automatiser » ; option pour inclure les autres (sauf ignorés).
    const todoKeys = without.filter((s) => decisionOf(s.key) === 'todo').map((s) => s.key)
    const allKeys = without.filter((s) => decisionOf(s.key) !== 'skip').map((s) => s.key)
    let includeAll = !todoKeys.length && !state.stories.some((s) => decisionOf(s.key))
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
    const scope = h('p', { style: { marginTop: 0 } })
    const keys = () => (includeAll ? allKeys : todoKeys)
    let launchBtn = null
    const renderScope = () => {
      const k = keys()
      P.clear(scope).append(k.length
        ? `${k.length} récit${k.length > 1 ? 's' : ''} ${includeAll ? 'sans scénario (hors « Ignorés »)' : '« À automatiser » sans scénario'} : ${k.slice(0, 6).join(', ')}${k.length > 6 ? '…' : ''}`
        : h('span', null, 'Aucun récit « À automatiser » sans scénario. ', h('b', null, 'Triez les récits'), ' (onglet « À trier ») ou incluez tous les récits ci-dessous.'))
      if (launchBtn) launchBtn.disabled = !k.length
    }
    const include = h('label', { class: 'p-check' },
      h('input', { type: 'checkbox', checked: includeAll, onchange: (e) => { includeAll = e.target.checked; renderScope() } }),
      h('span', null, `Inclure aussi les récits non triés et « Plus tard » (${allKeys.length})`))
    renderScope()
    const m = P.modal({
      title: 'Générer les scénarios Gherkin',
      body: h('div', null,
        scope,
        include,
        h('div', { style: { height: '12px' } }),
        radios,
        h('p', { class: 'p-hint' }, 'Les scénarios produits sont des brouillons à relire. Les récits déjà couverts ne sont pas modifiés.')),
      actions: [
        { label: 'Annuler', kind: 'ghost' },
        {
          label: 'Lancer la génération',
          kind: 'primary',
          icon: 'play',
          onClick: () => {
            if (!keys().length) return false
            startBatch(keys(), mode)
          },
        },
      ],
    })
    launchBtn = m.root.querySelector('.p-modal-foot .p-btn--primary')
    renderScope()
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

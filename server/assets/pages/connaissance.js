/*
 * Prise de connaissance : 1 Projet → 2 Connexion JIRA → 3 Scan → 4 Synthèse.
 * Ancres : #projet, #connexion, #scan, #synthese.
 */
;(function () {
  'use strict'
  const P = window.Prisme
  const { h } = P

  const STEPS = [
    { id: 'projet', label: 'Projet' },
    { id: 'connexion', label: 'Connexion JIRA' },
    { id: 'scan', label: 'Scan des récits' },
    { id: 'synthese', label: 'Synthèse' },
  ]
  const MODE_KEY = 'wizardqa.connaissance.mode'
  const SEVERITY_TONE = { high: 'red', medium: 'amber', info: 'blue' }
  const CATEGORY_TONE = { new: '', indeterminate: 'blue', done: 'mint' }
  const SOURCE_LABEL = { field: 'champ dédié', description: 'description', none: 'aucun' }

  const state = {
    user: null,
    step: 'projet',
    mode: 'demo',
    settings: null,      // réponse GET /api/jira/settings
    overview: null,      // réponse GET /api/jira/overview
    test: null,          // { ok, data } | { ok: false, error }
    job: null,           // scan en cours ou terminé
    jql: '',
    projectKey: '',
    tab: 'clarify',
    filters: { q: '', epic: '', status: '' },
  }
  const app = document.getElementById('app')

  P.whenShell().then(init)

  // ------------------------------------------------------------ démarrage

  async function init(ready) {
    state.user = ready?.user || null
    try {
      await loadData()
    } catch (e) {
      P.clear(app)
      app.appendChild(errorBanner(e, 'Impossible de charger la prise de connaissance.'))
      app.appendChild(h('div', null, h('button', { class: 'p-btn', onclick: () => location.reload() }, P.icon('refresh'), 'Réessayer')))
      return
    }
    state.mode = readMode()
    state.step = stepFromHash() || (state.overview.empty ? 'projet' : 'synthese')
    resetScanForm()
    window.addEventListener('hashchange', () => {
      const s = stepFromHash()
      if (s && s !== state.step) go(s)
    })
    render()
  }

  async function loadData() {
    const [settings, overview] = await Promise.all([P.api('/api/jira/settings'), P.api('/api/jira/overview')])
    state.settings = settings
    state.overview = overview
  }

  function stepFromHash() {
    const id = location.hash.replace('#', '')
    return STEPS.some((s) => s.id === id) ? id : null
  }

  function readMode() {
    let saved = null
    try { saved = localStorage.getItem(MODE_KEY) } catch { /* stockage indisponible */ }
    if (saved === 'jira' || saved === 'demo') return saved
    if (state.overview.scan?.source === 'jira') return 'jira'
    return state.settings.configured ? 'jira' : 'demo'
  }

  function setMode(mode) {
    state.mode = mode
    try { localStorage.setItem(MODE_KEY, mode) } catch { /* stockage indisponible */ }
    resetScanForm()
    render()
  }

  function resetScanForm() {
    const s = state.settings.settings
    state.projectKey = s.projectKey || ''
    state.jql = s.jql || state.settings.proposedJql
  }

  function go(step) {
    state.step = step
    if (location.hash !== `#${step}`) history.replaceState(null, '', `#${step}`)
    render()
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const canEdit = () => Boolean(state.settings?.canEdit)
  const hasScan = () => !state.overview.empty

  // ------------------------------------------------------------ rendu général

  function render() {
    renderActions()
    P.clear(app)
    app.appendChild(h('p', { class: 'p-page-intro' },
      'Comprenez ce qu’il faut tester avant d’écrire le moindre scénario : le projet, les récits JIRA, leurs critères d’acceptation et ce qui reste à clarifier avec le PO.'))
    if (!hasScan() && state.step !== 'scan') app.appendChild(firstRunHero())
    app.appendChild(P.card({ className: 'kn-stepper-card', body: P.stepper(stepperItems()) }))
    const panel = h('div', { class: 'p-stack', style: { gap: '16px' } })
    app.appendChild(panel)
    const renderers = { projet: renderProjet, connexion: renderConnexion, scan: renderScan, synthese: renderSynthese }
    renderers[state.step](panel)
  }

  function renderActions() {
    if (!P.shell) return
    const nodes = []
    if (hasScan()) {
      nodes.push(h('button', { class: 'p-btn', type: 'button', onclick: () => go('scan') }, P.icon('refresh'), 'Relancer le scan'))
      nodes.push(h('a', { class: 'p-btn p-btn--primary', href: '/recits.html' }, P.icon('wand'), 'Générer les scénarios Gherkin'))
    } else {
      nodes.push(h('button', { class: 'p-btn p-btn--primary', type: 'button', onclick: runDemoNow }, P.icon('play'), 'Scan de démonstration'))
    }
    P.shell.setActions(...nodes)
  }

  function stepperItems() {
    const project = state.overview.project
    const scan = state.overview.scan
    const s = state.settings
    const done = {
      projet: Boolean(project?.onboardingComplete),
      connexion: state.mode === 'demo' ? hasScan() : s.configured,
      scan: hasScan(),
      synthese: false,
    }
    const subs = {
      projet: project?.applicationLabel || (project?.onboardingComplete ? 'Projet décrit' : 'À renseigner'),
      connexion: state.mode === 'demo' ? 'Données de démonstration' : s.configured ? hostOf(s.settings.baseUrl) : 'À configurer',
      scan: scan ? `${scan.count} récits · ${P.fmtAgo(scan.scannedAt)}` : 'Jamais lancé',
      synthese: hasScan() ? `${state.overview.counts.toClarify} à clarifier` : 'Après le scan',
    }
    return STEPS.map((st) => ({
      label: st.label,
      sub: subs[st.id],
      state: st.id === state.step ? 'current' : done[st.id] ? 'done' : 'todo',
      onClick: () => go(st.id),
    }))
  }

  function firstRunHero() {
    return h('section', { class: 'p-card p-card--soft' }, h('div', { class: 'p-card-body kn-hero' },
      h('span', { class: 'p-tile' }, P.icon('sparkles')),
      h('div', { class: 'kn-hero-text' },
        h('h2', null, 'Aucun récit scanné pour l’instant'),
        h('p', null, 'Découvrez le résultat en un clic avec le projet de démonstration IRMA (16 récits, 4 épopées, critères aux formats variés), puis connectez votre JIRA quand vous êtes prêt.')),
      h('div', { class: 'p-row' },
        h('button', { class: 'p-btn', type: 'button', onclick: () => { setMode('jira'); go('connexion') } }, P.icon('link'), 'Connecter mon JIRA'),
        h('button', { class: 'p-btn p-btn--primary', type: 'button', onclick: runDemoNow }, P.icon('play'), 'Scanner les données de démonstration'))))
  }

  function runDemoNow() {
    setMode('demo')
    go('scan')
    startScan()
  }

  // ------------------------------------------------------------ étape 1 : projet

  function renderProjet(panel) {
    const p = state.overview.project
    const footer = h('div', { class: 'p-row p-row--between' },
      h('a', { class: 'p-btn', href: '/projet.html' }, P.icon('edit'), p?.onboardingComplete ? 'Modifier dans « Mon projet »' : 'Décrire le projet'),
      h('button', { class: 'p-btn p-btn--primary', type: 'button', onclick: () => go('connexion') }, 'Continuer : connexion JIRA', P.icon('arrowRight')))

    if (!p) {
      panel.appendChild(P.banner('warn', 'Le profil projet est illisible. Ouvrez « Mon projet » pour le renseigner à nouveau.'))
      panel.appendChild(footer)
      return
    }
    if (!p.onboardingComplete) {
      panel.appendChild(P.banner('warn', [h('b', null, 'Profil projet non renseigné. '),
        'Décrivez votre équipe et l’application testée : ces informations préremplissent les autres écrans. Vous pouvez aussi passer directement au scan (le mode démonstration utilise le projet IRMA).']))
    }
    const val = (v) => v || h('span', { class: 'p-faint' }, 'non renseigné')
    const identity = P.card({
      title: p.applicationLabel || 'Application non renseignée',
      sub: [p.productCode, p.solutionCode].filter(Boolean).join(' · ') || 'Codes produit et solution à renseigner',
      icon: 'compass',
      body: h('dl', { class: 'p-dl' },
        h('dt', null, 'Tribu'), h('dd', null, val(p.tribu)),
        h('dt', null, 'Squad'), h('dd', null, val(p.squad)),
        h('dt', null, 'Code produit'), h('dd', null, val(p.productCode)),
        h('dt', null, 'Code solution'), h('dd', null, val(p.solutionCode)),
        h('dt', null, 'Outillage retenu'), h('dd', null, val(p.recommendedStack))),
    })
    const people = P.card({
      title: 'Interlocuteurs',
      sub: 'À qui poser les questions de clarification',
      icon: 'users',
      tone: 'blue',
      body: h('dl', { class: 'p-dl' },
        h('dt', null, 'Product Owner'), h('dd', null, val(p.poName)),
        h('dt', null, 'Business Analyst'), h('dd', null, val(p.baName)),
        h('dt', null, 'Scrum Master'), h('dd', null, val(p.scrumMasterName)),
        h('dt', null, 'QA'), h('dd', null, val(p.qaName))),
    })
    const plans = P.card({
      title: 'Plans de test',
      sub: `${p.testPlans.length} plan(s) déclaré(s)`,
      icon: 'listChecks',
      tone: 'purple',
      flush: true,
      body: p.testPlans.length
        ? h('table', { class: 'p-table' }, h('thead', null, h('tr', null, h('th', null, 'Clé'), h('th', null, 'Nom'))),
          h('tbody', null, p.testPlans.map((t) => h('tr', null, h('td', { class: 'p-mono' }, t.planKey), h('td', null, t.planName)))))
        : P.empty('Aucun plan de test', 'Les plans JIRA / Xray se déclarent dans « Mon projet ».', 'listChecks'),
    })
    panel.appendChild(h('div', { class: 'p-grid p-grid-3' }, identity, people, plans))
    panel.appendChild(footer)
  }

  // ------------------------------------------------------------ étape 2 : connexion

  function renderConnexion(panel) {
    panel.appendChild(h('div', { class: 'kn-choice' },
      choice('jira', 'server', 'Mon JIRA', 'JIRA Cloud ou Server / Data Center : les récits réels de votre projet.'),
      choice('demo', 'flask', 'Données de démonstration', 'Projet IRMA - Analyse des Risques Métier : idéal pour découvrir sans accès JIRA.')))
    if (state.mode === 'demo') {
      panel.appendChild(P.card({
        title: 'Jeu de démonstration IRMA',
        sub: 'P0326 · format JIRA Server, traité par la même chaîne d’extraction qu’un vrai scan',
        icon: 'flask',
        tone: 'teal',
        body: h('div', { class: 'p-stack' },
          h('p', { style: { margin: 0 } }, '16 récits répartis en 4 épopées (accès et habilitations, tableau de bord des risques, import des données, restitutions et alertes), avec des critères d’acceptation volontairement hétérogènes :'),
          h('ul', { style: { margin: 0, paddingLeft: '18px' } },
            h('li', null, 'Gherkin en français ou en anglais, puces, listes numérotées, « CA1 : … » ;'),
            h('li', null, 'critères dans un champ dédié ou dans la description ;'),
            h('li', null, 'un récit sans critère, des critères vagues (« rapide », « simple »), une exigence de performance chiffrée.'))),
      }))
      panel.appendChild(h('div', { class: 'p-row p-row--between' },
        h('button', { class: 'p-btn p-btn--ghost', type: 'button', onclick: () => go('projet') }, 'Retour'),
        h('button', { class: 'p-btn p-btn--primary', type: 'button', onclick: () => go('scan') }, 'Continuer : scan', P.icon('arrowRight'))))
      return
    }
    panel.appendChild(h('div', { class: 'p-grid kn-conn-grid' }, connectionForm(), connectionHelp()))
  }

  function choice(mode, iconName, title, text) {
    return h('button', { class: `kn-choice-item ${state.mode === mode ? 'active' : ''}`, type: 'button', 'aria-pressed': String(state.mode === mode), onclick: () => setMode(mode) },
      h('span', { class: `p-tile ${mode === 'demo' ? 'teal' : ''}` }, P.icon(iconName)),
      h('span', null, h('b', null, title), h('span', { class: 'p-muted' }, text)))
  }

  function connectionForm() {
    const s = state.settings.settings
    const ro = !canEdit()
    const input = (name, value, attrs = {}) => h('input', { class: 'p-input', name, value: value || '', disabled: ro, ...attrs })
    const select = (name, value, options) => h('select', { class: 'p-select', name, disabled: ro },
      options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)))
    const field = (label, control, hint, span) => h('div', { class: `p-field ${span ? 'span-2' : ''}` }, h('label', null, label), control, hint ? h('div', { class: 'p-hint' }, hint) : null)

    const form = h('form', { class: 'p-form-grid', autocomplete: 'off', onsubmit: (e) => e.preventDefault() },
      field('Adresse de JIRA', input('baseUrl', s.baseUrl, { placeholder: 'https://monentreprise.atlassian.net', type: 'url' }), 'Adresse de base, sans /browse ni /jira/software.', true),
      field('Type de JIRA', select('deployment', s.deployment, [['auto', 'Détection automatique'], ['cloud', 'JIRA Cloud (API v3)'], ['server', 'JIRA Server / Data Center (API v2)']])),
      field('Authentification', select('authType', s.authType, [['auto', 'Selon le type de JIRA'], ['basic', 'E-mail + jeton d’API (Cloud)'], ['bearer', 'Jeton d’accès personnel (Server)']])),
      field('E-mail ou identifiant', input('email', s.email, { placeholder: 'prenom.nom@entreprise.fr', autocomplete: 'off' }), 'Requis pour JIRA Cloud.'),
      field('Jeton', input('token', '', { type: 'password', placeholder: s.hasToken ? `${s.token} — laisser vide pour conserver` : 'Collez votre jeton', autocomplete: 'new-password' }),
        s.hasToken ? 'Un jeton est enregistré (masqué).' : 'Jeton d’API (Cloud) ou jeton d’accès personnel (Server).'),
      field('Clé du projet', h('div', { class: 'p-row', style: { flexWrap: 'nowrap' } },
        input('projectKey', s.projectKey, { placeholder: 'P0326', style: { textTransform: 'uppercase' } }),
        h('button', { class: 'p-btn', type: 'button', title: 'Liste les projets visibles avec les réglages enregistrés', onclick: (e) => pickProject(e.currentTarget) }, P.icon('search'), 'Projets'))),
      field('Types d’issues des récits', input('issueTypes', (s.issueTypes || []).join(', '), { placeholder: 'Story, Récit' }), 'Séparés par des virgules.'),
      field('Champ des critères d’acceptation', input('acceptanceField', s.acceptanceField, { placeholder: 'Détection automatique' }), 'Nom ou identifiant (customfield_10400) si la détection échoue.'),
      field('Proxy HTTPS', input('proxy', s.proxy, { placeholder: 'http://proxy.entreprise.fr:8080' }), 'Facultatif : sinon la variable HTTPS_PROXY est utilisée.'))

    const testHost = h('div', { class: 'kn-test' }, testResult())
    const notes = []
    if (state.settings.inheritedFrom?.length && !state.settings.saved) {
      notes.push(P.banner('blue', `Valeurs reprises ${state.settings.inheritedFrom.map((f) => (f === 'hook' ? 'du Hook Git' : 'du profil projet')).join(' et ')} : vérifiez-les puis enregistrez.`))
    }
    if (ro) notes.push(P.banner('info', 'Seul un administrateur peut modifier ces réglages. Vous pouvez tester la connexion enregistrée.'))

    const actions = h('div', { class: 'p-row' },
      h('button', { class: 'p-btn', type: 'button', onclick: (e) => testConnection(e.currentTarget, form, testHost) }, P.icon('zap'), 'Tester la connexion'),
      ro ? null : h('button', { class: 'p-btn p-btn--primary', type: 'button', onclick: (e) => saveSettings(e.currentTarget, form) }, P.icon('save'), 'Enregistrer'),
      h('span', { class: 'p-spacer' }),
      h('button', { class: 'p-btn p-btn--ghost', type: 'button', disabled: !state.settings.configured, onclick: () => go('scan') }, 'Continuer : scan', P.icon('arrowRight')))

    return P.card({
      title: 'Connexion à JIRA',
      sub: state.settings.configured ? `Configurée : ${hostOf(s.baseUrl)}` : 'Non configurée',
      icon: 'link',
      body: h('div', { class: 'p-stack', style: { gap: '12px' } }, notes, form, actions, testHost),
    })
  }

  function connectionHelp() {
    return P.card({
      title: 'Où trouver mon jeton ?',
      icon: 'key',
      tone: 'amber',
      body: h('div', { class: 'p-stack', style: { gap: '10px', fontSize: '12.5px' } },
        h('div', null, h('b', null, 'JIRA Cloud (*.atlassian.net)'), h('br'),
          'id.atlassian.com › Sécurité › Créer et gérer les jetons d’API. Utilisez l’e-mail de votre compte Atlassian.'),
        h('div', null, h('b', null, 'JIRA Server / Data Center'), h('br'),
          'Votre profil › Jetons d’accès personnels › Créer un jeton. Le jeton suffit, sans e-mail.'),
        h('div', null, h('b', null, 'Réseau d’entreprise'), h('br'),
          'Derrière un proxy, renseignez son adresse. Si le certificat HTTPS est refusé, démarrez le portail avec NODE_EXTRA_CA_CERTS pointant vers le certificat de l’autorité interne.'),
        h('div', { class: 'p-faint' }, 'Le jeton est stocké localement (fichier .wizard-qa/conf/jira.json, accès restreint) et n’est jamais réaffiché.')),
    })
  }

  function collectForm(form) {
    const data = Object.fromEntries(new FormData(form).entries())
    if (!data.token) delete data.token
    data.projectKey = (data.projectKey || '').toUpperCase()
    return data
  }

  async function saveSettings(button, form) {
    await P.busy(button, async () => {
      try {
        state.settings = await P.api('/api/jira/settings', { method: 'PUT', body: collectForm(form) })
        resetScanForm()
        P.toast('Réglages JIRA enregistrés')
        render()
        P.shell?.refreshStrip?.()
      } catch (e) {
        P.toast(e.message, 'error', 6000)
      }
    })
  }

  async function testConnection(button, form, host) {
    await P.busy(button, async () => {
      P.clear(host).appendChild(h('div', { class: 'p-row p-muted' }, h('span', { class: 'p-spinner' }), 'Connexion à JIRA (30 s au plus)…'))
      try {
        const data = await P.api('/api/jira/test-connection', { body: canEdit() ? collectForm(form) : {} })
        state.test = { ok: true, data }
      } catch (e) {
        state.test = { ok: false, error: e }
      }
      P.clear(host).appendChild(testResult())
    })
  }

  function testResult() {
    const t = state.test
    if (!t) return null
    if (!t.ok) return errorBanner(t.error, 'La connexion a échoué.')
    const d = t.data
    const fieldName = (f, fallback) => (f ? `${f.name} (${f.id})` : fallback)
    return P.banner('info', h('div', null,
      h('b', null, `Connexion réussie en ${P.fmtDuration(d.durationMs)}.`),
      h('dl', { class: 'p-dl' },
        h('dt', null, 'JIRA'), h('dd', null, `${d.deployment === 'cloud' ? 'Cloud (API v3)' : 'Server / Data Center (API v2)'}${d.version ? ` · version ${d.version}` : ''}`),
        h('dt', null, 'Compte'), h('dd', null, [d.user.displayName, d.user.email].filter(Boolean).join(' · ') || '—'),
        h('dt', null, 'Critères d’acceptation'), h('dd', null, fieldName(d.fields.acceptance, 'pas de champ dédié : lecture de la description')),
        h('dt', null, 'Lien d’épopée'), h('dd', null, fieldName(d.fields.epicLink, d.deployment === 'cloud' ? 'champ « parent »' : 'non trouvé')),
        h('dt', null, 'Story points'), h('dd', null, fieldName(d.fields.storyPoints, 'non trouvé')),
        d.project ? [h('dt', null, 'Projet'), h('dd', null, `${d.project.key} — ${d.project.name} (types : ${d.project.issueTypes.join(', ')})`)] : null)))
  }

  async function pickProject(button) {
    await P.busy(button, async () => {
      try {
        const { projects } = await P.api('/api/jira/projects')
        let filter = ''
        const list = h('div', { class: 'p-list', style: { maxHeight: '360px', overflow: 'auto' } })
        const draw = () => {
          P.clear(list)
          const f = filter.toLowerCase()
          const rows = projects.filter((p) => !f || `${p.key} ${p.name}`.toLowerCase().includes(f)).slice(0, 200)
          if (!rows.length) list.appendChild(P.empty('Aucun projet', 'Aucun projet ne correspond à ce filtre.', 'search'))
          for (const p of rows) {
            list.appendChild(h('button', { class: 'p-list-item', type: 'button', onclick: () => { applyProject(p.key); dialog.close() } },
              h('div', { class: 'p-list-item-title' }, p.key), h('div', { class: 'p-list-item-meta' }, p.name)))
          }
        }
        const search = h('input', { class: 'p-input', placeholder: 'Filtrer les projets…', oninput: (e) => { filter = e.target.value; draw() } })
        draw()
        const dialog = P.modal({ title: `Projets JIRA (${projects.length})`, body: h('div', { class: 'p-stack' }, search, list) })
      } catch (e) {
        P.toast(`${e.message} ${hintOf(e)}`.trim(), 'error', 7000)
      }
    })
  }

  function applyProject(key) {
    const el = app.querySelector('input[name="projectKey"]')
    if (el) el.value = key
    P.toast(`Projet ${key} sélectionné : pensez à enregistrer`)
  }

  // ------------------------------------------------------------ étape 3 : scan

  function renderScan(panel) {
    const demo = state.mode === 'demo'
    const s = state.settings
    panel.appendChild(h('div', { class: 'kn-choice' },
      choice('jira', 'server', 'Mon JIRA', s.configured ? `Connecté à ${hostOf(s.settings.baseUrl)}` : 'Connexion à configurer d’abord'),
      choice('demo', 'flask', 'Données de démonstration', 'Projet IRMA (P0326), 16 récits')))

    if (!demo && !s.configured) {
      panel.appendChild(P.banner('warn', h('div', null, 'La connexion JIRA n’est pas encore configurée. ',
        h('a', { href: '#connexion', onclick: (e) => { e.preventDefault(); go('connexion') } }, 'Configurer la connexion'),
        ' ou choisissez les données de démonstration.')))
    }

    const running = state.job?.status === 'running'
    const jql = h('textarea', { class: 'p-textarea p-mono kn-jql', spellcheck: 'false', disabled: demo || running, oninput: (e) => { state.jql = e.target.value } })
    jql.value = demo ? 'project = "P0326" AND issuetype in ("Story", "Récit") ORDER BY key ASC' : state.jql
    const key = h('input', { class: 'p-input', value: demo ? 'P0326' : state.projectKey, disabled: demo || running, placeholder: 'P0326', style: { textTransform: 'uppercase', maxWidth: '180px' },
      oninput: (e) => {
        state.projectKey = e.target.value.toUpperCase()
        if (!state.settings.settings.jql) { state.jql = proposedFor(state.projectKey); jql.value = state.jql }
      } })

    const launch = h('button', { class: 'p-btn p-btn--primary', type: 'button', disabled: running || (!demo && !s.configured), onclick: startScan },
      P.icon('play'), running ? 'Scan en cours…' : 'Lancer le scan')
    const form = P.card({
      title: demo ? 'Scan des données de démonstration' : 'Requête de scan',
      sub: demo ? 'Lecture du jeu IRMA comme s’il venait d’un JIRA Server' : 'Proposée à partir du projet et des types d’issues : modifiable avant le lancement',
      icon: 'search',
      body: h('div', { class: 'p-stack', style: { gap: '12px' } },
        h('div', { class: 'p-field' }, h('label', null, 'Clé du projet'), key),
        h('div', { class: 'p-field' }, h('label', null, 'Requête JQL'), jql,
          demo ? null : h('div', { class: 'p-row p-hint' },
            'Sans requête personnalisée, les types d’issues absents du projet sont écartés automatiquement.',
            h('button', { class: 'p-btn p-btn--ghost p-btn--sm', type: 'button', disabled: running, onclick: () => { state.jql = proposedFor(state.projectKey); jql.value = state.jql } }, P.icon('refresh'), 'Rétablir la requête proposée'))),
        h('div', { class: 'p-row' }, launch,
          h('span', { class: 'p-faint' }, 'Description, critères d’acceptation, épopées, liens et sous-tâches sont extraits pour chaque récit.'))),
    })
    panel.appendChild(form)

    const jobHost = h('div')
    panel.appendChild(jobHost)
    state.jobHost = jobHost
    drawJob()

    const history = state.overview.history || []
    if (history.length) panel.appendChild(historyCard(history))
  }

  function proposedFor(key) {
    const types = (state.settings.settings.issueTypes || ['Story', 'Récit']).map((t) => `"${t.replace(/"/g, '\\"')}"`).join(', ')
    return `project = "${key || 'CLE'}" AND issuetype in (${types}) ORDER BY key ASC`
  }

  async function startScan() {
    const demo = state.mode === 'demo'
    // Le scan de démonstration remplace les récits : on prévient avant d'écraser un vrai scan JIRA.
    if (demo && state.overview?.scan?.source === 'jira') {
      const ok = await P.confirm(`Les ${state.overview.scan.count} récits scannés depuis JIRA seront remplacés par les données de démonstration. Continuer ?`,
        { title: 'Remplacer le scan JIRA', okLabel: 'Remplacer par la démonstration' })
      if (!ok) return
    }
    const body = { mode: demo ? 'demo' : 'jira' }
    if (!demo) {
      if (state.projectKey) body.projectKey = state.projectKey
      const proposed = proposedFor(state.projectKey)
      // Requête par défaut : le serveur la reconstruit avec les types réellement présents dans le projet.
      if (state.jql.trim() && state.jql.trim() !== proposed && state.jql.trim() !== state.settings.proposedJql) body.jql = state.jql.trim()
    }
    state.job = { status: 'running', lines: [], percent: null, message: 'Démarrage du scan…', mode: body.mode }
    if (state.step === 'scan') render()
    try {
      const res = await P.api('/api/jira/scan', { body })
      state.job.id = res.jobId
      if (res.alreadyRunning) P.toast('Un scan est déjà en cours : affichage de sa progression', 'warn')
      follow(res.jobId)
    } catch (e) {
      state.job = { status: 'error', lines: [], error: { message: e.message, hint: hintOf(e) }, mode: body.mode }
      if (state.step === 'scan') render()
    }
  }

  function follow(jobId) {
    let finished = false
    const es = P.stream(`/api/jira/scan/${encodeURIComponent(jobId)}/events`, {
      progress: (d) => {
        state.job.message = d.message
        state.job.percent = d.percent
        state.job.lines.push({ text: d.message, at: d.at })
        drawJob()
      },
      done: async (d) => {
        finished = true
        es.close()
        state.job.status = 'done'
        state.job.result = d
        state.job.lines.push({ text: `Scan terminé : ${d.summary.stories} récits, ${d.summary.withCriteria} avec critères, ${d.summary.epics} épopées.`, kind: 'ok' })
        drawJob()
        P.toast(`Scan terminé : ${d.summary.stories} récits analysés`)
        await refreshAll()
        P.shell?.refreshStrip?.()
        if (state.step === 'scan') setTimeout(() => go('synthese'), 900)
        else render()
      },
      error: (d, e) => {
        if (!e?.data) return // erreur de transport : gérée plus bas
        finished = true
        es.close()
        state.job.status = 'error'
        state.job.error = d
        state.job.lines.push({ text: d.message, kind: 'err' })
        drawJob()
      },
    }, () => {
      if (finished) return
      if (es.readyState === EventSource.CLOSED) {
        state.job.status = 'error'
        state.job.error = { message: 'Le suivi du scan a été interrompu.', hint: 'Rechargez la page : le résultat sera visible dans la synthèse si le scan a abouti.' }
        drawJob()
      }
    })
    // En cas de reconnexion, le serveur rejoue tout l'historique : on repart d'un journal vide.
    es.addEventListener('open', () => { if (!finished) state.job.lines = [] })
  }

  async function refreshAll() {
    try {
      await loadData()
    } catch (e) {
      P.toast(`Synthèse indisponible : ${e.message}`, 'error')
    }
  }

  function drawJob() {
    const host = state.jobHost
    if (!host || !host.isConnected) return
    P.clear(host)
    const job = state.job
    if (!job) return
    const tone = job.status === 'error' ? 'red' : ''
    const head = h('div', { class: 'kn-progress-head' },
      job.status === 'running' ? h('span', { class: 'p-spinner' }) : P.icon(job.status === 'done' ? 'checkCircle' : 'xCircle'),
      h('span', { class: 'p-strong' }, job.status === 'running' ? (job.message || 'Scan en cours…') : job.status === 'done' ? 'Scan terminé' : 'Le scan a échoué'),
      job.percent != null && job.status === 'running' ? h('span', { class: 'p-faint' }, `${job.percent} %`) : null)
    const width = job.status === 'done' ? 100 : job.percent ?? (job.status === 'running' ? 8 : 100)
    const meter = h('div', { class: 'p-meter' }, h('div', { class: `p-meter-fill ${tone}`, style: { width: `${width}%` } }))
    const log = job.lines.length
      ? h('pre', { class: 'p-log kn-log' }, job.lines.map((l) => h('div', { class: l.kind || '' }, `${l.at ? `${new Date(l.at).toLocaleTimeString('fr-FR')}  ` : ''}${l.text}`)))
      : null
    const body = [head, meter, log]
    if (job.status === 'error' && job.error) {
      body.push(errorBanner(job.error, 'Le scan a échoué.'))
      body.push(h('div', { class: 'p-row' },
        h('button', { class: 'p-btn', type: 'button', onclick: startScan }, P.icon('refresh'), 'Réessayer'),
        job.mode === 'jira' ? h('button', { class: 'p-btn p-btn--ghost', type: 'button', onclick: () => go('connexion') }, 'Vérifier la connexion') : null,
        job.mode === 'jira' ? h('button', { class: 'p-btn p-btn--ghost', type: 'button', onclick: runDemoNow }, 'Essayer avec la démonstration') : null))
    }
    if (job.status === 'done') {
      body.push(h('div', { class: 'p-row' }, h('button', { class: 'p-btn p-btn--primary', type: 'button', onclick: () => go('synthese') }, 'Voir la synthèse', P.icon('arrowRight'))))
    }
    host.appendChild(P.card({ title: 'Progression', icon: 'activity', tone: job.status === 'error' ? 'red' : '', body: h('div', { class: 'kn-progress' }, body) }))
  }

  function historyCard(history) {
    return P.card({
      title: 'Derniers scans',
      sub: `${history.length} scan(s) conservé(s)`,
      icon: 'clock',
      tone: 'grey',
      flush: true,
      body: h('table', { class: 'p-table' },
        h('thead', null, h('tr', null, h('th', null, 'Date'), h('th', null, 'Source'), h('th', null, 'Projet'), h('th', { class: 'num' }, 'Récits'), h('th', { class: 'num' }, 'Avec critères'), h('th', { class: 'num' }, 'Durée'), h('th', null, 'Par'))),
        h('tbody', null, history.map((r) => h('tr', null,
          h('td', null, P.fmtDate(r.scannedAt)),
          h('td', null, sourceBadge(r.source)),
          h('td', { class: 'p-mono' }, r.projectKey || '—'),
          h('td', { class: 'num' }, String(r.count)),
          h('td', { class: 'num' }, String(r.withCriteria ?? '—')),
          h('td', { class: 'num' }, P.fmtDuration(r.durationMs)),
          h('td', null, r.user || '—'))))),
    })
  }

  // ------------------------------------------------------------ étape 4 : synthèse

  function renderSynthese(panel) {
    const o = state.overview
    if (o.empty) {
      panel.appendChild(P.card({
        body: P.empty('Pas encore de synthèse', 'Lancez un scan pour obtenir les récits, leurs critères d’acceptation et la liste des points à clarifier.', 'compass',
          h('div', { class: 'p-row', style: { justifyContent: 'center' } },
            h('button', { class: 'p-btn', type: 'button', onclick: () => go('scan') }, 'Configurer le scan'),
            h('button', { class: 'p-btn p-btn--primary', type: 'button', onclick: runDemoNow }, P.icon('play'), 'Scan de démonstration'))),
      }))
      return
    }
    const c = o.counts
    panel.appendChild(scanMeta(o.scan))
    panel.appendChild(h('div', { class: 'p-kpis' },
      P.kpi({ label: 'Récits', value: c.stories, detail: `${c.subtasks} sous-tâche(s)${c.points ? ` · ${c.points} points` : ''}` }),
      P.kpi({ label: 'Avec critères d’acceptation', value: c.withCriteria, unit: `/ ${c.stories}`, detail: `${o.coverage.percent} % · ${o.coverage.criteria} critères extraits`, tone: o.coverage.percent >= 80 ? 'mint' : o.coverage.percent >= 50 ? 'amber' : 'red' }),
      P.kpi({ label: 'À clarifier', value: c.toClarify, detail: `${c.questions} question(s) pour le PO`, tone: c.toClarify ? 'amber' : 'mint' }),
      P.kpi({ label: 'Épopées', value: c.epics, detail: `${o.byEpic.filter((e) => !e.key).reduce((n, e) => n + e.total, 0)} récit(s) sans épopée` })))

    panel.appendChild(h('div', { class: 'p-grid p-grid-2' }, coverageCard(o), statusCard(o)))
    panel.appendChild(epicCard(o))

    const tabsHost = h('div')
    const content = h('div')
    const items = [
      { id: 'clarify', label: 'À clarifier', count: o.toClarify.length, tone: o.toClarify.length ? 'amber' : '', icon: 'alert' },
      { id: 'questions', label: 'Questions au PO', count: o.questions.length, icon: 'help' },
      { id: 'perf', label: 'Exigences de performance', count: o.performance.length, icon: 'activity' },
      { id: 'stories', label: 'Tous les récits', count: c.stories, icon: 'listChecks' },
    ]
    P.tabs(tabsHost, items, state.tab, (id) => { state.tab = id; drawTab(content) })
    panel.appendChild(h('section', { class: 'p-card' }, h('div', { style: { padding: '0 14px' } }, tabsHost), content))
    drawTab(content)

    panel.appendChild(h('div', { class: 'p-row p-row--between' },
      h('button', { class: 'p-btn p-btn--ghost', type: 'button', onclick: () => go('scan') }, P.icon('refresh'), 'Relancer le scan'),
      h('a', { class: 'p-btn p-btn--primary p-btn--lg', href: '/recits.html' }, P.icon('wand'), 'Générer les scénarios Gherkin')))
  }

  function scanMeta(scan) {
    return h('div', { class: 'kn-scan-meta' },
      sourceBadge(scan.source),
      h('span', null, h('b', null, scan.projectKey || 'Requête personnalisée'), ` · ${scan.count} récits · scanné ${P.fmtAgo(scan.scannedAt)} (${P.fmtDate(scan.scannedAt)})`),
      scan.source === 'jira' && safeUrl(scan.baseUrl) ? h('a', { href: safeUrl(scan.baseUrl), target: '_blank', rel: 'noopener' }, hostOf(scan.baseUrl)) : null,
      h('span', { class: 'p-mono p-ellipsis', title: scan.jql, style: { maxWidth: '520px' } }, scan.jql))
  }

  function bars(rows) {
    const max = Math.max(1, ...rows.map((r) => r.value))
    return h('div', { class: 'kn-bars' }, rows.map((r) => h('div', { class: 'kn-bar' },
      h('span', { class: 'p-ellipsis', title: r.label }, r.label),
      h('div', { class: 'p-meter' }, h('div', { class: `p-meter-fill ${r.tone || ''}`, style: { width: `${Math.round((r.value / max) * 100)}%` } })),
      h('span', { class: 'num' }, String(r.value)))))
  }

  function coverageCard(o) {
    const cv = o.coverage
    return P.card({
      title: 'Critères d’acceptation',
      sub: `${cv.percent} % des récits en ont au moins un`,
      icon: 'target',
      body: h('div', { class: 'p-stack', style: { gap: '12px' } },
        bars([
          { label: 'Champ dédié', value: cv.field },
          { label: 'Section de la description', value: cv.description },
          { label: 'Aucun critère', value: cv.none, tone: 'red' },
        ]),
        h('div', { class: 'p-row' },
          h('span', { class: 'p-section-label' }, 'Formats'),
          P.badge(`Gherkin : ${cv.formats.gherkin}`, 'mint'),
          P.badge(`Liste : ${cv.formats.list}`, 'blue'),
          cv.formats.none ? P.badge(`Sans : ${cv.formats.none}`, 'red') : null)),
    })
  }

  function statusCard(o) {
    return P.card({
      title: 'Répartition par statut',
      sub: `${o.byStatus.length} statut(s)`,
      icon: 'barChart',
      tone: 'blue',
      // À faire en ambre, en cours et terminé en vert.
      body: bars(o.byStatus.map((s) => ({ label: s.status, value: s.count, tone: s.category === 'new' ? 'amber' : '' }))),
    })
  }

  function epicCard(o) {
    return P.card({
      title: 'Par épopée',
      sub: `${o.byEpic.length} groupe(s)`,
      icon: 'layers',
      tone: 'purple',
      flush: true,
      body: h('table', { class: 'p-table' },
        h('thead', null, h('tr', null, h('th', null, 'Épopée'), h('th', { class: 'num' }, 'Récits'), h('th', null, 'Critères'), h('th', { class: 'num' }, 'À clarifier'), h('th', { class: 'num' }, 'Points'))),
        h('tbody', null, o.byEpic.map((e) => h('tr', { class: `clickable ${e.toClarify ? 'warning' : ''}`, title: 'Voir les récits de cette épopée', onclick: () => showEpic(e.key || 'none') },
          h('td', null, e.key ? h('span', { class: 'p-tag' }, e.key) : null, ' ', e.summary || 'Sans épopée'),
          h('td', { class: 'num' }, String(e.total)),
          h('td', { style: { minWidth: '160px' } }, h('div', { class: 'p-row', style: { flexWrap: 'nowrap' } },
            h('div', { class: 'p-meter', style: { flex: 1 } }, h('div', { class: `p-meter-fill ${e.coverage < 50 ? 'red' : e.coverage < 80 ? 'amber' : ''}`, style: { width: `${e.coverage}%` } })),
            h('span', { class: 'p-faint' }, `${e.withCriteria}/${e.total}`))),
          h('td', { class: 'num' }, e.toClarify ? P.badge(String(e.toClarify), 'amber') : '0'),
          h('td', { class: 'num' }, e.points ? String(e.points) : '—'))))),
    })
  }

  function showEpic(epicKey) {
    state.tab = 'stories'
    state.filters = { q: '', status: '', epic: epicKey }
    render()
    app.querySelector('.kn-stories-toolbar')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function drawTab(host) {
    P.clear(host)
    const o = state.overview
    if (state.tab === 'clarify') host.appendChild(clarifyList(o.toClarify))
    else if (state.tab === 'questions') host.appendChild(questionList(o.questions))
    else if (state.tab === 'perf') host.appendChild(perfList(o.performance))
    else host.appendChild(storiesBrowser())
  }

  function flagBadges(flags) {
    return flags.map((f) => P.badge(f.label, SEVERITY_TONE[f.severity], f.detail || undefined))
  }

  function clarifyList(items) {
    if (!items.length) return P.empty('Rien à clarifier', 'Tous les récits ont des critères mesurables et un cas d’erreur décrit.', 'checkCircle')
    return h('div', null, items.map((it) => h('div', { class: 'kn-issue', role: 'button', tabindex: '0', onclick: () => openStory(it.key), onkeydown: (e) => { if (e.key === 'Enter') openStory(it.key) } },
      h('div', { class: 'kn-issue-head' },
        h('span', { class: 'p-tag' }, it.key),
        h('span', { class: 'kn-issue-title' }, it.summary),
        it.epic ? h('span', { class: 'p-faint' }, it.epic.summary || it.epic.key) : null,
        P.badge(it.status)),
      h('div', { class: 'kn-issue-flags' }, flagBadges(it.reasons)),
      it.reasons.filter((r) => r.detail && r.severity !== 'info').slice(0, 2).map((r) => h('div', { class: 'kn-issue-detail' }, `« ${r.detail} »`)))))
  }

  function questionsText(questions) {
    const groups = new Map()
    for (const q of questions) {
      const g = groups.get(q.key) || { title: `${q.key} — ${q.summary}`, items: [] }
      g.items.push(withoutKey(q.question, q.key))
      groups.set(q.key, g)
    }
    return groups
  }

  function questionList(questions) {
    if (!questions.length) return P.empty('Aucune question', 'Les récits scannés ne soulèvent pas de question particulière.', 'help')
    const groups = questionsText(questions)
    const p = state.overview.project
    const asText = () => {
      const head = `Questions de clarification${p?.applicationLabel ? ` — ${p.applicationLabel}` : ''}${p?.poName ? ` (à l’attention de ${p.poName})` : ''}\n`
      return head + [...groups.values()].map((g) => `\n${g.title}\n${g.items.map((q, i) => `  ${i + 1}. ${q}`).join('\n')}`).join('\n')
    }
    return h('div', null,
      h('div', { class: 'p-row', style: { padding: '10px 14px', borderBottom: '1px solid var(--p-line-soft)' } },
        h('span', { class: 'p-muted' }, `${questions.length} question(s) générée(s) par règles, regroupées par récit${p?.poName ? ` — à poser à ${p.poName}` : ''}.`),
        h('span', { class: 'p-spacer' }),
        h('button', { class: 'p-btn p-btn--sm', type: 'button', onclick: () => P.copy(asText()) }, P.icon('copy'), 'Copier toutes les questions')),
      [...groups.entries()].map(([key, g]) => h('div', null,
        h('div', { class: 'kn-q-group' }, h('a', { href: '#', onclick: (e) => { e.preventDefault(); openStory(key) } }, g.title)),
        h('ol', { class: 'kn-questions' }, g.items.map((q) => h('li', null, q))))))
  }

  function perfList(items) {
    if (!items.length) return P.empty('Aucune exigence chiffrée', 'Aucun récit ne mentionne de temps de réponse ou de charge mesurable.', 'activity')
    return h('div', null,
      h('div', { style: { padding: '10px 14px' } }, P.banner('blue', h('div', null, 'Ces exigences se vérifient par un test de charge, en plus des scénarios fonctionnels. ',
        h('a', { href: '/perf.html' }, 'Préparer un scénario k6'), '.'))),
      items.map((it) => h('div', { class: 'kn-issue', onclick: () => openStory(it.key) },
        h('div', { class: 'kn-issue-head' }, h('span', { class: 'p-tag' }, it.key), h('span', { class: 'kn-issue-title' }, it.summary)),
        h('div', { class: 'kn-issue-detail' }, `« ${it.requirement} »`))))
  }

  function storiesBrowser() {
    const o = state.overview
    const f = state.filters
    const results = h('div')
    const count = h('span', { class: 'p-toolbar-count' })
    let timer = null
    const load = async () => {
      const qs = new URLSearchParams()
      for (const [k, v] of Object.entries(f)) if (v) qs.set(k, v)
      P.clear(results).appendChild(h('div', { class: 'p-empty' }, h('span', { class: 'p-spinner' })))
      try {
        const data = await P.api(`/api/jira/stories?${qs}`)
        count.textContent = `${data.total} récit(s)`
        P.clear(results).appendChild(storiesTable(data.stories))
      } catch (e) {
        P.clear(results).appendChild(h('div', { style: { padding: '14px' } }, errorBanner(e, 'Lecture des récits impossible.')))
      }
    }
    const search = h('input', { class: 'p-input', type: 'search', placeholder: 'Rechercher (clé, résumé, description, critères)…', value: f.q,
      oninput: (e) => { f.q = e.target.value; clearTimeout(timer); timer = setTimeout(load, 250) } })
    const epic = h('select', { class: 'p-select', onchange: (e) => { f.epic = e.target.value; load() } },
      h('option', { value: '' }, 'Toutes les épopées'),
      o.byEpic.map((e) => h('option', { value: e.key || 'none', selected: f.epic === (e.key || 'none') }, e.key ? `${e.key} — ${e.summary}` : 'Sans épopée')))
    const status = h('select', { class: 'p-select', onchange: (e) => { f.status = e.target.value; load() } },
      h('option', { value: '' }, 'Tous les statuts'),
      o.byStatus.map((s) => h('option', { value: s.status, selected: f.status === s.status }, `${s.status} (${s.count})`)))
    load()
    return h('div', null,
      h('div', { class: 'p-toolbar kn-stories-toolbar', style: { border: 0, borderBottom: '1px solid var(--p-line)', borderRadius: 0 } },
        P.icon('search'), search, epic, status, count),
      results)
  }

  function storiesTable(stories) {
    if (!stories.length) return P.empty('Aucun récit', 'Aucun récit ne correspond à ces filtres.', 'search')
    return h('table', { class: 'p-table' },
      h('thead', null, h('tr', null, h('th', null, 'Clé'), h('th', null, 'Résumé'), h('th', null, 'Épopée'), h('th', null, 'Statut'), h('th', null, 'Critères'))),
      h('tbody', null, stories.map((s) => h('tr', { class: `clickable ${s.acceptanceCriteria.length ? '' : 'critical'}`, onclick: () => openStory(s.key) },
        h('td', { class: 'p-mono p-nowrap' }, s.key),
        h('td', null, s.summary),
        h('td', { class: 'p-faint' }, s.epic?.summary || s.epic?.key || '—'),
        h('td', null, P.badge(s.status, CATEGORY_TONE[s.statusCategory] || '')),
        h('td', { class: 'p-nowrap' }, s.acceptanceCriteria.length
          ? P.badge(`${s.acceptanceCriteria.length} · ${SOURCE_LABEL[s.acceptanceCriteriaSource]}`, 'mint')
          : P.badge('aucun', 'red'))))))
  }

  // ------------------------------------------------------------ détail d'un récit

  const GHERKIN_START = /^(Scénario|Scenario|Étant donné|Etant donné|Soit|Given)/i

  async function openStory(key) {
    let data
    try {
      data = await P.api(`/api/jira/stories/${encodeURIComponent(key)}`)
    } catch (e) {
      P.toast(e.message, 'error')
      return
    }
    const { story: s, review } = data
    const section = (label, ...content) => h('div', { class: 'kn-modal-section' }, h('span', { class: 'p-section-label' }, label), ...content)
    const criteria = s.acceptanceCriteria.length
      ? h('ol', { class: 'kn-criteria' }, s.acceptanceCriteria.map((c) => h('li', null,
        GHERKIN_START.test(c) ? h('pre', { class: 'p-code p-gherkin', html: P.gherkinHtml(c) }) : c)))
      : P.banner('warn', 'Aucun critère d’acceptation trouvé (ni champ dédié, ni section de la description).')
    const body = h('div', null,
      h('div', { class: 'p-row' },
        P.badge(s.issueType || 'Récit', 'outline'),
        P.badge(s.status, CATEGORY_TONE[s.statusCategory] || ''),
        s.priority ? P.badge(`Priorité ${s.priority}`) : null,
        s.storyPoints != null ? P.badge(`${s.storyPoints} pts`, 'purple') : null,
        sourceBadge(s.source)),
      h('dl', { class: 'p-dl', style: { marginTop: '12px' } },
        h('dt', null, 'Épopée'), h('dd', null, s.epic ? `${s.epic.key} — ${s.epic.summary || ''}` : '—'),
        h('dt', null, 'Composants'), h('dd', null, s.components.join(', ') || '—'),
        h('dt', null, 'Étiquettes'), h('dd', null, s.labels.length ? s.labels.map((l) => h('span', { class: 'p-tag', style: { marginRight: '4px' } }, l)) : '—'),
        h('dt', null, 'Versions'), h('dd', null, s.fixVersions.join(', ') || '—'),
        h('dt', null, 'Assigné à'), h('dd', null, s.assignee || 'non assigné'),
        h('dt', null, 'Rapporteur'), h('dd', null, s.reporter || '—'),
        h('dt', null, 'Mis à jour'), h('dd', null, P.fmtDate(s.updated))),
      review.flags.length ? section('Relecture QA', h('div', { class: 'kn-issue-flags' }, flagBadges(review.flags)),
        review.questions.length ? h('ul', { style: { margin: '8px 0 0', paddingLeft: '18px' } }, review.questions.map((q) => h('li', null, withoutKey(q, s.key)))) : null) : null,
      section(`Critères d’acceptation (${s.acceptanceCriteria.length}) · source : ${SOURCE_LABEL[s.acceptanceCriteriaSource]}`, criteria),
      section('Description', s.descriptionText ? h('pre', { class: 'p-code kn-desc' }, s.descriptionText) : h('div', { class: 'p-faint' }, 'Aucune description.')),
      s.links.length ? section(`Liens (${s.links.length})`, h('ul', { style: { margin: 0, paddingLeft: '18px' } },
        s.links.map((l) => h('li', null, `${l.type} `, h('span', { class: 'p-tag' }, l.key), ` ${l.summary}`)))) : null,
      s.subtasks.length ? section(`Sous-tâches (${s.subtasks.length})`, h('ul', { style: { margin: 0, paddingLeft: '18px' } },
        s.subtasks.map((t) => h('li', null, h('span', { class: 'p-tag' }, t.key), ` ${t.summary} `, P.badge(t.status))))) : null)

    const actions = [{ label: 'Fermer', kind: 'ghost' }]
    if (s.source === 'jira' && safeUrl(s.url)) actions.push({ label: 'Ouvrir dans JIRA', icon: 'external', onClick: () => { window.open(safeUrl(s.url), '_blank', 'noopener') } })
    actions.push({ label: 'Générer le Gherkin', kind: 'primary', icon: 'wand', onClick: () => { location.href = `/recits.html?key=${encodeURIComponent(s.key)}` } })
    P.modal({ title: `${s.key} — ${s.summary}`, body, actions, wide: true })
  }

  // ------------------------------------------------------------ utilitaires

  function sourceBadge(source) {
    return source === 'demo' ? P.badge('Démonstration', 'teal') : P.badge('JIRA', 'blue')
  }

  /** Adresse http(s) uniquement (jamais javascript: ou data: dans un lien). */
  function safeUrl(url) {
    try {
      const u = new URL(url)
      return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : ''
    } catch {
      return ''
    }
  }

  /** Retire le préfixe « CLE-1 — » d'une question déjà regroupée sous son récit. */
  function withoutKey(question, key) {
    const prefix = `${key} — `
    return question.startsWith(prefix) ? question.slice(prefix.length) : question
  }

  function hostOf(url) {
    try { return new URL(url).host } catch { return url || '' }
  }

  function hintOf(e) {
    return e?.hint || e?.data?.details?.hint || ''
  }

  function errorBanner(e, fallback) {
    const hint = hintOf(e)
    return P.banner('error', h('div', null,
      h('b', null, e?.message || fallback),
      hint ? h('div', { style: { marginTop: '4px' } }, hint) : null))
  }
})()

/*
 * Automatisation d'un récit avec Playwright (docs/V3-ARCHITECTURE.md §5.2) :
 *   1. Application à tester (cible, navigateur, comptes de démonstration)
 *   2. Expliquer le test (conversation avec l'IA, plan d'étapes éditable, repli copier-coller)
 *   3. Exploration (l'IA cherche les sélecteurs ; fenêtre « Prenez la main » si elle bloque)
 *   4. Test généré (étapes éditables, code, rejeu, validation)
 *   5. Envoyer dans JIRA (ticket Test relié au récit, via XrayPush)
 * Sans ?key= : liste des récits « À automatiser ».
 * Aucun mot de passe n'est affiché : le serveur renvoie '••••••' et conserve la valeur si le masque revient.
 */
;(function () {
  'use strict'
  const P = window.Prisme
  const { h } = P

  const MASK = '••••••'
  const params = new URLSearchParams(location.search)
  const KEY = String(params.get('key') || '').trim().toUpperCase()
  const KEY_RE = /^[A-Z][A-Z0-9_]*-\d+$/

  const PANELS = [
    { id: 1, label: 'Application à tester', icon: 'monitor' },
    { id: 2, label: 'Expliquer le test', icon: 'sparkles' },
    { id: 3, label: 'Exploration', icon: 'bot' },
    { id: 4, label: 'Test généré', icon: 'fileText' },
    { id: 5, label: 'Envoyer dans JIRA', icon: 'upload' },
  ]
  const STATUS_TONE = {
    draft: 'grey', planning: 'blue', exploring: 'blue', 'needs-human': 'amber', recording: 'amber',
    review: 'mint', replaying: 'blue', validated: 'mint', failed: 'red', stopped: 'grey',
  }
  const KIND_LABEL = { goto: 'Ouverture', login: 'Connexion', action: 'Action', check: 'Vérification', context: 'Contexte' }
  const ACTION_LABEL = { goto: 'Ouvrir', click: 'Cliquer', fill: 'Saisir', select: 'Choisir', check: 'Cocher', uncheck: 'Décocher', press: 'Touche', hover: 'Survoler', expect: 'Vérifier' }
  const EXPECT_LABEL = { visible: 'visible', hidden: 'masqué', text: 'contient le texte', url: 'adresse contient', value: 'valeur' }
  const SOURCE_BADGE = { ai: ['IA', 'purple'], human: ['Testeur', 'amber'], rule: ['Règle', 'teal'] }
  const DECISION = { todo: ['À automatiser', 'mint'], later: ['Plus tard', 'amber'], skip: ['Ignoré', 'grey'] }
  const BUSY = new Set(['planning', 'exploring', 'recording', 'replaying'])

  const state = {
    user: null,
    engine: null,
    targets: [],
    story: null,
    triage: null,
    gherkin: null,
    sessions: [],
    session: null,
    panel: 1,
    es: null,
    log: [],
    shot: null,
    // étape 1
    targetId: 'demo-irma',
    draftTarget: null,
    accountIds: null,
    headless: false,
    maxIterations: 4,
    // étape 2
    chatDraft: '',
    manual: null,          // { prompt } : dernier prompt à copier
    planDraft: null,       // copie éditable du plan
    planDirty: false,
    // étape 4
    stepsDraft: null,
    stepsDirty: false,
    // prise de main
    tk: null,
  }
  const refs = {}

  // ------------------------------------------------------------------ utilitaires

  const clone = (v) => JSON.parse(JSON.stringify(v))
  const tone = (s) => STATUS_TONE[s] || 'grey'
  const statusChip = (s, label) => h('span', { class: `p-status ${tone(s)}` }, h('span', { class: `p-dot ${tone(s)} ${BUSY.has(s) ? 'live' : ''}` }), label || s)
  const fieldEl = (label, input, hint) => h('div', { class: 'p-field' }, h('label', null, label), input, hint ? h('div', { class: 'p-hint' }, hint) : null)
  const iconBtn = (icon, label, onclick, extra = {}) => h('button', { class: 'p-icon-btn au-icon-btn', type: 'button', title: label, 'aria-label': label, onclick, ...extra }, P.icon(icon))
  const errMsg = (e) => (e && e.message) || String(e)

  function selText(sel) {
    if (!sel) return ''
    return sel.code || `${sel.strategy}=${typeof sel.value === 'object' ? JSON.stringify(sel.value) : sel.value}`
  }

  function stepText(st) {
    const a = ACTION_LABEL[st.action] || st.action
    if (st.action === 'goto') return `${a} ${st.url || st.value || 'l’application'}`
    if (st.action === 'expect') {
      const ex = st.expect || {}
      return `${a} : ${EXPECT_LABEL[ex.kind] || ex.kind}${ex.value ? ` « ${ex.value} »` : ''}`
    }
    if (st.action === 'fill') return `${a} ${st.secret ? '« mot de passe du compte »' : `« ${st.value ?? ''} »`}`
    if (st.action === 'select') return `${a} « ${st.value ?? ''} »`
    if (st.action === 'press') return `${a} ${st.value || 'Entrée'}`
    return a
  }

  /** Coloration simple du code TypeScript généré (texte échappé jeton par jeton). */
  function codeHtml(code) {
    const re = /(\/\/[^\n]*)|('(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|\b(await|async|const|let|import|from|function|return|if|throw|new|type|for|of|test|expect)\b/g
    let out = ''
    let last = 0
    const src = String(code || '')
    let m
    while ((m = re.exec(src))) {
      out += P.esc(src.slice(last, m.index))
      const cls = m[1] ? 'cmt' : m[2] ? 'str' : 'kw'
      out += `<span class="${cls}">${P.esc(m[0])}</span>`
      last = m.index + m[0].length
    }
    return out + P.esc(src.slice(last))
  }

  function stageOf(s) {
    if (!s) return 1
    if (s.status === 'validated') return 5
    if (['review', 'replaying'].includes(s.status)) return 4
    if (['exploring', 'needs-human', 'recording'].includes(s.status)) return 3
    if (['stopped', 'failed'].includes(s.status)) return s.stepCount ? 3 : 2
    return 2
  }

  async function guard(btn, fn) {
    try {
      return await P.busy(btn, fn)
    } catch (e) {
      P.toast(errMsg(e), 'error', 7000)
      return undefined
    }
  }

  // ------------------------------------------------------------------ démarrage

  P.whenShell().then(async ({ user }) => {
    state.user = user
    const app = document.getElementById('app')
    refs.app = app
    try {
      if (!KEY) return await renderStoryPicker()
      if (!KEY_RE.test(KEY)) {
        P.clear(app)
        app.appendChild(P.empty('Clé de récit invalide', `« ${KEY} » n’est pas une clé JIRA valide.`, 'alert', h('a', { class: 'p-btn', href: '/automatisation.html' }, 'Choisir un récit')))
        return
      }
      await loadAll()
      render()
    } catch (e) {
      P.clear(app)
      app.appendChild(P.banner('error', [h('b', null, 'Chargement impossible. '), errMsg(e)]))
    }
  })

  async function loadAll() {
    const [eng, tg, st, sess, tri, gh] = await Promise.all([
      P.api('/api/explore/engine'),
      P.api('/api/explore/targets'),
      P.api(`/api/jira/stories/${encodeURIComponent(KEY)}`).catch((e) => ({ error: e })),
      P.api(`/api/explore/sessions?storyKey=${encodeURIComponent(KEY)}`),
      P.api('/api/jira/triage').catch(() => null),
      P.api(`/api/gherkin/${encodeURIComponent(KEY)}`).catch(() => null),
    ])
    state.engine = eng
    state.targets = tg.targets
    if (st.error) throw new Error(st.error.status === 404 ? `Le récit ${KEY} est introuvable : lancez le scan JIRA depuis la page Récits.` : errMsg(st.error))
    state.story = st.story
    state.sessions = sess.sessions
    state.triage = tri
    state.gherkin = gh && gh.entry ? gh.entry : gh && gh.text ? gh : null
    const wanted = params.get('session')
    const pick = (wanted && state.sessions.find((s) => s.id === wanted)) || state.sessions[0]
    if (pick) await openSession(pick.id, { silent: true })
  }

  async function openSession(id, { silent = false } = {}) {
    const r = await P.api(`/api/explore/sessions/${encodeURIComponent(id)}`)
    state.session = r.session
    state.engine.llm = r.llm || state.engine.llm
    state.log = (r.events || []).filter((e) => e.type === 'log').map((e) => ({ ...e.data, at: e.data?.at || e.at }))
    state.planDraft = null
    state.planDirty = false
    state.stepsDraft = null
    state.stepsDirty = false
    state.panel = stageOf(state.session)
    connect()
    if (!silent) render()
  }

  async function refreshSession() {
    if (!state.session) return
    const r = await P.api(`/api/explore/sessions/${encodeURIComponent(state.session.id)}`)
    state.session = r.session
    if (!state.planDirty) state.planDraft = null
    if (!state.stepsDirty) state.stepsDraft = null
  }

  async function refreshSessions() {
    const r = await P.api(`/api/explore/sessions?storyKey=${encodeURIComponent(KEY)}`)
    state.sessions = r.sessions
  }

  // ------------------------------------------------------------------ flux en direct

  let refreshTimer = null
  function scheduleRefresh(rerender = true) {
    clearTimeout(refreshTimer)
    refreshTimer = setTimeout(async () => {
      try {
        await refreshSession()
        if (rerender) renderLive()
      } catch { /* prochain événement */ }
    }, 250)
  }

  function connect() {
    if (state.es) state.es.close()
    if (!state.session) return
    const id = state.session.id
    state.es = P.stream(`/api/explore/sessions/${encodeURIComponent(id)}/events`, {
      status: (d) => {
        if (d.session) state.session = d.session
        else if (state.session) { state.session.status = d.status; state.session.statusLabel = d.label; state.session.statusReason = d.reason }
        if (d.status !== 'needs-human' && d.status !== 'recording' && state.tk && !state.tk.pending) closeTakeover()
        scheduleRefresh()
        renderLive()
      },
      log: (d) => {
        state.log.push(d)
        if (state.log.length > 400) state.log.splice(0, state.log.length - 400)
        appendLog(d)
      },
      screenshot: (d) => {
        state.shot = d
        updateShots()
      },
      snapshot: (d) => {
        if (refs.iter) refs.iter.textContent = `Essai ${d.iteration} · ${d.elements} élément(s) analysé(s) sur la page`
      },
      step: (d) => onStepEvent(d),
      plan: (d) => {
        if (state.session) state.session.plan = d.plan
        if (!state.planDirty) state.planDraft = null
        if (state.panel === 2 && !state.planDirty) renderPanel()
        renderProgress()
      },
      'needs-human': (d) => {
        if (state.session) { state.session.needsHuman = d; state.session.status = 'needs-human' }
        renderLive()
        openTakeover()
      },
      recording: (d) => addRecorded(d.event),
      code: (d) => {
        if (!state.session) return
        state.session.code = d.code
        state.session.relPath = d.relPath
        if (d.scenarios) state.session.scenarios = d.scenarios
        state.session.stepCount = (d.scenarios || []).reduce((n, sc) => n + sc.steps.length, 0)
        if (!state.stepsDirty) state.stepsDraft = null
        if (state.panel === 4) renderPanel()
        renderStepper()
      },
      done: async (d) => {
        await refreshSession().catch(() => {})
        await refreshSessions().catch(() => {})
        if (d.phase === 'explore') {
          P.toast('Exploration terminée : relisez le test généré.')
          goPanel(4)
        } else if (d.phase === 'replay') {
          P.toast(d.ok ? `Rejeu réussi (${d.passed} étape(s)).` : `Rejeu en échec : ${d.failed} étape(s).`, d.ok ? 'ok' : 'error', 6000)
          render()
        } else if (d.phase === 'validate') {
          goPanel(5)
        }
      },
      // d absent : coupure du flux (changement de page), pas une erreur d'exploration
      error: (d) => { if (d !== undefined) P.toast(d?.message || 'Erreur pendant l’exploration.', 'error', 8000) },
    })
  }

  function onStepEvent(d) {
    const s = state.session
    if (!s) return
    if (d.phase === 'explore') {
      const st = s.plan?.scenarios?.[d.scenarioIndex]?.steps?.[d.stepIndex]
      if (st) {
        st.status = d.status
        st.attempts = d.attempts ?? st.attempts
        if (d.reason) st.reason = d.reason
      }
      if (refs.iter && d.status === 'running') {
        refs.iter.textContent = d.iteration
          ? `Essai ${d.iteration} · ${d.failures || 0} échec(s) sans progrès sur ${d.maxIterations || s.maxIterations} autorisé(s)`
          : 'Analyse de la page…'
      }
      renderProgress()
    } else if (d.phase === 'replay') {
      const st = s.scenarios?.[d.scenarioIndex]?.steps?.[d.stepIndex]
      if (st) st.replay = { ok: d.ok, error: d.error }
      if (state.panel === 4 && !state.stepsDirty) { state.stepsDraft = null; renderStepsTable() }
    }
  }

  // ------------------------------------------------------------------ rendu général

  function render() {
    const app = refs.app
    P.clear(app)
    app.appendChild(renderHeader())
    if (state.engine && !state.engine.available) {
      app.appendChild(P.banner('warn', [
        h('b', null, 'Moteur d’exploration indisponible. '),
        state.engine.reason || 'Playwright est introuvable.',
        ' ',
        h('a', { href: '/installation.html' }, 'Ouvrir la page Installation'),
      ]))
    }
    refs.stepperHost = h('section', { class: 'p-card au-wizard' }, h('div', { class: 'p-card-body' }))
    app.appendChild(refs.stepperHost)
    refs.panelHost = h('div', { class: 'au-panel' })
    app.appendChild(refs.panelHost)
    renderStepper()
    renderPanel()
    renderActions()
  }

  function renderActions() {
    const s = state.session
    const nodes = []
    if (s && BUSY.has(s.status) && s.status !== 'planning') {
      nodes.push(h('button', { class: 'p-btn p-btn--danger', type: 'button', onclick: (e) => stopSession(e.currentTarget) }, P.icon('stop'), 'Arrêter'))
    }
    nodes.push(h('a', { class: 'p-btn', href: `/recits.html?key=${encodeURIComponent(KEY)}` }, P.icon('listChecks'), 'Voir le récit'))
    P.shell.setActions(nodes)
  }

  /** Mise à jour légère pendant l'exploration (sans perdre les saisies). */
  function renderLive() {
    renderStepper()
    renderActions()
    if (refs.headStatus) {
      P.clear(refs.headStatus)
      if (state.session) refs.headStatus.appendChild(statusChip(state.session.status, state.session.statusLabel))
    }
    if (state.panel === 3) renderPanel()
    else if (state.panel === 4 && !state.stepsDirty) renderPanel()
    else if (state.panel === 5 || state.panel === 1) renderPanel()
  }

  function renderHeader() {
    const s = state.story
    const d = state.triage?.triage?.[s.key]?.decision
    const sug = state.triage?.suggestions?.[s.key]
    const dec = d ? DECISION[d] : null
    refs.headStatus = h('div', { class: 'au-head-status' }, state.session ? statusChip(state.session.status, state.session.statusLabel) : null)
    const g = state.gherkin
    return h('section', { class: 'p-card au-head' }, h('div', { class: 'p-card-body au-head-body' },
      h('span', { class: 'p-tile' }, P.icon('bot')),
      h('div', { class: 'au-head-main' },
        h('div', { class: 'au-head-key' },
          h('span', { class: 'p-mono' }, `${s.issueType || 'Récit'} · ${s.key}`),
          dec ? P.badge(dec[0], dec[1], d === 'todo' ? 'Décision de tri : à automatiser' : 'Décision de tri') : sug ? P.badge(`Suggestion : ${DECISION[sug.suggestion]?.[0] || sug.suggestion}`, 'outline', (sug.reasons || []).join(' · ')) : P.badge('Non trié', 'outline'),
          g ? P.badge(g.status === 'validated' ? 'Gherkin validé' : 'Gherkin brouillon', g.status === 'validated' ? 'mint' : 'amber') : P.badge('Sans Gherkin', 'outline', 'Le plan sera déduit des critères d’acceptation')),
        h('h1', { class: 'au-head-title' }, s.summary),
        h('div', { class: 'au-head-meta' },
          `${(s.acceptanceCriteria || []).length} critère(s) d’acceptation`,
          s.status ? ` · statut JIRA : ${s.status}` : '',
          ' · ',
          h('a', { href: `/recits.html?key=${encodeURIComponent(s.key)}` }, 'Ouvrir dans Récits et Gherkin'),
          s.url && /^https?:/i.test(s.url) ? [' · ', h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer' }, 'Ouvrir dans JIRA')] : null)),
      refs.headStatus))
  }

  function renderStepper() {
    if (!refs.stepperHost) return
    const body = refs.stepperHost.querySelector('.p-card-body')
    P.clear(body)
    const s = state.session
    const stage = stageOf(s)
    const subs = {
      1: s ? s.target?.name : 'Adresse, navigateur, comptes',
      2: s ? `${s.plan?.scenarios?.length || 0} scénario(s)` : 'Dialogue avec l’IA',
      3: s ? (s.status === 'needs-human' ? 'Votre aide est attendue' : s.status === 'exploring' ? 'En cours…' : s.status === 'recording' ? 'Prise de main' : '') : 'IA + prise de main',
      4: s && s.stepCount ? `${s.stepCount} étape(s)${s.replay ? (s.replay.ok ? ' · rejeu OK' : ' · rejeu KO') : ''}` : 'Code Playwright',
      5: s && s.status === 'validated' ? 'Prêt à envoyer' : 'Ticket Test Xray',
    }
    body.appendChild(P.stepper(PANELS.map((p) => {
      let st = p.id < stage ? 'done' : 'todo'
      if (p.id === 3 && s && ['exploring', 'recording'].includes(s.status)) st = 'running'
      if (p.id === 3 && s && s.status === 'needs-human') st = 'failed'
      if (p.id === 4 && s && s.status === 'replaying') st = 'running'
      if (p.id === 5 && s && s.status === 'validated') st = 'done'
      if (p.id === state.panel && st === 'todo') st = 'current'
      const reachable = p.id === 1 || (s && p.id <= Math.max(stage, 2)) || (s && p.id === 4 && s.stepCount)
      return { label: p.label, sub: subs[p.id] || '', state: st, onClick: reachable ? () => goPanel(p.id) : null }
    })))
    // étape affichée : surlignée quel que soit son état
    const cur = body.querySelectorAll('.p-step')[state.panel - 1]
    if (cur) {
      cur.classList.add('au-current')
      cur.setAttribute('aria-current', 'step')
    }
  }

  function goPanel(n) {
    state.panel = n
    renderStepper()
    renderPanel()
    if (n === 3 && state.session?.status === 'needs-human' && !state.tk) openTakeover()
  }

  function renderPanel() {
    const host = refs.panelHost
    if (!host) return
    P.clear(host)
    refs.iter = null
    refs.log = null
    refs.shotImgs = []
    refs.progress = null
    const fn = { 1: panelTarget, 2: panelExplain, 3: panelExplore, 4: panelTest, 5: panelJira }[state.panel]
    host.appendChild(fn())
    updateShots()
  }

  // ------------------------------------------------------------------ étape 1 : application à tester

  function currentTarget() {
    if (state.draftTarget) return state.draftTarget
    return state.targets.find((t) => t.id === state.targetId) || state.targets[0]
  }

  function panelTarget() {
    const s = state.session
    if (s) return panelTargetSummary(s)
    const wrap = h('div', { class: 'au-grid-aside' })
    const t = currentTarget()
    if (state.accountIds === null && t) state.accountIds = t.accounts.slice(0, 1).map((a) => a.id)

    // liste des applications
    const list = h('div', { class: 'au-targets' },
      state.targets.map((x) => h('button', {
        type: 'button',
        class: `au-target ${!state.draftTarget && x.id === state.targetId ? 'active' : ''}`,
        onclick: () => {
          state.draftTarget = null
          state.targetId = x.id
          state.accountIds = x.accounts.slice(0, 1).map((a) => a.id)
          renderPanel()
        },
      },
      h('div', { class: 'au-target-name' }, x.name, x.builtin ? P.badge('Démo', 'teal') : null),
      h('div', { class: 'au-target-url p-mono' }, x.baseUrl),
      h('div', { class: 'au-target-meta' }, `${x.accounts.length} compte(s) · ${browserLabel(x.browser)}`))),
      h('button', {
        type: 'button',
        class: `au-target au-target--new ${state.draftTarget && !state.draftTarget.id ? 'active' : ''}`,
        onclick: () => {
          state.draftTarget = { id: '', name: '', baseUrl: 'https://', browser: firstBrowser(), allowedOrigins: [], accounts: [{ id: '', label: '', username: '', password: '', notes: '' }] }
          state.accountIds = []
          renderPanel()
        },
      }, P.icon('plus'), 'Nouvelle application'))

    wrap.appendChild(P.card({
      title: 'Application à tester',
      sub: 'Choisissez l’application que Playwright va parcourir.',
      icon: 'monitor',
      body: [list, previousSessions()],
    }))
    wrap.appendChild(targetEditor(t))
    return wrap
  }

  function browserLabel(id) {
    return { msedge: 'Edge', chrome: 'Chrome', chromium: 'Chromium' }[id] || id
  }

  function firstBrowser() {
    const b = (state.engine?.browsers || []).find((x) => x.available)
    return b ? b.id : 'msedge'
  }

  function previousSessions() {
    if (!state.sessions.length) return null
    return h('div', { class: 'au-prev' },
      h('div', { class: 'p-section-label' }, 'Sessions précédentes de ce récit'),
      state.sessions.slice(0, 6).map((x) => h('button', { type: 'button', class: 'au-prev-item', onclick: () => openSession(x.id).catch((e) => P.toast(errMsg(e), 'error')) },
        statusChip(x.status, x.statusLabel),
        h('span', { class: 'au-prev-meta' }, `${P.fmtDate(x.createdAt)} · ${x.target?.name || ''} · ${x.stepCount} étape(s)`))))
  }

  function targetEditor(t) {
    const editable = t && !t.builtin
    const isNew = state.draftTarget && !state.draftTarget.id
    const draft = editable ? (state.draftTarget || (state.draftTarget = clone(t))) : t
    if (!editable && state.draftTarget) state.draftTarget = null
    const body = []
    if (t.builtin) {
      body.push(P.banner('info', [h('b', null, 'Application de démonstration fournie avec Wizard QA. '), t.description || '', ' Les comptes ci-dessous sont prêts à l’emploi.']))
    }
    const browsers = state.engine?.browsers || []
    const seg = h('div', { class: 'p-seg', role: 'group', 'aria-label': 'Navigateur' }, ['msedge', 'chrome', 'chromium'].map((id) => {
      const info = browsers.find((b) => b.id === id)
      const ok = !info || info.available
      return h('button', {
        type: 'button',
        class: (draft.browser || 'msedge') === id ? 'active' : '',
        disabled: !ok,
        title: ok ? (info?.label || id) : `${info?.label || id} : non installé`,
        onclick: () => {
          draft.browser = id
          if (t.builtin) saveBuiltinBrowser(id)
          renderPanel()
        },
      }, browserLabel(id), ok ? null : ' (absent)')
    }))
    const name = h('input', { class: 'p-input', value: draft.name || '', disabled: !editable, placeholder: 'Ex. : Portail de recette', oninput: (e) => { draft.name = e.target.value } })
    const url = h('input', { class: 'p-input p-mono', value: draft.baseUrl || '', disabled: !editable, placeholder: 'https://recette.mon-appli.fr/', oninput: (e) => { draft.baseUrl = e.target.value } })
    const origins = h('input', { class: 'p-input p-mono', value: (draft.allowedOrigins || []).join(', '), disabled: !editable, placeholder: 'https://sso.mon-entreprise.fr (facultatif)', oninput: (e) => { draft.allowedOrigins = e.target.value.split(/[\s,;]+/).filter(Boolean) } })
    body.push(h('div', { class: 'p-form-grid' },
      fieldEl('Nom', name),
      fieldEl('Navigateur', seg, 'Edge et Chrome installés sur le poste sont utilisés en priorité.'),
      h('div', { class: 'span-2' }, fieldEl('Adresse de l’application', url, 'Page d’accueil ou de connexion : l’exploration commence ici.')),
      h('div', { class: 'span-2' }, fieldEl('Autres origines autorisées', origins, 'Le navigateur refuse toute navigation hors de l’adresse ci-dessus et de ces origines (ex. : page d’authentification unique).'))))

    // comptes
    const rows = (draft.accounts || []).map((a, i) => accountRow(draft, a, i, editable))
    body.push(h('div', { class: 'au-accounts-head' },
      h('div', null, h('div', { class: 'p-h3' }, 'Comptes de démonstration'), h('div', { class: 'p-hint' }, 'Cochez le ou les comptes à utiliser pour ce test. Les mots de passe ne sont jamais envoyés à l’IA : elle ne voit que des marqueurs.')),
      editable ? h('button', { class: 'p-btn p-btn--sm', type: 'button', onclick: () => { draft.accounts.push({ id: '', label: '', username: '', password: '', notes: '' }); renderPanel() } }, P.icon('plus'), 'Ajouter un compte') : null))
    body.push(h('div', { class: 'au-table-wrap' }, h('table', { class: 'p-table au-accounts' },
      h('thead', null, h('tr', null, h('th', null, 'Utiliser'), h('th', null, 'Libellé'), h('th', null, 'Identifiant'), h('th', null, 'Mot de passe'), h('th', null, 'Rôle / notes'), editable ? h('th', null, '') : null)),
      h('tbody', null, rows.length ? rows : h('tr', null, h('td', { colspan: 6, class: 'p-muted' }, 'Aucun compte : l’exploration se fera sans connexion.'))))))

    // options de session
    const headed = h('label', { class: 'p-check' }, h('input', { type: 'checkbox', checked: !state.headless, onchange: (e) => { state.headless = !e.target.checked } }), 'Afficher la fenêtre du navigateur pendant l’exploration')
    const iters = h('input', { class: 'p-input au-num', type: 'number', min: 1, max: 10, value: state.maxIterations, oninput: (e) => { state.maxIterations = Math.min(10, Math.max(1, Number(e.target.value) || 4)) } })
    body.push(h('div', { class: 'au-options' },
      headed,
      h('label', { class: 'au-inline' }, 'Tentatives de l’IA par étape avant de vous passer la main :', iters)))

    const actions = h('div', { class: 'au-foot' },
      editable ? h('button', { class: 'p-btn', type: 'button', onclick: (e) => saveTarget(e.currentTarget, draft) }, P.icon('save'), isNew ? 'Enregistrer l’application' : 'Enregistrer les modifications') : null,
      editable && !isNew ? h('button', { class: 'p-btn p-btn--ghost', type: 'button', onclick: (e) => deleteTargetUi(e.currentTarget, draft) }, P.icon('trash'), 'Supprimer') : null,
      h('span', { class: 'p-spacer' }),
      h('button', {
        class: 'p-btn p-btn--primary p-btn--lg',
        type: 'button',
        disabled: !state.engine?.available,
        title: state.engine?.available ? '' : 'Moteur Playwright indisponible',
        onclick: (e) => createSession(e.currentTarget, draft, editable),
      }, 'Continuer : expliquer le test', P.icon('arrowRight')))
    body.push(actions)
    return P.card({ title: t.builtin ? t.name : isNew ? 'Nouvelle application' : draft.name || 'Application', sub: 'Adresse, navigateur et comptes de démonstration', icon: 'settings', body })
  }

  function accountRow(draft, a, i, editable) {
    const used = (state.accountIds || []).includes(a.id)
    const pwd = h('input', {
      class: 'p-input p-mono',
      type: 'password',
      value: a.password || '',
      disabled: !editable,
      autocomplete: 'new-password',
      placeholder: editable ? 'Mot de passe' : '',
      'aria-label': `Mot de passe du compte ${a.label || i + 1}`,
      oninput: (e) => { a.password = e.target.value },
      // le masque est vidé à la saisie et remis si le champ reste vide (le serveur conserve alors la valeur)
      onfocus: (e) => {
        if (e.target.value !== MASK) return
        e.target.value = ''
        a.password = ''
      },
      onblur: (e) => {
        if (e.target.value || !a.passwordSet) return
        e.target.value = MASK
        a.password = MASK
      },
    })
    const eye = editable ? h('button', {
      class: 'p-icon-btn',
      type: 'button',
      title: 'Afficher ou masquer',
      'aria-label': 'Afficher ou masquer le mot de passe',
      onclick: (e) => {
        const show = pwd.type === 'password'
        pwd.type = show ? 'text' : 'password'
        P.clear(e.currentTarget).appendChild(P.icon(show ? 'eyeOff' : 'eye'))
      },
    }, P.icon('eye')) : null
    const input = (field, ph) => h('input', { class: 'p-input', value: a[field] || '', disabled: !editable, placeholder: ph, oninput: (e) => { a[field] = e.target.value } })
    return h('tr', null,
      h('td', null, h('input', {
        type: 'checkbox',
        class: 'au-use',
        'aria-label': `Utiliser le compte ${a.label || i + 1}`,
        checked: used,
        disabled: !a.id,
        title: a.id ? '' : 'Enregistrez l’application pour utiliser ce compte',
        onchange: (e) => {
          const set = new Set(state.accountIds || [])
          if (e.target.checked) set.add(a.id)
          else set.delete(a.id)
          state.accountIds = [...set]
        },
      })),
      h('td', null, input('label', 'Ex. : Agent')),
      h('td', null, input('username', 'Identifiant')),
      h('td', null, h('div', { class: 'p-pwd' }, pwd, eye)),
      h('td', null, input('notes', 'Profil, droits…')),
      editable ? h('td', null, iconBtn('trash', 'Supprimer ce compte', () => { draft.accounts.splice(i, 1); renderPanel() })) : null)
  }

  async function saveBuiltinBrowser(id) {
    try {
      await P.api('/api/explore/targets', { method: 'PUT', body: { target: { id: 'demo-irma', browser: id } } })
      const t = state.targets.find((x) => x.id === 'demo-irma')
      if (t) t.browser = id
    } catch (e) {
      P.toast(errMsg(e), 'error')
    }
  }

  async function saveTarget(btn, draft) {
    return guard(btn, async () => {
      const r = await P.api('/api/explore/targets', { method: 'PUT', body: { target: draft } })
      state.targets = r.targets
      state.targetId = r.target.id
      state.draftTarget = null
      if (!state.accountIds || !state.accountIds.length) state.accountIds = r.target.accounts.slice(0, 1).map((a) => a.id)
      P.toast('Application enregistrée.')
      renderPanel()
      return r.target
    })
  }

  async function deleteTargetUi(btn, draft) {
    if (!(await P.confirm(`Supprimer l’application « ${draft.name} » et ses comptes ?`, { okLabel: 'Supprimer', danger: true }))) return
    await guard(btn, async () => {
      const r = await P.api(`/api/explore/targets/${encodeURIComponent(draft.id)}`, { method: 'DELETE' })
      state.targets = r.targets
      state.targetId = 'demo-irma'
      state.draftTarget = null
      state.accountIds = null
      renderPanel()
    })
  }

  async function createSession(btn, draft, editable) {
    await guard(btn, async () => {
      let target = currentTarget()
      if (editable) {
        const r = await P.api('/api/explore/targets', { method: 'PUT', body: { target: draft } })
        state.targets = r.targets
        target = r.target
        state.targetId = target.id
        state.draftTarget = null
        const known = new Set(target.accounts.map((a) => a.id))
        state.accountIds = (state.accountIds || []).filter((id) => known.has(id))
        if (!state.accountIds.length) state.accountIds = target.accounts.slice(0, 1).map((a) => a.id)
      }
      try {
        const r = await P.api('/api/explore/sessions', { body: { storyKey: KEY, targetId: target.id, accountIds: state.accountIds || [], headless: state.headless, maxIterations: state.maxIterations } })
        await refreshSessions()
        history.replaceState(null, '', `/automatisation.html?key=${encodeURIComponent(KEY)}&session=${encodeURIComponent(r.session.id)}`)
        await openSession(r.session.id, { silent: true })
        state.panel = 2
        render()
      } catch (e) {
        const other = e.data?.details?.sessionId
        if (e.status === 409 && other) {
          const stop = await P.confirm(`${errMsg(e)} Voulez-vous l’arrêter et continuer ?`, { title: 'Session déjà active', okLabel: 'Arrêter l’autre session' })
          if (stop) {
            await P.api(`/api/explore/sessions/${encodeURIComponent(other)}/stop`, { body: {} })
            P.toast('Session précédente arrêtée : cliquez à nouveau sur « Continuer ».')
          }
          return
        }
        throw e
      }
    })
  }

  function panelTargetSummary(s) {
    const t = state.targets.find((x) => x.id === s.target?.id)
    const accounts = (s.accounts || []).map((a) => a.label).join(', ') || 'aucun'
    return h('div', { class: 'au-grid-aside' },
      P.card({
        title: 'Application de cette session',
        icon: 'monitor',
        body: [
          h('dl', { class: 'p-dl' },
            h('dt', null, 'Application'), h('dd', null, s.target?.name || '—'),
            h('dt', null, 'Adresse'), h('dd', { class: 'p-mono' }, s.target?.baseUrl || '—'),
            h('dt', null, 'Navigateur'), h('dd', null, browserLabel(s.browser || t?.browser || 'msedge'), s.headless ? ' · sans fenêtre' : ' · fenêtre visible'),
            h('dt', null, 'Comptes'), h('dd', null, accounts),
            h('dt', null, 'Tentatives par étape'), h('dd', null, String(s.maxIterations || 4)),
            h('dt', null, 'Session'), h('dd', null, `${P.fmtDate(s.createdAt)} par ${s.createdBy || '—'}`)),
          h('div', { class: 'au-foot' },
            h('button', { class: 'p-btn', type: 'button', onclick: newSession }, P.icon('plus'), 'Nouvelle session'),
            h('span', { class: 'p-spacer' }),
            h('button', { class: 'p-btn p-btn--primary', type: 'button', onclick: () => goPanel(Math.max(2, stageOf(s))) }, 'Reprendre', P.icon('arrowRight'))),
        ],
      }),
      P.card({ title: 'Historique', sub: 'Sessions d’automatisation de ce récit', icon: 'clock', body: historyTable() }))
  }

  async function newSession() {
    const s = state.session
    if (s && BUSY.has(s.status)) {
      if (!(await P.confirm('La session en cours sera arrêtée. Continuer ?', { okLabel: 'Arrêter et créer' }))) return
      await P.api(`/api/explore/sessions/${encodeURIComponent(s.id)}/stop`, { body: {} }).catch(() => {})
    }
    if (state.es) state.es.close()
    state.es = null
    state.session = null
    state.log = []
    state.shot = null
    state.panel = 1
    state.targetId = s?.target?.id || 'demo-irma'
    state.accountIds = s?.accountIds ? [...s.accountIds] : null
    history.replaceState(null, '', `/automatisation.html?key=${encodeURIComponent(KEY)}`)
    render()
  }

  function historyTable() {
    if (!state.sessions.length) return P.empty('Aucune session', 'Les sessions d’automatisation de ce récit apparaîtront ici.', 'clock')
    return h('div', { class: 'au-table-wrap' }, h('table', { class: 'p-table' },
      h('thead', null, h('tr', null, h('th', null, 'Date'), h('th', null, 'Statut'), h('th', null, 'Application'), h('th', { class: 'num' }, 'Étapes'), h('th', null, 'Fichier'), h('th', null, ''))),
      h('tbody', null, state.sessions.map((x) => h('tr', { class: x.id === state.session?.id ? 'selected' : '' },
        h('td', { class: 'p-nowrap' }, P.fmtDate(x.createdAt)),
        h('td', null, statusChip(x.status, x.statusLabel)),
        h('td', null, x.target?.name || '—'),
        h('td', { class: 'num' }, String(x.stepCount)),
        h('td', { class: 'p-mono' }, x.status === 'validated' ? x.relPath : '—'),
        h('td', null, x.id === state.session?.id ? P.badge('Ouverte', 'mint') : h('button', { class: 'p-btn p-btn--sm', type: 'button', onclick: () => openSession(x.id).catch((e) => P.toast(errMsg(e), 'error')) }, 'Ouvrir')))))))
  }

  // ------------------------------------------------------------------ étape 2 : expliquer le test

  function panelExplain() {
    const s = state.session
    if (!s) return P.empty('Aucune session', 'Choisissez d’abord l’application à tester.', 'monitor', h('button', { class: 'p-btn p-btn--primary', type: 'button', onclick: () => goPanel(1) }, 'Étape 1'))
    return h('div', { class: 'au-grid-2' }, chatCard(s), planCard(s))
  }

  function chatCard(s) {
    const llm = state.engine?.llm?.active
    const list = h('div', { class: 'au-chat', 'aria-live': 'polite' })
    for (const m of s.chat || []) list.appendChild(bubble(m))
    if (state.manual) list.appendChild(manualBlock())
    refs.chatList = list
    setTimeout(() => { list.scrollTop = list.scrollHeight }, 0)
    const input = h('textarea', {
      class: 'p-textarea au-chat-input',
      rows: 3,
      placeholder: 'Expliquez comment tester : parcours, compte à utiliser, vérifications importantes… (Ctrl+Entrée pour envoyer)',
      oninput: (e) => { state.chatDraft = e.target.value },
      onkeydown: (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send.click() } },
    })
    input.value = state.chatDraft
    const send = h('button', { class: 'p-btn p-btn--primary', type: 'button', onclick: (e) => sendChat(e.currentTarget, input.value) }, P.icon('arrowRight'), 'Envoyer')
    const acc = (s.accounts || [])[0]
    const suggestions = [
      `Connecte-toi avec le compte ${acc ? acc.label : 'de démonstration'} puis vérifie le scénario nominal.`,
      'Garde uniquement le premier scénario, c’est le plus important.',
      'Ajoute une vérification du message affiché à la fin du parcours.',
      'Explique-moi comment tu vas tester ce récit.',
    ]
    return P.card({
      title: 'Expliquer le test à l’assistant',
      sub: llm ? `Assistant : ${llm.label}${llm.model ? ` · ${llm.model}` : ''}` : 'Mode copier-coller : aucun assistant IA configuré',
      icon: 'sparkles',
      actions: llm ? null : h('a', { class: 'p-btn p-btn--sm', href: '/ia.html' }, 'Configurer l’IA'),
      className: 'au-chat-card',
      body: [
        list,
        h('div', { class: 'au-suggest' }, suggestions.map((t) => h('button', { type: 'button', class: 'p-chip', onclick: () => { input.value = t; state.chatDraft = t; input.focus() } }, t))),
        h('div', { class: 'au-chat-form' }, input, send),
      ],
    })
  }

  function bubble(m) {
    const src = m.source === 'ai' ? P.badge('IA', 'purple') : m.source === 'rule' ? P.badge('Règles', 'teal') : m.source === 'manual' ? P.badge('Copier-coller', 'amber') : null
    return h('div', { class: `au-bubble ${m.role === 'user' ? 'me' : 'bot'}` },
      h('div', { class: 'au-bubble-head' }, m.role === 'user' ? (state.user?.displayName || 'Vous') : 'Assistant', src, m.planUpdated ? P.badge('Plan mis à jour', 'mint') : null, h('span', { class: 'au-bubble-time' }, m.at ? P.fmtAgo(m.at) : '')),
      h('div', { class: 'au-bubble-text' }, m.content || ''))
  }

  function manualBlock() {
    const ta = h('textarea', { class: 'p-textarea p-mono', rows: 5, placeholder: 'Collez ici la réponse complète de votre assistant (texte + bloc ```json du plan)' })
    return h('div', { class: 'au-manual' },
      h('div', { class: 'p-h3' }, 'Mode copier-coller'),
      h('ol', { class: 'au-manual-steps' },
        h('li', null, 'Copiez le prompt (il ne contient aucun mot de passe).'),
        h('li', null, 'Collez-le dans votre assistant (Copilot, ChatGPT entreprise…).'),
        h('li', null, 'Collez sa réponse ci-dessous : le plan sera mis à jour.')),
      h('div', { class: 'p-row' },
        h('button', { class: 'p-btn p-btn--sm', type: 'button', onclick: () => P.copy(state.manual.prompt) }, P.icon('copy'), 'Copier le prompt'),
        h('details', { class: 'au-details' }, h('summary', null, 'Voir le prompt'), h('pre', { class: 'p-code au-prompt' }, state.manual.prompt))),
      ta,
      h('div', { class: 'p-row' },
        h('button', { class: 'p-btn p-btn--primary p-btn--sm', type: 'button', onclick: (e) => sendManual(e.currentTarget, ta.value) }, 'Utiliser cette réponse'),
        h('button', { class: 'p-btn p-btn--ghost p-btn--sm', type: 'button', onclick: () => { state.manual = null; renderPanel() } }, 'Fermer')))
  }

  async function sendChat(btn, text) {
    const msg = String(text || '').trim()
    if (!msg) return P.toast('Écrivez d’abord un message.', 'warn')
    if (state.planDirty && !(await P.confirm('Vos modifications du plan non enregistrées seront remplacées par la proposition de l’assistant. Continuer ?'))) return
    // affichage immédiat du message
    state.session.chat.push({ role: 'user', content: msg, at: new Date().toISOString() })
    if (refs.chatList) {
      refs.chatList.appendChild(bubble(state.session.chat[state.session.chat.length - 1]))
      refs.chatList.appendChild(h('div', { class: 'au-bubble bot pending' }, h('span', { class: 'p-spinner' }), 'L’assistant réfléchit…'))
      refs.chatList.scrollTop = refs.chatList.scrollHeight
    }
    state.chatDraft = ''
    await guard(btn, async () => {
      try {
        const r = await P.api(`/api/explore/sessions/${encodeURIComponent(state.session.id)}/chat`, { body: { message: msg } })
        state.session = r.session
        state.manual = r.manual ? { prompt: r.prompt } : null
        state.planDraft = null
        state.planDirty = false
      } finally {
        await refreshSession().catch(() => {})
        renderPanel()
        renderStepper()
      }
    })
  }

  async function sendManual(btn, answer) {
    if (!String(answer || '').trim()) return P.toast('Collez d’abord la réponse de votre assistant.', 'warn')
    await guard(btn, async () => {
      const r = await P.api(`/api/explore/sessions/${encodeURIComponent(state.session.id)}/chat`, { body: { answer } })
      state.session = r.session
      state.manual = null
      state.planDraft = null
      state.planDirty = false
      P.toast(r.reply?.planUpdated ? 'Plan mis à jour depuis la réponse collée.' : 'Réponse enregistrée (aucun plan JSON détecté).', r.reply?.planUpdated ? 'ok' : 'warn')
      renderPanel()
    })
  }

  function planCard(s) {
    if (!state.planDraft) state.planDraft = clone(s.plan || { scenarios: [] })
    const plan = state.planDraft
    const accounts = s.accounts || []
    const dirty = () => {
      state.planDirty = true
      if (refs.planSave) refs.planSave.disabled = false
      if (refs.planDirty) refs.planDirty.hidden = false
    }
    const body = h('div', { class: 'au-plan' })
    plan.scenarios.forEach((sc, si) => {
      const steps = h('ol', { class: 'au-plan-steps' })
      sc.steps.forEach((st, pi) => {
        const kind = h('select', { class: 'p-select au-kind', 'aria-label': 'Type d’étape', onchange: (e) => { st.kind = e.target.value; dirty(); renderPanel() } },
          Object.entries(KIND_LABEL).map(([k, l]) => h('option', { value: k, selected: st.kind === k }, l)))
        const goal = h('input', { class: 'p-input', value: st.goal || '', 'aria-label': 'Objectif de l’étape', oninput: (e) => { st.goal = e.target.value; dirty() } })
        const extra = st.kind === 'login'
          ? h('select', { class: 'p-select au-extra', 'aria-label': 'Compte', onchange: (e) => { st.account = e.target.value; dirty() } },
            accounts.map((a) => h('option', { value: a.id, selected: st.account === a.id }, a.label)))
          : st.kind === 'check'
            ? h('input', { class: 'p-input au-extra', value: st.expectText || '', placeholder: 'Texte attendu (facultatif)', 'aria-label': 'Texte attendu', oninput: (e) => { st.expectText = e.target.value; dirty() } })
            : null
        steps.appendChild(h('li', { class: `au-plan-step st-${st.status || 'pending'}` },
          h('span', { class: 'au-plan-num' }, String(pi + 1)),
          h('div', { class: 'au-plan-fields' },
            h('div', { class: 'au-plan-row' }, kind, goal),
            extra ? h('div', { class: 'au-plan-row' }, extra) : null,
            st.gherkin ? h('div', { class: 'au-plan-gherkin' }, st.gherkin) : null),
          h('div', { class: 'au-plan-tools' },
            iconBtn('chevronDown', 'Monter', () => { if (pi > 0) { sc.steps.splice(pi - 1, 0, sc.steps.splice(pi, 1)[0]); dirty(); renderPanel() } }, { class: 'p-icon-btn au-icon-btn au-up' }),
            iconBtn('chevronDown', 'Descendre', () => { if (pi < sc.steps.length - 1) { sc.steps.splice(pi + 1, 0, sc.steps.splice(pi, 1)[0]); dirty(); renderPanel() } }),
            iconBtn('trash', 'Supprimer l’étape', () => { sc.steps.splice(pi, 1); dirty(); renderPanel() }))))
      })
      body.appendChild(h('div', { class: 'au-plan-sc' },
        h('div', { class: 'au-plan-sc-head' },
          h('span', { class: 'p-badge outline' }, `Scénario ${si + 1}`),
          h('input', { class: 'p-input au-sc-name', value: sc.name || '', 'aria-label': 'Nom du scénario', oninput: (e) => { sc.name = e.target.value; dirty() } }),
          iconBtn('trash', 'Supprimer le scénario', () => { plan.scenarios.splice(si, 1); dirty(); renderPanel() })),
        steps,
        h('button', { class: 'p-btn p-btn--ghost p-btn--sm', type: 'button', onclick: () => { sc.steps.push({ kind: 'action', goal: '' }); dirty(); renderPanel() } }, P.icon('plus'), 'Ajouter une étape')))
    })
    if (!plan.scenarios.length) body.appendChild(P.empty('Plan vide', 'Ajoutez un scénario ou demandez un plan à l’assistant.', 'listChecks'))
    refs.planSave = h('button', { class: 'p-btn', type: 'button', disabled: !state.planDirty, onclick: (e) => savePlan(e.currentTarget) }, P.icon('save'), 'Enregistrer le plan')
    refs.planDirty = h('span', { class: 'p-badge amber', hidden: !state.planDirty }, 'Modifications non enregistrées')
    const locked = BUSY.has(s.status) && s.status !== 'planning'
    return P.card({
      title: 'Plan de test proposé',
      sub: `Source : ${{ rule: 'règles (Gherkin ou critères)', ai: 'assistant IA', manual: 'réponse collée', edit: 'modifié par vous' }[s.plan?.source] || '—'}`,
      icon: 'listChecks',
      actions: h('button', { class: 'p-btn p-btn--sm p-btn--ghost', type: 'button', title: 'Recalculer le plan à partir du Gherkin ou des critères', onclick: (e) => rulesPlan(e.currentTarget) }, P.icon('refresh'), 'Par règles'),
      body: [
        locked ? P.banner('warn', 'Exploration en cours : arrêtez-la pour modifier le plan.') : null,
        body,
        h('div', { class: 'au-foot' },
          h('button', { class: 'p-btn p-btn--ghost p-btn--sm', type: 'button', onclick: () => { plan.scenarios.push({ name: `Scénario ${plan.scenarios.length + 1}`, steps: [{ kind: 'goto', goal: 'Ouvrir l’application' }] }); dirty(); renderPanel() } }, P.icon('plus'), 'Ajouter un scénario'),
          refs.planDirty,
          h('span', { class: 'p-spacer' }),
          refs.planSave,
          h('button', { class: 'p-btn p-btn--primary', type: 'button', disabled: locked || s.status === 'validated' || !state.engine?.available, title: s.status === 'validated' ? 'Test déjà validé : créez une nouvelle session pour le refaire' : '', onclick: (e) => startExplore(e.currentTarget) }, P.icon('play'), 'Lancer l’exploration')),
      ],
    })
  }

  async function savePlan(btn) {
    return guard(btn, async () => {
      const r = await P.api(`/api/explore/sessions/${encodeURIComponent(state.session.id)}/plan`, { method: 'PUT', body: { plan: state.planDraft } })
      state.session = r.session
      state.planDraft = null
      state.planDirty = false
      P.toast('Plan enregistré.')
      renderPanel()
      renderStepper()
      return true
    })
  }

  async function rulesPlan(btn) {
    if (!(await P.confirm('Remplacer le plan par celui déduit du Gherkin (ou des critères d’acceptation) ?', { okLabel: 'Recalculer' }))) return
    await guard(btn, async () => {
      const r = await P.api(`/api/explore/sessions/${encodeURIComponent(state.session.id)}/plan`, { method: 'PUT', body: { rules: true } })
      state.session = r.session
      state.planDraft = null
      state.planDirty = false
      renderPanel()
    })
  }

  async function startExplore(btn, opts = {}) {
    if (state.planDirty) {
      const ok = await savePlan(btn)
      if (!ok) return
    }
    await guard(btn, async () => {
      const r = await P.api(`/api/explore/sessions/${encodeURIComponent(state.session.id)}/start`, { body: opts })
      state.session = r.session
      state.log = []
      state.panel = 3
      renderLive()
      renderPanel()
    })
  }

  // ------------------------------------------------------------------ étape 3 : exploration

  function panelExplore() {
    const s = state.session
    if (!s) return P.empty('Aucune session', 'Choisissez d’abord l’application à tester.', 'monitor')
    const running = s.status === 'exploring'
    const left = []
    if (s.status === 'needs-human' && s.needsHuman) {
      left.push(P.banner('warn', [h('b', null, 'L’IA a besoin de vous. '), `Étape « ${s.needsHuman.goal} » : ${s.needsHuman.reason}`, ' ',
        h('button', { class: 'p-btn p-btn--sm p-btn--primary au-banner-btn', type: 'button', onclick: openTakeover }, P.icon('target'), 'Prendre la main')]))
    } else if (s.status === 'recording') {
      left.push(P.banner('warn', [h('b', null, 'Prise de main en cours. '), 'Vos actions sont enregistrées.', ' ',
        h('button', { class: 'p-btn p-btn--sm au-banner-btn', type: 'button', onclick: openTakeover }, 'Afficher la fenêtre de prise de main')]))
    } else if (s.status === 'failed') {
      left.push(P.banner('error', [h('b', null, 'Exploration en échec. '), s.statusReason || '']))
    } else if (s.status === 'stopped' && s.statusReason) {
      left.push(P.banner('info', s.statusReason))
    }
    refs.iter = h('div', { class: 'au-iter' }, running ? 'Exploration en cours…' : s.status === 'review' ? 'Exploration terminée.' : '')
    refs.progress = h('div', { class: 'au-progress' })
    left.push(refs.iter, refs.progress)
    const hasPending = (s.plan?.scenarios || []).some((sc) => sc.steps.some((st) => !['found', 'skipped'].includes(st.status)))
    const btns = h('div', { class: 'au-foot' },
      running
        ? h('button', { class: 'p-btn p-btn--danger', type: 'button', onclick: (e) => stopSession(e.currentTarget) }, P.icon('stop'), 'Arrêter')
        : !hasPending || s.status === 'validated' ? null : h('button', {
          class: 'p-btn p-btn--primary',
          type: 'button',
          disabled: !state.engine?.available || ['recording', 'replaying'].includes(s.status) || !hasPending || s.status === 'needs-human',
          onclick: (e) => startExplore(e.currentTarget),
        }, P.icon('play'), s.stepCount ? 'Reprendre l’exploration' : 'Lancer l’exploration'),
      !running && s.stepCount ? h('button', { class: 'p-btn p-btn--ghost', type: 'button', onclick: async (e) => { if (await P.confirm('Effacer les étapes trouvées et recommencer toute l’exploration ?', { okLabel: 'Recommencer', danger: true })) startExplore(e.target.closest('button'), { restart: true }) } }, P.icon('refresh'), 'Tout recommencer') : null,
      h('span', { class: 'p-spacer' }),
      ['needs-human', 'review', 'stopped', 'exploring'].includes(s.status) ? h('button', { class: 'p-btn', type: 'button', onclick: openTakeover }, P.icon('target'), 'Prendre la main') : null,
      s.stepCount ? h('button', { class: 'p-btn', type: 'button', onclick: () => goPanel(4) }, 'Voir le test', P.icon('arrowRight')) : null)
    left.push(btns)
    const card1 = P.card({ title: 'Étapes du plan', sub: `${s.maxIterations || 4} tentative(s) de l’IA par étape avant la prise de main`, icon: 'bot', body: left })

    const img = h('img', { class: 'au-shot-img', alt: 'Capture de la page explorée' })
    refs.shotImgs.push(img)
    refs.shotUrl = h('div', { class: 'au-urlbar p-mono' }, state.shot?.url || s.lastUrl || s.target?.baseUrl || '')
    const shotBox = h('div', { class: 'au-shot' }, img, h('div', { class: 'au-shot-empty' }, P.icon('monitor'), h('div', null, 'La capture du navigateur s’affichera ici pendant l’exploration.')))
    refs.log = h('div', { class: 'p-log au-log', role: 'log', 'aria-live': 'polite' })
    for (const l of state.log.slice(-200)) refs.log.appendChild(logLine(l))
    const card2 = P.card({
      title: 'Navigateur en direct',
      sub: s.headless ? 'Exploration sans fenêtre (capture ci-dessous)' : 'Une fenêtre du navigateur est aussi ouverte sur votre poste',
      icon: 'monitor',
      body: [refs.shotUrl, shotBox, h('div', { class: 'p-section-label au-log-label' }, 'Journal'), refs.log],
    })
    setTimeout(() => { if (refs.log) refs.log.scrollTop = refs.log.scrollHeight }, 0)
    const wrap = h('div', { class: 'au-grid-explore' }, card1, card2)
    renderProgress()
    return wrap
  }

  function renderProgress() {
    const host = refs.progress
    if (!host || !state.session) return
    P.clear(host)
    const s = state.session
    const icons = { found: 'checkCircle', running: null, human: 'target', failed: 'xCircle', skipped: 'chevronRight', pending: null }
    const labels = { found: 'Trouvé', running: 'En cours', human: 'À vous', failed: 'Échec', skipped: 'Passée', pending: 'À faire' }
    ;(s.plan?.scenarios || []).forEach((sc, si) => {
      host.appendChild(h('div', { class: 'au-progress-sc' }, h('span', { class: 'p-badge outline' }, `Scénario ${si + 1}`), sc.name))
      sc.steps.forEach((st, pi) => {
        const status = st.status || 'pending'
        const src = st.source && SOURCE_BADGE[st.source] ? P.badge(SOURCE_BADGE[st.source][0], SOURCE_BADGE[st.source][1]) : null
        host.appendChild(h('div', { class: `au-pstep ${status}` },
          h('span', { class: 'au-pstep-icon' }, status === 'running' ? h('span', { class: 'p-spinner' }) : icons[status] ? P.icon(icons[status]) : String(pi + 1)),
          h('div', { class: 'au-pstep-main' },
            h('div', { class: 'au-pstep-goal' }, st.goal),
            h('div', { class: 'au-pstep-meta' }, KIND_LABEL[st.kind] || st.kind, st.gherkin ? ` · ${st.gherkin}` : '')),
          h('div', { class: 'au-pstep-side' }, src, h('span', { class: `au-pstep-label ${status}` }, labels[status] || status))))
      })
    })
  }

  function logLine(l) {
    const lvl = l.level === 'error' ? 'err' : l.level === 'warn' ? 'warn' : l.level === 'ok' ? 'ok' : ''
    const t = l.at ? new Date(l.at).toLocaleTimeString('fr-FR') : ''
    return h('div', { class: lvl }, t ? `[${t}] ` : '', l.text || '')
  }

  function appendLog(l) {
    if (!refs.log) return
    const atBottom = refs.log.scrollHeight - refs.log.scrollTop - refs.log.clientHeight < 40
    refs.log.appendChild(logLine(l))
    while (refs.log.childNodes.length > 300) refs.log.removeChild(refs.log.firstChild)
    if (atBottom) refs.log.scrollTop = refs.log.scrollHeight
  }

  function updateShots() {
    const d = state.shot
    for (const img of refs.shotImgs || []) {
      if (!img.isConnected) continue
      if (d && d.dataUrl) {
        img.src = d.dataUrl
        img.closest('.au-shot')?.classList.add('has-shot')
      }
    }
    if (refs.shotUrl && d?.url) refs.shotUrl.textContent = d.url
    if (state.tk && state.tk.img && d && d.dataUrl) {
      state.tk.img.src = d.dataUrl
      state.tk.box?.classList.add('has-shot')
      if (state.tk.url && d.url) state.tk.url.textContent = d.url
      if (state.tk.mode === 'remote') scheduleBoxes()
    }
  }

  async function stopSession(btn) {
    await guard(btn, async () => {
      const r = await P.api(`/api/explore/sessions/${encodeURIComponent(state.session.id)}/stop`, { body: {} })
      state.session = r.session
      closeTakeover()
      P.toast('Session arrêtée.', 'warn')
      render()
    })
  }

  // ------------------------------------------------------------------ prise de main

  function openTakeover() {
    const s = state.session
    if (!s) return
    if (state.tk) return
    const recording = s.status === 'recording'
    const tk = { mode: recording ? (s.takeover?.mode || 'remote') : null, checkMode: false, recorded: [], pending: false, boxes: null }
    state.tk = tk
    const body = h('div', { class: 'au-tk' })
    tk.body = body
    const m = P.modal({ title: 'Prenez la main', body, wide: true, onClose: () => { if (state.tk === tk) state.tk = null } })
    m.root.classList.add('au-tk-modal')
    tk.modal = m
    renderTakeover()
  }

  function closeTakeover() {
    if (state.tk && state.tk.modal) {
      const m = state.tk.modal
      state.tk = null
      m.close()
    }
  }

  function planStepsAfter(s) {
    const pos = s.takeover || s.needsHuman
    if (!pos) return []
    const sc = s.plan?.scenarios?.[pos.scenarioIndex]
    if (!sc) return []
    const k = sc.steps.findIndex((st) => st.id === pos.planStepId)
    return sc.steps.slice(Math.max(0, k))
  }

  function renderTakeover() {
    const tk = state.tk
    if (!tk) return
    const s = state.session
    const nh = s.needsHuman || {}
    const body = tk.body
    P.clear(body)
    const target = s.takeover ? (s.plan.scenarios[s.takeover.scenarioIndex]?.steps[s.takeover.stepIndex] || {}) : { goal: nh.goal, gherkin: nh.gherkin, kind: nh.kind }
    const goal = target.goal || nh.goal || 'l’étape en cours'
    body.appendChild(h('div', { class: 'au-tk-why' },
      h('span', { class: 'p-tile amber' }, P.icon('target')),
      h('div', null,
        h('div', { class: 'au-tk-goal' }, 'L’IA cherchait à : ', h('b', null, goal)),
        target.gherkin || nh.gherkin ? h('div', { class: 'au-plan-gherkin' }, target.gherkin || nh.gherkin) : null,
        nh.reason ? h('div', { class: 'au-tk-reason' }, nh.reason) : null,
        nh.attempts && nh.attempts.length ? h('details', { class: 'au-details' }, h('summary', null, `Voir les ${nh.attempts.length} tentative(s) de l’IA`), h('ul', { class: 'au-attempts' }, nh.attempts.map((a) => h('li', null, a)))) : null)))

    if (s.status !== 'recording') {
      // choix du mode
      body.appendChild(h('p', { class: 'au-tk-intro' }, 'Réalisez cette étape vous-même : vos actions sont enregistrées, puis transformées en étapes du test (sélecteurs compris). Ensuite, l’IA reprend la suite du plan.'))
      body.appendChild(h('div', { class: 'au-tk-choices' },
        h('button', { class: 'au-tk-choice', type: 'button', onclick: (e) => startTakeover(e.currentTarget, 'window') },
          P.icon('monitor'), h('div', null, h('b', null, 'Ouvrir la fenêtre du navigateur'), h('div', { class: 'p-hint' }, 'Agissez directement dans une fenêtre Edge/Chrome sur votre poste (la page en cours est rouverte si besoin).'))),
        h('button', { class: 'au-tk-choice', type: 'button', onclick: (e) => startTakeover(e.currentTarget, 'remote') },
          P.icon('target'), h('div', null, h('b', null, 'Agir ici, sur la capture'), h('div', { class: 'p-hint' }, 'Cliquez sur la capture, saisissez du texte et des touches depuis cette fenêtre.')))))
      body.appendChild(h('div', { class: 'au-foot' },
        s.status === 'needs-human' ? h('button', { class: 'p-btn p-btn--ghost', type: 'button', onclick: (e) => skipStep(e.currentTarget) }, 'Passer cette étape') : null,
        h('span', { class: 'p-spacer' }),
        h('button', { class: 'p-btn', type: 'button', onclick: closeTakeover }, 'Plus tard')))
      return
    }

    // enregistrement en cours
    const grid = h('div', { class: 'au-tk-grid' })
    const left = h('div', { class: 'au-tk-left' })
    tk.url = h('div', { class: 'au-urlbar p-mono' }, state.shot?.url || s.lastUrl || '')
    tk.img = h('img', { class: 'au-shot-img', alt: 'Page à piloter : cliquez pour agir', draggable: 'false' })
    tk.hl = h('div', { class: 'au-hl', hidden: true })
    tk.box = h('div', { class: `au-shot au-shot--live ${tk.mode === 'remote' ? 'clickable' : ''} ${tk.checkMode ? 'checking' : ''}` }, tk.img, tk.hl, h('div', { class: 'au-shot-empty' }, h('span', { class: 'p-spinner' }), h('div', null, 'Capture en cours…')))
    if (state.shot?.dataUrl) { tk.img.src = state.shot.dataUrl; tk.box.classList.add('has-shot') }
    if (tk.mode === 'remote') {
      tk.img.addEventListener('click', onShotClick)
      tk.img.addEventListener('mousemove', onShotMove)
      tk.img.addEventListener('mouseleave', () => { tk.hl.hidden = true })
      const modeSeg = h('div', { class: 'p-seg', role: 'group', 'aria-label': 'Mode du clic' },
        h('button', { type: 'button', class: tk.checkMode ? '' : 'active', onclick: () => { tk.checkMode = false; renderTakeover() } }, 'Cliquer'),
        h('button', { type: 'button', class: tk.checkMode ? 'active' : '', title: 'Cliquez sur un texte ou un élément pour ajouter une vérification « visible »', onclick: () => { tk.checkMode = true; renderTakeover() } }, 'Vérifier un élément'))
      const text = h('input', { class: 'p-input', placeholder: 'Texte à saisir dans le champ actif…', 'aria-label': 'Texte à saisir', onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); typeBtn.click() } } })
      const typeBtn = h('button', { class: 'p-btn p-btn--sm', type: 'button', onclick: (e) => remote(e.currentTarget, { kind: 'type', text: text.value }).then((ok) => { if (ok) text.value = '' }) }, 'Saisir')
      const keys = [['Enter', 'Entrée'], ['Tab', 'Tab'], ['Escape', 'Échap'], ['Backspace', '⌫'], ['PageDown', 'Page ↓'], ['PageUp', 'Page ↑']]
      const accButtons = (s.accounts || []).flatMap((a) => [
        h('button', { class: 'p-btn p-btn--sm p-btn--ghost', type: 'button', title: 'Saisit l’identifiant du compte sans l’afficher dans le test', onclick: (e) => remote(e.currentTarget, { kind: 'type', text: `{{account:${a.id}:username}}` }) }, P.icon('users'), `Identifiant ${a.label}`),
        h('button', { class: 'p-btn p-btn--sm p-btn--ghost', type: 'button', title: 'Saisit le mot de passe du compte : il n’apparaît ni ici, ni dans le test', onclick: (e) => remote(e.currentTarget, { kind: 'type', text: `{{account:${a.id}:password}}` }) }, P.icon('lock'), `Mot de passe ${a.label}`),
      ])
      left.appendChild(h('div', { class: 'au-tk-tools' }, modeSeg, h('span', { class: 'p-hint' }, tk.checkMode ? 'Cliquez sur l’élément à vérifier.' : 'Cliquez sur la capture pour agir sur la page.')))
      left.appendChild(tk.url)
      left.appendChild(tk.box)
      left.appendChild(h('div', { class: 'au-tk-type' }, text, typeBtn))
      left.appendChild(h('div', { class: 'au-tk-keys' }, h('span', { class: 'p-hint' }, 'Touches :'), keys.map(([k, l]) => h('button', { class: 'p-btn p-btn--sm', type: 'button', onclick: (e) => remote(e.currentTarget, { kind: 'key', key: k }) }, l))))
      if (accButtons.length) left.appendChild(h('div', { class: 'au-tk-keys' }, h('span', { class: 'p-hint' }, 'Comptes :'), accButtons))
      scheduleBoxes(0)
    } else {
      left.appendChild(P.banner('blue', [h('b', null, 'Agissez dans la fenêtre du navigateur ouverte sur votre poste. '), 'Un badge « Enregistrement » y est affiché. Revenez ici et cliquez sur « J’ai terminé » une fois l’étape réalisée.']))
      left.appendChild(tk.url)
      left.appendChild(tk.box)
    }
    const list = h('ol', { class: 'au-rec-list' })
    tk.list = list
    for (const ev of tk.recorded) list.appendChild(recItem(ev))
    if (!tk.recorded.length) list.appendChild(h('li', { class: 'au-rec-empty' }, 'Aucune action pour l’instant.'))
    const after = planStepsAfter(s)
    const cover = h('select', { class: 'p-select', 'aria-label': 'Étapes couvertes' }, after.map((st, i) => h('option', { value: st.id }, `${i === 0 ? 'Cette étape seulement' : `Jusqu’à : ${st.goal}`}`)))
    tk.cover = cover
    const right = h('div', { class: 'au-tk-right' },
      h('div', { class: 'p-h3' }, 'Actions enregistrées'),
      list,
      after.length > 1 ? fieldEl('Ces actions réalisent', cover, state.engine?.llm?.active ? 'L’IA rattachera elle-même vos actions aux étapes du plan.' : 'Sans IA, indiquez jusqu’où vos actions vont dans le plan.') : null)
    grid.append(left, right)
    body.appendChild(grid)
    body.appendChild(h('div', { class: 'au-foot' },
      h('button', { class: 'p-btn p-btn--ghost', type: 'button', onclick: (e) => finishTakeover(e.currentTarget, { discard: true }) }, 'Annuler'),
      h('button', { class: 'p-btn p-btn--ghost', type: 'button', onclick: (e) => finishTakeover(e.currentTarget, { skip: true }) }, 'Passer cette étape'),
      h('span', { class: 'p-spacer' }),
      h('button', { class: 'p-btn p-btn--primary p-btn--lg', type: 'button', onclick: (e) => finishTakeover(e.currentTarget, {}) }, P.icon('check'), 'J’ai terminé')))
  }

  function recItem(ev) {
    if (!ev) return null
    const what = ev.type === 'expect' ? `Vérifier ${ev.label ? `« ${ev.label} »` : ''}` : ev.type === 'fill' ? `Saisir « ${ev.value ?? ''} »${ev.label ? ` dans ${ev.label}` : ''}` : ev.type === 'navigate' ? `Page : ${ev.url}` : ev.type === 'press' ? `Touche ${ev.key}` : ev.type === 'select' ? `Choisir « ${ev.value} »` : `${ACTION_LABEL[ev.type] || ev.type} ${ev.label ? `« ${ev.label} »` : ''}`
    return h('li', { class: `au-rec ${ev.type}` }, h('div', null, what), ev.selector ? h('div', { class: 'au-rec-sel p-mono' }, selText(ev.selector)) : null)
  }

  function addRecorded(ev) {
    const tk = state.tk
    if (!tk || !ev) return
    tk.recorded.push(ev)
    if (tk.list) {
      tk.list.querySelector('.au-rec-empty')?.remove()
      tk.list.appendChild(recItem(ev))
      tk.list.scrollTop = tk.list.scrollHeight
    }
  }

  async function startTakeover(btn, mode) {
    const tk = state.tk
    await guard(btn, async () => {
      tk.pending = true
      try {
        const r = await P.api(`/api/explore/sessions/${encodeURIComponent(state.session.id)}/takeover`, { body: { mode } })
        state.session = r.session
        tk.mode = mode
        tk.recorded = []
      } finally {
        tk.pending = false
      }
      renderTakeover()
      renderLive()
    })
  }

  async function skipStep(btn) {
    await guard(btn, async () => {
      const r = await P.api(`/api/explore/sessions/${encodeURIComponent(state.session.id)}/takeover/done`, { body: { skip: true } })
      state.session = r.session
      closeTakeover()
      P.toast('Étape passée : l’exploration continue.', 'warn')
      renderLive()
    })
  }

  async function finishTakeover(btn, opts) {
    const tk = state.tk
    const body = { ...opts }
    if (!opts.discard && !opts.skip && tk?.cover && tk.cover.value) body.coverUntil = tk.cover.value
    await guard(btn, async () => {
      tk.pending = true
      try {
        const r = await P.api(`/api/explore/sessions/${encodeURIComponent(state.session.id)}/takeover/done`, { body })
        state.session = r.session
        if (opts.discard) P.toast('Prise de main annulée.', 'warn')
        else if (opts.skip) P.toast('Étape passée.', 'warn')
        else P.toast(`${r.steps} étape(s) ajoutée(s) au test${r.resumed ? ' : l’IA reprend la suite' : ''}.`)
      } finally {
        if (state.tk) state.tk.pending = false
      }
      closeTakeover()
      renderLive()
    })
  }

  // Coordonnées : pixels naturels de la capture (indépendants de la taille affichée)
  function natural(e) {
    const img = e.currentTarget
    const r = img.getBoundingClientRect()
    const k = img.naturalWidth / r.width
    return { x: Math.round((e.clientX - r.left) * k), y: Math.round((e.clientY - r.top) * k) }
  }

  async function onShotClick(e) {
    const tk = state.tk
    if (!tk || tk.busy) return
    const p = natural(e)
    tk.busy = true
    tk.box.classList.add('busy')
    try {
      if (tk.checkMode) {
        const r = await P.api(`/api/explore/sessions/${encodeURIComponent(state.session.id)}/remote`, { body: { kind: 'check', x: p.x, y: p.y } })
        P.toast(`Vérification ajoutée : « ${r.result?.element?.name || 'élément'} » est visible.`)
      } else {
        await P.api(`/api/explore/sessions/${encodeURIComponent(state.session.id)}/remote`, { body: { kind: 'click', x: p.x, y: p.y } })
      }
    } catch (err) {
      P.toast(errMsg(err), 'error', 6000)
    } finally {
      tk.busy = false
      tk.box?.classList.remove('busy')
      scheduleBoxes(300)
    }
  }

  async function remote(btn, body) {
    if (body.kind === 'type' && !String(body.text || '')) { P.toast('Saisissez d’abord un texte.', 'warn'); return false }
    const r = await guard(btn, () => P.api(`/api/explore/sessions/${encodeURIComponent(state.session.id)}/remote`, { body }))
    scheduleBoxes(300)
    return Boolean(r)
  }

  // Surbrillance de l'élément survolé (boîtes de l'instantané)
  let boxesTimer = null
  function scheduleBoxes(delay = 1200) {
    clearTimeout(boxesTimer)
    boxesTimer = setTimeout(async () => {
      const tk = state.tk
      if (!tk || tk.mode !== 'remote' || state.session?.status !== 'recording') return
      try {
        const r = await P.api(`/api/explore/sessions/${encodeURIComponent(state.session.id)}/snapshot`)
        if (state.tk === tk) tk.boxes = r.snapshot
      } catch { /* surbrillance facultative */ }
    }, delay)
  }

  function onShotMove(e) {
    const tk = state.tk
    if (!tk || !tk.boxes) return
    const img = e.currentTarget
    const r = img.getBoundingClientRect()
    const k = img.naturalWidth / r.width
    const scale = tk.boxes.scale || 0.8
    const x = ((e.clientX - r.left) * k) / scale
    const y = ((e.clientY - r.top) * k) / scale
    const hits = tk.boxes.elements.filter((el) => el.box && x >= el.box.x && x <= el.box.x + el.box.w && y >= el.box.y && y <= el.box.y + el.box.h)
      .sort((a, b) => a.box.w * a.box.h - b.box.w * b.box.h)
    const el = hits[0]
    if (!el) { tk.hl.hidden = true; return }
    const f = (scale / k)
    Object.assign(tk.hl.style, { left: `${img.offsetLeft + el.box.x * f}px`, top: `${img.offsetTop + el.box.y * f}px`, width: `${el.box.w * f}px`, height: `${el.box.h * f}px` })
    tk.hl.dataset.label = `${el.role || el.tag || ''} « ${el.name || ''} »`
    tk.hl.hidden = false
  }

  // ------------------------------------------------------------------ étape 4 : test généré

  function panelTest() {
    const s = state.session
    if (!s) return P.empty('Aucune session', 'Choisissez d’abord l’application à tester.', 'monitor')
    if (!state.stepsDraft) state.stepsDraft = clone(s.scenarios || [])
    const replaying = s.status === 'replaying'
    const r = s.replay
    const banners = []
    if (replaying) banners.push(P.banner('blue', [h('span', { class: 'p-spinner' }), ' Rejeu en cours dans un navigateur sans fenêtre…']))
    else if (r && r.ok) banners.push(P.banner('info', [h('b', null, 'Rejeu réussi. '), `${r.passed} étape(s) en ${P.fmtDuration(r.durationMs)}. Vous pouvez valider le test.`]))
    else if (r && !r.ok) banners.push(P.banner('error', [h('b', null, 'Rejeu en échec. '), r.error || `${r.failed} étape(s) en échec, ${r.notRun || 0} non jouée(s). Corrigez ou supprimez l’étape fautive, ou reprenez la main.`]))
    if (s.status === 'validated') banners.push(P.banner('info', [h('b', null, 'Test validé. '), `Fichier : ${s.relPath}.`, ' ', h('button', { class: 'p-btn p-btn--sm au-banner-btn', type: 'button', onclick: () => goPanel(5) }, 'Envoyer dans JIRA')]))
    refs.stepsHost = h('div', { class: 'au-steps' })
    refs.stepsSave = h('button', { class: 'p-btn', type: 'button', disabled: !state.stepsDirty, onclick: (e) => saveSteps(e.currentTarget) }, P.icon('save'), 'Enregistrer les modifications')
    const stepsCard = P.card({
      title: 'Étapes du test',
      sub: 'Supprimez, réordonnez ou corrigez une valeur ; le code se met à jour.',
      icon: 'listChecks',
      body: [
        ...banners,
        refs.stepsHost,
        h('div', { class: 'au-foot' },
          refs.stepsSave,
          h('span', { class: 'p-spacer' }),
          h('button', { class: 'p-btn', type: 'button', disabled: replaying || !s.stepCount || !state.engine?.available, onclick: (e) => replay(e.currentTarget) }, P.icon('play'), 'Rejouer'),
          h('button', { class: 'p-btn p-btn--primary', type: 'button', disabled: replaying || !s.stepCount || BUSY.has(s.status), onclick: (e) => validate(e.currentTarget) }, P.icon('checkCircle'), s.status === 'validated' ? 'Revalider' : 'Valider le test')),
      ],
    })
    const code = h('pre', { class: 'p-code au-code', html: codeHtml(s.code || '') })
    const codeCard = P.card({
      title: 'Code Playwright',
      sub: s.relPath || 'tests/e2e/…',
      icon: 'fileText',
      actions: h('button', { class: 'p-btn p-btn--sm', type: 'button', onclick: () => P.copy(s.code || '') }, P.icon('copy'), 'Copier'),
      body: [code, h('div', { class: 'p-hint au-code-hint' }, 'Les comptes sont lus dans tests/.auth/accounts.local.json (non versionné) ou dans les variables QA_ACCOUNT_<ID>_USERNAME / _PASSWORD : aucun mot de passe dans le code.')],
    })
    const wrap = h('div', { class: 'au-grid-2 au-grid-test' }, stepsCard, codeCard)
    renderStepsTable()
    return wrap
  }

  function renderStepsTable() {
    const host = refs.stepsHost
    if (!host || !state.session) return
    if (!state.stepsDraft) state.stepsDraft = clone(state.session.scenarios || [])
    P.clear(host)
    const draft = state.stepsDraft
    const dirty = () => {
      state.stepsDirty = true
      if (refs.stepsSave) refs.stepsSave.disabled = false
    }
    const nonEmpty = draft.filter((sc) => sc.steps.length)
    if (!nonEmpty.length) {
      host.appendChild(P.empty('Aucune étape', 'Lancez l’exploration pour construire le test.', 'bot', h('button', { class: 'p-btn', type: 'button', onclick: () => goPanel(3) }, 'Exploration')))
      return
    }
    draft.forEach((sc, si) => {
      if (!sc.steps.length) return
      host.appendChild(h('div', { class: 'au-progress-sc' }, h('span', { class: 'p-badge outline' }, `Scénario ${si + 1}`), sc.name))
      const tbody = h('tbody')
      sc.steps.forEach((st, j) => {
        const src = SOURCE_BADGE[st.source] || ['?', 'outline']
        const rp = st.replay
        const rpCell = !rp ? h('span', { class: 'p-faint' }, '—') : rp.ok ? h('span', { class: 'au-ok', title: rp.ms ? `${rp.ms} ms` : '' }, P.icon('checkCircle')) : rp.skipped ? h('span', { class: 'p-faint', title: 'Non jouée' }, '·') : h('span', { class: 'au-ko', title: rp.error || '' }, P.icon('xCircle'))
        let valueEl = null
        if (['fill', 'select', 'press'].includes(st.action) && !st.secret) {
          valueEl = h('input', { class: 'p-input au-val', value: st.value ?? '', 'aria-label': 'Valeur', oninput: (e) => { st.value = e.target.value; dirty() } })
        } else if (st.action === 'expect' && st.expect && ['text', 'url', 'value'].includes(st.expect.kind)) {
          valueEl = h('input', { class: 'p-input au-val', value: st.expect.value ?? '', 'aria-label': 'Valeur attendue', oninput: (e) => { st.expect.value = e.target.value; dirty() } })
        } else if (st.secret) {
          valueEl = h('span', { class: 'p-badge outline', title: st.secret }, P.icon('lock'), 'mot de passe du compte')
        }
        tbody.appendChild(h('tr', { class: rp && rp.ok === false ? 'critical' : '' },
          h('td', { class: 'num' }, String(j + 1)),
          h('td', null,
            h('div', { class: 'au-step-what' }, h('b', null, ACTION_LABEL[st.action] || st.action), st.action === 'expect' && st.expect ? ` · ${EXPECT_LABEL[st.expect.kind] || st.expect.kind}` : '', st.label ? h('span', { class: 'p-muted' }, ` — ${st.label}`) : ''),
            st.selector ? h('div', { class: 'au-step-sel p-mono', title: selText(st.selector) }, selText(st.selector)) : st.action === 'goto' ? h('div', { class: 'au-step-sel p-mono' }, st.url || '') : null,
            rp && rp.ok === false && rp.error ? h('div', { class: 'au-step-err' }, rp.error) : null),
          h('td', null, valueEl),
          h('td', null, P.badge(src[0], src[1], st.gherkin || '')),
          h('td', { class: 'au-center' }, rpCell),
          h('td', { class: 'au-step-tools' },
            iconBtn('chevronDown', 'Monter', () => { if (j > 0) { sc.steps.splice(j - 1, 0, sc.steps.splice(j, 1)[0]); dirty(); renderStepsTable() } }, { class: 'p-icon-btn au-icon-btn au-up' }),
            iconBtn('chevronDown', 'Descendre', () => { if (j < sc.steps.length - 1) { sc.steps.splice(j + 1, 0, sc.steps.splice(j, 1)[0]); dirty(); renderStepsTable() } }),
            iconBtn('trash', 'Supprimer l’étape', () => { sc.steps.splice(j, 1); dirty(); renderStepsTable() }))))
      })
      host.appendChild(h('div', { class: 'au-table-wrap' }, h('table', { class: 'p-table au-steps-table' },
        h('thead', null, h('tr', null, h('th', { class: 'num' }, '#'), h('th', null, 'Étape'), h('th', null, 'Valeur'), h('th', null, 'Source'), h('th', null, 'Rejeu'), h('th', null, ''))),
        tbody)))
    })
  }

  async function saveSteps(btn) {
    return guard(btn, async () => {
      const r = await P.api(`/api/explore/sessions/${encodeURIComponent(state.session.id)}/steps`, { method: 'PUT', body: { scenarios: state.stepsDraft } })
      state.session = r.session
      state.stepsDraft = null
      state.stepsDirty = false
      P.toast('Étapes enregistrées : rejouez le test pour le vérifier.')
      renderPanel()
      renderStepper()
      return true
    })
  }

  async function replay(btn) {
    if (state.stepsDirty) { const ok = await saveSteps(btn); if (!ok) return }
    await guard(btn, async () => {
      const r = await P.api(`/api/explore/sessions/${encodeURIComponent(state.session.id)}/replay`, { body: {} })
      state.session = r.session
      state.stepsDraft = null
      renderLive()
      renderPanel()
    })
  }

  async function validate(btn, force = false) {
    if (state.stepsDirty) { const ok = await saveSteps(btn); if (!ok) return }
    try {
      await P.busy(btn, async () => {
        const r = await P.api(`/api/explore/sessions/${encodeURIComponent(state.session.id)}/validate`, { body: { force } })
        state.session = r.session
        await refreshSessions().catch(() => {})
        P.toast(`Test validé : ${r.relPath}${r.gitignoreUpdated ? ' (tests/.auth/ ajouté au .gitignore)' : ''}.`)
        state.panel = 5
        render()
      })
    } catch (e) {
      if (e.status === 409 && e.data?.details?.needReplay && !force) {
        const ok = await P.confirm(`${errMsg(e)}`, { title: 'Valider sans rejeu ?', okLabel: 'Valider quand même' })
        if (ok) return validate(btn, true)
        return
      }
      P.toast(errMsg(e), 'error', 7000)
    }
  }

  // ------------------------------------------------------------------ étape 5 : JIRA

  function panelJira() {
    const s = state.session
    if (!s) return P.empty('Aucune session', 'Choisissez d’abord l’application à tester.', 'monitor')
    const validated = s.status === 'validated'
    const hasXray = Boolean(window.XrayPush && typeof window.XrayPush.open === 'function')
    const cmd = s.relPath ? `npx playwright test ${s.relPath}` : ''
    const send = h('button', {
      class: 'p-btn p-btn--primary p-btn--lg',
      type: 'button',
      disabled: !validated || !hasXray,
      title: !hasXray ? 'Module d’envoi Xray indisponible' : !validated ? 'Validez d’abord le test' : '',
      onclick: () => window.XrayPush?.open({ storyKey: KEY, source: { kind: 'playwright', sessionId: s.id }, onDone: () => { P.toast('Envoi JIRA terminé.'); refreshSessions().then(render).catch(() => {}) } }),
    }, P.icon('upload'), 'Envoyer dans JIRA / Xray')
    const card = P.card({
      title: 'Envoyer le test dans JIRA',
      sub: 'Ticket Test relié au récit et, en option, à un plan de test',
      icon: 'upload',
      body: [
        validated
          ? P.banner('info', [h('b', null, 'Test validé'), s.validatedAt ? ` le ${P.fmtDate(s.validatedAt)}${s.validatedBy ? ` par ${s.validatedBy}` : ''}` : '', s.validatedWithoutReplay ? ' (sans rejeu réussi)' : '', '.'])
          : P.banner('warn', [h('b', null, 'Le test n’est pas encore validé. '), 'Rejouez-le puis validez-le à l’étape « Test généré ».']),
        h('dl', { class: 'p-dl au-jira-dl' },
          h('dt', null, 'Récit'), h('dd', null, `${KEY} — ${state.story.summary}`),
          h('dt', null, 'Fichier'), h('dd', { class: 'p-mono' }, s.relPath || '—'),
          h('dt', null, 'Exécution'), h('dd', null, cmd ? h('code', { class: 'p-mono' }, cmd) : '—', cmd ? iconBtn('copy', 'Copier la commande', () => P.copy(cmd)) : null),
          h('dt', null, 'Comptes'), h('dd', null, 'tests/.auth/accounts.local.json (local, ignoré par Git) ou variables QA_ACCOUNT_<ID>_USERNAME / _PASSWORD'),
          h('dt', null, 'Étapes'), h('dd', null, `${s.stepCount} étape(s)${s.replay ? (s.replay.ok ? ', dernier rejeu réussi' : ', dernier rejeu en échec') : ''}`)),
        !hasXray ? P.banner('warn', 'Le module d’envoi vers Xray n’est pas disponible sur ce poste.') : null,
        h('div', { class: 'au-foot' }, h('button', { class: 'p-btn', type: 'button', onclick: () => goPanel(4) }, 'Revoir le test'), h('span', { class: 'p-spacer' }), send),
      ],
    })
    return h('div', { class: 'au-grid-2' }, card, P.card({ title: 'Historique', sub: 'Sessions d’automatisation de ce récit', icon: 'clock', body: historyTable() }))
  }

  // ------------------------------------------------------------------ sans ?key= : choix du récit

  async function renderStoryPicker() {
    const app = refs.app
    const [st, tri, sess, eng] = await Promise.all([
      P.api('/api/jira/stories'),
      P.api('/api/jira/triage').catch(() => ({ triage: {}, suggestions: {} })),
      P.api('/api/explore/sessions').catch(() => ({ sessions: [] })),
      P.api('/api/explore/engine').catch(() => null),
    ])
    const last = {}
    for (const s of sess.sessions) if (!last[s.storyKey]) last[s.storyKey] = s
    const decision = (k) => tri.triage?.[k]?.decision || null
    let filter = 'todo'
    let q = ''
    P.shell.setActions(h('a', { class: 'p-btn', href: '/recits.html' }, P.icon('listChecks'), 'Trier les récits'))
    function draw() {
      P.clear(app)
      app.appendChild(h('p', { class: 'p-page-intro' }, 'Choisissez un récit à transformer en test Playwright. Seuls les récits triés « À automatiser » sont proposés par défaut : le tri se fait dans la page Récits.'))
      if (eng && !eng.available) app.appendChild(P.banner('warn', [h('b', null, 'Moteur d’exploration indisponible. '), eng.reason || '', ' ', h('a', { href: '/installation.html' }, 'Installation')]))
      if (!st.stories.length) {
        app.appendChild(P.empty('Aucun récit', 'Donnez l’URL de votre projet JIRA dans la page Récits pour scanner les récits (ou essayez la démo).', 'listChecks', h('a', { class: 'p-btn p-btn--primary', href: '/recits.html' }, 'Scanner des récits')))
        return
      }
      const counts = { todo: 0, all: st.stories.length, started: 0 }
      for (const s of st.stories) {
        if (decision(s.key) === 'todo') counts.todo++
        if (last[s.key]) counts.started++
      }
      const rows = st.stories.filter((s) => (filter === 'all' || (filter === 'todo' && decision(s.key) === 'todo') || (filter === 'started' && last[s.key])))
        .filter((s) => !q || `${s.key} ${s.summary}`.toLowerCase().includes(q.toLowerCase()))
      const tabsHost = h('div')
      P.tabs(tabsHost, [
        { id: 'todo', label: 'À automatiser', count: counts.todo, tone: 'mint' },
        { id: 'started', label: 'Déjà commencés', count: counts.started },
        { id: 'all', label: 'Tous les récits', count: counts.all },
      ], filter, (id) => { filter = id; draw() })
      const search = h('input', { class: 'p-input', placeholder: 'Filtrer par clé ou résumé…', value: q, oninput: (e) => { q = e.target.value; clearTimeout(draw.t); draw.t = setTimeout(() => { draw(); const i = app.querySelector('.au-pick-search'); if (i) { i.focus(); i.setSelectionRange(q.length, q.length) } }, 200) } })
      search.classList.add('au-pick-search')
      const table = rows.length
        ? h('div', { class: 'au-table-wrap' }, h('table', { class: 'p-table' },
          h('thead', null, h('tr', null, h('th', null, 'Récit'), h('th', null, 'Résumé'), h('th', null, 'Tri'), h('th', null, 'Dernière session'), h('th', null, ''))),
          h('tbody', null, rows.map((s) => {
            const d = decision(s.key)
            const sug = tri.suggestions?.[s.key]
            const l = last[s.key]
            const href = `/automatisation.html?key=${encodeURIComponent(s.key)}`
            return h('tr', { class: 'clickable', onclick: () => { location.href = href } },
              h('td', { class: 'p-mono p-nowrap' }, s.key),
              h('td', null, h('div', { class: 'p-ellipsis au-pick-title', title: s.summary }, s.summary)),
              h('td', null, d ? P.badge(DECISION[d][0], DECISION[d][1]) : sug ? P.badge(`Suggéré : ${DECISION[sug.suggestion]?.[0] || ''}`, 'outline') : P.badge('Non trié', 'outline')),
              h('td', null, l ? statusChip(l.status, l.statusLabel) : h('span', { class: 'p-faint' }, '—')),
              h('td', null, h('a', { class: 'p-btn p-btn--sm', href, onclick: (e) => e.stopPropagation() }, l ? 'Ouvrir' : 'Automatiser', P.icon('arrowRight'))))
          }))))
        : P.empty(filter === 'todo' ? 'Aucun récit « À automatiser »' : 'Aucun récit', filter === 'todo' ? 'Triez les récits dans la page Récits, ou affichez tous les récits.' : 'Aucun résultat pour ce filtre.', 'filter',
          filter === 'todo' ? h('div', { class: 'p-row' }, h('a', { class: 'p-btn', href: '/recits.html' }, 'Trier les récits'), h('button', { class: 'p-btn p-btn--ghost', type: 'button', onclick: () => { filter = 'all'; draw() } }, 'Tous les récits')) : null)
      app.appendChild(P.card({ title: 'Récits à automatiser', sub: st.scan ? `Projet ${st.scan.projectKey || '—'} · scan du ${P.fmtDate(st.scan.scannedAt)}${st.scan.source === 'demo' ? ' (démonstration)' : ''}` : '', icon: 'bot', flush: true, body: [h('div', { class: 'au-pick-bar' }, tabsHost, search), table] }))
    }
    draw()
  }
})()

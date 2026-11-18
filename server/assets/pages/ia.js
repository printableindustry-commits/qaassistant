/*
 * Page « Assistant IA » : fournisseurs LLM, ordre de priorité, branchement de Copilot local
 * (pont VS Code), Copilot CLI, bac à sable et journal d'audit.
 */
;(function () {
  'use strict'
  const P = window.Prisme
  const { h } = P

  const META = {
    'vscode-lm': { icon: 'monitor', tone: '', desc: 'GitHub Copilot via VS Code (API vscode.lm), relayé par l’extension Wizard QA.' },
    'copilot-cli': { icon: 'terminal', tone: 'teal', desc: 'Commande « copilot » en mode non interactif (-p), sans aucun outil autorisé.' },
    'openai-compatible': { icon: 'server', tone: 'blue', desc: 'OpenAI, Azure OpenAI, GitHub Models, Ollama, LM Studio… (/chat/completions).' },
    anthropic: { icon: 'sparkles', tone: 'purple', desc: 'API Messages d’Anthropic (modèles Claude).' },
    manual: { icon: 'copy', tone: 'grey', desc: 'Le prompt complet est fourni : copiez-le dans l’outil de votre choix.' },
  }

  const PRESETS = [
    { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' },
    { id: 'github', label: 'GitHub Models', baseUrl: 'https://models.github.ai/inference', model: 'openai/gpt-4.1' },
    { id: 'azure', label: 'Azure OpenAI', baseUrl: 'https://<ressource>.openai.azure.com/openai/deployments/<déploiement>', model: '' },
    { id: 'ollama', label: 'Ollama (local)', baseUrl: 'http://localhost:11434/v1', model: 'llama3.1' },
    { id: 'lmstudio', label: 'LM Studio (local)', baseUrl: 'http://localhost:1234/v1', model: 'local-model' },
  ]

  const TABS = ['providers', 'copilot', 'cli', 'sandbox', 'audit']

  const state = {
    status: null,
    config: null,
    canEdit: false,
    audit: { entries: [], stats: null },
    tab: TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'providers',
    order: null,          // ordre en cours d'édition (null = celui du serveur)
    token: '',            // jeton d'appairage révélé
    sandbox: { provider: 'auto', purpose: 'chat', system: '', prompt: '', json: false, result: null, running: null, error: null },
  }

  let root, kpiHost, tabsHost, panel, tabsCtl, pollTimer

  // ------------------------------------------------------------------ utilitaires

  const label = (id) => state.status?.providers.find((p) => p.id === id)?.label || id
  const provider = (id) => state.status?.providers.find((p) => p.id === id)
  const cfgOf = (id) => state.config?.providers?.[id] || {}

  let fieldSeq = 0
  function field(text, control, hint, cls) {
    const first = [].concat(control)[0]
    if (first instanceof Element && !first.id) first.id = `ia-f${++fieldSeq}`
    return h('div', { class: `p-field ${cls || ''}` },
      h('label', { for: first?.id || null }, text), control, hint ? h('div', { class: 'p-hint' }, hint) : null)
  }

  function input(attrs) {
    return h('input', { class: 'p-input', type: 'text', disabled: !state.canEdit, ...attrs })
  }

  function copyLine(text, display) {
    return h('div', { class: 'ia-copyline' },
      h('code', null, display || text),
      h('button', { class: 'p-btn p-btn--sm', type: 'button', onclick: () => P.copy(text) }, P.icon('copy'), 'Copier'))
  }

  function availability(p) {
    if (!p) return P.status('Inconnu')
    return p.available ? P.status('Disponible', 'mint') : P.status('Indisponible', 'amber')
  }

  function fail(e, what) {
    P.toast(`${what} : ${e.message}`, 'error', 7000)
  }

  // ------------------------------------------------------------------ chargement

  async function loadAll() {
    const [status, config, audit] = await Promise.all([
      P.api('/api/llm/status'),
      P.api('/api/llm/config'),
      P.api('/api/llm/audit?limit=200').catch(() => ({ entries: [], stats: null })),
    ])
    state.status = status
    state.config = config.config
    state.canEdit = Boolean(config.canEdit)
    state.audit = { entries: audit.entries || [], stats: audit.stats }
  }

  async function refreshStatus(refreshCli) {
    state.status = await P.api(`/api/llm/status${refreshCli ? '?refresh=1' : ''}`)
    renderKpis()
    updateTabs()
  }

  async function refreshAudit() {
    const audit = await P.api('/api/llm/audit?limit=200')
    state.audit = { entries: audit.entries || [], stats: audit.stats }
  }

  // ------------------------------------------------------------------ en-tête : KPI et onglets

  function renderKpis() {
    const s = state.status
    const ready = s.providers.filter((p) => p.available && p.id !== 'manual').length
    const b = s.bridge
    const st = state.audit.stats
    P.clear(kpiHost).append(
      P.kpi({
        label: 'Fournisseur actif',
        value: s.active ? s.active.label : 'Copier-coller',
        detail: s.active ? (s.active.model || 'modèle par défaut') : 'Aucun fournisseur branché',
        tone: s.active ? 'mint' : 'amber',
      }),
      P.kpi({ label: 'Fournisseurs prêts', value: String(ready), unit: ` / ${s.providers.length - 1}`, detail: 'hors copier-coller' }),
      P.kpi({
        label: 'Copilot local (pont VS Code)',
        value: b.connected ? 'Connecté' : 'Déconnecté',
        detail: b.connected
          ? (b.copilot?.available ? `${b.copilot.models.length} modèle(s) Copilot` : (b.copilot?.reason || 'Copilot non détecté'))
          : (b.lastSeen ? `Dernier signal ${P.fmtAgo(b.lastSeen)}` : 'Jamais connecté'),
        tone: b.connected && b.copilot?.available ? 'mint' : '',
      }),
      P.kpi({
        label: 'Appels à l’IA',
        value: st ? String(st.total) : '0',
        detail: st && st.total ? `${st.ok} réussi(s) · ${P.fmtDuration(st.avgDurationMs)} en moyenne` : 'Aucun appel enregistré',
      }),
    )
  }

  function tabItems() {
    const s = state.status
    const ready = s.providers.filter((p) => p.available && p.id !== 'manual').length
    const vs = provider('vscode-lm')
    const cli = provider('copilot-cli')
    return [
      { id: 'providers', label: 'Fournisseurs', icon: 'layers', count: ready, tone: ready ? '' : 'amber' },
      { id: 'copilot', label: 'Brancher Copilot local', icon: 'monitor', count: vs?.available ? '✓' : '!', tone: vs?.available ? '' : 'amber' },
      { id: 'cli', label: 'Copilot CLI', icon: 'terminal', count: cli?.available ? '✓' : '!', tone: cli?.available ? '' : 'amber' },
      { id: 'sandbox', label: 'Bac à sable', icon: 'flask' },
      { id: 'audit', label: 'Journal', icon: 'listChecks', count: state.audit.entries.length },
    ]
  }

  function updateTabs() {
    if (tabsCtl) tabsCtl.update(tabItems())
  }

  function selectTab(id) {
    state.tab = id
    history.replaceState(null, '', `#${id}`)
    tabsCtl.set(id)
    renderPanel()
  }

  function renderPanel() {
    P.clear(panel)
    const views = { providers: viewProviders, copilot: viewCopilot, cli: viewCli, sandbox: viewSandbox, audit: viewAudit }
    panel.append(...[].concat(views[state.tab]()).filter((n) => n != null && n !== false))
    schedulePoll()
  }

  /** Rafraîchit l'état du pont pendant que la procédure Copilot local est affichée. */
  function schedulePoll() {
    clearTimeout(pollTimer)
    if (state.tab !== 'copilot' || document.hidden) return
    pollTimer = setTimeout(async () => {
      try {
        await refreshStatus(false)
        if (state.tab === 'copilot') renderPanel()
      } catch { schedulePoll() }
    }, 4000)
  }

  // ------------------------------------------------------------------ onglet Fournisseurs

  function viewProviders() {
    const s = state.status
    const intro = s.active
      ? P.banner('info', [h('strong', null, `${s.active.label} est utilisé en priorité`), s.active.model ? ` (modèle ${s.active.model})` : '', '. Les autres fournisseurs prennent le relais en cas d’échec, dans l’ordre ci-dessous.'], 'checkCircle')
      : P.banner('warn', [h('strong', null, 'Mode copier-coller actif. '), 'Aucun fournisseur n’est disponible : les écrans de génération fournissent le prompt à copier. Branchez Copilot local (onglet suivant) ou une API.'])
    const readOnly = state.canEdit ? null : P.banner('blue', 'Réglages en lecture seule : seul un administrateur peut les modifier. Vous pouvez essayer les fournisseurs.')
    return [intro, readOnly, orderCard(), h('div', { class: 'p-grid p-grid-2' }, s.order.map(providerCard))]
  }

  function orderCard() {
    const serverOrder = state.status.order
    const order = state.order || serverOrder
    const dirty = state.order && state.order.join() !== serverOrder.join()
    const activeId = state.status.active?.id
    const move = (i, d) => {
      const next = [...order]
      const [it] = next.splice(i, 1)
      next.splice(i + d, 0, it)
      state.order = next
      renderPanel()
    }
    const rows = order.map((id, i) => {
      const p = provider(id)
      const fixed = id === 'manual'
      return h('li', { class: id === activeId ? 'is-active' : '' },
        h('span', { class: 'ia-rank' }, String(i + 1)),
        h('div', { style: { minWidth: 0 } },
          h('div', { class: 'ia-order-name' }, p?.label || id, id === activeId ? ' ' : null, id === activeId ? P.badge('Actif', 'mint') : null),
          h('div', { class: 'ia-order-reason', title: p?.reason || '' }, p?.reason || '')),
        availability(p),
        h('span', { class: 'ia-move' },
          h('button', { class: 'p-icon-btn ia-up', type: 'button', 'aria-label': `Monter ${p?.label}`, disabled: !state.canEdit || fixed || i === 0, onclick: () => move(i, -1) }, P.icon('chevronDown')),
          h('button', { class: 'p-icon-btn', type: 'button', 'aria-label': `Descendre ${p?.label}`, disabled: !state.canEdit || fixed || i >= order.length - 2, onclick: () => move(i, 1) }, P.icon('chevronDown'))))
    })
    const actions = dirty ? h('div', { class: 'p-row' },
      h('button', { class: 'p-btn p-btn--ghost p-btn--sm', type: 'button', onclick: () => { state.order = null; renderPanel() } }, 'Annuler'),
      h('button', { class: 'p-btn p-btn--primary p-btn--sm', type: 'button', onclick: (e) => saveOrder(e.currentTarget) }, P.icon('save'), 'Enregistrer l’ordre')) : null
    return P.card({
      title: 'Ordre de priorité',
      sub: 'Le premier fournisseur disponible répond ; en cas d’échec, le suivant prend le relais. Le copier-coller reste toujours en dernier recours.',
      icon: 'listChecks',
      actions,
      flush: true,
      body: h('ol', { class: 'ia-order' }, rows),
    })
  }

  async function saveOrder(btn) {
    await P.busy(btn, async () => {
      try {
        await saveConfig({ order: state.order })
        state.order = null
        P.toast('Ordre de priorité enregistré')
        renderPanel()
      } catch (e) { fail(e, 'Enregistrement impossible') }
    })
  }

  async function saveConfig(patch) {
    const r = await P.api('/api/llm/config', { method: 'PUT', body: patch })
    state.config = r.config
    state.status = r.status
    renderKpis()
    updateTabs()
    if (window.Prisme.shell?.refreshStrip) window.Prisme.shell.refreshStrip()
  }

  function lastTestLine(id) {
    const t = state.status.lastTests?.[id]
    if (!t) return null
    if (t.success) {
      return h('div', { class: 'ia-test ok' }, P.icon('checkCircle', 14), ' ',
        `Essai réussi ${P.fmtAgo(t.at)}`, t.durationMs != null ? ` en ${P.fmtDuration(t.durationMs)}` : '', t.model ? ` · ${t.model}` : '',
        t.text ? h('div', { class: 'p-faint', style: { marginTop: '4px' } }, `Réponse : « ${t.text.trim().slice(0, 160)} »`) : null)
    }
    return h('div', { class: 'ia-test ko' }, `Essai en échec ${P.fmtAgo(t.at)} : ${t.error}`)
  }

  function providerCard(id) {
    const p = provider(id)
    const meta = META[id]
    const form = FORMS[id] ? FORMS[id]() : null
    const isActive = state.status.active?.id === id
    const testBtn = h('button', { class: 'p-btn p-btn--sm', type: 'button', onclick: (e) => testProvider(id, e.currentTarget) }, P.icon('play'), 'Essayer')
    const saveBtn = form && state.canEdit
      ? h('button', { class: 'p-btn p-btn--primary p-btn--sm', type: 'button', onclick: (e) => saveProvider(id, form, e.currentTarget) }, P.icon('save'), 'Enregistrer')
      : null
    const extra = id === 'vscode-lm'
      ? h('button', { class: 'p-btn p-btn--ghost p-btn--sm', type: 'button', onclick: () => selectTab('copilot') }, 'Procédure de branchement', P.icon('arrowRight'))
      : id === 'copilot-cli'
        ? h('button', { class: 'p-btn p-btn--ghost p-btn--sm', type: 'button', onclick: () => selectTab('cli') }, 'Procédure d’installation', P.icon('arrowRight'))
        : null
    return P.card({
      title: p?.label || id,
      sub: meta.desc,
      icon: meta.icon,
      tone: meta.tone,
      className: `ia-provider ${p?.available ? '' : 'is-off'}`,
      actions: h('div', { class: 'p-row' }, isActive ? P.badge('Actif', 'mint') : null, availability(p)),
      body: [
        h('div', { class: 'ia-reason' }, P.icon(p?.available ? 'checkCircle' : 'info'), h('span', null, p?.reason || '—')),
        lastTestLine(id),
        form ? form.el : null,
        h('div', { class: 'ia-foot' }, extra, h('span', { class: 'p-spacer' }), testBtn, saveBtn),
      ],
    })
  }

  async function testProvider(id, btn) {
    await P.busy(btn, async () => {
      try {
        const r = await P.api('/api/llm/test', { body: { provider: id } })
        state.status = r.status
        await refreshAudit().catch(() => {})
        if (r.test.success) P.toast(id === 'manual' ? 'Mode copier-coller opérationnel' : `${r.test.label} a répondu en ${P.fmtDuration(r.test.durationMs)}`)
        else P.toast(`${r.test.label} : ${r.test.error}`, 'error', 9000)
        renderKpis()
        updateTabs()
        renderPanel()
      } catch (e) { fail(e, 'Essai impossible') }
    })
  }

  async function saveProvider(id, form, btn) {
    await P.busy(btn, async () => {
      try {
        await saveConfig({ providers: { [id]: form.values() } })
        P.toast(`${label(id)} : réglages enregistrés`)
        renderPanel()
      } catch (e) { fail(e, 'Enregistrement impossible') }
    })
  }

  // --- formulaires par fournisseur : { el, values() }

  const seconds = (ms) => String(Math.round((ms || 0) / 1000))
  const toMs = (v) => Math.round(Number(String(v).replace(',', '.')) * 1000)
  const lines = (v) => String(v || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)

  function enabledToggle(c) {
    const box = h('input', { type: 'checkbox', checked: c.enabled, disabled: !state.canEdit })
    return { box, el: h('label', { class: 'p-check' }, box, 'Activé') }
  }

  function timeoutField(c) {
    const el = input({ type: 'number', min: 5, max: 900, step: 5, value: seconds(c.timeoutMs) })
    return { el, field: field('Délai maximal (s)', el) }
  }

  const FORMS = {
    'vscode-lm'() {
      const c = cfgOf('vscode-lm')
      const en = enabledToggle(c)
      const models = state.status.bridge.copilot?.models || []
      const family = input({ value: c.family || '', placeholder: 'Automatique (premier modèle Copilot)', list: 'ia-families' })
      const list = h('datalist', { id: 'ia-families' }, models.map((m) => h('option', { value: m.family }, m.name)))
      const to = timeoutField(c)
      return {
        el: h('div', { class: 'p-form-grid' },
          h('div', { class: 'span-2' }, en.el),
          field('Famille de modèle', [family, list], models.length ? `Vus par VS Code : ${models.map((m) => m.family).join(', ')}` : 'Exemples : gpt-4.1, claude-sonnet-4, o4-mini'),
          to.field),
        values: () => ({ enabled: en.box.checked, family: family.value.trim(), timeoutMs: toMs(to.el.value) }),
      }
    },

    'copilot-cli'() {
      const c = cfgOf('copilot-cli')
      const en = enabledToggle(c)
      const command = input({ value: c.command, placeholder: 'copilot' })
      const args = h('textarea', { class: 'p-textarea p-mono', rows: 3, disabled: !state.canEdit })
      args.value = (c.args || []).join('\n')
      const modelArgs = input({ value: (c.modelArgs || []).join(' '), placeholder: '--model {model}' })
      const model = input({ value: c.model || '', placeholder: 'Modèle par défaut de la CLI' })
      const tools = input({ value: (c.allowTools || []).join(', '), placeholder: 'Aucun (recommandé)' })
      const to = timeoutField(c)
      return {
        el: h('div', { class: 'p-form-grid' },
          h('div', { class: 'span-2' }, en.el),
          field('Commande', command, 'Nom ou chemin de l’exécutable, sans argument.'),
          field('Modèle', model, 'Facultatif, par exemple claude-sonnet-4.5 ou gpt-5.'),
          field('Arguments (un par ligne)', args, '{prompt} est remplacé par le prompt complet, passé comme un seul argument (sans shell).', 'span-2'),
          field('Arguments du modèle', modelArgs, 'Ajoutés seulement si un modèle est indiqué.'),
          field('Outils autorisés', tools, 'Séparés par des virgules ; chacun devient --allow-tool.'),
          to.field,
          h('div', { class: 'p-field' }, h('label', null, 'Commande lancée'), h('code', { class: 'p-faint p-mono', style: { fontSize: '11.5px', overflowWrap: 'anywhere' } }, state.status.cli.preview))),
        values: () => ({
          enabled: en.box.checked,
          command: command.value.trim(),
          args: lines(args.value),
          modelArgs: modelArgs.value.trim().split(/\s+/).filter(Boolean),
          model: model.value.trim(),
          allowTools: tools.value.split(',').map((s) => s.trim()).filter(Boolean),
          timeoutMs: toMs(to.el.value),
        }),
      }
    },

    'openai-compatible'() {
      const c = cfgOf('openai-compatible')
      const en = enabledToggle(c)
      const baseUrl = input({ value: c.baseUrl || '', placeholder: 'https://api.openai.com/v1' })
      const model = input({ value: c.model || '', placeholder: 'gpt-4.1-mini' })
      const apiKey = input({ type: 'password', value: '', placeholder: c.apiKeySet ? `Enregistrée (${c.apiKey}) — laisser vide pour conserver` : 'Facultative pour Ollama / LM Studio', autocomplete: 'off' })
      const clearKey = h('input', { type: 'checkbox', disabled: !state.canEdit || !c.apiKeySet })
      const apiVersion = input({ value: c.apiVersion || '', placeholder: '2024-10-21' })
      const to = timeoutField(c)
      const preset = h('select', { class: 'p-select', disabled: !state.canEdit, onchange: () => {
        const p = PRESETS.find((x) => x.id === preset.value)
        if (!p) return
        baseUrl.value = p.baseUrl
        model.value = p.model
        if (p.id === 'azure') baseUrl.focus()
      } }, h('option', { value: '' }, 'Choisir un modèle de réglage…'), PRESETS.map((p) => h('option', { value: p.id }, p.label)))
      return {
        el: h('div', { class: 'p-form-grid' },
          h('div', { class: 'span-2 p-row p-row--between' }, en.el, preset),
          field('URL de l’API', baseUrl, 'Jusqu’à /v1 (ou le déploiement Azure) ; /chat/completions est ajouté.', 'span-2'),
          field('Modèle', model, 'Inutile pour Azure : le déploiement fait foi.'),
          field('Clé d’API', apiKey, h('label', { class: 'p-check' }, clearKey, 'Effacer la clé enregistrée')),
          field('Version d’API (Azure)', apiVersion),
          to.field),
        values: () => {
          const v = { enabled: en.box.checked, baseUrl: baseUrl.value.trim(), model: model.value.trim(), apiVersion: apiVersion.value.trim(), timeoutMs: toMs(to.el.value) }
          if (clearKey.checked) v.apiKey = ''
          else if (apiKey.value.trim()) v.apiKey = apiKey.value.trim()
          return v
        },
      }
    },

    anthropic() {
      const c = cfgOf('anthropic')
      const en = enabledToggle(c)
      const apiKey = input({ type: 'password', value: '', placeholder: c.apiKeySet ? `Enregistrée (${c.apiKey}) — laisser vide pour conserver` : 'sk-ant-…', autocomplete: 'off' })
      const clearKey = h('input', { type: 'checkbox', disabled: !state.canEdit || !c.apiKeySet })
      const model = input({ value: c.model || '', placeholder: 'claude-sonnet-5-5' })
      const baseUrl = input({ value: c.baseUrl || '', placeholder: 'https://api.anthropic.com' })
      const to = timeoutField(c)
      return {
        el: h('div', { class: 'p-form-grid' },
          h('div', { class: 'span-2' }, en.el),
          field('Clé d’API', apiKey, h('label', { class: 'p-check' }, clearKey, 'Effacer la clé enregistrée')),
          field('Modèle', model, 'Par défaut : claude-sonnet-5-5.'),
          field('URL de l’API', baseUrl, 'À modifier seulement derrière une passerelle d’entreprise.'),
          to.field),
        values: () => {
          const v = { enabled: en.box.checked, model: model.value.trim(), baseUrl: baseUrl.value.trim(), timeoutMs: toMs(to.el.value) }
          if (clearKey.checked) v.apiKey = ''
          else if (apiKey.value.trim()) v.apiKey = apiKey.value.trim()
          return v
        },
      }
    },
  }

  // ------------------------------------------------------------------ onglet Copilot local

  function step(n, st, title, badge, ...body) {
    const num = st === 'done' ? P.icon('check') : st === 'failed' ? '!' : String(n)
    return h('li', { class: `ia-step ${st}` },
      h('span', { class: 'ia-step-num' }, num),
      h('div', { style: { minWidth: 0 } }, h('div', { class: 'ia-step-title' }, title, badge || null), h('div', { class: 'ia-step-body' }, body)))
  }

  /** Adresse du serveur : dans la webview VS Code, location.origin vaut vscode-webview://… */
  function serverUrl() {
    const base = String(window.__WIZARD_API_BASE__ || '')
    return (/^https?:\/\//i.test(base) ? base : location.origin).replace(/\/+$/, '')
  }

  function settingsSnippet(token) {
    return JSON.stringify({
      'wizardQa.serverUrl': serverUrl(),
      'wizardQa.bridgeToken': token || '<jeton d’appairage>',
      'wizardQa.llmBridge.enabled': true,
    }, null, 2)
  }

  function tokenBlock() {
    const masked = state.config.bridge.token
    const reveal = h('button', { class: 'p-btn p-btn--sm', type: 'button', onclick: (e) => revealToken(e.currentTarget) }, P.icon('eye'), 'Afficher le jeton')
    const regen = h('button', { class: 'p-btn p-btn--ghost p-btn--sm', type: 'button', onclick: (e) => regenerateToken(e.currentTarget) }, P.icon('refresh'), 'Générer un nouveau jeton')
    if (!state.canEdit) {
      return [h('div', null, `Jeton actuel : ${masked}.`), P.banner('blue', 'Demandez le jeton d’appairage à un administrateur de Wizard QA.')]
    }
    return [
      state.token ? copyLine(state.token) : h('div', { class: 'p-row' }, h('code', { class: 'p-mono' }, masked), reveal),
      h('div', { class: 'p-row' }, regen, h('span', { class: 'p-hint' }, 'L’ancien jeton est aussitôt refusé : l’extension devra être reconfigurée.')),
      state.config.bridge.envToken
        ? h('div', { class: 'p-hint' }, 'Ce serveur a été lancé par l’extension VS Code : son propre jeton est aussi accepté, aucun réglage n’est nécessaire dans ce cas.')
        : null,
    ]
  }

  async function revealToken(btn) {
    await P.busy(btn, async () => {
      try {
        state.token = (await P.api('/api/llm/bridge/token/reveal', { body: {} })).token
        renderPanel()
      } catch (e) { fail(e, 'Lecture du jeton impossible') }
    })
  }

  async function regenerateToken(btn) {
    const ok = await P.confirm('Les extensions VS Code déjà appairées ne pourront plus se connecter tant que le nouveau jeton n’aura pas été saisi.', { title: 'Générer un nouveau jeton ?', okLabel: 'Générer', danger: true })
    if (!ok) return
    await P.busy(btn, async () => {
      try {
        state.token = (await P.api('/api/llm/bridge/token/regenerate', { body: {} })).token
        state.config = (await P.api('/api/llm/config')).config
        P.toast('Nouveau jeton généré : copiez-le dans VS Code')
        renderPanel()
      } catch (e) { fail(e, 'Génération impossible') }
    })
  }

  function viewCopilot() {
    const b = state.status.bridge
    const vs = provider('vscode-lm')
    const seen = Boolean(b.client)
    const copilotOk = Boolean(b.copilot?.available)
    const stVs = b.client?.vscodeVersion ? 'done' : 'todo'
    const stChat = copilotOk ? 'done' : b.connected && b.copilot ? 'failed' : 'todo'
    const stExt = seen ? 'done' : 'todo'
    const stLink = b.connected ? 'done' : seen ? 'failed' : 'todo'
    const stTest = state.status.lastTests?.['vscode-lm']?.success ? 'done' : 'todo'

    const summary = P.stepper([
      { label: 'VS Code', sub: b.client?.vscodeVersion || '1.90 ou plus', state: stVs },
      { label: 'Copilot Chat', sub: copilotOk ? 'Accessible' : 'À installer', state: stChat },
      { label: 'Extension Wizard QA', sub: seen ? `v${b.client.version || '?'}` : 'À installer', state: stExt },
      { label: 'Appairage', sub: b.connected ? 'Connecté' : 'URL et jeton', state: stLink },
      { label: 'Essai', sub: stTest === 'done' ? 'Réussi' : 'À faire', state: stTest },
    ])

    const live = b.connected
      ? P.banner(copilotOk ? 'info' : 'warn', copilotOk
        ? [h('strong', null, 'Copilot local est branché. '), `Extension connectée depuis ${P.fmtAgo(b.connectedAt)}, ${b.copilot.models.length} modèle(s) : ${b.copilot.models.map((m) => m.name).join(', ')}. Requêtes traitées : ${b.served}, en échec : ${b.failed}.`]
        : [h('strong', null, 'Extension connectée, mais Copilot est inaccessible. '), b.copilot?.reason || 'Vérifiez GitHub Copilot Chat dans VS Code.'], copilotOk ? 'checkCircle' : 'alert')
      : P.banner('blue', [h('strong', null, 'En attente de l’extension VS Code. '), vs?.reason || '', ' Cette page se met à jour toute seule.'])

    const steps = h('ol', { class: 'ia-steps' },
      step(1, stVs, 'Ouvrir VS Code 1.90 ou plus récent', null,
        'L’API des modèles de langage (vscode.lm) utilisée par le pont n’existe qu’à partir de VS Code 1.90. Menu Aide › À propos pour vérifier la version.'),
      step(2, stChat, 'Installer et connecter GitHub Copilot Chat', stChat === 'failed' ? P.badge('À corriger', 'red') : null,
        'Dans VS Code : Extensions (Ctrl+Maj+X) › « GitHub Copilot Chat » › Installer, puis connectez-vous avec votre compte GitHub disposant d’une licence Copilot.',
        stChat === 'failed' ? P.banner('error', b.copilot.reason || 'Copilot inaccessible.') : null),
      step(3, stExt, 'Installer l’extension Wizard QA', null,
        'Installez le paquet .vsix de Wizard QA (Extensions › … › Installer depuis un VSIX), puis ouvrez la vue Wizard QA ou lancez la commande ci-dessous.',
        copyLine('Wizard QA: Connecter Copilot local')),
      step(4, stLink, 'Appairer l’extension avec ce serveur', b.connected ? P.badge('Connecté', 'mint') : null,
        'Si VS Code a lancé lui-même le serveur Wizard QA, il n’y a rien à faire : le pont se branche automatiquement. Pour ce serveur web, ajoutez ces réglages (Ctrl+Maj+P › « Préférences : ouvrir les paramètres utilisateur (JSON) ») :',
        h('div', { class: 'p-field' }, h('label', null, 'URL du serveur'), copyLine(serverUrl())),
        h('div', { class: 'p-field' }, h('label', null, 'Jeton d’appairage'), tokenBlock()),
        h('div', { class: 'p-field' }, h('label', null, 'Bloc de réglages à coller'),
          h('pre', { class: 'p-code', style: { margin: 0 } }, settingsSnippet(state.token)),
          h('div', null, h('button', { class: 'p-btn p-btn--sm', type: 'button', onclick: () => {
            if (!state.token && state.canEdit) P.toast('Affichez d’abord le jeton pour le copier avec les réglages', 'warn')
            P.copy(settingsSnippet(state.token))
          } }, P.icon('copy'), 'Copier les réglages')))),
      step(5, stTest, 'Essayer et autoriser l’accès', null,
        'Au premier appel, VS Code demande d’autoriser Wizard QA à utiliser les modèles de langage : répondez « Autoriser ». Lancez ensuite un essai :',
        h('div', null, h('button', { class: 'p-btn p-btn--primary p-btn--sm', type: 'button', disabled: !vs?.available, onclick: (e) => testProvider('vscode-lm', e.currentTarget) }, P.icon('play'), 'Essayer Copilot local')),
        lastTestLine('vscode-lm')))

    const diag = P.card({
      title: 'État du pont',
      icon: 'activity',
      body: h('dl', { class: 'p-dl' },
        h('dt', null, 'Connexion'), h('dd', null, b.connected ? P.status('Connectée', 'mint') : P.status('Aucune', 'amber')),
        h('dt', null, 'Dernier signal'), h('dd', null, b.lastSeen ? `${P.fmtDate(b.lastSeen)} (${P.fmtAgo(b.lastSeen)})` : 'Jamais'),
        h('dt', null, 'Client'), h('dd', null, b.client ? `${b.client.name} ${b.client.version || ''} · VS Code ${b.client.vscodeVersion || '?'}` : '—'),
        h('dt', null, 'Modèles Copilot'), h('dd', null, b.copilot?.models?.length ? b.copilot.models.map((m) => `${m.name} (${m.family})`).join(', ') : '—'),
        h('dt', null, 'File d’attente'), h('dd', null, `${b.queue.pending} en attente · ${b.queue.running} en cours`),
        h('dt', null, 'Requêtes'), h('dd', null, `${b.served} traitée(s) · ${b.failed} en échec`)),
    })

    return [live, P.card({ title: 'Brancher Copilot local', sub: 'Copilot n’a pas besoin d’être installé sur le serveur : c’est VS Code, sur votre poste, qui relaie les requêtes.', icon: 'monitor', body: [summary, h('div', { style: { height: '14px' } }), steps] }), diag]
  }

  // ------------------------------------------------------------------ onglet Copilot CLI

  function viewCli() {
    const p = provider('copilot-cli')
    const d = state.status.cli.detection
    const found = Boolean(d?.found)
    const cfg = cfgOf('copilot-cli')
    const detectBtn = h('button', { class: 'p-btn p-btn--sm', type: 'button', onclick: (e) => P.busy(e.currentTarget, async () => {
      try {
        await refreshStatus(true)
        renderPanel()
        P.toast(provider('copilot-cli').available ? 'Copilot CLI détecté' : 'Copilot CLI introuvable', provider('copilot-cli').available ? 'ok' : 'warn')
      } catch (err) { fail(err, 'Détection impossible') }
    }) }, P.icon('refresh'), 'Relancer la détection')

    const detection = P.card({
      title: 'Détection sur ce serveur',
      icon: 'search',
      actions: h('div', { class: 'p-row' }, availability(p), detectBtn),
      body: [
        h('dl', { class: 'p-dl' },
          h('dt', null, 'Commande'), h('dd', null, h('code', { class: 'p-mono' }, cfg.command)),
          h('dt', null, 'Résultat'), h('dd', null, d?.reason || 'Détection en cours…'),
          h('dt', null, 'Emplacement'), h('dd', null, d?.path || '—', d?.viaNode ? ' (lancé via Node, sans cmd.exe)' : ''),
          h('dt', null, 'Version'), h('dd', null, d?.version || '—'),
          h('dt', null, 'Vérifié'), h('dd', null, d?.checkedAt ? P.fmtAgo(d.checkedAt) : '—'),
          h('dt', null, 'Commande lancée'), h('dd', null, h('code', { class: 'p-mono' }, state.status.cli.preview))),
        lastTestLine('copilot-cli'),
      ],
    })

    const steps = h('ol', { class: 'ia-steps' },
      step(1, 'done', 'Disposer de Node.js 22 ou plus récent', null, 'Copilot CLI est distribué sous forme de paquet npm. Vérifiez avec :', copyLine('node --version')),
      step(2, found ? 'done' : 'todo', 'Installer GitHub Copilot CLI', null,
        'Dans un terminal, sur la machine qui héberge ce serveur (Wizard QA ne l’installe pas à votre place) :',
        copyLine('npm install -g @github/copilot'),
        h('div', { class: 'p-hint' }, 'Derrière un proxy d’entreprise, configurez d’abord npm (page « Accès npm ») ou les variables HTTPS_PROXY.')),
      step(3, 'todo', 'Se connecter à GitHub', null,
        'Lancez Copilot une première fois, acceptez le dossier de travail puis tapez /login et suivez les instructions. Alternative : variable GH_TOKEN (jeton à droit « Copilot Requests »).',
        copyLine('copilot')),
      step(4, found ? 'done' : 'todo', 'Laisser Wizard QA détecter la commande', null,
        'Relancez la détection ci-dessus. Si la commande n’est pas dans le PATH du serveur, indiquez son chemin complet dans la carte « GitHub Copilot CLI » de l’onglet Fournisseurs.'),
      step(5, state.status.lastTests?.['copilot-cli']?.success ? 'done' : 'todo', 'Essayer', null,
        'Le prompt est passé en un seul argument à « -p », sans shell, et aucun outil n’est autorisé : Copilot répond sans modifier le poste.',
        h('div', null, h('button', { class: 'p-btn p-btn--primary p-btn--sm', type: 'button', disabled: !p?.available, onclick: (e) => testProvider('copilot-cli', e.currentTarget) }, P.icon('play'), 'Essayer Copilot CLI'))))

    return [h('div', { class: 'p-grid p-grid-aside' }, detection, P.card({ title: 'Procédure Copilot CLI', sub: 'Utile sur un poste sans VS Code, ou pour un serveur partagé.', icon: 'terminal', tone: 'teal', body: steps }))]
  }

  // ------------------------------------------------------------------ onglet Bac à sable

  function viewSandbox() {
    const sb = state.sandbox
    const providerSel = h('select', { class: 'p-select', onchange: () => { sb.provider = providerSel.value } },
      h('option', { value: 'auto' }, 'Automatique (ordre de priorité)'),
      state.status.order.map((id) => {
        const p = provider(id)
        return h('option', { value: id }, `${p.label}${p.available ? '' : ' — indisponible'}`)
      }))
    providerSel.value = sb.provider
    const purposeSel = h('select', { class: 'p-select', onchange: () => { sb.purpose = purposeSel.value } },
      [['chat', 'Discussion'], ['gherkin', 'Scénarios Gherkin'], ['diagnostic', 'Diagnostic'], ['k6', 'Script k6']].map(([v, t]) => h('option', { value: v }, t)))
    purposeSel.value = sb.purpose
    const system = h('textarea', { class: 'p-textarea', rows: 3, placeholder: 'Consignes facultatives, par exemple : Tu es un expert QA. Réponds en français.', oninput: () => { sb.system = system.value } })
    system.value = sb.system
    const prompt = h('textarea', { class: 'p-textarea', rows: 8, placeholder: 'Votre demande… (Ctrl+Entrée pour envoyer)', oninput: () => { sb.prompt = prompt.value } })
    prompt.value = sb.prompt
    const json = h('input', { type: 'checkbox', checked: sb.json, onchange: () => { sb.json = json.checked } })
    const send = h('button', { class: 'p-btn p-btn--primary', type: 'button', disabled: Boolean(sb.running), onclick: runSandbox }, P.icon('play'), 'Envoyer')
    prompt.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) runSandbox() })
    const examples = h('div', { class: 'p-row' }, [
      ['Scénario Gherkin', 'Rédige un scénario Gherkin en français pour : « En tant que client, je veux réinitialiser mon mot de passe par courriel ».'],
      ['Cas limites', 'Liste 5 cas limites à tester pour un champ « montant » acceptant de 0,01 à 10 000 €.'],
      ['JSON', 'Donne 3 jeux de données de test (nom, courriel, âge) pour un formulaire d’inscription.'],
    ].map(([t, text]) => h('button', { class: 'p-chip', type: 'button', onclick: () => {
      sb.prompt = text
      prompt.value = text
      if (t === 'JSON') { sb.json = true; json.checked = true }
      prompt.focus()
    } }, t)))

    const form = P.card({
      title: 'Demande',
      icon: 'edit',
      body: h('div', { class: 'p-stack', style: { gap: '12px' } },
        h('div', { class: 'p-form-grid' }, field('Fournisseur', providerSel), field('Usage', purposeSel)),
        field('Consignes (système)', system),
        field('Prompt', prompt),
        examples,
        h('div', { class: 'p-row p-row--between' }, h('label', { class: 'p-check' }, json, 'Réponse JSON stricte'), send)),
    })
    return [h('div', { class: 'p-grid p-grid-2' }, form, resultCard())]
  }

  function resultCard() {
    const sb = state.sandbox
    let body
    if (sb.running) {
      const elapsed = h('span', null, '0 s')
      const t0 = sb.running.startedAt
      const tick = setInterval(() => {
        if (!elapsed.isConnected) return clearInterval(tick)
        elapsed.textContent = P.fmtDuration(Date.now() - t0)
      }, 250)
      body = h('div', { class: 'ia-waiting' }, h('span', { class: 'p-spinner' }), h('span', null, 'Réponse en cours… ', elapsed),
        h('span', { class: 'p-spacer' }),
        h('button', { class: 'p-btn p-btn--sm p-btn--ghost', type: 'button', onclick: () => sb.running?.ctrl.abort() }, P.icon('stop'), 'Annuler'))
    } else if (sb.error) {
      body = P.banner('error', sb.error)
    } else if (!sb.result) {
      body = P.empty('Aucune réponse pour l’instant', 'Saisissez un prompt et envoyez-le : la réponse, le fournisseur et la durée s’affichent ici.', 'flask')
    } else if (sb.result.ok) {
      const r = sb.result
      body = [
        h('div', { class: 'ia-meta' }, P.badge(label(r.provider), 'mint'), r.model ? P.badge(r.model, 'outline') : null, P.badge(P.fmtDuration(r.durationMs), 'blue'),
          r.json !== undefined ? P.badge(r.json ? 'JSON valide' : 'JSON introuvable', r.json ? 'teal' : 'amber') : null,
          h('span', { class: 'p-spacer' }),
          h('button', { class: 'p-btn p-btn--sm', type: 'button', onclick: () => P.copy(r.text) }, P.icon('copy'), 'Copier')),
        h('pre', { class: 'p-code ia-answer' }, r.text),
      ]
    } else {
      const r = sb.result
      body = [
        P.banner('warn', [h('strong', null, 'Réponse manuelle requise. '), r.reason]),
        (r.attempts || []).length ? h('ul', { class: 'p-hint', style: { margin: 0, paddingLeft: '18px' } }, r.attempts.map((a) => h('li', null, `${label(a.provider)} : ${a.error}`))) : null,
        h('div', { class: 'p-row p-row--between' }, h('strong', null, 'Prompt à copier'),
          h('button', { class: 'p-btn p-btn--sm p-btn--primary', type: 'button', onclick: () => P.copy(r.prompt) }, P.icon('copy'), 'Copier le prompt')),
        h('pre', { class: 'p-code ia-answer' }, r.prompt),
      ]
    }
    return P.card({ title: 'Réponse', icon: 'bot', body: h('div', { class: 'p-stack', style: { gap: '10px' } }, body) })
  }

  async function runSandbox() {
    const sb = state.sandbox
    if (sb.running) return
    if (!sb.prompt.trim()) {
      P.toast('Saisissez d’abord un prompt', 'warn')
      return
    }
    const ctrl = new AbortController()
    sb.running = { ctrl, startedAt: Date.now() }
    sb.error = null
    renderPanel()
    try {
      const r = await P.api('/api/llm/chat', {
        body: {
          purpose: sb.purpose,
          system: sb.system,
          messages: [{ role: 'user', content: sb.prompt }],
          json: sb.json,
          provider: sb.provider === 'auto' ? undefined : sb.provider,
        },
        signal: ctrl.signal,
      })
      sb.result = r.result
    } catch (e) {
      sb.result = null
      sb.error = e.name === 'AbortError' ? 'Requête annulée.' : `L’appel a échoué : ${e.message}`
    } finally {
      sb.running = null
    }
    await refreshAudit().catch(() => {})
    renderKpis()
    updateTabs()
    if (state.tab === 'sandbox') renderPanel()
  }

  // ------------------------------------------------------------------ onglet Journal

  function viewAudit() {
    const { entries, stats } = state.audit
    const refresh = h('button', { class: 'p-btn p-btn--sm', type: 'button', onclick: (e) => P.busy(e.currentTarget, async () => {
      try { await refreshAudit(); updateTabs(); renderPanel() } catch (err) { fail(err, 'Lecture du journal impossible') }
    }) }, P.icon('refresh'), 'Actualiser')
    const body = entries.length
      ? h('table', { class: 'p-table' },
        h('thead', null, h('tr', null, ['Date', 'Fournisseur', 'Usage', 'Modèle', 'Durée', 'Résultat'].map((t) => h('th', null, t)))),
        h('tbody', null, entries.map((e) => h('tr', null,
          h('td', { class: 'p-nowrap' }, P.fmtDate(e.at)),
          h('td', null, label(e.provider)),
          h('td', null, e.purpose),
          h('td', null, e.model || '—'),
          h('td', { class: 'p-nowrap' }, P.fmtDuration(e.durationMs)),
          h('td', null, e.ok ? P.status('Réussi', 'mint') : P.status(e.code === 'timeout' ? 'Délai dépassé' : e.code === 'aborted' ? 'Annulé' : `Échec${e.code ? ` (${e.code})` : ''}`, 'red'))))))
      : P.empty('Aucun appel enregistré', 'Les appels à l’IA (essais, bac à sable, génération de scénarios…) apparaîtront ici.', 'listChecks')
    return P.card({
      title: 'Journal des appels',
      sub: stats?.total ? `${stats.total} appel(s) · ${stats.ok} réussi(s) · ${stats.failed} en échec. Ni prompt ni réponse ne sont conservés.` : 'Date, fournisseur, usage et durée de chaque appel — sans contenu ni secret.',
      icon: 'listChecks',
      actions: refresh,
      flush: Boolean(entries.length),
      body,
    })
  }

  // ------------------------------------------------------------------ démarrage

  function errorView(e) {
    P.clear(root).append(P.empty('Assistant IA indisponible', `Le serveur n’a pas pu fournir l’état des fournisseurs : ${e.message}`, 'alert',
      h('button', { class: 'p-btn p-btn--primary', type: 'button', onclick: start }, P.icon('refresh'), 'Réessayer')))
  }

  async function start() {
    try {
      await loadAll()
    } catch (e) {
      errorView(e)
      return
    }
    kpiHost = h('div', { class: 'p-kpis' })
    tabsHost = h('div')
    panel = h('div', { class: 'ia-panel' })
    P.clear(root).append(
      h('p', { class: 'p-page-intro' }, 'Choisissez l’IA qui rédige les scénarios Gherkin, les diagnostics et les scripts k6. Copilot local est utilisé en priorité dès que VS Code le relaie ; sinon, une API ou le mode copier-coller prend le relais.'),
      kpiHost, tabsHost, panel)
    renderKpis()
    tabsCtl = P.tabs(tabsHost, tabItems(), state.tab, (id) => { state.tab = id; history.replaceState(null, '', `#${id}`); renderPanel() })
    renderPanel()
  }

  document.addEventListener('visibilitychange', schedulePoll)

  P.whenShell().then(() => {
    root = document.getElementById('app')
    if (P.shell?.setActions) {
      P.shell.setActions(h('button', { class: 'p-btn', type: 'button', onclick: (e) => P.busy(e.currentTarget, async () => {
        try {
          await loadAll()
          renderKpis()
          updateTabs()
          renderPanel()
          P.toast('État de l’assistant IA actualisé')
        } catch (err) { fail(err, 'Actualisation impossible') }
      }) }, P.icon('refresh'), 'Actualiser'))
    }
    start()
  })
})()

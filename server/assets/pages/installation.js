/*
 * Installation du poste : choix des stacks, état des composants, installation suivie en direct,
 * historique, diagnostic IA et paramètres du plan (versions, miroirs, proxy).
 */
;(function () {
  'use strict'
  const P = window.Prisme
  const { h } = P

  const STACK_KEY = 'wizard-install-stacks'

  const STATE_UI = {
    ok: ['En place', 'mint'],
    missing: ['Manquant', 'red'],
    outdated: ['À mettre à jour', 'amber'],
    error: ['Erreur', 'red'],
    skipped: ['Ignoré', ''],
    unknown: ['Non vérifié', ''],
  }
  const STEP_UI = {
    pending: ['todo', 'En attente'],
    running: ['running', 'En cours'],
    ok: ['done', 'Déjà en place'],
    installed: ['done', 'Installé'],
    simulated: ['done', 'Simulé'],
    skipped: ['skipped', 'Ignoré'],
    failed: ['failed', 'Échec'],
    blocked: ['failed', 'Bloqué'],
    cancelled: ['failed', 'Annulé'],
  }
  const PHASE_UI = { detect: 'Détection…', install: 'Installation…', verify: 'Vérification…' }
  const RUN_UI = {
    running: ['En cours', 'blue'],
    succeeded: ['Réussie', 'mint'],
    partial: ['Avec avertissements', 'amber'],
    failed: ['Échec', 'red'],
    cancelled: ['Annulée', ''],
    interrupted: ['Interrompue', 'amber'],
  }
  const FAILED = new Set(['failed', 'blocked', 'cancelled'])

  const S = {
    user: null,
    plan: null,
    machine: null,
    canEdit: false,
    view: null,
    stacks: [],
    runs: [],
    activeRunId: null,
    tab: 'components',
    simulate: false,
    force: false,
    run: null,
    es: null,
    logs: [],
    logFilter: 'all',
    autoScroll: true,
    detecting: false,
  }

  const el = {}

  /* ---------------------------------------------------------------- utilitaires */

  function readStoredStacks() {
    try { return JSON.parse(localStorage.getItem(STACK_KEY) || 'null') } catch { return null }
  }

  function storeStacks() {
    try { localStorage.setItem(STACK_KEY, JSON.stringify(S.stacks)) } catch { /* navigation privée */ }
  }

  const isAdmin = () => S.user?.role === 'admin'
  const running = () => Boolean(S.activeRunId)
  const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`

  function stateStatus(state) {
    const [label, tone] = STATE_UI[state] || STATE_UI.unknown
    return P.status(label, tone)
  }

  function errorText(e) {
    return e?.message || String(e)
  }

  /* ---------------------------------------------------------------- données */

  async function loadState() {
    const q = S.stacks.length ? `?stacks=${encodeURIComponent(S.stacks.join(','))}` : ''
    const r = await P.api(`/api/install/state${q}`)
    S.view = r
    S.activeRunId = r.activeRunId
  }

  async function loadRuns() {
    const r = await P.api('/api/install/runs?limit=50')
    S.runs = r.runs
    S.activeRunId = r.activeRunId
  }

  async function detect(button) {
    if (S.detecting) return
    S.detecting = true
    renderSummary()
    try {
      await P.busy(button, async () => {
        const r = await P.api('/api/install/detect', { body: { stacks: S.stacks } })
        S.view = { ...S.view, ...r }
      })
      const n = requiredMissing().length
      P.toast(n ? `${plural(n, 'composant requis')} à installer.` : 'Poste prêt : tous les composants requis sont en place.', n ? 'warn' : 'ok')
    } catch (e) {
      P.toast(`Vérification impossible : ${errorText(e)}`, 'error')
    } finally {
      S.detecting = false
      renderAll()
      P.shell?.refreshStrip?.()
    }
  }

  function requiredMissing() {
    return (S.view?.components || []).filter((c) => c.required && c.state !== 'ok')
  }

  /* ---------------------------------------------------------------- lancement */

  async function confirmAndRun({ components = null, force = S.force } = {}) {
    if (running()) {
      P.toast('Une installation est déjà en cours.', 'warn')
      return
    }
    let preview
    try {
      preview = await P.api('/api/install/preview', { body: { stacks: S.stacks, components, force } })
    } catch (e) {
      P.toast(`Aperçu impossible : ${errorText(e)}`, 'error')
      return
    }
    const simulate = S.simulate || !isAdmin() || S.machine?.dryForced
    const todo = preview.components.filter((c) => c.action === 'install' || c.action === 'check')
    const body = h('div', { class: 'p-stack' },
      P.banner(simulate ? 'blue' : 'warn', simulate
        ? 'Mode simulation : chaque commande sera affichée dans le journal, rien ne sera installé ni modifié.'
        : `L'installation s'exécute sur la machine qui héberge Wizard QA (${preview.host}), pour le compte qui a lancé le serveur.`),
      h('p', { class: 'p-muted', style: { margin: 0 } }, todo.length
        ? `${plural(todo.length, 'composant')} à installer ou à vérifier ; les autres sont déjà en place et ne seront pas refaits.`
        : 'Tout est déjà en place d\'après la dernière vérification : le run confirmera simplement l\'état du poste.'),
      h('div', { class: 'inst-preview-list' }, preview.components.map(previewRow)))
    P.modal({
      title: components ? 'Installer ce composant' : 'Installer tout',
      wide: true,
      body,
      actions: [
        { label: 'Annuler', kind: 'ghost' },
        { label: simulate ? 'Lancer la simulation' : 'Lancer l\'installation', kind: 'primary', icon: 'play', onClick: () => launch({ components, force, dryRun: simulate }) },
      ],
    })
  }

  function previewRow(c) {
    const action = {
      install: P.badge('À installer', 'amber'),
      check: P.badge('À vérifier puis installer', 'blue'),
      skip: P.badge('Déjà en place', 'mint'),
      detect: P.badge('Détection seule', 'outline'),
    }[c.action]
    return h('div', { class: 'inst-preview-row' },
      h('div', { class: 'p-row' },
        h('span', null, h('b', null, c.label), ' ', c.required ? null : h('span', { class: 'p-faint' }, '(optionnel)')),
        action),
      c.commands?.length ? h('ul', { class: 'inst-cmds' }, c.commands.map((cmd) => h('li', null, cmd))) : null)
  }

  async function launch({ components, force, dryRun }) {
    try {
      const r = await P.api('/api/install/runs', { body: { stacks: S.stacks, components, force, dryRun } })
      S.activeRunId = r.runId
      P.toast(r.dryRun ? 'Simulation lancée.' : 'Installation lancée.')
      attachRun(r.runId)
      renderAll()
      el.runPanel.scrollIntoView({ behavior: 'smooth', block: 'start' })
    } catch (e) {
      P.toast(errorText(e), 'error', 7000)
    }
  }

  async function cancelRun(button) {
    if (!S.run) return
    const yes = await P.confirm('Arrêter l\'installation en cours ? Le processus en cours est interrompu ; ce qui est déjà installé est conservé.', { okLabel: 'Arrêter', danger: true })
    if (!yes) return
    await P.busy(button, () => P.api(`/api/install/runs/${S.run.id}/cancel`, { body: {} })).catch((e) => P.toast(errorText(e), 'error'))
  }

  /* ---------------------------------------------------------------- suivi en direct */

  function attachRun(id) {
    if (S.es) S.es.close()
    S.run = { id, status: 'running', components: [], stacks: S.stacks, journal: [] }
    S.logs = []
    S.logFilter = 'all'
    S.es = P.stream(`/api/install/runs/${encodeURIComponent(id)}/events`, {
      snapshot: (run) => {
        S.run = run
        S.logs = logsFromRun(run)
        renderRunPanel()
      },
      step: (c) => {
        const i = S.run.components.findIndex((x) => x.id === c.id)
        if (i >= 0) S.run.components[i] = { ...S.run.components[i], ...c }
        updateRunProgress()
      },
      log: (entry) => appendLog(entry.componentId, entry.line),
      done: (d) => onRunDone(d),
    }, (e, es) => {
      // Flux définitivement fermé (serveur redémarré, session expirée) : on relit l'état réel du run.
      if (es.readyState === 2 && S.es === es) recoverRun(id)
    })
  }

  async function recoverRun(id) {
    S.es = null
    try {
      const r = await P.api(`/api/install/runs/${encodeURIComponent(id)}`)
      if (r.run.status === 'running') {
        setTimeout(() => attachRun(id), 2000)
        return
      }
      await onRunDone({ id, status: r.run.status, summary: r.run.summary, finalCheck: r.run.finalCheck, dryRun: r.run.dryRun })
    } catch (e) {
      S.activeRunId = null
      P.toast(`Suivi en direct interrompu : ${errorText(e)}. Rechargez la page pour revoir l'état.`, 'error', 8000)
      renderAll()
    }
  }

  function logsFromRun(run) {
    const journal = run.journal || []
    return [
      ...journal.slice(0, 1).map((line) => ({ id: null, line })),
      ...run.components.flatMap((c) => (c.log || []).map((line) => ({ id: c.id, line }))),
      ...journal.slice(1).map((line) => ({ id: null, line })),
    ]
  }

  async function onRunDone(d) {
    if (S.es) {
      S.es.close()
      S.es = null
    }
    S.activeRunId = null
    if (S.run) Object.assign(S.run, { status: d.status, summary: d.summary, finalCheck: d.finalCheck })
    try {
      const r = await P.api(`/api/install/runs/${encodeURIComponent(d.id)}`)
      S.run = r.run
      S.logs = logsFromRun(r.run)
    } catch { /* l'instantané suffit */ }
    await Promise.all([loadState(), loadRuns()]).catch(() => {})
    const [label] = RUN_UI[d.status] || [d.status]
    P.toast(`${d.dryRun ? 'Simulation' : 'Installation'} terminée : ${label.toLowerCase()}.`, d.status === 'succeeded' ? 'ok' : d.status === 'failed' ? 'error' : 'warn')
    renderAll()
    renderRunPanel()
    P.shell?.refreshStrip?.()
  }

  async function openRun(id, scroll = true) {
    try {
      if (id === S.activeRunId) attachRun(id)
      else {
        if (S.es) { S.es.close(); S.es = null }
        const r = await P.api(`/api/install/runs/${encodeURIComponent(id)}`)
        S.run = r.run
        S.logs = logsFromRun(r.run)
        S.logFilter = 'all'
      }
      renderRunPanel()
      if (scroll) el.runPanel.scrollIntoView({ behavior: 'smooth', block: 'start' })
    } catch (e) {
      P.toast(errorText(e), 'error')
    }
  }

  /* ---------------------------------------------------------------- diagnostic IA */

  async function diagnose(componentId, button) {
    try {
      const r = await P.busy(button, () => P.api(`/api/install/runs/${encodeURIComponent(S.run.id)}/diagnose`, { body: { componentId } }))
      const comp = S.run.components.find((c) => c.id === componentId)
      if (r.manual) {
        P.modal({
          title: `Diagnostic — ${comp?.label || componentId}`,
          wide: true,
          body: h('div', { class: 'p-stack' },
            P.banner('warn', `${r.reason || 'Aucun assistant IA disponible.'} Copiez ce prompt dans Copilot Chat (ou un autre assistant), puis appliquez sa réponse.`),
            h('pre', { class: 'p-code inst-diag' }, r.prompt)),
          actions: [
            { label: 'Fermer', kind: 'ghost' },
            { label: 'Copier le prompt', kind: 'primary', icon: 'copy', onClick: () => { P.copy(r.prompt); return false } },
          ],
        })
        return
      }
      P.modal({
        title: `Diagnostic — ${comp?.label || componentId}`,
        wide: true,
        body: h('div', { class: 'p-stack' },
          h('div', { class: 'p-faint' }, `Proposé par ${r.provider}${r.model ? ` (${r.model})` : ''}${r.durationMs ? ` en ${P.fmtDuration(r.durationMs)}` : ''}. Vérifiez chaque commande avant de l'exécuter.`),
          h('pre', { class: 'p-code inst-diag' }, r.text)),
        actions: [
          { label: 'Copier', kind: 'ghost', icon: 'copy', onClick: () => { P.copy(r.text); return false } },
          { label: 'Relancer ce composant', kind: 'primary', icon: 'refresh', onClick: () => { confirmAndRun({ components: [componentId] }) } },
        ],
      })
    } catch (e) {
      P.toast(`Diagnostic impossible : ${errorText(e)}`, 'error')
    }
  }

  /* ---------------------------------------------------------------- rendu : en-tête et synthèse */

  function renderActions() {
    const verify = h('button', { class: 'p-btn', type: 'button', onclick: (e) => detect(e.currentTarget), disabled: S.detecting }, P.icon('refresh'), 'Tout vérifier')
    const all = h('button', { class: 'p-btn p-btn--primary', type: 'button', onclick: () => confirmAndRun(), disabled: running() }, P.icon('download'), 'Installer tout')
    P.shell?.setActions?.(verify, all)
  }

  function renderMachine() {
    const m = S.machine
    P.clear(el.machine).appendChild(P.banner('blue', h('span', null,
      'L\'installation s\'effectue sur ', h('b', null, 'la machine qui exécute Wizard QA'),
      m ? ` : ${m.host} (${m.platform}, ${m.arch}). Outils portables dans ${m.toolsRoot}, projet de test dans ${m.repoRoot}.` : '.',
      S.machine?.dryForced ? ' Mode simulation imposé par WIZARD_INSTALL_DRY=1.' : '',
      !isAdmin() ? ' Votre compte n\'est pas administrateur : seule la simulation est possible.' : ''), 'monitor'))
  }

  function renderSummary() {
    const comps = S.view?.components || []
    const req = comps.filter((c) => c.required)
    const opt = comps.filter((c) => !c.required)
    const reqOk = req.filter((c) => c.state === 'ok').length
    const optOk = opt.filter((c) => c.state === 'ok').length
    const toInstall = comps.filter((c) => !c.detectOnly && ['missing', 'outdated', 'error'].includes(c.state)).length
    const lastRun = S.runs[0]
    P.clear(el.summary)

    let banner
    if (S.detecting) banner = P.banner('blue', h('span', null, h('span', { class: 'p-spinner' }), ' Vérification de chaque composant en cours…'))
    else if (running()) banner = P.banner('blue', 'Une installation est en cours : suivez-la ci-dessous.', 'activity')
    else if (!S.view?.detectedAt) banner = P.banner('blue', h('span', null, 'L\'état du poste n\'a pas encore été vérifié. ', h('button', { class: 'p-btn p-btn--sm', type: 'button', onclick: (e) => detect(e.currentTarget) }, 'Vérifier maintenant')))
    else if (S.view.ready) banner = P.banner('info', h('span', null, h('b', null, 'Poste prêt. '), `Les ${req.length} composants requis des stacks choisies sont en place.`), 'checkCircle')
    else {
      const missing = requiredMissing()
      banner = P.banner('warn', h('span', null,
        h('b', null, `${plural(missing.length, 'composant requis')} à installer : `), missing.map((c) => c.label).join(', '), '. ',
        h('button', { class: 'p-btn p-btn--sm p-btn--primary', type: 'button', onclick: () => confirmAndRun(), disabled: running() }, 'Installer tout')))
    }
    el.summary.appendChild(banner)
    el.summary.appendChild(h('div', { class: 'p-kpis' },
      P.kpi({ label: 'Requis en place', value: `${reqOk}/${req.length}`, tone: req.length && reqOk === req.length ? 'mint' : 'amber', detail: 'stacks choisies' }),
      P.kpi({ label: 'À installer', value: toInstall, tone: toInstall ? 'amber' : 'mint', detail: 'manquants ou à mettre à jour' }),
      P.kpi({ label: 'Optionnels en place', value: `${optOk}/${opt.length}`, detail: 'Git, Python, Java, extensions…' }),
      P.kpi({
        label: 'Dernière vérification',
        value: S.view?.detectedAt ? P.fmtAgo(S.view.detectedAt) : '—',
        detail: lastRun ? `Dernier run : ${(RUN_UI[lastRun.status] || [lastRun.status])[0].toLowerCase()}${lastRun.dryRun ? ' (simulation)' : ''}` : 'Aucun run',
      })))
  }

  /* ---------------------------------------------------------------- rendu : stacks */

  function toggleStack(id) {
    const has = S.stacks.includes(id)
    if (has && S.stacks.length === 1) {
      P.toast('Gardez au moins une stack.', 'warn')
      return
    }
    S.stacks = has ? S.stacks.filter((s) => s !== id) : Object.keys(S.plan.stacks).filter((s) => s === id || S.stacks.includes(s))
    storeStacks()
    renderStacks()
    loadState().then(renderAll).catch((e) => P.toast(errorText(e), 'error'))
  }

  function renderStacks() {
    const cards = Object.entries(S.plan.stacks).map(([id, s]) => {
      const active = S.stacks.includes(id)
      return h('button', {
        class: `inst-stack ${active ? 'active' : ''}`,
        type: 'button',
        'aria-pressed': active ? 'true' : 'false',
        disabled: running(),
        onclick: () => toggleStack(id),
      },
      h('span', { class: 'p-tile' }, P.icon(s.icon || 'package')),
      h('span', { class: 'inst-stack-body' },
        h('span', { class: 'inst-stack-title' }, s.label),
        h('span', { class: 'inst-stack-desc' }, s.description),
        h('span', { class: 'inst-stack-meta' }, `${plural(s.components.length, 'composant')} + socle commun`)),
      h('span', { class: 'inst-stack-check' }, active ? P.icon('check') : null))
    })
    const lockedSim = !isAdmin() || S.machine?.dryForced
    const options = h('div', { class: 'p-row inst-options' },
      h('label', { class: 'p-check', title: 'Déroule tout le plan en affichant les commandes, sans rien installer.' },
        h('input', { type: 'checkbox', checked: S.simulate || lockedSim, disabled: lockedSim, onchange: (e) => { S.simulate = e.target.checked } }),
        'Simulation (rien n\'est installé)'),
      h('label', { class: 'p-check', title: 'Réinstalle même ce qui est déjà en place.' },
        h('input', { type: 'checkbox', checked: S.force, onchange: (e) => { S.force = e.target.checked } }),
        'Forcer la réinstallation'),
      h('span', { class: 'p-faint' }, 'Le socle (Node, npm, .npmrc, Git, projet de test) est toujours inclus.'))
    P.clear(el.stacks).appendChild(P.card({
      title: 'Stacks à installer',
      sub: 'Cochez les outils dont l\'équipe a besoin : seuls leurs composants sont installés.',
      icon: 'layers',
      body: [h('div', { class: 'inst-stacks' }, cards), options],
    }))
  }

  /* ---------------------------------------------------------------- rendu : run */

  function runProgress(run) {
    const total = run.components.length
    const done = run.components.filter((c) => !['pending', 'running'].includes(c.state)).length
    return { total, done, pct: total ? Math.round((done / total) * 100) : 0 }
  }

  function stepsFor(run) {
    return run.components.map((c) => {
      const [state, label] = STEP_UI[c.state] || STEP_UI.pending
      return {
        label: c.label,
        sub: c.state === 'running' ? PHASE_UI[c.phase] || 'En cours' : c.version && ['ok', 'installed'].includes(c.state) ? `${label} · ${c.version}` : label,
        state: state === 'running' ? 'running current' : state,
        onClick: () => { S.logFilter = c.id; renderLog() },
      }
    })
  }

  function updateRunProgress() {
    if (!el.runSteps || !S.run) return renderRunPanel()
    const p = runProgress(S.run)
    el.runMeter.style.width = `${p.pct}%`
    el.runCount.textContent = `${p.done}/${p.total} composants`
    P.clear(el.runSteps).appendChild(P.stepper(stepsFor(S.run)))
    const cur = el.runSteps.querySelector('.p-step.running')
    if (cur) cur.scrollIntoView({ block: 'nearest', inline: 'center' })
  }

  function finalBanner(run) {
    const s = run.summary || {}
    const parts = []
    if (s.installed) parts.push(`${s.installed} installé${s.installed > 1 ? 's' : ''}`)
    if (s.simulated) parts.push(`${s.simulated} simulé${s.simulated > 1 ? 's' : ''}`)
    if (s.ok) parts.push(`${s.ok} déjà en place`)
    if (s.skipped) parts.push(`${s.skipped} ignoré${s.skipped > 1 ? 's' : ''}`)
    const bad = (s.failed || 0) + (s.blocked || 0)
    if (bad) parts.push(`${bad} en échec ou bloqué${bad > 1 ? 's' : ''}`)
    const text = parts.join(', ') || 'aucun composant traité'
    const final = run.finalCheck
    const finalText = final ? (final.ready ? ' Vérification finale : poste prêt.' : ` Vérification finale : ${final.notOk.map((c) => c.label).join(', ')} encore à corriger.`) : ''
    const sim = run.dryRun ? ' Simulation : rien n\'a été modifié sur la machine.' : ''
    const kind = { succeeded: 'info', partial: 'warn', failed: 'error', cancelled: 'warn', interrupted: 'warn' }[run.status] || 'blue'
    const title = { succeeded: 'Installation réussie', partial: 'Installation terminée avec avertissements', failed: 'Installation en échec', cancelled: 'Installation annulée', interrupted: 'Installation interrompue (serveur arrêté)' }[run.status] || 'Installation'
    return P.banner(kind, h('span', null, h('b', null, `${run.dryRun ? title.replace('Installation', 'Simulation') : title}. `), `${text}.${finalText}${sim}`))
  }

  function renderRunPanel() {
    const run = S.run
    P.clear(el.runPanel)
    el.runSteps = null
    if (!run) return
    const live = run.status === 'running'
    const p = runProgress(run)
    el.runMeter = h('div', { class: `p-meter-fill ${run.status === 'failed' ? 'red' : ''}`, style: { width: `${p.pct}%` } })
    el.runCount = h('span', { class: 'inst-run-count' }, `${p.done}/${p.total} composants`)
    el.runSteps = h('div', null, P.stepper(stepsFor(run)))
    const failures = run.components.filter((c) => FAILED.has(c.state) && c.state !== 'cancelled')
    el.logFilterSelect = h('select', { class: 'p-select', 'aria-label': 'Filtrer le journal', onchange: (e) => { S.logFilter = e.target.value; renderLog() } },
      h('option', { value: 'all' }, 'Tout le journal'),
      run.components.map((c) => h('option', { value: c.id }, c.label)))
    el.log = h('pre', { class: 'p-log inst-log', 'aria-live': 'polite' })
    const actions = h('div', { class: 'p-row' },
      live ? h('button', { class: 'p-btn p-btn--danger p-btn--sm', type: 'button', onclick: (e) => cancelRun(e.currentTarget) }, P.icon('stop'), 'Arrêter') : null,
      h('a', { class: 'p-btn p-btn--sm', href: `/api/install/runs/${encodeURIComponent(run.id)}/log`, download: '' }, P.icon('download'), 'Journal'),
      !live ? h('button', { class: 'p-icon-btn', type: 'button', 'aria-label': 'Fermer', onclick: () => { S.run = null; renderRunPanel() } }, P.icon('x')) : null)
    const body = [
      h('div', { class: 'inst-run-head' }, h('div', { class: 'p-meter' }, el.runMeter), el.runCount),
      el.runSteps,
      !live ? h('div', { style: { marginTop: '12px' } }, finalBanner(run)) : null,
      failures.length ? h('div', { class: 'inst-failures' }, failures.map((c) => h('div', { class: 'inst-failure' },
        P.icon('xCircle', 16),
        h('div', null, h('b', null, c.label), ' — ', c.message || 'échec'),
        c.state === 'failed' ? h('button', { class: 'p-btn p-btn--sm', type: 'button', onclick: (e) => diagnose(c.id, e.currentTarget) }, P.icon('sparkles'), 'Diagnostic IA') : null,
        c.state === 'failed' && !live ? h('button', { class: 'p-btn p-btn--sm', type: 'button', onclick: () => confirmAndRun({ components: [c.id] }) }, P.icon('refresh'), 'Relancer') : null))) : null,
      h('div', { class: 'inst-log-toolbar' },
        h('span', { class: 'p-section-label' }, 'Console'),
        el.logFilterSelect,
        h('label', { class: 'p-check' }, h('input', { type: 'checkbox', checked: S.autoScroll, onchange: (e) => { S.autoScroll = e.target.checked } }), 'Défilement automatique'),
        h('span', { class: 'p-spacer' }),
        h('button', { class: 'p-btn p-btn--ghost p-btn--sm', type: 'button', onclick: () => P.copy(visibleLogs().map((l) => l.line).join('\n')) }, P.icon('copy'), 'Copier')),
      el.log,
    ]
    const sub = `${run.stacks?.join(', ') || ''}${run.dryRun ? ' · simulation' : ''}${run.startedAt ? ` · lancé ${P.fmtDate(run.startedAt)}` : ''}${run.user ? ` par ${run.user}` : ''}`
    el.runPanel.appendChild(P.card({
      title: live ? (run.dryRun ? 'Simulation en cours' : 'Installation en cours') : `Installation du ${P.fmtDate(run.startedAt)}`,
      sub,
      icon: live ? 'activity' : 'terminal',
      tone: run.status === 'failed' ? 'red' : '',
      actions,
      body,
    }))
    renderLog()
  }

  function visibleLogs() {
    return S.logFilter === 'all' ? S.logs : S.logs.filter((l) => l.id === S.logFilter)
  }

  function logClass(line) {
    if (/^\$ /.test(line)) return 'cmd'
    if (/\[erreur\]|^npm (ERR|error)|ERR!|échou|impossible|introuvable/i.test(line)) return 'err'
    if (/\[simulation\]|^npm warn|avertissement/i.test(line)) return 'warn'
    if (/^Vérification : ok|Déjà en place|vérifiée|Installé dans|Terminé : succeeded/i.test(line)) return 'ok'
    return ''
  }

  function logNode(entry) {
    const prefix = entry.id && S.logFilter === 'all' ? `[${entry.id}] ` : ''
    const cls = logClass(entry.line)
    return [cls ? h('span', { class: cls }, prefix + entry.line) : document.createTextNode(prefix + entry.line), '\n']
  }

  function renderLog() {
    if (!el.log) return
    if (el.logFilterSelect) el.logFilterSelect.value = S.logFilter
    P.clear(el.log)
    const list = visibleLogs()
    if (!list.length) el.log.appendChild(document.createTextNode(S.run?.status === 'running' ? 'En attente des premières lignes…' : '(journal vide)'))
    P.append(el.log, list.slice(-2500).map(logNode))
    if (S.autoScroll) el.log.scrollTop = el.log.scrollHeight
  }

  function appendLog(id, line) {
    const entry = { id, line }
    S.logs.push(entry)
    if (S.logs.length > 8000) S.logs.splice(0, 2000)
    if (!el.log || (S.logFilter !== 'all' && S.logFilter !== id)) return
    if (el.log.firstChild && !el.log.querySelector('span') && /En attente/.test(el.log.textContent)) P.clear(el.log)
    P.append(el.log, logNode(entry))
    if (S.autoScroll) el.log.scrollTop = el.log.scrollHeight
  }

  /* ---------------------------------------------------------------- rendu : onglets */

  function renderTabs() {
    const comps = S.view?.components || []
    const bad = comps.filter((c) => c.required && c.state !== 'ok' && c.state !== 'unknown').length
    const items = [
      { id: 'components', label: 'Composants', icon: 'package', count: comps.length, tone: bad ? 'red' : '' },
      { id: 'history', label: 'Historique', icon: 'clock', count: S.runs.length },
      { id: 'settings', label: 'Paramètres', icon: 'settings' },
    ]
    P.tabs(P.clear(el.tabs), items, S.tab, (id) => { S.tab = id; renderTabBody() })
  }

  function renderTabBody() {
    P.clear(el.tabBody)
    if (S.tab === 'components') el.tabBody.appendChild(componentsTable())
    else if (S.tab === 'history') el.tabBody.appendChild(historyTable())
    else el.tabBody.appendChild(settingsForm())
  }

  function componentsTable() {
    const comps = S.view?.components || []
    if (!comps.length) return P.card({ body: P.empty('Aucun composant', 'Choisissez au moins une stack.', 'package') })
    const rows = comps.map((c) => {
      const stacks = c.stacks.map((s) => P.badge(s === 'socle' ? 'Socle' : S.plan.stacks[s]?.label || s, s === 'socle' ? 'outline' : 'teal'))
      let action
      if (c.detectOnly) action = h('span', { class: 'p-faint' }, 'Détection seule')
      else {
        const reinstall = c.state === 'ok'
        action = h('button', {
          class: `p-btn p-btn--sm ${reinstall ? 'p-btn--ghost' : ''}`,
          type: 'button',
          disabled: running(),
          onclick: () => confirmAndRun({ components: [c.id], force: reinstall }),
        }, P.icon(reinstall ? 'refresh' : 'download'), reinstall ? 'Réinstaller' : 'Installer')
      }
      return h('tr', { class: c.required && ['missing', 'error'].includes(c.state) ? 'critical' : c.state === 'outdated' ? 'warning' : '' },
        h('td', null, stateStatus(c.state)),
        h('td', { class: 'inst-label' }, h('b', null, c.label), h('span', null, c.description)),
        h('td', null, stacks),
        h('td', { class: 'p-mono' }, c.version || '—'),
        h('td', { class: 'p-mono p-faint' }, c.expected || '—'),
        h('td', null, c.required ? P.badge('Requis', 'mint') : P.badge('Optionnel', 'outline')),
        h('td', { class: 'inst-msg' }, c.message || ''),
        h('td', { class: 'num' }, action))
    })
    const sub = S.view?.detectedAt ? `Vérifié ${P.fmtAgo(S.view.detectedAt)} · ordre d'installation (dépendances d'abord)` : 'Pas encore vérifié'
    return P.card({
      title: 'Composants',
      sub,
      icon: 'listChecks',
      flush: true,
      actions: h('button', { class: 'p-btn p-btn--sm', type: 'button', onclick: (e) => detect(e.currentTarget), disabled: S.detecting }, P.icon('refresh'), 'Vérifier'),
      body: h('div', { style: { overflowX: 'auto' } }, h('table', { class: 'p-table inst-table' },
        h('thead', null, h('tr', null, ['État', 'Composant', 'Stack', 'Trouvé', 'Attendu', 'Type', 'Détail', ''].map((t) => h('th', null, t)))),
        h('tbody', null, rows))),
    })
  }

  function historyTable() {
    if (!S.runs.length) {
      return P.card({ body: P.empty('Aucune installation', 'Lancez « Installer tout » (ou une simulation) : chaque run est journalisé ici.', 'clock',
        h('button', { class: 'p-btn p-btn--primary', type: 'button', onclick: () => confirmAndRun() }, P.icon('download'), 'Installer tout')) })
    }
    const rows = S.runs.map((r) => {
      const [label, tone] = RUN_UI[r.status] || [r.status, '']
      const s = r.summary || {}
      const bad = (s.failed || 0) + (s.blocked || 0)
      const text = r.summary
        ? [s.installed && `${s.installed} installé(s)`, s.simulated && `${s.simulated} simulé(s)`, s.ok && `${s.ok} en place`, bad && `${bad} en échec`].filter(Boolean).join(' · ')
        : '—'
      return h('tr', { class: `clickable ${S.run?.id === r.id ? 'selected' : ''}`, onclick: () => openRun(r.id) },
        h('td', { class: 'p-nowrap' }, P.fmtDate(r.startedAt)),
        h('td', null, P.badge(label, tone), r.dryRun ? P.badge('Simulation', 'purple') : null, r.force ? P.badge('Forcé', 'outline') : null),
        h('td', null, r.requested?.length ? `Composant : ${r.requested.join(', ')}` : (r.stacks || []).map((x) => S.plan.stacks[x]?.label || x).join(', ')),
        h('td', null, text),
        h('td', { class: 'num p-nowrap' }, P.fmtDuration(r.durationMs)),
        h('td', null, r.user || '—'),
        h('td', { class: 'num' }, h('a', { class: 'p-btn p-btn--ghost p-btn--sm', href: `/api/install/runs/${encodeURIComponent(r.id)}/log`, download: '', onclick: (e) => e.stopPropagation() }, P.icon('download'), 'Journal')))
    })
    return P.card({
      title: 'Historique des installations',
      sub: 'Cliquez sur une ligne pour revoir les étapes, la console et demander un diagnostic.',
      icon: 'clock',
      flush: true,
      body: h('div', { style: { overflowX: 'auto' } }, h('table', { class: 'p-table' },
        h('thead', null, h('tr', null, ['Date', 'Statut', 'Périmètre', 'Résultat', 'Durée', 'Par', ''].map((t) => h('th', { class: t === 'Durée' ? 'num' : '' }, t)))),
        h('tbody', null, rows))),
    })
  }

  /* ---------------------------------------------------------------- rendu : paramètres */

  const VERSION_LABELS = {
    node: 'Node portable (si aucun Node compatible)',
    nodeMinMajor: 'Version majeure minimale de Node',
    playwright: '@playwright/test',
    dotenv: 'dotenv',
    playwrightBdd: 'playwright-bdd',
    typesK6: '@types/k6',
    k6: 'k6 (binaire)',
    copilotCli: '@github/copilot',
  }
  const MIRROR_LABELS = {
    node: ['Miroir Node.js', 'Doit contenir v<version>/SHASUMS256.txt'],
    k6: ['Miroir k6', 'Doit contenir v<version>/k6-v<version>-checksums.txt'],
    playwrightDownloadHost: ['Miroir des navigateurs Playwright', 'PLAYWRIGHT_DOWNLOAD_HOST ; vide = CDN Microsoft'],
    npmRegistry: ['Registre npm', 'Écrit dans .npmrc ; vide = registre actuel conservé'],
  }

  function field(label, input, hint, span) {
    return h('div', { class: `p-field ${span ? 'span-2' : ''}` }, h('label', null, label), input, hint ? h('div', { class: 'p-hint' }, hint) : null)
  }

  function settingsForm() {
    const plan = S.plan
    const ro = !S.canEdit
    const inputs = { versions: {}, mirrors: {}, proxy: {}, ext: {}, req: {}, browsers: {}, stacks: {} }
    const text = (value, attrs = {}) => h('input', { class: 'p-input', value: value ?? '', disabled: ro, ...attrs })
    const check = (checked, label, store) => {
      const input = h('input', { type: 'checkbox', checked: Boolean(checked), disabled: ro })
      if (store) store(input)
      return h('label', { class: 'p-check' }, input, label)
    }

    const versions = Object.keys(plan.versions).map((k) => {
      inputs.versions[k] = text(plan.versions[k], { inputmode: k === 'nodeMinMajor' ? 'numeric' : null })
      return field(VERSION_LABELS[k] || k, inputs.versions[k])
    })
    const mirrors = Object.keys(plan.mirrors).map((k) => {
      inputs.mirrors[k] = text(plan.mirrors[k], { placeholder: 'https://…' })
      const [label, hint] = MIRROR_LABELS[k] || [k, '']
      return field(label, inputs.mirrors[k], hint)
    })
    inputs.proxy.http = text(plan.proxy.http, { placeholder: 'http://proxy.entreprise:8080', autocomplete: 'off' })
    inputs.proxy.https = text(plan.proxy.https, { placeholder: 'identique au proxy HTTP si vide', autocomplete: 'off' })
    inputs.proxy.noProxy = text(plan.proxy.noProxy)
    inputs.proxy.caFile = text(plan.proxy.caFile, { placeholder: 'C:\\certificats\\entreprise.pem' })
    const sslCheck = check(plan.proxy.strictSsl !== false, 'Vérifier les certificats SSL (recommandé)', (i) => { inputs.proxy.strictSsl = i })

    const browserChecks = ['chromium', 'firefox', 'webkit'].map((b) => check(plan.options.browsers.includes(b), b, (i) => { inputs.browsers[b] = i }))
    const stackChecks = Object.entries(plan.stacks).map(([id, s]) => check(plan.selectedStacks.includes(id), s.label, (i) => { inputs.stacks[id] = i }))
    const pathCheck = check(plan.options.addToUserPath, 'Ajouter les outils portables au PATH utilisateur', (i) => { inputs.addToUserPath = i })
    const wingetCheck = check(plan.options.useWinget, 'Utiliser winget en repli (Git, k6)', (i) => { inputs.useWinget = i })
    inputs.vscodeCli = text(plan.options.vscodeCli, { placeholder: 'détection automatique (code / code.cmd)' })
    const extFields = Object.entries(plan.stacks).map(([id, s]) => {
      inputs.ext[id] = text((plan.options.vscodeExtensions[id] || []).join(', '))
      return field(`Extensions — ${s.label}`, inputs.ext[id], 'Identifiants séparés par des virgules')
    })
    const reqChecks = Object.entries(plan.components).map(([id, c]) => check(c.required, c.label, (i) => { inputs.req[id] = i }))

    const collect = () => ({
      selectedStacks: Object.keys(inputs.stacks).filter((id) => inputs.stacks[id].checked),
      versions: Object.fromEntries(Object.entries(inputs.versions).map(([k, i]) => [k, i.value.trim()])),
      mirrors: Object.fromEntries(Object.entries(inputs.mirrors).map(([k, i]) => [k, i.value.trim()])),
      proxy: {
        http: inputs.proxy.http.value.trim(),
        https: inputs.proxy.https.value.trim(),
        noProxy: inputs.proxy.noProxy.value.trim(),
        caFile: inputs.proxy.caFile.value.trim(),
        strictSsl: inputs.proxy.strictSsl.checked,
      },
      options: {
        browsers: Object.keys(inputs.browsers).filter((b) => inputs.browsers[b].checked),
        addToUserPath: inputs.addToUserPath.checked,
        useWinget: inputs.useWinget.checked,
        vscodeCli: inputs.vscodeCli.value.trim(),
        vscodeExtensions: Object.fromEntries(Object.entries(inputs.ext).map(([k, i]) => [k, i.value])),
      },
      components: Object.fromEntries(Object.entries(inputs.req).map(([k, i]) => [k, { required: i.checked }])),
    })

    const save = async (button) => {
      try {
        const r = await P.busy(button, () => P.api('/api/install/settings', { method: 'PUT', body: collect() }))
        S.plan = r.plan
        P.toast('Paramètres enregistrés. Relancez « Tout vérifier » pour en tenir compte.')
        await loadState()
        renderAll({ settings: true })
      } catch (e) {
        P.toast(errorText(e), 'error', 8000)
      }
    }
    const reset = async (button) => {
      if (!(await P.confirm('Revenir au plan de référence (versions, miroirs, proxy et options) ?', { okLabel: 'Réinitialiser', danger: true }))) return
      try {
        const r = await P.busy(button, () => P.api('/api/install/settings/reset', { body: {} }))
        S.plan = r.plan
        P.toast('Plan de référence restauré.')
        await loadState().catch(() => {})
        renderAll({ settings: true })
      } catch (e) {
        P.toast(errorText(e), 'error')
      }
    }

    const m = S.machine || {}
    const section = (label, ...content) => h('div', { class: 'inst-settings-section' }, h('span', { class: 'p-section-label' }, label), ...content)
    const body = [
      ro ? P.banner('warn', 'Lecture seule : seul un administrateur peut modifier le plan d\'installation.', 'lock') : null,
      section('Stacks proposées par défaut', h('div', { class: 'p-row' }, stackChecks)),
      section('Versions épinglées', h('div', { class: 'p-form-grid' }, versions)),
      section('Miroirs (réseau d\'entreprise)', h('div', { class: 'p-form-grid' }, mirrors)),
      section('Proxy et certificats',
        h('div', { class: 'p-form-grid' },
          field('Proxy HTTP', inputs.proxy.http, 'Le mot de passe éventuel est masqué à l\'affichage et conservé tel quel.'),
          field('Proxy HTTPS', inputs.proxy.https),
          field('Exclusions (NO_PROXY)', inputs.proxy.noProxy),
          field('Certificat d\'autorité (cafile)', inputs.proxy.caFile, 'Transmis à npm et à Node (NODE_EXTRA_CA_CERTS).')),
        h('div', { style: { marginTop: '8px' } }, sslCheck)),
      section('Navigateurs Playwright', h('div', { class: 'p-row' }, browserChecks)),
      section('Outils et éditeur',
        h('div', { class: 'p-stack' }, pathCheck, wingetCheck),
        h('div', { class: 'p-form-grid', style: { marginTop: '10px' } }, field('Commande VS Code', inputs.vscodeCli, 'Chemin complet de code / code.cmd si la détection échoue.', true), extFields)),
      section('Composants requis', h('div', { class: 'p-faint', style: { marginBottom: '6px' } }, 'Un composant requis doit être en place pour que le poste soit déclaré prêt.'), h('div', { class: 'inst-req-grid' }, reqChecks)),
      section('Machine', h('dl', { class: 'p-dl' },
        h('dt', null, 'Hôte'), h('dd', null, `${m.host || '—'} (${m.platform || ''}, ${m.arch || ''})`),
        h('dt', null, 'Node du serveur'), h('dd', null, m.serverNode || '—'),
        h('dt', null, 'Projet de test'), h('dd', { class: 'p-mono' }, m.repoRoot || '—'),
        h('dt', null, 'Outils portables'), h('dd', { class: 'p-mono' }, m.toolsRoot || '—'),
        h('dt', null, 'Fichier .npmrc'), h('dd', { class: 'p-mono' }, m.npmrcPath || '—'),
        h('dt', null, 'Plan local'), h('dd', { class: 'p-mono' }, m.planPath || '—'))),
    ]
    return h('section', { class: 'p-card' },
      h('div', { class: 'p-card-head' },
        h('span', { class: 'p-tile' }, P.icon('settings')),
        h('div', { class: 'p-card-title' }, h('div', null, h('div', null, 'Plan d\'installation'), h('div', { class: 'p-card-sub' }, 'Versions, miroirs et proxy appliqués à chaque installation.'))),
        S.canEdit ? h('button', { class: 'p-btn p-btn--ghost p-btn--sm', type: 'button', onclick: (e) => reset(e.currentTarget) }, 'Réinitialiser') : null,
        S.canEdit ? h('button', { class: 'p-btn p-btn--primary p-btn--sm', type: 'button', onclick: (e) => save(e.currentTarget) }, P.icon('save'), 'Enregistrer') : null),
      h('div', { class: 'p-card-body' }, body))
  }

  /* ---------------------------------------------------------------- assemblage */

  /** Le formulaire des paramètres n'est reconstruit que sur demande, pour ne pas perdre une saisie en cours. */
  function renderAll({ settings = false } = {}) {
    renderActions()
    renderMachine()
    renderSummary()
    renderStacks()
    renderTabs()
    if (S.tab !== 'settings' || settings || !el.tabBody.firstChild) renderTabBody()
  }

  function buildSkeleton() {
    const app = P.clear(document.getElementById('app'))
    el.machine = h('div')
    el.summary = h('div', { class: 'p-stack' })
    el.stacks = h('div')
    el.runPanel = h('div')
    el.tabs = h('div')
    el.tabBody = h('div')
    P.append(app, [
      h('p', { class: 'p-page-intro' }, 'Installez en une fois tout ce dont l\'équipe QA a besoin : chaque composant est détecté, installé seulement s\'il manque, puis vérifié. Relancer ne refait jamais ce qui est déjà en place.'),
      el.machine, el.summary, el.stacks, el.runPanel,
      h('div', null, el.tabs, h('div', { style: { marginTop: '14px' } }, el.tabBody)),
    ])
  }

  async function init({ user } = {}) {
    S.user = user || null
    try {
      const [settings, runs] = await Promise.all([P.api('/api/install/settings'), P.api('/api/install/runs?limit=50')])
      S.plan = settings.plan
      S.machine = settings.machine
      S.canEdit = settings.canEdit
      S.runs = runs.runs
      const stored = readStoredStacks()
      const known = (s) => typeof s === 'string' && Object.prototype.hasOwnProperty.call(S.plan.stacks, s)
      const valid = (list) => (Array.isArray(list) && list.some(known) ? list.filter(known) : null)
      S.stacks = valid(stored) || S.plan.selectedStacks
      await loadState()
      if (!valid(stored) && S.view.stacks?.length) S.stacks = S.view.stacks
    } catch (e) {
      P.clear(document.getElementById('app')).appendChild(P.card({
        body: P.empty('Installation indisponible', `Le serveur n'a pas répondu : ${errorText(e)}`, 'alert',
          h('button', { class: 'p-btn p-btn--primary', type: 'button', onclick: () => location.reload() }, P.icon('refresh'), 'Réessayer')),
      }))
      return
    }
    buildSkeleton()
    renderAll()
    if (S.activeRunId) {
      attachRun(S.activeRunId)
      renderAll()
    } else if (S.runs[0]) {
      openRun(S.runs[0].id, false)
    }
    const params = new URLSearchParams(location.search)
    if (params.get('run') === '1' && !S.activeRunId) {
      if (!S.view.detectedAt) await detect()
      confirmAndRun()
    } else if (!S.view.detectedAt && !S.activeRunId) {
      detect()
    }
  }

  P.whenShell().then(init)
})()

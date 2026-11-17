/* Pilotage : vue d'ensemble du poste, des récits, des scénarios et de la performance. */
;(function () {
  'use strict'
  const P = window.Prisme
  const { h } = P
  const app = document.getElementById('app')

  function hello(user, s) {
    const first = String(user?.displayName || user?.username || '').split(/\s+/)[0]
    const project = s.project?.name
    return h('div', { class: 'home-hello' },
      h('div', { style: { flex: 1 } },
        h('h2', null, first && !user?.demo ? `Bonjour ${first}` : 'Bonjour'),
        h('p', null, project
          ? `Projet ${project}${s.project.squad ? ` · ${s.project.squad}` : ''} — voici où en est votre campagne de test.`
          : 'Voici où en est votre campagne de test. Commencez par décrire le projet et scanner JIRA.')),
      h('div', { class: 'p-row' },
        h('a', { class: 'p-btn', href: '/connaissance.html#scan' }, P.icon('refresh'), 'Scanner JIRA'),
        h('a', { class: 'p-btn p-btn--primary', href: '/recits.html' }, P.icon('wand'), 'Générer les scénarios')))
  }

  function kpis(s) {
    const inst = s.install
    const st = s.stories
    const last = s.perf?.lastRun
    return h('div', { class: 'p-kpis' },
      P.kpi({
        label: 'Poste de test',
        value: inst.known ? `${inst.ok}` : '—',
        unit: inst.known ? `/ ${inst.total}` : '',
        detail: inst.known ? (inst.ready ? 'Toutes les dépendances sont en place' : `${inst.missing.length} composant(s) à installer`) : 'Lancez une vérification',
        tone: inst.ready ? 'mint' : 'amber',
        href: '/installation.html',
      }),
      P.kpi({
        label: 'Récits scannés',
        value: s.scan ? st.total : '—',
        detail: s.scan ? `${s.scan.source === 'demo' ? '◇ démo · ' : ''}${P.fmtAgo(s.scan.scannedAt)}` : 'Aucun scan JIRA',
        href: '/connaissance.html',
      }),
      P.kpi({
        label: 'À clarifier',
        value: s.scan ? st.withoutAc : '—',
        detail: 'Récits sans critère d’acceptation',
        tone: st.withoutAc ? 'amber' : '',
        href: '/connaissance.html',
      }),
      P.kpi({
        label: 'Couverture Gherkin',
        value: st.total ? `${st.coverage}` : '—',
        unit: st.total ? '%' : '',
        detail: st.total ? `${st.validated} validés · ${st.drafts} brouillons` : 'Après le scan',
        tone: st.total && st.coverage === 100 ? 'mint' : '',
        href: '/recits.html',
      }),
      P.kpi({
        label: 'Dernier test de charge',
        value: last?.p95 != null ? Math.round(last.p95) : '—',
        unit: last?.p95 != null ? 'ms p95' : '',
        detail: last ? `${last.status === 'failed' ? 'Échec' : 'Réussi'} · ${P.fmtAgo(last.finishedAt)}` : 'Aucun run k6',
        tone: last ? (last.status === 'failed' ? 'red' : 'mint') : '',
        href: '/perf.html',
      }),
      P.kpi({
        label: 'Assistant IA',
        value: s.llm?.active ? s.llm.active.label : 'Manuel',
        detail: s.llm?.active ? (s.llm.active.model || 'Connecté') : 'Copier-coller du prompt',
        tone: s.llm?.active ? 'mint' : '',
        href: '/ia.html',
      }))
  }

  function journeyCard(s) {
    const next = s.journey.find((x) => x.state === 'current') || s.journey.find((x) => x.state !== 'done')
    return P.card({
      title: 'Parcours QA',
      sub: 'De l’installation du poste aux tests reliés à Xray',
      icon: 'target',
      body: h('div', null,
        P.stepper(s.journey.map((x) => ({ label: x.label, sub: x.sub, state: x.state, onClick: () => { location.href = x.href } }))),
        next
          ? h('div', { class: 'home-journey-cta' },
            h('span', { class: 'p-muted' }, 'Prochaine étape : ', h('b', null, next.label)),
            h('span', { class: 'p-spacer' }),
            h('a', { class: 'p-btn p-btn--primary p-btn--sm', href: next.href }, next.cta, P.icon('arrowRight')))
          : h('div', { class: 'home-journey-cta' }, P.status('Toutes les étapes sont terminées', 'mint'))),
      flush: true,
      className: 'home-journey',
    })
  }

  function actionsCard(s) {
    const list = s.actions.length
      ? h('div', { class: 'home-actions' }, s.actions.map((a) => h('a', { class: 'home-action', href: a.href },
        h('span', { class: `p-tile ${a.tone}` }, P.icon(a.icon)),
        h('div', { class: 'home-action-text' }, h('div', { class: 'home-action-title' }, a.title), h('div', { class: 'home-action-detail' }, a.detail)),
        h('span', { class: 'p-btn p-btn--sm' }, a.cta))))
      : P.empty('Rien d’urgent', 'Le poste, les récits et les scénarios sont à jour.', 'checkCircle')
    return P.card({ title: 'À traiter', sub: 'Classé par priorité', icon: 'alert', tone: 'amber', body: list, flush: true, actions: s.actions.length ? P.badge(String(s.actions.length), 'amber') : null })
  }

  function epicsCard(s) {
    const epics = s.stories.epics || []
    const body = epics.length
      ? h('div', null, epics.map((e) => h('div', { class: 'home-epic' },
        h('div', { style: { minWidth: 0 } },
          h('div', { class: 'home-epic-name p-ellipsis' }, e.key ? `${e.key} · ${e.label}` : e.label),
          h('div', { class: 'home-epic-meta' }, `${e.total} récit(s) · ${e.validated} validé(s) · ${e.drafts} brouillon(s)`)),
        h('div', { class: 'home-meter', title: `${e.validated} validés, ${e.drafts} brouillons sur ${e.total}` },
          h('span', { class: 'v', style: { width: `${(e.validated / e.total) * 100}%` } }),
          h('span', { class: 'd', style: { width: `${(e.drafts / e.total) * 100}%` } })),
        h('div', { class: 'home-epic-pct' }, `${Math.round((e.validated / e.total) * 100)} %`))))
      : P.empty('Aucun récit', 'Scannez JIRA pour voir la couverture par épopée.', 'listChecks',
        h('a', { class: 'p-btn p-btn--sm p-btn--primary', href: '/connaissance.html#scan' }, 'Scanner'))
    return P.card({
      title: 'Couverture des récits par épopée',
      sub: 'Part des récits dont les scénarios Gherkin sont validés',
      icon: 'barChart',
      body,
      flush: true,
      actions: epics.length ? h('div', { class: 'home-legend' }, h('span', null, h('i', { style: { background: 'var(--p-green)' } }), 'Validés'), h('span', null, h('i', { style: { background: '#B9A3E3' } }), 'Brouillons')) : null,
    })
  }

  function toolsCard(s) {
    const missing = new Set((s.install.missing || []).map((m) => m.id))
    const tools = [
      ['/assets/logo-playwright.png', 'Playwright', 'Tests de bout en bout', ['playwright-browsers', 'npm-packages']],
      ['/assets/logo-k6.png', 'k6', 'Tests de charge', ['k6']],
      ['/assets/logo-jira.png', 'JIRA / Xray', 'Récits et plans de test', []],
      ['/assets/logo-github-copilot.png', 'Copilot', 'Assistant IA local', []],
    ]
    return P.card({
      title: 'Stack de test',
      icon: 'layers',
      tone: 'teal',
      flush: true,
      body: h('div', null, tools.map(([logo, name, role, ids]) => {
        const miss = ids.some((id) => missing.has(id))
        let state = s.install.known ? (miss ? P.status('À installer', 'amber') : P.status('Prêt', 'mint')) : P.status('À vérifier', '')
        if (name === 'JIRA / Xray') state = s.scan ? P.status(s.scan.source === 'demo' ? 'Démo' : 'Connecté', 'mint') : P.status('Non connecté', 'amber')
        if (name === 'Copilot') state = s.llm?.active ? P.status(s.llm.active.label, 'mint') : P.status('Non branché', '')
        return h('div', { class: 'home-tool' }, h('img', { src: logo, alt: '' }), h('div', { class: 'home-tool-name' }, name, h('div', { class: 'p-faint' }, role)), state)
      })),
    })
  }

  function render(user, s) {
    P.clear(app)
    app.append(
      hello(user, s),
      user?.demo ? P.banner('warn', h('span', null, 'Vous utilisez le compte de démonstration ', h('b', null, 'demo / demo'), '. Changez son mot de passe ou créez votre compte dans ', h('a', { href: '/reglages.html' }, 'Réglages'), '.')) : null,
      kpis(s),
      journeyCard(s),
      h('div', { class: 'p-grid p-grid-2' }, actionsCard(s), epicsCard(s)),
      h('div', { class: 'p-grid p-grid-2' }, toolsCard(s), P.card({
        title: 'Raccourcis',
        icon: 'zap',
        body: h('div', { class: 'p-stack' },
          h('a', { class: 'p-btn', href: '/installation.html?run=1' }, P.icon('download'), 'Installer toute la stack de test'),
          h('a', { class: 'p-btn', href: '/perf.html' }, P.icon('play'), 'Lancer un test de charge k6'),
          h('a', { class: 'p-btn', href: '/hook-git.html' }, P.icon('gitBranch'), 'Relier Git à JIRA / Xray'),
          h('a', { class: 'p-btn', href: '/doc-qa.html' }, P.icon('fileText'), 'Produire les livrables QA'),
          h('button', { class: 'p-btn', type: 'button', onclick: () => P.shell.openPalette() }, P.icon('search'), 'Tout chercher', h('span', { class: 'p-kbd' }, 'Ctrl K'))),
      })))
  }

  async function load(user) {
    try {
      const s = await P.api('/api/dashboard/summary')
      render(user, s)
    } catch (e) {
      P.clear(app).append(P.banner('error', `Impossible de charger le tableau de bord : ${e.message}`))
    }
  }

  P.whenShell().then(({ user }) => {
    app.append(h('div', { class: 'p-faint' }, h('span', { class: 'p-spinner' }), ' Chargement du tableau de bord…'))
    P.shell.setActions(h('button', { class: 'p-btn p-btn--ghost', type: 'button', title: 'Actualiser', onclick: () => { load(user); P.shell.refreshStrip() } }, P.icon('refresh'), 'Actualiser'))
    load(user)
  })
})()

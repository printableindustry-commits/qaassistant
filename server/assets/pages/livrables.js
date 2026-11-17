/*
 * Livrables ISTQB alimentés par les tests réels (contrat V3.2 §6.6).
 *   - Bandeau KPI, bannière démo, documents groupés par phase avec statut et « à actualiser »
 *   - Zone document : Aperçu · Modifier · Relecture · Sources · Modèle · Versions
 *   - Actions : Générer / Actualiser, Relire, Approuver, Exporter (Word, HTML/PDF, Markdown)
 *   - Assistant « Informations projet » pas à pas (questionnaire servi par GET /api/livrables/profile)
 *   - Carte « Campagne d'exécution » (réelle ou simulée, suivi par interrogation régulière)
 * Les chiffres viennent du serveur (faits collectés) : la page n'invente rien.
 */
;(function () {
  'use strict'
  const P = window.Prisme
  const { h } = P

  const PHASES = ['Organisation', 'Gestion', 'Conception', 'Exécution']
  const STATUS = {
    none: ['Non généré', 'grey'],
    generated: ['Généré', 'blue'],
    edited: ['Modifié à la main', 'purple'],
    reviewed: ['Relu par l’agent', 'teal'],
    approved: ['Approuvé', 'mint'],
  }
  const SEVERITY = { bloquant: 'red', majeur: 'amber', mineur: 'blue' }
  const TEST_STATUS = { passed: ['Réussi', 'mint'], failed: ['Échec', 'red'], skipped: ['Ignoré', 'grey'], flaky: ['Instable', 'amber'] }
  const TABS = [
    { id: 'apercu', label: 'Aperçu', icon: 'eye' },
    { id: 'modifier', label: 'Modifier', icon: 'edit' },
    { id: 'relecture', label: 'Relecture', icon: 'bot' },
    { id: 'sources', label: 'Sources', icon: 'link' },
    { id: 'modele', label: 'Modèle', icon: 'fileText' },
    { id: 'versions', label: 'Versions', icon: 'clock' },
  ]

  const state = {
    user: null,
    list: null,          // réponse de GET /api/livrables
    docId: null,
    detail: null,        // réponse de GET /api/livrables/docs/:id
    tab: 'apercu',
    draft: null,         // Markdown en cours de modification
    campaign: null,      // campagne affichée (détail)
    polling: null,
    wordModel: null,     // modèle Word de l'entreprise (GET /api/livrables/word-model)
  }
  const refs = {}

  const errMsg = (e) => (e && e.message) || String(e)
  const apiBase = () => String(window.__WIZARD_API_BASE__ || '').replace(/\/$/, '')
  const isAdmin = () => state.user?.role === 'admin'
  const docs = () => state.list?.documents || []
  const currentDoc = () => docs().find((d) => d.id === state.docId) || null
  const pct = (v) => (v == null || Number.isNaN(Number(v)) ? '—' : `${Math.round(Number(v))} %`)

  async function guard(btn, fn) {
    try {
      return await P.busy(btn, fn)
    } catch (e) {
      P.toast(errMsg(e), 'error', 7000)
      return undefined
    }
  }

  function statusBadge(d) {
    const [label, tone] = STATUS[d.status] || STATUS.none
    return P.badge(label, tone)
  }

  function download(url) {
    const a = h('a', { href: apiBase() + url, download: '' })
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  // ------------------------------------------------------------------ démarrage

  P.whenShell().then(async ({ user }) => {
    state.user = user
    refs.app = document.getElementById('app')
    const wanted = new URLSearchParams(location.search).get('doc')
    try {
      await Promise.all([loadList(), loadWordModel()])
      state.docId = (wanted && docs().some((d) => d.id === wanted)) ? wanted : docs()[0]?.id || null
      render()
      if (state.docId) await openDoc(state.docId, { keepTab: true })
      const last = state.list?.facts?.lastCampaign
      if (last && last.status === 'running') startPolling(last.id)
      else if (last) state.campaign = last
      renderCampaign()
    } catch (e) {
      P.clear(refs.app)
      const missing = e.status === 404
      refs.app.appendChild(P.banner(missing ? 'warn' : 'error', [
        h('b', null, missing ? 'Module Livrables indisponible. ' : 'Chargement impossible. '),
        missing ? 'Le serveur ne propose pas encore les routes /api/livrables : mettez à jour Wizard QA.' : errMsg(e),
      ]))
    }
  })

  async function loadList() {
    state.list = await P.api('/api/livrables')
  }

  async function loadWordModel() {
    try {
      state.wordModel = (await P.api('/api/livrables/word-model')).model || null
    } catch {
      state.wordModel = null // serveur sans la route : export Word standard
    }
  }

  async function refreshAll() {
    await loadList()
    renderTop()
    renderDocList()
    if (state.docId) await openDoc(state.docId, { keepTab: true })
  }

  // ------------------------------------------------------------------ squelette

  function render() {
    const app = refs.app
    P.clear(app)
    refs.top = h('div', { class: 'lv-top' })
    refs.docList = h('div', { class: 'lv-doclist' })
    refs.profileCard = h('div')
    refs.modelCard = h('div')
    refs.campaignCard = h('div')
    refs.docZone = h('div', { class: 'lv-doczone' })
    app.append(
      refs.top,
      h('div', { class: 'lv-grid' },
        h('div', { class: 'lv-side' },
          P.card({ title: 'Documents', sub: 'Structure ISO/IEC/IEEE 29119-3', icon: 'layers', flush: true, body: refs.docList }),
          refs.profileCard,
          refs.modelCard,
          refs.campaignCard),
        refs.docZone))
    renderActions()
    renderTop()
    renderDocList()
    renderModelCard()
    renderCampaign()
  }

  function renderActions() {
    P.shell.setActions(
      h('button', { class: 'p-btn', type: 'button', onclick: () => openWizard() }, P.icon('users'), 'Informations projet'),
      h('button', {
        class: 'p-btn',
        type: 'button',
        title: state.wordModel ? 'Exporter tous les documents (ZIP) ; les fichiers Word sont au format de votre modèle' : 'Exporter tous les documents générés (ZIP)',
        onclick: () => download('/api/livrables/export.zip'),
      }, P.icon('package'), 'Exporter le pack'),
      h('button', { class: 'p-btn p-btn--primary', type: 'button', onclick: (e) => generateAll(e.currentTarget) }, P.icon('sparkles'), 'Tout générer'))
  }

  // ------------------------------------------------------------------ KPI et bannière

  function renderTop() {
    const top = P.clear(refs.top)
    const list = docs()
    const facts = state.list?.facts || {}
    const k = state.list?.kpis || {}
    const generated = list.filter((d) => d.status !== 'none')
    const upToDate = k.upToDate ?? generated.filter((d) => !d.stale).length
    const stale = k.stale ?? list.filter((d) => d.stale).length
    const reviewed = k.reviewed ?? list.filter((d) => d.status === 'reviewed' || d.status === 'approved' || d.review?.verdict).length
    const approved = k.approved ?? list.filter((d) => d.status === 'approved').length
    const cov = facts.coverage || {}
    const last = facts.lastCampaign

    if (facts.demo) {
      top.appendChild(P.banner('blue', [
        h('b', null, 'Données de démonstration (IRMA). '),
        'Les documents sont alimentés par le jeu de démo JIRA et des campagnes simulées : connectez JIRA et lancez une campagne réelle pour produire les livrables du projet.',
      ], 'flask'))
    }
    top.appendChild(h('div', { class: 'p-kpis' },
      P.kpi({ label: 'Documents à jour', value: upToDate, unit: `/ ${list.length}`, tone: upToDate && upToDate === list.length ? 'mint' : '', detail: `${generated.length} générés` }),
      P.kpi({ label: 'À actualiser', value: stale, tone: stale ? 'amber' : '', detail: stale ? 'les données ont changé' : 'rien à reprendre' }),
      P.kpi({ label: 'Relus par l’agent', value: reviewed, unit: `/ ${list.length}` }),
      P.kpi({ label: 'Approuvés', value: approved, unit: `/ ${list.length}`, tone: approved ? 'mint' : '' }),
      P.kpi({ label: 'Récits automatisés', value: pct(cov.pctAutomated), detail: cov.stories != null ? `${cov.automated ?? 0} / ${cov.stories} récits` : 'pas de données' }),
      P.kpi({ label: 'Récits réussis', value: pct(cov.pctPassed), tone: cov.pctPassed >= 90 ? 'mint' : cov.pctPassed != null ? 'amber' : '', detail: cov.executed != null ? `${cov.passed ?? 0} réussis / ${cov.executed} exécutés` : '' }),
      P.kpi({
        label: 'Dernière campagne',
        value: last ? `${last.passed ?? 0}/${last.total ?? 0}` : '—',
        tone: last ? (last.failed ? 'red' : 'mint') : '',
        detail: last ? `${P.fmtAgo(last.at)}${last.simulated ? ' · simulée' : ''}` : 'aucune campagne',
      })))
  }

  // ------------------------------------------------------------------ liste des documents

  function renderDocList() {
    const host = P.clear(refs.docList)
    const list = docs()
    if (!list.length) {
      host.appendChild(P.empty('Aucun document', 'Le catalogue des livrables est vide.', 'fileText'))
      return
    }
    const phases = [...PHASES, ...new Set(list.map((d) => d.phase).filter((p) => !PHASES.includes(p)))]
    for (const phase of phases) {
      const items = list.filter((d) => d.phase === phase)
      if (!items.length) continue
      host.appendChild(h('div', { class: 'p-section-label lv-phase' }, phase))
      for (const d of items) {
        const [, tone] = STATUS[d.status] || STATUS.none
        host.appendChild(h('button', {
          class: `lv-docitem ${d.id === state.docId ? 'active' : ''}`,
          type: 'button',
          onclick: () => selectDoc(d.id),
        },
        P.dot(tone === 'grey' ? '' : tone),
        h('span', { class: 'lv-docitem-main' },
          h('span', { class: 'lv-docitem-title' }, d.title),
          h('span', { class: 'lv-docitem-meta' },
            (STATUS[d.status] || STATUS.none)[0],
            d.version ? ` · v${d.version}` : '',
            d.missing?.length ? ` · ${d.missing.length} info${d.missing.length > 1 ? 's' : ''} manquante${d.missing.length > 1 ? 's' : ''}` : '')),
        d.stale ? P.badge('À actualiser', 'amber') : null))
      }
    }
    renderProfileCard()
  }

  function renderProfileCard() {
    const missing = new Map()
    for (const d of docs()) for (const m of d.missing || []) missing.set(m.field, m)
    P.clear(refs.profileCard).appendChild(P.card({
      title: 'Informations projet',
      sub: missing.size ? `${missing.size} information${missing.size > 1 ? 's' : ''} à compléter` : 'Contexte, périmètre, critères',
      icon: 'users',
      tone: missing.size ? 'amber' : '',
      body: h('div', { class: 'p-stack' },
        h('div', { class: 'p-hint' }, 'Ce que les tests ne peuvent pas dire (normes, rôles, critères de sortie…) est demandé une seule fois et réutilisé dans tous les documents.'),
        h('button', { class: 'p-btn p-btn--block', type: 'button', onclick: () => openWizard() }, P.icon('wand'), missing.size ? 'Compléter' : 'Revoir les informations')),
    }))
  }

  // ------------------------------------------------------------------ modèle Word de l'entreprise

  function renderModelCard() {
    const m = state.wordModel
    const admin = isAdmin()
    const input = h('input', { type: 'file', accept: '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document', hidden: true })
    input.addEventListener('change', () => {
      const file = input.files && input.files[0]
      input.value = ''
      if (file) uploadWordModel(file, replaceBtn)
    })
    const replaceBtn = admin
      ? h('button', { class: 'p-btn p-btn--sm', type: 'button', onclick: () => input.click() }, P.icon('upload'), m ? 'Remplacer' : 'Déposer un modèle')
      : null
    const removeBtn = admin && m
      ? h('button', { class: 'p-btn p-btn--sm', type: 'button', onclick: (e) => removeWordModel(e.currentTarget) }, P.icon('trash'), 'Retirer')
      : null
    const size = m?.size ? `${(m.size / 1048576).toFixed(1).replace('.', ',')} Mo` : ''
    P.clear(refs.modelCard).appendChild(P.card({
      title: 'Modèle Word de l’entreprise',
      sub: m ? 'Utilisé pour l’export Word' : 'Mise en forme standard',
      icon: 'fileText',
      tone: m?.error ? 'amber' : '',
      body: h('div', { class: 'p-stack' },
        m
          ? h('div', null,
            h('div', { class: 'lv-model-name', title: m.name }, m.name),
            h('div', { class: 'p-hint' }, `Déposé ${P.fmtAgo(m.savedAt)}${m.savedBy ? ` par ${m.savedBy}` : ''}${size ? ` · ${size}` : ''}`),
            m.error ? h('div', { class: 'p-hint' }, `Modèle illisible : ${m.error}`) : null)
          : h('div', { class: 'p-hint' }, 'Déposez le modèle Word de l’entreprise (.docx) : page de garde, tableau des rôles, sommaire, styles de titres et pied de page seront repris dans chaque export Word.'),
        h('div', { class: 'p-hint' }, 'Le modèle reste sur ce poste : il n’est pas versionné.'),
        admin ? h('div', { class: 'lv-model-actions' }, replaceBtn, removeBtn, input) : (m ? null : h('div', { class: 'p-hint' }, 'Seul un administrateur peut déposer le modèle.'))),
    }))
  }

  /** Libellés d'export à jour (sans perdre une modification en cours dans l'onglet Modifier). */
  function modelChanged() {
    renderActions()
    if (state.tab !== 'modifier') renderDoc()
  }

  async function uploadWordModel(file, btn) {
    if (!/\.docx$/i.test(file.name)) {
      P.toast('Choisissez un document Word .docx (les .doc ne sont pas pris en charge).', 'error', 7000)
      return
    }
    if (file.size > 30 * 1024 * 1024) {
      P.toast('Modèle trop volumineux (30 Mo au plus).', 'error', 7000)
      return
    }
    await guard(btn, async () => {
      const res = await fetch(`${apiBase()}/api/livrables/word-model`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
        body: file,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.ok === false) throw new Error(data.error || `Erreur ${res.status}`)
      state.wordModel = data.model || null
      renderModelCard()
      modelChanged()
      P.toast('Modèle Word enregistré : les exports Word utilisent désormais sa mise en forme.')
    })
  }

  async function removeWordModel(btn) {
    if (!(await P.confirm('Retirer le modèle Word ? Les exports Word reprendront la mise en forme standard.', { okLabel: 'Retirer' }))) return
    await guard(btn, async () => {
      await P.api('/api/livrables/word-model', { method: 'DELETE' })
      state.wordModel = null
      renderModelCard()
      modelChanged()
      P.toast('Modèle Word retiré.')
    })
  }

  async function selectDoc(id) {
    if (state.draft != null && state.docId !== id && !(await P.confirm('Abandonner les modifications non enregistrées ?', { okLabel: 'Abandonner' }))) return
    state.docId = id
    state.draft = null
    const u = new URL(location.href)
    u.searchParams.set('doc', id)
    history.replaceState(null, '', u)
    renderDocList()
    await openDoc(id, { keepTab: true })
  }

  async function openDoc(id, { keepTab = false } = {}) {
    if (!keepTab) state.tab = 'apercu'
    const zone = P.clear(refs.docZone)
    zone.appendChild(h('div', { class: 'p-card' }, h('div', { class: 'p-card-body p-faint' }, h('span', { class: 'p-spinner' }), ' Chargement du document…')))
    try {
      state.detail = await P.api(`/api/livrables/docs/${encodeURIComponent(id)}`)
    } catch (e) {
      state.detail = null
      P.clear(zone).appendChild(P.banner('error', `Lecture du document impossible : ${errMsg(e)}`))
      return
    }
    if (state.docId === id) renderDoc()
  }

  // ------------------------------------------------------------------ zone document

  function renderDoc() {
    const d = currentDoc()
    const zone = P.clear(refs.docZone)
    if (!d) return
    const generated = d.status !== 'none'
    const cat = state.detail?.doc || {}

    const head = h('div', { class: 'lv-dochead' },
      h('div', { class: 'lv-dochead-main' },
        h('div', { class: 'lv-dochead-ref' }, h('span', { class: 'p-mono' }, d.ref || ''), d.phase ? P.badge(d.phase, 'outline') : null),
        h('h2', { class: 'lv-dochead-title' }, d.title),
        h('div', { class: 'lv-dochead-meta' },
          statusBadge(d),
          d.stale ? P.badge('À actualiser', 'amber', 'Les faits, les informations projet ou le modèle ont changé depuis la dernière génération') : null,
          d.version ? h('span', null, `Version ${d.version}`) : null,
          d.updatedAt ? h('span', null, `mis à jour ${P.fmtAgo(d.updatedAt)}`) : null,
          d.review?.score != null ? h('span', null, `relecture ${d.review.score}/100`) : null),
        cat.purpose ? h('div', { class: 'p-hint lv-purpose' }, cat.purpose, cat.audience ? ` — Destinataires : ${cat.audience}` : '') : null),
      h('div', { class: 'lv-dochead-actions' },
        h('button', { class: `p-btn ${!generated || d.stale ? 'p-btn--primary' : ''}`, type: 'button', onclick: (e) => generate(e.currentTarget) },
          P.icon(generated ? 'refresh' : 'sparkles'), generated ? 'Actualiser' : 'Générer'),
        h('button', { class: 'p-btn', type: 'button', disabled: !generated, onclick: (e) => review(e.currentTarget) }, P.icon('bot'), 'Relire'),
        h('button', { class: 'p-btn', type: 'button', disabled: !generated || d.status === 'approved', onclick: (e) => approve(e.currentTarget) }, P.icon('checkCircle'), d.status === 'approved' ? 'Approuvé' : 'Approuver'),
        exportMenu(d, generated)))

    const parts = [head]
    if (d.missing?.length) {
      parts.push(P.banner('warn', h('div', null,
        h('b', null, `${d.missing.length} information${d.missing.length > 1 ? 's' : ''} projet manquante${d.missing.length > 1 ? 's' : ''} : `),
        d.missing.map((m) => m.label).join(', '),
        h('button', { class: 'p-btn p-btn--sm lv-inline-btn', type: 'button', onclick: () => openWizard(d.missing[0]?.step) }, P.icon('wand'), 'Compléter'))))
    }
    if (d.status === 'approved' && d.stale) {
      parts.push(P.banner('info', 'Ce document est approuvé mais les données ont changé : actualisez-le, il repassera au statut « Généré » et devra être approuvé de nouveau.'))
    }

    refs.tabsHost = h('div')
    refs.tabBody = h('div', { class: 'lv-tabbody' })
    P.tabs(refs.tabsHost, TABS.map((t) => ({
      ...t,
      count: t.id === 'relecture' && d.review?.verdict ? (d.review.verdict === 'ok' ? 'OK' : '!') : null,
      tone: t.id === 'relecture' && d.review?.verdict && d.review.verdict !== 'ok' ? 'amber' : '',
    })), state.tab, async (id) => {
      if (state.tab === 'modifier' && state.draft != null && id !== 'modifier' && !(await P.confirm('Abandonner les modifications non enregistrées ?', { okLabel: 'Abandonner' }))) {
        renderDoc()
        return
      }
      if (id !== 'modifier') state.draft = null
      state.tab = id
      renderTab()
    })
    parts.push(refs.tabsHost, refs.tabBody)
    zone.appendChild(h('section', { class: 'p-card' }, h('div', { class: 'p-card-body lv-docbody' }, parts)))
    renderTab()
  }

  function exportMenu(d, generated) {
    const fmt = (format) => `/api/livrables/docs/${encodeURIComponent(d.id)}/export?format=${format}`
    const model = state.wordModel
    return h('div', { class: 'p-seg lv-export', title: generated ? 'Exporter' : 'Générez d’abord le document' },
      h('button', {
        type: 'button',
        disabled: !generated,
        title: model ? `Word au format de votre modèle (${model.name})` : 'Word (mise en forme standard)',
        onclick: () => download(fmt('docx')),
      }, model ? 'Word · au format de votre modèle' : 'Word'),
      h('button', { type: 'button', disabled: !generated, onclick: () => printHtml(fmt('html')) }, 'HTML / PDF'),
      h('button', { type: 'button', disabled: !generated, onclick: () => download(fmt('md')) }, 'Markdown'))
  }

  /** Ouvre la version HTML imprimable dans un nouvel onglet et propose l'impression (PDF). */
  async function printHtml(url) {
    const win = window.open('', '_blank')
    try {
      const res = await fetch(apiBase() + url, { credentials: 'same-origin' })
      if (!res.ok) throw new Error(`Erreur ${res.status}`)
      const html = await res.text()
      if (!win) {
        P.toast('Fenêtre bloquée par le navigateur : autorisez les fenêtres surgissantes.', 'warn')
        return
      }
      win.document.open()
      win.document.write(html)
      win.document.close()
      setTimeout(() => { try { win.focus(); win.print() } catch { /* impression annulée */ } }, 400)
    } catch (e) {
      if (win) win.close()
      P.toast(`Export impossible : ${errMsg(e)}`, 'error')
    }
  }

  function renderTab() {
    const body = P.clear(refs.tabBody)
    const d = currentDoc()
    const det = state.detail || {}
    const generated = d && d.status !== 'none'
    const notYet = () => P.empty('Document pas encore généré', 'Cliquez sur « Générer » : le document est construit à partir des faits collectés et des informations projet.', 'fileText',
      h('button', { class: 'p-btn p-btn--primary', type: 'button', onclick: (e) => generate(e.currentTarget) }, P.icon('sparkles'), 'Générer'))

    if (state.tab === 'apercu') {
      if (!generated && !det.html) return body.appendChild(notYet())
      if (!generated) {
        body.appendChild(P.banner('info', h('span', null, h('b', null, 'Aperçu avant génération. '), 'Ce document n’est pas encore enregistré : cliquez sur « Générer » pour créer la version 1.')))
      }
      body.appendChild(h('article', { class: 'lv-preview', html: det.html || '' }))
    } else if (state.tab === 'modifier') {
      if (!generated) return body.appendChild(notYet())
      const ta = h('textarea', { class: 'p-textarea p-mono lv-editor', spellcheck: 'false', oninput: (e) => { state.draft = e.target.value } })
      ta.value = state.draft ?? det.markdown ?? ''
      body.append(
        P.banner('info', 'Les modifications manuelles sont conservées comme une nouvelle version (« Modifié à la main »). Une régénération repart du modèle et des données.'),
        ta,
        h('div', { class: 'lv-foot' },
          h('button', { class: 'p-btn p-btn--primary', type: 'button', onclick: (e) => saveMarkdown(e.currentTarget, ta.value) }, P.icon('save'), 'Enregistrer'),
          h('button', { class: 'p-btn p-btn--ghost', type: 'button', onclick: () => { state.draft = null; renderTab() } }, 'Annuler')))
    } else if (state.tab === 'relecture') {
      renderReview(body, d, det, generated)
    } else if (state.tab === 'sources') {
      renderSources(body, det)
    } else if (state.tab === 'modele') {
      renderTemplate(body, d)
    } else if (state.tab === 'versions') {
      renderVersions(body, d)
    }
    return undefined
  }

  function renderReview(body, d, det, generated) {
    const rv = det.doc?.review || det.review || d.review
    const actions = h('div', { class: 'lv-foot lv-foot--top' },
      h('button', { class: 'p-btn p-btn--primary', type: 'button', disabled: !generated, onclick: (e) => review(e.currentTarget) }, P.icon('bot'), rv ? 'Relire à nouveau' : 'Relire avec l’agent'),
      h('span', { class: 'p-hint' }, 'L’agent vérifie la complétude ISTQB, la cohérence avec les faits et les données périmées. Il ne modifie pas le document.'))
    body.appendChild(actions)
    if (!rv || !rv.verdict) {
      body.appendChild(P.empty('Pas encore relu', generated ? 'Lancez une relecture pour obtenir les constats de l’agent.' : 'Générez d’abord le document.', 'bot'))
      return
    }
    const findings = rv.findings || []
    body.appendChild(h('div', { class: 'lv-review-head' },
      rv.verdict === 'ok' ? P.status('Conforme', 'mint') : P.status('À corriger', 'amber'),
      rv.score != null ? h('span', { class: 'lv-score' }, `${rv.score}/100`) : null,
      rv.at ? h('span', { class: 'p-faint' }, `relu ${P.fmtAgo(rv.at)}`) : null,
      rv.ai?.used ? P.badge(`Règles + IA${rv.ai.provider ? ` (${rv.ai.provider})` : ''}`, 'purple') : P.badge('Règles seules', 'outline')))
    if (rv.ai && !rv.ai.used && rv.ai.reason) body.appendChild(P.banner('info', rv.ai.reason))
    if (!findings.length) {
      body.appendChild(P.empty('Aucun constat', 'Le document est complet et cohérent avec les données.', 'checkCircle'))
      return
    }
    body.appendChild(h('div', { class: 'lv-table-wrap' }, h('table', { class: 'p-table' },
      h('thead', null, h('tr', null, h('th', null, 'Gravité'), h('th', null, 'Section'), h('th', null, 'Constat'), h('th', null, 'Suggestion'))),
      h('tbody', null, findings.map((f) => h('tr', { class: f.severity === 'bloquant' ? 'critical' : f.severity === 'majeur' ? 'warning' : '' },
        h('td', null, P.badge(f.severity || 'mineur', SEVERITY[f.severity] || 'blue')),
        h('td', null, f.section || '—'),
        h('td', null, f.issue || ''),
        h('td', { class: 'p-faint' }, f.suggestion || '')))))))
  }

  function renderSources(body, det) {
    const src = det.sources || {}
    const entries = Array.isArray(src) ? src.map((s) => [s.path || s.fact || s.key, s.source || s.from || '']) : Object.entries(src)
    body.appendChild(h('p', { class: 'p-hint' }, 'Chaque chiffre ou liste du document provient d’un fait collecté. Les informations projet viennent de l’assistant « Informations projet ».'))
    if (!entries.length) {
      body.appendChild(P.empty('Aucune source', 'Générez le document pour voir les données utilisées.', 'link'))
      return
    }
    body.appendChild(h('div', { class: 'lv-table-wrap' }, h('table', { class: 'p-table' },
      h('thead', null, h('tr', null, h('th', null, 'Donnée'), h('th', null, 'Provenance'))),
      h('tbody', null, entries.map(([k, v]) => h('tr', null,
        h('td', { class: 'p-mono' }, k),
        h('td', null, typeof v === 'object' ? JSON.stringify(v) : String(v))))))))
  }

  async function renderTemplate(body, d) {
    body.appendChild(h('div', { class: 'p-faint' }, h('span', { class: 'p-spinner' }), ' Lecture du modèle…'))
    let r
    try {
      r = await P.api(`/api/livrables/templates/${encodeURIComponent(d.id)}`)
    } catch (e) {
      P.clear(body).appendChild(P.banner('error', `Lecture du modèle impossible : ${errMsg(e)}`))
      return
    }
    if (state.tab !== 'modele' || state.docId !== d.id) return
    P.clear(body)
    const tpl = r.template && typeof r.template === 'object' ? r.template : r
    const text = tpl.markdown ?? tpl.source ?? (typeof r.template === 'string' ? r.template : '') ?? ''
    const custom = Boolean(tpl.overridden)
    const admin = isAdmin()
    body.appendChild(h('div', { class: 'lv-review-head' },
      custom ? P.badge('Modèle personnalisé', 'purple') : P.badge('Modèle de référence', 'outline'),
      h('span', { class: 'p-hint' }, 'Syntaxe : {{chemin}}, {{chemin|défaut}}, {{#each …}}…{{/each}}, {{#if …}}…{{else}}…{{/if}}, filtres |pct |date |count |join |upper.')))
    if (!admin) body.appendChild(P.banner('info', 'Lecture seule : seul un administrateur peut modifier le modèle.'))
    const ta = h('textarea', { class: 'p-textarea p-mono lv-editor', spellcheck: 'false', readonly: !admin })
    ta.value = text
    body.appendChild(ta)
    if (admin) {
      body.appendChild(h('div', { class: 'lv-foot' },
        h('button', { class: 'p-btn p-btn--primary', type: 'button', onclick: (e) => guard(e.currentTarget, async () => {
          await P.api(`/api/livrables/templates/${encodeURIComponent(d.id)}`, { method: 'PUT', body: { markdown: ta.value } })
          P.toast('Modèle enregistré : le document est à actualiser.')
          await refreshAll()
        }) }, P.icon('save'), 'Enregistrer le modèle'),
        custom ? h('button', { class: 'p-btn p-btn--ghost', type: 'button', onclick: (e) => guard(e.currentTarget, async () => {
          if (!(await P.confirm('Revenir au modèle de référence ? Vos modifications du modèle seront perdues.', { okLabel: 'Revenir', danger: true }))) return
          await P.api(`/api/livrables/templates/${encodeURIComponent(d.id)}`, { method: 'DELETE' })
          P.toast('Modèle de référence rétabli.')
          await refreshAll()
        }) }, P.icon('refresh'), 'Revenir au modèle de référence') : null))
    }
  }

  async function renderVersions(body, d) {
    body.appendChild(h('div', { class: 'p-faint' }, h('span', { class: 'p-spinner' }), ' Lecture de l’historique…'))
    let r
    try {
      r = await P.api(`/api/livrables/docs/${encodeURIComponent(d.id)}/versions`)
    } catch (e) {
      P.clear(body).appendChild(P.banner('error', `Lecture de l’historique impossible : ${errMsg(e)}`))
      return
    }
    if (state.tab !== 'versions' || state.docId !== d.id) return
    P.clear(body)
    const versions = [...(r.versions || [])].sort((a, b) => b.n - a.n)
    const approvedN = r.approval?.version ?? state.detail?.doc?.approval?.version
    if (!versions.length) {
      body.appendChild(P.empty('Aucune version', 'Chaque génération ou modification crée une version (20 conservées).', 'clock'))
      return
    }
    body.appendChild(h('div', { class: 'lv-table-wrap' }, h('table', { class: 'p-table' },
      h('thead', null, h('tr', null, h('th', null, 'Version'), h('th', null, 'Date'), h('th', null, 'Auteur'), h('th', null, 'Origine'), h('th', null, ''))),
      h('tbody', null, versions.map((v) => h('tr', null,
        h('td', null, h('b', null, `v${v.n}`), ' ', v.n === approvedN ? P.badge('Approuvée', 'mint') : null),
        h('td', null, P.fmtDate(v.at)),
        h('td', null, v.by || '—'),
        h('td', null, v.kind === 'edited' ? P.badge('Modifiée à la main', 'purple') : P.badge('Générée', 'blue')),
        h('td', { class: 'num' }, v.markdown != null ? h('button', { class: 'p-btn p-btn--sm p-btn--ghost', type: 'button', onclick: () => showVersion(v) }, P.icon('eye'), 'Voir') : null)))))))
  }

  function showVersion(v) {
    P.modal({
      title: `Version ${v.n} — ${P.fmtDate(v.at)}`,
      wide: true,
      body: h('pre', { class: 'p-code lv-version-md' }, v.markdown || ''),
      actions: [
        { label: 'Copier', kind: 'ghost', icon: 'copy', onClick: () => { P.copy(v.markdown || ''); return false } },
        { label: 'Fermer', kind: 'primary' },
      ],
    })
  }

  // ------------------------------------------------------------------ actions document

  async function generate(btn) {
    const d = currentDoc()
    if (!d) return
    if (d.status === 'approved' && !(await P.confirm('Le document est approuvé. L’actualiser crée une nouvelle version qui devra être approuvée de nouveau. Continuer ?', { okLabel: 'Actualiser' }))) return
    if (d.status === 'edited' && !(await P.confirm('Le document contient des modifications manuelles. La régénération repart du modèle (les modifications restent dans l’historique). Continuer ?', { okLabel: 'Régénérer' }))) return
    await guard(btn, async () => {
      await P.api(`/api/livrables/docs/${encodeURIComponent(d.id)}/generate`, { method: 'POST', body: {} })
      state.draft = null
      P.toast(`${d.title} : document ${d.status === 'none' ? 'généré' : 'actualisé'}.`)
      state.tab = 'apercu'
      await refreshAll()
    })
  }

  async function review(btn) {
    const d = currentDoc()
    if (!d) return
    await guard(btn, async () => {
      const r = await P.api(`/api/livrables/docs/${encodeURIComponent(d.id)}/review`, { method: 'POST', body: {} })
      const rv = r.review || r
      P.toast(rv.verdict === 'ok' ? 'Relecture terminée : document conforme.' : 'Relecture terminée : des points sont à corriger.', rv.verdict === 'ok' ? 'ok' : 'warn')
      state.tab = 'relecture'
      await refreshAll()
    })
  }

  async function approve(btn) {
    const d = currentDoc()
    if (!d) return
    const blocking = (d.review?.verdict && d.review.verdict !== 'ok') ? ' La dernière relecture signale des points à corriger.' : ''
    if (!(await P.confirm(`Approuver « ${d.title} » en version ${d.version || '—'} ? La version sera figée.${blocking}`, { okLabel: 'Approuver' }))) return
    await guard(btn, async () => {
      await P.api(`/api/livrables/docs/${encodeURIComponent(d.id)}/approve`, { method: 'POST', body: {} })
      P.toast(`${d.title} approuvé.`)
      await refreshAll()
    })
  }

  async function saveMarkdown(btn, markdown) {
    const d = currentDoc()
    await guard(btn, async () => {
      await P.api(`/api/livrables/docs/${encodeURIComponent(d.id)}`, { method: 'PUT', body: { markdown } })
      state.draft = null
      P.toast('Modifications enregistrées (nouvelle version).')
      state.tab = 'apercu'
      await refreshAll()
    })
  }

  async function generateAll(btn) {
    await guard(btn, async () => {
      const r = await P.api('/api/livrables/generate-all', { method: 'POST', body: {} })
      const n = Array.isArray(r.documents) ? r.documents.length : Array.isArray(r.generated) ? r.generated.length : r.count
      P.toast(n != null ? `${n} documents générés.` : 'Tous les documents ont été générés.')
      await refreshAll()
    })
  }

  // ------------------------------------------------------------------ campagne d'exécution

  function renderCampaign() {
    if (!refs.campaignCard) return
    const c = state.campaign
    const running = c?.status === 'running'
    const demo = state.list?.facts?.demo
    const body = h('div', { class: 'p-stack' })
    body.appendChild(h('div', { class: 'p-hint' }, 'Exécute les tests Playwright du projet et alimente le journal d’exécution, les anomalies et les rapports.'))
    body.appendChild(h('div', { class: 'lv-camp-actions' },
      h('button', { class: `p-btn p-btn--sm ${demo ? '' : 'p-btn--primary'}`, type: 'button', disabled: running, onclick: (e) => launchCampaign(e.currentTarget, false) }, P.icon('play'), 'Lancer'),
      h('button', { class: `p-btn p-btn--sm ${demo ? 'p-btn--primary' : ''}`, type: 'button', disabled: running, title: 'Résultats plausibles et déterministes, marqués « simulés »', onclick: (e) => launchCampaign(e.currentTarget, true) }, P.icon('flask'), 'Simuler')))

    if (c) {
      const tone = c.status === 'error' ? 'red' : running ? 'blue' : c.failed ? 'amber' : 'mint'
      const label = c.status === 'error' ? 'Erreur' : running ? 'En cours…' : c.failed ? `${c.failed} échec${c.failed > 1 ? 's' : ''}` : 'Tout est réussi'
      body.appendChild(h('div', { class: 'lv-camp-sum' },
        h('div', { class: 'p-row p-row--between' },
          h('span', { class: `p-status ${tone}` }, h('span', { class: `p-dot ${tone} ${running ? 'live' : ''}` }), label),
          c.simulated ? P.badge('Simulée', 'outline') : P.badge('Réelle', 'teal')),
        running ? null : h('div', { class: 'lv-camp-nums' },
          h('span', { class: 'ok' }, `${c.passed ?? 0} réussis`),
          h('span', { class: 'ko' }, `${c.failed ?? 0} échecs`),
          h('span', null, `${c.skipped ?? 0} ignorés`),
          c.flaky ? h('span', null, `${c.flaky} instables`) : null),
        h('div', { class: 'p-faint' }, `${P.fmtDate(c.at)}${c.durationMs != null && !running ? ` · ${P.fmtDuration(c.durationMs)}` : ''}${c.env?.browser ? ` · ${c.env.browser}` : ''}`),
        c.error ? P.banner('error', String(c.error)) : null))
      if (!running && (c.tests?.length || c.total)) {
        body.appendChild(h('div', { class: 'lv-camp-links' },
          c.total ? h('button', { class: 'p-btn p-btn--sm p-btn--ghost', type: 'button', onclick: (e) => showCampaignTests(e.currentTarget, c) }, P.icon('listChecks'), 'Résultats par test') : null,
          h('button', { class: 'p-btn p-btn--sm p-btn--ghost', type: 'button', onclick: () => selectDoc('journal') }, P.icon('fileText'), 'Journal'),
          h('button', { class: 'p-btn p-btn--sm p-btn--ghost', type: 'button', onclick: () => selectDoc('anomalies') }, P.icon('alert'), 'Anomalies')))
      }
    } else {
      body.appendChild(h('div', { class: 'p-faint' }, 'Aucune campagne pour l’instant.'))
    }
    P.clear(refs.campaignCard).appendChild(P.card({ title: 'Campagne d’exécution', icon: 'play', tone: running ? 'blue' : '', body }))
  }

  async function showCampaignTests(btn, c) {
    if (!c.tests) {
      const r = await guard(btn, () => P.api(`/api/livrables/campaigns/${encodeURIComponent(c.id)}`))
      if (!r) return
      c = r.campaign || r
    }
    P.modal({
      title: `Campagne du ${P.fmtDate(c.at)}${c.simulated ? ' (simulée)' : ''}`,
      wide: true,
      body: h('div', { class: 'lv-table-wrap' }, h('table', { class: 'p-table' },
        h('thead', null, h('tr', null, h('th', null, 'Résultat'), h('th', null, 'Test'), h('th', null, 'Récit'), h('th', { class: 'num' }, 'Durée'))),
        h('tbody', null, (c.tests || []).map((t) => {
          const [label, tone] = TEST_STATUS[t.status] || [t.status, 'grey']
          return h('tr', { class: t.status === 'failed' ? 'critical' : '' },
            h('td', null, P.badge(label, tone)),
            h('td', null, h('div', null, t.title), h('div', { class: 'p-faint p-mono' }, t.file || ''), t.error ? h('div', { class: 'lv-test-error' }, t.error) : null),
            h('td', { class: 'p-mono' }, t.storyKey || '—'),
            h('td', { class: 'num' }, P.fmtDuration(t.durationMs)))
        })))),
      actions: [{ label: 'Fermer', kind: 'primary' }],
    })
  }

  async function launchCampaign(btn, simulate) {
    await guard(btn, async () => {
      const r = await P.api('/api/livrables/campaigns', { method: 'POST', body: { simulate } })
      const c = r.campaign || r
      state.campaign = c
      renderCampaign()
      if (c.status === 'running') startPolling(c.id)
      else await campaignFinished(c)
    })
  }

  function startPolling(id) {
    stopPolling()
    state.campaign = { ...(state.campaign || {}), id, status: 'running' }
    renderCampaign()
    state.polling = setInterval(async () => {
      try {
        const r = await P.api(`/api/livrables/campaigns/${encodeURIComponent(id)}`)
        const c = r.campaign || r
        state.campaign = c
        if (c.status !== 'running') {
          stopPolling()
          await campaignFinished(c)
        } else {
          renderCampaign()
        }
      } catch (e) {
        stopPolling()
        P.toast(`Suivi de la campagne interrompu : ${errMsg(e)}`, 'error')
      }
    }, 1500)
  }

  function stopPolling() {
    if (state.polling) clearInterval(state.polling)
    state.polling = null
  }

  async function campaignFinished(c) {
    renderCampaign()
    if (c.status === 'error') P.toast(`Campagne en erreur : ${c.error || 'voir le détail'}`, 'error', 7000)
    else P.toast(`Campagne terminée : ${c.passed ?? 0}/${c.total ?? 0} réussis${c.simulated ? ' (simulée)' : ''}. Les documents liés sont à actualiser.`, c.failed ? 'warn' : 'ok')
    await refreshAll()
    state.campaign = c
    renderCampaign()
  }

  // ------------------------------------------------------------------ assistant « Informations projet »

  /** Normalise le questionnaire servi par le serveur en [{ id, title, help, fields }]. */
  function stepsOf(q) {
    const steps = Array.isArray(q) ? q : q?.steps || []
    return steps.map((s) => ({ id: s.id, title: s.title || s.label || s.id, help: s.help || s.intro || '', fields: s.fields || [] }))
  }

  const isEmpty = (v) => v == null || v === '' || (Array.isArray(v) && !v.length)

  async function openWizard(stepId) {
    let r
    try {
      r = await P.api('/api/livrables/profile')
    } catch (e) {
      P.toast(`Lecture des informations projet impossible : ${errMsg(e)}`, 'error')
      return
    }
    const steps = stepsOf(r.questionnaire)
    if (!steps.length) {
      P.toast('Questionnaire vide côté serveur.', 'warn')
      return
    }
    const w = {
      steps,
      values: { ...(r.profile?.values || r.profile || {}) },
      prefill: r.prefill || {},
      completion: r.completion || {},
      meta: r.profile || {},
      index: Math.max(0, steps.findIndex((s) => s.id === stepId || s.title === stepId)),
      dirty: false,
    }
    delete w.values.updatedBy
    delete w.values.updatedAt
    // Préremplissage visible : une valeur proposée par les données remplit le champ vide, marquée « Prérempli ».
    w.fromPrefill = new Set()
    for (const s of steps) {
      for (const f of s.fields) {
        if (isEmpty(w.values[f.id]) && !isEmpty(w.prefill[f.id])) {
          w.values[f.id] = JSON.parse(JSON.stringify(w.prefill[f.id]))
          w.fromPrefill.add(f.id)
        }
      }
    }

    const host = h('div', { class: 'lv-wizard' })
    const m = P.modal({ title: 'Informations projet', wide: true, body: host })
    m.root.classList.add('lv-wizard-modal')

    const save = async (btn) => {
      const res = await guard(btn, async () => {
        const out = await P.api('/api/livrables/profile', { method: 'PUT', body: { values: w.values } })
        w.dirty = false
        w.fromPrefill.clear()
        if (out.completion) w.completion = out.completion
        return true
      })
      return !!res
    }

    const go = async (btn, index) => {
      if (w.dirty && !(await save(btn))) return
      w.index = index
      draw()
    }

    function draw() {
      P.clear(host)
      const step = w.steps[w.index]
      host.appendChild(P.stepper(w.steps.map((s, i) => {
        const p = w.completion[s.id]
        return {
          label: s.title,
          sub: p != null ? `${Math.round(p)} %` : null,
          state: i === w.index ? 'current' : p >= 100 ? 'done' : 'todo',
          onClick: () => go(null, i),
        }
      })))
      host.appendChild(h('div', { class: 'lv-wiz-step' },
        h('h3', { class: 'p-h3' }, `${w.index + 1}. ${step.title}`),
        step.help ? h('p', { class: 'p-hint' }, step.help) : null,
        h('div', { class: 'p-form-grid' }, step.fields.map((f) => fieldBlock(f)))))
      host.appendChild(h('div', { class: 'lv-wiz-foot' },
        h('button', { class: 'p-btn p-btn--ghost', type: 'button', title: 'Remplace les réponses par le profil de démonstration IRMA', onclick: (e) => guard(e.currentTarget, async () => {
          if (!(await P.confirm('Remplir toutes les étapes avec le profil de démonstration IRMA ? Les réponses actuelles seront remplacées.', { okLabel: 'Remplir' }))) return
          const out = await P.api('/api/livrables/profile/demo', { method: 'POST', body: {} })
          const again = out.profile ? out : await P.api('/api/livrables/profile')
          w.values = { ...(again.profile?.values || again.profile || {}) }
          if (again.completion) w.completion = again.completion
          w.fromPrefill.clear()
          w.dirty = false
          P.toast('Profil de démonstration IRMA chargé.')
          draw()
        }) }, P.icon('flask'), 'Remplir avec la démo IRMA'),
        h('span', { class: 'p-spacer' }),
        w.meta.updatedBy ? h('span', { class: 'p-faint' }, `Dernière mise à jour : ${w.meta.updatedBy}${w.meta.updatedAt ? `, ${P.fmtAgo(w.meta.updatedAt)}` : ''}`) : null,
        w.index > 0 ? h('button', { class: 'p-btn', type: 'button', onclick: (e) => go(e.currentTarget, w.index - 1) }, 'Précédent') : null,
        w.index < w.steps.length - 1
          ? h('button', { class: 'p-btn p-btn--primary', type: 'button', onclick: (e) => go(e.currentTarget, w.index + 1) }, 'Enregistrer et continuer', P.icon('arrowRight'))
          : h('button', { class: 'p-btn p-btn--primary', type: 'button', onclick: async (e) => {
            if (!(await save(e.currentTarget))) return
            m.close()
            P.toast('Informations projet enregistrées : les documents concernés sont à actualiser.')
            await refreshAll()
          } }, P.icon('check'), 'Terminer')))
    }

    function setValue(f, v) {
      w.values[f.id] = v
      w.dirty = true
      w.fromPrefill.delete(f.id)
    }

    function fieldBlock(f) {
      const wide = ['textarea', 'list', 'table'].includes(f.type)
      const label = h('label', { for: `lv-f-${f.id}` }, f.label, f.required ? h('span', { class: 'lv-req' }, ' *') : null,
        w.fromPrefill.has(f.id) ? P.badge('Prérempli depuis les données', 'teal', f.prefill ? `Source : ${f.prefill}` : '') : null)
      const extras = []
      if (!w.fromPrefill.has(f.id) && !isEmpty(w.prefill[f.id]) && JSON.stringify(w.prefill[f.id]) !== JSON.stringify(w.values[f.id])) {
        extras.push(h('button', { class: 'lv-link', type: 'button', onclick: () => {
          w.values[f.id] = JSON.parse(JSON.stringify(w.prefill[f.id]))
          w.fromPrefill.add(f.id)
          w.dirty = true
          draw()
        } }, 'Reprendre la proposition des données'))
      }
      return h('div', { class: `p-field ${wide ? 'span-2' : ''}` }, label, inputFor(f), f.help ? h('div', { class: 'p-hint' }, f.help) : null, extras)
    }

    function inputFor(f) {
      const v = w.values[f.id]
      const id = `lv-f-${f.id}`
      if (f.type === 'textarea') {
        const el = h('textarea', { class: 'p-textarea', id, rows: 4, oninput: (e) => setValue(f, e.target.value) })
        el.value = v ?? ''
        return el
      }
      if (f.type === 'list') {
        const el = h('textarea', { class: 'p-textarea', id, rows: 4, placeholder: 'Un élément par ligne', oninput: (e) => setValue(f, e.target.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)) })
        el.value = Array.isArray(v) ? v.join('\n') : (v ?? '')
        return el
      }
      if (f.type === 'select') {
        const opts = (f.options || []).map((o) => (typeof o === 'object' ? o : { value: o, label: o }))
        const el = h('select', { class: 'p-select', id, onchange: (e) => setValue(f, e.target.value) },
          h('option', { value: '' }, '— Choisir —'),
          opts.map((o) => h('option', { value: o.value, selected: String(v) === String(o.value) }, o.label)))
        return el
      }
      if (f.type === 'number') {
        const el = h('input', { class: 'p-input', id, type: 'number', step: 'any', oninput: (e) => setValue(f, e.target.value === '' ? null : Number(e.target.value)) })
        el.value = v ?? ''
        return el
      }
      if (f.type === 'table') return tableInput(f)
      const el = h('input', { class: 'p-input', id, type: 'text', oninput: (e) => setValue(f, e.target.value) })
      el.value = v ?? ''
      return el
    }

    function tableInput(f) {
      const cols = (f.columns || f.options || []).map((c) => (typeof c === 'object' ? { id: c.id || c.key, label: c.label || c.id || c.key } : { id: c, label: c }))
      const rows = () => (Array.isArray(w.values[f.id]) ? w.values[f.id] : [])
      const wrap = h('div', { class: 'lv-table-wrap' })
      function drawTable() {
        P.clear(wrap).append(h('table', { class: 'p-table lv-edit-table' },
          h('thead', null, h('tr', null, cols.map((c) => h('th', null, c.label)), h('th', null, ''))),
          h('tbody', null, rows().map((row, i) => h('tr', null,
            cols.map((c) => {
              const inp = h('input', { class: 'p-input', type: 'text', 'aria-label': c.label, oninput: (e) => {
                const next = rows().map((r) => ({ ...r }))
                next[i][c.id] = e.target.value
                setValue(f, next)
              } })
              inp.value = row?.[c.id] ?? ''
              return h('td', null, inp)
            }),
            h('td', null, h('button', { class: 'p-icon-btn', type: 'button', title: 'Supprimer la ligne', 'aria-label': 'Supprimer la ligne', onclick: () => {
              setValue(f, rows().filter((_, j) => j !== i))
              drawTable()
            } }, P.icon('trash')))))))),
        h('button', { class: 'p-btn p-btn--sm p-btn--ghost lv-add-row', type: 'button', onclick: () => {
          setValue(f, [...rows(), Object.fromEntries(cols.map((c) => [c.id, '']))])
          drawTable()
        } }, P.icon('plus'), 'Ajouter une ligne')
      }
      drawTable()
      return wrap
    }

    draw()
  }

  window.addEventListener('beforeunload', (e) => {
    if (state.draft != null) {
      e.preventDefault()
      e.returnValue = ''
    }
  })
})()

/*
 * Envoi d'un test validé vers JIRA / Xray — fenêtre réutilisable (docs/V3-ARCHITECTURE.md §5.3).
 *
 *   XrayPush.open({ storyKey: 'IRMA-12', source: { kind: 'playwright', sessionId } | { kind: 'gherkin' }, onDone(result) })
 *
 * Étapes : aperçu (POST /api/xray/preview) → réglage du résumé, du type de test et du plan (GET /api/xray/plans)
 * → envoi (POST /api/xray/push) avec progression Test / lien / plan → résultat avec liens vers JIRA.
 * Dépend de window.Prisme ; la feuille xray-push.css est chargée à la première ouverture.
 */
;(function () {
  'use strict'
  const P = window.Prisme
  const { h } = P

  const SOURCE_LABEL = { playwright: 'Test Playwright', gherkin: 'Scénarios Gherkin' }
  const OP_ICON = { create: 'plus', update: 'refresh', exists: 'check', add: 'plus', skip: 'x' }
  const ISSUE_KEY_RE = /^[A-Z][A-Z0-9_]*-\d+$/

  function ensureCss() {
    if (document.querySelector('link[data-xray-push]')) return
    document.head.appendChild(h('link', { rel: 'stylesheet', href: '/assets/pages/xray-push.css', 'data-xray-push': '1' }))
  }

  function debounce(fn, ms) {
    let t = null
    return (...args) => {
      clearTimeout(t)
      t = setTimeout(() => fn(...args), ms)
    }
  }

  const hintOf = (err) => err?.data?.details?.hint || ''

  function errorBanner(err, extra) {
    const hint = hintOf(err)
    return P.banner('error', [
      h('strong', null, err?.message || String(err)),
      hint ? h('div', { class: 'xp-hint' }, hint) : null,
      extra || null,
    ])
  }

  function extLink(href, text, icon = 'external') {
    // Seules les adresses http(s) deviennent des liens (une URL « javascript: » venue des données serait exécutée).
    if (!href || !/^https?:\/\//i.test(String(href))) return h('strong', null, text)
    return h('a', { href, target: '_blank', rel: 'noopener noreferrer', class: 'xp-link' }, text, P.icon(icon, 13))
  }

  function open({ storyKey, source, onDone } = {}) {
    ensureCss()
    const key = String(storyKey || '').toUpperCase()
    const state = {
      summary: undefined,
      testType: undefined,
      planKey: undefined,     // undefined : plan par défaut des réglages ; '' : aucun
      forceNew: false,
      jiraOnly: false,
      preview: null,
      settings: null,
      checks: null,
      checking: false,
      seq: 0,
      sending: false,
    }

    const body = h('div', { class: 'xp-root' }, h('div', { class: 'p-empty' }, h('span', { class: 'p-spinner' }), h('div', { class: 'p-empty-title' }, 'Préparation de l’envoi…')))
    const dlg = P.modal({
      title: `Envoyer le test dans JIRA — ${key}`,
      wide: true,
      body,
      actions: [{ label: 'Fermer', kind: 'ghost' }],
    })
    const foot = dlg.root.querySelector('.p-modal-foot')

    function setFoot(...buttons) {
      P.clear(foot)
      P.append(foot, buttons)
    }

    const closeBtn = (label = 'Annuler') => h('button', { class: 'p-btn p-btn--ghost', type: 'button', onclick: () => dlg.close() }, label)

    function request(extra = {}) {
      return {
        storyKey: key,
        source,
        summary: state.summary,
        testType: state.testType,
        testPlanKey: state.planKey,
        forceNew: state.forceNew,
        jiraOnly: state.jiraOnly,
        ...extra,
      }
    }

    // ------------------------------------------------------------ chargement

    async function load() {
      try {
        const [settings, preview] = await Promise.all([
          P.api('/api/xray/settings').catch(() => null),
          P.api('/api/xray/preview', { body: request() }),
        ])
        state.settings = settings
        state.preview = preview
        state.summary = preview.summary
        state.testType = preview.testType
        state.planKey = preview.planKey
        renderForm()
        runChecks()
      } catch (err) {
        P.clear(body)
        body.appendChild(errorBanner(err))
        if (err.status === 409) {
          body.appendChild(h('p', { class: 'p-muted' }, 'Le ticket Test ne peut être envoyé qu’après validation par le testeur.'))
        }
        setFoot(closeBtn('Fermer'))
      }
    }

    const refresh = debounce(async () => {
      const seq = ++state.seq
      previewHost.classList.add('is-loading')
      try {
        const preview = await P.api('/api/xray/preview', { body: request() })
        if (seq !== state.seq) return
        state.preview = preview
        renderPreview()
        renderBanners()
        updateSendButton()
      } catch (err) {
        if (seq !== state.seq) return
        P.clear(previewHost)
        previewHost.appendChild(errorBanner(err))
        sendBtn.disabled = true
      } finally {
        if (seq === state.seq) previewHost.classList.remove('is-loading')
      }
    }, 300)

    async function runChecks() {
      const pv = state.preview
      if (!pv || pv.simulated || !pv.jiraConfigured) return
      state.checking = true
      state.checks = null
      renderChecks()
      try {
        const r = await P.api('/api/xray/preview', { body: request({ check: true }) })
        state.checks = r.checks || []
      } catch (err) {
        state.checks = [{ label: 'Vérifications JIRA', ok: false, message: err.message }]
      } finally {
        state.checking = false
        renderChecks()
      }
    }

    // ------------------------------------------------------------ formulaire

    let bannersHost = null
    let previewHost = null
    let checksHost = null
    let sendBtn = null

    function renderForm() {
      const pv = state.preview
      P.clear(body)

      const head = h('div', { class: 'xp-story' },
        h('div', { class: 'xp-story-main' },
          h('div', { class: 'xp-story-key' }, extLink(pv.story.url && pv.story.source !== 'demo' ? pv.story.url : '', pv.story.key)),
          h('div', { class: 'xp-story-title' }, pv.story.summary || '')),
        h('div', { class: 'xp-story-badges' },
          P.badge(SOURCE_LABEL[pv.source.kind] || pv.source.kind, 'mint'),
          P.badge(pv.modeLabel, pv.simulated ? 'amber' : '')))

      bannersHost = h('div', { class: 'xp-banners' })

      // Résumé
      const summaryInput = h('input', { class: 'p-input', type: 'text', maxlength: '255', id: 'xpSummary', autocomplete: 'off' })
      summaryInput.value = state.summary || ''
      summaryInput.addEventListener('input', () => {
        state.summary = summaryInput.value
        refresh()
      })
      const resetSummary = h('button', { class: 'p-btn p-btn--sm p-btn--ghost', type: 'button', title: 'Revenir au résumé proposé' }, P.icon('refresh'), 'Proposé')
      resetSummary.addEventListener('click', () => {
        summaryInput.value = pv.defaultSummary
        state.summary = pv.defaultSummary
        refresh()
      })

      // Type de test
      const typeSelect = h('select', { class: 'p-select', id: 'xpType' }, (pv.testTypes || [pv.testType]).map((t) => h('option', { value: t, selected: t === state.testType }, t === 'Generic' ? 'Generic (code, sans étapes manuelles)' : t === 'Cucumber' ? 'Cucumber (Gherkin)' : t)))
      typeSelect.addEventListener('change', () => {
        state.testType = typeSelect.value
        refresh()
      })

      const form = h('div', { class: 'p-form-grid xp-form' },
        h('div', { class: 'p-field span-2' },
          h('label', { for: 'xpSummary' }, 'Résumé du ticket Test'),
          h('div', { class: 'xp-inline' }, summaryInput, resetSummary)),
        h('div', { class: 'p-field' },
          h('label', { for: 'xpType' }, 'Type de test Xray'),
          typeSelect,
          h('div', { class: 'p-hint' }, pv.source.kind === 'playwright' ? 'Le code Playwright et ses étapes forment la définition du test.' : 'Les scénarios Gherkin validés forment la définition du test.')),
        planField())

      previewHost = h('div', { class: 'xp-preview' })
      checksHost = h('div', { class: 'xp-checks' })

      body.append(head, bannersHost, form, previewHost, checksHost)
      renderBanners()
      renderPreview()
      renderChecks()

      sendBtn = h('button', { class: 'p-btn p-btn--primary', type: 'button' }, P.icon('upload'), pv.simulated ? 'Simuler l’envoi' : 'Envoyer dans JIRA')
      sendBtn.addEventListener('click', send)
      setFoot(closeBtn(), sendBtn)
      updateSendButton()
    }

    function updateSendButton() {
      if (!sendBtn) return
      const pv = state.preview
      const ok = pv && (pv.simulated || (pv.jiraConfigured && (pv.xrayConfigured || state.jiraOnly)))
      const planOk = !state.planKey || ISSUE_KEY_RE.test(state.planKey)
      sendBtn.disabled = !ok || !planOk || !String(state.summary || '').trim()
      P.clear(sendBtn)
      P.append(sendBtn, [P.icon('upload'), pv?.simulated ? 'Simuler l’envoi' : pv?.action === 'update' ? 'Mettre à jour dans JIRA' : 'Envoyer dans JIRA'])
    }

    function renderBanners() {
      const pv = state.preview
      P.clear(bannersHost)
      if (pv.simulated) {
        bannersHost.appendChild(P.banner('warn', [
          h('strong', null, 'Envoi simulé. '),
          pv.simulationReason === 'demo'
            ? 'Ce récit provient des données de démonstration : rien ne sera créé dans JIRA, la clé du ticket Test sera fictive.'
            : 'Mode essai : rien ne sera créé dans JIRA, la clé du ticket Test sera fictive.',
        ]))
      } else if (!pv.jiraConfigured) {
        bannersHost.appendChild(P.banner('error', [
          h('strong', null, 'JIRA n’est pas connecté. '),
          'Renseignez l’adresse de JIRA et votre jeton dans ',
          h('a', { href: '/connaissance.html' }, 'Prise de connaissance'),
          ', puis revenez envoyer le test.',
        ]))
      } else if (!pv.xrayConfigured) {
        const jiraOnly = h('input', { type: 'checkbox', checked: state.jiraOnly })
        jiraOnly.addEventListener('change', () => {
          state.jiraOnly = jiraOnly.checked
          refresh()
          updateSendButton()
        })
        bannersHost.appendChild(P.banner('info', [
          h('strong', null, 'Xray n’est pas configuré. '),
          'Pour créer un vrai test Xray (définition, plan de test), renseignez la clé d’API Xray dans ',
          h('a', { href: '/reglages.html#jira-xray' }, 'Réglages › JIRA / Xray'),
          '.',
          pv.canJiraOnly ? h('label', { class: 'p-check xp-check' }, jiraOnly, 'Créer seulement le ticket Test dans JIRA (sans Xray : le code ou le Gherkin va dans la description)') : null,
        ]))
      }
      // Avec « nouveau ticket », l'aperçu ne renvoie plus l'envoi existant : on garde le dernier connu pour pouvoir décocher.
      if (pv.existing) state.lastExisting = pv.existing
      const existing = pv.existing || (state.forceNew ? state.lastExisting : null)
      if (existing) {
        const forceNew = h('input', { type: 'checkbox', checked: state.forceNew })
        forceNew.addEventListener('change', () => {
          state.forceNew = forceNew.checked
          refresh()
        })
        bannersHost.appendChild(P.banner('blue', [
          h('strong', null, `Déjà envoyé ${P.fmtAgo(existing.updatedAt || existing.pushedAt)} : `),
          extLink(existing.testUrl, existing.testKey),
          existing.simulated ? ' (simulé)' : '',
          state.forceNew ? '. Un nouveau ticket Test sera créé ; le précédent reste dans JIRA.' : '. Un nouvel envoi met à jour ce ticket, sans créer de doublon de lien.',
          h('label', { class: 'p-check xp-check' }, forceNew, 'Créer un nouveau ticket Test à la place'),
        ]))
      } else if (state.forceNew) {
        bannersHost.appendChild(P.banner('blue', 'Un nouveau ticket Test sera créé, même si ce récit a déjà été envoyé.'))
      }
    }

    // ------------------------------------------------------------ plan de test (autocomplétion)

    function planField() {
      const input = h('input', { class: 'p-input', type: 'text', id: 'xpPlan', autocomplete: 'off', placeholder: 'Aucun — tapez une clé ou un mot', role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': 'false' })
      input.value = state.planKey || ''
      const list = h('div', { class: 'xp-suggest', role: 'listbox', hidden: true })
      const hint = h('div', { class: 'p-hint' })
      let items = []
      let active = -1

      function setHint() {
        const def = state.preview?.defaultTestPlanKey
        P.clear(hint)
        if (state.planKey && !ISSUE_KEY_RE.test(state.planKey)) {
          hint.append('Clé invalide : choisissez un plan dans la liste ou saisissez une clé (ex. IRMA-120).')
          hint.classList.add('xp-hint-error')
          return
        }
        hint.classList.remove('xp-hint-error')
        hint.append(def ? `Plan par défaut des réglages : ${def}.` : 'Facultatif : le test peut être ajouté à un plan de test Xray.')
      }

      function choose(planKey) {
        state.planKey = planKey
        input.value = planKey
        hideList()
        setHint()
        updateSendButton()
        refresh()
      }

      function hideList() {
        list.hidden = true
        input.setAttribute('aria-expanded', 'false')
        active = -1
      }

      function renderList(plans, simulated) {
        P.clear(list)
        items = plans
        if (!plans.length) {
          list.appendChild(h('div', { class: 'xp-suggest-empty' }, 'Aucun plan de test trouvé.'))
        }
        plans.forEach((p, i) => {
          list.appendChild(h('button', {
            class: `xp-suggest-item ${i === active ? 'active' : ''}`,
            type: 'button',
            role: 'option',
            onmousedown: (e) => { e.preventDefault(); choose(p.key) },
          }, h('span', { class: 'p-mono xp-suggest-key' }, p.key), h('span', { class: 'xp-suggest-sum' }, p.summary), p.status ? h('span', { class: 'p-faint' }, p.status) : null))
        })
        if (simulated) list.appendChild(h('div', { class: 'xp-suggest-empty' }, 'Plans de démonstration (fictifs).'))
        list.hidden = false
        input.setAttribute('aria-expanded', 'true')
      }

      const search = debounce(async (all) => {
        try {
          // À l'ouverture, une clé déjà choisie n'est pas un filtre : on liste tous les plans.
          const q = all === true && ISSUE_KEY_RE.test(input.value.trim().toUpperCase()) ? '' : input.value.trim()
          const r = await P.api(`/api/xray/plans?q=${encodeURIComponent(q)}`)
          if (document.activeElement === input) renderList(r.plans || [], r.simulated)
        } catch (err) {
          P.clear(list)
          list.appendChild(h('div', { class: 'xp-suggest-empty' }, `Recherche impossible : ${err.message}`))
          list.hidden = false
        }
      }, 250)

      input.addEventListener('input', () => {
        state.planKey = input.value.trim().toUpperCase()
        setHint()
        updateSendButton()
        search()
        if (!state.planKey || ISSUE_KEY_RE.test(state.planKey)) refresh()
      })
      input.addEventListener('focus', () => search(true))
      input.addEventListener('blur', () => setTimeout(hideList, 120))
      input.addEventListener('keydown', (e) => {
        if (list.hidden || !items.length) return
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault()
          active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
          renderList(items)
        } else if (e.key === 'Enter' && active >= 0) {
          e.preventDefault()
          choose(items[active].key)
        } else if (e.key === 'Escape') {
          e.stopPropagation()
          hideList()
        }
      })

      const none = h('button', { class: 'p-btn p-btn--sm p-btn--ghost', type: 'button', title: 'Ne pas ajouter à un plan de test' }, 'Aucun')
      none.addEventListener('click', () => choose(''))
      const def = state.preview?.defaultTestPlanKey
      const defBtn = def ? h('button', { class: 'p-btn p-btn--sm p-btn--ghost', type: 'button', title: 'Plan par défaut des réglages' }, 'Par défaut') : null
      if (defBtn) defBtn.addEventListener('click', () => choose(def))
      setHint()

      return h('div', { class: 'p-field' },
        h('label', { for: 'xpPlan' }, 'Plan de test (facultatif)'),
        h('div', { class: 'xp-inline xp-combo' }, h('div', { class: 'xp-combo-box' }, input, list), none, defBtn),
        hint)
    }

    // ------------------------------------------------------------ aperçu

    function renderPreview() {
      const pv = state.preview
      P.clear(previewHost)
      const ops = h('ol', { class: 'xp-ops' }, pv.operations.map((op) => h('li', { class: `xp-op xp-op--${op.action}` },
        h('span', { class: 'xp-op-icon' }, P.icon(OP_ICON[op.action] || 'info', 14)),
        h('span', null, op.label, op.testKey && pv.simulated ? h('span', { class: 'p-faint' }, ` — clé fictive ${op.testKey}`) : null))))

      const def = pv.definition || {}
      const defBody = def.kind === 'gherkin'
        ? h('pre', { class: 'p-gherkin xp-def', html: P.gherkinHtml(def.text) })
        : h('pre', { class: 'p-code xp-def' }, def.text)
      const details = h('details', { class: 'xp-details' },
        h('summary', null, def.kind === 'gherkin' ? 'Définition Gherkin envoyée' : 'Définition envoyée (code et étapes)', def.relPath ? h('span', { class: 'p-faint' }, ` — ${def.relPath}`) : null),
        defBody)

      previewHost.appendChild(P.card({
        title: 'Aperçu',
        sub: pv.action === 'update' ? 'Ce qui sera mis à jour' : 'Ce qui sera créé',
        icon: 'eye',
        body: [
          ops,
          h('div', { class: 'xp-meta' },
            h('span', null, 'Type d’issue : ', h('strong', null, pv.issueType)),
            h('span', null, 'Lien : ', h('strong', null, pv.linkType)),
            h('span', { class: 'xp-labels' }, 'Étiquettes : ', (pv.labels || []).map((l) => P.badge(l)))),
          details,
        ],
      }))
    }

    function renderChecks() {
      if (!checksHost) return
      P.clear(checksHost)
      if (state.checking) {
        checksHost.appendChild(h('div', { class: 'xp-checking' }, h('span', { class: 'p-spinner' }), 'Vérifications dans JIRA…'))
        return
      }
      if (!state.checks?.length) return
      const bad = state.checks.filter((c) => !c.ok)
      checksHost.appendChild(h('ul', { class: 'xp-checklist' }, state.checks.map((c) => h('li', { class: c.ok ? 'ok' : 'ko' },
        P.icon(c.ok ? 'checkCircle' : 'alert', 14), h('strong', null, c.label), c.message ? h('span', null, ` — ${c.message}`) : null))))
      if (bad.length) checksHost.prepend(P.banner('warn', `${bad.length} vérification(s) en échec : l’envoi risque d’échouer.`))
    }

    // ------------------------------------------------------------ envoi

    const STATE_MAP = { done: 'done', failed: 'failed', skipped: 'skipped', running: 'running', todo: 'todo' }

    function stepperFor(steps) {
      return P.stepper(steps.map((s) => ({ label: s.label, sub: s.message || (s.state === 'running' ? 'En cours…' : s.state === 'todo' ? 'En attente' : ''), state: STATE_MAP[s.state] || 'todo' })))
    }

    async function send() {
      if (state.sending) return
      state.sending = true
      const pv = state.preview
      const planned = [
        { id: 'test', label: pv.action === 'update' ? 'Mise à jour du ticket Test' : 'Création du ticket Test', state: 'running' },
        { id: 'link', label: `Lien avec ${key}`, state: 'todo' },
        { id: 'plan', label: state.planKey ? `Plan ${state.planKey}` : 'Plan de test', state: state.planKey ? 'todo' : 'skipped', message: state.planKey ? '' : 'Aucun' },
      ]
      P.clear(body)
      const progress = h('div', { class: 'xp-progress' }, stepperFor(planned))
      body.append(progress, h('p', { class: 'p-muted xp-wait' }, pv.simulated ? 'Simulation de l’envoi…' : 'Envoi vers JIRA en cours…'))
      setFoot(h('button', { class: 'p-btn', type: 'button', disabled: true }, h('span', { class: 'p-spinner' }), 'Envoi…'))
      try {
        const result = await P.api('/api/xray/push', { body: request() })
        renderResult(result)
        if (typeof onDone === 'function') {
          try { onDone(result) } catch (e) { console.error(e) }
        }
      } catch (err) {
        renderFailure(err, planned)
      } finally {
        state.sending = false
      }
    }

    function renderResult(r) {
      P.clear(body)
      const steps = r.steps.map((s, i) => ({ ...s, label: ['Ticket Test', `Lien avec ${key}`, 'Plan de test'][i] || s.label }))
      body.appendChild(h('div', { class: 'xp-progress' }, stepperFor(steps)))
      const okAll = r.steps.every((s) => s.state === 'done' || s.state === 'skipped')
      const title = r.simulated
        ? `Ticket Test ${r.testKey} ${r.updated ? 'mis à jour' : 'créé'} (simulation)`
        : `Ticket Test ${r.testKey} ${r.updated ? 'mis à jour' : 'créé'} dans JIRA`
      body.appendChild(h('div', { class: `xp-result ${okAll ? 'ok' : 'partial'}` },
        h('span', { class: 'xp-result-icon' }, P.icon(okAll ? 'checkCircle' : 'alert', 22)),
        h('div', null,
          h('div', { class: 'xp-result-title' }, title),
          h('div', { class: 'xp-result-links' },
            h('span', null, 'Test : ', r.simulated ? h('strong', null, r.testKey) : extLink(r.testUrl, r.testKey)),
            h('span', null, 'Récit : ', extLink(r.simulated && state.preview?.story?.source === 'demo' ? '' : r.storyUrl, r.storyKey)),
            r.planKey ? h('span', null, 'Plan : ', r.simulated ? h('strong', null, r.planKey) : extLink(r.testUrl ? r.testUrl.replace(/[^/]+$/, r.planKey) : '', r.planKey)) : null),
          r.simulated ? h('div', { class: 'p-hint' }, 'Aucune donnée n’a été envoyée : la clé est fictive et enregistrée dans l’historique comme simulée.') : null)))
      for (const w of r.warnings || []) body.appendChild(P.banner(r.simulated ? 'info' : 'warn', w))
      const done = h('button', { class: 'p-btn p-btn--primary', type: 'button', onclick: () => dlg.close() }, P.icon('check'), 'Terminer')
      const history = h('a', { class: 'p-btn p-btn--ghost', href: '/reglages.html#jira-xray' }, 'Historique des envois')
      setFoot(history, done)
      P.toast(r.simulated ? `Envoi simulé : ${r.testKey}` : `${r.testKey} ${r.updated ? 'mis à jour' : 'créé'} dans JIRA`)
    }

    function renderFailure(err, planned) {
      P.clear(body)
      const steps = err?.data?.details?.steps
      body.appendChild(h('div', { class: 'xp-progress' }, stepperFor(steps || planned.map((s, i) => (i === 0 ? { ...s, state: 'failed', message: 'Échec' } : s)))))
      const code = err?.data?.details?.code
      const extra = code === 'XRAY_CONFIG' || code === 'XRAY_AUTH' || code === 'ISSUE_TYPE' || code === 'LINK_TYPE'
        ? h('div', { class: 'xp-hint' }, h('a', { href: '/reglages.html#jira-xray' }, 'Ouvrir Réglages › JIRA / Xray'))
        : code === 'JIRA_AUTH' || code === 'JIRA_CONFIG'
          ? h('div', { class: 'xp-hint' }, h('a', { href: '/connaissance.html' }, 'Ouvrir la connexion JIRA (Prise de connaissance)'))
          : null
      body.appendChild(errorBanner(err, extra))
      const back = h('button', { class: 'p-btn', type: 'button' }, P.icon('arrowRight'), 'Revenir à l’aperçu')
      back.addEventListener('click', () => {
        renderForm()
        runChecks()
      })
      setFoot(closeBtn('Fermer'), back)
    }

    load()
    return dlg
  }

  window.XrayPush = { open }
})()

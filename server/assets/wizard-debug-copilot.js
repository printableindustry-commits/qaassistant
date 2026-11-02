/**
 * Prompt DEBUG Copilot — UI unifiée (loader, modale prompt, contrôle DEBUG IA).
 * Registre page : WizardDebugPage.register(scope, { getPageLog, getLastExecution, buildPromptOpts })
 */
;(function (global) {
  const COPILOT_LOGO = '/assets/logo-github-copilot.png'
  const QA_LOGO = '/assets/logo-qa.png'
  const COPY_SVG = `<svg class="copilot-copy-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 18H8V7h11v16z"/></svg>`

  const PAGE_KEY_TO_SCOPE = {
    hookGit: 'hook-git',
    syncJira: 'sync-jira',
    nodeInstall: 'node-install',
    npmrc: 'npmrc',
    npmInstall: 'npm-install',
    cypressInstall: 'cypress-install',
    playwrightInstall: 'playwright-install',
    robotInstall: 'robot-install',
    postmanInstall: 'postman-install',
    k6Install: 'k6-install',
    docQa: 'doc-qa',
  }

  const pageAdapters = Object.create(null)

  function apiUrl(path) {
    const base = global.__WIZARD_API_BASE__ || ''
    return base ? `${base.replace(/\/$/, '')}${path}` : path
  }

  function assetUrl(path) {
    const ver = global.__WIZARD_VERSION__
    const base = global.__WIZARD_API_BASE__ || ''
    const rel = path.startsWith('/') ? path : `/${path}`
    const q = ver ? `?v=${encodeURIComponent(ver)}` : ''
    return base ? `${base.replace(/\/$/, '')}${rel}${q}` : `${rel}${q}`
  }

  function getPageKey() {
    if (global.WizardDisclaimer?.getCurrentPageKey) {
      return global.WizardDisclaimer.getCurrentPageKey()
    }
    const body = global.document?.body
    if (!body) return 'unknown'
    if (body.classList.contains('page-hook-git')) return 'hookGit'
    if (body.classList.contains('page-sync-jira')) return 'syncJira'
    if (body.classList.contains('page-node-install')) return 'nodeInstall'
    if (body.classList.contains('page-npmrc')) return 'npmrc'
    if (body.classList.contains('page-npm-install')) return 'npmInstall'
    if (body.classList.contains('page-cypress-install')) return 'cypressInstall'
    if (body.classList.contains('page-playwright-install')) return 'playwrightInstall'
    if (body.classList.contains('page-robot-install')) return 'robotInstall'
    if (body.classList.contains('page-postman-install')) return 'postmanInstall'
    if (body.classList.contains('page-k6-install')) return 'k6Install'
    if (body.classList.contains('page-doc-qa')) return 'docQa'
    return 'unknown'
  }

  function getScope() {
    const key = getPageKey()
    return PAGE_KEY_TO_SCOPE[key] || null
  }

  function isDebugPage() {
    return Boolean(getScope())
  }

  const WizardDebugPage = {
    register(scope, adapter = {}) {
      pageAdapters[scope] = { ...pageAdapters[scope], ...adapter }
    },
    getAdapter(scope) {
      return pageAdapters[scope] || {}
    },
    getScope,
    isDebugPage,
  }

  function buildDefaultPromptOpts(scope) {
    const adapter = pageAdapters[scope] || {}
    const pageLog = adapter.getPageLog?.() || ''
    const lastExecution = adapter.getLastExecution?.() || ''
    const base = adapter.buildPromptOpts?.() || {}
    return {
      scope,
      pagePath: global.location?.pathname || '',
      pageLog,
      lastExecution,
      log: [pageLog, lastExecution].filter(Boolean).join('\n\n'),
      title: base.title || `Debug ${scope} — Wizard QA`,
      context: base.context || `Analyse DEBUG depuis la page ${scope}.`,
      error: base.error || '',
      environment: {
        Page: scope,
        ...(base.environment || {}),
      },
      stepsToReproduce: base.stepsToReproduce || base.steps || [],
      suggestedQuestions: base.suggestedQuestions || base.questions || [],
      enrich: base.enrich !== false,
      agentModel: base.agentModel || 'Claude Sonnet 4.6',
      ...base,
    }
  }

  function qaSpinnerMarkup(className = '') {
    const extra = className ? ` ${className}` : ''
    return `<div class="hub-disclaimer-spinner${extra}" role="img" aria-label="QA">
      <div class="hub-disclaimer-spinner-ring" aria-hidden="true"></div>
      <img class="hub-disclaimer-logo" src="${assetUrl(QA_LOGO)}" alt="QA" width="34" height="34" />
    </div>`
  }

  function setControlStep(step) {
    const step1 = global.document.getElementById('wizardDebugControlStep1')
    const step2 = global.document.getElementById('wizardDebugControlStep2')
    if (step1) step1.hidden = step !== 1
    if (step2) step2.hidden = step !== 2
  }

  function ensureGenModal() {
    let el = global.document.getElementById('wizardDebugGenModal')
    if (el) return el
    el = global.document.createElement('div')
    el.id = 'wizardDebugGenModal'
    el.className = 'wizard-debug-gen-modal'
    el.hidden = true
    el.innerHTML = `
      <div class="wizard-debug-gen-backdrop"></div>
      <div class="wizard-debug-gen-panel card card-compact" role="dialog" aria-labelledby="wizardDebugGenTitle">
        <header class="wizard-debug-gen-head">
          ${qaSpinnerMarkup('wizard-debug-gen-spinner')}
          <h2 id="wizardDebugGenTitle" class="wizard-debug-gen-title">Génération du prompt DEBUG</h2>
        </header>
        <ul class="wizard-debug-gen-steps" id="wizardDebugGenSteps">
          <li data-step="verbose"><span class="wizard-debug-gen-step-icon">…</span> Génération des logs verbeux</li>
          <li data-step="prompt"><span class="wizard-debug-gen-step-icon">…</span> Génération du prompt</li>
        </ul>
      </div>`
    global.document.body.appendChild(el)
    return el
  }

  function setGenStep(step, state) {
    const li = global.document.getElementById('wizardDebugGenSteps')?.querySelector(`[data-step="${step}"]`)
    if (!li) return
    const icon = li.querySelector('.wizard-debug-gen-step-icon')
    if (state === 'active') {
      li.classList.add('is-active')
      li.classList.remove('is-done')
      if (icon) icon.textContent = '…'
    } else if (state === 'done') {
      li.classList.remove('is-active')
      li.classList.add('is-done')
      if (icon) icon.textContent = '✓'
    }
  }

  function showGenModal() {
    const modal = ensureGenModal()
    setGenStep('verbose', 'active')
    setGenStep('prompt', '')
    modal.hidden = false
    global.document.body.classList.add('wizard-debug-gen-open')
  }

  function hideGenModal() {
    const modal = global.document.getElementById('wizardDebugGenModal')
    if (modal) modal.hidden = true
    global.document.body.classList.remove('wizard-debug-gen-open')
  }

  const PROMPT_MODAL_VERSION = '3'
  const PROMPT_NEXT_STEP_HTML = 'Une fois le prompt copié dans votre agent IA, <strong>fermez cette fenêtre</strong> (×) pour passer au <strong>Contrôle DEBUG IA</strong> et indiquer si le problème est résolu.'

  function setPromptNextStep(visible) {
    const el = global.document.getElementById('copilotDebugNextStep')
    if (!el) return
    if (visible) {
      el.innerHTML = PROMPT_NEXT_STEP_HTML
      el.hidden = false
    } else {
      el.hidden = true
    }
  }

  function ensurePromptModal() {
    let el = global.document.getElementById('copilotDebugModal')
    if (el && el.dataset.promptVersion !== PROMPT_MODAL_VERSION) {
      el.remove()
      el = null
    }
    if (el) return el
    el = global.document.createElement('div')
    el.id = 'copilotDebugModal'
    el.className = 'copilot-debug-modal'
    el.hidden = true
    el.innerHTML = `
      <div class="copilot-debug-backdrop" data-copilot-close></div>
      <div class="copilot-debug-panel" role="dialog" aria-labelledby="copilotDebugTitle" aria-modal="true">
        <header class="copilot-debug-head">
          ${qaSpinnerMarkup('copilot-debug-spinner')}
          <div class="copilot-debug-head-row">
            <span class="copilot-debug-brand-text">Prompt DEBUG Copilot</span>
            <span class="copilot-debug-tokens" id="copilotDebugTokens" title="Estimation tokens agent"></span>
            <button type="button" class="copilot-debug-close" data-copilot-close title="Fermer" aria-label="Fermer">×</button>
          </div>
        </header>
        <div class="copilot-debug-preflight" id="copilotDebugPreflight" hidden></div>
        <h2 id="copilotDebugTitle" class="copilot-debug-title"></h2>
        <p class="copilot-debug-lead">Copiez ce prompt dans un chat <strong>agent IA</strong> (GitHub Copilot, Claude Sonnet, VS Code…) pour analyser le problème.</p>
        <div class="copilot-debug-terminal-wrap">
          <pre class="copilot-debug-terminal" id="copilotDebugPre" tabindex="0"></pre>
          <button type="button" class="copilot-debug-copy" id="copilotDebugCopy" title="Copier le prompt">${COPY_SVG}<span>Copier</span></button>
        </div>
        <div class="copilot-debug-actions">
          <button type="button" class="copilot-debug-action-btn" id="copilotDebugSave" title="Sauvegarder en .md">Sauvegarder .md</button>
          <button type="button" class="copilot-debug-action-btn" id="copilotDebugRegen" title="Regénérer">↻ Régénérer</button>
          <button type="button" class="copilot-debug-action-btn copilot-debug-action-btn--logs" id="copilotDebugLogs" title="Ouvrir les logs DEBUG du scope">Dossier logs</button>
        </div>
        <p class="copilot-debug-hint" id="copilotDebugHint"></p>
        <p class="copilot-debug-next-step" id="copilotDebugNextStep" hidden></p>
      </div>`
    el.dataset.promptVersion = PROMPT_MODAL_VERSION
    global.document.body.appendChild(el)
    el.querySelectorAll('[data-copilot-close]').forEach((btn) => {
      btn.addEventListener('click', () => WizardDebugCopilot.closePrompt())
    })
    global.document.getElementById('copilotDebugCopy')?.addEventListener('click', () => WizardDebugCopilot.copy())
    global.document.getElementById('copilotDebugSave')?.addEventListener('click', () => WizardDebugCopilot.saveMd())
    global.document.getElementById('copilotDebugRegen')?.addEventListener('click', () => WizardDebugCopilot.regenerate())
    global.document.getElementById('copilotDebugLogs')?.addEventListener('click', () => WizardDebugCopilot.openLogsFolder())
    global.document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !el.hidden) WizardDebugCopilot.closePrompt()
    })
    return el
  }

  const CONTROL_MODAL_VERSION = '4'

  function bindControlModalEvents(el) {
    el.querySelector('#wizardDebugResolvedYes')?.addEventListener('click', () => WizardDebugCopilot.resolveYes())
    el.querySelector('#wizardDebugResolvedNo')?.addEventListener('click', () => WizardDebugCopilot.resolveNo())
    el.querySelector('#wizardDebugRegenFromControl')?.addEventListener('click', () => WizardDebugCopilot.regenerateFromControl())
  }

  function ensureControlModal() {
    let el = global.document.getElementById('wizardDebugControlModal')
    const outdated = el && (
      el.dataset.controlVersion !== CONTROL_MODAL_VERSION
      || !el.querySelector('#wizardDebugControlStep1')
      || !el.querySelector('#wizardDebugControlStep2')
    )
    if (outdated) {
      el.remove()
      el = null
    }
    if (el) return el
    el = global.document.createElement('div')
    el.id = 'wizardDebugControlModal'
    el.className = 'wizard-debug-control-modal'
    el.hidden = true
    el.innerHTML = `
      <div class="wizard-debug-control-backdrop"></div>
      <div class="wizard-debug-control-panel card card-compact" role="dialog" aria-labelledby="wizardDebugControlTitle">
        <header class="wizard-debug-control-head">
          ${qaSpinnerMarkup('wizard-debug-control-spinner')}
          <h2 id="wizardDebugControlTitle" class="wizard-debug-control-title">Contrôle de DEBUG IA</h2>
        </header>
        <div id="wizardDebugControlStep1" class="wizard-debug-control-step">
          <p class="wizard-debug-control-lead" id="wizardDebugControlLead">Le prompt précédent, qui a été généré à partir des fichiers de logs de la fonction qui n'a pas fonctionné, a-t-il permis à l'agent de réparer la fonctionnalité ?</p>
          <div class="wizard-debug-control-actions" id="wizardDebugControlActions">
            <button type="button" class="btn-primary btn-sm" id="wizardDebugResolvedYes">OUI</button>
            <button type="button" class="btn-secondary btn-sm" id="wizardDebugResolvedNo">NON</button>
          </div>
          <p class="wizard-debug-control-note"><strong>En cliquant sur Non le script reprendra les logs de la dernière exécution et vous aurez la possibilité d'enrichir le prompt. Cette incrémentation sera possible jusqu'à la résolution de votre problème.</strong></p>
        </div>
        <div id="wizardDebugControlStep2" class="wizard-debug-control-step wizard-debug-enrich-block" hidden>
          <textarea id="wizardDebugEnrichText" class="wizard-debug-enrich-text" rows="4" placeholder="Enrichissement optionnel : décrivez ce que vous avez essayé, les messages d'erreur, le contexte supplémentaire…"></textarea>
          <button type="button" class="btn-primary btn-sm" id="wizardDebugRegenFromControl">Générer le prompt avec les logs de la dernière exécution</button>
        </div>
      </div>`
    el.dataset.controlVersion = CONTROL_MODAL_VERSION
    global.document.body.appendChild(el)
    bindControlModalEvents(el)
    return el
  }

  function renderPreflight(preflight) {
    const el = global.document.getElementById('copilotDebugPreflight')
    if (!el || !preflight) {
      if (el) el.hidden = true
      return
    }
    const badges = []
    if (preflight.hookOk != null) badges.push(`<span class="copilot-preflight-badge ${preflight.hookOk ? 'ok' : 'warn'}">Hook ${preflight.hookOk ? 'OK' : 'KO'}</span>`)
    if (preflight.dryRunOk != null) badges.push(`<span class="copilot-preflight-badge ${preflight.dryRunOk ? 'ok' : 'warn'}">Dry-run ${preflight.dryRunOk ? 'OK' : 'KO'}</span>`)
    badges.push(`<span class="copilot-preflight-badge">Logs scope : ${preflight.verboseLogsCount ?? 0}</span>`)
    if (preflight.koCount > 0) badges.push(`<span class="copilot-preflight-badge warn">${preflight.koCount} check(s) KO</span>`)
    el.innerHTML = badges.join('')
    el.hidden = badges.length === 0
  }

  const WizardDebugCopilot = {
    _prompt: '',
    _lastOpts: null,
    _scope: null,
    _sessionActive: false,
    _pendingControl: false,

    async syncActiveSession() {
      const scope = getScope()
      if (!scope) {
        this._sessionActive = false
        return false
      }
      try {
        const pagePath = global.location?.pathname || ''
        const r = await fetch(apiUrl(`/api/debug/session/status?scope=${encodeURIComponent(scope)}&pagePath=${encodeURIComponent(pagePath)}`))
        const data = await r.json()
        if (data.active && data.session) {
          this._sessionActive = true
          this._scope = scope
          return true
        }
        this._sessionActive = false
        return false
      } catch {
        return this._sessionActive
      }
    },

    async checkSessionOnLoad() {
      await this.syncActiveSession()
    },

    async startFlow() {
      const scope = getScope()
      if (!scope) {
        global.Portail?.showToast?.('Page sans support DEBUG', { type: 'warn' })
        return
      }
      this._scope = scope
      if (await this.syncActiveSession()) {
        this.showControl()
        return
      }
      const opts = buildDefaultPromptOpts(scope)
      this._lastOpts = opts
      showGenModal()
      try {
        setGenStep('verbose', 'active')
        const r = await fetch(apiUrl('/api/debug/session/start'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(opts),
        })
        const data = await r.json()
        if (!r.ok) throw new Error(data.error || 'Échec génération')
        setGenStep('verbose', 'done')
        setGenStep('prompt', 'active')
        await new Promise((res) => setTimeout(res, 350))
        setGenStep('prompt', 'done')
        await new Promise((res) => setTimeout(res, 250))
        hideGenModal()
        this._sessionActive = true
        this._pendingControl = true
        this.openPrompt({
          title: data.title || opts.title,
          prompt: data.prompt,
          tokenEstimate: data.tokenEstimate,
          promptSizeKb: data.promptSizeKb,
          preflight: data.preflight,
          hasWizardSection: data.hasWizardSection,
        })
      } catch (err) {
        hideGenModal()
        global.Portail?.showToast?.(err.message, { type: 'err' })
      }
    },

    openPrompt({ title, prompt, tokenEstimate, promptSizeKb, preflight, hasWizardSection } = {}) {
      ensurePromptModal()
      this._prompt = String(prompt || '')
      const titleEl = global.document.getElementById('copilotDebugTitle')
      const pre = global.document.getElementById('copilotDebugPre')
      const hint = global.document.getElementById('copilotDebugHint')
      const tokensEl = global.document.getElementById('copilotDebugTokens')
      if (titleEl) titleEl.textContent = title || 'Debug'
      if (pre) {
        pre.textContent = this._prompt
        pre.scrollTop = 0
      }
      if (tokensEl) {
        tokensEl.textContent = tokenEstimate ? `~${tokenEstimate.toLocaleString('fr-FR')} tokens` : ''
      }
      renderPreflight(preflight)
      if (hint) {
        const kb = promptSizeKb || Math.round(this._prompt.length / 1024)
        hint.textContent = hasWizardSection
          ? `Prompt enrichi (~${kb} Ko) — diagnostic et mémoire projet inclus.`
          : `Prompt (~${kb} Ko).`
        hint.className = 'copilot-debug-hint is-ok'
      }
      setPromptNextStep(this._sessionActive || this._pendingControl)
      const modal = global.document.getElementById('copilotDebugModal')
      if (modal) modal.hidden = false
      global.document.body.classList.add('copilot-debug-open')
    },

    closePrompt() {
      const modal = global.document.getElementById('copilotDebugModal')
      if (modal) modal.hidden = true
      global.document.body.classList.remove('copilot-debug-open')
      if (this._pendingControl && this._sessionActive) {
        this._pendingControl = false
        this.showControl()
      }
    },

    showControl() {
      if (!this._sessionActive) return
      const modal = ensureControlModal()
      setControlStep(1)
      const ta = global.document.getElementById('wizardDebugEnrichText')
      if (ta) ta.value = ''
      modal.hidden = false
      global.document.body.classList.add('wizard-debug-control-open')
    },

    hideControl() {
      const modal = global.document.getElementById('wizardDebugControlModal')
      if (modal) modal.hidden = true
      global.document.body.classList.remove('wizard-debug-control-open')
    },

    resolveNo() {
      setControlStep(2)
    },

    async resolveYes() {
      try {
        const r = await fetch(apiUrl('/api/debug/session/resolve'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ resolution: 'Problème résolu' }),
        })
        const data = await r.json()
        if (!r.ok) throw new Error(data.error || 'Échec clôture session')
        this._sessionActive = false
        this.hideControl()
        global.Portail?.showToast?.('DEBUG clôturé — mémoire projet enregistrée', { type: 'ok' })
      } catch (err) {
        global.Portail?.showToast?.(err.message, { type: 'err' })
      }
    },

    async regenerateFromControl() {
      const enrichment = global.document.getElementById('wizardDebugEnrichText')?.value || ''
      this.hideControl()
      await this.regenerate({ userEnrichment: enrichment })
      this._pendingControl = true
    },

    async regenerate(extra = {}) {
      if (!this._lastOpts) return
      const scope = this._scope || getScope()
      const opts = { ...buildDefaultPromptOpts(scope), ...this._lastOpts, ...extra }
      showGenModal()
      setGenStep('verbose', 'active')
      try {
        const r = await fetch(apiUrl('/api/debug/session/regenerate'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(opts),
        })
        const data = await r.json()
        if (!r.ok) throw new Error(data.error || 'Échec régénération')
        setGenStep('verbose', 'done')
        setGenStep('prompt', 'done')
        await new Promise((res) => setTimeout(res, 300))
        hideGenModal()
        this._pendingControl = true
        this.openPrompt({
          title: data.title || opts.title,
          prompt: data.prompt,
          tokenEstimate: data.tokenEstimate,
          promptSizeKb: data.promptSizeKb,
          preflight: data.preflight,
          hasWizardSection: data.hasWizardSection,
        })
      } catch (err) {
        hideGenModal()
        global.Portail?.showToast?.(err.message, { type: 'err' })
        this.showControl()
      }
    },

    async copy() {
      const hint = global.document.getElementById('copilotDebugHint')
      try {
        await navigator.clipboard.writeText(this._prompt)
        if (hint) {
          hint.textContent = 'Prompt copié dans le presse-papiers.'
          hint.className = 'copilot-debug-hint is-ok'
        }
        global.Portail?.showToast?.('Prompt copié', { type: 'ok' })
      } catch {
        if (hint) {
          hint.textContent = 'Copie impossible — sélectionnez le texte manuellement.'
          hint.className = 'copilot-debug-hint is-err'
        }
      }
    },

    async saveMd() {
      const scope = this._scope || getScope()
      if (!scope || !this._prompt) return
      try {
        const r = await fetch(apiUrl('/api/copilot/debug-prompt/save'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scope, prompt: this._prompt }),
        })
        const data = await r.json()
        if (!r.ok) throw new Error(data.error)
        global.Portail?.showToast?.(`Prompt sauvegardé : ${data.fileName}`, { type: 'ok' })
      } catch (err) {
        global.Portail?.showToast?.(err.message, { type: 'err' })
      }
    },

    async openLogsFolder() {
      const scope = this._scope || getScope()
      try {
        const r = await fetch(apiUrl('/api/wizard/open-folder'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target: 'debug-logs', scope }),
        })
        const data = await r.json()
        if (!r.ok) throw new Error(data.error)
        global.Portail?.showToast?.('Dossier logs DEBUG ouvert', { type: 'ok' })
      } catch (err) {
        global.Portail?.showToast?.(err.message, { type: 'err' })
      }
    },

    /** Compat ancien CopilotDebugPrompt.fromLog */
    async fromLog(opts = {}) {
      this._lastOpts = { ...opts }
      this._scope = opts.scope || getScope()
      showGenModal()
      setGenStep('verbose', 'active')
      try {
        const r = await fetch(apiUrl('/api/debug/session/start'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...opts, scope: this._scope }),
        })
        const data = await r.json()
        if (!r.ok) throw new Error(data.error)
        setGenStep('verbose', 'done')
        setGenStep('prompt', 'done')
        hideGenModal()
        this._sessionActive = true
        this._pendingControl = true
        this.openPrompt({
          title: opts.title || data.title,
          prompt: data.prompt,
          tokenEstimate: data.tokenEstimate,
          promptSizeKb: data.promptSizeKb,
          preflight: data.preflight,
          hasWizardSection: data.hasWizardSection,
        })
        return data
      } catch (err) {
        hideGenModal()
        throw err
      }
    },
  }

  global.WizardDebugPage = WizardDebugPage
  global.WizardDebugCopilot = WizardDebugCopilot

  function teardownDebugUi() {
    hideGenModal()
    ;['wizardDebugGenModal', 'copilotDebugModal', 'wizardDebugControlModal'].forEach((id) => {
      global.document.getElementById(id)?.remove()
    })
    global.document.body.classList.remove(
      'copilot-debug-open',
      'wizard-debug-gen-open',
      'wizard-debug-control-open',
    )
    WizardDebugCopilot._pendingControl = false
    WizardDebugCopilot._prompt = ''
    WizardDebugCopilot._sessionActive = false
  }

  let lastDebugPath = null

  function currentPath() {
    const raw = global.location?.pathname || '/'
    return raw === '/index.html' ? '/' : raw
  }

  function pathIsDebugScope(path) {
    const p = path || currentPath()
    return /\/(hook-git|sync-jira|node-install|npmrc|npm-install|doc-qa)(\.html)?$/i.test(p)
  }

  global.CopilotDebugPrompt = {
    open: (o) => WizardDebugCopilot.openPrompt(o),
    close: () => WizardDebugCopilot.closePrompt(),
    copy: () => WizardDebugCopilot.copy(),
    regenerate: () => WizardDebugCopilot.regenerate(),
    fromLog: (o) => WizardDebugCopilot.fromLog(o),
    openLogsFolder: () => WizardDebugCopilot.openLogsFolder(),
    teardown: () => teardownDebugUi(),
  }

  function boot() {
    const path = currentPath()
    if (lastDebugPath && lastDebugPath !== path) {
      teardownDebugUi()
    }
    lastDebugPath = isDebugPage() ? path : null

    if (!isDebugPage()) return
    WizardDebugCopilot.checkSessionOnLoad()
  }

  function onPageReady(e) {
    const path = String(e?.detail?.path || currentPath())
    if (lastDebugPath && lastDebugPath !== path) {
      teardownDebugUi()
    }
    lastDebugPath = pathIsDebugScope(path) ? path : null
    if (!pathIsDebugScope(path)) return
    WizardDebugCopilot.checkSessionOnLoad()
  }

  if (global.document?.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
  global.addEventListener('wizard:page-ready', onPageReady)
})(typeof window !== 'undefined' ? window : globalThis)

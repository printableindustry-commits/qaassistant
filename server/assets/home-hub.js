window.HomeHub = {
  STEP_IDS: ['welcome', 'stakeholders', 'product', 'jiraQuestion', 'plans'],

  state: {
    stepIndex: 0,
    editMode: false,
    wizardFlow: 'prise',
    catalog: null,
    form: {
      tribu: '',
      squad: '',
      poName: '',
      baName: '',
      scrumMasterName: '',
      qaName: '',
      productCode: '',
      solutionCode: '',
      applicationLabel: '',
      gitRepository: '',
      usesJiraPlans: null,
      jiraBaseUrl: '',
      xrayClientId: '',
      xrayClientSecret: '',
      testPlans: [{ planKey: '', planName: '', testingBoardUrl: '' }],
    },
  },

  stackState: {
    stepIndex: 0,
    questions: [],
    stackIds: ['playwright', 'k6'],
    toolsComparison: [],
    answers: {},
    result: null,
    snapshotPath: '',
    questionnaireConfigPath: '.wizard-qa/conf/stack-questionnaire.conf.json',
    chartColors: {
      playwright: '#62BB46',
      k6: '#7D64FF',
    },
    stackLabels: {
      playwright: 'Playwright',
      k6: 'k6',
    },
    chosenStack: null,
  },

  LOCAL_STACK_KEY: 'wizardQa.localStackChoice',

  isStaleServerError(err) {
    return err?.status === 404 || /not found/i.test(String(err?.message || ''))
  },

  getLocalStackChoice() {
    try {
      const raw = sessionStorage.getItem(this.LOCAL_STACK_KEY)
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  },

  saveLocalStackChoice(stackId, label) {
    try {
      sessionStorage.setItem(this.LOCAL_STACK_KEY, JSON.stringify({
        stackId,
        label,
        answers: { ...this.stackState.answers },
        savedAt: new Date().toISOString(),
      }))
    } catch { /* ignore */ }
  },

  clearLocalStackChoice() {
    try { sessionStorage.removeItem(this.LOCAL_STACK_KEY) } catch { /* ignore */ }
  },

  applyWikiUnlock(catalog) {
    if (!catalog?.sections?.length) return catalog
    return {
      ...catalog,
      sections: catalog.sections.map((section) => ({
        ...section,
        tiles: (section.tiles || []).map((tile) => {
          if (tile.id !== 'wiki') return tile
          const actions = (tile.actions || []).filter((a) => a?.href).map((a) => ({
            ...a,
            href: a.href || '/wiki.html',
            disabled: false,
          }))
          if (!actions.length) {
            actions.push(
              { label: 'Ouvrir le Wiki', href: '/wiki.html' },
              { label: 'Stacks de test', href: '/wiki.html#playwright' },
              { label: 'Hook Git', href: '/wiki.html#hook-install' },
            )
          }
          return {
            ...tile,
            comingSoon: false,
            locked: false,
            href: '/wiki.html',
            status: tile.status === 'pending' ? 'ok' : (tile.status || 'ok'),
            description: tile.description || 'Documentation interactive — parcours Wizard, Hook Git JIRA/Xray',
            message: tile.message === 'Prochainement' ? 'Guide & dépannage' : (tile.message || 'Guide & dépannage'),
            actions,
          }
        }),
      })),
    }
  },

  applyHubCatalogPatches(catalog) {
    return this.applyLocalStackHighlight(
      this.applyNpmChainLayout(this.applyJiraChainLayout(this.applyWikiUnlock(catalog))),
    )
  },

  /** Place la paire Hook Git → Sync JIRA en fin de section (ligne dédiée, réf. v1.19.1). */
  applyJiraChainLayout(catalog) {
    if (!catalog?.sections?.length) return catalog
    const jiraIds = new Set(['hookGit', 'project'])
    return {
      ...catalog,
      sections: catalog.sections.map((section) => {
        if (section.id !== 'config') return section
        const tiles = [...(section.tiles || [])]
        const jiraTiles = tiles.filter((t) => jiraIds.has(t.id))
        const others = tiles.filter((t) => !jiraIds.has(t.id))
        if (jiraTiles.length < 2) return section
        return { ...section, tiles: [...others, ...jiraTiles] }
      }),
    }
  },

  /** Retire npmrc de la section config et normalise la pyramide npm dans Stacks. */
  applyNpmChainLayout(catalog) {
    if (!catalog?.sections?.length) return catalog

    const pyramidTileIds = new Set(['npmrc', 'playwright', 'nodeInstall', 'npmInstall'])

    let npmFromConfig = null
    const sectionsSansNpmConfig = catalog.sections.map((section) => {
      if (section.id !== 'config') return section
      const tiles = (section.tiles || []).filter((tile) => {
        if (tile.id === 'npmrc') {
          npmFromConfig = npmFromConfig || tile
          return false
        }
        return true
      })
      return { ...section, tiles }
    })

    return {
      ...catalog,
      sections: sectionsSansNpmConfig.map((section) => {
        if (section.id !== 'stacks') return section
        const tiles = [...(section.tiles || [])]
        const others = tiles.filter((t) => !pyramidTileIds.has(t.id) && t.id !== '__npmPyramid__')
        const hasPyramid = tiles.some((t) => t.id === '__npmPyramid__' || t.renderAs === 'npmPyramid')
        const pyramidMarker = hasPyramid
          ? (tiles.find((t) => t.id === '__npmPyramid__' || t.renderAs === 'npmPyramid') || { id: '__npmPyramid__', renderAs: 'npmPyramid' })
          : { id: '__npmPyramid__', renderAs: 'npmPyramid' }

        return {
          ...section,
          subtitle: section.subtitle || 'Parcours npm en pyramide — Playwright partage Node et le registry Artifactory',
          tiles: [pyramidMarker, ...others],
        }
      }),
    }
  },

  applyLocalStackHighlight(catalog) {
    if (!catalog?.sections?.length) return catalog
    const local = this.getLocalStackChoice()
    const stackId = local?.stackId || this.stackState.chosenStack || catalog.recommendedStack
    if (!stackId) return catalog
    const label = local?.label
      || this.stackState.stackLabels[stackId]
      || catalog.project?.recommendedStackLabel
      || stackId
    const stackTileIds = ['playwright', 'k6']
    return {
      ...catalog,
      recommendedStack: stackId,
      stackRecommendationComplete: true,
      sections: catalog.sections.map((section) => ({
        ...section,
        tiles: (section.tiles || []).map((tile) => {
          if (!stackTileIds.includes(tile.id)) return tile
          const isRecommended = stackId === tile.id
          const baseClass = (tile.tileClass || '').split(/\s+/).filter((c) => c && c !== 'hub-tile--recommended').join(' ')
          return {
            ...tile,
            recommended: isRecommended,
            tileClass: [baseClass, isRecommended ? 'hub-tile--recommended' : ''].filter(Boolean).join(' '),
            message: isRecommended ? 'Solution adaptée à votre profil' : tile.message,
          }
        }),
      })),
    }
  },

  async ensureStackToolsComparison() {
    if (this.stackState.toolsComparison?.length) return this.stackState.toolsComparison
    try {
      const r = await fetch(this.apiUrl('/assets/stack-tools-comparison-data.json'))
      if (r.ok) {
        const data = await r.json()
        this.stackState.toolsComparison = data.toolsComparison || data.tools || []
      }
    } catch { /* ignore */ }
    return this.stackState.toolsComparison || []
  },

  applyStackChoiceLocally(stackId, label) {
    if (this.stackState.result) {
      this.stackState.result.recommendedStack = stackId
      this.stackState.result.recommendedLabel = label
    }
    this.stackState.chosenStack = stackId
    this.stackState._localOnly = true
    this.saveLocalStackChoice(stackId, label)
  },

  async tryPersistStackToServer(forcedStackId) {
    if (!this.stackState._localOnly || !this.stackState.answers) return false
    try {
      const res = await this.apiFetch('/api/project/stack-recommendation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: this.stackState.answers }),
      })
      this.stackState.result = res.recommendation
      this.stackState.snapshotPath = res.snapshotPath || this.stackState.snapshotPath
      const stackId = forcedStackId || this.stackState.chosenStack || res.recommendation?.recommendedStack
      if (stackId) {
        await this.apiFetch('/api/project/stack-choice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stackId }),
        })
        this.stackState.chosenStack = stackId
      }
      this.stackState._localOnly = false
      this.clearLocalStackChoice()
      const warn = document.querySelector('.hub-stack-local-warn')
      if (warn) warn.remove()
      return true
    } catch {
      return false
    }
  },

  apiUrl(path) {
    const base = window.__WIZARD_API_BASE__ || ''
    if (!base) return path
    return `${String(base).replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`
  },

  loadingSpinnerHtml(size = 'md') {
    const src = this.apiUrl('/assets/logo-qa.png')
    const cls = size === 'sm' ? 'hub-loading-spinner hub-loading-spinner--sm' : 'hub-loading-spinner'
    return `<div class="${cls}" role="status" aria-label="Chargement">
      <div class="hub-loading-spinner-ring" aria-hidden="true"></div>
      <img class="hub-loading-spinner-logo" src="${src}" alt="" width="28" height="28" />
    </div>`
  },

  async apiFetch(path, options) {
    const r = await fetch(this.apiUrl(path), options)
    const data = await r.json().catch(() => ({}))
    if (!r.ok) {
      const err = new Error(data.error || `HTTP ${r.status}`)
      err.status = r.status
      throw err
    }
    return data
  },

  pageUrl(href) {
    if (typeof Portail !== 'undefined' && Portail.pageUrl) return Portail.pageUrl(href)
    return href
  },

  currentStepId() {
    return this.STEP_IDS[this.state.stepIndex] || 'welcome'
  },

  isLastStep() {
    const id = this.currentStepId()
    return id === 'plans' || (id === 'jiraQuestion' && this.state.form.usesJiraPlans === false)
  },

  showBootError(message) {
    const boot = document.getElementById('hubBoot')
    if (boot) boot.hidden = true
    document.getElementById('onboardingView').hidden = true
    document.getElementById('hubView').hidden = false
    const hero = document.getElementById('hubHero')
    if (hero) {
      hero.innerHTML = `
        <h1>Accueil indisponible</h1>
        <p class="hint">${this.escape(message)}</p>
        <p class="hint hint-tight">Essayez <strong>Wizard QA : Redémarrer le serveur</strong>, puis rouvrez Accueil.</p>`
    }
    document.getElementById('hubSections').innerHTML = ''
  },

  async syncBuildVersion() {
    let ver = window.__WIZARD_VERSION__ || ''
    try {
      const meta = await this.apiFetch('/api/wizard/meta')
      if (meta?.version) {
        ver = meta.version
        window.__WIZARD_VERSION__ = ver
      }
    } catch { /* serveur pas prêt */ }
    const label = ver ? `v${ver}` : 'v…'
    document.querySelectorAll('#hubVersionBadge, .hub-version-badge').forEach((el) => {
      el.textContent = label
    })
    if (window.WizardFooter?.apply) {
      window.WizardFooter.apply(label, window.__WIZARD_FOOTER_LABEL__)
    }
    return ver
  },

  /** Garantit le shell accueil (pleine largeur) — délègue à wizard-home-shell.js */
  ensureHomeShellClasses() {
    if (window.WizardHomeShell?.ensure) return window.WizardHomeShell.ensure()
    return false
  },

  async init() {
    this.ensureHomeShellClasses()
    try {
      await this.syncBuildVersion()
      const data = await this.apiFetch('/api/home/catalog')
      this.state.catalog = data
      this.applyDetectedGitRepository(data)
      if (data.demoDefaults) this.applyDemoDefaults(data.demoDefaults)
      document.getElementById('hubBoot').hidden = true
      if (data.needsOnboarding) {
        document.getElementById('onboardingView').hidden = true
        document.getElementById('hubView').hidden = true
      } else {
        this.showHub(this.applyHubCatalogPatches(data))
        const params = new URLSearchParams(globalThis.location?.search || '')
        if (params.get('edit') === 'project') {
          await this.openEditSettings()
        }
      }
      this.bindToolbar()
      Portail.applyEmbedLinks?.()
      await this.runHomeWelcomeFlow(data.needsOnboarding)
    } catch (err) {
      this.showBootError(err.message || String(err))
      if (typeof WizardDisclaimer !== 'undefined') {
        const shown = await WizardDisclaimer.show('launchDisclaimer', { force: true })
        if (shown) await WizardDisclaimer.waitUntilClosed()
      }
    }
  },

  applyDemoDefaults(defaults) {
    // Données démo : plus de préremplissage automatique (profil réel = Prise de connaissance).
    void defaults
  },

  async runHomeWelcomeFlow(needsOnboarding) {
    if (needsOnboarding) this.showOnboarding()
  },

  async showLaunchDisclaimer() {
    if (typeof WizardDisclaimer !== 'undefined') {
      await WizardDisclaimer.show('launchDisclaimer', { force: true })
      return
    }
    if (typeof WizardLaunchDisclaimer !== 'undefined') {
      await WizardLaunchDisclaimer.show(true)
    }
  },

  closeLaunchDisclaimer() {
    if (typeof WizardDisclaimer !== 'undefined') {
      WizardDisclaimer.close()
      return
    }
    if (typeof WizardLaunchDisclaimer !== 'undefined') {
      WizardLaunchDisclaimer.close()
    }
  },

  openWizardFile(relativePath) {
    const api = window.__wizardVsCodeApi
    if (api) {
      api.postMessage({ type: 'openFile', relativePath })
      return
    }
    fetch(this.apiUrl('/api/hook/open-file'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ relativePath }),
    }).catch(() => {})
  },

  requestWizardServerRestart(skipReload = true) {
    const api = window.__wizardVsCodeApi
    if (!api) return false
    api.postMessage({ type: 'restartServer', skipReload })
    return true
  },

  renderDeferredPersistBlock() {
    if (!this.stackState._localOnly) return ''
    return `
      <div class="hub-stack-local-warn" role="alert">
        <p class="hub-stack-local-warn-text">Enregistrement différé — votre choix est visible à l'accueil. Redémarrez le serveur pour le sauvegarder dans les fichiers de configuration.</p>
        <div class="hub-stack-local-warn-actions">
          <button type="button" class="btn-primary btn-sm" id="stackPersistDeferred">Redémarrer le serveur et enregistrer</button>
        </div>
        <div id="stackPersistStatus" class="status wizard-unified-status" style="display:none;margin-top:8px"></div>
      </div>`
  },

  bindDeferredPersistActions(root) {
    root?.querySelector('#stackPersistDeferred')?.addEventListener('click', () => {
      this.persistStackDeferred().catch(() => {})
    })
  },

  onStackPersistSuccess(statusEl) {
    this.stackState._localOnly = false
    this.clearLocalStackChoice()
    document.querySelector('.hub-stack-local-warn')?.remove()
    if (statusEl) {
      Portail.showStatus(statusEl, true, 'Configuration enregistrée dans vos fichiers JSON.')
      statusEl.style.display = 'block'
    }
  },

  async persistStackDeferred() {
    const btn = document.getElementById('stackPersistDeferred')
    const statusEl = document.getElementById('stackPersistStatus')
    if (btn) {
      btn.disabled = true
      btn.textContent = 'Enregistrement…'
    }

    let ok = await this.tryPersistStackToServer(this.stackState.chosenStack)
    if (ok) {
      this.onStackPersistSuccess(statusEl)
      if (btn) btn.remove()
      return
    }

    if (!this.requestWizardServerRestart(true)) {
      if (statusEl) {
        Portail.showStatus(statusEl, false, 'Utilisez la palette de commandes : Wizard QA : Redémarrer le serveur')
        statusEl.style.display = 'block'
      }
      if (btn) {
        btn.disabled = false
        btn.textContent = 'Redémarrer le serveur et enregistrer'
      }
      return
    }

    for (let i = 0; i < 30; i += 1) {
      await this.sleep(500)
      ok = await this.tryPersistStackToServer(this.stackState.chosenStack)
      if (ok) {
        this.onStackPersistSuccess(statusEl)
        if (btn) btn.remove()
        return
      }
    }

    if (statusEl) {
      Portail.showStatus(statusEl, false, 'Le serveur n\'a pas répondu — réessayez dans quelques secondes.')
      statusEl.style.display = 'block'
    }
    if (btn) {
      btn.disabled = false
      btn.textContent = 'Redémarrer le serveur et enregistrer'
    }
  },

  async fetchJsonWithFallback(apiPath, assetPath) {
    try {
      return await this.apiFetch(apiPath)
    } catch (apiErr) {
      try {
        const r = await fetch(this.apiUrl(assetPath))
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const data = await r.json()
        data._fallback = true
        data._apiError = apiErr.message
        return data
      } catch {
        throw apiErr
      }
    }
  },

  renderWizardSettingsPanel(modal, catalog, close, notice = '') {
    const panel = modal.querySelector('.hub-settings-panel')
    if (!panel) return
    const filesHtml = (catalog.files || []).map((file) => `
      <article class="hub-config-file${file.exists ? '' : ' is-missing'}${file.secrets ? ' is-secret' : ''}">
        <header class="hub-config-file-head">
          <h3>${this.escape(file.title)}</h3>
          ${file.exists ? '<span class="hub-config-badge ok">Présent</span>' : '<span class="hub-config-badge warn">Absent</span>'}
          ${file.secrets ? '<span class="hub-config-badge secret">Secrets</span>' : ''}
        </header>
        <p class="hub-config-file-role">${this.escape(file.role)}</p>
        ${file.wikiPath ? `<p class="hint hint-tight hub-config-wiki-link"><a href="${this.escape(file.wikiPath)}">→ Wiki : personnaliser le questionnaire stack</a></p>` : ''}
        <div class="hub-config-file-links">
          <button type="button" class="btn-secondary btn-sm hub-config-open-btn" data-path="${this.escape(file.relativePath)}" title="Ouvrir dans VS Code">
            Ouvrir dans VS Code
          </button>
          <button type="button" class="hub-config-file-path" data-path="${this.escape(file.relativePath)}" title="Ouvrir ${this.escape(file.relativePath)}">
            <code>${this.escape(file.relativePath)}</code>
          </button>
        </div>
        <div class="hub-config-file-meta">
          <div><strong>Lu par</strong><ul>${(file.readBy || []).map((x) => `<li>${this.escape(x)}</li>`).join('')}</ul></div>
          <div><strong>Écrit par</strong><ul>${(file.writtenBy || []).map((x) => `<li>${this.escape(x)}</li>`).join('')}</ul></div>
        </div>
      </article>`).join('')

    panel.innerHTML = `
      <div class="hub-settings-head">
        <img class="hub-settings-gear" src="${this.apiUrl('/assets/logo-settings-gear.png')}" alt="" width="28" height="28" />
        <h2 id="wizardSettingsTitle" class="hub-onboarding-title">Paramétrage du Wizard</h2>
        <button type="button" class="hub-settings-close" id="wizardSettingsClose" aria-label="Fermer">×</button>
      </div>
      ${notice ? `<p class="hint hint-tight hub-settings-notice">${this.escape(notice)}</p>` : ''}
      <p class="hint hint-tight hub-settings-open-hint">Cliquez sur <strong>Ouvrir dans VS Code</strong> ou sur le chemin du fichier pour l'éditer.</p>
        <p class="hint hint-tight hub-settings-sync">${this.formatHookGitMention(catalog.syncNote || '')}</p>
      <div class="hub-config-files">${filesHtml}</div>
      <div class="hub-onboarding-actions hub-settings-actions">
        <button type="button" class="btn-secondary btn-sm" id="wizardSettingsClose2">Fermer</button>
      </div>`

    document.getElementById('wizardSettingsClose')?.addEventListener('click', close)
    document.getElementById('wizardSettingsClose2')?.addEventListener('click', close)
    document.getElementById('wizardSettingsBackdrop')?.addEventListener('click', close)
    panel.querySelectorAll('.hub-config-file-path, .hub-config-open-btn').forEach((btn) => {
      btn.addEventListener('click', () => this.openWizardFile(btn.dataset.path))
    })
  },

  async showWizardSettings() {
    const modal = document.getElementById('wizardSettingsModal')
    if (!modal) return
    modal.hidden = false
    modal.setAttribute('aria-hidden', 'false')
    modal.innerHTML = `
      <div class="hub-settings-backdrop" id="wizardSettingsBackdrop"></div>
      <div class="hub-settings-panel card card-compact hub-onboarding-card" role="dialog" aria-labelledby="wizardSettingsTitle">
        <div class="hub-settings-head">
          <img class="hub-settings-gear" src="${this.apiUrl('/assets/logo-settings-gear.png')}" alt="" width="28" height="28" />
          <h2 id="wizardSettingsTitle" class="hub-onboarding-title">Paramétrage du Wizard</h2>
          <button type="button" class="hub-settings-close" id="wizardSettingsClose" aria-label="Fermer">×</button>
        </div>
        <p class="hub-onboarding-lead">Fichiers JSON et de configuration utilisés par l'assistant.</p>
        ${this.loadingSpinnerHtml('sm')}
      </div>`

    const close = () => {
      modal.hidden = true
      modal.setAttribute('aria-hidden', 'true')
      modal.innerHTML = ''
    }
    document.getElementById('wizardSettingsClose')?.addEventListener('click', close)
    document.getElementById('wizardSettingsBackdrop')?.addEventListener('click', close)

    try {
      const catalog = await this.fetchJsonWithFallback(
        '/api/wizard/config-files',
        '/assets/wizard-config-catalog-data.json',
      )
      const notice = catalog._fallback
        ? `Mode hors-ligne (serveur : ${catalog._apiError || 'indisponible'}). Redémarrez le serveur Wizard QA pour l'état à jour.`
        : ''
      this.renderWizardSettingsPanel(modal, catalog, close, notice)
    } catch (err) {
      const panel = modal.querySelector('.hub-settings-panel')
      if (panel) {
        panel.innerHTML = `
          <div class="hub-settings-head">
            <h2 class="hub-onboarding-title">Paramétrage du Wizard</h2>
            <button type="button" class="hub-settings-close" id="wizardSettingsClose" aria-label="Fermer">×</button>
          </div>
          <p class="status is-error">${this.escape(err.message)}</p>
          <p class="hint hint-tight">Essayez <strong>Wizard QA : Redémarrer le serveur</strong>, puis réouvrez cette fenêtre.</p>
          <div class="hub-onboarding-actions hub-settings-actions">
            <button type="button" class="btn-secondary btn-sm" id="wizardSettingsClose2">Fermer</button>
          </div>`
        document.getElementById('wizardSettingsClose')?.addEventListener('click', close)
        document.getElementById('wizardSettingsClose2')?.addEventListener('click', close)
        document.getElementById('wizardSettingsBackdrop')?.addEventListener('click', close)
      }
    }
  },

  applyDetectedGitRepository(catalog) {
    const repo = catalog?.project?.gitRepository
    if (repo) this.state.form.gitRepository = repo
  },

  showOnboarding() {
    document.getElementById('hubBoot').hidden = true
    document.getElementById('onboardingView').hidden = false
    document.getElementById('hubView').hidden = true
    this.state.wizardFlow = 'prise'
    if (!this.state.editMode && this.state.form.usesJiraPlans === null) {
      this.state.stepIndex = 0
      if (this.state.catalog?.demoDefaults) this.applyDemoDefaults(this.state.catalog.demoDefaults)
    }
    this.updateOnboardingHero()
    this.renderOnboardingStep()
  },

  resetOnboardingForm() {
    const gitRepo = this.state.form.gitRepository
      || this.state.catalog?.project?.gitRepository
      || ''
    this.state.form = {
      tribu: '',
      squad: '',
      poName: '',
      baName: '',
      scrumMasterName: '',
      qaName: '',
      productCode: '',
      solutionCode: '',
      applicationLabel: '',
      gitRepository: gitRepo,
      usesJiraPlans: null,
      jiraBaseUrl: '',
      xrayClientId: '',
      xrayClientSecret: '',
      testPlans: [{ planKey: '', planName: '', testingBoardUrl: '' }],
    }
    if (this.state.catalog?.demoDefaults) this.applyDemoDefaults(this.state.catalog.demoDefaults)
  },

  async restartOnboardingQuestionnaire() {
    if (this.state.wizardFlow === 'stack' || this.state.wizardFlow === 'stack-results') {
      this.stackState.result = null
      this.stackState.chosenStack = null
      this.stackState.answers = {}
      this.stackState.stepIndex = 0
      this.state.wizardFlow = 'stack'
      await this.startStackQuestionnaire(false)
      return
    }

    this.state.wizardFlow = 'prise'
    this.stackState.result = null
    this.stackState.answers = {}
    this.stackState.stepIndex = 0

    if (this.state.editMode) {
      await this.openEditSettings()
      return
    }

    this.state.stepIndex = 0
    this.resetOnboardingForm()
    this.updateOnboardingHero()
    this.renderOnboardingStep()
  },

  async goToHomeFromOnboarding() {
    try {
      const catalog = await this.apiFetch('/api/home/catalog')
      this.state.catalog = catalog
      this.showHub(catalog)
    } catch (err) {
      if (this.state.catalog) {
        this.showHub(this.state.catalog)
      } else {
        Portail.showStatus(document.getElementById('obStatus'), false, err.message)
      }
    }
  },

  updateOnboardingHero() {
    const obHero = document.querySelector('#onboardingView .hub-hero')
    if (!obHero) return
    if (this.state.editMode) {
      obHero.innerHTML = `
        <h1>Modifier les paramètres du projet</h1>
        <p>Mettez à jour les informations de configuration. Le fichier <code>.wizard-qa/conf/project.variables.json</code> sera régénéré.</p>`
    } else {
      obHero.innerHTML = `
        <h1>Prise de connaissance</h1>
        <p>Outils QA — pré-paramétrage de votre espace de travail.</p>`
    }
  },

  async openEditSettings() {
    try {
      const data = await this.apiFetch('/api/project/profile')
      const p = data.project || {}
      const prefix = p.productCode && /^P\d{4}$/.test(p.productCode) ? `${p.productCode}-` : ''
      this.state.editMode = true
      this.state.stepIndex = this.STEP_IDS.indexOf('stakeholders')
      this.state.form = {
        tribu: p.tribu || '',
        squad: p.squad || '',
        poName: p.poName || '',
        baName: p.baName || '',
        scrumMasterName: p.scrumMasterName || '',
        qaName: p.qaName || '',
        productCode: p.productCode || '',
        solutionCode: p.solutionCode || '',
        applicationLabel: p.applicationLabel || '',
        gitRepository: p.gitRepository || this.state.catalog?.project?.gitRepository || '',
        usesJiraPlans: p.usesJiraPlans ?? null,
        jiraBaseUrl: p.jiraBaseUrl || '',
        xrayClientId: p.xrayClientId || '',
        xrayClientSecret: p.xrayClientSecret || '',
        testPlans: p.testPlans?.length
          ? p.testPlans.map(tp => ({
            planKey: tp.planKey || prefix,
            planName: tp.planName || '',
            testingBoardUrl: tp.testingBoardUrl || '',
          }))
          : [{ planKey: prefix, planName: '', testingBoardUrl: '' }],
      }
      this.showOnboarding()
    } catch (err) {
      Portail.showStatus(document.getElementById('homeStatus'), false, err.message)
    }
  },

  showHub(catalog) {
    document.getElementById('onboardingView')?.classList.remove('stack-quiz-flow')
    document.getElementById('onboardingView').hidden = true
    document.getElementById('hubView').hidden = false
    this.renderHub(catalog || this.state.catalog)
  },

  stepTitle(id) {
    return {
      welcome: 'Bienvenue',
      stakeholders: 'Parties prenantes',
      product: 'Produit & solution',
      jiraQuestion: 'Plans de test JIRA',
      plans: 'Synchronisation JIRA',
    }[id] || id
  },

  renderOnboardingStep() {
    const root = document.getElementById('onboardingSteps')
    const stepId = this.currentStepId()
    const dots = this.STEP_IDS.map((id, i) => {
      const cls = i < this.state.stepIndex ? 'is-done' : i === this.state.stepIndex ? 'is-active' : ''
      return `<span class="hub-step-dot ${cls}" title="${this.stepTitle(id)}"></span>`
    }).join('')

    let body = ''
    if (stepId === 'welcome') {
      body = `
        <p class="hub-onboarding-lead">Renseignez les informations relatives à votre produit et solution pour pré-paramétrer votre espace de travail.</p>
        <p class="hub-onboarding-sub">Cet assistant vous permettra de :</p>
        <ul class="hub-onboarding-list">
          <li>Créer l'espace d'installation de Playwright</li>
          <li>Générer une documentation QA pré-remplie avec les informations de votre projet</li>
          <li>Mettre à jour votre Tableau de Test JIRA</li>
          <li>Maintenir vos Tickets Tests et Plan de Test dans JIRA</li>
          <li>Maintenir vos dépendances à jour (NPM / PROXY etc …)</li>
        </ul>
        <div class="hub-form-grid hub-form-grid--welcome">
          ${this.renderField({
            id: 'ob-gitRepository',
            label: 'Dépôt Git (espace de travail)',
            field: 'gitRepository',
            placeholder: 'Racine du dépôt détectée',
            full: true,
            readonly: true,
            inputClass: 'hub-readonly',
          })}
        </div>
        <p class="hint hint-tight">Ce chemin sera enregistré dans <code>project.variables.json</code> (<code>$GIT_REPOSITORY</code>) et utilisé pour les plans de test, le hook Git et la documentation QA.</p>`
    } else if (stepId === 'stakeholders') {
      body = `
        <p class="hub-onboarding-lead">Renseignez les informations qui s'articulent autour de votre produit et solution. Elles servent à paramétrer l'auto-génération des livrables et la mise à jour des tickets JIRA.</p>
        <div class="hub-stakeholder-grid">
          ${this.renderField({ id: 'ob-tribu', label: 'Tribu', field: 'tribu', placeholder: 'IT pour CA-TS' })}
          ${this.renderField({ id: 'ob-squad', label: 'Squad', field: 'squad', placeholder: 'Risk pour CA-TS' })}
          ${this.renderField({ id: 'ob-poName', label: 'Product Owner', field: 'poName', placeholder: 'Marie Dupont' })}
          ${this.renderField({ id: 'ob-baName', label: 'Business Analyst', field: 'baName', placeholder: 'Jean Martin' })}
          ${this.renderField({ id: 'ob-scrumMasterName', label: 'Scrum Master', field: 'scrumMasterName', placeholder: 'Sophie Bernard' })}
          ${this.renderField({ id: 'ob-qaName', label: 'QA / Testeur', field: 'qaName', placeholder: 'Lucas Petit' })}
        </div>`
    } else if (stepId === 'product') {
      body = `
        <p class="hub-onboarding-lead">Codes utilisés dans JIRA, les livrables QA et la configuration de votre espace.</p>
        <div class="hub-form-grid">
          ${this.renderField({ id: 'ob-productCode', label: 'Code produit', field: 'productCode', placeholder: 'P0326 ou 0326', inputClass: 'hub-code-product' })}
          ${this.renderField({ id: 'ob-solutionCode', label: 'Code solution', field: 'solutionCode', placeholder: 'S0998 ou 0998', inputClass: 'hub-code-solution' })}
          ${this.renderField({ id: 'ob-applicationLabel', label: 'Libellé application (optionnel)', field: 'applicationLabel', placeholder: 'Portail assurance démo', full: true })}
        </div>`
    } else if (stepId === 'jiraQuestion') {
      body = `
        <p class="hub-onboarding-lead hub-onboarding-lead-center">Utilisez-vous des Plans de Tests dans JIRA pour votre activité autour des tests ?</p>
        <p class="hint hint-tight hub-onboarding-hint-center">Vous pourrez ignorer cette étape en choisissant « Non ».</p>
        <div class="hub-yesno">
          <button type="button" class="btn-primary hub-yesno-btn" id="obJiraYes">Oui</button>
          <button type="button" class="btn-secondary hub-yesno-btn" id="obJiraNo">Non</button>
        </div>`
    } else if (stepId === 'plans') {
      body = `
        <p class="hub-onboarding-lead">${this.state.editMode
          ? 'Mettez à jour la synchronisation JIRA. Seul le fichier JSON sera régénéré (aucun nouveau dossier créé).'
          : 'Paramétrez la connexion JIRA/Xray et vos plans de test.'}</p>
        <h3 class="hub-subsection-title">Connexion Xray Cloud</h3>
        <div class="hub-form-grid">
          ${this.renderField({ id: 'ob-jiraBaseUrl', label: 'URL JIRA', field: 'jiraBaseUrl', placeholder: 'https://jirasoftware-cats.atlassian.net', full: true })}
          ${this.renderField({ id: 'ob-xrayClientId', label: 'XRAY_CLIENT_ID', field: 'xrayClientId', placeholder: 'DEMO5E30639ECEDC4A4DA4B6AC1E2619DFFF' })}
          ${this.renderField({ id: 'ob-xrayClientSecret', label: 'XRAY_CLIENT_SECRET', field: 'xrayClientSecret', placeholder: 'demo-xray-secret-a-remplacer-en-production', type: 'password' })}
        </div>
        <h3 class="hub-subsection-title">Plan de Test</h3>
        <div id="planRows" class="hub-plan-rows"></div>
        <button type="button" class="btn-secondary btn-sm hub-plan-add" id="obAddPlan">+ Ajouter un plan de test</button>
        <p class="hint hint-tight">Chaque plan ${this.state.editMode ? 'enregistré' : 'créera un dossier'} : <code>P0326-10528_Plan_de_Test</code></p>
        <div class="hub-preview-folder" id="folderPreview">${this.escape(this.previewPlansText())}</div>`
    }

    const showActions = stepId !== 'jiraQuestion'
    const nextLabel = stepId === 'plans'
      ? (this.state.editMode ? 'Enregistrer' : 'Créer mon projet')
      : 'Continuer'
    const prevDisabled = !this.state.editMode && this.state.stepIndex === 0

    root.innerHTML = `
      <div class="card card-compact hub-onboarding-card">
        <div class="hub-onboarding-steps">${dots}</div>
        <h2 class="hub-onboarding-title">${this.stepTitle(stepId)}</h2>
        ${body}
        ${showActions ? `
        <div class="hub-onboarding-actions">
          <button type="button" class="btn-secondary btn-sm" id="obPrev" ${prevDisabled ? 'disabled' : ''}>${this.state.editMode && this.state.stepIndex === 1 ? 'Annuler' : 'Retour'}</button>
          <button type="button" class="btn-primary btn-sm" id="obNext">${nextLabel}</button>
        </div>` : `
        <div class="hub-onboarding-actions">
          <button type="button" class="btn-secondary btn-sm" id="obPrev">Retour</button>
          <span></span>
        </div>`}
        <div id="obStatus" class="status" style="display:none;margin-top:12px"></div>
      </div>`

    root.querySelectorAll('[data-field]').forEach(el => {
      el.addEventListener('input', () => {
        this.hideStepError()
        if (el.dataset.field === 'productCode') {
          this.applyCodeFormat(el, (v) => this.formatProductCode(v))
          this.syncPlanKeysFromProduct()
        } else if (el.dataset.field === 'solutionCode') {
          this.applyCodeFormat(el, (v) => this.formatSolutionCode(v))
        } else {
          this.state.form[el.dataset.field] = el.value
        }
        this.updatePlanPreview()
      })
    })

    if (stepId === 'product') {
      const pc = document.getElementById('ob-productCode')
      const sc = document.getElementById('ob-solutionCode')
      if (pc) { pc.value = this.formatProductCode(pc.value); this.state.form.productCode = pc.value }
      if (sc) { sc.value = this.formatSolutionCode(sc.value); this.state.form.solutionCode = sc.value }
    }

    if (stepId === 'plans') {
      this.syncPlanKeysFromProduct()
      this.renderPlanRows()
      document.getElementById('obAddPlan').onclick = () => {
        this.state.form.testPlans.push({ planKey: this.planKeyPrefix(), planName: '', testingBoardUrl: '' })
        this.renderPlanRows()
      }
    }

    if (stepId === 'jiraQuestion') {
      document.getElementById('obJiraYes').onclick = () => this.setJiraPlans(true)
      document.getElementById('obJiraNo').onclick = () => this.setJiraPlans(false)
    }

    document.getElementById('obPrev').onclick = () => {
      this.syncFormFromDom()
      if (this.state.editMode && this.state.stepIndex <= this.STEP_IDS.indexOf('stakeholders')) {
        this.state.editMode = false
        this.showHub(this.state.catalog)
        return
      }
      if (this.currentStepId() === 'plans') {
        this.state.stepIndex = this.STEP_IDS.indexOf('jiraQuestion')
      } else {
        this.state.stepIndex = Math.max(0, this.state.stepIndex - 1)
      }
      this.renderOnboardingStep()
    }

    const nextBtn = document.getElementById('obNext')
    if (nextBtn) nextBtn.onclick = () => this.onboardingNext()
  },

  renderPlanRows() {
    const wrap = document.getElementById('planRows')
    if (!wrap) return
    wrap.innerHTML = this.state.form.testPlans.map((plan, i) => `
      <div class="hub-plan-row" data-plan-index="${i}">
        ${this.renderPlanField({
          id: `ob-planKey-${i}`,
          label: 'ID plan de test JIRA',
          planIndex: i,
          planField: 'planKey',
          placeholder: `${this.planKeyPrefix() || 'P0326-'}10528`,
          value: plan.planKey,
        })}
        ${this.renderPlanField({
          id: `ob-planName-${i}`,
          label: 'Nom du plan',
          planIndex: i,
          planField: 'planName',
          placeholder: 'Plan_de_Test',
          value: plan.planName,
        })}
        ${this.renderPlanField({
          id: `ob-planTb-${i}`,
          label: 'URL Testing Board',
          planIndex: i,
          planField: 'testingBoardUrl',
          placeholder: 'https://…/jira/software/projects/…/testing-board',
          value: plan.testingBoardUrl,
          full: true,
        })}
        ${this.state.form.testPlans.length > 1
          ? `<button type="button" class="btn-secondary btn-sm hub-plan-remove" data-remove-plan="${i}" title="Supprimer">×</button>`
          : ''}
      </div>`).join('')

    wrap.querySelectorAll('[data-plan-field]').forEach(el => {
      el.addEventListener('input', () => {
        const idx = Number(el.dataset.planIndex)
        const field = el.dataset.planField
        if (field === 'planKey') {
          el.value = this.formatPlanKeyInput(el.value)
          this.state.form.testPlans[idx].planKey = el.value
        } else {
          this.state.form.testPlans[idx][field] = el.value
        }
        this.updatePlanPreview()
      })
    })
    wrap.querySelectorAll('[data-remove-plan]').forEach(btn => {
      btn.onclick = () => {
        const idx = Number(btn.dataset.removePlan)
        this.state.form.testPlans.splice(idx, 1)
        this.renderPlanRows()
        this.updatePlanPreview()
      }
    })
    this.updatePlanPreview()
  },

  previewPlanFolder(planKey, planName) {
    const prefix = this.planKeyPrefix()
    const key = (planKey || prefix || 'P0326-').trim().toUpperCase()
    const name = (planName || 'Plan_de_Test').trim().replace(/\s+/g, '_').replace(/[<>:"/\\|?*]/g, '') || 'Plan_de_Test'
    return `${key}_${name}`
  },

  previewPlansText() {
    const plans = this.state.form.testPlans || []
    if (!plans.length) return 'Aucun dossier plan'
    return plans.map(p => this.previewPlanFolder(p.planKey, p.planName)).join(' · ')
  },

  updatePlanPreview() {
    const el = document.getElementById('folderPreview')
    if (el) el.textContent = this.previewPlansText()
  },

  setJiraPlans(use) {
    this.syncFormFromDom()
    this.state.form.usesJiraPlans = use
    if (use) {
      this.syncPlanKeysFromProduct()
      if (!this.state.form.testPlans?.length) {
        this.state.form.testPlans = [{ planKey: this.planKeyPrefix(), planName: '', testingBoardUrl: '' }]
      }
      this.state.stepIndex = this.STEP_IDS.indexOf('plans')
      this.renderOnboardingStep()
    } else {
      this.runOnboardingComplete()
    }
  },

  syncFormFromDom() {
    document.querySelectorAll('[data-field]').forEach(el => {
      const field = el.dataset.field
      if (field === 'productCode') {
        this.state.form.productCode = this.formatProductCode(el.value)
        el.value = this.state.form.productCode
      } else if (field === 'solutionCode') {
        this.state.form.solutionCode = this.formatSolutionCode(el.value)
        el.value = this.state.form.solutionCode
      } else {
        this.state.form[field] = el.value
      }
    })
    document.querySelectorAll('[data-plan-field]').forEach(el => {
      const idx = Number(el.dataset.planIndex)
      const field = el.dataset.planField
      if (!this.state.form.testPlans[idx]) return
      this.state.form.testPlans[idx][field] = el.value
    })
  },

  async onboardingNext() {
    this.syncFormFromDom()
    const id = this.currentStepId()
    if (id === 'plans') {
      const err = this.validatePlansStep()
      if (err) return this.showStepError(err)
      await this.runOnboardingComplete()
      return
    }
    if (id === 'product') {
      const err = this.validateProductStep()
      if (err) return this.showStepError(err)
      this.state.form.productCode = this.formatProductCode(this.state.form.productCode)
      this.state.form.solutionCode = this.formatSolutionCode(this.state.form.solutionCode)
      this.syncPlanKeysFromProduct()
      this.state.stepIndex = this.STEP_IDS.indexOf('jiraQuestion')
      this.renderOnboardingStep()
      return
    }
    this.state.stepIndex = Math.min(this.state.stepIndex + 1, this.STEP_IDS.length - 1)
    this.renderOnboardingStep()
  },

  showStepError(msg) {
    Portail.showStatus(document.getElementById('obStatus'), false, msg)
    const el = document.getElementById('obStatus')
    if (el) el.style.display = 'block'
  },

  hideStepError() {
    const el = document.getElementById('obStatus')
    if (el) {
      el.style.display = 'none'
      el.textContent = ''
    }
  },

  applyCodeFormat(el, formatter) {
    const start = el.selectionStart ?? el.value.length
    const end = el.selectionEnd ?? el.value.length
    const before = el.value
    const after = formatter(before)
    el.value = after
    this.state.form[el.dataset.field] = after
    if (after === before) return
    const delta = after.length - before.length
    const pos = Math.max(0, Math.min(after.length, start + delta))
    try { el.setSelectionRange(pos, pos) } catch (_) { /* input type may not support selection */ }
  },

  formatProductCode(raw) {
    const s = String(raw || '').toUpperCase().replace(/\s/g, '')
    if (!s) return ''
    if (/^P$/i.test(s)) return 'P'
    const digits = s.replace(/^P/i, '').replace(/[^0-9]/g, '').slice(0, 4)
    if (!digits) return /^P/i.test(s) ? 'P' : ''
    return `P${digits}`
  },

  formatSolutionCode(raw) {
    const s = String(raw || '').toUpperCase().replace(/\s/g, '')
    if (!s) return ''
    if (/^S$/i.test(s)) return 'S'
    const digits = s.replace(/^S/i, '').replace(/[^0-9]/g, '').slice(0, 4)
    if (!digits) return /^S/i.test(s) ? 'S' : ''
    return `S${digits}`
  },

  validateProductCode(code) {
    if (!/^P\d{4}$/.test(this.formatProductCode(code))) {
      return 'Code produit : P majuscule suivi de 4 chiffres (ex. P0326)'
    }
    return null
  },

  validateSolutionCode(code) {
    if (!/^S\d{4}$/.test(this.formatSolutionCode(code))) {
      return 'Code solution : S majuscule suivi de 4 chiffres (ex. S0998)'
    }
    return null
  },

  validateProductStep() {
    return this.validateProductCode(this.state.form.productCode)
      || this.validateSolutionCode(this.state.form.solutionCode)
  },

  planKeyPrefix() {
    const p = this.formatProductCode(this.state.form.productCode)
    return /^P\d{4}$/.test(p) ? `${p}-` : ''
  },

  formatPlanKeyInput(raw) {
    const prefix = this.planKeyPrefix()
    let v = String(raw || '').toUpperCase().replace(/\s/g, '')
    if (!prefix) return v
    if (!v.startsWith(prefix)) {
      const suffix = v.replace(/^P\d{4}-?/i, '')
      v = prefix + suffix
    }
    return v
  },

  syncPlanKeysFromProduct() {
    const prefix = this.planKeyPrefix()
    if (!prefix || !this.state.form.testPlans?.length) return
    this.state.form.testPlans = this.state.form.testPlans.map((plan) => {
      const key = this.formatPlanKeyInput(plan.planKey || prefix)
      return { ...plan, planKey: key || prefix }
    })
  },

  validatePlansStep() {
    const prefix = this.planKeyPrefix()
    if (!prefix) return 'Renseignez d\'abord un code produit valide (étape Produit & solution)'
    for (const p of this.state.form.testPlans) {
      const key = this.formatPlanKeyInput(p.planKey)
      if (!key || key === prefix) return 'Complétez l\'ID plan de test JIRA (suffixe après le code produit)'
      if (!key.startsWith(prefix)) return `L'ID plan doit commencer par ${prefix}`
      if (!/^[A-Z][A-Z0-9]+-\d+$/i.test(key)) return 'ID plan invalide (ex. P0326-10528)'
      if (!String(p.planName || '').trim()) return 'Nom du plan requis pour chaque plan JIRA'
    }
    return null
  },

  buildSubmitPayload() {
    this.state.form.productCode = this.formatProductCode(this.state.form.productCode)
    this.state.form.solutionCode = this.formatSolutionCode(this.state.form.solutionCode)
    if (this.state.form.usesJiraPlans) this.syncPlanKeysFromProduct()
    return {
      tribu: this.state.form.tribu,
      squad: this.state.form.squad,
      poName: this.state.form.poName,
      baName: this.state.form.baName,
      scrumMasterName: this.state.form.scrumMasterName,
      qaName: this.state.form.qaName,
      productCode: this.state.form.productCode,
      solutionCode: this.state.form.solutionCode,
      applicationLabel: this.state.form.applicationLabel,
      gitRepository: this.state.form.gitRepository,
      usesJiraPlans: Boolean(this.state.form.usesJiraPlans),
      jiraBaseUrl: this.state.form.jiraBaseUrl,
      xrayClientId: this.state.form.xrayClientId,
      xrayClientSecret: this.state.form.xrayClientSecret,
      testPlans: this.state.form.usesJiraPlans ? this.state.form.testPlans : [],
    }
  },

  async runOnboardingComplete() {
    this.syncFormFromDom()
    const isEdit = this.state.editMode
    const root = document.getElementById('onboardingSteps')
    root.innerHTML = `
      <div class="hub-onboarding-card hub-loading-panel">
        ${this.loadingSpinnerHtml()}
        <h2 class="hub-onboarding-title">${isEdit ? 'Mise à jour en cours…' : 'Création en cours…'}</h2>
        <p class="hub-onboarding-lead">${isEdit
          ? 'Régénération du fichier de configuration projet.'
          : 'Préparation de votre espace de tests automatisés.'}</p>
        <ul class="hub-loading-steps" id="loadSteps">
          <li class="is-active">Validation des informations</li>
          <li>Génération du fichier de configuration</li>
          ${isEdit ? '' : '<li>Création des dossiers plan JIRA</li>'}
          <li>Ouverture du catalogue</li>
        </ul>
      </div>`

    const items = [...document.querySelectorAll('#loadSteps li')]
    const tick = (i) => {
      items.forEach((li, idx) => {
        li.classList.toggle('is-done', idx < i)
        li.classList.toggle('is-active', idx === i)
      })
    }

    tick(0)
    await this.sleep(350)
    tick(1)

    try {
      const endpoint = isEdit ? '/api/project/settings/update' : '/api/project/onboarding/complete'
      const r = await fetch(this.apiUrl(endpoint), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.buildSubmitPayload()),
      })
      const res = await r.json()
      if (!r.ok) throw new Error(res.error || 'Erreur')
      if (!isEdit) {
        tick(2)
        await this.sleep(450)
      }
      tick(isEdit ? 2 : 3)
      await this.sleep(300)
      this.state.editMode = false
      Portail.navigateTo('/')
    } catch (err) {
      this.state.stepIndex = this.state.form.usesJiraPlans
        ? this.STEP_IDS.indexOf('plans')
        : this.STEP_IDS.indexOf('jiraQuestion')
      this.renderOnboardingStep()
      Portail.showStatus(document.getElementById('obStatus'), false, err.message)
      document.getElementById('obStatus').style.display = 'block'
    }
  },

  renderHub(catalog) {
    catalog = this.applyHubCatalogPatches(catalog)
    if (!catalog?.sections?.length) {
      this.showBootError('Catalogue vide — redémarrez le serveur Wizard QA (v1.2+).')
      return
    }
    const compact = Portail.isVsCodePanel?.() ?? document.documentElement.classList.contains('vscode-app')
    const hero = document.getElementById('hubHero')
    const p = catalog.project || {}
    const varsPath = p.variablesPath || '.wizard-qa/conf/project.variables.json'
    const defaultsPath = p.defaultsPath || '.wizard-qa/conf/wizard.defaults.json'
    const metaHtml = `
        ${p.tribu ? `<span><strong>TRIBU</strong> ${this.escape(p.tribu)}</span>` : ''}
        ${p.squad ? `<span><strong>Squad</strong> ${this.escape(p.squad)}</span>` : ''}
        ${p.productCode ? `<span><strong>Produit</strong> ${this.escape(p.productCode)}</span>` : ''}
        ${p.solutionCode ? `<span><strong>Solution</strong> ${this.escape(p.solutionCode)}</span>` : ''}
        ${p.poName ? `<span><strong>PO</strong> ${this.escape(p.poName)}</span>` : ''}
        ${p.baName ? `<span><strong>BA</strong> ${this.escape(p.baName)}</span>` : ''}
        ${p.scrumMasterName ? `<span><strong>Scrum</strong> ${this.escape(p.scrumMasterName)}</span>` : ''}
        ${p.qaName ? `<span><strong>QA</strong> ${this.escape(p.qaName)}</span>` : ''}
        ${p.applicationLabel ? `<span class="hub-meta-app" title="${this.escape(p.applicationLabel)}"><strong>Application</strong> ${this.escape(p.applicationLabel)}</span>` : ''}
        ${p.gitRepository ? `<span class="hub-meta-repo" title="${this.escape(p.gitRepository)}"><strong>Dépôt Git</strong> ${this.escape(p.gitRepository)}</span>` : ''}`

    const stackBanner = ''
    const configPaths = `<p class="hub-config-path hint">Variables : <code>${this.escape(varsPath)}</code> · Profil : <code>${this.escape(defaultsPath)}</code>${catalog.onboardingSnapshotPath ? ` · Prise de connaissance : <code>${this.escape(catalog.onboardingSnapshotPath)}</code>` : ''}</p>`

    const settingsBtn = `<button type="button" class="btn-secondary btn-sm hub-btn-with-icon" id="openWizardSettings" title="Paramétrage du Wizard">
        <img src="${this.apiUrl('/assets/logo-settings-gear.png')}" alt="" width="14" height="14" />
        <span>Paramétrage du Wizard</span>
      </button>`

    const heroActions = `
        <div class="hub-hero-head-actions hub-hero-head-actions--stacked">
          <button type="button" class="btn-primary btn-sm" id="editProjectSettings">Paramètres projet</button>
          ${settingsBtn}
        </div>`

    const heroIntro = `Cet assistant vous permet d'être guidé dans la construction de votre environnement de test automatisé. Il vous permettra de configurer votre projet VS Code et d'effectuer les premières synchronisations entre votre projet et JIRA.`

    hero.innerHTML = compact ? `
      <div class="hub-hero-head">
        <div class="hub-hero-head-text">
          <h1>Wizard QA — Configuration des tests automatisés <span class="file-badge file-badge-ok hub-version-badge" id="hubVersionBadge">v${this.escape(String(window.__WIZARD_VERSION__ || '…'))}</span></h1>
          <p class="hub-hero-lead hub-hero-lead--compact">${this.escape(heroIntro)}</p>
        </div>
        ${heroActions}
      </div>
      <div class="hub-hero-meta hub-hero-meta--compact">${metaHtml}</div>
      ${configPaths}
      ${stackBanner}` : `
      <div class="hub-hero-head">
        <div class="hub-hero-head-text">
          <h1>Wizard QA — Assistant de configuration des tests automatisés <span class="file-badge file-badge-ok hub-version-badge" id="hubVersionBadge">v${this.escape(String(window.__WIZARD_VERSION__ || '…'))}</span></h1>
          <p class="hub-hero-lead">${this.escape(heroIntro)}</p>
        </div>
        ${heroActions}
      </div>
      <div class="hub-hero-meta">${metaHtml}</div>
      ${configPaths}
      ${stackBanner}`

    hero.classList.toggle('hub-hero--compact', compact)

    document.getElementById('editProjectSettings')?.addEventListener('click', () => this.openEditSettings())
    document.getElementById('openWizardSettings')?.addEventListener('click', () => this.showWizardSettings())
    document.getElementById('hubStartStackQuiz')?.addEventListener('click', () => {
      this.stackState.result = null
      this.stackState.stepIndex = 0
      this.launchStackQuestionnaire(false).catch((err) => {
        Portail.showStatus(document.getElementById('homeStatus'), false, err.message)
      })
    })

    void this.syncBuildVersion()

    document.getElementById('hubSections').innerHTML = catalog.sections.map(section => {
      const tilesCls = ['hub-tiles']
      if (section.id === 'stacks') tilesCls.push('hub-tiles--stacks')
      else if (section.columns) tilesCls.push(`hub-tiles--${section.columns}`)
      if (compact) tilesCls.push('hub-tiles--dense')
      return `
      <section class="hub-section hub-section--compact${section.sectionClass ? ` ${section.sectionClass}` : ''}${compact ? ' hub-section--dense' : ''}">
        <div class="hub-section-head">
          <h2>${this.escape(section.title)}</h2>
          ${section.subtitle ? `<p>${this.escape(section.subtitle)}</p>` : ''}
        </div>
        <div class="${tilesCls.join(' ')}">${this.renderSectionTiles(section.tiles)}</div>
      </section>`
    }).join('')

    Portail.applyEmbedLinks?.(document.getElementById('hubSections'))
    Portail.applyEmbedLinks?.(document.querySelector('.hub-toolbar'))
    this.bindWizardSettingsTile()
  },

  bindWizardSettingsTile() {
    const tile = document.querySelector('.hub-tile--wizard-settings')
    if (!tile || tile.dataset.settingsBound) return
    tile.dataset.settingsBound = '1'
    tile.classList.add('is-clickable')
    tile.querySelector('.hub-tile-main')?.addEventListener('click', (e) => {
      if (e.target.closest('a.hub-tile-link')) return
      this.showWizardSettings()
    })
    tile.querySelectorAll('[data-tile-action="openWizardSettings"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault()
        this.showWizardSettings()
      })
    })
  },

  renderSectionTiles(tiles) {
    let html = ''
    let i = 0
    while (i < tiles.length) {
      const tile = tiles[i]
      if (tile.renderAs === 'npmPyramid' || tile.id === '__npmPyramid__') {
        html += this.renderNpmWizardPyramid()
        i += 1
        continue
      }
      const next = tiles[i + 1]
      if (
        tile.pairGroup
        && next?.pairGroup === tile.pairGroup
        && tile.pairRole === 'source'
        && next.pairRole === 'target'
      ) {
        const meta = this.getTilePairMeta(tile.pairGroup)
        html += `<div class="hub-tile-pair${meta.className ? ` ${meta.className}` : ''}" data-pair="${this.escape(tile.pairGroup)}">`
        html += this.renderTile(tile)
        html += this.renderTileConnector(meta.connectorTitle)
        html += this.renderTile(next)
        html += '</div>'
        i += 2
      } else {
        html += this.renderTile(tile)
        i += 1
      }
    }
    return html
  },

  getTilePairMeta(pairGroup) {
    const meta = {
      'jira-chain': {
        className: 'hub-tile-pair--jira',
        connectorTitle: 'Sync JIRA nécessite Hook Git configuré',
      },
      'npm-chain': {
        className: 'hub-tile-pair--npm',
        connectorTitle: 'Playwright s\'installe via npm (registry CA-TS)',
      },
    }
    return meta[pairGroup] || { className: '', connectorTitle: '' }
  },

  renderNpmWizardPyramid() {
    const p = this.state.catalog?.npmPyramid || {}
    if (typeof NpmChainPyramid === 'undefined') {
      return '<p class="hint hint-tight">Pyramide npm — recharger la page.</p>'
    }
    return NpmChainPyramid.render({
      nodeOk: Boolean(p.nodeOk),
      npmrcOk: Boolean(p.npmrcOk),
      packageJsonOk: Boolean(p.packageJsonOk),
      npmInstallDone: Boolean(p.npmInstallDone),
      nodeVersion: p.nodeVersion || '',
      npmVersion: p.npmVersion || '',
    })
  },

  renderTileConnector(title = '') {
    const safeTitle = title ? ` title="${this.escape(title)}"` : ''
    return `<div class="hub-tile-connector" aria-hidden="true"${safeTitle}><span class="hub-tile-connector-line"></span><span class="hub-tile-connector-arrow">→</span></div>`
  },

  renderTile(tile) {
    const badge = { ok: 'OK', warn: '!', ko: 'KO', pending: '—' }[tile.status] || tile.status
    const locked = Boolean(tile.locked)
    const desc = tile.description || tile.message || ''
    const statusHint = tile.description ? (tile.message || '') : ''
    const statusCls = tile.status === 'ko' ? ' is-ko' : tile.status === 'warn' ? ' is-warn' : ''
    const canNavigate = Boolean(tile.href && !tile.comingSoon && !locked)
    const actions = (tile.actions || []).map(a => {
      if (a.action === 'openWizardSettings') {
        return `<button type="button" class="hub-tile-link hub-tile-link--action" data-tile-action="openWizardSettings">${this.escape(a.label)}</button>`
      }
      if (a.disabled || !a.href || locked) {
        return `<span class="hub-tile-link is-disabled">${this.escape(a.label)}</span>`
      }
      return `<a class="hub-tile-link" href="${this.pageUrl(a.href)}">${this.escape(a.label)}</a>`
    }).join('')
    const mainHref = canNavigate
      ? `<a class="hub-tile-hit" href="${this.pageUrl(tile.href)}" aria-label="Ouvrir ${this.escape(tile.title)}"></a>`
      : ''
    return `
      <article class="hub-tile${tile.comingSoon ? ' is-soon' : ''}${locked ? ' is-locked' : ''}${canNavigate ? ' is-clickable' : ''}${tile.recommended ? ' hub-tile--recommended' : ''}${tile.tileClass ? ` ${tile.tileClass}` : ''}">
        <div class="hub-tile-main">
          ${mainHref}
          <div class="hub-tile-top">
            <img class="hub-tile-logo" src="${this.apiUrl(tile.logo)}" alt="${this.escape(tile.logoAlt || tile.title)}" />
            <div class="hub-tile-top-badges">
              ${tile.recommended ? '<span class="hub-tile-rec-badge">Recommandé</span>' : ''}
              <span class="hub-tile-badge ${tile.status}">${badge}</span>
            </div>
          </div>
          <h3 class="hub-tile-title">${tile.id === 'hookGit' ? this.formatHookGitMention(tile.title) : this.escape(tile.title)}</h3>
          <p class="hub-tile-msg">${this.formatHookGitMention(desc)}</p>
          ${statusHint ? `<p class="hub-tile-status-hint${statusCls}">${this.formatHookGitMention(statusHint)}</p>` : ''}
          ${locked && tile.lockReason ? `<p class="hub-tile-lock">${this.formatHookGitMention(tile.lockReason)}</p>` : ''}
        </div>
        ${actions ? `<div class="hub-tile-actions">${actions}</div>` : ''}
      </article>`
  },

  bindToolbar() {
    document.getElementById('obNavHome')?.addEventListener('click', () => {
      this.goToHomeFromOnboarding().catch((err) => {
        Portail.showStatus(document.getElementById('obStatus'), false, err.message)
      })
    })
    document.getElementById('obNavRestart')?.addEventListener('click', () => {
      this.restartOnboardingQuestionnaire().catch((err) => {
        Portail.showStatus(document.getElementById('obStatus'), false, err.message)
      })
    })

    const redoBtn = document.getElementById('redoOnboarding')
    if (redoBtn) redoBtn.onclick = () => {
      this.state.editMode = false
      this.state.stepIndex = 0
      this.state.form.usesJiraPlans = null
      this.stackState.result = null
      this.stackState.answers = {}
      this.stackState.stepIndex = 0
      this.showOnboarding()
    }
    document.getElementById('exportAll')?.addEventListener('click', async () => {
      const secrets = document.getElementById('includeSecrets').checked
      const data = await this.apiFetch(`/api/wizard/export?secrets=${secrets ? '1' : '0'}`)
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `wizard-config-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(a.href)
      Portail.showStatus(document.getElementById('homeStatus'), true, 'Export téléchargé (wizard.defaults + fichiers .wizard-qa/conf)')
    })
    document.getElementById('importAll')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0]
      if (!file) return
      try {
        const config = JSON.parse(await file.text())
        const r = await fetch(this.apiUrl('/api/wizard/import'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ config, merge: true, applyToSystem: document.getElementById('applyOnImport').checked }),
        })
        const res = await r.json()
        if (!r.ok) throw new Error(res.error)
        const n = Array.isArray(res.writtenConfFiles) ? res.writtenConfFiles.length : 0
        const msg = n
          ? `Import réussi — ${n} fichier(s) .wizard-qa/conf restauré(s)`
          : 'Import réussi (wizard.defaults.json)'
        Portail.showStatus(document.getElementById('homeStatus'), true, msg)
        await this.init()
      } catch (err) {
        Portail.showStatus(document.getElementById('homeStatus'), false, err.message)
      }
      e.target.value = ''
    })
    document.getElementById('applyAll')?.addEventListener('click', async () => {
      try {
        const res = await Portail.applyWizard()
        Portail.showStatus(document.getElementById('homeStatus'), res.ok, Portail.formatApplyResult(res) || 'Appliqué')
        await this.init()
      } catch (err) {
        Portail.showStatus(document.getElementById('homeStatus'), false, err.message)
      }
    })
  },

  sleep(ms) { return new Promise(r => setTimeout(r, ms)) },

  escape(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  },

  formatHookGitMention(text) {
    if (typeof Portail !== 'undefined' && Portail.formatHookGitMention) {
      return Portail.formatHookGitMention(text)
    }
    return this.escape(text)
  },

  renderField({ id, label, field, placeholder, full = false, inputClass = '', maxlength = '', type = 'text', readonly = false }) {
    const maxAttr = maxlength ? ` maxlength="${maxlength}"` : ''
    const cls = inputClass ? ` class="${inputClass}"` : ''
    const readAttr = readonly ? ' readonly' : ''
    return `
      <div class="hub-field ${full ? 'full' : ''}">
        <label for="${id}">${this.escape(label)}</label>
        <input id="${id}" type="${type}" data-field="${field}" value="${this.escape(this.state.form[field] || '')}" placeholder="${this.escape(placeholder)}"${cls}${maxAttr}${readAttr} />
      </div>`
  },

  renderPlanField({ id, label, planIndex, planField, placeholder, value, full = false }) {
    return `
      <div class="hub-field ${full ? 'full' : ''}">
        <label for="${id}">${this.escape(label)}</label>
        <input id="${id}" type="text" data-plan-field="${planField}" data-plan-index="${planIndex}" value="${this.escape(value)}" placeholder="${this.escape(placeholder)}" />
      </div>`
  },

  applyStackQuestionnaireData(data, { forQuiz = false } = {}) {
    this.stackState.questions = data.questions || []
    this.stackState.stackIds = data.stackIds?.length
      ? data.stackIds
      : ['playwright']
    this.stackState.toolsComparison = data.toolsComparison || []
    this.stackState.snapshotPath = data.snapshotPath || '.wizard-qa/conf/onboarding.snapshot.json'
    this.stackState.questionnaireConfigPath = data.questionnaireConfigPath
      || '.wizard-qa/conf/stack-questionnaire.conf.json'
    if (data.chartColors) this.stackState.chartColors = { ...this.stackState.chartColors, ...data.chartColors }
    if (data.stackLabels) this.stackState.stackLabels = { ...this.stackState.stackLabels, ...data.stackLabels }

    const validIds = new Set(this.stackState.questions.map((q) => q.id))
    for (const key of Object.keys(this.stackState.answers)) {
      if (!validIds.has(key)) delete this.stackState.answers[key]
    }

    const configChanged = Array.isArray(data.questionIds)
      && data.stackRecommendation?.questionIds
      && data.questionIds.join('|') !== data.stackRecommendation.questionIds.join('|')

    if (!forQuiz && !configChanged) {
      if (data.stackRecommendation?.answers) {
        this.stackState.answers = { ...data.stackRecommendation.answers }
      }
      if (data.stackRecommendationComplete && data.recommendedStack) {
        this.stackState.chosenStack = data.recommendedStack
        this.stackState.result = {
          recommendedStack: data.recommendedStack,
          recommendedLabel: data.recommendedLabel,
          ranking: data.stackRecommendation?.ranking || [],
          rationale: data.stackRecommendation?.rationale || [],
          toolsComparison: data.stackRecommendation?.toolsComparison || data.toolsComparison,
          scores: data.stackRecommendation?.scores || {},
        }
      }
    } else if (forQuiz || configChanged) {
      this.stackState.result = null
      this.stackState.chosenStack = null
      if (forQuiz) this.stackState.answers = {}
    }
  },

  showStackLoading(message) {
    document.getElementById('hubBoot').hidden = true
    document.getElementById('hubView').hidden = true
    document.getElementById('onboardingView').hidden = false
    const root = document.getElementById('onboardingSteps')
    if (!root) return
    root.innerHTML = `
      <div class="hub-onboarding-card hub-loading-panel">
        ${this.loadingSpinnerHtml()}
        <h2 class="hub-onboarding-title">${this.escape(message || 'Chargement…')}</h2>
      </div>`
  },

  async loadStackQuestionnaire({ forQuiz = false } = {}) {
    const data = await this.apiFetch(`/api/project/stack-questionnaire?_=${Date.now()}`)
    if (!data.ok) {
      throw new Error(data.error || 'Questionnaire indisponible')
    }
    this.applyStackQuestionnaireData(data, { forQuiz })
    await this.ensureStackToolsComparison()
    if (!data.stackRecommendationComplete || forQuiz) {
      this.stackState.result = null
    }
    if (!this.stackState.questions.length) {
      throw new Error(`Aucune question dans ${this.stackState.questionnaireConfigPath || '.wizard-qa/conf/stack-questionnaire.conf.json'}.`)
    }
    return data
  },

  showCompleteScreenError(msg) {
    const el = document.getElementById('obCompleteStatus')
    if (!el) return
    Portail.showStatus(el, false, msg)
    el.style.display = 'block'
  },

  showOnboardingCompleteScreen(res) {
    this.state.wizardFlow = 'prise-complete'
    document.getElementById('hubBoot').hidden = true
    document.getElementById('hubView').hidden = true
    document.getElementById('onboardingView').hidden = false

    const obHero = document.querySelector('#onboardingView .hub-hero')
    if (obHero) {
      obHero.innerHTML = `
        <h1>Prise de connaissance terminée</h1>
        <p>Vos informations ont été enregistrées. Vous pouvez maintenant choisir votre application de test automatisée.</p>`
    }

    const snapshotPath = res.snapshotPath || '.wizard-qa/conf/onboarding.snapshot.json'
    const configPath = res.configPath || '.wizard-qa/conf/project.variables.json'
    const folderMsg = res.folders?.length
      ? `${res.folders.length} dossier(s) plan créé(s).`
      : 'Configuration projet enregistrée.'

    const root = document.getElementById('onboardingSteps')
    root.innerHTML = `
      <div class="hub-onboarding-card hub-complete-card card card-compact">
        <div class="hub-complete-icon" aria-hidden="true">✓</div>
        <h2 class="hub-onboarding-title">Espace de travail prêt</h2>
        <p class="hub-onboarding-lead">${this.escape(folderMsg)}</p>
        <ul class="hub-onboarding-list hub-complete-files">
          <li>Variables projet : <code>${this.escape(configPath)}</code></li>
          <li>Prise de connaissance : <code>${this.escape(snapshotPath)}</code></li>
        </ul>
        <p class="hint hint-tight">Le questionnaire suivant vous aide à choisir votre solution de test — sans compétence technique requise.</p>
        <div id="obCompleteStatus" class="status wizard-unified-status" style="display:none"></div>
        <div class="hub-onboarding-actions hub-complete-actions">
          <button type="button" class="btn-secondary btn-sm" id="obSkipStack">Quitter l'assistant et retour à l'accueil</button>
          <button type="button" class="btn-primary btn-sm" id="obStartStack">Définir votre application de test automatisée</button>
        </div>
      </div>`

    document.getElementById('obSkipStack')?.addEventListener('click', () => {
      this.finishOnboardingToHub().catch((err) => this.showCompleteScreenError(err.message))
    })
    document.getElementById('obStartStack')?.addEventListener('click', () => {
      this.stackState.result = null
      this.stackState.stepIndex = 0
      this.launchStackQuestionnaire(false).catch((err) => this.showStackFlowError(err.message, false))
    })
  },

  showStackFlowError(msg, fromHub) {
    const statusEl = document.getElementById('obCompleteStatus') || document.getElementById('homeStatus')
    if (statusEl) {
      Portail.showStatus(statusEl, false, msg)
      statusEl.style.display = 'block'
    }
    const root = document.getElementById('onboardingSteps')
    if (!root) return
    root.innerHTML = `
      <div class="hub-onboarding-card">
        <p class="hint hint-tight">${this.escape(msg)}</p>
        <p class="hint hint-tight">Essayez <strong>Wizard QA : Redémarrer le serveur</strong> depuis la palette de commandes.</p>
        <div class="hub-onboarding-actions">
          ${fromHub ? '<button type="button" class="btn-secondary btn-sm" id="stackErrBack">Retour accueil</button>' : ''}
          <button type="button" class="btn-primary btn-sm" id="stackErrRetry">Réessayer</button>
        </div>
      </div>`
    document.getElementById('stackErrRetry')?.addEventListener('click', () => {
      this.launchStackQuestionnaire(fromHub).catch((e) => this.showStackFlowError(e.message, fromHub))
    })
    document.getElementById('stackErrBack')?.addEventListener('click', () => {
      this.finishOnboardingToHub().catch(() => {})
    })
  },

  async launchStackQuestionnaire(fromHub = false) {
    this.showStackLoading('Chargement du questionnaire…')
    this.stackState.result = null
    this.stackState.chosenStack = null
    this.stackState.stepIndex = 0
    this.stackState.answers = {}
    await this.loadStackQuestionnaire({ forQuiz: true })
    await this.startStackQuestionnaire(fromHub)
  },

  async finishOnboardingToHub(message) {
    const catalog = await this.apiFetch('/api/home/catalog')
    this.state.catalog = this.applyHubCatalogPatches(catalog)
    this.showHub(this.state.catalog)
    if (message) {
      Portail.showStatus(document.getElementById('homeStatus'), true, message)
    }
  },

  async startStackQuestionnaire(fromHub = false) {
    this.state.wizardFlow = 'stack'
    document.getElementById('onboardingView')?.classList.add('stack-quiz-flow')
    if (!this.stackState.questions.length) {
      await this.loadStackQuestionnaire({ forQuiz: true })
    }
    if (this.stackState.result && fromHub && !this.stackState._forceStackQuiz) {
      await this.showStackResults()
      return
    }
    this.stackState._forceStackQuiz = false
    this.stackState.stepIndex = 0
    document.getElementById('hubBoot').hidden = true
    document.getElementById('hubView').hidden = true
    document.getElementById('onboardingView').hidden = false
    const obHero = document.querySelector('#onboardingView .hub-hero')
    if (obHero) {
      obHero.innerHTML = `
        <h1>Choix de votre application de test</h1>
        <p>Répondez simplement — nous vous orienterons vers la solution la plus adaptée à votre contexte.</p>
        <p class="hint hint-tight stack-quiz-source">Fichier lu : <code>${this.escape(this.stackState.questionnaireConfigPath)}</code> · ${this.stackState.questions.length} étape(s)</p>`
    }
    this.renderStackQuestionStep()
  },

  currentStackQuestion() {
    return this.stackState.questions[this.stackState.stepIndex] || null
  },

  renderStackQuizProgressBar(stepIndex, total) {
    const current = stepIndex + 1
    const pct = total > 0 ? Math.round((current / total) * 100) : 0
    return `
      <div class="hub-progress-wrap stack-quiz-progress-wrap">
        <div class="hub-progress-label">
          <span>Progression</span>
          <span>Page ${current} / ${total} · ${pct}%</span>
        </div>
        <div class="hub-progress-track" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Question ${current} sur ${total}">
          <div class="hub-progress-fill is-animating" style="width:${pct}%"></div>
        </div>
      </div>`
  },

  renderStackQuestionStep() {
    const q = this.currentStackQuestion()
    const root = document.getElementById('onboardingSteps')
    if (!q) {
      if (!this.stackState.questions.length) {
        this.showCompleteScreenError('Impossible de charger le questionnaire.')
        return
      }
      this.submitStackQuestionnaire()
      return
    }

    const total = this.stackState.questions.length
    const dots = this.stackState.questions.map((item, i) => {
      const cls = i < this.stackState.stepIndex ? 'is-done' : i === this.stackState.stepIndex ? 'is-active' : ''
      return `<span class="hub-step-dot ${cls}" title="${this.escape(item.title)}"></span>`
    }).join('')

    const options = q.options.map((opt) => {
      const checked = this.stackState.answers[q.id] === opt.id ? ' is-selected' : ''
      return `
        <button type="button" class="stack-quiz-option${checked}" data-qid="${this.escape(q.id)}" data-oid="${this.escape(opt.id)}">
          <span class="stack-quiz-option-radio" aria-hidden="true"></span>
          <span class="stack-quiz-option-label">${this.escape(opt.label)}</span>
        </button>`
    }).join('')

    root.innerHTML = `
      <section class="card card-compact stack-quiz-card">
        ${this.renderStackQuizProgressBar(this.stackState.stepIndex, total)}
        <div class="stack-quiz-head">
          <p class="form-section-title stack-quiz-theme">${this.escape(q.title)}</p>
          <div class="hub-onboarding-steps stack-quiz-steps">${dots}</div>
        </div>
        <p class="hint hint-tight stack-quiz-progress">Question ${this.stackState.stepIndex + 1} sur ${total}</p>
        <h2 class="form-section-title stack-quiz-question">${this.escape(q.question)}</h2>
        ${q.hint ? `<p class="hint hint-tight stack-quiz-hint">${this.escape(q.hint)}</p>` : ''}
        <div class="stack-quiz-options" role="radiogroup" aria-label="${this.escape(q.question)}">${options}</div>
        <div id="stackObStatus" class="status wizard-unified-status" style="display:none;margin-top:10px"></div>
        <div class="stack-quiz-actions npmrc-action-buttons">
          <button type="button" class="btn-secondary btn-sm" id="stackPrev" ${this.stackState.stepIndex === 0 ? 'disabled' : ''}>Retour</button>
          <button type="button" class="btn-primary btn-sm" id="stackNext">${this.stackState.stepIndex === total - 1 ? 'Voir ma recommandation' : 'Continuer'}</button>
        </div>
      </section>`

    root.querySelectorAll('.stack-quiz-option').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.stackState.answers[btn.dataset.qid] = btn.dataset.oid
        root.querySelectorAll('.stack-quiz-option').forEach((b) => b.classList.remove('is-selected'))
        btn.classList.add('is-selected')
        this.hideStackError()
      })
    })

    document.getElementById('stackPrev')?.addEventListener('click', () => {
      if (this.stackState.stepIndex > 0) {
        this.stackState.stepIndex -= 1
        this.renderStackQuestionStep()
      }
    })

    document.getElementById('stackNext')?.addEventListener('click', () => {
      if (!this.stackState.answers[q.id]) {
        this.showStackError('Choisissez une réponse pour continuer.')
        return
      }
      if (this.stackState.stepIndex < total - 1) {
        this.stackState.stepIndex += 1
        this.renderStackQuestionStep()
      } else {
        this.submitStackQuestionnaire()
      }
    })
  },

  showStackError(msg) {
    const el = document.getElementById('stackObStatus')
    if (!el) return
    Portail.showStatus(el, false, msg)
    el.style.display = 'block'
  },

  hideStackError() {
    const el = document.getElementById('stackObStatus')
    if (el) el.style.display = 'none'
  },

  computeStackRecommendationLocal(answers) {
    const stacks = this.stackState.stackIds?.length
      ? this.stackState.stackIds
      : ['playwright']
    const scores = {}
    for (const id of stacks) scores[id] = 0
    const qMap = new Map((this.stackState.questions || []).map((q) => [q.id, q]))

    for (const [questionId, optionId] of Object.entries(answers || {})) {
      const question = qMap.get(questionId)
      const option = question?.options?.find((o) => o.id === optionId)
      if (!option?.weights) continue
      for (const id of stacks) scores[id] += option.weights[id] || 0
      for (const [k, v] of Object.entries(option.weights)) {
        if (!(k in scores)) scores[k] = Number(v) || 0
      }
    }

    const ranking = stacks
      .map((id) => ({
        id,
        label: this.stackState.stackLabels[id] || id,
        score: scores[id],
      }))
      .sort((a, b) => b.score - a.score)

    const maxScore = ranking[0]?.score || 1
    const totalScore = stacks.reduce((sum, id) => sum + scores[id], 0) || 1
    const rankingWithPercent = ranking.map((r) => ({
      ...r,
      percent: maxScore > 0 ? Math.round((r.score / maxScore) * 100) : 0,
      sharePercent: totalScore > 0 ? Math.round((r.score / totalScore) * 100) : 25,
    }))

    const recommendedStack = rankingWithPercent[0]?.id || 'playwright'
    return {
      scores,
      ranking: rankingWithPercent,
      recommendedStack,
      recommendedLabel: this.stackState.stackLabels[recommendedStack] || recommendedStack,
      rationale: [
        `**${this.stackState.stackLabels[recommendedStack] || recommendedStack}** ressort comme la solution la mieux adaptée à vos réponses.`,
      ],
      toolsComparison: [...(this.stackState.toolsComparison || [])],
    }
  },

  async submitStackQuestionnaire() {
    const root = document.getElementById('onboardingSteps')
    root.innerHTML = `
      <div class="hub-onboarding-card hub-loading-panel">
        ${this.loadingSpinnerHtml()}
        <h2 class="hub-onboarding-title">Analyse de votre profil…</h2>
        <p class="hub-onboarding-lead">Calcul de la recommandation et enregistrement dans votre fichier de prise de connaissance.</p>
      </div>`

    try {
      const res = await this.apiFetch('/api/project/stack-recommendation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: this.stackState.answers }),
      })
      this.stackState.result = res.recommendation
      this.stackState.chosenStack = res.recommendation?.recommendedStack || null
      this.stackState.snapshotPath = res.snapshotPath || this.stackState.snapshotPath
      this.stackState._localOnly = false
      this.clearLocalStackChoice()
      await this.showStackResults()
      void this.tryPersistStackToServer()
    } catch (err) {
      const staleServer = this.isStaleServerError(err)
      if (staleServer) {
        await this.ensureStackToolsComparison()
        this.stackState.result = this.computeStackRecommendationLocal(this.stackState.answers)
        this.stackState.chosenStack = this.stackState.result.recommendedStack
        this.stackState._localOnly = true
        this.saveLocalStackChoice(this.stackState.chosenStack, this.stackState.result.recommendedLabel)
        await this.showStackResults()
        void this.tryPersistStackToServer()
        return
      }
      this.stackState.stepIndex = Math.max(0, this.stackState.questions.length - 1)
      this.renderStackQuestionStep()
      this.showStackError(err.message)
    }
  },

  stackLogoFile(stackId) {
    const map = { playwright: 'playwright' }
    return map[stackId] || 'playwright'
  },

  renderStackDonutSvg(percent, color) {
    const r = 42
    const c = 2 * Math.PI * r
    const offset = c * (1 - Math.min(100, Math.max(0, percent)) / 100)
    return `
      <svg class="hub-pie-svg" viewBox="0 0 100 100" role="img" aria-hidden="true">
        <circle class="hub-pie-track" cx="50" cy="50" r="${r}" />
        <circle class="hub-pie-fill" cx="50" cy="50" r="${r}"
          stroke="${color}"
          stroke-dasharray="${c.toFixed(2)}"
          stroke-dashoffset="${offset.toFixed(2)}" />
        <text class="hub-pie-pct" x="50" y="54">${percent}%</text>
      </svg>`
  },

  renderStackPieGrid(ranking, activeStack) {
    const order = this.stackState.stackIds?.length
      ? this.stackState.stackIds
      : ['playwright']
    const rankMap = new Map((ranking || []).map((r) => [r.id, r]))
    return order.map((id) => {
      const item = rankMap.get(id) || { id, sharePercent: 0, score: 0 }
      const pct = item.sharePercent ?? item.percent ?? 0
      const color = this.stackState.chartColors[id] || '#009597'
      const label = this.stackState.stackLabels[id] || id
      const selected = activeStack === id ? ' is-selected' : ''
      const recommended = ranking?.[0]?.id === id ? ' is-recommended' : ''
      return `
        <button type="button" class="hub-pie-card${selected}${recommended}" data-stack-id="${id}" title="Choisir ${this.escape(label)}">
          ${this.renderStackDonutSvg(pct, color)}
          <img class="hub-pie-logo" src="${this.apiUrl(`/assets/logo-${this.stackLogoFile(id)}.png`)}" alt="" />
          <span class="hub-pie-name">${this.escape(label)}</span>
          <span class="hub-pie-score">${item.score || 0} pts</span>
        </button>`
    }).join('')
  },

  async selectStackFromPie(stackId) {
    const label = this.stackState.stackLabels[stackId] || stackId
    document.querySelectorAll('.hub-pie-card').forEach((el) => {
      el.classList.toggle('is-selected', el.dataset.stackId === stackId)
      el.disabled = true
    })
    const status = document.getElementById('stackPieStatus')
    try {
      if (!this.stackState._localOnly) {
        await this.apiFetch('/api/project/stack-choice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stackId }),
        })
        this.clearLocalStackChoice()
        this.stackState._localOnly = false
      } else {
        this.stackState.chosenStack = stackId
        const persisted = await this.tryPersistStackToServer(stackId)
        if (!persisted) {
          this.applyStackChoiceLocally(stackId, label)
        }
      }
      if (this.stackState.result) {
        this.stackState.result.recommendedStack = stackId
        this.stackState.result.recommendedLabel = label
      }
      this.stackState.chosenStack = stackId
      if (status) {
        const suffix = this.stackState._localOnly
          ? ' — enregistrement au prochain redémarrage du serveur.'
          : ' — cliquez sur « Retour à l\'accueil » pour le voir.'
        Portail.showStatus(status, true, `${label} est mis en avant sur l'accueil${suffix}`)
        status.style.display = 'block'
      }
    } catch (err) {
      if (this.isStaleServerError(err) || this.stackState._localOnly) {
        this.applyStackChoiceLocally(stackId, label)
        if (status) {
          Portail.showStatus(status, true, `${label} est mis en avant sur l'accueil — enregistrement au prochain redémarrage du serveur.`)
          status.style.display = 'block'
        }
        void this.tryPersistStackToServer(stackId)
      } else if (status) {
        Portail.showStatus(status, false, err.message)
        status.style.display = 'block'
      }
    } finally {
      document.querySelectorAll('.hub-pie-card').forEach((el) => { el.disabled = false })
    }
  },

  renderStackComparisonChart(tools, ranking) {
    const rankMap = new Map((ranking || []).map((r) => [r.id, r]))
    const winnerId = this.stackState.chosenStack || this.stackState.result?.recommendedStack
    const list = (tools || []).filter((tool) => tool?.id)
    if (!list.length) {
      return '<p class="hint hint-tight">Comparatif indisponible — rechargez la page après redémarrage du serveur Wizard QA.</p>'
    }
    return list.map((tool) => {
      const rank = rankMap.get(tool.id)
      const pros = tool.pros || []
      const cons = tool.cons || []
      const prosMax = Math.max(...pros.map((p) => p.weight), 1)
      const consMax = Math.max(...cons.map((c) => c.weight), 1)
      const prosBars = pros.map((p) => `
        <div class="hub-chart-row hub-chart-row--pro">
          <span class="hub-chart-sign">+</span>
          <span class="hub-chart-label">${this.escape(p.label)}</span>
          <span class="hub-chart-bar-wrap"><span class="hub-chart-bar hub-chart-bar--pro" style="width:${Math.round((p.weight / prosMax) * 100)}%"></span></span>
        </div>`).join('')
      const consBars = cons.map((c) => `
        <div class="hub-chart-row hub-chart-row--con">
          <span class="hub-chart-sign">−</span>
          <span class="hub-chart-label">${this.escape(c.label)}</span>
          <span class="hub-chart-bar-wrap"><span class="hub-chart-bar hub-chart-bar--con" style="width:${Math.round((c.weight / consMax) * 100)}%"></span></span>
        </div>`).join('')
      const scoreBar = rank
        ? `<div class="hub-chart-score"><span class="hub-chart-score-label">Adéquation profil</span><span class="hub-chart-bar-wrap"><span class="hub-chart-bar hub-chart-bar--score" style="width:${rank.percent}%"></span></span><span class="hub-chart-score-val">${rank.percent}%</span></div>`
        : ''
      return `
        <article class="hub-chart-tool${tool.id === winnerId ? ' is-winner' : ''}">
          <header class="hub-chart-tool-head">
            <h3>${this.escape(tool.label)}</h3>
            ${tool.id === winnerId ? '<span class="hub-chart-winner-badge">Recommandé</span>' : ''}
          </header>
          <p class="hub-chart-purpose">${this.escape(tool.purpose)}</p>
          ${scoreBar}
          <div class="hub-chart-section">
            <h4>Points forts</h4>
            ${prosBars}
          </div>
          <div class="hub-chart-section">
            <h4>Limites</h4>
            ${consBars}
          </div>
        </article>`
    }).join('')
  },

  async showStackResults() {
    const r = this.stackState.result
    if (!r) return

    await this.ensureStackToolsComparison()
    const tools = r.toolsComparison?.length ? r.toolsComparison : this.stackState.toolsComparison
    if (!r.toolsComparison?.length && tools.length) {
      r.toolsComparison = tools
    }

    this.state.wizardFlow = 'stack-results'
    document.getElementById('hubBoot').hidden = true
    document.getElementById('hubView').hidden = true
    document.getElementById('onboardingView').hidden = false

    const activeStack = this.stackState.chosenStack || r.recommendedStack

    const obHero = document.querySelector('#onboardingView .hub-hero')
    if (obHero) {
      obHero.innerHTML = `
        <h1>Votre orientation</h1>
        <p>Cliquez sur une solution pour la mettre en avant sur l'accueil. Les pourcentages reflètent l'adéquation à vos réponses.</p>`
    }

    const rationale = (r.rationale || []).map((line) => {
      const safe = this.escape(line)
      return `<li>${safe.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</li>`
    }).join('')

    const root = document.getElementById('onboardingSteps')
    root.innerHTML = `
      <section class="card card-compact stack-quiz-card stack-quiz-result-card">
        <div class="hub-stack-winner">
          <img class="hub-stack-winner-logo" src="${this.apiUrl(`/assets/logo-${this.stackLogoFile(activeStack)}.png`)}" alt="" />
          <div>
            <p class="hub-stack-winner-kicker">Suggestion du questionnaire</p>
            <h2 class="hub-onboarding-title">${this.escape(r.recommendedLabel)}</h2>
            <p class="hint hint-tight hub-stack-winner-hint">Cliquez sur un camembert ci-dessous pour confirmer ou choisir une autre solution.</p>
          </div>
        </div>
        <h3 class="hub-subsection-title">Répartition selon vos réponses</h3>
        <p class="hint hint-tight hub-pie-lead">Chaque camembert indique la part de votre profil orientée vers cette technologie.</p>
        <div class="hub-pie-grid" role="group" aria-label="Choix de la stack de test">${this.renderStackPieGrid(r.ranking, activeStack)}</div>
        <div id="stackPieStatus" class="status wizard-unified-status" style="display:none"></div>
        ${this.renderDeferredPersistBlock()}
        <ul class="hub-onboarding-list hub-stack-rationale">${rationale}</ul>
        <details class="hub-stack-details" open>
          <summary>Comparatif détaillé des 4 solutions</summary>
          <p class="hint hint-tight">Chaque barre illustre l'importance relative d'un atout (+) ou d'une limite (−) pour cette technologie.</p>
          <div class="hub-chart-grid">${this.renderStackComparisonChart(tools, r.ranking)}</div>
        </details>
        <p class="hint hint-tight hub-stack-saved">Enregistré dans <code>${this.escape(this.stackState.snapshotPath)}</code>
          · Questionnaire lu depuis <code>${this.escape(this.stackState.questionnaireConfigPath)}</code> (modifiez ce fichier pour ajouter des questions)</p>
        <div class="stack-quiz-actions npmrc-action-buttons">
          <button type="button" class="btn-secondary btn-sm" id="stackRedo">Refaire le questionnaire</button>
          <button type="button" class="btn-primary btn-sm" id="stackToHub">Retour à l'accueil</button>
        </div>
      </section>`

    this.bindDeferredPersistActions(root)

    root.querySelectorAll('.hub-pie-card').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.selectStackFromPie(btn.dataset.stackId).catch(() => {})
      })
    })

    document.getElementById('stackToHub')?.addEventListener('click', () => {
      const stackId = this.stackState.chosenStack || r.recommendedStack
      const label = this.stackState.stackLabels[stackId] || r.recommendedLabel
      this.finishOnboardingToHub(`${label} est mis en avant sur l'accueil.`).catch((err) => {
        Portail.showStatus(document.getElementById('homeStatus'), false, err.message)
      })
    })
    document.getElementById('stackRedo')?.addEventListener('click', () => {
      this.stackState.result = null
      this.stackState.chosenStack = null
      this.stackState.stepIndex = 0
      this.clearLocalStackChoice()
      this.launchStackQuestionnaire(true).catch((err) => this.showStackError(err.message))
    })

    void this.tryPersistStackToServer()
  },
}

document.addEventListener('DOMContentLoaded', () => HomeHub.init())
if (!window.__homeHubSoftNavHook) {
  window.__homeHubSoftNavHook = true
  window.addEventListener('wizard:page-ready', (e) => {
    const p = String(e.detail?.path || '/')
    if (p === '/' || p === '/index.html') void HomeHub.init()
  })
}

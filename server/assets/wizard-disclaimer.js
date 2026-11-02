/**
 * Pop-ups disclaimer Wizard QA — template unique (logo loader, panneau, textes config).
 * Textes : GET /api/wizard/ui-wording → .wizard-qa/conf/ui-wording.conf.json
 *
 * API :
 *   WizardDisclaimer.show('launchDisclaimer')
 *   WizardDisclaimer.showAutoForPage() — déclenche tous les pop-ups pageLoad de la page courante
 */
// eslint-disable-next-line no-var
var WizardDisclaimer = {
  _config: null,
  _preferences: null,
  _state: {},
  _currentPopupId: null,
  _showing: false,
  _closeWaiter: null,
  _confirmResolver: null,
  STORAGE_KEY: 'wizardQa.popupPreferences',
  EXTENSION_VERSION_KEY: 'wizardQa.lastExtensionVersion',
  POPUPS_RESET_ON_EXTENSION_VERSION: ['launchDisclaimer'],
  STACK_INTRO_BY_PAGE: {
    cypressInstall: 'cypressInstallIntro',
    playwrightInstall: 'playwrightInstallIntro',
    robotInstall: 'robotInstallIntro',
    postmanInstall: 'postmanInstallIntro',
    k6Install: 'k6InstallIntro',
    k6Wizard: 'k6WizardIntro',
  },

  getPreferencesMap() {
    if (this._preferences) return this._preferences
    return this.loadPersistedPreferences()
  },

  loadPersistedPreferences() {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY)
      return raw ? JSON.parse(raw) : {}
    } catch {
      return {}
    }
  },

  savePersistedPreferences(prefs) {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(prefs))
    } catch { /* quota / webview */ }
  },

  maybeResetPreferencesForExtensionVersion(serverLastVersion) {
    const extVer = String(window.__WIZARD_VERSION__ || '').trim()
    if (!extVer) return
    const last = String(serverLastVersion || localStorage.getItem(this.EXTENSION_VERSION_KEY) || '').trim()
    if (last === extVer) return

    const prefs = { ...this.loadPersistedPreferences() }
    for (const popupId of this.POPUPS_RESET_ON_EXTENSION_VERSION) {
      delete prefs[popupId]
    }
    this._preferences = prefs
    this.savePersistedPreferences(prefs)
    try {
      localStorage.setItem(this.EXTENSION_VERSION_KEY, extVer)
    } catch { /* ignore */ }
  },

  wasPermanentlyHidden(popupId) {
    const prefs = this.getPreferencesMap()
    return Boolean(prefs[popupId]?.hidden)
  },

  async setPermanentlyHidden(popupId) {
    const at = new Date().toISOString()
    const prefs = { ...this.getPreferencesMap() }
    prefs[popupId] = { hidden: true, at }
    this._preferences = prefs
    this.savePersistedPreferences(prefs)
    try {
      const r = await fetch(this.apiUrl('/api/wizard/ui-wording/preferences/hide'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ popupId }),
      })
      const data = await r.json().catch(() => ({}))
      if (r.ok && data.hiddenPopups) {
        this._preferences = data.hiddenPopups
        this.savePersistedPreferences(data.hiddenPopups)
      }
    } catch {
      /* fichier serveur indisponible — cache local conservé */
    }
  },

  getNeverShowLabel(popup) {
    const label = String(
      popup?.neverShowButton
      || this._config?.neverShowButton
      || 'Ne plus afficher le pop-up',
    ).trim()
    return label || 'Ne plus afficher le pop-up'
  },

  apiUrl(path) {
    const base = window.__WIZARD_API_BASE__ || ''
    if (!base) return path
    return `${String(base).replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`
  },

  escape(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  },

  getBootId() {
    return window.__WIZARD_BOOT_ID__
      || new URLSearchParams(window.location.search).get('_boot')
      || 'default'
  },

  getCurrentPageKey() {
    const body = document.body
    if (!body) return 'unknown'
    if (body.classList.contains('page-home')) return 'home'
    if (body.classList.contains('page-hook-git')) return 'hookGit'
    if (body.classList.contains('page-hook')) return 'hook'
    if (body.classList.contains('page-sync-jira')) return 'syncJira'
    if (body.classList.contains('page-npmrc')) return 'npmrc'
    if (body.classList.contains('page-node-install')) return 'nodeInstall'
    if (body.classList.contains('page-npm-install')) return 'npmInstall'
    if (body.classList.contains('page-cypress-install')) return 'cypressInstall'
    if (body.classList.contains('page-playwright-install')) return 'playwrightInstall'
    if (body.classList.contains('page-robot-install')) return 'robotInstall'
    if (body.classList.contains('page-postman-install')) return 'postmanInstall'
    if (body.classList.contains('page-k6-install')) return 'k6Install'
    if (body.classList.contains('page-k6-wizard')) return 'k6Wizard'
    if (body.classList.contains('page-repair')) return 'repair'
    if (body.classList.contains('page-doc-qa')) return 'docQa'
    if (body.classList.contains('page-wiki')) return 'wiki'
    return 'unknown'
  },

  popupMatchesPage(popup, pageKey) {
    const pages = popup?.pages
    if (!pages || !pages.length) return pageKey === 'home'
    if (pages.includes('*')) return true
    return pages.includes(pageKey)
  },

  builtinPopups() {
    return {
      launchDisclaimer: {
        enabled: true,
        template: 'disclaimer',
        showOn: 'pageLoad',
        pages: ['home'],
        order: 1,
        id: 'launchDisclaimer',
        title: 'Wizard QA Assistant',
        logo: '/assets/logo-qa.png',
        logoAlt: 'QA',
        paragraphs: [
          "Ceci est un assistant de configuration pour initier un environnement de test automatisé. Plusieurs Wizard seront proposés pour vous permettre d'installer votre logiciel de test automatisé, et synchroniser votre projet avec vos Board JIRA.",
          "Il vous permettra également d'initier une documentation de référence à partir d'un modèle. Vous pourrez compléter les documents et vous aider des fonctionnalités présentes dans ce Wizard pour maintenir vos documentations à jour en fonction des tests que vous publierez sur JIRA.",
          'Votre projet VS Code sera le projet de référence et conditionnera l\'ensemble des fonctions de l\'application pour synchroniser votre Local → Documentation → JIRA Xray.',
        ],
        closeButton: 'Fermer',
      },
      npmInstallPrompt: {
        enabled: true,
        template: 'disclaimer',
        showOn: 'manual',
        pages: ['npmrc', 'npmInstall'],
        order: 1,
        id: 'npmInstallPrompt',
        title: 'Voulez-vous installer NPM ?',
        logo: '/assets/logo-qa.png',
        logoAlt: 'QA',
        paragraphs: [
          'Le fichier .npmrc a été généré avec succès.',
          'Souhaitez-vous lancer npm install maintenant ? Les versions des paquets sont définies dans npm-install.conf.json.',
        ],
        closeButton: 'Plus tard',
        confirmButton: 'Installer NPM',
      },
      onboardingIntroPrompt: {
        enabled: true,
        template: 'disclaimer',
        showOn: 'manual',
        pages: ['home'],
        order: 2,
        id: 'onboardingIntroPrompt',
        title: 'Prise de connaissance du projet de votre environnement',
        logo: '/assets/logo-qa.png',
        logoAlt: 'QA',
        paragraphs: [
          'Dans cet assistant, vous allez définir les informations propres à votre projet :',
          'Product Owner, Business Analyst, Scrum Master, QA testeur, tribu / squad, codes produit et solution, URL JIRA, plans de test, etc.',
          'Ces variables seront nécessaires au conditionnement des actions réalisées par l\'outil.',
        ],
        closeButton: 'Annuler',
        confirmButton: 'Commencer la configuration du projet',
      },
      packageJsonPrompt: {
        enabled: true,
        template: 'disclaimer',
        showOn: 'manual',
        pages: ['npmrc'],
        order: 2,
        id: 'packageJsonPrompt',
        title: 'Disposez-vous d\'un package.json ?',
        logo: '/assets/logo-qa.png',
        logoAlt: 'QA',
        paragraphs: [
          'Un fichier package.json à la racine du projet est nécessaire pour npm install.',
          'Si vous n\'en avez pas encore, un modèle basé sur le projet Cypress de référence vous sera proposé.',
        ],
        closeButton: 'Non',
        confirmButton: 'Oui',
      },
      nodeUpdatePrompt: {
        enabled: true,
        template: 'disclaimer',
        showOn: 'manual',
        pages: ['nodeInstall'],
        order: 3,
        id: 'nodeUpdatePrompt',
        title: 'Mise à jour Node',
        logo: '/assets/logo-qa.png',
        logoAlt: 'QA',
        paragraphs: [
          'Node est présent en version {current}.',
          'Souhaitez-vous le mettre à jour avec la version {target} ?',
        ],
        closeButton: 'Conserver la version actuelle',
        confirmButton: 'Mettre à jour',
      },
      npmUpdatePrompt: {
        enabled: true,
        template: 'disclaimer',
        showOn: 'manual',
        pages: ['npmInstall'],
        order: 4,
        id: 'npmUpdatePrompt',
        title: 'Mise à jour npm',
        logo: '/assets/logo-qa.png',
        logoAlt: 'QA',
        paragraphs: [
          'npm est présent en version {current}.',
          'Souhaitez-vous le mettre à jour avec la version {target} ?',
        ],
        closeButton: 'Conserver la version actuelle',
        confirmButton: 'Mettre à jour',
      },
      npmInstallComplete: {
        enabled: true,
        template: 'disclaimer',
        showOn: 'manual',
        pages: ['npmInstall'],
        order: 5,
        id: 'npmInstallComplete',
        title: 'Installation complète',
        logo: '/assets/logo-qa.png',
        logoAlt: 'QA',
        paragraphs: [
          'Vous disposez désormais de :',
          'Node : version {nodeVersion}',
          'npm : version {npmVersion}',
        ],
        closeButton: 'Fermer',
      },
      cypressInstallIntro: {
        enabled: true,
        template: 'disclaimer',
        showOn: 'pageLoad',
        pages: ['cypressInstall'],
        order: 1,
        id: 'cypressInstallIntro',
        title: 'Cypress — tests E2E navigateur',
        logo: '/assets/logo-cypress.png',
        logoAlt: 'Cypress',
        paragraphs: [
          'Cypress est un framework de tests de bout en bout (E2E) : il pilote un vrai navigateur pour simuler les parcours utilisateur sur votre application web.',
          'À quoi ça sert : écrire des scénarios de régression UI, smoke tests après déploiement, et valider les écrans métier avec le framework CA-TS @cats-cdf/e2e.',
          'Avantages : exécution rapide dans le navigateur, time-travel et captures à l’échec, intégration npm/Artifactory CA-TS, et compatibilité avec le hook Git JIRA/Xray sur les fichiers .feature.',
        ],
        closeButton: 'Compris — lancer l’installation',
      },
      playwrightInstallIntro: {
        enabled: true,
        template: 'disclaimer',
        showOn: 'pageLoad',
        pages: ['playwrightInstall'],
        order: 1,
        id: 'playwrightInstallIntro',
        title: 'Playwright — tests E2E multi-navigateurs',
        logo: '/assets/logo-playwright.png',
        logoAlt: 'Playwright',
        paragraphs: [
          'Playwright (Microsoft) automatise Chrome, Firefox et WebKit avec une API moderne en TypeScript/JavaScript.',
          'À quoi ça sert : campagnes E2E cross-browser, tests parallèles, enregistrement de scénarios via l’extension VS Code, et industrialisation en CI.',
          'Avantages : traces et vidéos de débogage, exécution stable, codegen intégré, et écosystème npm aligné sur Node CA-TS.',
        ],
        closeButton: 'Compris — lancer l’installation',
      },
      robotInstallIntro: {
        enabled: true,
        template: 'disclaimer',
        showOn: 'pageLoad',
        pages: ['robotInstall'],
        order: 1,
        id: 'robotInstallIntro',
        title: 'Robot Framework — tests keyword-driven',
        logo: '/assets/logo-robot.png',
        logoAlt: 'Robot Framework',
        paragraphs: [
          'Robot Framework est un framework Python orienté mots-clés : les scénarios (.robot) lisent comme du langage métier structuré.',
          'À quoi ça sert : parcours web (SeleniumLibrary), API (Requests), fichiers et intégrations — idéal quand des testeurs fonctionnels participent à l’automatisation.',
          'Avantages : syntaxe accessible, bibliothèques riches, rapports log.html/report.html détaillés, et bonne adéquation aux processus métier complets CA-TS.',
        ],
        closeButton: 'Compris — lancer l’installation',
      },
      postmanInstallIntro: {
        enabled: true,
        template: 'disclaimer',
        showOn: 'pageLoad',
        pages: ['postmanInstall'],
        order: 1,
        id: 'postmanInstallIntro',
        title: 'Postman & Newman — tests d’API REST',
        logo: '/assets/logo-postman.png',
        logoAlt: 'Postman',
        paragraphs: [
          'Postman (client lourd) sert à concevoir et exécuter des requêtes HTTP : collections de tests API, environnements (baseUrl, tokens…) et scripts de validation.',
          'À quoi ça sert : tester des services sans interface graphique — smoke API, régression backend, contrats REST — puis versionner les exports JSON dans Git.',
          'Newman est le moteur en ligne de commande (npm) qui rejoue vos collections Postman sans ouvrir l’interface : parfait pour CI/CD, rapports HTML/JUnit et campagnes planifiées.',
          'Avantages : prise en main simple pour les QA API, séparation Desktop (conception) / Newman (automatisation), et scripts npm test:api:smoke générés par ce wizard.',
        ],
        closeButton: 'Compris — initialiser Postman',
      },
      k6InstallIntro: {
        enabled: true,
        template: 'disclaimer',
        showOn: 'pageLoad',
        pages: ['k6Install'],
        order: 1,
        id: 'k6InstallIntro',
        title: 'k6 — tests de charge et performance',
        logo: '/assets/logo-k6.png',
        logoAlt: 'k6',
        paragraphs: [
          'k6 (Grafana) est un outil open source de test de charge : il simule des milliers d’utilisateurs virtuels (VUs) pour mesurer temps de réponse, débit et stabilité sous charge.',
          'À quoi ça sert : valider qu’une application ou une API tient la charge attendue (pic d’affluence, batch, fin de mois…) avant la mise en production.',
          'Ce wizard génère une arborescence k6/ (script smoke, seuils p95), installe @types/k6 pour l’édition, et tente d’installer le binaire k6 (winget ou manuel). Les campagnes se lancent en CLI : k6 run ou npm run test:perf:smoke.',
          'Avantages : scripts JavaScript lisibles, métriques intégrées, intégration CI/CD, complémentaire aux tests fonctionnels Cypress/Playwright/Postman.',
        ],
        closeButton: 'Compris — initialiser k6',
      },
      k6WizardIntro: {
        enabled: true,
        template: 'disclaimer',
        showOn: 'pageLoad',
        pages: ['k6Wizard'],
        order: 1,
        id: 'k6WizardIntro',
        title: 'Wizard k6 — paramétrage des campagnes',
        logo: '/assets/logo-k6.png',
        logoAlt: 'k6',
        paragraphs: [
          'Ce wizard pose une série de questions (contexte, charge, seuils SLA, auth, données, CI/CD…) pour générer la configuration k6 adaptée à votre projet.',
          'Enregistrez vos réponses en profils réutilisables : export/import JSON, duplication, application au projet (k6-init.conf.json + script smoke).',
          'L’historique des campagnes conserve date, profil, environnement et notes — exportable pour audit ou comparaison entre releases.',
          'Commencez par l’installation k6 si le binaire ou le dossier k6/ n’est pas encore en place.',
        ],
        closeButton: 'Compris — paramétrer la charge',
      },
    }
  },

  applyVarsToPopup(popup, vars = {}) {
    if (!popup || !vars || !Object.keys(vars).length) return popup
    const repl = (text) => String(text || '').replace(/\{(\w+)\}/g, (_, key) => (
      vars[key] !== undefined && vars[key] !== null ? String(vars[key]) : `{${key}}`
    ))
    return {
      ...popup,
      title: repl(popup.title),
      paragraphs: (popup.paragraphs || []).map(repl),
      confirmButton: repl(popup.confirmButton),
      closeButton: repl(popup.closeButton),
    }
  },

  normalizePopup(popup, fallback = {}) {
    const base = { ...fallback, ...(popup || {}) }
    const paragraphs = Array.isArray(base.paragraphs)
      ? base.paragraphs.map((p) => String(p).trim()).filter(Boolean)
      : (fallback.paragraphs || [])
    return {
      enabled: base.enabled !== false,
      template: base.template || 'disclaimer',
      showOn: base.showOn || 'pageLoad',
      pages: Array.isArray(base.pages) && base.pages.length ? base.pages : (fallback.pages || ['home']),
      order: Number.isFinite(Number(base.order)) ? Number(base.order) : (fallback.order ?? 99),
      id: base.id || fallback.id || 'disclaimer',
      title: base.title || fallback.title || 'Wizard QA Assistant',
      logo: base.logo || fallback.logo || '/assets/logo-qa.png',
      logoAlt: base.logoAlt || fallback.logoAlt || 'QA',
      paragraphs,
      closeButton: base.closeButton || fallback.closeButton || 'Fermer',
      confirmButton: String(base.confirmButton || fallback.confirmButton || '').trim(),
      neverShowButton: String(
        base.neverShowButton || fallback.neverShowButton || '',
      ).trim(),
    }
  },

  async loadConfig() {
    if (this._config) return this._config
    const builtin = this.builtinPopups()
    try {
      const r = await fetch(this.apiUrl('/api/wizard/ui-wording'))
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
      const popups = { ...builtin }
      for (const [key, fallback] of Object.entries(builtin)) {
        popups[key] = this.normalizePopup(data?.popups?.[key], fallback)
      }
      for (const [key, raw] of Object.entries(data?.popups || {})) {
        if (popups[key]) continue
        popups[key] = this.normalizePopup(raw, {
          id: key,
          template: 'disclaimer',
          showOn: raw?.showOn || 'manual',
          pages: raw?.pages || ['*'],
        })
      }
      this._config = {
        neverShowButton: data?.neverShowButton || 'Ne plus afficher le pop-up',
        popups,
      }
      this.maybeResetPreferencesForExtensionVersion(data?.lastExtensionVersion)
      this._preferences = data?.hiddenPopups && typeof data.hiddenPopups === 'object'
        ? data.hiddenPopups
        : this.loadPersistedPreferences()
      this.savePersistedPreferences(this._preferences)
      if (data?.lastExtensionVersion) {
        try {
          localStorage.setItem(this.EXTENSION_VERSION_KEY, String(data.lastExtensionVersion))
        } catch { /* ignore */ }
      }
      return this._config
    } catch {
      this._config = {
        neverShowButton: 'Ne plus afficher le pop-up',
        popups: Object.fromEntries(
          Object.entries(builtin).map(([k, v]) => [k, this.normalizePopup(v, v)]),
        ),
      }
      this.maybeResetPreferencesForExtensionVersion()
      this._preferences = this.loadPersistedPreferences()
      return this._config
    }
  },

  getPopup(popupId) {
    return this._config?.popups?.[popupId] || null
  },

  stateKey(popupId) {
    return `${popupId}:${this.getBootId()}`
  },

  wasDismissed(popupId) {
    if (this.wasPermanentlyHidden(popupId)) return true
    return Boolean(this._state[this.stateKey(popupId)]?.dismissed)
  },

  ensureModal() {
    let modal = document.getElementById('wizardDisclaimerModal')
    if (modal && !modal.querySelector('.hub-disclaimer-spinner')) {
      modal.remove()
      modal = null
    }
    if (modal && !modal.querySelector('#wizardDisclaimerConfirm')) {
      modal.remove()
      modal = null
    }
    if (modal && !modal.querySelector('#wizardDisclaimerNever')) {
      modal.remove()
      modal = null
    }
    if (modal && modal.parentElement !== document.body) {
      document.body.appendChild(modal)
    }
    if (modal) return modal

    modal = document.createElement('div')
    modal.id = 'wizardDisclaimerModal'
    modal.className = 'hub-disclaimer-modal'
    modal.setAttribute('role', 'dialog')
    modal.setAttribute('aria-modal', 'true')
    modal.setAttribute('aria-labelledby', 'wizardDisclaimerTitle')
    modal.hidden = true
    modal.innerHTML = `
      <div class="hub-disclaimer-backdrop" id="wizardDisclaimerBackdrop"></div>
      <div class="hub-disclaimer-panel card card-compact">
        <div class="hub-disclaimer-accent" aria-hidden="true"></div>
        <header class="hub-disclaimer-head">
          <div class="hub-disclaimer-spinner" role="img" aria-label="QA">
            <div class="hub-disclaimer-spinner-ring" aria-hidden="true"></div>
            <img class="hub-disclaimer-logo" src="" alt="QA" width="40" height="40" />
          </div>
          <h2 id="wizardDisclaimerTitle" class="hub-disclaimer-title"></h2>
        </header>
        <div class="hub-disclaimer-body"></div>
        <div class="hub-disclaimer-footer">
          <div class="hub-disclaimer-actions">
            <button type="button" class="btn-secondary btn-sm hub-disclaimer-dismiss-btn" id="wizardDisclaimerDismiss"></button>
            <button type="button" class="btn-primary btn-sm hub-disclaimer-confirm-btn" id="wizardDisclaimerConfirm" hidden></button>
          </div>
          <button type="button" class="hub-disclaimer-never-btn" id="wizardDisclaimerNever"></button>
        </div>
      </div>`
    document.body.appendChild(modal)
    this._modal = modal
    return modal
  },

  fillModal(modal, popup) {
    const titleEl = modal.querySelector('#wizardDisclaimerTitle')
    const bodyEl = modal.querySelector('.hub-disclaimer-body')
    const logoEl = modal.querySelector('.hub-disclaimer-logo')
    const spinnerEl = modal.querySelector('.hub-disclaimer-spinner')
    const dismissBtn = modal.querySelector('#wizardDisclaimerDismiss')
    const confirmBtn = modal.querySelector('#wizardDisclaimerConfirm')
    const neverBtn = modal.querySelector('#wizardDisclaimerNever')
    const confirmLabel = String(popup.confirmButton || '').trim()
    const hasConfirm = confirmLabel.length > 0

    if (titleEl) titleEl.textContent = popup.title || 'Wizard QA Assistant'
    if (logoEl) {
      logoEl.src = this.apiUrl(popup.logo || '/assets/logo-qa.png')
      logoEl.alt = popup.logoAlt || 'QA'
    }
    if (spinnerEl) spinnerEl.setAttribute('aria-label', popup.logoAlt || 'QA')
    if (bodyEl) {
      bodyEl.innerHTML = (popup.paragraphs || [])
        .map((p) => `<p>${this.escape(p)}</p>`)
        .join('')
    }
    if (dismissBtn) {
      dismissBtn.textContent = hasConfirm
        ? (popup.closeButton || 'Plus tard')
        : (popup.closeButton || 'Fermer')
      dismissBtn.classList.toggle('btn-secondary', hasConfirm)
      dismissBtn.classList.toggle('btn-primary', !hasConfirm)
      dismissBtn.hidden = false
    }
    if (confirmBtn) {
      if (hasConfirm) {
        confirmBtn.textContent = confirmLabel
        confirmBtn.hidden = false
        confirmBtn.style.display = ''
        confirmBtn.removeAttribute('aria-hidden')
        modal.querySelector('.hub-disclaimer-actions')?.classList.add('hub-disclaimer-actions--dual')
      } else {
        confirmBtn.textContent = ''
        confirmBtn.hidden = true
        confirmBtn.style.display = 'none'
        confirmBtn.setAttribute('aria-hidden', 'true')
        modal.querySelector('.hub-disclaimer-actions')?.classList.remove('hub-disclaimer-actions--dual')
      }
    }
    if (neverBtn) {
      neverBtn.textContent = this.getNeverShowLabel(popup)
      neverBtn.hidden = false
      neverBtn.style.display = ''
    }
  },

  openModal() {
    const modal = this.ensureModal()
    modal.hidden = false
    modal.removeAttribute('hidden')
    modal.style.display = 'flex'
    modal.setAttribute('aria-hidden', 'false')
    document.body.classList.add('hub-disclaimer-open')
    this._showing = true
    return modal
  },

  bindActionHandlers(modal, popup) {
    const dismissBtn = modal.querySelector('#wizardDisclaimerDismiss')
    const confirmBtn = modal.querySelector('#wizardDisclaimerConfirm')
    const neverBtn = modal.querySelector('#wizardDisclaimerNever')
    const onDismiss = () => this.finishClose('dismiss')
    const onConfirm = () => this.finishClose('confirm')
    const onNever = () => { void this.finishClose('never') }
    dismissBtn?.addEventListener('click', onDismiss, { once: true })
    neverBtn?.addEventListener('click', onNever, { once: true })
    const confirmLabel = String(popup.confirmButton || '').trim()
    if (confirmLabel) {
      confirmBtn?.addEventListener('click', onConfirm, { once: true })
    }
    const onKey = (ev) => {
      if (ev.key === 'Escape') {
        document.removeEventListener('keydown', onKey)
        onDismiss()
      }
    }
    document.addEventListener('keydown', onKey)
    requestAnimationFrame(() => (String(popup.confirmButton || '').trim() ? confirmBtn : dismissBtn)?.focus())
  },

  bindCloseHandlers(modal) {
    const popup = this.getPopup(this._currentPopupId) || {}
    this.bindActionHandlers(modal, popup)
  },

  async showConfirm(popupId, options = {}) {
    const { force = true } = options
    await this.loadConfig()
    if (!force && this.wasPermanentlyHidden(popupId)) return 'dismiss'
    const popup = this.getPopup(popupId)
    if (!popup || popup.template !== 'disclaimer' || !popup.enabled) return 'dismiss'
    if (!force && this.wasDismissed(popupId)) return 'dismiss'
    if (this._showing) return 'dismiss'

    const popupResolved = this.applyVarsToPopup(popup, options.vars)

    return new Promise((resolve) => {
      this._confirmResolver = resolve
      this._currentPopupId = popupId
      const modal = this.openModal()
      this.fillModal(modal, popupResolved)
      this.bindActionHandlers(modal, popupResolved)
    })
  },

  async showInfo(popupId, options = {}) {
    const { force = true, vars = {} } = options
    await this.loadConfig()
    if (this.wasPermanentlyHidden(popupId)) return false
    let popup = this.getPopup(popupId)
    if (!popup || popup.template !== 'disclaimer' || !popup.enabled) return false
    if (!force && this.wasDismissed(popupId)) return false
    if (this._showing) return false

    popup = this.applyVarsToPopup(popup, vars)
    this._currentPopupId = popupId
    const modal = this.openModal()
    this.fillModal(modal, popup)
    this.bindActionHandlers(modal, popup)
    await this.waitUntilClosed()
    return true
  },

  async finishClose(result = 'dismiss') {
    const modal = document.getElementById('wizardDisclaimerModal')
    if (!modal) return
    if (result === 'never' && this._currentPopupId) {
      await this.setPermanentlyHidden(this._currentPopupId)
    }
    modal.hidden = true
    modal.setAttribute('hidden', '')
    modal.setAttribute('aria-hidden', 'true')
    modal.style.display = 'none'
    document.body.classList.remove('hub-disclaimer-open')
    if (this._currentPopupId && result !== 'confirm') {
      const key = this.stateKey(this._currentPopupId)
      this._state[key] = { dismissed: true }
    }
    this._showing = false
    this._currentPopupId = null
    const confirmResult = result === 'confirm' ? 'confirm' : 'dismiss'
    if (this._confirmResolver) {
      this._confirmResolver(confirmResult)
      this._confirmResolver = null
    }
    if (this._closeWaiter) {
      this._closeWaiter()
      this._closeWaiter = null
    }
  },

  close() {
    this.finishClose('dismiss')
  },

  waitUntilClosed() {
    if (!this._showing) return Promise.resolve()
    return new Promise((resolve) => {
      this._closeWaiter = resolve
    })
  },

  async show(popupId, options = {}) {
    const { force = false } = options
    await this.loadConfig()
    if (this.wasPermanentlyHidden(popupId)) return false
    const popup = this.getPopup(popupId)
    if (!popup || popup.template !== 'disclaimer') return false
    if (!popup.enabled) return false
    if (!force && this.wasDismissed(popupId)) return false
    if (this._showing) return false

    this._currentPopupId = popupId
    const modal = this.openModal()
    this.fillModal(modal, popup)
    this.bindCloseHandlers(modal)
    return true
  },

  resetSessionDismissForPage(pageKey) {
    const introId = this.STACK_INTRO_BY_PAGE[pageKey]
    if (!introId) return
    delete this._state[this.stateKey(introId)]
  },

  listAutoPopupsForPage(pageKey) {
    const popups = this._config?.popups || {}
    return Object.entries(popups)
      .map(([id, popup]) => ({ id, popup: this.normalizePopup(popup, popup) }))
      .filter(({ popup }) => popup.template === 'disclaimer')
      .filter(({ popup }) => popup.enabled)
      .filter(({ popup }) => popup.showOn === 'pageLoad')
      .filter(({ popup }) => this.popupMatchesPage(popup, pageKey))
      .sort((a, b) => a.popup.order - b.popup.order)
  },

  async showAutoForPage(pageKey = this.getCurrentPageKey(), options = {}) {
    if (pageKey === 'unknown') return
    await this.loadConfig()
    this.resetSessionDismissForPage(pageKey)
    const list = this.listAutoPopupsForPage(pageKey)
    for (const { id } of list) {
      const shown = await this.show(id, options)
      if (shown) await this.waitUntilClosed()
    }
  },
}

/** Rétrocompatibilité accueil */
// eslint-disable-next-line no-var
var WizardLaunchDisclaimer = {
  show(force) {
    return WizardDisclaimer.show('launchDisclaimer', { force: Boolean(force) })
  },
  close() {
    WizardDisclaimer.close()
  },
}

function bootWizardDisclaimers() {
  if (document.body?.classList.contains('page-home') && window.HomeHub) return
  void WizardDisclaimer.showAutoForPage()
}

let disclaimerScheduleToken = 0
function scheduleWizardDisclaimers() {
  disclaimerScheduleToken += 1
  const token = disclaimerScheduleToken
  window.setTimeout(() => {
    if (token !== disclaimerScheduleToken) return
    bootWizardDisclaimers()
  }, 120)
}

if (!window.__wizardDisclaimerPageReadyHook) {
  window.__wizardDisclaimerPageReadyHook = true
  window.addEventListener('wizard:page-ready', scheduleWizardDisclaimers)
}

scheduleWizardDisclaimers()

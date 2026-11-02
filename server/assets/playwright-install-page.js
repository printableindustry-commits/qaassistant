(function () {
  let wizard
  let installConfig = {}

  function $(id) {
    return document.getElementById(id)
  }

  function postHost(message) {
    let api = window.__wizardVsCodeApi
    if (!api && typeof acquireVsCodeApi === 'function') {
      try {
        api = acquireVsCodeApi()
        window.__wizardVsCodeApi = api
      } catch { /* déjà acquis */ }
    }
    if (api) api.postMessage(message)
    return Boolean(api)
  }

  function showVscodeHint(text, ok) {
    const hint = $('playwrightVscodeHint')
    if (!hint) return
    hint.hidden = !text
    hint.textContent = text || ''
    hint.classList.toggle('status-ok', ok === true)
    hint.classList.toggle('status-ko', ok === false)
  }

  async function installVscodeExtension() {
    const extId = installConfig.vscodeExtensionId || 'ms-playwright.playwright'
    if (!Portail.isVsCodePanel?.()) {
      showVscodeHint(
        'Ouvrez cette page dans l’extension Wizard QA (VS Code) pour installer l’extension Playwright, ou installez « Playwright Test for VSCode » depuis le Marketplace.',
        false,
      )
      window.open(`https://marketplace.visualstudio.com/items?itemName=${encodeURIComponent(extId)}`, '_blank', 'noopener')
      return
    }
    const sent = postHost({ type: 'installVscodeExtension', extensionId: extId })
    if (sent) showVscodeHint('Installation de l’extension Playwright Test lancée dans VS Code…', true)
  }

  async function runVscodeInitCommand() {
    const cmd = installConfig.vscodeInstallCommand || 'ms-playwright.playwright.install'
    if (!Portail.isVsCodePanel?.()) {
      showVscodeHint(
        'Commande « Test: Install Playwright » disponible dans VS Code après installation de l’extension (Ctrl+Shift+P).',
        false,
      )
      return
    }
    const sent = postHost({ type: 'runVscodeCommand', command: cmd })
    if (sent) showVscodeHint('Commande « Test: Install Playwright » lancée — suivez l’assistant dans VS Code.', true)
  }

  function bindVscodeActions() {
    const extBtn = $('playwrightVscodeExtBtn')
    const initBtn = $('playwrightVscodeInitBtn')
    if (extBtn && !extBtn.dataset.bound) {
      extBtn.dataset.bound = '1'
      extBtn.addEventListener('click', () => { void installVscodeExtension() })
    }
    if (initBtn && !initBtn.dataset.bound) {
      initBtn.dataset.bound = '1'
      initBtn.addEventListener('click', () => { void runVscodeInitCommand() })
    }
  }

  async function loadPage() {
    try {
      installConfig = await NpmWizardShared.apiGet('/api/playwright/install-config')
    } catch {
      installConfig = {}
    }
    await wizard.refreshBadge()
  }

  function init() {
    wizard = StackInstallWizard.create({
      stackId: 'playwright',
      panelId: 'playwrightInstallPanel',
      launchBtnId: 'playwrightInstallBtn',
      statusId: 'status',
      badgeId: 'playwrightInstallBadge',
      logId: 'playwrightInstallLog',
      stepsListId: 'playwrightInstallSteps',
      logo: '/assets/logo-playwright.png',
      accentClass: 'stack-wizard--playwright',
      title: 'Installation Playwright',
      titleRunning: 'Installation Playwright en cours…',
      titleSuccess: 'Playwright installé',
      titleError: 'Installation Playwright interrompue',
      lead: '@playwright/test puis navigateurs Chromium, Firefox et WebKit',
      successMessage: 'Playwright est prêt — installez l’extension VS Code ci-dessous pour enregistrer et déboguer vos tests.',
      apiInstallPath: '/api/playwright/install',
      apiConfigPath: '/api/playwright/install-config',
      onSuccess: () => {
        const vscodeCard = $('playwrightVscodeCard')
        if (vscodeCard) {
          vscodeCard.classList.add('stack-wizard-vscode-reveal')
          vscodeCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        }
      },
    })

    wizard.bindLaunch()
    bindVscodeActions()
    Portail.init('playwrightInstall', null, loadPage, () => ({ page: 'playwrightInstall' }))
  }

  function boot() {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
    else init()
    if (!window.__playwrightInstallSoftNavHook) {
      window.__playwrightInstallSoftNavHook = true
      window.addEventListener('wizard:page-ready', (e) => {
        if (String(e.detail?.path || '') === '/playwright-install.html') init()
      })
    }
  }
  boot()
})()

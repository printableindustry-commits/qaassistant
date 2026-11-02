(function () {
  let wizard

  function init() {
    wizard = StackInstallWizard.create({
      stackId: 'cypress',
      panelId: 'cypressInstallPanel',
      launchBtnId: 'cypressInstallBtn',
      statusId: 'status',
      badgeId: 'cypressInstallBadge',
      logId: 'cypressInstallLog',
      stepsListId: 'cypressInstallSteps',
      logo: '/assets/logo-cypress.png',
      accentClass: 'stack-wizard--cypress',
      title: 'Installation Cypress',
      titleRunning: 'Installation Cypress en cours…',
      titleSuccess: 'Cypress installé',
      titleError: 'Installation Cypress interrompue',
      lead: '@cats-cdf/e2e puis cypress@14.0.3',
      successMessage: 'Cypress et @cats-cdf/e2e sont installés — consultez le wiki pour démarrer.',
      apiInstallPath: '/api/cypress/install',
      apiConfigPath: '/api/cypress/install-config',
    })

    wizard.bindLaunch()
    Portail.init('cypressInstall', null, () => wizard.refreshBadge(), () => ({ page: 'cypressInstall' }))
  }

  function boot() {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
    else init()
    if (!window.__cypressInstallSoftNavHook) {
      window.__cypressInstallSoftNavHook = true
      window.addEventListener('wizard:page-ready', (e) => {
        if (String(e.detail?.path || '') === '/cypress-install.html') init()
      })
    }
  }
  boot()
})()

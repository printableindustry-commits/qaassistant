(function () {
  let wizard

  function init() {
    wizard = StackInstallWizard.create({
      stackId: 'robot',
      panelId: 'robotInstallPanel',
      launchBtnId: 'robotInstallBtn',
      statusId: 'status',
      badgeId: 'robotInstallBadge',
      logId: 'robotInstallLog',
      stepsListId: 'robotInstallSteps',
      logo: '/assets/logo-robot.png',
      accentClass: 'stack-wizard--robot',
      prereqMode: 'python',
      runtimeCheckPath: '/api/robot/runtime/check',
      title: 'Installation Robot Framework',
      titleRunning: 'Installation Robot Framework en cours…',
      titleSuccess: 'Robot Framework installé',
      titleError: 'Installation Robot Framework interrompue',
      lead: 'robotframework, SeleniumLibrary, Requests et PyYAML via pip',
      verifyLabel: 'robot --version',
      successMessage: 'Robot Framework est prêt — consultez le wiki pour structurer votre dépôt de tests.',
      apiInstallPath: '/api/robot/install',
      apiConfigPath: '/api/robot/install-config',
    })

    wizard.bindLaunch()
    Portail.init('robotInstall', null, () => wizard.refreshBadge(), () => ({ page: 'robotInstall' }))
  }

  function boot() {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
    else init()
    if (!window.__robotInstallSoftNavHook) {
      window.__robotInstallSoftNavHook = true
      window.addEventListener('wizard:page-ready', (e) => {
        if (String(e.detail?.path || '') === '/robot-install.html') init()
      })
    }
  }
  boot()
})()

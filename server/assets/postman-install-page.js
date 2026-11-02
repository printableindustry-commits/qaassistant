(function () {
  let wizard

  function $(id) {
    return document.getElementById(id)
  }

  function showHint(text, ok) {
    const hint = $('postmanInitHint')
    if (!hint) return
    hint.hidden = !text
    hint.textContent = text || ''
    hint.classList.toggle('status-ok', ok === true)
    hint.classList.toggle('status-ko', ok === false)
  }

  async function loadInitForm() {
    try {
      const data = await NpmWizardShared.apiGet('/api/postman/init-config')
      if ($('postmanProjectName')) $('postmanProjectName').value = data.projectName || ''
      if ($('postmanBaseUrl')) $('postmanBaseUrl').value = data.baseUrl || ''
    } catch { /* valeurs par défaut */ }
  }

  async function saveInitForm() {
    const projectName = $('postmanProjectName')?.value?.trim()
    const baseUrl = $('postmanBaseUrl')?.value?.trim()
    try {
      await NpmWizardShared.apiPost('/api/postman/init-config', { projectName, baseUrl })
      showHint('Paramètres enregistrés — le scaffold utilisera ces valeurs.', true)
    } catch (err) {
      showHint(err.message || 'Enregistrement impossible', false)
    }
  }

  function bindForm() {
    const btn = $('postmanSaveInitBtn')
    if (btn && !btn.dataset.bound) {
      btn.dataset.bound = '1'
      btn.addEventListener('click', () => { void saveInitForm() })
    }
  }

  function init() {
    wizard = StackInstallWizard.create({
      stackId: 'postman',
      panelId: 'postmanInstallPanel',
      launchBtnId: 'postmanInstallBtn',
      statusId: 'status',
      badgeId: 'postmanInstallBadge',
      logId: 'postmanInstallLog',
      stepsListId: 'postmanInstallSteps',
      logo: '/assets/logo-postman.png',
      accentClass: 'stack-wizard--postman',
      verifyViaApi: true,
      title: 'Initialisation Postman',
      titleRunning: 'Initialisation Postman en cours…',
      titleSuccess: 'Postman & Newman prêts',
      titleError: 'Initialisation interrompue',
      lead: 'Scaffold postman/, installation Newman et rapport HTML',
      verifyLabel: 'npx newman --version',
      successMessage: 'Importez les fichiers postman/ dans Postman Desktop, complétez vos requêtes, puis lancez npm run test:api:smoke.',
      apiInstallPath: '/api/postman/install',
      apiConfigPath: '/api/postman/install-config',
      onBeforeRun: saveInitForm,
    })

    wizard.bindLaunch()
    bindForm()
    void loadInitForm()
    Portail.init('postmanInstall', null, () => wizard.refreshBadge(), () => ({ page: 'postmanInstall' }))
  }

  function boot() {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
    else init()
    if (!window.__postmanInstallSoftNavHook) {
      window.__postmanInstallSoftNavHook = true
      window.addEventListener('wizard:page-ready', (e) => {
        if (String(e.detail?.path || '') === '/postman-install.html') init()
      })
    }
  }
  boot()
})()

(function () {
  let wizard

  function $(id) {
    return document.getElementById(id)
  }

  function showHint(text, ok) {
    const hint = $('k6InitHint')
    if (!hint) return
    hint.hidden = !text
    hint.textContent = text || ''
    hint.classList.toggle('status-ok', ok === true)
    hint.classList.toggle('status-ko', ok === false)
  }

  async function loadInitForm() {
    try {
      const data = await NpmWizardShared.apiGet('/api/k6/init-config')
      if ($('k6ProjectName')) $('k6ProjectName').value = data.projectName || ''
      if ($('k6BaseUrl')) $('k6BaseUrl').value = data.baseUrl || ''
      if ($('k6DefaultVus')) $('k6DefaultVus').value = data.defaultVus ?? 5
      if ($('k6DefaultDuration')) $('k6DefaultDuration').value = data.defaultDuration || '30s'
    } catch { /* valeurs par défaut */ }
  }

  async function saveInitForm() {
    const projectName = $('k6ProjectName')?.value?.trim()
    const baseUrl = $('k6BaseUrl')?.value?.trim()
    const defaultVus = Number($('k6DefaultVus')?.value) || 5
    const defaultDuration = $('k6DefaultDuration')?.value?.trim() || '30s'
    try {
      await NpmWizardShared.apiPost('/api/k6/init-config', {
        projectName,
        baseUrl,
        defaultVus,
        defaultDuration,
      })
      showHint('Paramètres enregistrés — le scaffold utilisera ces valeurs.', true)
    } catch (err) {
      showHint(err.message || 'Enregistrement impossible', false)
    }
  }

  function bindForm() {
    const btn = $('k6SaveInitBtn')
    if (btn && !btn.dataset.bound) {
      btn.dataset.bound = '1'
      btn.addEventListener('click', () => { void saveInitForm() })
    }
  }

  async function checkInstalledBanner() {
    try {
      const runtime = await NpmWizardShared.apiGet('/api/k6/runtime/check')
      const banner = $('k6InstalledBanner')
      if (!banner) return
      if (runtime.installed || runtime.scaffoldReady) {
        banner.hidden = false
        banner.innerHTML = `
          <p class="hint hint-tight status-ok">k6 est déjà initialisé${runtime.k6Version ? ` (${runtime.k6Version})` : ''}.
            <a href="/k6-wizard.html" class="btn-primary btn-sm">→ Wizard performance & campagnes</a>
          </p>`
      } else {
        banner.hidden = true
      }
    } catch { /* ignore */ }
  }

  function init() {
    wizard = StackInstallWizard.create({
      stackId: 'k6',
      debugScope: 'k6-install',
      panelId: 'k6InstallPanel',
      launchBtnId: 'k6InstallBtn',
      statusId: 'status',
      badgeId: 'k6InstallBadge',
      logId: 'k6InstallLog',
      stepsListId: 'k6InstallSteps',
      logo: '/assets/logo-k6.png',
      accentClass: 'stack-wizard--k6',
      verifyViaApi: true,
      prereqMode: 'k6',
      title: 'Initialisation k6',
      titleRunning: 'Initialisation k6 en cours…',
      titleSuccess: 'k6 prêt',
      titleError: 'Initialisation interrompue',
      lead: 'Scaffold k6/, types @types/k6 et binaire Grafana k6',
      verifyLabel: 'k6 version',
      successMessage: 'Adaptez k6/scripts/smoke.js à votre application, puis lancez npm run test:perf:smoke.',
      apiInstallPath: '/api/k6/install',
      apiConfigPath: '/api/k6/install-config',
      onBeforeRun: saveInitForm,
      onSuccess: async () => {
        await new Promise((resolve) => setTimeout(resolve, 1500))
        const target = '/k6-wizard.html'
        if (window.Portail?.navigateTo) window.Portail.navigateTo(target)
        else window.location.href = NpmWizardShared.apiUrl(target)
      },
    })

    wizard.bindLaunch()
    bindForm()
    void loadInitForm()
    void checkInstalledBanner()
    Portail.init('k6Install', null, () => wizard.refreshBadge(), () => ({ page: 'k6Install' }))
  }

  function boot() {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
    else init()
    if (!window.__k6InstallSoftNavHook) {
      window.__k6InstallSoftNavHook = true
      window.addEventListener('wizard:page-ready', (e) => {
        if (String(e.detail?.path || '') === '/k6-install.html') init()
      })
    }
  }
  boot()
})()

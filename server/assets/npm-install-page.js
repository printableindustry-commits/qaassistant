(function () {
  const {
    apiGet,
    apiPost,
    loadingSpinnerHtml,
    sleep,
    renderInstallSteps,
    applyServerStepsToList,
    nodeRuntimeReady,
  } = NpmWizardShared
  const $ = (id) => document.getElementById(id)

  let pageState = { runtime: null, npmrcOk: false, entryPromptDone: false }

  function readNavParams() {
    const raw = window.__WIZARD_NAV_SEARCH__ != null
      ? window.__WIZARD_NAV_SEARCH__
      : (window.location.search || '')
    const q = String(raw).startsWith('?') ? String(raw).slice(1) : String(raw)
    return new URLSearchParams(q)
  }

  function stripNavParams(...keys) {
    const params = readNavParams()
    keys.forEach((k) => params.delete(k))
    const qs = params.toString()
    window.__WIZARD_NAV_SEARCH__ = qs ? `?${qs}` : ''
  }

  function setBadge(el, text, kind) {
    if (!el) return
    el.textContent = text
    el.className = `file-badge file-badge-${kind}`
  }

  async function refreshPrereqs() {
    const [runtime, npmrc] = await Promise.all([
      apiGet('/api/npm/runtime/check'),
      fetch(NpmWizardShared.apiUrl('/api/npmrc')).then((r) => r.json()).catch(() => ({})),
    ])
    pageState.runtime = runtime
    const npmrcOk = !!(npmrc.exists && npmrc.fields?.registry && npmrc.fields?.authToken)
    pageState.npmrcOk = npmrcOk

    const pkgOk = runtime.packageJsonExists
    const nodeOk = nodeRuntimeReady(runtime)

    const npmBadge = $('npmRuntimeBadge')
    if (runtime.npmPresent) {
      setBadge(npmBadge, `npm ${runtime.npmVersion}`, nodeOk && pkgOk && npmrcOk ? 'ok' : 'warn')
    } else {
      setBadge(npmBadge, 'npm non installé', 'missing')
    }

    const installBtn = $('npmInstallBtn')
    if (installBtn) {
      installBtn.disabled = !(npmrcOk && pkgOk && nodeOk)
    }

    const stacksOk = nodeOk && npmrcOk
    $('nextRepairLink')?.classList.toggle('is-locked', !stacksOk)
  }

  async function ensureNpmRuntime(runtime, logEl) {
    const target = runtime.targetNpmVersion
    if (runtime.npmPresent && runtime.npmNeedsUpdate && typeof WizardDisclaimer !== 'undefined') {
      const choice = await WizardDisclaimer.showConfirm('npmUpdatePrompt', {
        force: true,
        vars: { current: runtime.npmVersion, target },
      })
      if (choice === 'confirm') {
        if (logEl) logEl.textContent += `Volta — npm (bundle)…\n`
        return apiPost('/api/npm/runtime/volta-setup', { nodeVersion: runtime.targetNodeVersion })
      }
      return { ok: true, npmVersion: runtime.npmVersion }
    }
    if (!runtime.npmPresent) {
      if (logEl) logEl.textContent += `Installation npm via Volta…\n`
      return apiPost('/api/npm/runtime/volta-setup', { nodeVersion: runtime.targetNodeVersion })
    }
    return { ok: true, npmVersion: runtime.npmVersion }
  }

  async function runNpmInstallWizard() {
    const panel = $('npmInstallPanel')
    if (!panel) return

    panel.hidden = false
    let stepDefs = [
      { id: 'npm', label: 'Vérification npm' },
      { id: 'npmrc', label: 'Vérification du .npmrc utilisateur' },
      { id: 'config', label: 'Lecture de npm-install.conf.json' },
      { id: 'install', label: 'Exécution npm install' },
      { id: 'verify', label: 'Contrôle node_modules' },
    ]

    try {
      const installCfg = await apiGet('/api/npm/install-config')
      if (installCfg.steps?.length) {
        stepDefs = installCfg.steps.filter((s) => !['packageJson', 'node'].includes(s.id))
        if (!stepDefs.length) stepDefs = installCfg.steps
      }
    } catch {
      /* défaut */
    }

    panel.innerHTML = `
      <div class="npmrc-install-panel hub-onboarding-card hub-loading-panel">
        ${loadingSpinnerHtml()}
        <h2 class="hub-onboarding-title">Installation npm en cours…</h2>
        <p class="hub-onboarding-lead">Dépendances du projet — voir npm-install.conf.json</p>
        <ul class="hub-loading-steps" id="npmInstallSteps">${renderInstallSteps(stepDefs, 0)}</ul>
        <pre class="npmrc-install-log" id="npmInstallLog" aria-live="polite"></pre>
      </div>`

    const items = [...panel.querySelectorAll('#npmInstallSteps li')]
    const logEl = $('npmInstallLog')
    let active = 0
    const tick = (i) => {
      active = i
      items.forEach((li, idx) => {
        li.classList.toggle('is-done', idx < i)
        li.classList.toggle('is-active', idx === i)
        li.classList.remove('is-error')
      })
    }

    let finalNode = '—'
    let finalNpm = '—'

    try {
      tick(0)
      const runtime = await apiGet('/api/npm/runtime/check')
      const npmSetup = await ensureNpmRuntime(runtime, logEl)
      if (npmSetup?.nodeVersion) finalNode = npmSetup.nodeVersion
      if (npmSetup?.npmVersion) finalNpm = npmSetup.npmVersion

      const runtimeAfter = await apiGet('/api/npm/runtime/check')
      if (runtimeAfter.nodeVersion) finalNode = runtimeAfter.nodeVersion
      if (runtimeAfter.npmVersion) finalNpm = runtimeAfter.npmVersion

      tick(1)
      await sleep(200)
      tick(2)
      await sleep(200)

      tick(3)
      if (logEl) logEl.textContent += '\nLancement npm install…\n'

      const data = await apiPost('/api/npm/install')
      if (data.steps?.length) {
        applyServerStepsToList(items, data.steps)
      } else {
        tick(data.ok ? stepDefs.length : 3)
      }
      if (logEl) {
        const header = data.command ? `${data.command}\n${'—'.repeat(40)}\n` : ''
        logEl.textContent += `${header}${data.output || data.error || ''}`
      }

      const check = await apiGet('/api/npm/runtime/check')
      if (check.nodeVersion) finalNode = check.nodeVersion
      if (check.npmVersion) finalNpm = check.npmVersion

      Portail.showStatus(
        $('status'),
        data.ok,
        data.ok
          ? `Installation terminée — ${data.projectPath || '.'}`
          : 'Installation npm échouée — voir le journal ci-dessous',
      )
      $('status').style.display = 'block'

      if (data.ok && typeof WizardDisclaimer !== 'undefined') {
        await WizardDisclaimer.showInfo('npmInstallComplete', {
          force: true,
          vars: { nodeVersion: finalNode, npmVersion: finalNpm },
        })
      }
    } catch (err) {
      if (logEl) logEl.textContent += `\n${err.message}`
      items[active]?.classList.add('is-error')
      Portail.showStatus($('status'), false, err.message)
      $('status').style.display = 'block'
    }
  }

  async function showNpmInstallPrompt() {
    if (typeof WizardDisclaimer === 'undefined') return 'dismiss'
    return WizardDisclaimer.showConfirm('npmInstallPrompt', { force: true })
  }

  async function promptAndInstall() {
    const choice = await showNpmInstallPrompt()
    if (choice !== 'confirm') return
    if ($('npmInstallBtn')?.disabled) {
      Portail.showStatus($('status'), false, 'Prérequis manquants : .npmrc, Node.js et package.json')
      $('status').style.display = 'block'
      return
    }
    await runNpmInstallWizard()
  }

  async function waitForDisclaimerReady() {
    if (typeof WizardDisclaimer !== 'undefined') return
    await new Promise((resolve) => {
      let n = 0
      const tick = () => {
        if (typeof WizardDisclaimer !== 'undefined' || n > 40) {
          resolve()
          return
        }
        n += 1
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
  }

  async function loadPage() {
    await refreshPrereqs()
    const params = readNavParams()

    if (params.get('autostart') === '1') {
      stripNavParams('autostart')
      if (!$('npmInstallBtn')?.disabled) await runNpmInstallWizard()
      return
    }

    if (!pageState.entryPromptDone) {
      pageState.entryPromptDone = true
      await waitForDisclaimerReady()
      await new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      })
      await promptAndInstall()
    }
  }

  function init() {
    const btn = $('npmInstallBtn')
    if (btn && !btn.dataset.bound) {
      btn.dataset.bound = '1'
      btn.addEventListener('click', () => promptAndInstall())
    }
    Portail.init('npmInstall', null, loadPage, () => ({ page: 'npmInstall' }))
  }

  function boot() {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
    else init()
    if (!window.__npmInstallSoftNavHook) {
      window.__npmInstallSoftNavHook = true
      window.addEventListener('wizard:page-ready', (e) => {
        if (String(e.detail?.path || '') !== '/npm-install.html') return
        pageState.entryPromptDone = false
        if (e.detail?.search != null) window.__WIZARD_NAV_SEARCH__ = e.detail.search
        init()
      })
    }
  }
  boot()
})()

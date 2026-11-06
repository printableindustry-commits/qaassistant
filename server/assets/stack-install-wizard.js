/**
 * Assistant visuel d'installation stack (Cypress, Playwright) — loader, étapes, checks.
 */
// eslint-disable-next-line no-var
var StackInstallWizard = (function () {
  const {
    apiGet,
    apiPost,
    loadingSpinnerHtml,
    sleep,
    renderInstallSteps,
    nodeRuntimeReady,
    apiUrl,
  } = NpmWizardShared

  function spinnerForStack(logoPath) {
    const src = apiUrl(logoPath)
    return `<div class="hub-loading-spinner hub-loading-spinner--sm stack-wizard-spinner" role="status" aria-label="Installation en cours">
      <div class="hub-loading-spinner-ring stack-wizard-spinner-ring" aria-hidden="true"></div>
      <img class="hub-loading-spinner-logo" src="${src}" alt="" width="28" height="28" />
    </div>`
  }

  function progressPct(done, total) {
    if (!total) return 0
    return Math.round((done / total) * 100)
  }

  function create(config) {
    const $ = (id) => document.getElementById(id || config.panelId)

    let running = false

    function setBadge(text, kind) {
      const el = $(config.badgeId)
      if (!el) return
      el.textContent = text
      el.className = `file-badge file-badge-${kind}`
    }

    function setLaunchDisabled(disabled) {
      const btn = $(config.launchBtnId)
      if (btn) btn.toggleAttribute('disabled', disabled)
    }

    function updateProgress(panel, done, total) {
      const bar = panel?.querySelector('.stack-wizard-progress-fill')
      if (bar) bar.style.width = `${progressPct(done, total)}%`
    }

    function tick(items, index, panel, total) {
      items.forEach((li, idx) => {
        li.classList.toggle('is-done', idx < index)
        li.classList.toggle('is-active', idx === index)
        li.classList.remove('is-error')
      })
      updateProgress(panel, index, total)
    }

    function markDone(items, panel, total) {
      items.forEach((li) => {
        li.classList.remove('is-active', 'is-error')
        li.classList.add('is-done')
      })
      updateProgress(panel, total, total)
    }

    function markError(items, index, panel, total) {
      items.forEach((li, idx) => {
        li.classList.toggle('is-done', idx < index)
        li.classList.toggle('is-active', false)
        li.classList.toggle('is-error', idx === index)
      })
      updateProgress(panel, index, total)
    }

    function appendLog(logEl, text) {
      if (!logEl || !text) return
      logEl.textContent += text.endsWith('\n') ? text : `${text}\n`
      logEl.scrollTop = logEl.scrollHeight
    }

    const isPythonMode = config.prereqMode === 'python'
    const isK6Mode = config.prereqMode === 'k6'

    async function checkPrereqs() {
      if (isK6Mode) {
        // k6 est un binaire autonome : Node/.npmrc ne servent qu'aux types facultatifs.
        const runtime = await apiGet(config.runtimeCheckPath || '/api/k6/runtime/check').catch(() => ({}))
        return { runtime, k6Ok: !!runtime.k6Installed, ready: true }
      }
      if (isPythonMode) {
        const runtime = await apiGet(config.runtimeCheckPath || '/api/robot/runtime/check')
        const pythonOk = runtime.pythonPresent && runtime.pythonOk !== false
        const pipOk = runtime.pipPresent
        return {
          runtime,
          pythonOk,
          pipOk,
          ready: runtime.ready !== false && pythonOk && pipOk,
        }
      }
      const [runtime, npmrc] = await Promise.all([
        apiGet('/api/npm/runtime/check'),
        fetch(apiUrl('/api/npmrc')).then((r) => r.json()).catch(() => ({})),
      ])
      const npmrcOk = !!(npmrc.exists && npmrc.fields?.registry && npmrc.fields?.authToken)
      const pkgOk = runtime.packageJsonExists
      const nodeOk = nodeRuntimeReady(runtime)
      return { runtime, npmrcOk, pkgOk, nodeOk, ready: npmrcOk && pkgOk && nodeOk }
    }

    async function refreshBadge() {
      try {
        const p = await checkPrereqs()
        if (isK6Mode) {
          if (p.k6Ok) setBadge(`k6 ${p.runtime?.k6Version || 'OK'}`, 'ok')
          else setBadge('k6 à installer', 'warn')
        } else if (isPythonMode) {
          if (!p.pythonOk) setBadge('Python requis', 'missing')
          else if (!p.pipOk) setBadge('pip requis', 'warn')
          else setBadge(`Python ${p.runtime?.pythonVersion || 'OK'}`, 'ok')
        } else if (!p.nodeOk) setBadge('Node requis', 'missing')
        else if (!p.npmrcOk) setBadge('.npmrc requis', 'warn')
        else if (!p.pkgOk) setBadge('package.json absent', 'warn')
        else setBadge('Prêt', 'ok')
        if (!running) setLaunchDisabled(!p.ready)
        return p.ready
      } catch {
        setBadge('Erreur', 'missing')
        if (!running) setLaunchDisabled(true)
        return false
      }
    }

    function buildPanelHtml(stepDefs, leadText) {
      const accent = config.accentClass || ''
      const stepsId = config.stepsListId || `${config.stackId}InstallSteps`
      const logId = config.logId || `${config.stackId}InstallLog`
      return `
        <div class="npmrc-install-panel hub-onboarding-card hub-loading-panel stack-install-wizard ${accent}">
          <div class="stack-wizard-progress" aria-hidden="true"><div class="stack-wizard-progress-fill"></div></div>
          ${spinnerForStack(config.logo)}
          <h2 class="hub-onboarding-title stack-wizard-title">${config.titleRunning || config.title}</h2>
          <p class="hub-onboarding-lead stack-wizard-lead">${leadText || config.lead || ''}</p>
          <ul class="hub-loading-steps stack-wizard-steps" id="${stepsId}">${renderInstallSteps(stepDefs, 0)}</ul>
          <pre class="npmrc-install-log stack-wizard-log" id="${logId}" aria-live="polite"></pre>
        </div>`
    }

    async function runPrereqStep(logEl) {
      const p = await checkPrereqs()
      if (isK6Mode) {
        appendLog(logEl, p.k6Ok
          ? `k6 : déjà installé (${p.runtime?.k6Version || 'version inconnue'})`
          : 'k6 : absent — installation automatique (winget / choco)')
        return p
      }
      if (isPythonMode) {
        const lines = []
        lines.push(`Python : ${p.pythonOk ? 'OK' : 'absent ou version trop ancienne'}`)
        lines.push(`pip : ${p.pipOk ? 'OK' : 'absent'}`)
        if (p.runtime?.pythonVersion) lines.push(`Version : ${p.runtime.pythonVersion}`)
        appendLog(logEl, lines.join('\n'))
        if (!p.ready) throw new Error('Prérequis non satisfaits — installez Python 3.10+ avec pip')
        return p
      }
      const lines = []
      lines.push(`Node : ${p.nodeOk ? 'OK' : 'manquant ou version incorrecte'}`)
      lines.push(`.npmrc : ${p.npmrcOk ? 'OK' : 'absent ou incomplet'}`)
      lines.push(`package.json : ${p.pkgOk ? 'OK' : 'absent'}`)
      appendLog(logEl, lines.join('\n'))
      if (!p.ready) throw new Error('Prérequis non satisfaits — configurez Node, .npmrc et package.json')
      return p
    }

    async function runApiStep(stepDef, logEl) {
      appendLog(logEl, `\n▶ ${stepDef.label}\n`)
      const data = await apiPost(config.apiInstallPath, { step: stepDef.apiStep })
      if (data.command) appendLog(logEl, `${data.command}\n${'—'.repeat(40)}`)
      appendLog(logEl, data.output || data.error || '')
      if (data.verifyMessage) appendLog(logEl, `\n${data.verifyMessage}`)
      if (!data.ok) throw new Error(data.error || `${stepDef.label} — échec`)
      return data
    }

    async function runVerifyStep(logEl) {
      appendLog(logEl, '\n▶ Contrôle final\n')
      if (isPythonMode || config.verifyViaApi) {
        const data = await apiPost(config.apiInstallPath, { step: 'verify' })
        if (data.command) appendLog(logEl, `${data.command}\n${'—'.repeat(40)}`)
        appendLog(logEl, data.output || data.error || '')
        if (data.verifyMessage) appendLog(logEl, `\n${data.verifyMessage}`)
        if (!data.ok) throw new Error(data.error || 'Vérification échouée')
        return data
      }
      appendLog(logEl, 'node_modules présent — installation terminée.')
    }

    async function resolveInstallSteps() {
      if (config.apiConfigPath) {
        try {
          const cfg = await apiGet(config.apiConfigPath)
          config._lastServerConfig = cfg
          const steps = (cfg.steps || []).map((s) => ({
            id: s.id,
            label: s.label,
            apiStep: s.id,
          }))
          if (steps.length) return steps
        } catch { /* repli sur défaut embarqué */ }
      }
      return config.installSteps || []
    }

    async function runWizard() {
      if (running) return { ok: false, error: 'Installation déjà en cours', log: '' }
      const panel = $(config.panelId)
      if (!panel) return { ok: false, error: 'Panneau introuvable', log: '' }

      window.InstallAutofix?.clear()
      const ready = await refreshBadge()
      if (!ready) {
        const prereqMsg = isPythonMode
          ? 'Prérequis manquants — installez Python 3.10+ avec pip'
          : 'Prérequis manquants — voir Node, .npmrc et package.json'
        Portail.showStatus($(config.statusId), false, prereqMsg)
        $(config.statusId).style.display = 'block'
        return { ok: false, error: prereqMsg, log: '' }
      }

      const installSteps = await resolveInstallSteps()
      const serverCfg = config._lastServerConfig || {}
      const dynamicLead = serverCfg.description || config.lead
      const verifyLabel = (isPythonMode || config.verifyViaApi)
        ? (config.verifyLabel || serverCfg.verify?.label || 'Contrôle final')
        : 'Contrôle node_modules'

      running = true
      setLaunchDisabled(true)
      panel.hidden = false
      panel.classList.add('is-running')

      if (typeof config.onBeforeRun === 'function') {
        await config.onBeforeRun()
      }

      const stepDefs = [
        { id: 'prereq', label: 'Vérification des prérequis', kind: 'prereq' },
        ...installSteps,
        { id: 'verify', label: verifyLabel, kind: 'verify' },
      ]

      panel.innerHTML = buildPanelHtml(stepDefs, dynamicLead)
      const stepsId = config.stepsListId || `${config.stackId}InstallSteps`
      const logId = config.logId || `${config.stackId}InstallLog`
      const items = [...panel.querySelectorAll(`#${stepsId} li`)]
      const logEl = document.getElementById(logId)
      const wizardRoot = panel.querySelector('.stack-install-wizard')
      let active = 0
      let outcome = { ok: true }

      try {
        tick(items, 0, wizardRoot, stepDefs.length)
        await runPrereqStep(logEl)
        await sleep(350)
        active = 1
        tick(items, active, wizardRoot, stepDefs.length)

        const apiSteps = installSteps
        for (let i = 0; i < apiSteps.length; i += 1) {
          tick(items, active + i, wizardRoot, stepDefs.length)
          await runApiStep(apiSteps[i], logEl)
          await sleep(300)
        }

        active = stepDefs.length - 1
        tick(items, active, wizardRoot, stepDefs.length)
        await runVerifyStep(logEl)
        markDone(items, wizardRoot, stepDefs.length)

        const spinner = panel.querySelector('.stack-wizard-spinner')
        if (spinner) spinner.classList.add('is-complete')
        const titleEl = panel.querySelector('.stack-wizard-title')
        if (titleEl) titleEl.textContent = config.titleSuccess || 'Installation terminée'

        panel.classList.remove('is-running')
        panel.classList.add('is-success')

        Portail.showStatus($(config.statusId), true, config.successMessage || 'Installation terminée avec succès')
        $(config.statusId).style.display = 'block'

        if (typeof config.onSuccess === 'function' && !window.InstallAutofix?.isActive()) {
          await config.onSuccess()
        }
      } catch (err) {
        markError(items, active, wizardRoot, stepDefs.length)
        appendLog(logEl, `\n[ERR] ${err.message}`)
        panel.classList.remove('is-running')
        panel.classList.add('is-error')
        const titleEl = panel.querySelector('.stack-wizard-title')
        if (titleEl) titleEl.textContent = config.titleError || 'Installation interrompue'
        Portail.showStatus($(config.statusId), false, err.message)
        $(config.statusId).style.display = 'block'
        outcome = { ok: false, error: err.message, log: logEl?.textContent || '' }
        if (config.debugScope) {
          window.InstallAutofix?.offer({
            scope: config.debugScope,
            error: outcome.error,
            log: outcome.log,
            anchorId: config.statusId,
            rerun: runWizard,
          })
        }
      } finally {
        running = false
        await refreshBadge()
      }
      return outcome
    }

    function bindLaunch() {
      const btn = $(config.launchBtnId)
      if (!btn || btn.dataset.stackWizardBound) return
      btn.dataset.stackWizardBound = '1'
      btn.addEventListener('click', () => { void runWizard() })
    }

    return {
      run: runWizard,
      refreshBadge,
      bindLaunch,
    }
  }

  return { create }
})()

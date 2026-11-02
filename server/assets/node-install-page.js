(function () {
  const { apiGet, apiPost, escapeHtml, nodeRuntimeReady } = NpmWizardShared
  const $ = (id) => document.getElementById(id)

  let pageState = {
    runtime: null,
    packageJsonSaved: false,
    nodeReady: false,
  }

  function setBadge(el, text, kind) {
    if (!el) return
    el.textContent = text
    el.className = `file-badge file-badge-${kind}`
  }

  function updateNodeBadge() {
    const rt = pageState.runtime
    const badge = $('nodeRuntimeBadge')
    if (!rt) {
      setBadge(badge, '…', 'missing')
      return
    }
    if (pageState.nodeReady) {
      setBadge(badge, `Node ${rt.nodeVersion || rt.targetNodeVersion}`, 'ok')
    } else if (rt.nodePresent) {
      setBadge(badge, `Node ${rt.nodeVersion} — à configurer`, 'warn')
    } else {
      setBadge(badge, 'Node absent', 'missing')
    }
  }

  function updatePackageJsonBadge(exists) {
    setBadge(
      $('packageJsonBadge'),
      exists ? 'Présent' : 'Absent',
      exists ? 'ok' : 'missing',
    )
    pageState.packageJsonSaved = !!exists
  }

  function renderRuntimeStatus() {
    const el = $('nodeInstallStatus')
    const rt = pageState.runtime
    if (!el || !rt) return
    const inv = (rt.inventoryVersions || []).join(', ') || '—'
    const img = (rt.imageVersions || []).join(', ') || '—'
    el.innerHTML = `
      <p class="hint hint-tight">Volta : <code>${escapeHtml(rt.voltaHome || '')}</code></p>
      <p class="hint hint-tight">Inventaire : ${escapeHtml(inv)} · Image : ${escapeHtml(img)}</p>
      <p class="hint hint-tight">Cible configurée : Node <strong>${escapeHtml(rt.targetNodeVersion)}</strong> · npm <strong>${escapeHtml(rt.targetNpmVersion)}</strong></p>`
  }

  function updateNextStepLink() {
    const link = $('nextStepLink')
    if (!link) return
    const ready = pageState.nodeReady && pageState.packageJsonSaved
    link.classList.toggle('is-locked', !ready)
    if (ready) {
      link.removeAttribute('aria-disabled')
    } else {
      link.setAttribute('aria-disabled', 'true')
    }
  }

  async function loadNodeVersions() {
    const select = $('nodeVersionSelect')
    if (!select) return
    const rt = pageState.runtime
    const list = await apiGet('/api/npm/node-versions')
    const defaultVersion = rt?.targetNodeVersion || list.versions?.[0]?.version
    select.innerHTML = (list.versions || []).map((v) => {
      const sel = v.version === defaultVersion ? ' selected' : ''
      const lts = v.lts ? ' (LTS)' : ''
      return `<option value="${escapeHtml(v.version)}"${sel}>${escapeHtml(v.version)}${lts}</option>`
    }).join('')
  }

  async function refreshRuntime() {
    pageState.runtime = await apiGet('/api/npm/runtime/check')
    pageState.nodeReady = nodeRuntimeReady(pageState.runtime)
    updateNodeBadge()
    renderRuntimeStatus()
    updateNextStepLink()
    return pageState.runtime
  }

  async function loadPackageJson() {
    const pkg = await apiGet('/api/npm/package-json')
    const ta = $('packageJsonEditor')
    if (ta) ta.value = pkg.exists ? pkg.content : (pkg.template || '{}')
    updatePackageJsonBadge(pkg.exists)
    updateNextStepLink()
  }

  async function loadPage() {
    await refreshRuntime()
    await loadNodeVersions()
    await loadPackageJson()
  }

  async function downloadAndInstallNode() {
    const version = $('nodeVersionSelect')?.value
    const logEl = $('nodeInstallLog')
    const btn = $('nodeDownloadBtn')
    if (!version) return
    if (btn) btn.disabled = true
    if (logEl) {
      logEl.hidden = false
      logEl.textContent = `Téléchargement Node ${version}…\n`
    }
    try {
      const dl = await apiPost('/api/npm/runtime/install-node-inventory', { version })
      if (logEl) logEl.textContent += dl.output || ''
      if (logEl) logEl.textContent += '\nConfiguration Volta…\n'
      const setup = await apiPost('/api/npm/runtime/volta-setup', { nodeVersion: version })
      if (logEl) logEl.textContent += setup.output || ''

      if (
        pageState.runtime?.nodePresent
        && pageState.runtime?.nodeNeedsUpdate
        && typeof WizardDisclaimer !== 'undefined'
      ) {
        const choice = await WizardDisclaimer.showConfirm('nodeUpdatePrompt', {
          force: true,
          vars: {
            current: pageState.runtime.nodeVersion,
            target: pageState.runtime.targetNodeVersion,
          },
        })
        if (choice === 'confirm') {
          const upd = await apiPost('/api/npm/runtime/volta-setup', {
            nodeVersion: pageState.runtime.targetNodeVersion,
          })
          if (logEl) logEl.textContent += upd.output || ''
        }
      }

      await refreshRuntime()
      Portail.showStatus($('status'), true, `Node ${version} installé via Volta`)
      $('status').style.display = 'block'
    } catch (err) {
      if (logEl) logEl.textContent += `\n${err.message}`
      Portail.showStatus($('status'), false, err.message)
      $('status').style.display = 'block'
    } finally {
      if (btn) btn.disabled = false
    }
  }

  async function savePackageJson() {
    const ta = $('packageJsonEditor')
    const logEl = $('packageJsonLog')
    try {
      const data = await apiPost('/api/npm/package-json', { content: ta?.value || '' })
      updatePackageJsonBadge(true)
      updateNextStepLink()
      if (logEl) logEl.hidden = true
      Portail.showStatus($('status'), true, `Enregistré — ${data.relativePath || 'package.json'}`)
      $('status').style.display = 'block'
    } catch (err) {
      if (logEl) {
        logEl.hidden = false
        logEl.textContent = err.message
      }
      Portail.showStatus($('status'), false, err.message)
      $('status').style.display = 'block'
    }
  }

  function init() {
    $('nodeDownloadBtn')?.addEventListener('click', () => downloadAndInstallNode())
    $('nodeRefreshBtn')?.addEventListener('click', () => refreshRuntime())
    $('packageJsonSaveBtn')?.addEventListener('click', () => savePackageJson())

    Portail.init('nodeInstall', null, loadPage, () => ({ page: 'nodeInstall' }))
  }

  function boot() {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
    else init()
    if (!window.__nodeInstallSoftNavHook) {
      window.__nodeInstallSoftNavHook = true
      window.addEventListener('wizard:page-ready', (e) => {
        if (String(e.detail?.path || '') === '/node-install.html') init()
      })
    }
  }
  boot()
})()

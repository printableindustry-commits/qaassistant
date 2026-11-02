/**
 * Utilitaires partagés — pages Installation Node.js et Installer NPM.
 */
// eslint-disable-next-line no-var
var NpmWizardShared = (function () {
  function apiUrl(path) {
    const base = window.__WIZARD_API_BASE__ || ''
    return base ? `${base.replace(/\/$/, '')}${path}` : path
  }

  async function apiGet(path) {
    const r = await fetch(apiUrl(path))
    const data = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
    return data
  }

  async function apiPost(path, body) {
    const r = await fetch(apiUrl(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
    return data
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function loadingSpinnerHtml() {
    const src = apiUrl('/assets/logo-qa.png')
    return `<div class="hub-loading-spinner hub-loading-spinner--sm" role="status" aria-label="Chargement">
      <div class="hub-loading-spinner-ring" aria-hidden="true"></div>
      <img class="hub-loading-spinner-logo" src="${src}" alt="" width="28" height="28" />
    </div>`
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  function renderInstallSteps(steps, activeIndex) {
    return steps.map((step, idx) => {
      let cls = ''
      if (idx < activeIndex) cls = 'is-done'
      else if (idx === activeIndex) cls = 'is-active'
      return `<li class="${cls}">${step.label}</li>`
    }).join('')
  }

  function applyServerStepsToList(items, serverSteps) {
    serverSteps.forEach((s, idx) => {
      const li = items[idx]
      if (!li) return
      li.classList.remove('is-active', 'is-done', 'is-error')
      if (s.status === 'ok') li.classList.add('is-done')
      else if (s.status === 'error') li.classList.add('is-error')
      else li.classList.add('is-active')
      if (s.message) li.title = s.message
    })
  }

  function nodeRuntimeReady(runtime) {
    if (!runtime) return false
    const target = runtime.targetNodeVersion
    const hasInventory = (runtime.inventoryVersions || []).includes(target)
      || runtime.nodeInVoltaInventory
    const nodeOk = runtime.nodePresent
      && (runtime.nodeInVoltaImage || !runtime.nodeNeedsUpdate || hasInventory)
    return Boolean(nodeOk && (runtime.nodeInVoltaImage || hasInventory))
  }

  async function fetchPyramidInputs() {
    const [runtime, npmrc] = await Promise.all([
      apiGet('/api/npm/runtime/check').catch(() => ({})),
      fetch(apiUrl('/api/npmrc')).then((r) => r.json()).catch(() => ({})),
    ])
    const npmrcOk = !!(npmrc.exists && npmrc.fields?.registry && npmrc.fields?.authToken)
    return { runtime, npmrcOk }
  }

  return {
    apiUrl,
    apiGet,
    apiPost,
    escapeHtml,
    loadingSpinnerHtml,
    sleep,
    renderInstallSteps,
    applyServerStepsToList,
    nodeRuntimeReady,
    fetchPyramidInputs,
  }
})()

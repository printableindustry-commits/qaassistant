(function () {
  const PROXY_HOST = 'muz11-wbsswsg.ca-technologies.fr:8080'
  const JIRA_CATS_URL = 'https://jirasoftware-cats.atlassian.net'
  const STEP_IDS = [
    'welcome', 'jira', 'xray', 'hooksconf', 'terminal', 'plans', 'testingboard', 'proxy', 'install',
  ]
  const ENV_KEYS = [
    'HOOK_ENVIRONMENT', 'JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_TOKEN',
    'HTTPS_PROXY', 'XRAY_CLIENT_ID', 'XRAY_CLIENT_SECRET',
  ]
  const CONF_KEYS = [
    'project', 'label', 'exclude_dirs', 'jira_indexation_delay_sec', 'suite_link_type',
  ]
  const DEFAULT_KEYS = [...CONF_KEYS, 'terminal_mode']
  const VERBOSE_MODE_IDS = ['A', 'B', 'C']

  const state = {
    stepIndex: 0,
    env: Object.fromEntries(ENV_KEYS.map(k => [k, ''])),
    defaults: Object.fromEntries(DEFAULT_KEYS.map(k => [k, ''])),
    plans: [],
    suites: [],
    folderScan: [],
    configFiles: [],
    defaultTestingBoardUrl: '',
    terminalModes: [],
    installSummary: 'Chargement…',
    installInfo: null,
    readiness: null,
    lastDryRunLog: null,
    lastDryRunOutput: '',
    showWizard: false,
    newPlan: { planKey: '', planName: '', suiteKey: '' },
  }

  const $ = id => document.getElementById(id)

  function apiUrl(path) {
    const base = window.__WIZARD_API_BASE__ || ''
    return base ? `${base.replace(/\/$/, '')}${path}` : path
  }

  function vscodeApi() {
    return window.__wizardVsCodeApi || null
  }

  function openHookFile(relativePath) {
    const api = vscodeApi()
    if (api) {
      api.postMessage({ type: 'openFile', relativePath })
      return
    }
    fetch(apiUrl('/api/hook/open-file'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ relativePath }),
    }).catch(() => {})
  }

  function currentStepId() {
    return STEP_IDS[state.stepIndex] || 'welcome'
  }

  function stepTitle(id) {
    return {
      welcome: 'Bienvenue',
      jira: 'Connexion JIRA',
      xray: 'Credentials Xray',
      hooksconf: 'hooks.conf',
      terminal: 'terminal_mode',
      plans: 'Dossiers VS Code',
      testingboard: 'Testing Board',
      proxy: 'Proxy (optionnel)',
      install: 'Installation hook Git & dry-run',
    }[id] || id
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function isHttpUrl(v) {
    return /^https?:\/\//i.test(String(v || '').trim())
  }

  function buildCatsProxyUrl(matricule, password) {
    const m = String(matricule || '').trim().toUpperCase()
    const p = String(password || '')
    if (!m) throw new Error('Matricule requis')
    if (!p) throw new Error('Mot de passe requis')
    const user = encodeURIComponent(`ZGIE\\${m}`)
    const pass = encodeURIComponent(p)
    return `http://${user}:${pass}@${PROXY_HOST}`
  }

  function deriveRepositoryPath(tbUrl, folder) {
    const trimmed = String(tbUrl || '').trim()
    if (!trimmed) return folder ? `/${folder}` : ''
    try {
      const u = new URL(trimmed)
      const parts = u.pathname.split('/').filter(Boolean)
      const idx = parts.findIndex(p => /repository|test-repository|testing-board/i.test(p))
      if (idx >= 0 && parts[idx + 1]) return `/${parts.slice(idx + 1).join('/')}`
    } catch { /* ignore */ }
    return folder ? `/${folder}` : ''
  }

  function syncStateFromDom() {
    for (const k of ENV_KEYS) {
      const el = $(k)
      if (!el) continue
      if (k === 'HTTPS_PROXY' && el.dataset.secret !== undefined) {
        state.env[k] = el.type === 'password'
          ? (el.dataset.secret || el.value).trim()
          : el.value.trim()
      } else {
        state.env[k] = el.value?.trim() || ''
      }
    }
    for (const k of DEFAULT_KEYS) {
      const el = $(k)
      if (el) state.defaults[k] = el.value?.trim() || ''
    }
    const tb = $('defaultTestingBoardUrl')
    if (tb) state.defaultTestingBoardUrl = tb.value.trim()
    document.querySelectorAll('[data-plan-tb-adv]').forEach(el => {
      const idx = Number(el.dataset.planIndex)
      if (state.plans[idx]) state.plans[idx].testingBoardUrl = el.value.trim()
    })
    const pk = $('newPlanKey')
    const pn = $('newPlanName')
    const sk = $('newPlanSuite')
    if (pk) state.newPlan.planKey = pk.value.trim()
    if (pn) state.newPlan.planName = pn.value.trim()
    if (sk) state.newPlan.suiteKey = sk.value
  }

  function validateStep(stepId) {
    const missing = []
    let error = ''

    if (stepId === 'jira') {
      if (!state.env.JIRA_BASE_URL) missing.push('JIRA_BASE_URL')
      else if (!isHttpUrl(state.env.JIRA_BASE_URL)) {
        error = 'JIRA_BASE_URL doit commencer par http:// (ex. https://jirasoftware-cats.atlassian.net)'
      }
      if (!state.env.JIRA_EMAIL) missing.push('JIRA_EMAIL')
      if (!state.env.HOOK_ENVIRONMENT) missing.push('HOOK_ENVIRONMENT')
      if (!state.env.JIRA_TOKEN) missing.push('JIRA_TOKEN')
    } else if (stepId === 'xray') {
      if (!state.env.XRAY_CLIENT_ID) missing.push('XRAY_CLIENT_ID')
      if (!state.env.XRAY_CLIENT_SECRET) missing.push('XRAY_CLIENT_SECRET')
    } else if (stepId === 'hooksconf') {
      for (const k of CONF_KEYS) {
        if (!state.defaults[k]) missing.push(k)
      }
    } else if (stepId === 'terminal') {
      if (!state.defaults.terminal_mode) missing.push('terminal_mode')
    } else if (stepId === 'plans') {
      if (!state.plans.length) {
        error = 'Ajoutez au moins un dossier plan VS Code dans hooks.conf'
      }
    } else if (stepId === 'testingboard') {
      if (!state.defaultTestingBoardUrl) {
        missing.push('URL Testing Board')
      } else if (!isHttpUrl(state.defaultTestingBoardUrl)) {
        error = 'L\'URL Testing Board doit commencer par http://'
      }
    }

    return { missing, error }
  }

  function validateAll() {
    const missing = []
    let error = ''
    for (const id of ['jira', 'xray', 'hooksconf', 'terminal']) {
      const r = validateStep(id)
      missing.push(...r.missing)
      if (!error && r.error) error = r.error
    }
    return { missing, error }
  }

  function getSimpleData() {
    return { env: { ...state.env }, defaults: { ...state.defaults } }
  }

  function setSimpleData(simple) {
    if (!simple) return
    state.env = { ...state.env, ...(simple.env || {}) }
    state.defaults = { ...state.defaults, ...(simple.defaults || {}) }
  }

  function getTerminalMode(id) {
    const key = String(id || 'B').toUpperCase()
    return state.terminalModes.find(m => m.id === key)
      || state.terminalModes.find(m => m.id === 'B')
  }

  function renderTerminalPreview(modeId) {
    const mode = getTerminalMode(modeId)
    const idEl = $('terminalModePreviewId')
    const sumEl = $('terminalModePreviewSummary')
    const txtEl = $('terminalModePreviewText')
    if (!mode || !idEl) return
    idEl.textContent = mode.id
    if (sumEl) sumEl.textContent = `${mode.label} — ${mode.summary}`
    if (txtEl) txtEl.textContent = mode.example
  }

  function renderVerboseExamples() {
    const root = $('hookVerboseModes')
    if (!root || !state.terminalModes.length) return
    root.innerHTML = VERBOSE_MODE_IDS.map(id => {
      const m = getTerminalMode(id)
      if (!m) return ''
      return `<article class="hook-terminal-example" data-mode="${m.id}">
        <header><strong>Mode ${m.id}</strong> — ${escapeHtml(m.label)}</header>
        <p class="hint hint-tight">${escapeHtml(m.summary)}</p>
        <pre class="terminal-preview-console terminal-preview-console-sm">${escapeHtml(m.example)}</pre>
      </article>`
    }).join('')
  }

  function renderConfigFilesList() {
    if (!state.configFiles.length) {
      return '<p class="hint hint-tight">Chargement des fichiers de configuration…</p>'
    }
    return `<ul class="hook-config-files-list">
      ${state.configFiles.map(f => `
        <li class="hook-config-file-item">
          <div class="hook-config-file-head">
            <button type="button" class="hook-config-file-link" data-open-file="${escapeHtml(f.relativePath)}">${escapeHtml(f.label)}</button>
            ${f.exists ? '' : '<span class="hook-config-file-missing">absent</span>'}
          </div>
          <p class="hint hint-tight">${escapeHtml(f.description)}</p>
          <code class="hook-config-file-path">${escapeHtml(f.relativePath)}</code>
        </li>`).join('')}
    </ul>`
  }

  function renderFolderPicker({ title, hint, showOnlyHooked = false }) {
    const folders = showOnlyHooked
      ? state.folderScan.filter(f => f.inHook)
      : state.folderScan
    if (!folders.length) {
      return `<p class="hint hint-tight">${hint || 'Aucun dossier plan détecté — lancez un scan.'}</p>`
    }
    const rows = folders.map(f => `
      <div class="hook-folder-row ${f.inHook ? 'is-hooked' : 'is-available'}" data-folder="${escapeHtml(f.folder)}">
        <span class="hook-folder-name" title="${escapeHtml(f.folder)}">${escapeHtml(f.folder)}</span>
        <span class="hook-folder-actions">
          ${f.inHook
            ? `<button type="button" class="hook-folder-btn hook-folder-btn-ok" title="Actif dans hooks.conf" disabled>✓</button>
               <button type="button" class="hook-folder-btn hook-folder-btn-remove" data-folder-action="remove" data-folder="${escapeHtml(f.folder)}" title="Retirer du hooks.conf">×</button>`
            : `<button type="button" class="hook-folder-btn hook-folder-btn-add" data-folder-action="add" data-folder="${escapeHtml(f.folder)}" title="Ajouter au hooks.conf">☑</button>
               <button type="button" class="hook-folder-btn hook-folder-btn-muted" disabled>×</button>`}
        </span>
      </div>`).join('')
    return `
      ${title ? `<h3 class="hook-encart-title">${title}</h3>` : ''}
      <div class="hook-folder-picker">${rows}</div>
      <button type="button" class="btn-secondary btn-sm hook-rescan-btn" id="rescanFoldersBtn">Rescanner les dossiers VS Code</button>`
  }

  function bindSecretToggle(btnId, inputId) {
    const btn = $(btnId)
    const input = $(inputId)
    if (!btn || !input) return
    btn.onclick = () => {
      const show = input.type === 'password'
      if (show) {
        input.type = 'text'
        input.value = input.dataset.secret || input.value
      } else {
        input.dataset.secret = input.value
        input.type = 'password'
        input.value = input.dataset.secret
        state.env[inputId] = input.dataset.secret
      }
      btn.textContent = show ? '🙈' : '👁'
    }
  }

  function bindProxyPasswordToggle() {
    const btn = $('toggleProxyPassword')
    const input = $('proxyPassword')
    if (!btn || !input) return
    btn.onclick = () => {
      if (input.type === 'password') {
        input.dataset.plain = input.value
        input.type = 'text'
        input.readOnly = true
        input.value = encodeURIComponent(input.value)
        btn.textContent = '🙈'
      } else {
        input.type = 'password'
        input.readOnly = false
        input.value = input.dataset.plain || ''
        btn.textContent = '👁'
      }
    }
  }

  function applyProxyCredentials() {
    try {
      const input = $('proxyPassword')
      const plain = input?.type === 'text' && input.readOnly
        ? input.dataset.plain || ''
        : input?.value || ''
      const url = buildCatsProxyUrl($('proxyMatricule')?.value, plain)
      state.env.HTTPS_PROXY = url
      if ($('HTTPS_PROXY')) {
        $('HTTPS_PROXY').dataset.secret = url
        $('HTTPS_PROXY').type = 'password'
        $('HTTPS_PROXY').value = url
      }
      if (input) {
        input.type = 'password'
        input.readOnly = false
        input.value = ''
        delete input.dataset.plain
      }
      showStepStatus(true, 'HTTPS_PROXY renseigné (masqué)')
    } catch (err) {
      showStepStatus(false, err.message)
    }
  }

  function showStepStatus(ok, msg) {
    const el = $('hwStatus')
    if (!el) return
    Portail.showStatus(el, ok, msg)
    el.style.display = 'block'
  }

  function setBadge(el, ok, okText, koText) {
    if (!el) return
    el.textContent = ok ? okText : koText
    el.className = 'file-badge ' + (ok ? 'file-badge-ok' : 'file-badge-missing')
  }

  async function loadHookMeta() {
    try {
      const meta = await fetch(apiUrl('/api/hook/meta')).then(r => r.json())
      state.plans = (meta.plans || []).map(p => ({ ...p }))
      state.suites = meta.suites || []
    } catch {
      state.plans = []
      state.suites = []
    }
  }

  async function loadFolderScan() {
    try {
      const data = await fetch(apiUrl('/api/hook/scan-folders')).then(r => r.json())
      state.folderScan = data.folders || []
      state.plans = (data.plans || []).map(p => ({ ...p }))
      state.suites = data.suites || []
    } catch {
      state.folderScan = []
    }
  }

  async function loadConfigFiles() {
    try {
      const data = await fetch(apiUrl('/api/hook/config-files')).then(r => r.json())
      state.configFiles = data.files || []
    } catch {
      state.configFiles = []
    }
  }

  async function loadTerminalModes() {
    try {
      const data = await fetch(apiUrl('/api/hook/terminal-modes')).then(r => r.json())
      state.terminalModes = data.modes || []
    } catch {
      state.terminalModes = []
    }
  }

  async function togglePlanFolder(folder, action) {
    try {
      const body = { folder, action }
      if (action === 'add' && state.suites.length === 1) {
        body.suiteKey = state.suites[0].suite_key
      }
      const r = await fetch(apiUrl('/api/hook/plans/toggle'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const res = await r.json()
      if (!r.ok) throw new Error(res.error)
      Portail.showToast(action === 'add' ? `${folder} ajouté au hook` : `${folder} retiré du hook`, { type: 'ok' })
      await loadFolderScan()
      renderStep()
    } catch (err) {
      showStepStatus(false, err.message)
    }
  }

  async function refreshReadiness() {
    try {
      const readiness = await fetch(apiUrl('/api/hook/readiness')).then(r => r.json())
      const verify = await Portail.runVerify({ page: 'hook' })
      const hook = verify.checks?.find(c => c.name === 'Hook post-commit')
      const env = verify.checks?.find(c => c.name === 'Fichier .env')
      const conf = verify.checks?.find(c => c.name === 'hooks.conf')
      if (hook) setBadge($('badgeHook'), hook.ok, 'Hook OK', 'Hook KO')
      if (env) setBadge($('badgeEnv'), env.ok, '.env OK', '.env KO')
      if (conf) setBadge($('badgeConf'), conf.ok, 'conf OK', 'conf KO')
      setBadge($('badgeDryRun'), readiness.dryRunOk, 'dry-run OK', 'dry-run KO')
      $('readinessHint').innerHTML = Portail.formatHookGitMention(readiness.message || '')
      $('readinessHint').hidden = !readiness.message
      $('unlockBanner').hidden = !readiness.readyForJiraSync
      state.readiness = readiness
      if (readiness?.lastDryRunLogFile && !state.lastDryRunLog) {
        state.lastDryRunLog = { fileName: readiness.lastDryRunLogFile.split('/').pop() }
      }
      return readiness
    } catch (err) {
      $('readinessHint').innerHTML = Portail.formatHookGitMention(err.message || 'Erreur de vérification')
      $('readinessHint').hidden = false
      return null
    }
  }

  async function loadInstallStatus() {
    try {
      const config = await fetch(apiUrl('/api/hook/config')).then(r => r.json())
      const s = config.install || {}
      state.installInfo = s
      const hookDir = s.hookDirName || '0_Hook_Synchro_Ticket_Test_JIRA'
      if (!s.repoRoot) {
        state.installSummary = 'Pas de dépôt git détecté depuis le dossier hook.'
        return
      }
      if (s.valid) {
        state.installSummary = `Hook actif — ${relPathFromRepo(s.hookPath) || '.git/hooks/post-commit'}`
      } else if (s.installed) {
        state.installSummary = `Hook présent mais à réinstaller — ${relPathFromRepo(s.hookPath) || '.git/hooks/post-commit'}`
      } else {
        state.installSummary = `Hook non installé — sera créé dans .git/hooks/post-commit`
      }
    } catch {
      state.installInfo = null
      state.installSummary = 'Impossible de lire l\'état d\'installation.'
    }
  }

  function relPathFromRepo(absPath) {
    const root = state.installInfo?.repoRoot
    if (!absPath || !root) return ''
    const norm = (p) => String(p).replace(/\\/g, '/')
    const a = norm(absPath)
    const r = norm(root).replace(/\/$/, '')
    if (a.startsWith(`${r}/`)) return a.slice(r.length + 1)
    return a
  }

  function renderPostCommitInstallInfo() {
    const s = state.installInfo || {}
    const hookDir = s.hookDirName || '0_Hook_Synchro_Ticket_Test_JIRA'
    const repo = s.repoRoot || '(dépôt git non détecté)'
    const hookRel = '.git/hooks/post-commit'
    const hookAbs = s.hookPath || (s.repoRoot ? `${s.repoRoot.replace(/\\/g, '/')}/${hookRel}` : hookRel)
    const templateRel = `${hookDir}/install/post-commit.template`
    const runnerRel = `${hookDir}/install/post-commit-run.mjs`
    const logsRel = `${hookDir}/hook-debug.log`
    return `
      <details class="action-info hook-install-info">
        <summary aria-label="Aide — hook post-commit Git"><span class="action-info-icon">i</span></summary>
        <div class="action-info-body hook-install-info-body">
          <p><strong>À quoi ça sert ?</strong></p>
          <p>Après chaque <code>git commit</code>, Git lance automatiquement la synchronisation JIRA / Xray (même enchaînement que le <strong>dry-run</strong>, mais sur le vrai commit).</p>
          <p><strong>Fichier installé dans le dépôt</strong></p>
          <ul>
            <li><code>${escapeHtml(hookRel)}</code></li>
            <li class="hook-install-path-abs">${escapeHtml(hookAbs)}</li>
          </ul>
          <p><strong>Modèle copié depuis le dossier hook</strong></p>
          <ul>
            <li><code>${escapeHtml(templateRel)}</code></li>
          </ul>
          <p><strong>Script exécuté à chaque commit</strong></p>
          <ul>
            <li><code>${escapeHtml(runnerRel)}</code> → chaîne <code>hook-run.mjs</code> / sync JIRA / Xray</li>
          </ul>
          <p><strong>Fichiers utiles pour le diagnostic</strong></p>
          <ul>
            <li><code>${escapeHtml(logsRel)}</code> — journal du hook</li>
            <li><code>${escapeHtml(hookDir)}/hook-last-run.txt</code> — dernier résumé</li>
            <li><code>.wizard-qa/logs/</code> — logs dry-run Wizard</li>
          </ul>
          <p class="hint hint-tight">Réinstallez après un changement de poste, si le hook a été modifié à la main, ou si la vérification indique « à réinstaller ».</p>
          <p class="hint hint-tight">Dépôt détecté : <code>${escapeHtml(repo)}</code></p>
        </div>
      </details>`
  }

  function setConsoleHint(text, running, hintId = 'consoleHint') {
    const hint = $(hintId)
    if (!hint) return
    hint.textContent = text
    hint.className = 'console-hint' + (running ? ' console-hint-run' : '')
  }

  async function saveConfig() {
    syncStateFromDom()
    const { missing, error } = validateAll()
    if (error) {
      showStepStatus(false, error)
      return false
    }
    if (missing.length) {
      showStepStatus(false, `Champs requis : ${missing.join(', ')}`)
      return false
    }
    try {
      const data = getSimpleData()
      const r = await fetch(apiUrl('/api/hook/config'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      const res = await r.json()
      if (!r.ok) throw new Error(res.error)
      await Portail.savePageDefaults('hook', { simple: data })
      Portail.showToast('Configuration hook enregistrée', { type: 'ok' })
      showStepStatus(true, 'Enregistré — lancez le dry-run')
      await refreshReadiness()
      return true
    } catch (err) {
      showStepStatus(false, err.message)
      return false
    }
  }

  async function savePlanBoards() {
    syncStateFromDom()
    const { missing, error } = validateStep('testingboard')
    if (error) {
      showStepStatus(false, error)
      return false
    }
    if (missing.length) {
      showStepStatus(false, `Champs requis : ${missing.join(', ')}`)
      return false
    }
    const defaultUrl = state.defaultTestingBoardUrl
    const plansPayload = state.plans.map(p => ({
      plan_key: p.plan_key,
      folder: p.folder,
      testingBoardUrl: (p.testingBoardUrl || defaultUrl).trim(),
      repository_path: deriveRepositoryPath(p.testingBoardUrl || defaultUrl, p.folder),
    }))
    try {
      const r = await fetch(apiUrl('/api/hook/plans/board'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jiraBaseUrl: state.env.JIRA_BASE_URL, plans: plansPayload }),
      })
      const res = await r.json()
      if (!r.ok) throw new Error(res.error)
      Portail.showToast('Testing Board enregistré dans hooks.conf', { type: 'ok' })
      await loadHookMeta()
      await loadFolderScan()
      return true
    } catch (err) {
      showStepStatus(false, err.message)
      return false
    }
  }

  async function createPlanFolder() {
    syncStateFromDom()
    const { planKey, planName, suiteKey } = state.newPlan
    if (!planKey || !planName) {
      showStepStatus(false, 'Code JIRA du Plan de Tests et nom du dossier requis')
      return
    }
    try {
      const r = await fetch(apiUrl('/api/hook/create-plan-folder'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planKey, name: planName, suiteKey: suiteKey || undefined }),
      })
      const res = await r.json()
      if (!r.ok) throw new Error(res.error)
      Portail.showToast(`Dossier créé : ${res.folder}`, { type: 'ok' })
      state.newPlan = { planKey: '', planName: '', suiteKey: state.newPlan.suiteKey }
      await loadFolderScan()
      renderStep()
      showStepStatus(true, `Dossier ${res.folder} créé et ajouté à hooks.conf`)
    } catch (err) {
      showStepStatus(false, err.message)
    }
  }

  function renderField({ id, label, value, type = 'text', full, req, placeholder }) {
    const cls = full ? 'hub-field full' : 'hub-field'
    const reqMark = req ? ' <span class="req">*</span>' : ''
    const input = type === 'password'
      ? `<div class="input-group">
          <input id="${id}" type="password" autocomplete="off" spellcheck="false" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder || '')}" />
          <button type="button" class="btn-input-addon toggle-secret" id="toggle${id}" title="Afficher">👁</button>
        </div>`
      : `<input id="${id}" type="${type}" spellcheck="false" autocomplete="off" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder || '')}" />`
    return `<div class="${cls}"><label for="${id}">${label}${reqMark}</label>${input}</div>`
  }

  function renderAdvancedBoardRows() {
    const defaultUrl = state.defaultTestingBoardUrl
    return state.plans.map((p, i) => `
      <div class="hook-board-adv-row">
        <div class="hook-board-row-head">
          <strong>${escapeHtml(p.plan_key)}</strong>
          <code>${escapeHtml(p.folder)}</code>
        </div>
        <div class="hub-field full">
          <label for="planTbAdv-${i}">URL Testing Board spécifique</label>
          <input id="planTbAdv-${i}" type="url" data-plan-tb-adv data-plan-index="${i}"
            value="${escapeHtml(p.testingBoardUrl || '')}"
            placeholder="${escapeHtml(defaultUrl || 'https://…/testing-board')}" />
        </div>
      </div>`).join('')
  }

  function renderStepBody(stepId) {
    const e = state.env
    const d = state.defaults
    const np = state.newPlan

    if (stepId === 'welcome') {
      return `
        <p class="hub-onboarding-lead hook-welcome-title">Assistant de configuration Hook JIRA</p>
        <p class="hook-welcome-text">Cet assistant permet à vos tests développés dans VS Code, qui doivent être associés en <strong>Cucumber</strong> dans un Ticket Test JIRA/Xray, d'être automatiquement mis à jour en se basant sur votre environnement VS Code.</p>
        <hr class="hook-section-divider" />
        <h3 class="hook-welcome-sub">Connexion à JIRA</h3>
        <p class="hook-welcome-text">Pour initier la connexion à JIRA vous aurez besoin de <strong>votre Token JIRA Xray Cloud</strong>. Sans ce token et ses credentials, il ne sera pas possible de faire fonctionner le script.</p>`
    }
    if (stepId === 'jira') {
      const jiraUrl = e.JIRA_BASE_URL || JIRA_CATS_URL
      return `
        <p class="hub-onboarding-lead">Credentials JIRA écrits dans <code>.env</code>. Les valeurs de la prise de connaissance sont reprises automatiquement.</p>
        <div class="hub-form-grid hook-wizard-grid">
          <div class="hub-field full">
            <label for="JIRA_BASE_URL">JIRA_BASE_URL <span class="req">*</span></label>
            <p class="hook-field-annotation">Pour CA-TS, il n'est pas nécessaire de remplacer cette URL</p>
            <input id="JIRA_BASE_URL" type="url" spellcheck="false" autocomplete="off"
              value="${escapeHtml(jiraUrl)}" placeholder="${escapeHtml(JIRA_CATS_URL)}" />
          </div>
          ${renderField({ id: 'JIRA_EMAIL', label: 'JIRA_EMAIL', value: e.JIRA_EMAIL, type: 'email', req: true, placeholder: 'prenom.nom@ca-ts.fr' })}
          <div class="hub-field">
            <label for="HOOK_ENVIRONMENT">HOOK_ENVIRONMENT <span class="req">*</span></label>
            <select id="HOOK_ENVIRONMENT">
              <option value="prod" ${e.HOOK_ENVIRONMENT === 'prod' ? 'selected' : ''}>prod</option>
              <option value="recette" ${e.HOOK_ENVIRONMENT === 'recette' ? 'selected' : ''}>recette</option>
              <option value="dev" ${e.HOOK_ENVIRONMENT === 'dev' ? 'selected' : ''}>dev</option>
            </select>
          </div>
          ${renderField({ id: 'JIRA_TOKEN', label: 'JIRA_TOKEN', value: e.JIRA_TOKEN, type: 'password', full: true, req: true, placeholder: 'Token API JIRA' })}
        </div>
        <p class="hint hint-tight">L'URL JIRA doit commencer par <code>http://</code> ou <code>https://</code>.</p>`
    }
    if (stepId === 'xray') {
      return `
        <p class="hub-onboarding-lead">Credentials Xray Cloud (API) — identiques à ceux saisis lors de la prise de connaissance.</p>
        <div class="hub-form-grid hook-wizard-grid">
          ${renderField({ id: 'XRAY_CLIENT_ID', label: 'XRAY_CLIENT_ID', value: e.XRAY_CLIENT_ID, req: true })}
          ${renderField({ id: 'XRAY_CLIENT_SECRET', label: 'XRAY_CLIENT_SECRET', value: e.XRAY_CLIENT_SECRET, type: 'password', req: true })}
        </div>`
    }
    if (stepId === 'hooksconf') {
      return `
        <p class="hub-onboarding-lead">Section <code>[defaults]</code> de <code>hooks.conf</code>.</p>
        <div class="hub-form-grid hook-wizard-grid">
          ${renderField({ id: 'project', label: 'project', value: d.project, req: true, placeholder: 'P0326' })}
          ${renderField({ id: 'label', label: 'Etiquette du ticket', value: d.label, req: true, placeholder: 'CA-TS' })}
          ${renderField({ id: 'exclude_dirs', label: 'exclude_dirs', value: d.exclude_dirs, full: true, req: true, placeholder: 'dossiers exclus, séparés par virgule' })}
          ${renderField({ id: 'jira_indexation_delay_sec', label: 'jira_indexation_delay_sec', value: d.jira_indexation_delay_sec || '9', type: 'number', req: true })}
          ${renderField({ id: 'suite_link_type', label: 'suite_link_type', value: d.suite_link_type || 'Relates', req: true })}
        </div>
        <hr class="hook-section-divider" />
        <h3 class="hook-encart-title">Fichiers de configuration du hook</h3>
        ${renderConfigFilesList()}`
    }
    if (stepId === 'terminal') {
      const mode = d.terminal_mode || 'B'
      return `
        <p class="hub-onboarding-lead">Le Hook scanne les dossiers renseignés en paramètre de votre environnement VS Code.</p>
        <p class="hook-welcome-text">Avant de commit, exécutez&nbsp;:</p>
        <pre class="hook-git-cmd">git add .\ngit commit -m [votre message]</pre>
        <p class="hook-welcome-text">Le hook se déclenchera automatiquement. Sur cette page, choisissez un mode de feedback plus ou moins verbeux, retranscrit dans votre terminal.</p>
        <div class="hub-field full hook-terminal-select">
          <label for="terminal_mode">terminal_mode <span class="req">*</span></label>
          <select id="terminal_mode">
            ${['0', 'A', 'B', 'C', 'D', 'E'].map(v => {
              const m = getTerminalMode(v)
              const label = m ? `${v} — ${m.label}` : v
              return `<option value="${v}" ${mode === v ? 'selected' : ''}>${label}</option>`
            }).join('')}
          </select>
        </div>
        <section class="hook-terminal-panel" aria-live="polite">
          <h3 class="hook-terminal-panel-title">Aperçu — mode <span id="terminalModePreviewId">${escapeHtml(mode)}</span></h3>
          <p class="hint hint-tight" id="terminalModePreviewSummary"></p>
          <pre class="terminal-preview-console" id="terminalModePreviewText"></pre>
        </section>
        <h3 class="hook-terminal-examples-title">Modes d'affichage — exemples</h3>
        <div class="hook-terminal-examples" id="hookVerboseModes"></div>`
    }
    if (stepId === 'plans') {
      const suiteSelect = state.suites.length > 1
        ? `<div class="hub-field full">
            <label for="newPlanSuite">Suite parente</label>
            <select id="newPlanSuite">
              ${state.suites.map(s => `<option value="${escapeHtml(s.suite_key)}" ${np.suiteKey === s.suite_key ? 'selected' : ''}>${escapeHtml(s.suite_key)} — ${escapeHtml(s.name || '')}</option>`).join('')}
            </select>
          </div>`
        : ''
      return `
        <p class="hub-onboarding-lead">Dossiers locaux VS Code déclarés dans <code>hooks.conf</code> — source de vérité des fichiers <code>.feature</code> envoyés sur le Testing Board.</p>
        <p class="hook-welcome-text">Le Hook lit les dossiers de votre VS Code pour les créer via l'API JIRA Xray Cloud dans votre <strong>Testing Board</strong>. Il est <strong>IMPORTANT</strong> de savoir que si vous supprimez un fichier ou un dossier en local, le Hook répercute automatiquement la modification sur JIRA.</p>
        <p class="hook-welcome-text">Voici la liste des dossiers disponibles sur votre VS Code&nbsp;:</p>
        <div class="hook-encart">${renderFolderPicker({ title: 'Dossiers VS Code — hooks.conf', hint: 'Aucun dossier plan détecté.' })}</div>
        <hr class="hook-section-divider" />
        <div class="hook-plan-add">
          <h3 class="hook-plan-add-title">Créer un repository de Test</h3>
          <p class="hook-welcome-text">Par le biais de cette fonctionnalité, créez d'abord un <strong>Plan de Tests</strong> dans JIRA. Ensuite, renseignez ici le code JIRA de ce plan pour créer le dossier local VS Code associé.</p>
          <p class="hook-welcome-text">En déposant vos <strong>Tickets Tests</strong> dans ce dossier, le Hook synchronise VS Code et JIRA pour&nbsp;:</p>
          <ul class="hub-onboarding-list hook-wizard-list">
            <li>Créer les nouveaux tickets et les associer au Plan de Tests</li>
            <li>Mettre à jour le contenu Cucumber des tickets tests</li>
            <li>Supprimer sur JIRA les tickets anciennement présents en local — le VS Code local est la référence</li>
          </ul>
          <div class="hub-form-grid hook-wizard-grid">
            ${renderField({ id: 'newPlanKey', label: 'Code JIRA — Plan de Tests', value: np.planKey, req: true, placeholder: 'P0326-1234' })}
            ${renderField({ id: 'newPlanName', label: 'Nom du dossier local', value: np.planName, req: true, placeholder: '[CA-TS]_Mon_Plan_Test' })}
            ${suiteSelect}
          </div>
          <button type="button" class="btn-primary btn-sm hook-create-plan-btn" id="createPlanBtn">Créer un dossier local associé à votre Plan de Test</button>
        </div>`
    }
    if (stepId === 'testingboard') {
      return `
        <p class="hub-onboarding-lead">Afin d'organiser correctement l'ensemble de votre périmètre de tests, il est nécessaire d'associer les tickets à un <strong>Testing Board</strong> pour qu'ils soient rattachés au Projet JIRA de votre SQUAD.</p>
        <div class="hub-field full">
          <label for="defaultTestingBoardUrl">URL du Testing Board <span class="req">*</span></label>
          <input id="defaultTestingBoardUrl" type="url" value="${escapeHtml(state.defaultTestingBoardUrl)}"
            placeholder="https://…/jira/software/projects/…/testing-board" />
        </div>
        <hr class="hook-section-divider" />
        <div class="hook-encart hook-encart-sync">
          <h3 class="hook-encart-title">Dossiers VS Code synchronisés par le Hook</h3>
          ${renderFolderPicker({ showOnlyHooked: true, hint: 'Aucun dossier actif dans hooks.conf.' })}
        </div>
        <details class="hook-advanced-board">
          <summary>Configuration avancée — Testing Board différent par plan</summary>
          <p class="hint hint-tight">Associez une URL Testing Board spécifique à chaque dossier si vos Plans de Tests doivent pointer vers des boards distincts.</p>
          <div class="hook-board-adv-list">${renderAdvancedBoardRows()}</div>
        </details>`
    }
    if (stepId === 'proxy') {
      return `
        <p class="hub-onboarding-lead">Proxy entreprise — optionnel, pour les appels API JIRA/Xray.</p>
        <div class="npmrc-proxy-helper hook-proxy-helper">
          <div class="hub-form-grid hook-wizard-grid">
            ${renderField({ id: 'proxyMatricule', label: 'Matricule', value: '', placeholder: 'ET02935' })}
            <div class="hub-field">
              <label for="proxyPassword">Mot de passe ZGIE</label>
              <div class="input-group">
                <input id="proxyPassword" type="password" autocomplete="off" spellcheck="false" placeholder="Mot de passe ZGIE" />
                <button type="button" class="btn-input-addon" id="toggleProxyPassword" title="Voir encodage">👁</button>
              </div>
            </div>
          </div>
          <button type="button" class="btn-secondary btn-sm npmrc-apply-proxy-btn" id="applyProxyBtn">Appliquer proxy ZGIE</button>
        </div>
        <div class="hub-form-grid hook-wizard-grid" style="margin-top:10px">
          <div class="hub-field full">
            <label for="HTTPS_PROXY">HTTPS_PROXY</label>
            <div class="input-group">
              <input id="HTTPS_PROXY" type="password" spellcheck="false" autocomplete="off" value="${escapeHtml(e.HTTPS_PROXY)}" data-secret="${escapeHtml(e.HTTPS_PROXY)}" placeholder="http://ZGIE%5C…" />
              <button type="button" class="btn-input-addon toggle-secret" id="toggleHTTPS_PROXY" title="Afficher">👁</button>
            </div>
          </div>
        </div>`
    }
    return `
      <p class="hub-onboarding-lead hook-install-lead">
        Enregistrez <code>.env</code> et <code>hooks.conf</code>, puis activez la <strong>synchro automatique après chaque commit Git</strong>
        (hook <code>post-commit</code>).
      </p>
      <p class="hint hint-tight hook-install-hint" id="installStatus">${escapeHtml(state.installSummary)}</p>
      <div class="hook-install-actions hook-wizard-install-actions">
        <button type="button" class="btn-primary btn-sm" id="saveBtn">Enregistrer .env + hooks.conf</button>
        <div class="hook-install-postcommit">
          <button type="button" class="btn-secondary btn-sm" id="installBtn" title="Copie le script dans .git/hooks/post-commit du dépôt">
            Activer la synchro auto (post-commit)
          </button>
          ${renderPostCommitInstallInfo()}
        </div>
      </div>`
  }

  async function openWizardLogsFolder() {
    try {
      const r = await fetch(apiUrl('/api/wizard/open-folder'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: 'logs' }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error)
      Portail.showToast('Dossier des logs ouvert', { type: 'ok' })
    } catch (err) {
      Portail.showToast(err.message, { type: 'err' })
    }
  }

  function buildDryRunPromptOpts() {
    const log = $('exitDryRunConsole')?.textContent || state.lastDryRunOutput || ''
    return {
      title: 'Debug dry-run Hook Git — JIRA / Xray',
      context: 'Échec ou analyse du dry-run Hook Git (hook-run.mjs --force --dry-run). Le prompt agrège toute la configuration Wizard : .env, hooks.conf, plans VS Code, profil projet, project.variables.json et logs.',
      log,
      error: state.readiness?.dryRunOk ? '' : 'Dry-run non validé ou en échec',
      enrich: true,
      scope: 'hook-dry-run',
      agentModel: 'Claude Sonnet 4.6',
      environment: {
        'Page': 'Hook Git — Installation',
        'Log fichier': state.lastDryRunLog?.fileName || '—',
        'Chemin log': state.lastDryRunLog?.relativePath || '—',
        'Sync JIRA': state.readiness?.readyForJiraSync ? 'débloquée' : 'verrouillée',
        'Hook configuré': state.readiness?.configured ? 'oui' : 'non',
      },
      stepsToReproduce: [
        'Renseigner .env (JIRA_BASE_URL, JIRA_TOKEN, HOOK_ENVIRONMENT, XRAY_CLIENT_ID, XRAY_CLIENT_SECRET, proxy)',
        'Configurer hooks.conf [defaults] (project, label, exclude_dirs) et les plans (dossiers VS Code, Testing Board URL)',
        'Installer le hook post-commit',
        'Lancer Dry-run depuis le wizard Hook Git',
        'Consulter les logs dans .wizard-qa/logs',
      ],
      suggestedQuestions: [
        'Quelle est la cause racine de l\'échec du dry-run ?',
        'Quels fichiers modifier (.env, hooks.conf, plans) et avec quelles valeurs ?',
        'Le proxy ZGIE ou les credentials JIRA/Xray sont-ils en cause ?',
        'Les dossiers VS Code des plans existent-ils et correspondent-ils à hooks.conf ?',
        'Quelle commande relancer pour valider la correction ?',
      ],
    }
  }

  async function openCopilotDebugFromDryRun() {
    if (typeof CopilotDebugPrompt === 'undefined') {
      Portail.showToast('Module prompt DEBUG indisponible — rechargez la fenêtre Wizard', { type: 'err' })
      return
    }
    const btn = document.getElementById('copilotDebugBtn')
    if (btn) btn.disabled = true
    try {
      await CopilotDebugPrompt.fromLog(buildDryRunPromptOpts())
    } catch (err) {
      Portail.showToast(err.message, { type: 'err' })
    } finally {
      if (btn) btn.disabled = false
    }
  }

  async function runDryRun() {
    const consoleEl = $('exitDryRunConsole')
    const btn = $('exitDryRunBtn')
    if (consoleEl) consoleEl.textContent = 'Exécution…\n'
    setConsoleHint('En cours…', true, 'exitDryRunHint')
    if (btn) btn.disabled = true
    try {
      const r = await fetch(apiUrl('/api/hook/test'), { method: 'POST' })
      const data = await r.json()
      const output = data.output || data.error || ''
      setConsoleHint(data.ok ? 'OK' : 'Échec', false, 'exitDryRunHint')
      showStepStatus(data.ok, data.ok ? 'Dry-run OK — Sync JIRA débloquée' : 'Dry-run échoué')
      if (data.ok) Portail.showToast('Dry-run OK — Sync JIRA débloquée', { type: 'ok' })
      state.lastDryRunLog = data.log || null
      state.lastDryRunOutput = output
      await refreshReadiness()
      updateExitNav()
      if (consoleEl) consoleEl.textContent = output
      if (output) $('exitDryRunConsoleWrap')?.setAttribute('open', '')
    } catch (err) {
      setConsoleHint('Erreur', false, 'exitDryRunHint')
      showStepStatus(false, err.message)
    }
    if (btn) btn.disabled = false
  }

  function renderDryRunInfo() {
    const hookDir = state.installInfo?.hookDirName || '0_Hook_Synchro_Ticket_Test_JIRA'
    return `
      <details class="action-info hook-dryrun-info">
        <summary aria-label="Aide — dry-run Hook Git"><span class="action-info-icon">i</span></summary>
        <div class="action-info-body hook-dryrun-info-body">
          <p><strong>Qu'est-ce que le dry-run ?</strong></p>
          <p>Une <strong>simulation complète</strong> de la synchronisation JIRA / Xray : le hook exécute les mêmes scripts que lors d'un vrai commit, mais en mode <strong>sans écriture</strong> dans JIRA ni Xray Cloud.</p>
          <p><strong>À quoi ça sert ?</strong></p>
          <ul>
            <li>Vérifier <code>.env</code>, <code>hooks.conf</code>, les plans VS Code et le proxy <strong>avant</strong> d'impacter JIRA</li>
            <li>Détecter les erreurs (credentials, plan_key, dossiers absents, indexation JIRA…)</li>
            <li><strong>Débloquer Sync JIRA</strong> dans le Wizard une fois le dry-run OK</li>
            <li>Confirmer que le hook <code>post-commit</code> pourra tourner correctement après vos commits</li>
          </ul>
          <p><strong>Commande exécutée</strong></p>
          <ul>
            <li><code>node ${escapeHtml(hookDir)}/hook-run.mjs --force --dry-run</code></li>
          </ul>
          <p><strong>Différence avec le post-commit</strong></p>
          <p>Le <strong>dry-run</strong> ne modifie rien dans le cloud. Le <strong>post-commit</strong> (après <code>git commit</code>) lance la <em>vraie</em> synchro sur le commit courant.</p>
          <p><strong>Logs générés</strong></p>
          <ul>
            <li><code>.wizard-qa/logs/</code> — log Markdown détaillé du Wizard</li>
            <li><code>${escapeHtml(hookDir)}/hook-debug.log</code> — journal du hook</li>
          </ul>
          <p class="hint hint-tight">En cas d'échec : consultez la console ci-dessous, ouvrez le dossier des logs ou générez le prompt DEBUG.</p>
        </div>
      </details>`
  }

  function renderExitNav() {
    const syncReady = Boolean(state.readiness?.readyForJiraSync)
    const logFile = state.lastDryRunLog?.fileName
      || state.readiness?.lastDryRunLogFile?.split('/').pop()
      || null
    const lead = syncReady
      ? 'Dry-run validé — la configuration est prête : vous pouvez ouvrir Sync JIRA.'
      : 'Lancez le dry-run pour simuler la synchro (sans modifier JIRA) et débloquer Sync JIRA.'
    const syncBtn = syncReady
      ? `<a href="/project.html" class="btn-primary btn-sm hook-exit-nav-btn hook-exit-nav-btn--sync">Sync JIRA <span class="hook-exit-nav-arrow" aria-hidden="true">→</span></a>`
      : `<span class="btn-primary btn-sm hook-exit-nav-btn hook-exit-nav-btn--sync is-disabled" title="Dry-run requis — lancez le dry-run à gauche" aria-disabled="true">Sync JIRA <span class="hook-exit-nav-arrow" aria-hidden="true">→</span></span>`
    const logMeta = logFile
      ? `<span class="hook-exit-log-name" title="${escapeHtml(logFile)}">Dernier log : <code>${escapeHtml(logFile)}</code></span>`
      : ''
    return `
      <nav class="hook-wizard-exit-nav" aria-label="Navigation après Hook Git">
        <div class="hook-exit-intro-block">
          <p class="hook-dryrun-intro">
            Le <strong>dry-run</strong> rejoue toute la chaîne de synchro JIRA / Xray en mode <strong>simulation</strong>
            (aucune modification dans le cloud) — pour valider la config avant un commit ou Sync JIRA.
          </p>
          <p class="hook-wizard-exit-lead hook-exit-status-line${syncReady ? ' is-ok' : ''}">${lead}</p>
        </div>
        <div class="hook-wizard-exit-actions">
          <a href="/" class="btn-secondary btn-sm hook-exit-nav-btn hook-exit-nav-btn--home">
            <span class="hook-exit-nav-icon" aria-hidden="true">⌂</span> Retour à l'accueil
          </a>
        </div>
        <div class="hook-exit-sync-chain${syncReady ? ' is-unlocked' : ''}">
          <div class="hook-exit-dryrun-action">
            <button type="button" class="btn-secondary btn-sm hook-exit-nav-btn hook-exit-nav-btn--dry" id="exitDryRunBtn" title="Simuler la synchro JIRA/Xray sans écriture">
              Lancer le dry-run
            </button>
            ${renderDryRunInfo()}
          </div>
          <div class="hook-exit-sync-connector" aria-hidden="true">
            <span class="hook-exit-sync-line"></span>
            <span class="hook-exit-sync-arrow">→</span>
          </div>
          ${syncBtn}
        </div>
        <div class="hook-exit-secondary">
          <details class="console-wrap hook-console-wrap hook-exit-console" id="exitDryRunConsoleWrap" open>
            <summary class="hook-exit-console-summary">
              <span>Console dry-run</span>
              <span class="console-hint" id="exitDryRunHint">Prêt</span>
              ${logMeta}
            </summary>
            <pre class="console console-compact" id="exitDryRunConsole">Cliquez sur « Lancer le dry-run » pour simuler la synchro JIRA/Xray (aucune modification dans le cloud).</pre>
          </details>
        </div>
      </nav>`
  }

  function updateExitNav() {
    const nav = document.querySelector('.hook-wizard-exit-nav')
    if (!nav) return
    const parent = nav.parentElement
    const tmp = document.createElement('div')
    tmp.innerHTML = renderExitNav()
    const fresh = tmp.firstElementChild
    parent.replaceChild(fresh, nav)
    bindExitNav(fresh)
    Portail.applyEmbedLinks?.(fresh)
  }

  function bindExitNav(root = document.querySelector('.hook-wizard-exit-nav')) {
    root?.querySelector('#exitDryRunBtn')?.addEventListener('click', runDryRun)
  }

  function resolveHashStep() {
    const hash = location.hash.replace(/^#/, '')
    if (!hash) return false
    if (hash === 'wizard' || hash === 'restart') {
      state.showWizard = true
      state.stepIndex = 0
      return true
    }
    if (hash === 'dry-run') {
      state.showWizard = true
      state.stepIndex = STEP_IDS.indexOf('install')
      return true
    }
    const idx = STEP_IDS.indexOf(hash)
    if (idx >= 0) {
      state.showWizard = true
      state.stepIndex = idx
      return true
    }
    return false
  }

  function shouldShowGate() {
    if (state.showWizard) return false
    const hash = location.hash.replace(/^#/, '')
    if (
      hash === 'wizard' || hash === 'restart' || hash === 'dry-run'
      || STEP_IDS.includes(hash)
    ) return false
    return Boolean(state.readiness?.readyForJiraSync)
  }

  function renderGate() {
    const root = $('hookWizardSteps')
    const section = $('hookWizard')
    section?.classList.add('hook-wizard--gate')
    $('unlockBanner').hidden = true
    root.innerHTML = `
      <div class="hub-onboarding-card hook-wizard-card hook-gate-card">
        <div class="hook-gate-status">
          <span class="file-badge ok">Hook OK</span>
          <span class="file-badge ok">dry-run OK</span>
          <span class="file-badge ok">Sync JIRA</span>
        </div>
        <h2 class="hub-onboarding-title">Hook Git déjà configuré</h2>
        <p class="hub-onboarding-lead">La synchronisation JIRA est disponible. Choisissez la suite :</p>
        <div class="hook-gate-actions">
          <button type="button" class="btn-secondary hook-gate-btn" id="hookGateRestart">
            Écraser et recommencer la configuration du Hook Git
          </button>
          <a href="/project.html" class="btn-primary hook-gate-btn">Se rendre sur la section Sync JIRA</a>
          <a href="/" class="btn-secondary hook-gate-btn">Revenir à la page d'accueil</a>
        </div>
        <p class="hint hint-tight hook-gate-hint">La reconfiguration invalide le dry-run — un nouveau dry-run sera nécessaire pour débloquer à nouveau Sync JIRA.</p>
      </div>`
    $('hookGateRestart').onclick = async () => {
      const ok = window.confirm(
        'Recommencer la configuration du Hook Git ?\n\n'
        + '• Le dry-run sera invalidé\n'
        + '• Le wizard reprendra depuis le début\n'
        + '• Les fichiers .env et hooks.conf sur le disque ne sont pas supprimés',
      )
      if (!ok) return
      try {
        const r = await fetch(apiUrl('/api/hook/restart-wizard'), { method: 'POST' })
        const data = await r.json()
        if (!r.ok) throw new Error(data.error || 'Échec de la réinitialisation')
        state.showWizard = true
        state.stepIndex = 0
        section?.classList.remove('hook-wizard--gate')
        const config = await fetch(apiUrl('/api/hook/config')).then(r => r.json())
        setSimpleData({ env: config.env, defaults: config.defaults })
        await loadFolderScan()
        await refreshReadiness()
        renderStep()
        Portail.showToast('Wizard Hook Git — reconfiguration', { type: 'ok' })
      } catch (err) {
        Portail.showToast(err.message, { type: 'err' })
      }
    }
    Portail.applyEmbedLinks?.(root)
  }

  function bindFolderPicker() {
    document.querySelectorAll('[data-folder-action]').forEach(btn => {
      btn.onclick = () => togglePlanFolder(btn.dataset.folder, btn.dataset.folderAction)
    })
    $('rescanFoldersBtn')?.addEventListener('click', async () => {
      await loadFolderScan()
      renderStep()
      Portail.showToast('Scan terminé', { type: 'ok' })
    })
  }

  function bindConfigFileLinks() {
    document.querySelectorAll('[data-open-file]').forEach(btn => {
      btn.onclick = () => openHookFile(btn.dataset.openFile)
    })
  }

  function bindStepEvents(stepId) {
    if (stepId === 'jira') {
      bindSecretToggle('toggleJIRA_TOKEN', 'JIRA_TOKEN')
    } else if (stepId === 'xray') {
      bindSecretToggle('toggleXRAY_CLIENT_SECRET', 'XRAY_CLIENT_SECRET')
    } else if (stepId === 'hooksconf') {
      bindConfigFileLinks()
    } else if (stepId === 'terminal') {
      renderTerminalPreview($('terminal_mode')?.value || 'B')
      renderVerboseExamples()
      $('terminal_mode')?.addEventListener('change', () => {
        state.defaults.terminal_mode = $('terminal_mode').value
        renderTerminalPreview($('terminal_mode').value)
      })
      document.querySelectorAll('.hook-terminal-example').forEach(card => {
        card.addEventListener('click', () => {
          const mode = card.dataset.mode
          if ($('terminal_mode')) $('terminal_mode').value = mode
          state.defaults.terminal_mode = mode
          renderTerminalPreview(mode)
        })
      })
    } else if (stepId === 'plans') {
      bindFolderPicker()
      $('newPlanKey')?.addEventListener('input', () => { state.newPlan.planKey = $('newPlanKey').value.trim() })
      $('newPlanName')?.addEventListener('input', () => { state.newPlan.planName = $('newPlanName').value.trim() })
      $('newPlanSuite')?.addEventListener('change', () => { state.newPlan.suiteKey = $('newPlanSuite').value })
      $('createPlanBtn').onclick = createPlanFolder
    } else if (stepId === 'testingboard') {
      bindFolderPicker()
      $('defaultTestingBoardUrl')?.addEventListener('input', e => {
        state.defaultTestingBoardUrl = e.target.value.trim()
      })
    } else if (stepId === 'proxy') {
      bindSecretToggle('toggleHTTPS_PROXY', 'HTTPS_PROXY')
      bindProxyPasswordToggle()
      $('applyProxyBtn').onclick = applyProxyCredentials
    } else if (stepId === 'install') {
      $('saveBtn').onclick = saveConfig
      $('installBtn').onclick = async () => {
        try {
          const r = await fetch(apiUrl('/api/hook/install'), { method: 'POST' })
          const data = await r.json()
          showStepStatus(data.ok, data.message || data.error || '')
          if (data.ok) Portail.showToast('Hook post-commit activé dans le dépôt', { type: 'ok' })
          await loadInstallStatus()
          renderStep()
          await refreshReadiness()
        } catch (err) {
          showStepStatus(false, err.message)
        }
      }
    }
  }

  async function goNext(stepId) {
    syncStateFromDom()
    const { missing, error } = validateStep(stepId)
    if (error) {
      showStepStatus(false, error)
      return
    }
    if (missing.length) {
      showStepStatus(false, `Champs requis : ${missing.join(', ')}`)
      return
    }
    if (stepId === 'testingboard') {
      const ok = await savePlanBoards()
      if (!ok) return
    }
    state.stepIndex = Math.min(STEP_IDS.length - 1, state.stepIndex + 1)
    renderStep()
  }

  function renderStep() {
    const root = $('hookWizardSteps')
    $('hookWizard')?.classList.remove('hook-wizard--gate')
    const stepId = currentStepId()
    const dots = STEP_IDS.map((id, i) => {
      const cls = i < state.stepIndex ? 'is-done' : i === state.stepIndex ? 'is-active' : ''
      return `<span class="hub-step-dot ${cls}" title="${stepTitle(id)}"></span>`
    }).join('')

    const isLast = stepId === 'install'
    const isFirst = state.stepIndex === 0

    root.innerHTML = `
      <div class="hub-onboarding-card hook-wizard-card">
        <div class="hub-onboarding-steps">${dots}</div>
        <h2 class="hub-onboarding-title">${stepTitle(stepId)}</h2>
        ${renderStepBody(stepId)}
        <div class="hub-onboarding-actions">
          <button type="button" class="btn-secondary btn-sm" id="hwPrev" ${isFirst ? 'disabled' : ''}>Retour</button>
          ${isLast ? '<span></span>' : `<button type="button" class="btn-primary btn-sm" id="hwNext">Continuer</button>`}
        </div>
        <div id="hwStatus" class="status hook-step-status" style="display:none"></div>
      </div>
      ${isLast ? renderExitNav() : ''}`

    $('hwPrev').onclick = () => {
      syncStateFromDom()
      state.stepIndex = Math.max(0, state.stepIndex - 1)
      renderStep()
    }
    $('hwNext')?.addEventListener('click', () => goNext(stepId))
    bindStepEvents(stepId)
    if (isLast) {
      bindExitNav()
      requestAnimationFrame(() => {
        document.getElementById('hookExitPromptBlock')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      })
    }
    Portail.applyEmbedLinks?.(root)
  }

  async function init() {
    await Promise.all([loadTerminalModes(), loadConfigFiles()])
    try {
      const [config, wizard] = await Promise.all([
        fetch(apiUrl('/api/hook/config')).then(r => r.json()),
        Portail.fetchDefaults('hook').catch(() => ({ data: null })),
      ])
      const saved = wizard.data?.simple
      if (saved) setSimpleData(saved)
      else setSimpleData({ env: config.env, defaults: config.defaults })
      if (config.profileCredentials) {
        for (const k of ['JIRA_BASE_URL', 'XRAY_CLIENT_ID', 'XRAY_CLIENT_SECRET']) {
          const v = String(config.profileCredentials[k] || '').trim()
          if (v) state.env[k] = v
        }
      }
    } catch { /* vide */ }

    if (!state.env.JIRA_BASE_URL?.trim()) {
      state.env.JIRA_BASE_URL = JIRA_CATS_URL
    }

    await loadFolderScan()
    if (state.suites.length === 1) state.newPlan.suiteKey = state.suites[0].suite_key
    const urls = state.plans.map(p => p.testingBoardUrl).filter(Boolean)
    if (urls.length) {
      const allSame = urls.every(u => u === urls[0])
      if (allSame) state.defaultTestingBoardUrl = urls[0]
    }

    await loadInstallStatus()
    await refreshReadiness()
    resolveHashStep()
    if (shouldShowGate()) {
      renderGate()
    } else {
      renderStep()
    }
    Portail.applyEmbedLinks()
  }

  function boot() {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
    else init()
    if (!window.__hookGitSoftNavHook) {
      window.__hookGitSoftNavHook = true
      window.addEventListener('wizard:page-ready', (e) => {
        if (String(e.detail?.path || '') === '/hook-git.html') init()
      })
    }
  }

  boot()
})()

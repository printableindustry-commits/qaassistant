(function () {

  const PROXY_HOST = 'muz11-wbsswsg.ca-technologies.fr:8080'

  const $ = id => document.getElementById(id)



  let pageState = { fileExists: false, hasDiff: false }



  function apiUrl(path) {

    const base = window.__WIZARD_API_BASE__ || ''

    return base ? `${base.replace(/\/$/, '')}${path}` : path

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



  function getProxyPasswordPlain() {

    const input = $('proxyPassword')

    if (!input) return ''

    if (input.type === 'text' && input.readOnly) {

      return input.dataset.plain || ''

    }

    return input.value

  }



  function clearProxyPasswordField() {

    const input = $('proxyPassword')

    if (!input) return

    input.type = 'password'

    input.readOnly = false

    input.value = ''

    delete input.dataset.plain

    const btn = $('toggleProxyPassword')

    if (btn) {

      btn.textContent = '👁'

      btn.title = 'Voir l\'encodage URL'

    }

  }



  function setSecretField(inputId, toggleBtnId, value) {

    const input = $(inputId)

    if (!input) return

    const v = String(value || '')

    input.dataset.secret = v

    input.type = 'password'

    input.value = v

    const btn = toggleBtnId ? $(toggleBtnId) : null

    if (btn) {

      btn.textContent = '👁'

      btn.setAttribute('aria-pressed', 'false')

      btn.title = 'Afficher / masquer'

    }

  }



  function getSecretFieldValue(inputId) {

    const input = $(inputId)

    if (!input) return ''

    if (input.type === 'password') {

      return (input.dataset.secret || input.value).trim()

    }

    const v = input.value.trim()

    input.dataset.secret = v

    return v

  }



  function setHttpsProxyField(value) {

    setSecretField('httpsProxy', 'toggleHttpsProxy', value)

  }



  function getHttpsProxyValue() {

    return getSecretFieldValue('httpsProxy')

  }



  function setProxyField(value) {

    setSecretField('proxy', 'toggleProxy', value)

  }



  function getProxyValue() {

    return getSecretFieldValue('proxy')

  }



  function setFields(f) {

    if (!f) return

    $('email').value = f.email || ''

    $('alwaysAuth').value = f['always-auth'] ?? 'true'

    $('registry').value = f.registry || ''

    $('authToken').value = f.authToken || ''

    $('sassSite').value = f.SASS_BINARY_SITE || ''

    $('strictSsl').value = f['strict-ssl'] ?? 'false'

    setProxyField(f.proxy || '')

    setHttpsProxyField(f['https-proxy'] || '')

    $('noproxy').value = f.noproxy || ''

  }



  function getFields() {

    return {

      email: $('email').value.trim(),

      'always-auth': $('alwaysAuth').value.trim(),

      registry: $('registry').value.trim(),

      authToken: $('authToken').value,

      SASS_BINARY_SITE: $('sassSite').value.trim(),

      'strict-ssl': $('strictSsl').value.trim(),

      proxy: getProxyValue(),

      'https-proxy': getHttpsProxyValue(),

      noproxy: $('noproxy').value.trim(),

    }

  }



  function validateFields(fields) {

    const missing = []

    if (!fields.email) missing.push('email')

    if (!fields.registry) missing.push('registry')

    if (!fields.authToken) missing.push('_authToken')

    if (!fields['always-auth']) missing.push('always-auth')

    if (!fields['strict-ssl']) missing.push('strict-ssl')

    if (!fields.SASS_BINARY_SITE) missing.push('SASS_BINARY_SITE')

    return missing

  }



  function updateStatusBadge() {

    const badge = $('npmrcFileBadge')

    if (!badge) return

    if (!pageState.fileExists) {

      badge.textContent = 'Absent'

      badge.className = 'file-badge file-badge-missing'

    } else if (pageState.hasDiff) {

      badge.textContent = 'Écart wizard'

      badge.className = 'file-badge file-badge-warn'

    } else {

      badge.textContent = 'Présent'

      badge.className = 'file-badge file-badge-ok'

    }

    const archiveBtn = $('archiveNpmrcBtn')

    if (archiveBtn) archiveBtn.disabled = !pageState.fileExists

  }



  async function archiveNpmrcFile() {

    try {

      const r = await fetch(apiUrl('/api/npmrc/archive'), { method: 'POST' })

      const data = await r.json()

      if (!r.ok || !data.ok) throw new Error(data.error || 'Archivage impossible')

      pageState.fileExists = false

      pageState.hasDiff = false

      await refreshPageStatus()

      Portail.showToast(`Archivage du .npmrc — ${data.fileName}`, { type: 'ok' })

    } catch (err) {

      Portail.showToast(err.message, { type: 'err' })

    }

  }



  function bindSecretToggle(btnId, inputId, { onHide } = {}) {

    const btn = $(btnId)

    const input = $(inputId)

    if (!btn || !input) return

    btn.addEventListener('click', () => {

      const show = input.type === 'password'

      if (show) {

        const secret = input.dataset.secret || input.value

        input.type = 'text'

        input.value = secret

      } else {

        input.dataset.secret = input.value

        input.type = 'password'

        input.value = input.dataset.secret

        if (onHide) onHide(input)

      }

      btn.textContent = show ? '🙈' : '👁'

      btn.setAttribute('aria-pressed', show ? 'true' : 'false')

    })

  }



  function bindProxyPasswordToggle() {

    const btn = $('toggleProxyPassword')

    const input = $('proxyPassword')

    if (!btn || !input) return

    btn.addEventListener('click', () => {

      if (input.type === 'password') {

        input.dataset.plain = input.value

        input.type = 'text'

        input.readOnly = true

        input.value = encodeURIComponent(input.value)

        btn.textContent = '🙈'

        btn.title = 'Masquer l\'encodage'

      } else {

        input.type = 'password'

        input.readOnly = false

        input.value = input.dataset.plain || ''

        btn.textContent = '👁'

        btn.title = 'Voir l\'encodage URL'

      }

    })

  }



  function applyProxyCredentials() {

    try {

      const url = buildCatsProxyUrl($('proxyMatricule').value, getProxyPasswordPlain())

      setProxyField(url)

      setHttpsProxyField(url)

      clearProxyPasswordField()

      Portail.showStatus($('status'), true, 'proxy et https-proxy renseignés (masqués)')

      $('status').style.display = 'block'

    } catch (err) {

      Portail.showStatus($('status'), false, err.message)

      $('status').style.display = 'block'

    }

  }



  async function openProfileFolder() {

    try {

      const r = await fetch(apiUrl('/api/npmrc/open-profile'), { method: 'POST' })

      const data = await r.json()

      if (!r.ok || !data.ok) throw new Error(data.error || 'Impossible d\'ouvrir le dossier')

      Portail.showStatus($('status'), true, `Dossier ouvert — ${data.path}`)

      $('status').style.display = 'block'

    } catch (err) {

      Portail.showStatus($('status'), false, err.message)

      $('status').style.display = 'block'

    }

  }



  async function refreshPageStatus() {

    const [disk, diff] = await Promise.all([

      fetch(apiUrl('/api/npmrc')).then(r => r.json()).catch(() => ({ exists: false })),

      fetch(apiUrl('/api/npmrc/diff')).then(r => r.json()).catch(() => ({ hasDiff: false })),

    ])

    pageState.fileExists = !!disk.exists

    pageState.hasDiff = !!diff.hasDiff

    updateStatusBadge()



    const el = $('diffBanner')

    if (!el) return

    if (!diff.hasDiff) {

      el.hidden = true

      return

    }

    el.hidden = false

    el.className = 'diff-banner diff-banner-compact hub-diff-banner diff-warn'

    el.innerHTML = `<span><strong>Écart wizard ↔ disque</strong> — ${diff.diff.map(x => `<code>${x.key}</code>`).join(', ')}</span>`

  }



  async function loadPage() {

    const [template, disk, saved] = await Promise.all([

      fetch(apiUrl('/api/npmrc/template')).then(r => r.json()).catch(() => ({ fields: {} })),

      fetch(apiUrl('/api/npmrc')).then(r => r.json()).catch(() => ({})),

      Portail.fetchDefaults('npmrc').catch(() => ({ data: null })),

    ])



    const fields = saved.data

      || (disk.exists ? disk.fields : null)

      || template.fields

      || {}

    setFields(fields)



    pageState.fileExists = !!disk.exists

    await refreshPageStatus()

  }



  async function promptAfterGenerate() {

    if (typeof WizardDisclaimer === 'undefined') return



    const pkgChoice = await WizardDisclaimer.showConfirm('packageJsonPrompt', { force: true })



    if (pkgChoice === 'confirm') {

      const installChoice = await WizardDisclaimer.showConfirm('npmInstallPrompt', { force: true })

      if (installChoice === 'confirm') {

        window.Portail?.navigateTo?.('/npm-install.html?autostart=1') ??
          (window.location.href = apiUrl('/npm-install.html?autostart=1'))

      }

      return

    }



    if (pkgChoice === 'dismiss') {

      window.Portail?.navigateTo?.('/node-install.html') ??
        (window.location.href = apiUrl('/node-install.html'))

    }

  }



  async function generateNpmrc() {

    const fields = getFields()

    const missing = validateFields(fields)

    if (missing.length) {

      Portail.showStatus($('status'), false, `Champs requis : ${missing.join(', ')}`)

      $('status').style.display = 'block'

      return

    }



    const r = await fetch(apiUrl('/api/npmrc'), {

      method: 'POST',

      headers: { 'Content-Type': 'application/json' },

      body: JSON.stringify({ fields, exact: true }),

    })

    const data = await r.json()

    if (data.ok) {

      await Portail.savePageDefaults('npmrc', fields)

      pageState.fileExists = true

      await refreshPageStatus()

    }

    Portail.showStatus(

      $('status'),

      data.ok,

      data.ok ? `Fichier généré — ${data.path || '%USERPROFILE%\\.npmrc'}` : (data.error || 'Erreur'),

    )

    $('status').style.display = 'block'



    if (data.ok) {

      await promptAfterGenerate()

    }

  }



  function init() {

    bindSecretToggle('toggleToken', 'authToken')

    bindSecretToggle('toggleProxy', 'proxy')

    bindSecretToggle('toggleHttpsProxy', 'httpsProxy')

    bindProxyPasswordToggle()

    $('applyProxyBtn')?.addEventListener('click', applyProxyCredentials)

    $('generateBtn')?.addEventListener('click', () => generateNpmrc())

    $('openProfileBtn')?.addEventListener('click', () => openProfileFolder())

    $('archiveNpmrcBtn')?.addEventListener('click', () => archiveNpmrcFile())



    Portail.init('npmrc', getFields, loadPage, () => ({ page: 'npmrc', fields: getFields() }))

  }



  function boot() {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
    else init()
    if (!window.__npmrcSoftNavHook) {
      window.__npmrcSoftNavHook = true
      window.addEventListener('wizard:page-ready', (e) => {
        if (String(e.detail?.path || '') === '/npmrc.html') init()
      })
    }
  }
  boot()

})()



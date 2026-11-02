/**
 * Pont de navigation VS Code — évite webview.html = à chaque page
 * (acquireVsCodeApi ne peut être appelé qu'une fois par webview).
 */
;(function (global) {
  const PERSISTENT_SCRIPT = /(?:wizard-page-bridge|wizard-home-shell|portail)\.js/i

  function pathOnly(raw) {
    const s = String(raw || '/').split('?')[0] || '/'
    return s === '/index.html' ? '/' : s
  }

  function searchFromPath(raw) {
    const s = String(raw || '')
    const idx = s.indexOf('?')
    return idx >= 0 ? s.slice(idx) : ''
  }

  function acquireApiOnce() {
    if (global.__wizardVsCodeApi) return global.__wizardVsCodeApi
    if (typeof acquireVsCodeApi !== 'function') return null
    try {
      global.__wizardVsCodeApi = acquireVsCodeApi()
    } catch (_) {
      /* déjà acquis dans cette webview */
    }
    return global.__wizardVsCodeApi || null
  }

  function navigatePath(href) {
    const api = acquireApiOnce()
    if (!api) return false
    const base = global.__WIZARD_API_BASE__ || ''
    try {
      const root = base ? `${String(base).replace(/\/$/, '')}/` : global.location.href
      const u = new URL(href, root)
      api.postMessage({ type: 'navigate', path: u.pathname + u.search + u.hash })
    } catch {
      api.postMessage({ type: 'navigate', path: href })
    }
    return true
  }

  function isInternalHref(href) {
    if (!href || href.charAt(0) === '#') return false
    if (/^https?:\/\//i.test(href)) {
      if (href.indexOf('127.0.0.1') !== -1 || href.indexOf('localhost') !== -1) return true
      const base = String(global.__WIZARD_API_BASE__ || '').replace(/\/$/, '')
      if (base && href.startsWith(base)) return true
      return false
    }
    return href.startsWith('/') || !/^[a-z][a-z0-9+.-]*:/i.test(href)
  }

  /** Intercepte les clics internes (ex. tuile Documentation QA) — persiste dans le head. */
  function installNavGuard() {
    if (global.__wizardNavGuardInstalled) return
    global.__wizardNavGuardInstalled = true
    global.document.addEventListener(
      'click',
      (e) => {
        if (!global.__WIZARD_API_BASE__ && !global.document.documentElement.classList.contains('vscode-app')) {
          return
        }
        const a = e.target.closest('a[href]')
        if (!a || a.hasAttribute('download')) return
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
        const href = a.getAttribute('href') || ''
        if (!isInternalHref(href)) return
        e.preventDefault()
        e.stopPropagation()
        navigatePath(href)
      },
      true,
    )
  }

  function applyShellClasses(doc) {
    const html = global.document.documentElement
    const body = global.document.body
    if (!html || !body || !doc?.body) return

    const pageClasses = [...doc.body.classList].filter((c) => c.startsWith('page-'))
    const shellClasses = [...html.classList].filter(
      (c) => c === 'embed-mode' || c === 'vscode-app' || !c.startsWith('page-'),
    )
    html.className = [...new Set([...shellClasses, ...pageClasses])].join(' ')
    body.className = doc.body.className
    html.classList.add('embed-mode', 'vscode-app')
    if (doc.documentElement.lang) html.lang = doc.documentElement.lang
  }

  function enforceShellForPath(path) {
    if (global.WizardHomeShell?.enforceForPath) {
      return global.WizardHomeShell.enforceForPath(path)
    }
    const p = pathOnly(path)
    const html = global.document.documentElement
    if (p === '/' || p === '/index.html') {
      html.classList.forEach((c) => {
        if (c.startsWith('page-') && c !== 'page-home') html.classList.remove(c)
      })
      html.classList.add('page-home')
    }
    html.classList.add('embed-mode', 'vscode-app')
    return true
  }

  function runScriptEl(old) {
    const s = global.document.createElement('script')
    if (old.type) s.type = old.type
    if (old.src) {
      if (PERSISTENT_SCRIPT.test(old.src)) {
        old.remove()
        return
      }
      try {
        const url = new URL(old.getAttribute('src'), global.location.href)
        url.searchParams.set('_soft', String(Date.now()))
        s.src = url.toString()
      } catch {
        s.src = old.getAttribute('src')
      }
    } else {
      s.textContent = old.textContent
    }
    old.parentNode.replaceChild(s, old)
  }

  function runBodyScripts() {
    ;[...global.document.body.querySelectorAll('script')].forEach(runScriptEl)
  }

  function afterPageSwap(path) {
    enforceShellForPath(path)
    if (global.Portail?.syncHtmlPageClass) global.Portail.syncHtmlPageClass()
    global.document.documentElement.classList.add('embed-mode', 'vscode-app')
    if (global.WizardFooter?.sync) void global.WizardFooter.sync()
    if (global.Portail?.applyEmbedLinks) global.Portail.applyEmbedLinks()
    const search = searchFromPath(path)
    if (search) global.__WIZARD_NAV_SEARCH__ = search
    global.dispatchEvent(
      new CustomEvent('wizard:page-ready', {
        detail: { path: pathOnly(path), search: search || global.__WIZARD_NAV_SEARCH__ || '' },
      }),
    )
  }

  function replacePage(html, path) {
    const navSearch = searchFromPath(path)
    if (navSearch) global.__WIZARD_NAV_SEARCH__ = navSearch
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html')
    if (!doc.body) return false

    if (doc.title) global.document.title = doc.title

    const body = global.document.body
    while (body.firstChild) body.removeChild(body.firstChild)
    ;[...doc.body.childNodes].forEach((node) => {
      body.appendChild(global.document.importNode(node, true))
    })

    applyShellClasses(doc)
    runBodyScripts()
    afterPageSwap(path)
    return true
  }

  function installMessageListener() {
    if (global.__wizardBridgeListening) return
    global.__wizardBridgeListening = true
    global.addEventListener('message', (event) => {
      const msg = event.data
      if (!msg || msg.type !== 'replacePage' || !msg.html) return
      replacePage(msg.html, msg.pathOnly || msg.path || '/')
    })
  }

  function boot() {
    acquireApiOnce()
    installMessageListener()
    installNavGuard()
    global.document.documentElement.classList.add('embed-mode', 'vscode-app')
    if (global.document.body && global.Portail?.syncHtmlPageClass) {
      global.Portail.syncHtmlPageClass()
    }
  }

  global.WizardPageBridge = {
    boot,
    replacePage,
    pathOnly,
  }

  boot()
})(typeof window !== 'undefined' ? window : globalThis)

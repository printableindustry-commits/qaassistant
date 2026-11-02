/**
 * Shell Accueil — configuration unique (pleine largeur extension VS Code).
 * Tout bouton / lien « Accueil » doit cibler href="/" (classe btn-hub-home recommandée).
 * Appeler WizardHomeShell.ensure() après chaque arrivée sur l'accueil.
 */
;(function (global) {
  const HOME_PAGE_CLASS = 'page-home'
  const SHELL_CLASSES = ['embed-mode', 'vscode-app']

  function pathOnly(raw) {
    const s = String(raw || '/').split('?')[0] || '/'
    return s === '/index.html' ? '/' : s
  }

  function isHomePath(path) {
    const p = pathOnly(path)
    return p === '/' || p === '/index.html'
  }

  function isVsCodeWebview() {
    return (
      typeof acquireVsCodeApi === 'function'
      || Boolean(global.__wizardVsCodeApi)
      || Boolean(global.__WIZARD_API_BASE__)
      || global.document?.documentElement?.classList?.contains('vscode-app')
      || global.document?.documentElement?.classList?.contains('embed-mode')
    )
  }

  /**
   * Réapplique page-home + vscode-app et retire les classes compact des autres pages.
   * Source de vérité pour la mise en page accueil (voir css_theme_app.css section Accueil).
   */
  function ensure() {
    const html = global.document?.documentElement
    const body = global.document?.body
    if (!html || !body) return false

    html.classList.forEach((c) => {
      if (c.startsWith('page-') && c !== HOME_PAGE_CLASS) html.classList.remove(c)
    })
    body.classList.forEach((c) => {
      if (c.startsWith('page-') && c !== HOME_PAGE_CLASS) body.classList.remove(c)
    })

    html.classList.add(HOME_PAGE_CLASS)
    body.classList.add(HOME_PAGE_CLASS)

    if (isVsCodeWebview()) {
      for (const sc of SHELL_CLASSES) html.classList.add(sc)
    }

    if (global.Portail?.syncHtmlPageClass) {
      global.Portail.syncHtmlPageClass()
    }

    return true
  }

  /** Avant navigation vers / — prépare le shell si déjà sur une page compacte. */
  function prepareNavigation(path) {
    if (!isHomePath(path)) return false
    return ensure()
  }

  function enforceForPath(path) {
    if (!isHomePath(path)) return false
    return ensure()
  }

  global.WizardHomeShell = {
    HOME_PAGE_CLASS,
    SHELL_CLASSES,
    pathOnly,
    isHomePath,
    ensure,
    prepareNavigation,
    enforceForPath,
  }
})(typeof window !== 'undefined' ? window : globalThis)

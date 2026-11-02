/**
 * Bouton nav « Prompt DEBUG Copilot » — sous Accueil sur les pages DEBUG.
 */
;(function (global) {
  const COPILOT_LOGO = '/assets/logo-github-copilot.png'
  const DEBUG_PAGE_KEYS = new Set(['hookGit', 'syncJira', 'nodeInstall', 'npmrc', 'npmInstall', 'cypressInstall', 'playwrightInstall'])

  function assetUrl(path) {
    const ver = global.__WIZARD_VERSION__
    const base = global.__WIZARD_API_BASE__ || ''
    const rel = path.startsWith('/') ? path : `/${path}`
    const q = ver ? `?v=${encodeURIComponent(ver)}` : ''
    return base ? `${base.replace(/\/$/, '')}${rel}${q}` : `${rel}${q}`
  }

  function getPageKey() {
    if (global.WizardDisclaimer?.getCurrentPageKey) {
      return global.WizardDisclaimer.getCurrentPageKey()
    }
    return 'unknown'
  }

  function findNavContainer() {
    return global.document.querySelector('.hub-hero-nav')
      || global.document.querySelector('.hub-hero--has-home-btn .hub-hero-nav')
  }

  function injectButton() {
    const pageKey = getPageKey()
    if (!DEBUG_PAGE_KEYS.has(pageKey)) return
    if (global.document.getElementById('wizardDebugCopilotBtn')) return

    const nav = findNavContainer()
    if (!nav) return

    if (!nav.classList.contains('hub-hero-nav--debug')) {
      nav.classList.add('hub-hero-nav--debug')
    }

    const btn = global.document.createElement('button')
    btn.type = 'button'
    btn.id = 'wizardDebugCopilotBtn'
    btn.className = 'btn-hub-debug-copilot'
    btn.title = 'Générer un prompt DEBUG pour un agent IA (GitHub Copilot, Claude Sonnet, VS Code…)'
    btn.innerHTML = `<img src="${assetUrl(COPILOT_LOGO)}" alt="" width="14" height="14" class="btn-hub-debug-copilot-mark" /><span>Prompt DEBUG Copilot</span>`
    btn.addEventListener('click', () => {
      if (global.WizardDebugCopilot?.startFlow) {
        global.WizardDebugCopilot.startFlow()
      } else {
        global.Portail?.showToast?.('Module DEBUG indisponible — rechargez la fenêtre Wizard', { type: 'err' })
      }
    })

    nav.appendChild(btn)
    const hero = nav.closest('.hub-hero--has-home-btn, .hub-hero')
    if (hero) hero.classList.add('hub-hero--debug-nav')
  }

  function boot() {
    injectButton()
    global.addEventListener('wizard:page-ready', () => injectButton())
  }

  if (global.document?.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }

  global.WizardDebugNav = { injectButton }
})(typeof window !== 'undefined' ? window : globalThis)

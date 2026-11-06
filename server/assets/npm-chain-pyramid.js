/**
 * Pyramide npm — Node / Registry → Installer NPM → Playwright.
 */
// eslint-disable-next-line no-var
var NpmChainPyramid = (function () {
  const STEPS = {
    node: {
      id: 'node',
      title: 'Installer Node',
      logo: '/assets/logo-npm.png',
      logoAlt: 'Node.js',
      href: '/node-install.html',
      level: 1,
    },
    registry: {
      id: 'registry',
      title: 'npm / Registry',
      logo: '/assets/logo-npm.png',
      logoAlt: 'npm registry',
      href: '/npmrc.html',
      level: 1,
    },
    npmInstall: {
      id: 'npmInstall',
      title: 'Installer NPM',
      logo: '/assets/logo-npm.png',
      logoAlt: 'npm',
      href: '/npm-install.html?prompt=1',
      level: 2,
    },
    playwright: {
      id: 'playwright',
      title: 'Playwright',
      logo: '/assets/logo-playwright.png',
      logoAlt: 'Playwright',
      href: '/playwright-install.html',
      level: 3,
    },
  }

  function apiUrl(path) {
    const base = window.__WIZARD_API_BASE__ || ''
    return base ? `${base.replace(/\/$/, '')}${path}` : path
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function stepClass({ done, locked, current }) {
    const parts = ['npm-pyramid-step']
    if (done) parts.push('is-done')
    if (locked) parts.push('is-locked')
    if (current) parts.push('is-current')
    return parts.join(' ')
  }

  function renderStep(step, meta) {
    const { done, locked, current, hint } = meta
    const cls = stepClass({ done, locked, current })
    const badge = done ? 'OK' : locked ? '—' : current ? '…' : '—'
    const badgeCls = done ? 'ok' : locked ? 'ko' : current ? 'warn' : 'pending'
    const inner = `
      <div class="npm-pyramid-step-inner">
        <img class="npm-pyramid-step-logo" src="${apiUrl(step.logo)}" alt="" width="28" height="28" />
        <span class="npm-pyramid-step-title">${escapeHtml(step.title)}</span>
        ${hint ? `<span class="npm-pyramid-step-hint">${escapeHtml(hint)}</span>` : ''}
        <span class="npm-pyramid-step-badge ${badgeCls}">${badge}</span>
      </div>`

    if (locked) {
      return `<div class="${cls}" aria-disabled="true" title="Étape non disponible">${inner}</div>`
    }
    return `<a class="${cls}" href="${apiUrl(step.href)}" title="${escapeHtml(step.title)}">${inner}</a>`
  }

  /**
   * @param {object} state
   * @param {boolean} state.nodeOk
   * @param {boolean} state.npmrcOk
   * @param {boolean} state.packageJsonOk
   * @param {boolean} [state.npmInstallDone]
   * @param {string} [state.currentPage] nodeInstall | npmrc | npmInstall
   * @param {string} [state.nodeVersion]
   * @param {string} [state.npmVersion]
   */
  function render(state = {}) {
    const nodeOk = Boolean(state.nodeOk)
    const npmrcOk = Boolean(state.npmrcOk)
    const npmInstallDone = Boolean(state.npmInstallDone)
    const current = state.currentPage || ''

    const registryLocked = !nodeOk
    const npmInstallLocked = !npmrcOk
    const stacksLocked = !nodeOk || !npmrcOk

    const nodeHint = nodeOk && state.nodeVersion ? `v${state.nodeVersion}` : ''
    const registryHint = npmrcOk ? 'Artifactory' : registryLocked ? 'Node requis' : 'À configurer'
    const npmHint = npmInstallDone && state.npmVersion ? `npm ${state.npmVersion}` : ''

    const nodeStep = renderStep(STEPS.node, {
      done: nodeOk,
      locked: false,
      current: current === 'nodeInstall',
      hint: nodeHint,
    })
    const registryStep = renderStep(STEPS.registry, {
      done: npmrcOk,
      locked: registryLocked,
      current: current === 'npmrc',
      hint: registryHint,
    })
    const npmStep = renderStep(STEPS.npmInstall, {
      done: npmInstallDone,
      locked: npmInstallLocked,
      current: current === 'npmInstall',
      hint: npmHint,
    })
    const playwrightStep = renderStep(STEPS.playwright, {
      done: false,
      locked: false,
      current: false,
      hint: stacksLocked ? 'Node + .npmrc' : 'Multi-nav.',
    })

    const line1Cls = nodeOk && npmrcOk ? 'is-active' : nodeOk || npmrcOk ? 'is-partial' : ''
    const line2Cls = npmrcOk && nodeOk ? 'is-active' : ''

    return `
      <div class="npm-wizard-pyramid" role="group" aria-label="Parcours npm et stacks E2E">
        <p class="npm-wizard-pyramid-badge">Parcours npm · stacks E2E</p>
        <div class="npm-wizard-pyramid-level npm-wizard-pyramid-level--1">
          ${nodeStep}
          ${registryStep}
        </div>
        <svg class="npm-wizard-pyramid-svg npm-wizard-pyramid-svg--l1" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
          <line class="npm-wizard-pyramid-line npm-wizard-pyramid-line--node ${line1Cls}" x1="25" y1="2" x2="50" y2="26"/>
          <line class="npm-wizard-pyramid-line npm-wizard-pyramid-line--registry ${line1Cls}" x1="75" y1="2" x2="50" y2="26"/>
        </svg>
        <div class="npm-wizard-pyramid-level npm-wizard-pyramid-level--2">
          ${npmStep}
        </div>
        <svg class="npm-wizard-pyramid-svg npm-wizard-pyramid-svg--l2" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
          <line class="npm-wizard-pyramid-line npm-wizard-pyramid-line--playwright ${line2Cls}" x1="50" y1="2" x2="50" y2="26"/>
        </svg>
        <div class="npm-wizard-pyramid-level npm-wizard-pyramid-level--3">
          ${playwrightStep}
        </div>
      </div>`
  }

  function mount(target, state) {
    const el = typeof target === 'string' ? document.getElementById(target) : target
    if (!el) return
    el.innerHTML = render(state)
  }

  return { render, mount, STEPS }
})()

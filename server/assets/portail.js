/**

 * Portail — barre outils, persistance des défauts, export/import JSON, vérification

 */

const Portail = {

  isVsCodePanel() {
    return document.documentElement.classList.contains('vscode-app')
      || document.documentElement.classList.contains('embed-mode')
      || Boolean(window.__WIZARD_API_BASE__)
  },

  isEmbed() {
    return this.isVsCodePanel()
  },

  pageUrl(href) {
    if (!Portail.isEmbed() || !href || href.startsWith('http') || href.startsWith('#')) return href
    try {
      const u = new URL(href, location.origin)
      u.searchParams.set('embed', document.documentElement.classList.contains('vscode-app') ? 'vscode' : '1')
      return u.pathname + u.search + u.hash
    } catch {
      return href
    }
  },

  /** Navigation extension VS Code (évite location.href qui perd le shell vscode-app). */
  navigateTo(path) {
    const raw = String(path || '/')
    if (window.WizardHomeShell?.isHomePath?.(raw)) {
      return Portail.navigateHome()
    }
    let api = window.__wizardVsCodeApi
    if (!api && typeof acquireVsCodeApi === 'function') {
      try {
        api = acquireVsCodeApi()
        window.__wizardVsCodeApi = api
      } catch (_) { /* déjà acquis */ }
    }
    if (api) {
      const p = raw.replace(/^https?:\/\/[^/]+/i, '')
      api.postMessage({ type: 'navigate', path: p.startsWith('/') ? p : `/${p}` })
      return true
    }
    window.location.href = raw.startsWith('http') ? raw : Portail.pageUrl(raw)
    return false
  },

  /** Retour accueil — shell pleine largeur (voir wizard-home-shell.js). */
  navigateHome() {
    let api = window.__wizardVsCodeApi
    if (!api && typeof acquireVsCodeApi === 'function') {
      try {
        api = acquireVsCodeApi()
        window.__wizardVsCodeApi = api
      } catch (_) { /* déjà acquis */ }
    }
    if (api) {
      api.postMessage({ type: 'navigate', path: '/' })
      return true
    }
    window.location.href = Portail.pageUrl('/')
    return false
  },

  /** Réapplique le shell accueil (délègue à WizardHomeShell). */
  ensureHomeShell() {
    if (window.WizardHomeShell?.ensure) return window.WizardHomeShell.ensure()
    Portail.syncHtmlPageClass()
    return true
  },

  syncHtmlPageClass() {
    const body = document.body
    if (!body) return
    document.documentElement.classList.forEach((c) => {
      if (c.indexOf('page-') === 0) document.documentElement.classList.remove(c)
    })
    body.classList.forEach((c) => {
      if (c.indexOf('page-') === 0) document.documentElement.classList.add(c)
    })
    if (typeof acquireVsCodeApi === 'function' || window.__wizardVsCodeApi || window.__WIZARD_API_BASE__) {
      document.documentElement.classList.add('embed-mode', 'vscode-app')
    }
  },

  applyEmbedLinks(root = document) {
    if (!Portail.isEmbed()) return
    root.querySelectorAll('a[href^="/"]').forEach((a) => {
      const h = a.getAttribute('href')
      if (h) a.setAttribute('href', Portail.pageUrl(h))
    })
  },

  async fetchDefaults(page) {

    const url = page ? `/api/wizard/defaults?page=${encodeURIComponent(page)}` : '/api/wizard/defaults'

    const r = await fetch(url)

    return r.json()

  },



  async savePageDefaults(page, data) {

    const r = await fetch('/api/wizard/defaults', {

      method: 'POST',

      headers: { 'Content-Type': 'application/json' },

      body: JSON.stringify({ page, data }),

    })

    return r.json()

  },



  showStatus(el, ok, msg) {

    if (!el) return

    el.className = 'status ' + (ok ? 'ok' : ok === null ? 'info' : 'err')

    el.textContent = msg

  },

  showToast(message, { type = 'ok', duration = 4500 } = {}) {
    let el = document.getElementById('hubToast')
    if (!el) {
      el = document.createElement('div')
      el.id = 'hubToast'
      el.className = 'hub-toast'
      el.setAttribute('role', 'status')
      el.setAttribute('aria-live', 'polite')
      document.body.appendChild(el)
    }
    el.textContent = message
    el.className = `hub-toast hub-toast--${type} hub-toast--show`
    el.hidden = false
    clearTimeout(el._toastTimer)
    el._toastTimer = setTimeout(() => {
      el.classList.remove('hub-toast--show')
      setTimeout(() => { el.hidden = true }, 280)
    }, duration)
  },



  async runVerify(body) {

    const r = await fetch('/api/verify', {

      method: 'POST',

      headers: { 'Content-Type': 'application/json' },

      body: JSON.stringify(body),

    })

    const data = await r.json()

    if (!r.ok) throw new Error(data.error || 'Erreur vérification')

    return data

  },



  renderVerifyResults(container, result) {

    if (!container) return

    if (!result?.checks?.length) {

      container.innerHTML = ''

      container.className = 'verify-results'

      return

    }

    const cls = result.ok ? 'verify-ok' : 'verify-ko'

    container.className = `verify-results ${cls}`

    container.innerHTML = `<h4>${result.ok ? '✓ Prêt' : '⚠ Points à corriger'}</h4><ul>` +

      result.checks.map(c => {

        const icon = c.ok ? '✓' : (c.optional ? '○' : '✗')

        const liCls = c.ok ? 'check-ok' : (c.optional ? 'check-opt' : 'check-ko')

        return `<li class="${liCls}"><span class="check-icon">${icon}</span><strong>${c.name}</strong> — ${c.message}</li>`

      }).join('') + '</ul>'

  },



  async applyWizard(options = {}) {

    const r = await fetch('/api/wizard/apply', {

      method: 'POST',

      headers: { 'Content-Type': 'application/json' },

      body: JSON.stringify(options),

    })

    const data = await r.json()

    if (!r.ok) throw new Error(data.error || 'Erreur application')

    return data

  },



  formatApplyResult(result) {
    if (!result) return ''
    if (result.applied?.length) {
      let msg = 'Appliqué : ' + result.applied.join(', ')
      if (result.skipped?.length) msg += ' · Ignoré : ' + result.skipped.join(', ')
      if (result.errors?.length) msg += ' · Erreurs : ' + result.errors.join(', ')
      return msg
    }
    if (result.errors?.length) return result.errors.join(' · ')
    if (result.skipped?.length) return 'Rien à appliquer — ' + result.skipped.join(', ')
    return result.ok ? 'Configuration appliquée' : 'Échec partiel'
  },



  wrapCollapsibleHelp() {

    document.querySelectorAll('.help-panel:not(.help-wrapped)').forEach(panel => {

      if (panel.closest('details')) return

      const title = panel.querySelector('h3')?.textContent || 'Aide'

      const details = document.createElement('details')

      details.className = 'help-panel help-collapsible help-wrapped'

      const summary = document.createElement('summary')

      summary.textContent = title

      panel.classList.remove('help-panel')

      panel.querySelector('h3')?.remove()

      details.appendChild(summary)

      while (panel.firstChild) details.appendChild(panel.firstChild)

      panel.replaceWith(details)

    })

  },



  buildUnifiedHelpDl() {
    const items = [
      ['Mémoriser', 'Cette page → <code>wizard.defaults.json</code>'],
      ['Vérifier', 'Contrôles sans écriture disque'],
      ['Appliquer', 'Wizard → <code>.npmrc</code>, repair.conf, hook'],
      ['Export / Import', 'Backup JSON · cocher « Appliquer après import » pour écrire'],
    ]
    const src = document.querySelector('.page-help-source')
    if (src) {
      src.querySelectorAll('dt').forEach(dt => {
        const dd = dt.nextElementSibling
        if (dd?.tagName === 'DD') items.push([dt.textContent.trim(), dd.innerHTML.trim()])
      })
      src.remove()
    }
    return `<dl class="help-compact-dl">${items.map(([dt, dd]) =>
      `<dt>${dt}</dt><dd>${dd}</dd>`).join('')}</dl>`
  },

  injectToolbar(pageName) {

    const panel = document.createElement('section')
    panel.className = 'wizard-unified-panel'

    const bar = document.createElement('div')
    bar.className = 'config-toolbar'
    bar.innerHTML = `
      <div class="config-toolbar-inner">
        <span class="config-toolbar-label">Configuration wizard</span>
        <button type="button" class="btn-ghost" id="ptSaveDefaults" title="Mémoriser les champs de cette page">Mémoriser</button>
        <button type="button" class="btn-ghost" id="ptVerify" title="Contrôles préalables">Vérifier</button>
        <button type="button" class="btn-ghost" id="ptApply" title="Écrire wizard → .npmrc, repair.conf, hook">Appliquer</button>
        <button type="button" class="btn-ghost" id="ptExport">Exporter</button>
        <label class="btn-ghost file-btn">Importer<input type="file" id="ptImport" accept=".json,application/json" hidden></label>
        <label class="chk-secrets"><input type="checkbox" id="ptIncludeSecrets" checked> Secrets</label>
        <label class="chk-secrets"><input type="checkbox" id="ptApplyOnImport"> Appliquer import</label>
      </div>`

    panel.appendChild(bar)

    const status = document.createElement('div')
    status.id = 'toolbarStatus'
    status.className = 'status wizard-unified-status'
    panel.appendChild(status)

    const verifyBox = document.createElement('div')
    verifyBox.id = 'verifyResults'
    verifyBox.className = 'verify-results wizard-unified-verify'
    panel.appendChild(verifyBox)

    const help = document.createElement('details')
    help.className = 'wizard-unified-help help-collapsible help-wrapped'
    help.innerHTML = `
      <summary>Aide — actions de cette page</summary>
      ${Portail.buildUnifiedHelpDl()}`
    panel.appendChild(help)

    const wrap = document.querySelector('.wrap')
    const bc = wrap?.querySelector('.breadcrumb')
    if (bc) bc.after(panel)
    else wrap?.querySelector('.site-header')?.after(panel)



    bar.querySelector('#ptSaveDefaults')?.addEventListener('click', async () => {

      if (typeof Portail.onSaveDefaults === 'function') {

        const data = Portail.onSaveDefaults()

        const res = await Portail.savePageDefaults(pageName, data)

        Portail.showStatus(document.getElementById('toolbarStatus'), res.ok !== false, res.ok !== false ? 'Valeurs mémorisées pour cette page' : (res.error || 'Erreur'))

      }

    })



    bar.querySelector('#ptVerify')?.addEventListener('click', async () => {

      const statusEl = document.getElementById('toolbarStatus')

      const verifyEl = document.getElementById('verifyResults')

      try {

        let body = typeof Portail.onVerify === 'function' ? Portail.onVerify() : { page: pageName }

        if (!body.page) body = { ...body, page: pageName }

        const res = await Portail.runVerify(body)

        Portail.renderVerifyResults(verifyEl, res)

        Portail.showStatus(statusEl, res.ok, res.ok ? 'Vérification OK' : 'Vérification — voir détails ci-dessous')

      } catch (err) {

        Portail.showStatus(statusEl, false, err.message)

      }

    })



    bar.querySelector('#ptApply')?.addEventListener('click', async () => {

      try {

        const res = await Portail.applyWizard()

        Portail.showStatus(document.getElementById('toolbarStatus'), true, Portail.formatApplyResult(res) || 'Configuration appliquée')

      } catch (err) {

        Portail.showStatus(document.getElementById('toolbarStatus'), false, err.message)

      }

    })



    bar.querySelector('#ptExport')?.addEventListener('click', async () => {

      const secrets = bar.querySelector('#ptIncludeSecrets')?.checked

      const r = await fetch(`/api/wizard/export?secrets=${secrets ? '1' : '0'}`)

      const data = await r.json()

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })

      const a = document.createElement('a')

      a.href = URL.createObjectURL(blob)

      a.download = `portail-config-${new Date().toISOString().slice(0, 10)}.json`

      a.click()

      URL.revokeObjectURL(a.href)

    })



    bar.querySelector('#ptImport')?.addEventListener('change', async (e) => {

      const file = e.target.files?.[0]

      if (!file) return

      const applyToSystem = bar.querySelector('#ptApplyOnImport')?.checked

      try {

        const text = await file.text()

        const config = JSON.parse(text)

        const r = await fetch('/api/wizard/import', {

          method: 'POST',

          headers: { 'Content-Type': 'application/json' },

          body: JSON.stringify({ config, merge: true, applyToSystem }),

        })

        const res = await r.json()

        if (!r.ok) throw new Error(res.error)

        let msg = 'Configuration importée'

        if (applyToSystem && res.apply) msg += ' — ' + Portail.formatApplyResult(res.apply)

        Portail.showStatus(document.getElementById('toolbarStatus'), true, msg + ' — rechargement…')

        setTimeout(() => location.reload(), applyToSystem ? 900 : 600)

      } catch (err) {

        Portail.showStatus(document.getElementById('toolbarStatus'), false, err.message)

      }

      e.target.value = ''

    })

  },



  async loadDashboard(containerId, metaId, progressId) {
    const container = document.getElementById(containerId)
    const meta = document.getElementById(metaId)
    const progress = progressId ? document.getElementById(progressId) : null
    if (!container) return

    const STEP_UI = {
      npmrc: { icon: '📦', short: '.npmrc' },
      repair: { icon: '⚙️', short: 'Node / Cypress' },
      hook: { icon: '🔗', short: 'Hook JIRA' },
      doc: { icon: '📋', short: 'Livrables QA' },
    }

    try {
      const d = await fetch('/api/dashboard').then(r => r.json())
      const done = d.steps.filter(s => s.status === 'ok').length
      if (progress) progress.style.width = `${Math.round((done / d.steps.length) * 100)}%`

      container.innerHTML = d.steps.map(s => {
        const ui = STEP_UI[s.id] || { icon: '•', short: s.label }
        return `
        <a class="step-card step-${s.status}" href="${Portail.pageUrl(s.href)}" title="${s.message}">
          <div class="step-card-top">
            <span class="step-num">${s.order}</span>
            <span class="step-badge badge-${s.status}">${statusLabel(s.status)}</span>
          </div>
          <span class="step-icon" aria-hidden="true">${ui.icon}</span>
          <span class="step-label">${ui.short}</span>
          <span class="step-msg">${s.message}</span>
        </a>`
      }).join('')

      if (meta) {
        const parts = [`${done}/${d.steps.length} prêt${done > 1 ? 's' : ''}`]
        if (d.wizardUpdated) parts.push(`wizard ${d.wizardUpdated.slice(0, 10)}`)
        if (d.npmrcWizardDiff) parts.push('⚠ .npmrc ≠ wizard')
        meta.textContent = parts.join(' · ')
      }
    } catch {
      container.innerHTML = '<p class="hint">Impossible de charger le parcours.</p>'
    }

    function statusLabel(st) {
      return { ok: 'OK', warn: '!', ko: 'KO', pending: '—' }[st] || st
    }
  },



  init(pageName, onSaveDefaults, onLoadDefaults, onVerify) {

    Portail.onSaveDefaults = onSaveDefaults

    Portail.onVerify = onVerify

    Portail.injectToolbar(pageName)

    Portail.wrapCollapsibleHelp()

    if (typeof onLoadDefaults === 'function') onLoadDefaults()

  },

  escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  },

  hookGitLogoUrl() {
    const base = window.__WIZARD_API_BASE__ || ''
    return base ? `${base.replace(/\/$/, '')}/assets/logo-git-hook.png` : '/assets/logo-git-hook.png'
  },

  formatHookGitMention(text) {
    const raw = String(text || '')
    if (!/hook\s*git/i.test(raw)) return this.escapeHtml(raw)
    const logo = `<img class="hub-inline-logo hub-inline-logo--hook" src="${this.hookGitLogoUrl()}" alt="" width="14" height="14" loading="lazy" />`
    return this.escapeHtml(raw).replace(/hook\s*git/gi, `<span class="hub-hook-git-mention">${logo}<span>Hook Git</span></span>`)
  },

}

;(function initEmbedMode() {
  const params = new URLSearchParams(location.search)
  const mode = params.get('embed')
  const hasVsCodeApi = typeof acquireVsCodeApi === 'function'
  const vsCodeEmbed =
    mode === '1' ||
    mode === 'vscode' ||
    Boolean(window.__WIZARD_API_BASE__) ||
    hasVsCodeApi
  if (!vsCodeEmbed) return

  if (hasVsCodeApi && !window.__wizardVsCodeApi) {
    try {
      window.__wizardVsCodeApi = acquireVsCodeApi()
    } catch (_) { /* webview : une seule acquisition par document */ }
  }
  if (!window.__WIZARD_API_BASE__) {
    window.__WIZARD_API_BASE__ = location.origin
  }

  document.documentElement.classList.add('embed-mode', 'vscode-app')
  if (document.body) Portail.syncHtmlPageClass()

  function installVsCodeNavigation() {
    if (window.__wizardNavInstalled) return
    const api = window.__wizardVsCodeApi
    if (!api) return
    window.__wizardNavInstalled = true
    document.addEventListener(
      'click',
      (e) => {
        const a = e.target.closest('a[href]')
        if (!a || a.hasAttribute('download')) return
        const href = a.getAttribute('href') || ''
        if (!href || href.charAt(0) === '#') return
        if (
          /^https?:\/\//i.test(href) &&
          href.indexOf('127.0.0.1') === -1 &&
          href.indexOf('localhost') === -1
        ) {
          return
        }
        e.preventDefault()
        try {
          const base = window.__WIZARD_API_BASE__ || location.origin
          const u = new URL(href, `${base.replace(/\/$/, '')}/`)
          api.postMessage({ type: 'navigate', path: u.pathname + u.search })
        } catch {
          api.postMessage({ type: 'navigate', path: href })
        }
      },
      true,
    )
  }

  installVsCodeNavigation()

  function assetBase() {
    const base = window.__WIZARD_API_BASE__ || ''
    return base ? base.replace(/\/$/, '') : ''
  }

  function ensureVsCodeStyles() {
    if (
      document.querySelector('link[href*="css_theme_app.css"]') ||
      document.querySelector('link[href*="vscode-app.css"]')
    ) {
      return
    }
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    const prefix = assetBase()
    const ver = window.__WIZARD_VERSION__ || ''
    const q = ver ? `?v=${encodeURIComponent(ver)}` : ''
    link.href = prefix
      ? `${prefix}/assets/css_theme_app.css${q}`
      : `/assets/css_theme_app.css${q}`
    document.head.appendChild(link)
  }

  function ensureWizardBrandBar() {
    if (document.querySelector('.wizard-brand-bar')) return
    const prefix = assetBase()
    const bar = document.createElement('header')
    bar.className = 'wizard-brand-bar'
    bar.setAttribute('role', 'banner')
    bar.innerHTML = `
      <img class="wizard-logo-cats" src="${prefix}/assets/logo-cats-full.png" alt="Crédit Agricole Technologies et Services" />
      <span class="wizard-brand-spacer"></span>
      <img class="wizard-logo-qa" src="${prefix}/assets/logo-qa.png" alt="QA" />`
    document.body.insertBefore(bar, document.body.firstChild)
  }

  function ensureWizardFooterScript() {
    if (document.querySelector('script[src*="wizard-footer.js"]')) return
    const prefix = assetBase()
    const ver = window.__WIZARD_VERSION__ || ''
    const q = ver ? `?v=${encodeURIComponent(ver)}` : ''
    const script = document.createElement('script')
    script.src = prefix ? `${prefix}/assets/wizard-footer.js${q}` : `/assets/wizard-footer.js${q}`
    document.body.appendChild(script)
  }

  function ensureWizardShell() {
    ensureVsCodeStyles()
    ensureWizardBrandBar()
    ensureWizardFooterScript()
    if (window.WizardFooter && typeof WizardFooter.sync === 'function') {
      void WizardFooter.sync()
    } else if (!document.querySelector('.wizard-footer')) {
      const footer = document.createElement('footer')
      footer.className = 'wizard-footer'
      footer.setAttribute('role', 'contentinfo')
      footer.innerHTML = `
        <span class="wizard-footer-version">v${window.__WIZARD_VERSION__ || '…'}</span>
        <span class="wizard-footer-label">${window.__WIZARD_FOOTER_LABEL__ || 'Outil — TRIBU IT pour CA-TS'}</span>`
      document.body.appendChild(footer)
    }
  }

  const run = () => {
    Portail.syncHtmlPageClass()
    ensureWizardShell()
    Portail.applyEmbedLinks()
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run)
  else run()
})()



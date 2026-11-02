/**
 * Footer Wizard QA — version + libellé tribu (source unique côté client).
 * Synchronise depuis window.__WIZARD_VERSION__ ou GET /api/wizard/meta.
 */
;(function (global) {
  const FOOTER_LABEL = 'Outil — TRIBU IT pour CA-TS'

  function apiUrl(path) {
    const base = global.__WIZARD_API_BASE__ || ''
    return base ? `${base.replace(/\/$/, '')}${path}` : path
  }

  function formatVersion(ver) {
    const s = String(ver || '').trim()
    if (!s || s === '…' || s === '?') return ''
    return s.startsWith('v') ? s : `v${s}`
  }

  function applyFooter(versionText, labelText) {
    const footers = document.querySelectorAll('.wizard-footer')
    for (let i = 1; i < footers.length; i++) footers[i].remove()

    let footer = document.querySelector('.wizard-footer')
    if (!footer) {
      footer = document.createElement('footer')
      footer.className = 'wizard-footer'
      footer.setAttribute('role', 'contentinfo')
      document.body.appendChild(footer)
    }

    let verEl = footer.querySelector('.wizard-footer-version')
    if (!verEl) {
      verEl = document.createElement('span')
      verEl.className = 'wizard-footer-version'
      footer.insertBefore(verEl, footer.firstChild)
    } else if (footer.firstChild !== verEl) {
      footer.insertBefore(verEl, footer.firstChild)
    }

    let labelEl = footer.querySelector('.wizard-footer-label')
    if (!labelEl) {
      labelEl = document.createElement('span')
      labelEl.className = 'wizard-footer-label'
      footer.appendChild(labelEl)
    } else if (footer.lastChild !== labelEl) {
      footer.appendChild(labelEl)
    }

    verEl.textContent = versionText || 'v…'
    labelEl.textContent = labelText || FOOTER_LABEL
    labelEl.title = labelText || FOOTER_LABEL
  }

  async function resolveMeta() {
    let version = global.__WIZARD_VERSION__
    let label = global.__WIZARD_FOOTER_LABEL__ || FOOTER_LABEL

    try {
      const r = await fetch(apiUrl('/api/wizard/meta'))
      if (r.ok) {
        const data = await r.json()
        if (data.version) version = data.version
        if (data.footerLabel) label = data.footerLabel
        global.__WIZARD_VERSION__ = version
        global.__WIZARD_FOOTER_LABEL__ = label
      }
    } catch { /* hors ligne / chargement initial */ }

    return {
      versionText: formatVersion(version) || 'v…',
      labelText: label || FOOTER_LABEL,
    }
  }

  async function syncFooter() {
    const { versionText, labelText } = await resolveMeta()
    applyFooter(versionText, labelText)
  }

  const WizardFooter = {
    sync: syncFooter,
    apply: applyFooter,
  }

  function boot() {
    applyFooter(
      formatVersion(global.__WIZARD_VERSION__) || 'v…',
      global.__WIZARD_FOOTER_LABEL__ || FOOTER_LABEL,
    )
    void syncFooter()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }

  global.WizardFooter = WizardFooter
})(typeof window !== 'undefined' ? window : globalThis)

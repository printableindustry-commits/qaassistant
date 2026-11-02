/**
 * Parcours pop-up — explication des livrables Documentation QA (1 écran par document).
 */
;(function (global) {
  const STORAGE_KEY = 'wizardQa.docQaLivrablesTour'

  function apiUrl(path) {
    const base = global.__WIZARD_API_BASE__ || ''
    return base ? `${base.replace(/\/$/, '')}${path}` : path
  }

  function assetUrl(path) {
    const ver = global.__WIZARD_VERSION__
    const base = global.__WIZARD_API_BASE__ || ''
    const rel = path.startsWith('/') ? path : `/${path}`
    const q = ver ? `?v=${encodeURIComponent(ver)}` : ''
    return base ? `${base.replace(/\/$/, '')}${rel}${q}` : `${rel}${q}`
  }

  function escapeHtml(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br>')
  }

  function loadLocalHidden() {
    try {
      const raw = global.localStorage.getItem(STORAGE_KEY)
      return raw ? JSON.parse(raw).hidden === true : false
    } catch {
      return false
    }
  }

  function saveLocalHidden() {
    try {
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify({ hidden: true, at: new Date().toISOString() }))
    } catch { /* ignore */ }
  }

  const DocQaLivrablesTour = {
    steps: [],
    index: 0,
    config: {},
    serverHidden: false,

    async fetchTour() {
      const r = await fetch(apiUrl('/api/doc/wizard/livrables-tour'))
      const data = await r.json()
      if (!r.ok || !data.ok) throw new Error(data.error || 'Parcours livrables indisponible')
      this.config = data
      this.steps = data.steps || []
      this.serverHidden = Boolean(data.hidden)
      return data
    },

    isDismissed() {
      return this.isPermanentlyDismissed()
    },

    isPermanentlyDismissed() {
      if (loadLocalHidden()) return true
      if (global.WizardDisclaimer?.wasPermanentlyHidden?.('docQaLivrablesTour')) return true
      return false
    },

    ensureModal() {
      let el = global.document.getElementById('docQaLivrablesTourModal')
      if (el) return el
      el = global.document.createElement('div')
      el.id = 'docQaLivrablesTourModal'
      el.className = 'hub-disclaimer-modal doc-qa-livrables-tour-modal'
      el.hidden = true
      el.setAttribute('role', 'dialog')
      el.setAttribute('aria-modal', 'true')
      el.setAttribute('aria-labelledby', 'docQaLivrablesTourTitle')
      el.innerHTML = `
        <div class="hub-disclaimer-backdrop" data-doc-tour-close></div>
        <div class="hub-disclaimer-panel doc-qa-livrables-tour-panel">
          <div class="hub-disclaimer-accent"></div>
          <header class="hub-disclaimer-head doc-qa-livrables-tour-head">
            <div class="hub-disclaimer-spinner" role="img" aria-label="QA">
              <div class="hub-disclaimer-spinner-ring" aria-hidden="true"></div>
              <img class="hub-disclaimer-logo" src="${assetUrl('/assets/logo-qa.png')}" alt="QA" width="40" height="40" />
            </div>
            <div class="doc-qa-livrables-tour-head-text">
              <h2 id="docQaLivrablesTourTitle" class="hub-disclaimer-title"></h2>
              <p class="doc-qa-livrables-tour-progress" id="docQaLivrablesTourProgress"></p>
            </div>
          </header>
          <div class="doc-qa-livrables-tour-step-title" id="docQaLivrablesTourStepTitle"></div>
          <div class="hub-disclaimer-body doc-qa-livrables-tour-body" id="docQaLivrablesTourBody"></div>
          <footer class="hub-disclaimer-footer doc-qa-livrables-tour-footer">
            <button type="button" class="hub-disclaimer-never-btn" id="docQaLivrablesTourNever"></button>
            <div class="hub-disclaimer-actions">
              <button type="button" class="btn-secondary btn-sm" id="docQaLivrablesTourPrev" hidden>Précédent</button>
              <button type="button" class="btn-primary btn-sm" id="docQaLivrablesTourNext"></button>
            </div>
          </footer>
        </div>`
      global.document.body.appendChild(el)

      el.querySelector('[data-doc-tour-close]')?.addEventListener('click', () => this.close())
      el.querySelector('#docQaLivrablesTourNever')?.addEventListener('click', () => this.dismissPermanent())
      el.querySelector('#docQaLivrablesTourNext')?.addEventListener('click', () => this.next())
      el.querySelector('#docQaLivrablesTourPrev')?.addEventListener('click', () => this.prev())
      global.document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !el.hidden) this.close()
      })
      return el
    },

    renderStep() {
      const step = this.steps[this.index]
      if (!step) return

      const total = this.steps.length
      const modal = this.ensureModal()
      modal.querySelector('#docQaLivrablesTourTitle').textContent = this.config.modalTitle || 'Livrables Documentation QA - Explication'
      modal.querySelector('#docQaLivrablesTourProgress').textContent = `Livrable ${this.index + 1} / ${total}`
      modal.querySelector('#docQaLivrablesTourStepTitle').textContent = step.title || ''
      modal.querySelector('#docQaLivrablesTourBody').innerHTML = (step.paragraphs || [])
        .map((p) => `<p>${escapeHtml(p)}</p>`)
        .join('')

      const neverBtn = modal.querySelector('#docQaLivrablesTourNever')
      if (neverBtn) {
        neverBtn.textContent = this.config.neverShowButton || 'Ne plus afficher la pop-up'
      }

      const nextBtn = modal.querySelector('#docQaLivrablesTourNext')
      const prevBtn = modal.querySelector('#docQaLivrablesTourPrev')
      const isLast = this.index >= total - 1
      if (nextBtn) nextBtn.textContent = isLast ? (this.config.closeButton || 'Fermer') : (this.config.nextButton || 'Suivant')
      if (prevBtn) prevBtn.hidden = this.index === 0

      const pct = total > 0 ? Math.round(((this.index + 1) / total) * 100) : 0
      modal.style.setProperty('--doc-qa-tour-progress', `${pct}%`)
    },

    open({ force = false } = {}) {
      if (!force && this.isDismissed()) return false
      if (!this.steps.length) return false
      this.index = 0
      const modal = this.ensureModal()
      this.renderStep()
      modal.hidden = false
      global.document.body.classList.add('doc-qa-livrables-tour-open')
      return true
    },

    close() {
      const modal = global.document.getElementById('docQaLivrablesTourModal')
      if (modal) modal.hidden = true
      global.document.body.classList.remove('doc-qa-livrables-tour-open')
    },

    next() {
      if (this.index < this.steps.length - 1) {
        this.index += 1
        this.renderStep()
        return
      }
      this.close()
    },

    prev() {
      if (this.index > 0) {
        this.index -= 1
        this.renderStep()
      }
    },

    async dismissPermanent() {
      saveLocalHidden()
      this.serverHidden = true
      try {
        await fetch(apiUrl('/api/doc/wizard/tour/dismiss'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      } catch { /* cache local suffit */ }
      if (global.WizardDisclaimer?.setPermanentlyHidden) {
        try {
          await global.WizardDisclaimer.setPermanentlyHidden('docQaLivrablesTour')
        } catch { /* ignore */ }
      }
      this.close()
    },

    async showOnLoadIfNeeded() {
      try {
        await this.fetchTour()
        if (this.isPermanentlyDismissed()) return
        this.open()
      } catch (e) {
        global.Portail?.showToast?.(e.message, { type: 'warn' })
      }
    },

    async replay() {
      await this.fetchTour()
      this.open({ force: true })
    },
  }

  global.DocQaLivrablesTour = DocQaLivrablesTour
})(typeof window !== 'undefined' ? window : globalThis)

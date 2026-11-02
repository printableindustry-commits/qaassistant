/**

 * UI générique — prompt DEBUG GitHub Copilot (modal terminal + copie).

 * Usage : CopilotDebugPrompt.open({ title, prompt })

 *         CopilotDebugPrompt.fromLog({ title, context, log, error, environment })

 */

;(function (global) {

  const COPILOT_LOGO = '/assets/logo-github-copilot.png'

  const COPY_SVG = `<svg class="copilot-copy-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 18H8V7h11v16z"/></svg>`



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



  function ensureModal() {

    let el = document.getElementById('copilotDebugModal')

    if (el) return el

    el = document.createElement('div')

    el.id = 'copilotDebugModal'

    el.className = 'copilot-debug-modal'

    el.hidden = true

    el.innerHTML = `

      <div class="copilot-debug-backdrop" data-copilot-close></div>

      <div class="copilot-debug-panel" role="dialog" aria-labelledby="copilotDebugTitle" aria-modal="true">

        <header class="copilot-debug-header">

          <div class="copilot-debug-brand">

            <img class="copilot-debug-logo" src="${assetUrl(COPILOT_LOGO)}" alt="GitHub Copilot" width="32" height="32" />

            <span class="copilot-debug-brand-text">GitHub Copilot</span>

          </div>

          <button type="button" class="copilot-debug-close" data-copilot-close title="Fermer" aria-label="Fermer">×</button>

        </header>

        <h2 id="copilotDebugTitle" class="copilot-debug-title"></h2>

        <p class="copilot-debug-lead">Copiez ce prompt dans un chat <strong>agent</strong> (Claude Sonnet 4.6, GitHub Copilot…) pour analyser le problème. Il contient la configuration Wizard, les chemins absolus et les extraits de logs.</p>

        <div class="copilot-debug-terminal-wrap">

          <pre class="copilot-debug-terminal" id="copilotDebugPre" tabindex="0"></pre>

          <button type="button" class="copilot-debug-copy" id="copilotDebugCopy" title="Copier le prompt">

            ${COPY_SVG}

            <span>Copier</span>

          </button>

        </div>

        <div class="copilot-debug-actions">

          <button type="button" class="copilot-debug-action-btn" id="copilotDebugRegen" title="Regénérer le prompt avec les données actuelles">

            <span class="copilot-debug-action-icon" aria-hidden="true">↻</span>

            Régénérer le prompt

          </button>

          <button type="button" class="copilot-debug-action-btn copilot-debug-action-btn--logs" id="copilotDebugLogs" title="Ouvrir .wizard-qa/logs dans l'Explorateur">

            <img src="${assetUrl('/assets/icon-folder.svg')}" alt="" width="16" height="16" class="copilot-debug-action-folder" />

            Dossier des logs

          </button>

        </div>

        <p class="copilot-debug-hint" id="copilotDebugHint"></p>

      </div>`

    document.body.appendChild(el)

    el.querySelectorAll('[data-copilot-close]').forEach((btn) => {

      btn.addEventListener('click', () => CopilotDebugPrompt.close())

    })

    document.getElementById('copilotDebugCopy')?.addEventListener('click', () => CopilotDebugPrompt.copy())

    document.getElementById('copilotDebugRegen')?.addEventListener('click', () => CopilotDebugPrompt.regenerate())

    document.getElementById('copilotDebugLogs')?.addEventListener('click', () => CopilotDebugPrompt.openLogsFolder())

    document.addEventListener('keydown', (e) => {

      if (e.key === 'Escape' && !el.hidden) CopilotDebugPrompt.close()

    })

    return el

  }



  const CopilotDebugPrompt = {

    _prompt: '',

    _lastOpts: null,



    open({ title = 'Debug', prompt = '', meta = {} } = {}) {

      const modal = ensureModal()

      this._prompt = String(prompt || '')

      const titleEl = document.getElementById('copilotDebugTitle')

      const pre = document.getElementById('copilotDebugPre')

      const hint = document.getElementById('copilotDebugHint')

      const regenBtn = document.getElementById('copilotDebugRegen')

      if (titleEl) titleEl.textContent = title

      if (pre) {

        pre.textContent = this._prompt

        pre.scrollTop = 0

      }

      if (regenBtn) regenBtn.disabled = !this._lastOpts

      if (hint) {

        const kb = Math.round(this._prompt.length / 1024)

        const enriched = meta.hasWizardSection || this._prompt.includes('Configuration Wizard')

        hint.textContent = enriched

          ? `Prompt enrichi (~${kb} Ko) — faites défiler pour voir credentials, hooks.conf, plans, chemins logs et extraits.`

          : `Prompt court (~${kb} Ko) — rechargez la fenêtre Wizard (v${global.__WIZARD_VERSION__ || '?'}) si la config complète manque.`

        hint.className = enriched ? 'copilot-debug-hint is-ok' : 'copilot-debug-hint is-warn'

      }

      modal.hidden = false

      document.body.classList.add('copilot-debug-open')

    },



    close() {

      const modal = document.getElementById('copilotDebugModal')

      if (modal) modal.hidden = true

      document.body.classList.remove('copilot-debug-open')

    },



    async copy() {

      const hint = document.getElementById('copilotDebugHint')

      try {

        await navigator.clipboard.writeText(this._prompt)

        if (hint) {

          hint.textContent = 'Prompt copié dans le presse-papiers.'

          hint.className = 'copilot-debug-hint is-ok'

        }

        if (global.Portail?.showToast) {

          global.Portail.showToast('Prompt Copilot copié', { type: 'ok' })

        }

      } catch (err) {

        if (hint) {

          hint.textContent = 'Copie impossible — sélectionnez le texte manuellement.'

          hint.className = 'copilot-debug-hint is-err'

        }

      }

    },



    async openLogsFolder() {

      try {

        const r = await fetch(apiUrl('/api/wizard/open-folder'), {

          method: 'POST',

          headers: { 'Content-Type': 'application/json' },

          body: JSON.stringify({ target: 'logs' }),

        })

        const data = await r.json()

        if (!r.ok) throw new Error(data.error)

        if (global.Portail?.showToast) {

          global.Portail.showToast('Dossier des logs ouvert', { type: 'ok' })

        }

      } catch (err) {

        if (global.Portail?.showToast) {

          global.Portail.showToast(err.message, { type: 'err' })

        } else {

          throw err

        }

      }

    },



    async regenerate() {

      if (!this._lastOpts) {

        if (global.Portail?.showToast) {

          global.Portail.showToast('Aucun contexte — générez d’abord un prompt', { type: 'warn' })

        }

        return

      }

      const btn = document.getElementById('copilotDebugRegen')

      if (btn) btn.disabled = true

      try {

        await this.fromLog({ ...this._lastOpts })

        if (global.Portail?.showToast) {

          global.Portail.showToast('Prompt régénéré', { type: 'ok' })

        }

      } catch (err) {

        if (global.Portail?.showToast) {

          global.Portail.showToast(err.message, { type: 'err' })

        }

      } finally {

        if (btn) btn.disabled = false

      }

    },



    async fromLog(opts = {}) {

      this._lastOpts = { ...opts }

      const r = await fetch(apiUrl('/api/copilot/debug-prompt'), {

        method: 'POST',

        headers: { 'Content-Type': 'application/json' },

        body: JSON.stringify(opts),

      })

      const data = await r.json()

      if (!r.ok) throw new Error(data.error || 'Échec génération prompt')

      this.open({

        title: opts.title || data.title || 'Debug',

        prompt: data.prompt,

        meta: { hasWizardSection: data.hasWizardSection },

      })

      if (data.enriched && !data.hasWizardSection && global.Portail?.showToast) {

        global.Portail.showToast('Prompt sans section config — mettez à jour l’extension Wizard QA', { type: 'warn' })

      }

      return data

    },

  }



  global.CopilotDebugPrompt = CopilotDebugPrompt

})(typeof window !== 'undefined' ? window : globalThis)



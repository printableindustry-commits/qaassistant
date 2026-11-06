/**
 * Prompt Documentation QA — modale Copilot (même UX que DEBUG, sans session de contrôle).
 */
;(function (global) {
  const QA_LOGO = '/assets/logo-qa.png'
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

  function qaSpinnerMarkup(className = '') {
    const extra = className ? ` ${className}` : ''
    return `<div class="hub-disclaimer-spinner${extra}" role="img" aria-label="QA">
      <div class="hub-disclaimer-spinner-ring" aria-hidden="true"></div>
      <img class="hub-disclaimer-logo" src="${assetUrl(QA_LOGO)}" alt="QA" width="34" height="34" />
    </div>`
  }

  function ensureGenModal() {
    let el = global.document.getElementById('wizardDocGenModal')
    if (el) return el
    el = global.document.createElement('div')
    el.id = 'wizardDocGenModal'
    el.className = 'wizard-debug-gen-modal'
    el.hidden = true
    el.innerHTML = `
      <div class="wizard-debug-gen-backdrop"></div>
      <div class="wizard-debug-gen-panel card card-compact" role="dialog" aria-labelledby="wizardDocGenTitle">
        <header class="wizard-debug-gen-head">
          ${qaSpinnerMarkup('wizard-debug-gen-spinner')}
          <h2 id="wizardDocGenTitle" class="wizard-debug-gen-title">Génération du prompt Documentation</h2>
        </header>
        <ul class="wizard-debug-gen-steps" id="wizardDocGenSteps">
          <li data-step="context" class="is-active"><span class="wizard-debug-gen-step-icon">…</span> Consolidation du contexte</li>
          <li data-step="prompt"><span class="wizard-debug-gen-step-icon">…</span> Génération du prompt</li>
        </ul>
      </div>`
    global.document.body.appendChild(el)
    return el
  }

  function setGenStep(step, state) {
    const li = global.document.getElementById('wizardDocGenSteps')?.querySelector(`[data-step="${step}"]`)
    if (!li) return
    const icon = li.querySelector('.wizard-debug-gen-step-icon')
    if (state === 'active') {
      li.classList.add('is-active')
      li.classList.remove('is-done')
      if (icon) icon.textContent = '…'
    } else if (state === 'done') {
      li.classList.remove('is-active')
      li.classList.add('is-done')
      if (icon) icon.textContent = '✓'
    }
  }

  function showGenModal() {
    const modal = ensureGenModal()
    setGenStep('context', 'active')
    setGenStep('prompt', '')
    modal.hidden = false
    global.document.body.classList.add('wizard-debug-gen-open')
  }

  function hideGenModal() {
    const modal = global.document.getElementById('wizardDocGenModal')
    if (modal) modal.hidden = true
    global.document.body.classList.remove('wizard-debug-gen-open')
  }

  function ensurePromptModal() {
    let el = global.document.getElementById('wizardDocPromptModal')
    if (el) return el
    el = global.document.createElement('div')
    el.id = 'wizardDocPromptModal'
    el.className = 'copilot-debug-modal'
    el.hidden = true
    el.innerHTML = `
      <div class="copilot-debug-backdrop" data-doc-copilot-close></div>
      <div class="copilot-debug-panel" role="dialog" aria-labelledby="wizardDocPromptTitle" aria-modal="true">
        <header class="copilot-debug-head">
          ${qaSpinnerMarkup('copilot-debug-spinner')}
          <div class="copilot-debug-head-row">
            <span class="copilot-debug-brand-text">Prompt Documentation QA</span>
            <span class="copilot-debug-tokens" id="wizardDocPromptTokens" title="Estimation tokens agent"></span>
            <button type="button" class="copilot-debug-close" data-doc-copilot-close title="Fermer" aria-label="Fermer">×</button>
          </div>
        </header>
        <h2 id="wizardDocPromptTitle" class="copilot-debug-title"></h2>
        <p class="copilot-debug-lead">Copiez ce prompt dans <strong>Copilot Agent</strong>. L'IA doit répondre uniquement avec un bloc entre les marqueurs <code>&lt;!-- DOC_QA_BLOCK_START --&gt;</code> et <code>&lt;!-- DOC_QA_BLOCK_END --&gt;</code>.</p>
        <div class="copilot-debug-terminal-wrap">
          <pre class="copilot-debug-terminal" id="wizardDocPromptPre" tabindex="0"></pre>
          <button type="button" class="copilot-debug-copy" id="wizardDocPromptCopy" title="Copier le prompt">${COPY_SVG}<span>Copier</span></button>
        </div>
        <div class="copilot-debug-actions">
          <button type="button" class="copilot-debug-action-btn" id="wizardDocPromptSave">Exporter le prompt</button>
          <button type="button" class="copilot-debug-action-btn" id="wizardDocPromptRegen">Regénérer le prompt</button>
          <button type="button" class="copilot-debug-action-btn copilot-debug-action-accent" id="wizardDocPromptToBlock" hidden>Coller la réponse de l'IA</button>
        </div>
        <p class="copilot-debug-hint" id="wizardDocPromptHint"></p>
      </div>`
    global.document.body.appendChild(el)
    el.querySelectorAll('[data-doc-copilot-close]').forEach((btn) => {
      btn.addEventListener('click', () => WizardDocCopilot.closePrompt())
    })
    global.document.getElementById('wizardDocPromptCopy')?.addEventListener('click', () => WizardDocCopilot.copy())
    global.document.getElementById('wizardDocPromptSave')?.addEventListener('click', () => WizardDocCopilot.saveMd())
    global.document.getElementById('wizardDocPromptRegen')?.addEventListener('click', () => WizardDocCopilot.regenerate())
    global.document.getElementById('wizardDocPromptToBlock')?.addEventListener('click', () => WizardDocCopilot.sendToBlock())
    global.document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !el.hidden) WizardDocCopilot.closePrompt()
    })
    return el
  }

  const BLOCK_RE = /<!--\s*DOC_QA_BLOCK_START\s*-->([\s\S]*?)<!--\s*DOC_QA_BLOCK_END\s*-->/i

  function extractDocQaBlock(text) {
    const raw = String(text || '').trim()
    const m = raw.match(BLOCK_RE)
    if (m) return { found: true, content: m[1].trim(), raw }
    return { found: false, content: raw, raw }
  }

  const WizardDocCopilot = {
    _prompt: '',
    _lastBody: null,
    _meta: null,
    _mode: 'full',

    async startThemeFlow({ docId, chapterId, userNotes = '' }) {
      this._mode = 'chapter'
      showGenModal()
      try {
        setGenStep('context', 'active')
        setGenStep('prompt', '')
        this._lastBody = {
          docId,
          chapterId,
          userNotes,
          agentModel: 'Claude Sonnet 4.6',
        }
        setGenStep('context', 'done')
        setGenStep('prompt', 'active')

        const r = await fetch(apiUrl('/api/doc/wizard/prompt/chapter'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this._lastBody),
        })
        const data = await r.json()
        if (!r.ok || !data.ok) throw new Error(data.error || 'Génération du prompt échouée')
        setGenStep('prompt', 'done')
        hideGenModal()
        this.showPrompt(data)
        return data
      } catch (e) {
        hideGenModal()
        throw e
      }
    },

    async startFlow(getAnswers) {
      this._mode = 'full'
      showGenModal()
      try {
        setGenStep('context', 'active')
        const answers = typeof getAnswers === 'function' ? getAnswers() : (getAnswers || {})
        const saveRes = await fetch(apiUrl('/api/doc/wizard/answers'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ answers }),
        })
        const saved = await saveRes.json()
        if (!saveRes.ok || saved.ok === false) {
          throw new Error(saved.error || saved.validation?.missing?.join(', ') || 'Enregistrement impossible')
        }
        setGenStep('context', 'done')
        setGenStep('prompt', 'active')

        this._lastBody = { answers, agentModel: 'Claude Sonnet 4.6' }
        const r = await fetch(apiUrl('/api/doc/wizard/prompt'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this._lastBody),
        })
        const data = await r.json()
        if (!r.ok || !data.ok) throw new Error(data.error || 'Génération du prompt échouée')
        setGenStep('prompt', 'done')
        hideGenModal()
        this.showPrompt(data)
        return data
      } catch (e) {
        hideGenModal()
        throw e
      }
    },

    showPrompt(data) {
      this._prompt = data.prompt || ''
      this._meta = data
      const modal = ensurePromptModal()
      const title = global.document.getElementById('wizardDocPromptTitle')
      const pre = global.document.getElementById('wizardDocPromptPre')
      const tokens = global.document.getElementById('wizardDocPromptTokens')
      const hint = global.document.getElementById('wizardDocPromptHint')
      if (title) title.textContent = data.title || 'Documentation QA'
      if (pre) pre.textContent = this._prompt
      if (tokens) {
        const est = typeof data.tokenEstimate === 'object' ? data.tokenEstimate.tokenEstimate : data.tokenEstimate
        if (data.docId && data.chapterId) {
          tokens.textContent = `~${est ?? '—'} tokens · ${data.docId} / ${data.chapterId}`
        } else {
          tokens.textContent = `~${est ?? '—'} tokens · ${data.documentCount ?? '?'} livrables`
        }
      }
      if (hint) {
        if (data.readiness?.readinessLabel) {
          hint.textContent = `${data.readiness.readinessLabel} · Fichier cible : ${data.file || '—'}`
        } else if (data.file) {
          hint.textContent = `Fichier cible : ${data.file} · ${data.promptSizeKb ?? '?'} Ko`
        } else {
          hint.textContent = `${data.chapterCount ?? '—'} chapitres · ${data.promptSizeKb ?? '?'} Ko`
        }
      }
      const toBlock = global.document.getElementById('wizardDocPromptToBlock')
      if (toBlock) {
        const show = this._mode === 'chapter' && data.docId && data.chapterId
        toBlock.hidden = !show
        toBlock.title = show
          ? 'Collez la réponse IA dans le presse-papiers, puis cliquez pour l\'intégrer dans l\'assistant'
          : ''
      }
      modal.hidden = false
      global.document.body.classList.add('copilot-debug-open')
    },

    closePrompt() {
      const modal = global.document.getElementById('wizardDocPromptModal')
      if (modal) modal.hidden = true
      global.document.body.classList.remove('copilot-debug-open')
    },

    async copy() {
      if (!this._prompt) return
      try {
        await navigator.clipboard.writeText(this._prompt)
        global.Portail?.showToast?.('Prompt copié', { type: 'ok' })
      } catch {
        global.Portail?.showToast?.('Copie impossible', { type: 'warn' })
      }
    },

    async saveMd() {
      if (!this._prompt) return
      try {
        const url = this._mode === 'chapter' && this._meta?.docId
          ? '/api/doc/wizard/prompt/chapter/save'
          : '/api/doc/wizard/prompt/save'
        const body = this._mode === 'chapter' && this._meta?.docId
          ? { prompt: this._prompt, docId: this._meta.docId, chapterId: this._meta.chapterId }
          : { prompt: this._prompt }
        const r = await fetch(apiUrl(url), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const data = await r.json()
        if (!r.ok || !data.ok) throw new Error(data.error || 'Sauvegarde échouée')
        global.Portail?.showToast?.(`Sauvegardé : ${data.relativePath}`, { type: 'ok' })
      } catch (e) {
        global.Portail?.showToast?.(e.message, { type: 'warn' })
      }
    },

    async regenerate() {
      if (!this._lastBody) return
      showGenModal()
      setGenStep('context', 'done')
      setGenStep('prompt', 'active')
      try {
        const url = this._mode === 'chapter' ? '/api/doc/wizard/prompt/chapter' : '/api/doc/wizard/prompt'
        const r = await fetch(apiUrl(url), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this._lastBody),
        })
        const data = await r.json()
        if (!r.ok || !data.ok) throw new Error(data.error || 'Régénération échouée')
        setGenStep('prompt', 'done')
        hideGenModal()
        this.showPrompt(data)
      } catch (e) {
        hideGenModal()
        global.Portail?.showToast?.(e.message, { type: 'warn' })
      }
    },

    async sendToBlock() {
      if (this._mode !== 'chapter' || !this._meta?.docId || !this._meta?.chapterId) return
      let content = ''
      try {
        content = await navigator.clipboard.readText()
      } catch {
        global.Portail?.showToast?.('Collez d\'abord la réponse IA (Ctrl+V), puis recliquez', { type: 'warn' })
        return
      }
      if (!content.trim()) {
        global.Portail?.showToast?.('Presse-papiers vide — copiez la réponse IA', { type: 'warn' })
        return
      }
      const extracted = extractDocQaBlock(content)
      if (!extracted.found) {
        const ok = global.confirm('Aucun bloc structuré détecté. Voulez-vous utiliser tout le texte collé ?')
        if (!ok) return
      }
      this.closePrompt()
      global.dispatchEvent(new CustomEvent('docQa:paste-block', {
        detail: {
          docId: this._meta.docId,
          chapterId: this._meta.chapterId,
          content: content.trim(),
          extracted: extracted.content,
        },
      }))
    },
  }

  global.WizardDocCopilot = WizardDocCopilot
})(typeof window !== 'undefined' ? window : globalThis)

/* Wizard k6 — une question par page (même UX que Prise de connaissance) + arborescence */
const K6WizardPage = {
  state: {
    sections: [],
    questions: [],
    answers: {},
    stepIndex: 0,
    profileId: null,
    profileName: '',
    profiles: [],
    configPath: '',
    tree: null,
    projectContext: null,
    wizardVisible: false,
    wizardMode: 'full',
    activeSolutionCode: '',
    activeSolutionLabel: '',
    activeFolderPath: '',
    runningCampaign: false,
  },

  $(id) {
    return document.getElementById(id)
  },

  escape(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  },

  apiUrl(path) {
    return typeof Portail !== 'undefined' && Portail.apiUrl ? Portail.apiUrl(path) : path
  },

  async apiGet(path) {
    const r = await fetch(this.apiUrl(path))
    const data = await r.json()
    if (!r.ok || data.ok === false) throw new Error(data.error || r.statusText)
    return data
  },

  async apiPost(path, body) {
    let r
    try {
      r = await fetch(this.apiUrl(path), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
      })
    } catch (err) {
      const msg = String(err?.message || err)
      throw new Error(msg === 'Failed to fetch'
        ? 'Connexion au serveur impossible. Rechargez la fenêtre VS Code (Developer: Reload Window).'
        : msg)
    }
    const data = await r.json()
    if (!r.ok || data.ok === false) throw new Error(data.error || r.statusText)
    return data
  },

  async apiDelete(path) {
    const r = await fetch(this.apiUrl(path), { method: 'DELETE' })
    const data = await r.json()
    if (!r.ok || data.ok === false) throw new Error(data.error || r.statusText)
    return data
  },

  showStatus(ok, msg) {
    const el = this.$('status')
    if (!el) return
    Portail.showStatus(el, ok, msg)
    el.style.display = 'block'
  },

  showStepError(msg) {
    const el = this.$('k6WizStepStatus')
    if (!el) return
    Portail.showStatus(el, false, msg)
    el.style.display = 'block'
  },

  hideStepError() {
    const el = this.$('k6WizStepStatus')
    if (el) el.style.display = 'none'
  },

  sectionTitle(sectionId) {
    return this.state.sections.find((s) => s.id === sectionId)?.title || sectionId
  },

  orderedSections() {
    return [...this.state.sections].sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
  },

  currentQuestion() {
    return this.state.questions[this.state.stepIndex] || null
  },

  defaultAnswer(q) {
    if (q.default != null && q.default !== '') return q.default
    if (q.type === 'multi') return []
    if (q.type === 'number') return q.min ?? 0
    return ''
  },

  initAnswersFromDefaults() {
    this.state.answers = {}
    for (const q of this.state.questions) {
      this.state.answers[q.id] = this.defaultAnswer(q)
    }
  },

  mergeProfileAnswers(profile) {
    this.initAnswersFromDefaults()
    if (profile?.answers) {
      for (const q of this.state.questions) {
        if (profile.answers[q.id] != null) {
          this.state.answers[q.id] = profile.answers[q.id]
        }
      }
    }
    this.state.profileId = profile?.id || null
    this.state.profileName = profile?.name || ''
    if (profile?.meta?.solutionCode) {
      this.state.activeSolutionCode = profile.meta.solutionCode
    }
  },

  renderSectionDotsForQuestion(q) {
    const secs = this.orderedSections()
    const currentSecIdx = secs.findIndex((s) => s.id === q.section)
    return secs.map((sec, i) => {
      const cls = i < currentSecIdx ? 'is-done' : i === currentSecIdx ? 'is-active' : ''
      return `<span class="hub-step-dot ${cls}" title="${this.escape(sec.title)}"></span>`
    }).join('')
  },

  renderProgressBar(stepIndex, total) {
    const current = stepIndex + 1
    const pct = total > 0 ? Math.round((current / total) * 100) : 0
    return `
      <div class="hub-progress-wrap stack-quiz-progress-wrap">
        <div class="hub-progress-label">
          <span>Progression</span>
          <span>Question ${current} / ${total} · ${pct}%</span>
        </div>
        <div class="hub-progress-track" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
          <div class="hub-progress-fill is-animating" style="width:${pct}%"></div>
        </div>
      </div>`
  },

  showStatus(ok, msg) {
    const el = this.$('status')
    if (!el) return
    Portail.showStatus(el, ok, msg)
    el.style.display = 'block'
  },

  showToast(msg, type = 'ok') {
    if (typeof Portail.showToast === 'function') {
      Portail.showToast(msg, { type })
    } else {
      this.showStatus(type === 'err' ? false : true, msg)
    }
  },

  guideInlineFormat(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/__(.+?)__/g, '<u>$1</u>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
  },

  renderGuideBlock(text) {
    const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean)
    if (!lines.length) return ''
    const bullets = lines.filter((l) => /^[•\-–]\s/.test(l))
    const prose = lines.filter((l) => !/^[•\-–]\s/.test(l))
    let html = ''
    for (const p of prose) {
      html += `<p>${this.guideInlineFormat(p)}</p>`
    }
    if (bullets.length) {
      html += `<ul class="k6-wizard-guide-list">${bullets.map((b) => {
        const item = b.replace(/^[•\-–]\s+/, '')
        return `<li>${this.guideInlineFormat(item)}</li>`
      }).join('')}</ul>`
    }
    return html
  },

  renderQuestionGuide(guide) {
    const blocks = Array.isArray(guide) ? guide : [String(guide || '')]
    const html = blocks.map((b) => this.renderGuideBlock(b)).join('')
    if (!html) return ''
    return `<div class="k6-wizard-guide" role="note">${html}</div>`
  },

  parseLinesValue(val) {
    const lines = String(val ?? '').split('\n').map((l) => l.trim())
    if (!lines.length || (lines.length === 1 && lines[0] === '')) return ['']
    return lines
  },

  linesToValue(rows) {
    return rows.map((r) => String(r).trim()).filter((r) => r !== '').join('\n')
  },

  renderLineListRow(qid, value, placeholder, canRemove) {
    return `
      <div class="k6-line-list-row">
        <input type="text" class="k6-wizard-input k6-line-list-input" data-line-input="${this.escape(qid)}" value="${this.escape(value)}" placeholder="${this.escape(placeholder)}" />
        ${canRemove ? `<button type="button" class="k6-line-list-remove" data-qid="${this.escape(qid)}" title="Supprimer cette ligne" aria-label="Supprimer">−</button>` : ''}
      </div>`
  },

  renderLineList(q) {
    const rows = this.parseLinesValue(this.state.answers[q.id])
    const placeholder = q.linePlaceholder || ''
    const addLabel = q.linesAddLabel || '+ Ajouter une ligne'
    return `
      <div class="k6-line-list" data-qid="${this.escape(q.id)}">
        <div class="k6-line-list-rows">
          ${rows.map((row) => this.renderLineListRow(q.id, row, placeholder, rows.length > 1)).join('')}
        </div>
        <button type="button" class="btn-secondary btn-sm k6-line-list-add" data-qid="${this.escape(q.id)}">${this.escape(addLabel)}</button>
      </div>`
  },

  bindLineList(root, q) {
    const qid = q.id
    const list = root.querySelector(`.k6-line-list[data-qid="${qid}"]`)
    if (!list) return

    const syncLines = () => {
      const inputs = list.querySelectorAll(`[data-line-input="${qid}"]`)
      this.state.answers[qid] = this.linesToValue([...inputs].map((i) => i.value))
      this.hideStepError()
    }

    const removeRow = (row) => {
      const rowsEl = list.querySelector('.k6-line-list-rows')
      row?.remove()
      if (!list.querySelectorAll(`[data-line-input="${qid}"]`).length && rowsEl) {
        rowsEl.insertAdjacentHTML('beforeend', this.renderLineListRow(qid, '', q.linePlaceholder || '', false))
      }
      this.refreshLineListRemoveButtons(list, qid)
      syncLines()
    }

    list.addEventListener('click', (e) => {
      const removeBtn = e.target.closest('.k6-line-list-remove')
      if (removeBtn?.dataset.qid === qid) {
        removeRow(removeBtn.closest('.k6-line-list-row'))
        return
      }
      const addBtn = e.target.closest('.k6-line-list-add')
      if (addBtn?.dataset.qid === qid) {
        syncLines()
        const rowsEl = list.querySelector('.k6-line-list-rows')
        const count = list.querySelectorAll(`[data-line-input="${qid}"]`).length
        rowsEl?.insertAdjacentHTML('beforeend', this.renderLineListRow(qid, '', q.linePlaceholder || '', count >= 1))
        this.refreshLineListRemoveButtons(list, qid)
        list.querySelector('.k6-line-list-row:last-child [data-line-input]')?.focus()
      }
    })

    list.addEventListener('input', (e) => {
      if (e.target.matches(`[data-line-input="${qid}"]`)) syncLines()
    })
  },

  refreshLineListRemoveButtons(list, qid) {
    const rows = list.querySelectorAll('.k6-line-list-row')
    const show = rows.length > 1
    rows.forEach((row) => {
      const btn = row.querySelector('.k6-line-list-remove')
      if (show && !btn) {
        row.insertAdjacentHTML('beforeend', `<button type="button" class="k6-line-list-remove" data-qid="${this.escape(qid)}" title="Supprimer cette ligne" aria-label="Supprimer">−</button>`)
      } else if (!show && btn) {
        btn.remove()
      }
    })
  },

  renderQuestionInput(q) {
    const val = this.state.answers[q.id]
    if (q.type === 'single' && q.options?.length) {
      return `<div class="stack-quiz-options k6-wizard-options" role="radiogroup" aria-label="${this.escape(q.question)}">${q.options.map((opt) => {
        const sel = val === opt.id ? ' is-selected' : ''
        return `<button type="button" class="stack-quiz-option${sel}" data-qid="${this.escape(q.id)}" data-oid="${this.escape(opt.id)}" data-type="single">
          <span class="stack-quiz-option-radio" aria-hidden="true"></span>
          <span class="stack-quiz-option-label">${this.escape(opt.label)}</span>
        </button>`
      }).join('')}</div>`
    }
    if (q.type === 'multi' && q.options?.length) {
      const selected = Array.isArray(val) ? val : []
      return `<div class="stack-quiz-options stack-quiz-options--multi k6-wizard-options">${q.options.map((opt) => {
        const sel = selected.includes(opt.id) ? ' is-selected' : ''
        return `<button type="button" class="stack-quiz-option${sel}" data-qid="${this.escape(q.id)}" data-oid="${this.escape(opt.id)}" data-type="multi">
          <span class="stack-quiz-option-check" aria-hidden="true">✓</span>
          <span class="stack-quiz-option-label">${this.escape(opt.label)}</span>
        </button>`
      }).join('')}</div>`
    }
    if (q.type === 'lines') {
      return `
        <div class="hub-field full k6-line-list-field">
          <label>${this.escape(q.title)}${q.required ? ' <span class="k6-wizard-req">*</span>' : ''}</label>
          ${this.renderLineList(q)}
        </div>`
    }
    if (q.type === 'textarea') {
      return `
        <div class="hub-field full">
          <label for="k6Field_${q.id}">${this.escape(q.title)}</label>
          <textarea id="k6Field_${q.id}" class="k6-wizard-textarea" rows="4">${this.escape(val)}</textarea>
        </div>`
    }
    const inputType = q.type === 'number' ? 'number' : q.type === 'url' ? 'url' : 'text'
    const extra = q.type === 'number' && q.min != null ? ` min="${q.min}"` : ''
    const extraMax = q.type === 'number' && q.max != null ? ` max="${q.max}"` : ''
    return `
      <div class="hub-field full">
        <label for="k6Field_${q.id}">${this.escape(q.title)}${q.required ? ' <span class="k6-wizard-req">*</span>' : ''}</label>
        <input id="k6Field_${q.id}" type="${inputType}" class="k6-wizard-input" value="${this.escape(val)}"${extra}${extraMax} />
      </div>`
  },

  bindQuestionInputs(root, q) {
    root.querySelectorAll('.stack-quiz-option').forEach((btn) => {
      btn.addEventListener('click', () => {
        const qid = btn.dataset.qid
        const oid = btn.dataset.oid
        if (btn.dataset.type === 'multi') {
          let arr = Array.isArray(this.state.answers[qid]) ? [...this.state.answers[qid]] : []
          if (arr.includes(oid)) arr = arr.filter((x) => x !== oid)
          else arr.push(oid)
          this.state.answers[qid] = arr
          root.querySelectorAll(`[data-qid="${qid}"].stack-quiz-option`).forEach((b) => {
            b.classList.toggle('is-selected', arr.includes(b.dataset.oid))
          })
        } else {
          this.state.answers[qid] = oid
          root.querySelectorAll(`[data-qid="${qid}"].stack-quiz-option`).forEach((b) => b.classList.remove('is-selected'))
          btn.classList.add('is-selected')
        }
        this.hideStepError()
      })
    })
    if (q.type === 'lines') {
      this.bindLineList(root, q)
      return
    }
    const field = root.querySelector(`#k6Field_${q.id}`)
    if (field) {
      const sync = () => {
        if (q.type === 'number') this.state.answers[q.id] = Number(field.value)
        else this.state.answers[q.id] = field.value
        this.hideStepError()
      }
      field.addEventListener('input', sync)
      field.addEventListener('change', sync)
    }
  },

  syncCurrentFieldFromDom() {
    const q = this.currentQuestion()
    if (!q) return
    if (q.type === 'lines') {
      const inputs = document.querySelectorAll(`[data-line-input="${q.id}"]`)
      if (inputs.length) {
        this.state.answers[q.id] = this.linesToValue([...inputs].map((i) => i.value))
      }
      return
    }
    const field = document.getElementById(`k6Field_${q.id}`)
    if (!field) return
    if (q.type === 'number') this.state.answers[q.id] = Number(field.value)
    else this.state.answers[q.id] = field.value
  },

  applyProjectContextToWizard(ctx = {}) {
    if (!ctx) return
    if (ctx.solutionCode) {
      this.state.activeSolutionCode = this.state.activeSolutionCode || ctx.solutionCode
      this.state.answers.solutionCode = ctx.solutionCode
    }
    if (ctx.applicationLabel) {
      this.state.activeSolutionLabel = this.state.activeSolutionLabel || ctx.applicationLabel
      this.state.answers.applicationLabel = ctx.applicationLabel
    }
    if (ctx.gitRepository) {
      this.state.activeFolderPath = this.state.activeFolderPath || ctx.gitRepository
      this.state.answers.folderPath = ctx.gitRepository
    }
    if (ctx.productCode) this.state.answers.productCode = ctx.productCode
    if (ctx.tribu) this.state.answers.tribu = ctx.tribu
  },

  validateCurrentQuestion() {
    const q = this.currentQuestion()
    if (!q?.required) return true
    const v = this.state.answers[q.id]
    if (q.type === 'multi') return Array.isArray(v) && v.length > 0
    if (q.type === 'lines') {
      const lines = String(v ?? '').split('\n').map((l) => l.trim()).filter(Boolean)
      return lines.length > 0
    }
    if (v == null || v === '') return false
    return true
  },

  updateOnboardingHero() {
    const title = this.$('k6OnboardingHeroTitle')
    const lead = this.$('k6OnboardingHeroLead')
    if (!title || !lead) return
    title.textContent = 'Assistant de configuration de campagne K6'
    const mode = this.state.wizardMode === 'incremental'
      ? 'Mise à jour incrémentale'
      : (this.state.profileId ? 'Modification de campagne' : 'Nouvelle campagne')
    const sol = this.state.activeSolutionCode ? ` · ${this.state.activeSolutionCode}` : ''
    lead.textContent = `${mode}${sol} — une question par étape.`
  },

  showWizardFlow() {
    document.body.classList.add('page-k6-wizard--flow')
    const hub = this.$('k6HubView')
    const flow = this.$('k6OnboardingView')
    if (hub) hub.hidden = true
    if (flow) flow.hidden = false
    this.updateOnboardingHero()
    this.state.wizardVisible = true
  },

  showHubView() {
    document.body.classList.remove('page-k6-wizard--flow')
    const hub = this.$('k6HubView')
    const flow = this.$('k6OnboardingView')
    if (hub) hub.hidden = false
    if (flow) flow.hidden = true
    this.state.wizardVisible = false
    const steps = this.$('k6WizardSteps')
    if (steps) steps.innerHTML = ''
    if (this.state.tree) this.renderCampaignTree()
    this.updateHubContextBanner()
  },

  updateHubContextBanner() {
    const ctx = this.state.projectContext
    const banner = this.$('k6ProjectContextBanner')
    const line = this.$('k6ProjectContextLine')
    const demoWarn = this.$('k6DemoDataWarn')
    if (!line) return
    if (banner) banner.hidden = false
    if (!ctx?.onboardingComplete) {
      line.innerHTML = '<span class="k6-context-pill k6-context-pill--warn">Profil incomplet</span> Complétez la <a href="/">Prise de connaissance</a>.'
      if (demoWarn) demoWarn.hidden = true
      return
    }
    const pills = []
    if (ctx.tribu) pills.push(`<span class="k6-context-pill"><span class="k6-context-pill__key">Tribu</span>${this.escape(ctx.tribu)}</span>`)
    if (ctx.productCode) pills.push(`<span class="k6-context-pill"><span class="k6-context-pill__key">Produit</span>${this.escape(ctx.productCode)}</span>`)
    if (ctx.solutionCode) pills.push(`<span class="k6-context-pill k6-context-pill--accent"><span class="k6-context-pill__key">Solution</span>${this.escape(ctx.solutionCode)}</span>`)
    if (ctx.applicationLabel) pills.push(`<span class="k6-context-pill k6-context-pill--app"><span class="k6-context-pill__key">Application</span>${this.escape(ctx.applicationLabel)}</span>`)
    line.innerHTML = pills.length
      ? `<div class="k6-context-pills">${pills.join('')}</div>`
      : 'Aucune information projet — renseignez le profil depuis l\'<a href="/">accueil</a>.'
    if (demoWarn) demoWarn.hidden = !ctx.isDemoLabel
  },

  renderQuestionStep() {
    const root = this.$('k6WizardSteps')
    const q = this.currentQuestion()
    if (!q) {
      this.renderSummary()
      return
    }

    const total = this.state.questions.length
    const nextLabel = this.state.stepIndex === total - 1 ? 'Terminer — récapitulatif' : 'Continuer'

    root.innerHTML = `
      <div class="card card-compact hub-onboarding-card">
        ${this.renderProgressBar(this.state.stepIndex, total)}
        <div class="hub-onboarding-steps">${this.renderSectionDotsForQuestion(q)}</div>
        <h2 class="hub-onboarding-title">${this.escape(this.sectionTitle(q.section))}</h2>
        <p class="hint hint-tight k6-wizard-page-tag">Question ${this.state.stepIndex + 1} sur ${total}</p>
        <p class="hub-onboarding-lead hub-onboarding-lead-center">${this.escape(q.question)}</p>
        ${q.guide?.length ? this.renderQuestionGuide(q.guide) : ''}
        ${q.hint ? `<p class="hint hint-tight hub-onboarding-hint-center">${this.escape(q.hint)}</p>` : ''}
        ${this.renderQuestionInput(q)}
        <div id="k6WizStepStatus" class="status wizard-unified-status" style="display:none;margin-top:12px"></div>
        <div class="hub-onboarding-actions">
          <button type="button" class="btn-secondary btn-sm" id="k6WizPrev" ${this.state.stepIndex === 0 ? 'disabled' : ''}>Retour</button>
          <button type="button" class="btn-primary btn-sm k6-wizard-btn-primary" id="k6WizNext">${nextLabel}</button>
        </div>
      </div>`

    this.bindQuestionInputs(root, q)

    root.querySelector('#k6WizPrev')?.addEventListener('click', () => {
      this.syncCurrentFieldFromDom()
      if (this.state.stepIndex > 0) {
        this.state.stepIndex -= 1
        this.renderQuestionStep()
      }
    })

    root.querySelector('#k6WizNext')?.addEventListener('click', () => {
      this.syncCurrentFieldFromDom()
      if (!this.validateCurrentQuestion()) {
        this.showStepError(q.type === 'multi' || q.type === 'single'
          ? 'Choisissez une réponse pour continuer.'
          : 'Ce champ est obligatoire.')
        return
      }
      if (this.state.stepIndex < total - 1) {
        this.state.stepIndex += 1
        this.renderQuestionStep()
      } else {
        this.renderSummary()
      }
    })
  },

  renderSummary() {
    const root = this.$('k6WizardSteps')
    const a = this.state.answers
    const rows = [
      ['Solution', this.state.activeSolutionCode || a.solutionCode],
      ['Campagne', a.campaignName],
      ['Objectif', a.campaignObjective],
      ['Environnement', a.environment],
      ['URL', a.baseUrl],
      ['VUs', a.virtualUsers],
      ['Durée', a.duration],
      ['p95 (ms)', a.p95Ms],
    ]
    root.innerHTML = `
      <div class="card card-compact hub-onboarding-card k6-wizard-summary">
        <h2 class="hub-onboarding-title">Récapitulatif de la campagne</h2>
        <p class="hub-onboarding-lead">${this.state.questions.length} réponses · <code>${this.escape(this.state.configPath)}</code></p>
        <table class="wiki-table k6-summary-table">
          <tbody>${rows.map(([k, v]) => `<tr><th>${this.escape(k)}</th><td>${this.escape(v)}</td></tr>`).join('')}</tbody>
        </table>
        <div class="hub-field full">
          <label for="k6SummaryProfileName">Nom du profil</label>
          <input type="text" id="k6SummaryProfileName" value="${this.escape(this.state.profileName || a.campaignName || 'Campagne k6')}" />
        </div>
        <div class="hub-onboarding-actions">
          <button type="button" class="btn-secondary btn-sm" id="k6WizEdit">Modifier les réponses</button>
          <button type="button" class="btn-secondary btn-sm" id="k6WizSaveOnly">Enregistrer</button>
          <button type="button" class="btn-primary btn-sm k6-wizard-btn-primary" id="k6WizSaveApply">Enregistrer & appliquer</button>
        </div>
      </div>`
    root.querySelector('#k6WizEdit')?.addEventListener('click', () => {
      this.state.stepIndex = 0
      this.renderQuestionStep()
    })
    root.querySelector('#k6WizSaveOnly')?.addEventListener('click', () => { void this.saveProfileOnly() })
    root.querySelector('#k6WizSaveApply')?.addEventListener('click', () => { void this.saveAndApply() })
  },

  async closeWizard() {
    this.showHubView()
    try {
      await this.loadProjectContext()
      await this.loadCampaignTree()
      this.updateHubContextBanner()
    } catch (err) {
      this.showStatus(false, err.message)
    }
  },

  openWizard({ mode = 'full', solutionCode = '', solutionLabel = '', folderPath = '', profileId = null } = {}) {
    if (mode === 'full' && !profileId) {
      this.state.profileId = null
      this.state.profileName = ''
    }
    this.state.wizardMode = mode
    this.state.activeSolutionCode = solutionCode
    this.state.activeSolutionLabel = solutionLabel
    this.state.activeFolderPath = folderPath
    this.state.stepIndex = 0
    this.showWizardFlow()

    const start = () => {
      this.renderQuestionStep()
      this.$('k6OnboardingView')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }

    if (profileId) {
      void this.loadProfile(profileId).then(start)
      return
    }

    if (mode === 'full') {
      this.state.profileId = null
      this.state.profileName = ''
      this.initAnswersFromDefaults()
      if (solutionCode) {
        this.state.answers.solutionCode = solutionCode
        this.state.answers.applicationLabel = solutionLabel
        this.state.answers.folderPath = folderPath
      } else {
        this.applyProjectContextToWizard(this.state.projectContext)
      }
    }
    start()
  },

  async saveProfile() {
    const name = this.$('k6SummaryProfileName')?.value
      || this.state.profileName
      || this.state.answers.campaignName
      || 'Campagne k6'
    const ctx = this.state.projectContext || {}
    const meta = {
      tribu: ctx.tribu || '',
      productCode: ctx.productCode || '',
      solutionCode: this.state.activeSolutionCode || this.state.answers.solutionCode || ctx.solutionCode || '',
      applicationLabel: this.state.activeSolutionLabel || this.state.answers.applicationLabel || ctx.applicationLabel || '',
      folderPath: this.state.activeFolderPath || this.state.answers.folderPath || ctx.gitRepository || '',
    }
    const data = await this.apiPost('/api/k6/profiles', {
      id: this.state.profileId || undefined,
      name,
      answers: this.state.answers,
      meta,
      incremental: this.state.wizardMode === 'incremental' && Boolean(this.state.profileId),
    })
    this.state.profileId = data.profile.id
    this.state.profileName = data.profile.name
    await this.loadProfiles()
    await this.loadCampaignTree()
    return data.profile
  },

  async saveProfileOnly() {
    try {
      await this.saveProfile()
      this.showStatus(true, 'Campagne enregistrée dans l\'arborescence.')
      await this.closeWizard()
    } catch (err) {
      this.showStatus(false, err.message)
    }
  },

  async saveAndApply() {
    try {
      const profile = await this.saveProfile()
      const applied = await this.apiPost(`/api/k6/profiles/${profile.id}/apply`, {})
      await this.apiPost('/api/k6/history', {
        profileId: profile.id,
        profileName: profile.name,
        campaignName: this.state.answers.campaignName,
        environment: this.state.answers.environment,
        objective: this.state.answers.campaignObjective,
        status: 'configured',
        command: 'apply-profile',
        notes: applied.message || 'Profil appliqué',
        summary: {
          vus: this.state.answers.virtualUsers,
          duration: this.state.answers.duration,
          p95Ms: this.state.answers.p95Ms,
          solutionCode: this.state.activeSolutionCode,
        },
      })
      await this.loadCampaignTree()
      this.showStatus(true, applied.message || 'Campagne enregistrée et appliquée.')
      await this.closeWizard()
    } catch (err) {
      this.showStatus(false, err.message)
    }
  },

  formatDate(iso) {
    if (!iso) return '—'
    return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
  },

  formatDurationLabel(ms) {
    if (!ms || !Number.isFinite(ms)) return '—'
    if (ms < 1000) return `${ms} ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`
    const m = Math.floor(ms / 60000)
    const s = Math.round((ms % 60000) / 1000)
    return `${m} min ${s} s`
  },

  renderCampaignRow(c) {
    const pathDisplay = c.folderPath || c.baseUrl || '—'
    const srcType = (c.sourceType || 'FOLDER').toUpperCase()
    return `
      <article class="k6-campaign-row" data-profile="${this.escape(c.id)}">
        <div class="k6-campaign-row__body">
          <div class="k6-campaign-row__line1">
            <span class="k6-campaign-row__code">${this.escape(c.solutionCode || '—')}</span>
            <button type="button" class="k6-campaign-row__title k6-tree-campaign-link" data-profile="${this.escape(c.id)}">${this.escape(c.name)}</button>
            ${c.campaignObjective ? `<span class="k6-campaign-row__objective">${this.escape(c.campaignObjective)}</span>` : ''}
            <span class="k6-campaign-row__source">${this.escape(srcType)}</span>
            <span class="k6-campaign-row__runs">${c.runCount || 0} exécution(s)</span>
          </div>
          <div class="k6-campaign-row__line2">
            <span class="k6-campaign-row__path" title="${this.escape(pathDisplay)}">${this.escape(pathDisplay)}</span>
            <span class="k6-campaign-row__meta">Dernière exécution : ${this.escape(this.formatDate(c.lastRunAt))}</span>
            <span class="k6-campaign-row__meta">Durée moyenne : ${this.escape(c.avgDurationLabel || this.formatDurationLabel(c.avgDurationMs))}</span>
          </div>
        </div>
        <div class="k6-campaign-row__actions">
          <button type="button" class="k6-campaign-row__delete" data-profile="${this.escape(c.id)}" title="Supprimer cette campagne" aria-label="Supprimer la campagne">×</button>
          <div class="k6-campaign-row__confirm" hidden>
            <span class="k6-campaign-row__confirm-label">Supprimer ?</span>
            <button type="button" class="k6-campaign-row__confirm-yes" data-profile="${this.escape(c.id)}">Oui</button>
            <button type="button" class="k6-campaign-row__confirm-no">Non</button>
          </div>
          <div class="k6-campaign-row__run-actions">
            <button type="button" class="k6-tree-btn-mini k6-tree-edit" data-profile="${this.escape(c.id)}" title="Modifier la campagne">Modifier</button>
            <button type="button" class="k6-tree-btn-mini k6-tree-complet" data-profile="${this.escape(c.id)}" data-code="${this.escape(c.solutionCode || '')}" data-label="${this.escape(c.name)}">Complet</button>
            <button type="button" class="k6-tree-btn-mini k6-tree-incremental" data-profile="${this.escape(c.id)}" data-code="${this.escape(c.solutionCode || '')}" data-label="${this.escape(c.name)}">Incrémental</button>
            <button type="button" class="k6-tree-btn-mini k6-tree-folder">Dossier</button>
          </div>
        </div>
      </article>`
  },

  renderCampaignTree() {
    const wrap = this.$('k6CampaignTree')
    if (!wrap || !this.state.tree?.tribu) return
    const tribu = this.state.tree.tribu
    const products = tribu.products || []
    const totalCampaigns = products.reduce((n, p) => n + (p.campaigns || []).length, 0)
      || (this.state.profiles || []).length
    const titleEl = this.$('k6CampaignTreeTitle')
    if (titleEl) {
      titleEl.textContent = totalCampaigns
        ? `Campagnes k6 enregistrées (${totalCampaigns})`
        : 'Campagnes k6 enregistrées'
    }

    if (!products.length) {
      const onboardingHint = this.state.tree.onboardingComplete
        ? 'Créez une campagne avec le bouton ci-dessus.'
        : 'Complétez d\'abord la <a href="/">Prise de connaissance</a> (tribu, produit, solution, application).'
      wrap.innerHTML = `
        <p class="hint hint-tight k6-tree-empty">Aucune campagne k6 enregistrée. ${onboardingHint}</p>
        <p class="hint hint-tight k6-tree-hint">Profils : <code>${this.escape(this.state.tree.profilesDir || '')}</code></p>`
      return
    }

    let html = `
      <div class="k6-tree-panel">
        <div class="k6-tree-toolbar">
          <button type="button" class="btn-secondary btn-sm k6-tree-btn-ghost" id="k6TreeExport">Exporter profils</button>
          <label class="btn-secondary btn-sm file-btn k6-tree-btn-ghost">Importer<input type="file" id="k6TreeImport" accept=".json" hidden></label>
        </div>
        <div class="k6-tree-branch">`

    for (const product of products) {
      const campaigns = product.campaigns || []
      html += `
          <div class="k6-tree-level k6-tree-level--tribu">
            <span class="k6-tree-level-chevron" aria-hidden="true">▾</span>
            <span class="k6-tree-level-label">${this.escape(tribu.label)}</span>
          </div>
          <div class="k6-tree-level k6-tree-level--product">
            <span class="k6-tree-level-chevron" aria-hidden="true">▾</span>
            <span class="k6-tree-level-code">${this.escape(product.productCode)}</span>
            <span class="k6-tree-level-sep">—</span>
            <span class="k6-tree-level-label">${this.escape(product.label)}</span>
            <span class="k6-tree-level-meta">(${campaigns.length} campagne${campaigns.length > 1 ? 's' : ''})</span>
          </div>
          <div class="k6-campaign-rows">`

      for (const c of campaigns) {
        html += this.renderCampaignRow(c)
      }

      html += `</div>`
    }

    html += `
        </div>
        <p class="hint hint-tight k6-tree-hint">Profils : <code>${this.escape(this.state.tree.profilesDir || '')}</code></p>
      </div>`
    wrap.innerHTML = html

    wrap.querySelector('#k6TreeExport')?.addEventListener('click', async () => {
      try {
        const data = await this.apiGet('/api/k6/profiles/all/export')
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `k6-profiles-${Date.now()}.json`
        a.click()
      } catch (err) {
        this.showStatus(false, err.message)
      }
    })
    wrap.querySelector('#k6TreeImport')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0]
      if (!file) return
      try {
        const bundle = JSON.parse(await file.text())
        await this.apiPost('/api/k6/profiles/import', { bundle, merge: true })
        await this.loadProfiles()
        await this.loadCampaignTree()
        this.showStatus(true, 'Profils importés.')
      } catch (err) {
        this.showStatus(false, err.message)
      }
      e.target.value = ''
    })
  },

  clearDeleteConfirm(exceptRow = null) {
    document.querySelectorAll('.k6-campaign-row.is-confirming-delete').forEach((row) => {
      if (row === exceptRow) return
      this.hideDeleteConfirm(row)
    })
  },

  showDeleteConfirm(row) {
    if (!row) return
    this.clearDeleteConfirm(row)
    row.classList.add('is-confirming-delete')
    row.querySelector('.k6-campaign-row__delete')?.setAttribute('hidden', '')
    const confirm = row.querySelector('.k6-campaign-row__confirm')
    if (confirm) confirm.hidden = false
    row.querySelector('.k6-campaign-row__run-actions')?.setAttribute('hidden', '')
  },

  hideDeleteConfirm(row) {
    if (!row) return
    row.classList.remove('is-confirming-delete', 'is-deleting')
    const deleteBtn = row.querySelector('.k6-campaign-row__delete')
    if (deleteBtn) {
      deleteBtn.removeAttribute('hidden')
      deleteBtn.disabled = false
    }
    const confirm = row.querySelector('.k6-campaign-row__confirm')
    if (confirm) confirm.hidden = true
    row.querySelector('.k6-campaign-row__run-actions')?.removeAttribute('hidden')
  },

  async confirmDeleteCampaign(profileId, row) {
    if (!profileId) {
      this.showToast('Identifiant de campagne introuvable.', 'err')
      return
    }
    if (!row) return
    row.classList.add('is-deleting')
    const yesBtn = row.querySelector('.k6-campaign-row__confirm-yes')
    const noBtn = row.querySelector('.k6-campaign-row__confirm-no')
    if (yesBtn) yesBtn.disabled = true
    if (noBtn) noBtn.disabled = true

    const camp = (this.state.profiles || []).find((p) => p.id === profileId)
    const label = camp?.name || 'campagne'
    try {
      const data = await this.apiPost(`/api/k6/profiles/${encodeURIComponent(profileId)}/delete`, {})
      this.state.profiles = (this.state.profiles || []).filter((p) => p.id !== profileId)
      row.remove()
      await this.loadCampaignTree()
      const fileHint = data.profileFile ? ` (${data.profileFile})` : ''
      this.showToast(`Campagne « ${label} » supprimée${fileHint}.`)
    } catch (err) {
      this.hideDeleteConfirm(row)
      this.showToast(err.message || 'Suppression impossible.', 'err')
    }
  },

  bindCampaignTreeDelegation() {
    const wrap = this.$('k6CampaignTree')
    if (!wrap || wrap.dataset.k6TreeDelegated === '1') return
    wrap.dataset.k6TreeDelegated = '1'
    wrap.addEventListener('click', (e) => {
      const deleteBtn = e.target.closest('.k6-campaign-row__delete')
      if (deleteBtn && !deleteBtn.hidden) {
        e.preventDefault()
        e.stopPropagation()
        this.showDeleteConfirm(deleteBtn.closest('.k6-campaign-row'))
        return
      }
      const confirmYes = e.target.closest('.k6-campaign-row__confirm-yes')
      if (confirmYes) {
        e.preventDefault()
        e.stopPropagation()
        const row = confirmYes.closest('.k6-campaign-row')
        const profileId = confirmYes.dataset.profile || row?.dataset.profile
        void this.confirmDeleteCampaign(profileId, row)
        return
      }
      const confirmNo = e.target.closest('.k6-campaign-row__confirm-no')
      if (confirmNo) {
        e.preventDefault()
        e.stopPropagation()
        this.hideDeleteConfirm(confirmNo.closest('.k6-campaign-row'))
        return
      }
      const editBtn = e.target.closest('.k6-tree-edit')
      if (editBtn) {
        e.preventDefault()
        e.stopPropagation()
        this.openWizard({ mode: 'full', profileId: editBtn.dataset.profile })
        return
      }
      const completBtn = e.target.closest('.k6-tree-complet')
      if (completBtn) {
        e.preventDefault()
        e.stopPropagation()
        void this.runCampaignFromTree(completBtn.dataset.profile, 'full', completBtn.dataset.label)
        return
      }
      const incrBtn = e.target.closest('.k6-tree-incremental')
      if (incrBtn) {
        e.preventDefault()
        e.stopPropagation()
        void this.runCampaignFromTree(incrBtn.dataset.profile, 'incremental', incrBtn.dataset.label)
        return
      }
      const folderBtn = e.target.closest('.k6-tree-folder')
      if (folderBtn) {
        e.preventDefault()
        e.stopPropagation()
        void this.openProjectRoot()
        return
      }
      const titleBtn = e.target.closest('.k6-tree-campaign-link, .k6-campaign-row__title')
      if (titleBtn) {
        e.preventDefault()
        e.stopPropagation()
        this.openWizard({ mode: 'incremental', profileId: titleBtn.dataset.profile })
      }
    })
  },

  spinnerHtml() {
    const src = this.apiUrl('/assets/logo-k6.png')
    return `<div class="hub-loading-spinner hub-loading-spinner--sm stack-wizard-spinner k6-run-spinner" role="status" aria-label="Exécution k6">
      <div class="hub-loading-spinner-ring stack-wizard-spinner-ring" aria-hidden="true"></div>
      <img class="hub-loading-spinner-logo" src="${src}" alt="" width="28" height="28" />
    </div>`
  },

  showRunPanel({ title, lead, steps, activeIndex = 0 }) {
    const panel = this.$('k6RunPanel')
    if (!panel) return
    panel.hidden = false
    const stepsHtml = steps.map((s, i) => {
      const cls = i < activeIndex ? 'is-done' : i === activeIndex ? 'is-active' : ''
      return `<li class="${cls}">${this.escape(s)}</li>`
    }).join('')
    panel.innerHTML = `
      <div class="k6-run-panel-inner stack-install-wizard stack-wizard--k6 is-running">
        <div class="stack-wizard-progress" aria-hidden="true"><div class="stack-wizard-progress-fill" style="width:${Math.round(((activeIndex + 1) / steps.length) * 100)}%"></div></div>
        ${this.spinnerHtml()}
        <h3 class="k6-run-panel-title">${this.escape(title)}</h3>
        <p class="hint hint-tight k6-run-panel-lead">${this.escape(lead)}</p>
        <ul class="hub-loading-steps stack-wizard-steps k6-run-steps">${stepsHtml}</ul>
        <pre class="npmrc-install-log stack-wizard-log k6-run-log" id="k6RunLog" aria-live="polite"></pre>
        <div class="k6-run-panel-actions">
          <button type="button" class="btn-secondary btn-sm" id="k6RunClose" hidden>Fermer</button>
        </div>
      </div>`
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    return panel
  },

  appendRunLog(text) {
    const log = this.$('k6RunLog')
    if (!log || !text) return
    log.textContent += text.endsWith('\n') ? text : `${text}\n`
    log.scrollTop = log.scrollHeight
  },

  async runCampaignFromTree(profileId, mode, label = '') {
    if (!profileId || this.state.runningCampaign) return
    this.state.runningCampaign = true
    const modeLabel = mode === 'incremental' ? 'Incrémental (smoke 30s)' : 'Complet'
    const steps = ['Application du profil', 'Génération du script k6', `Exécution k6 — ${modeLabel}`, 'Récapitulatif']
    const panel = this.showRunPanel({
      title: `Campagne k6 — ${label || profileId}`,
      lead: mode === 'incremental'
        ? 'Smoke rapide : application du profil puis exécution courte (30 s).'
        : 'Application du profil puis exécution avec les paramètres enregistrés.',
      steps,
      activeIndex: 0,
    })

    const setStep = (idx) => {
      panel.querySelectorAll('.k6-run-steps li').forEach((li, i) => {
        li.classList.toggle('is-done', i < idx)
        li.classList.toggle('is-active', i === idx)
        li.classList.remove('is-error')
      })
      const fill = panel.querySelector('.stack-wizard-progress-fill')
      if (fill) fill.style.width = `${Math.round(((idx + 1) / steps.length) * 100)}%`
    }

    try {
      setStep(1)
      this.appendRunLog('▶ Préparation du profil et du script…\n')
      setStep(2)
      const data = await this.apiPost(`/api/k6/profiles/${profileId}/run`, { mode })
      if (data.command) this.appendRunLog(`${data.command}\n${'—'.repeat(48)}\n`)
      this.appendRunLog(data.output || data.error || '')
      setStep(3)
      await this.loadCampaignTree()
      const closeBtn = this.$('k6RunClose')
      if (closeBtn) {
        closeBtn.hidden = false
        closeBtn.onclick = () => {
          const p = this.$('k6RunPanel')
          if (p) p.hidden = true
        }
      }
      if (data.ok) {
        panel.querySelector('.k6-run-panel-inner')?.classList.add('is-success')
        panel.querySelector('.k6-run-panel-inner')?.classList.remove('is-running')
        this.showToast(data.message || 'Campagne k6 terminée.')
      } else {
        panel.querySelector('.k6-run-panel-inner')?.classList.add('is-error')
        this.showToast(data.message || 'Campagne k6 échouée.', 'err')
      }
    } catch (err) {
      setStep(2)
      panel.querySelector('.k6-run-steps li.is-active')?.classList.add('is-error')
      panel.querySelector('.k6-run-panel-inner')?.classList.add('is-error')
      this.appendRunLog(`\n[ERR] ${err.message}\n`)
      this.showToast(err.message, 'err')
      const closeBtn = this.$('k6RunClose')
      if (closeBtn) closeBtn.hidden = false
    } finally {
      this.state.runningCampaign = false
    }
  },

  async openProjectRoot() {
    try {
      await this.apiPost('/api/wizard/open-folder', { target: 'repo' })
      this.showToast('Racine du projet ouverte dans l’explorateur.')
    } catch (err) {
      this.showToast(err.message, 'err')
    }
  },

  async openFolder(folderPath) {
    if (!folderPath) {
      this.showStatus(false, 'Chemin de dossier non renseigné.')
      return
    }
    try {
      await this.apiPost('/api/wizard/open-folder', { path: folderPath })
      this.showStatus(true, 'Dossier ouvert dans l\'explorateur.')
    } catch (err) {
      this.showStatus(false, err.message)
    }
  },

  async loadQuestionnaire() {
    const data = await this.apiGet('/api/k6/perf/questionnaire')
    this.state.sections = data.sections || []
    this.state.questions = data.questions || []
    this.state.configPath = data.questionnaireConfigPath || ''
    if (!this.state.questions.length) throw new Error('Questionnaire k6 vide')
    const badge = this.$('k6WizardBadge')
    if (badge) badge.textContent = `${this.state.questions.length} questions · ${this.orderedSections().length} sections`
  },

  async loadProfiles() {
    const data = await this.apiGet('/api/k6/profiles')
    this.state.profiles = data.profiles || []
  },

  async loadProfile(id) {
    if (!id) {
      this.state.profileId = null
      this.state.profileName = ''
      this.initAnswersFromDefaults()
      this.state.stepIndex = 0
      return
    }
    const data = await this.apiGet(`/api/k6/profiles/${id}`)
    this.mergeProfileAnswers(data.profile)
    if (data.profile?.meta) {
      this.state.activeSolutionCode = data.profile.meta.solutionCode || ''
      this.state.activeFolderPath = data.profile.meta.folderPath || ''
    }
    this.state.stepIndex = 0
  },

  async loadProjectContext() {
    const data = await this.apiGet('/api/k6/onboarding-context')
    this.state.projectContext = data.context || null
  },

  async loadCampaignTree() {
    const data = await this.apiGet('/api/k6/campaign-tree')
    this.state.tree = data.tree || data
    this.renderCampaignTree()
  },

  async checkInstallRedirect() {
    const runtime = await this.apiGet('/api/k6/runtime/check')
    if (!runtime.installed && !runtime.scaffoldReady) {
      window.location.href = this.apiUrl('/k6-install.html')
      return false
    }
    return true
  },

  bindGlobalNav() {
    const bind = (id, handler) => {
      const el = this.$(id)
      if (!el || el.dataset.k6Bound === '1') return
      el.dataset.k6Bound = '1'
      el.addEventListener('click', handler)
    }
    bind('k6TreeNew', () => this.openWizard({ mode: 'full' }))
    bind('k6ObCancel', () => this.closeWizard())
    bind('k6ObHub', () => this.closeWizard())
  },

  async init() {
    this.bindGlobalNav()
    this.bindCampaignTreeDelegation()
    try {
      if (!(await this.checkInstallRedirect())) return
      await this.loadProjectContext()
      await this.loadQuestionnaire()
      this.initAnswersFromDefaults()
      await this.loadProfiles()
      await this.loadCampaignTree()
      this.updateHubContextBanner()
      this.showHubView()
      Portail.init('k6Wizard', null, null, () => ({ page: 'k6Wizard' }))
    } catch (err) {
      const wrap = this.$('k6CampaignTree')
      if (wrap) wrap.innerHTML = `<p class="hint">${this.escape(err.message)}</p>`
      this.showStatus(false, err.message)
    }
  },
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => K6WizardPage.init())
} else {
  K6WizardPage.init()
}
if (!window.__k6WizardSoftNavHook) {
  window.__k6WizardSoftNavHook = true
  window.addEventListener('wizard:page-ready', (e) => {
    if (String(e.detail?.path || '') === '/k6-wizard.html') K6WizardPage.init()
  })
}

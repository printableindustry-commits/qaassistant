/* Wizard k6 — une question par page (même UX que Prise de connaissance) + arborescence */
var K6WizardPage = {
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
    lead.textContent = `${mode}${sol} — tout sur une page : choisissez un type de test, ajustez, enregistrez.`
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
      line.innerHTML = '<span class="k6-context-pill k6-context-pill--warn">Profil incomplet</span> Complétez la <a href="/projet.html">Prise de connaissance</a>.'
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
      : 'Aucune information projet — renseignez le profil depuis la page <a href="/projet.html">Mon projet</a>.'
    if (demoWarn) demoWarn.hidden = !ctx.isDemoLabel
  },

  PRESETS: [
    { id: 'smoke', label: 'Smoke', hint: 'Vérif rapide, faible charge', a: { executorType: 'constant-vus', virtualUsers: 5, duration: '1m', p95Ms: 800, p99Ms: 1500, maxErrorRate: 1, abortOnFail: 'yes', thinkTimeMin: 1, thinkTimeMax: 2, maxDurationCap: '30m' } },
    { id: 'load', label: 'Load', hint: 'Charge nominale', a: { executorType: 'ramping-vus', virtualUsers: 50, duration: '15m', rampUpDuration: '2m', rampDownDuration: '1m', p95Ms: 500, p99Ms: 1000, maxErrorRate: 1, abortOnFail: 'yes', thinkTimeMin: 1, thinkTimeMax: 3, maxDurationCap: '1h' } },
    { id: 'stress', label: 'Stress', hint: 'Au-delà du nominal', a: { executorType: 'ramping-vus', virtualUsers: 200, duration: '20m', rampUpDuration: '5m', rampDownDuration: '2m', p95Ms: 1000, p99Ms: 2000, maxErrorRate: 5, abortOnFail: 'no', thinkTimeMin: 1, thinkTimeMax: 2, maxDurationCap: '2h' } },
    { id: 'spike', label: 'Spike', hint: 'Pic brutal', a: { executorType: 'ramping-vus', virtualUsers: 300, duration: '3m', rampUpDuration: '10s', rampDownDuration: '30s', p95Ms: 1500, p99Ms: 3000, maxErrorRate: 5, abortOnFail: 'no', thinkTimeMin: 0, thinkTimeMax: 1, maxDurationCap: '30m' } },
    { id: 'soak', label: 'Soak', hint: 'Endurance longue durée', a: { executorType: 'constant-vus', virtualUsers: 30, duration: '2h', p95Ms: 600, p99Ms: 1200, maxErrorRate: 1, abortOnFail: 'yes', thinkTimeMin: 1, thinkTimeMax: 3, maxDurationCap: '3h' } },
    { id: 'breakpoint', label: 'Breakpoint', hint: 'Point de rupture', a: { executorType: 'ramping-vus', virtualUsers: 500, duration: '30m', rampUpDuration: '15m', rampDownDuration: '1m', p95Ms: 2000, p99Ms: 5000, maxErrorRate: 10, abortOnFail: 'yes', thinkTimeMin: 0, thinkTimeMax: 1, maxDurationCap: '2h' } },
  ],

  /** Champs affichés seulement si la condition est vraie. */
  fieldVisible(qid) {
    const a = this.state.answers
    const multiHas = (k, ...v) => Array.isArray(a[k]) && v.some((x) => a[k].includes(x))
    switch (qid) {
      case 'rampUpDuration':
      case 'rampDownDuration': return a.executorType === 'ramping-vus'
      case 'arrivalRate':
      case 'maxVUsCap': return a.executorType === 'constant-arrival-rate'
      case 'authHeaderName': return a.authMode === 'bearer'
      case 'tokenEnvVar': return a.authMode === 'bearer' || a.authMode === 'oauth2'
      case 'loginScriptNeeded': return a.authMode && a.authMode !== 'none'
      case 'csvDataPath': return a.dataDriven === 'csv' || a.dataDriven === 'json'
      case 'proxyUrl': return a.useProxy === 'custom'
      case 'grafanaCloudProject': return multiHas('outputFormats', 'cloud', 'influx', 'prometheus')
      case 'ciParallelism':
      case 'scheduleCron': return a.runInCi === 'yes'
      default: return true
    }
  },

  renderCompactField(q) {
    const val = this.state.answers[q.id]
    const id = `k6Field_${q.id}`
    const req = q.required ? ' <span class="k6-wizard-req">*</span>' : ''
    const tip = this.escape([q.question, q.hint].filter(Boolean).join(' — '))
    const label = `<label for="${id}" title="${tip}">${this.escape(q.title)}${req}</label>`
    let control
    if (q.type === 'single' && q.options?.length) {
      control = `<select id="${id}" class="k6-f-input" data-qid="${this.escape(q.id)}">${q.options.map((o) => `<option value="${this.escape(o.id)}"${val === o.id ? ' selected' : ''}>${this.escape(o.label)}</option>`).join('')}</select>`
    } else if (q.type === 'multi' && q.options?.length) {
      const sel = Array.isArray(val) ? val : []
      control = `<div class="k6-f-chips" data-qid="${this.escape(q.id)}">${q.options.map((o) => `<label class="k6-f-chip"><input type="checkbox" data-multi="${this.escape(q.id)}" value="${this.escape(o.id)}"${sel.includes(o.id) ? ' checked' : ''}><span>${this.escape(o.label.split(' — ')[0].split(' (')[0])}</span></label>`).join('')}</div>`
    } else if (q.type === 'lines') {
      return `<div class="k6-f k6-f--wide" data-qid="${this.escape(q.id)}"><label title="${tip}">${this.escape(q.title)}${req}</label>${this.renderLineList(q)}</div>`
    } else if (q.type === 'textarea') {
      control = `<textarea id="${id}" class="k6-f-input" rows="2" data-qid="${this.escape(q.id)}">${this.escape(val)}</textarea>`
    } else {
      const type = q.type === 'number' ? 'number' : q.type === 'url' ? 'url' : 'text'
      const min = q.type === 'number' && q.min != null ? ` min="${q.min}"` : ''
      const max = q.type === 'number' && q.max != null ? ` max="${q.max}"` : ''
      control = `<input id="${id}" type="${type}" class="k6-f-input" data-qid="${this.escape(q.id)}" value="${this.escape(val)}"${min}${max} />`
    }
    const wide = q.type === 'textarea' || q.id === 'baseUrl' || q.id === 'campaignName' ? ' k6-f--wide' : ''
    return `<div class="k6-f${wide}" data-qid="${this.escape(q.id)}">${label}${control}</div>`
  },

  applyVisibility(root) {
    root.querySelectorAll('.k6-f[data-qid]').forEach((el) => {
      el.hidden = !this.fieldVisible(el.dataset.qid)
    })
  },

  applyPreset(presetId) {
    const preset = this.PRESETS.find((p) => p.id === presetId)
    if (!preset) return
    this.state.answers.campaignObjective = preset.id
    Object.assign(this.state.answers, preset.a)
    this.renderQuestionStep()
  },

  renderQuestionStep() {
    const root = this.$('k6WizardSteps')
    if (!root) return
    const a = this.state.answers
    const obj = a.campaignObjective || 'smoke'
    const questions = this.state.questions.filter((q) => q.id !== 'campaignObjective')
    const openSections = new Set(['contexte', 'cible', 'charge', 'seuils'])

    const presets = this.PRESETS.map((p) => `
      <button type="button" class="k6-preset${obj === p.id ? ' is-active' : ''}" data-preset="${p.id}" title="${this.escape(p.hint)}">
        <strong>${this.escape(p.label)}</strong><small>${this.escape(p.hint)}</small>
      </button>`).join('')

    const sections = this.orderedSections().map((sec) => {
      const qs = questions.filter((q) => q.section === sec.id)
      if (!qs.length) return ''
      return `
        <details class="k6-form-sec"${openSections.has(sec.id) ? ' open' : ''} data-sec="${this.escape(sec.id)}">
          <summary>${this.escape(sec.title)}</summary>
          <div class="k6-form-grid">${qs.map((q) => this.renderCompactField(q)).join('')}</div>
        </details>`
    }).join('')

    root.innerHTML = `
      <div class="card card-compact k6-form">
        <div class="k6-form-presets">
          <span class="k6-form-presets__label">1. Type de test (pré-remplit la charge et les seuils)</span>
          <div class="k6-presets">${presets}</div>
        </div>
        <div class="k6-form-presets__label">2. Ajustez les paramètres</div>
        ${sections}
        <div id="k6WizStepStatus" class="status wizard-unified-status" style="display:none;margin-top:8px"></div>
        <div class="k6-form-actions">
          <label class="k6-form-name">Nom du profil
            <input type="text" id="k6SummaryProfileName" class="k6-f-input" value="${this.escape(this.state.profileName || a.campaignName || 'Campagne k6')}" />
          </label>
          <span class="k6-form-actions__btns">
            <button type="button" class="btn-secondary btn-sm" id="k6WizCancel">Annuler</button>
            <button type="button" class="btn-secondary btn-sm" id="k6WizSaveOnly" title="Sauvegarde le profil sans générer le script">Enregistrer</button>
            <button type="button" class="btn-primary btn-sm k6-wizard-btn-primary" id="k6WizSaveApply" title="Sauvegarde puis génère le script k6 avec ces valeurs">Enregistrer &amp; générer le script</button>
          </span>
        </div>
      </div>`

    this.applyVisibility(root)
    for (const q of questions) {
      if (q.type === 'lines') this.bindLineList(root, q)
    }

    root.querySelectorAll('.k6-preset').forEach((b) => {
      b.addEventListener('click', () => this.applyPreset(b.dataset.preset))
    })

    const onField = (e) => {
      const t = e.target
      if (t.matches('[data-multi]')) {
        const qid = t.dataset.multi
        const checked = [...root.querySelectorAll(`[data-multi="${qid}"]:checked`)].map((i) => i.value)
        this.state.answers[qid] = checked
      } else if (t.matches('.k6-f-input[data-qid]')) {
        const q = this.state.questions.find((x) => x.id === t.dataset.qid)
        this.state.answers[t.dataset.qid] = q?.type === 'number' ? Number(t.value) : t.value
        t.classList.remove('is-invalid')
      } else {
        return
      }
      this.hideStepError()
      this.applyVisibility(root)
    }
    root.addEventListener('input', onField)
    root.addEventListener('change', onField)

    root.querySelector('#k6WizCancel')?.addEventListener('click', () => { void this.closeWizard() })
    root.querySelector('#k6WizSaveOnly')?.addEventListener('click', () => { if (this.validateForm(root)) void this.saveProfileOnly() })
    root.querySelector('#k6WizSaveApply')?.addEventListener('click', () => { if (this.validateForm(root)) void this.saveAndApply() })
  },

  validateForm(root) {
    const missing = []
    for (const q of this.state.questions) {
      if (!q.required || q.id === 'campaignObjective' || !this.fieldVisible(q.id)) continue
      const v = this.state.answers[q.id]
      const empty = Array.isArray(v) ? !v.length
        : q.type === 'lines' ? !String(v ?? '').split('\n').some((l) => l.trim())
        : v == null || String(v).trim() === ''
      if (empty) missing.push(q)
    }
    root.querySelectorAll('.is-invalid').forEach((el) => el.classList.remove('is-invalid'))
    if (!missing.length) return true
    for (const q of missing) {
      root.querySelector(`.k6-f[data-qid="${q.id}"] .k6-f-input`)?.classList.add('is-invalid')
      root.querySelector(`.k6-f[data-qid="${q.id}"]`)?.closest('details')?.setAttribute('open', '')
    }
    this.showStepError(`Champs obligatoires manquants : ${missing.map((q) => q.title).join(', ')}.`)
    return false
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
          <button type="button" class="k6-campaign-row__delete" data-profile="${this.escape(c.id)}" title="Supprimer cette campagne" aria-label="Supprimer la campagne">🗑</button>
          <div class="k6-campaign-row__confirm" hidden>
            <span class="k6-campaign-row__confirm-label">Supprimer ?</span>
            <button type="button" class="k6-campaign-row__confirm-yes" data-profile="${this.escape(c.id)}">Oui</button>
            <button type="button" class="k6-campaign-row__confirm-no">Non</button>
          </div>
          <div class="k6-campaign-row__run-actions">
            <button type="button" class="k6-tree-btn-mini k6-tree-complet" data-profile="${this.escape(c.id)}" data-code="${this.escape(c.solutionCode || '')}" data-label="${this.escape(c.name)}" title="Lance le test k6 avec tous les paramètres enregistrés (durée et charge complètes)">▶ Lancer</button>
            <button type="button" class="k6-tree-btn-mini k6-tree-incremental" data-profile="${this.escape(c.id)}" data-code="${this.escape(c.solutionCode || '')}" data-label="${this.escape(c.name)}" title="Test rapide : 30 s, 10 VUs maximum, pour vérifier que le script fonctionne">⚡ Test rapide 30 s</button>
            <button type="button" class="k6-tree-btn-mini k6-tree-edit" data-profile="${this.escape(c.id)}" title="Modifier les paramètres de la campagne">✎ Modifier</button>
            <button type="button" class="k6-tree-btn-mini k6-tree-folder" title="Ouvrir la racine du projet dans l'explorateur">📁</button>
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
        : 'Complétez d\'abord la <a href="/projet.html">Prise de connaissance</a> (tribu, produit, solution, application).'
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
        <div class="k6-run-recap" id="k6RunRecap" hidden></div>
        <div class="k6-run-stop-row"><button type="button" class="btn-secondary btn-sm k6-run-stop" id="k6RunStop">■ Stop</button></div>
        <pre class="npmrc-install-log stack-wizard-log k6-run-log" id="k6RunLog" aria-live="polite"></pre>
        <div class="k6-run-panel-actions">
          <button type="button" class="btn-secondary btn-sm" id="k6RunClose" hidden>Fermer</button>
        </div>
      </div>`
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    return panel
  },

  renderRunRecap(data) {
    const box = this.$('k6RunRecap')
    if (!box) return
    const out = String(data.output || '')
    const pick = (re) => { const m = out.match(re); return m ? m[1].trim() : '' }
    const thresholds = out.split('\n')
      .map((l) => l.match(/^\s*([✓✗])\s+('.+?')\s*(.*)$/))
      .filter(Boolean)
      .map((m) => ({ ok: m[1] === '✓', rule: m[2], value: m[3] }))
    const rows = []
    const reqs = pick(/http_reqs\.+:\s*(\d+)/)
    const failed = pick(/http_req_failed\.+:\s*([\d.]+%)/)
    const p95 = pick(/http_req_duration\.+:.*?p\(95\)=([\d.]+\w*)/)
    const iters = pick(/iterations\.+:\s*(\d+)/)
    if (reqs) rows.push(['Requêtes', reqs])
    if (iters) rows.push(['Itérations', iters])
    if (failed) rows.push(['Échecs HTTP', failed])
    if (p95) rows.push(['p95', p95])
    const verdict = data.stopped ? 'Arrêtée par l’utilisateur' : data.ok ? 'Succès' : 'Échec'
    const thHtml = thresholds.map((t) =>
      `<li class="${t.ok ? 'is-ok' : 'is-ko'}">${t.ok ? '✓' : '✗'} ${this.escape(t.rule)} <span>${this.escape(t.value)}</span></li>`).join('')
    box.innerHTML = `<strong>${this.escape(verdict)}</strong>`
      + (rows.length ? `<div class="k6-run-recap-grid">${rows.map(([k, v]) => `<span>${this.escape(k)}</span><b>${this.escape(v)}</b>`).join('')}</div>` : '')
      + (thHtml ? `<ul class="k6-run-recap-th">${thHtml}</ul>` : '')
    box.hidden = false
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
      if (fill) fill.style.width = `${Math.min(100, Math.round(((idx + 1) / steps.length) * 100))}%`
    }

    try {
      setStep(1)
      this.appendRunLog('▶ Préparation du profil et du script…\n')
      setStep(2)
      const stopBtn = this.$('k6RunStop')
      if (stopBtn) {
        stopBtn.onclick = async () => {
          stopBtn.disabled = true
          stopBtn.textContent = 'Arrêt…'
          try { await this.apiPost('/api/k6/run/stop', {}) } catch (e) { this.showToast(e.message, 'err') }
        }
      }
      const data = await this.apiPost(`/api/k6/profiles/${profileId}/run`, { mode })
      if (data.command) this.appendRunLog(`${data.command}\n${'—'.repeat(48)}\n`)
      this.appendRunLog(data.output || data.error || '')
      setStep(steps.length)
      if (stopBtn) stopBtn.hidden = true
      this.renderRunRecap(data)
      await this.loadCampaignTree()
      const closeBtn = this.$('k6RunClose')
      if (closeBtn) {
        closeBtn.hidden = false
        closeBtn.onclick = () => {
          const p = this.$('k6RunPanel')
          if (p) p.hidden = true
        }
      }
      panel.querySelector('.k6-run-panel-inner')?.classList.remove('is-running')
      if (data.ok) {
        panel.querySelector('.k6-run-panel-inner')?.classList.add('is-success')
        this.showToast(data.message || 'Campagne k6 terminée.')
      } else {
        panel.querySelector('.k6-run-panel-inner')?.classList.add('is-error')
        this.showToast(data.message || 'Campagne k6 échouée.', 'err')
      }
    } catch (err) {
      setStep(2)
      panel.querySelector('.k6-run-steps li.is-active')?.classList.add('is-error')
      panel.querySelector('.k6-run-panel-inner')?.classList.remove('is-running')
      panel.querySelector('.k6-run-panel-inner')?.classList.add('is-error')
      const stopBtn2 = this.$('k6RunStop')
      if (stopBtn2) stopBtn2.hidden = true
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
    if (Date.now() - (window.__k6WizardInitAt || 0) < 1500) return
    window.__k6WizardInitAt = Date.now()
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

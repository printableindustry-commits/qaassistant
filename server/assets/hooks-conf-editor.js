/**
 * Éditeur graphique hooks.conf
 */
const HooksConfEditor = {
  model: null,
  view: 'both',
  dirty: false,
  _inited: false,

  init() {
    if (!this._inited) {
      this._inited = true
      this.bindToolbar()
      this.setView('both')
      this.load()
      return
    }
    const rawEl = document.getElementById('rawConfEditor')
    if (!this.dirty && (!rawEl?.value || !this.model)) {
      this.load()
    } else {
      document.getElementById('conf-sec-raw')?.scrollIntoView({ behavior: 'instant', block: 'start' })
    }
  },

  updateRawMeta(content) {
    const el = document.getElementById('confRawMeta')
    if (!el) return
    const lines = content ? content.split(/\r?\n/).length : 0
    const chars = content ? content.length : 0
    el.textContent = lines ? `${lines} lignes · ${chars} caractères` : 'fichier vide ou absent'
  },

  bindToolbar() {
    document.querySelectorAll('[data-conf-view]').forEach(btn => {
      btn.addEventListener('click', () => this.setView(btn.dataset.confView))
    })
    document.getElementById('confReload')?.addEventListener('click', () => {
      if (this.dirty && !confirm('Recharger et perdre les modifications ?')) return
      this.load()
    })
    document.getElementById('confSave')?.addEventListener('click', () => this.save())
    document.getElementById('confAddPlan')?.addEventListener('click', () => this.addSection('plan'))
    document.getElementById('confAddSuite')?.addEventListener('click', () => this.addSection('suite'))
    document.getElementById('confJumpRaw')?.addEventListener('click', () => {
      this.setView('raw')
      document.getElementById('conf-sec-raw')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      document.getElementById('rawConfEditor')?.focus()
    })
    document.getElementById('confEmptyTemplate')?.addEventListener('click', () => this.loadEmptyTemplate(false))
    document.getElementById('confGenerateEmpty')?.addEventListener('click', () => this.generateEmptyFile())
    document.getElementById('confSyncRawToSections')?.addEventListener('click', () => {
      try {
        this.model = parseHooksConfClient(document.getElementById('rawConfEditor').value)
        this.renderStructured()
        this.markDirty()
        Portail.showStatus(document.getElementById('confStatus'), null, 'Texte → sections appliqué')
      } catch (e) {
        Portail.showStatus(document.getElementById('confStatus'), false, e.message)
      }
    })
    document.getElementById('rawConfEditor')?.addEventListener('input', e => {
      this.dirty = true
      this.updateDirtyBadge()
      this.updateRawMeta(e.target.value)
    })
  },

  async load() {
    try {
      const r = await fetch('/api/hook/hooks-conf')
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Chargement impossible')
      this.model = data.parsed
      this.dirty = false
      const s = data.stats
      document.getElementById('confStats').textContent =
        `${s.lines ?? '—'} lignes · ${s.sections} sections · ${s.plans} plans · ${s.suites} suites · ${s.defaultsKeys ?? '—'} param. [defaults]`
      const rawEl = document.getElementById('rawConfEditor')
      if (rawEl) rawEl.value = data.content || ''
      this.updateRawMeta(data.content || '')
      this.renderStructured()
      this.updateDirtyBadge()
      document.getElementById('conf-sec-raw')?.scrollIntoView({ behavior: 'instant', block: 'start' })
      Portail.showStatus(document.getElementById('confStatus'), null, 'hooks.conf chargé')
    } catch (e) {
      Portail.showStatus(document.getElementById('confStatus'), false, e.message)
    }
  },

  setView(view) {
    if (view === 'structured' && this.view === 'raw') {
      try {
        this.model = parseHooksConfClient(document.getElementById('rawConfEditor').value)
      } catch (e) {
        Portail.showStatus(document.getElementById('confStatus'), false, e.message)
        return
      }
    }
    if (view === 'raw' || view === 'both') {
      this.syncRawFromModel()
    }
    this.view = view
    document.querySelectorAll('[data-conf-view]').forEach(b =>
      b.classList.toggle('active', b.dataset.confView === view))
    const structured = document.getElementById('structuredConfEditor')
    const rawWrap = document.getElementById('rawConfWrap')
    if (structured) structured.hidden = view === 'raw'
    if (rawWrap) rawWrap.hidden = view === 'structured'
    if (view !== 'raw') this.renderStructured()
  },

  syncRawFromModel() {
    if (!this.model) return
    const text = serializeHooksConfClient(this.model)
    const rawEl = document.getElementById('rawConfEditor')
    if (rawEl) rawEl.value = text
    this.updateRawMeta(text)
  },

  async loadEmptyTemplate(writeDisk) {
    try {
      const data = await (await fetch('/api/hook/hooks-conf/empty-template')).json()
      if (!data.parsed) throw new Error(data.error || 'Modèle vide indisponible')
      this.model = data.parsed
      this.dirty = true
      const rawEl = document.getElementById('rawConfEditor')
      if (rawEl) rawEl.value = data.content || ''
      this.updateRawMeta(data.content || '')
      this.renderStructured()
      this.updateDirtyBadge()
      if (writeDisk) {
        await this.save()
        return
      }
      Portail.showStatus(document.getElementById('confStatus'), null,
        'Modèle vide chargé — [defaults] conservés, sans suite ni plan')
      document.getElementById('conf-sec-raw')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    } catch (e) {
      Portail.showStatus(document.getElementById('confStatus'), false, e.message)
    }
  },

  async generateEmptyFile() {
    if (!confirm('Générer hooks.conf vide sur le disque ?\nLes [suite] et [plan] actuels seront remplacés (backup .bak).')) return
    try {
      const r = await fetch('/api/hook/hooks-conf/empty', { method: 'POST' })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error)
      this.model = data.parsed
      this.dirty = false
      const rawEl = document.getElementById('rawConfEditor')
      if (rawEl) rawEl.value = data.content || ''
      this.updateRawMeta(data.content || '')
      this.renderStructured()
      this.updateDirtyBadge()
      Portail.showStatus(document.getElementById('confStatus'), true, 'hooks.conf vide généré (backup .bak)')
      if (typeof refreshStatusBadges === 'function') refreshStatusBadges()
      if (typeof loadHookMeta === 'function') loadHookMeta()
    } catch (e) {
      Portail.showStatus(document.getElementById('confStatus'), false, e.message)
    }
  },

  renderStructured() {
    const root = document.getElementById('structuredConfEditor')
    if (!root || !this.model) return

    const plans = this.model.sections.filter(s => s.type === 'plan')
    const suites = this.model.sections.filter(s => s.type === 'suite')
    const defaults = this.model.sections.find(s => s.type === 'defaults')
    const footerCount = (this.model.footerComments || []).filter(l => l.trim()).length

    let html = `
      <nav class="conf-index" aria-label="Sommaire hooks.conf">
        <a href="#conf-sec-header">En-tête</a>
        ${defaults ? '<a href="#conf-sec-defaults">[defaults]</a>' : ''}
        ${suites.length ? `<a href="#conf-sec-suite">[suite] (${suites.length})</a>` : ''}
        ${plans.length ? `<a href="#conf-sec-plans">Plans (${plans.length})</a>` : ''}
        <a href="#conf-sec-footer">Pied / exemples (${footerCount} lignes)</a>
        <a href="#conf-sec-raw" class="conf-jump-raw">↑ Fichier complet</a>
      </nav>`

    html += `
      <details class="conf-block conf-comments" id="conf-sec-header" open>
        <summary>En-tête — commentaires d'introduction (${this.model.headerComments.length} lignes)</summary>
        <textarea class="conf-comments-area" id="confHeader" rows="6">${esc(this.model.headerComments.join('\n'))}</textarea>
      </details>`

    this.model.sections.forEach((sec, si) => {
      if (sec.type === 'defaults') {
        html += renderDefaultsSection(sec, si)
        return
      }
      if (sec.type === 'suite') {
        html += renderSuiteSection(sec, si)
        return
      }
      if (sec.type === 'plan') return
      html += renderGenericSection(sec, si)
    })

    if (plans.length) {
      html += `<div class="conf-plans-block" id="conf-sec-plans">
        <h3 class="conf-plans-title">Plans de test — vue d'ensemble (${plans.length})</h3>
        <div class="conf-plans-table-wrap">
          <table class="conf-plans-table">
            <thead><tr><th>#</th><th>plan_key</th><th>folder</th><th>suite_key</th><th></th></tr></thead>
            <tbody>`
      plans.forEach((sec, pi) => {
        const kv = sectionKv(sec)
        const realSi = this.model.sections.indexOf(sec)
        html += `<tr>
          <td>${pi + 1}</td>
          <td><code>${esc(kv.plan_key || '—')}</code></td>
          <td class="conf-plans-folder">${esc(kv.folder || '—')}</td>
          <td><code>${esc(kv.suite_key || '—')}</code></td>
          <td><a class="conf-jump" href="#conf-plan-${realSi}">éditer</a></td>
        </tr>`
      })
      html += `</tbody></table></div>`

      plans.forEach(sec => {
        const si = this.model.sections.indexOf(sec)
        const kv = sectionKv(sec)
        html += `<details class="conf-section conf-section-plan conf-plan-detail" id="conf-plan-${si}">
          <summary><span class="conf-section-tag">[plan]</span>
            <span class="conf-plan-summary">${esc(kv.plan_key || '?')} — ${esc(kv.folder || 'sans folder')}</span>
          </summary>
          ${renderSectionBody(sec, si)}
        </details>`
      })
      html += `</div>`
    }

    html += `<details class="conf-block conf-comments" id="conf-sec-footer" open>
        <summary>Pied de fichier — commentaires / exemple commenté (${footerCount} lignes actives)</summary>
        <textarea class="conf-comments-area conf-footer-area" id="confFooter" rows="14">${esc((this.model.footerComments || []).join('\n'))}</textarea>
      </details>`

    root.innerHTML = html
    this.bindStructuredEvents(root)
    if (this.view !== 'structured') this.syncRawFromModel()
  },

  bindStructuredEvents(root) {
    root.querySelectorAll('.conf-jump-raw, a[href="#conf-sec-raw"]').forEach(link => {
      link.addEventListener('click', e => {
        e.preventDefault()
        if (this.view === 'structured') this.setView('both')
        document.getElementById('conf-sec-raw')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    })
    root.querySelector('#confHeader')?.addEventListener('input', e => {
      this.model.headerComments = e.target.value.split('\n')
      this.markDirty()
      this.syncRawFromModel()
    })
    root.querySelector('#confFooter')?.addEventListener('input', e => {
      this.model.footerComments = e.target.value.split('\n')
      this.markDirty()
      this.syncRawFromModel()
    })
    root.querySelectorAll('.conf-key, .conf-val, .conf-comment-input').forEach(el => {
      el.addEventListener('input', () => {
        this.syncLineFromDom(el)
        this.markDirty()
        this.syncRawFromModel()
      })
    })
    root.querySelectorAll('.conf-del-line').forEach(btn => {
      btn.addEventListener('click', () => {
        this.model.sections[Number(btn.dataset.si)].lines.splice(Number(btn.dataset.li), 1)
        this.renderStructured()
        this.markDirty()
      })
    })
    root.querySelectorAll('.conf-del-section').forEach(btn => {
      btn.addEventListener('click', () => {
        const si = Number(btn.dataset.si)
        const sec = this.model.sections[si]
        if (!confirm(`Supprimer ${sec.header} ?`)) return
        this.model.sections.splice(si, 1)
        this.renderStructured()
        this.markDirty()
      })
    })
    root.querySelectorAll('.conf-add-kv').forEach(btn => {
      btn.addEventListener('click', () => {
        this.model.sections[Number(btn.dataset.si)].lines.push({ type: 'kv', key: '', value: '' })
        this.renderStructured()
        this.markDirty()
      })
    })
    root.querySelectorAll('.conf-add-comment').forEach(btn => {
      btn.addEventListener('click', () => {
        this.model.sections[Number(btn.dataset.si)].lines.push({ type: 'comment', raw: '# ' })
        this.renderStructured()
        this.markDirty()
      })
    })
    root.querySelectorAll('.conf-add-empty').forEach(btn => {
      btn.addEventListener('click', () => {
        this.model.sections[Number(btn.dataset.si)].lines.push({ type: 'empty' })
        this.renderStructured()
        this.markDirty()
      })
    })
  },

  syncLineFromDom(el) {
    const line = this.model.sections[Number(el.dataset.si)].lines[Number(el.dataset.li)]
    if (line.type === 'kv') {
      if (el.classList.contains('conf-key')) line.key = el.value
      if (el.classList.contains('conf-val')) line.value = el.value
    } else if (line.type === 'comment') line.raw = el.value
  },

  addSection(type) {
    const header = type === 'plan' ? '[plan]' : '[suite]'
    const lines = type === 'plan'
      ? [
        { type: 'kv', key: 'folder', value: '' },
        { type: 'kv', key: 'plan_key', value: '' },
        { type: 'kv', key: 'suite_key', value: '' },
      ]
      : [{ type: 'kv', key: 'suite_key', value: '' }, { type: 'kv', key: 'name', value: '' }]
    this.model.sections.push({ header, type, lines })
    this.renderStructured()
    this.markDirty()
  },

  markDirty() {
    this.dirty = true
    this.updateDirtyBadge()
  },

  updateDirtyBadge() {
    const el = document.getElementById('confDirty')
    if (el) el.hidden = !this.dirty
  },

  getPayload() {
    const rawEl = document.getElementById('rawConfEditor')
    const header = document.getElementById('confHeader')
    const footer = document.getElementById('confFooter')
    if (header) this.model.headerComments = header.value.split('\n')
    if (footer) this.model.footerComments = footer.value.split('\n')

    if (this.view === 'raw' && rawEl) return { content: rawEl.value }

    if (this.view === 'both' && rawEl) {
      const fromModel = serializeHooksConfClient(this.model)
      if (rawEl.value.trim() !== fromModel.trim()) return { content: rawEl.value }
    }

    return { parsed: this.model }
  },

  async save() {
    try {
      const r = await fetch('/api/hook/hooks-conf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.getPayload()),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error)
      this.model = data.parsed
      document.getElementById('rawConfEditor').value = data.content
      this.dirty = false
      this.updateDirtyBadge()
      this.renderStructured()
      Portail.showStatus(document.getElementById('confStatus'), true, 'hooks.conf enregistré (backup .bak)')
      if (typeof refreshStatusBadges === 'function') refreshStatusBadges()
      if (typeof loadHookMeta === 'function') loadHookMeta()
    } catch (e) {
      Portail.showStatus(document.getElementById('confStatus'), false, e.message)
    }
  },
}

function sectionKv(sec) {
  return Object.fromEntries(sec.lines.filter(l => l.type === 'kv').map(l => [l.key, l.value]))
}

function splitLineGroups(lines) {
  const groups = []
  let cur = null
  for (const line of lines) {
    const kind = line.type === 'kv' ? 'kv' : 'other'
    if (!cur || cur.kind !== kind) {
      cur = { kind, items: [] }
      groups.push(cur)
    }
    cur.items.push(line)
  }
  return groups
}

function renderDefaultsSection(sec, si) {
  const groups = splitLineGroups(sec.lines)
  let body = `<div class="conf-section conf-section-defaults" id="conf-sec-defaults">
    <div class="conf-section-head">
      <span class="conf-section-tag">[defaults]</span>
      <span class="conf-section-hint">Paramètres globaux du hook (${sec.lines.filter(l => l.type === 'kv').length} clés)</span>
    </div>`

  groups.forEach((g, gi) => {
    if (g.kind === 'kv') {
      body += `<div class="conf-defaults-kv"><table class="conf-kv-table"><tbody>`
      g.items.forEach(line => {
        const idx = sec.lines.indexOf(line)
        body += `<tr>
          <td><input type="text" class="conf-key" data-si="${si}" data-li="${idx}" value="${escAttr(line.key || '')}" /></td>
          <td class="conf-eq-cell">=</td>
          <td><input type="text" class="conf-val" data-si="${si}" data-li="${idx}" value="${escAttr(line.value || '')}" /></td>
          <td><button type="button" class="btn-danger btn-sm conf-del-line" data-si="${si}" data-li="${idx}">×</button></td>
        </tr>`
      })
      body += `</tbody></table></div>`
    } else {
      const commentCount = g.items.filter(l => l.type === 'comment').length
      body += `<details class="conf-defaults-doc" ${gi <= 1 ? 'open' : ''}>
        <summary>Documentation inline (${commentCount} commentaires — ex. terminal_mode A–E)</summary>
        <div class="conf-lines">`
      g.items.forEach(line => {
        const li = sec.lines.indexOf(line)
        body += lineRowHtml(si, line, li)
      })
      body += `</div></details>`
    }
  })

  body += renderSectionActions(si)
  body += `</div>`
  return body
}

function renderSuiteSection(sec, si) {
  return `<div class="conf-section conf-section-suite" id="conf-sec-suite">
    ${renderSectionHead(sec, si)}
    ${renderSectionBody(sec, si)}
  </div>`
}

function renderGenericSection(sec, si) {
  return `<div class="conf-section conf-section-${sec.type}">
    ${renderSectionHead(sec, si)}
    ${renderSectionBody(sec, si)}
  </div>`
}

function renderSectionHead(sec, si) {
  const deletable = sec.type === 'plan' || sec.type === 'suite'
  return `<div class="conf-section-head">
    <span class="conf-section-tag">${esc(sec.header)}</span>
    ${deletable ? `<button type="button" class="btn-danger btn-sm conf-del-section" data-si="${si}">Supprimer bloc</button>` : ''}
  </div>`
}

function renderSectionBody(sec, si) {
  let html = `<div class="conf-lines">`
  sec.lines.forEach((line, li) => { html += lineRowHtml(si, line, li) })
  html += `</div>${renderSectionActions(si)}`
  return html
}

function renderSectionActions(si) {
  return `<div class="conf-line-actions">
    <button type="button" class="btn-secondary btn-sm conf-add-kv" data-si="${si}">+ clé=valeur</button>
    <button type="button" class="btn-secondary btn-sm conf-add-comment" data-si="${si}">+ commentaire</button>
    <button type="button" class="btn-secondary btn-sm conf-add-empty" data-si="${si}">+ ligne vide</button>
  </div>`
}

function lineRowHtml(si, line, li) {
  if (line.type === 'empty') {
    return `<div class="conf-line conf-line-empty"><span class="conf-line-type">∅</span>
      <span class="conf-line-preview">ligne vide</span>
      <button type="button" class="btn-danger btn-sm conf-del-line" data-si="${si}" data-li="${li}">×</button></div>`
  }
  if (line.type === 'comment') {
    return `<div class="conf-line conf-line-comment"><span class="conf-line-type">#</span>
      <input type="text" class="conf-comment-input" data-si="${si}" data-li="${li}" value="${escAttr(line.raw || '')}" />
      <button type="button" class="btn-danger btn-sm conf-del-line" data-si="${si}" data-li="${li}">×</button></div>`
  }
  return `<div class="conf-line conf-line-kv">
    <input type="text" class="conf-key" data-si="${si}" data-li="${li}" value="${escAttr(line.key || '')}" placeholder="clé" />
    <span class="conf-eq">=</span>
    <input type="text" class="conf-val" data-si="${si}" data-li="${li}" value="${escAttr(line.value || '')}" placeholder="valeur" />
    <button type="button" class="btn-danger btn-sm conf-del-line" data-si="${si}" data-li="${li}">×</button></div>`
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
}
function escAttr(s) { return esc(s) }

function parseLineClient(raw) {
  const t = raw.trim()
  if (!t) return { type: 'empty' }
  if (t.startsWith('#')) return { type: 'comment', raw }
  const eq = t.indexOf('=')
  if (eq > 0) return { type: 'kv', key: t.slice(0, eq).trim(), value: t.slice(eq + 1).trim() }
  return { type: 'comment', raw }
}

function extractTrailingFooterClient(sections) {
  if (!sections.length) return []
  const last = sections[sections.length - 1]
  let lastKvIdx = -1
  for (let i = last.lines.length - 1; i >= 0; i--) {
    if (last.lines[i].type === 'kv') { lastKvIdx = i; break }
  }
  if (lastKvIdx < 0 || lastKvIdx >= last.lines.length - 1) return []
  const trailing = last.lines.slice(lastKvIdx + 1)
  if (!trailing.every(l => l.type === 'comment' || l.type === 'empty')) return []
  if (trailing.filter(l => l.type === 'comment').length < 3) return []
  last.lines = last.lines.slice(0, lastKvIdx + 1)
  return trailing.map(l => (l.type === 'comment' ? l.raw : ''))
}

function parseHooksConfClient(content) {
  const SECTION_RE = /^\[[^[\]]+\]$/
  const lines = content.split(/\r?\n/)
  const headerComments = []
  const sections = []
  let i = 0
  while (i < lines.length) {
    if (SECTION_RE.test(lines[i].trim())) break
    headerComments.push(lines[i]); i++
  }
  while (i < lines.length) {
    const trimmed = lines[i].trim()
    if (!SECTION_RE.test(trimmed)) { i++; continue }
    const section = { header: trimmed, type: trimmed.slice(1, -1), lines: [] }
    i++
    while (i < lines.length && !SECTION_RE.test(lines[i].trim())) {
      section.lines.push(parseLineClient(lines[i]))
      i++
    }
    sections.push(section)
  }
  const footerComments = extractTrailingFooterClient(sections)
  return { headerComments, sections, footerComments }
}

function serializeHooksConfClient(model) {
  const out = [...model.headerComments]
  if (out.length && model.sections.length) out.push('')
  model.sections.forEach((sec, si) => {
    if (si > 0) out.push('')
    out.push(sec.header)
    for (const line of sec.lines) {
      if (line.type === 'empty') out.push('')
      else if (line.type === 'comment') out.push(line.raw ?? '')
      else if (line.type === 'kv') out.push(`${line.key}=${line.value}`)
    }
  })
  if (model.footerComments?.length) {
    if (out.length) out.push('')
    out.push(...model.footerComments)
  }
  const text = out.join('\n')
  return text.endsWith('\n') ? text : `${text}\n`
}

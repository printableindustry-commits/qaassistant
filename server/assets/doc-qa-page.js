(function () {
  const $ = (id) => document.getElementById(id)

  const BLOCK_RE = /<!--\s*DOC_QA_BLOCK_START\s*-->([\s\S]*?)<!--\s*DOC_QA_BLOCK_END\s*-->/i

  const CONTEXT_FIELDS = [
    { key: 'tribu', label: 'Tribu' },
    { key: 'squad', label: 'Squad' },
    { key: 'poName', label: 'Product Owner' },
    { key: 'scrumMasterName', label: 'Scrum Master' },
    { key: 'baName', label: 'Business Analyst' },
    { key: 'qaName', label: 'Référent QA' },
    { key: 'productCode', label: 'Code produit' },
    { key: 'solutionCode', label: 'Code solution' },
    { key: 'applicationLabel', label: 'Application / solution' },
    { key: 'recommendedStackLabel', label: 'Stack de test', altKey: 'recommendedStack' },
  ]

  const CHAPTER_ACTIONS = {
    todo: { label: 'Générer le prompt IA', step: 1 },
    prompt_generated: { label: 'Coller la réponse IA', step: 3 },
    ai_response_pasted: { label: 'Appliquer au document', step: 5 },
    ready_to_apply: { label: 'Appliquer au document', step: 5 },
    applied: { label: 'Relire le chapitre', step: 1 },
    review_needed: { label: 'Relire le chapitre', step: 1 },
    error: { label: 'Voir le problème', step: 1 },
  }

  let pageState = {
    onboarding: {},
    prefill: {},
    documents: [],
    dashboard: null,
    livrablesDir: '',
    selectedDocId: null,
    selectedChapterId: null,
    aiResponseRaw: '',
    extractedContent: '',
    pendingApplyContent: '',
  }

  function apiUrl(path) {
    const base = window.__WIZARD_API_BASE__ || ''
    return base ? `${base.replace(/\/$/, '')}${path}` : path
  }

  function pageUrl(path) {
    if (window.Portail?.pageUrl) return window.Portail.pageUrl(path)
    return path
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function showStatus(ok, msg) {
    const el = $('docQaStatus')
    if (!el) return
    Portail.showStatus(el, ok, msg)
    el.style.display = 'block'
  }

  function statusBadgeClass(kind, value) {
    return `doc-qa-status-badge doc-qa-status-badge--${value || 'todo'}`
  }

  function extractDocQaBlock(text) {
    const raw = String(text || '').trim()
    const m = raw.match(BLOCK_RE)
    if (m) return { found: true, content: m[1].trim(), raw }
    return { found: false, content: raw, raw }
  }

  function countTodoMarkers(text) {
    return (String(text || '').match(/\[À COMPLÉTER\]/gi) || []).length
  }

  function findDoc(docId) {
    return (pageState.documents || []).find((d) => d.id === docId) || null
  }

  function findChapter(docId, chapterId) {
    const doc = findDoc(docId)
    return doc?.chapters?.find((c) => c.id === chapterId) || null
  }

  function getChapterStatus(chapter) {
    return chapter?.progress?.status || 'todo'
  }

  function recommendedActionText(status) {
    const map = {
      todo: 'générer le prompt IA pour compléter ce chapitre',
      prompt_generated: 'copier le prompt dans Copilot ou Cursor, puis coller la réponse IA',
      ai_response_pasted: 'vérifier l\'aperçu puis appliquer au document',
      ready_to_apply: 'appliquer le contenu au document Word',
      applied: 'relire le chapitre ou passer au suivant',
      review_needed: 'relire le chapitre — des informations [À COMPLÉTER] subsistent',
      error: 'consulter le diagnostic et réessayer',
    }
    return map[status] || map.todo
  }

  function renderDashboard() {
    const root = $('docQaDashboardRoot')
    const dash = pageState.dashboard
    if (!root || !dash) return

    const docLines = (dash.documents || []).map((d) => `
      <div class="doc-qa-dashboard-doc-line">
        <span>${escapeHtml(d.title)}</span>
        <span class="doc-qa-meta-secondary">${d.done}/${d.total} chapitres · ${escapeHtml(d.statusLabel)}</span>
      </div>`).join('')

    const last = dash.lastAction
    const lastLine = last
      ? `Dernière action : chapitre « ${escapeHtml(last.chapterId)} » (${escapeHtml(last.type)}) le ${escapeHtml(new Date(last.at).toLocaleString('fr-FR'))}`
      : 'Aucune action enregistrée pour l\'instant.'

    root.innerHTML = `
      <div class="doc-qa-dashboard-stats">
        <div class="doc-qa-dashboard-stat"><span class="doc-qa-meta-secondary">Chapitres complétés</span><strong>${dash.totals?.completed ?? 0}/${dash.totals?.chapters ?? 0}</strong></div>
        <div class="doc-qa-dashboard-stat"><span class="doc-qa-meta-secondary">À compléter</span><strong>${dash.totals?.todo ?? 0}</strong></div>
        <div class="doc-qa-dashboard-stat"><span class="doc-qa-meta-secondary">À relire</span><strong>${dash.totals?.review ?? 0}</strong></div>
      </div>
      <div class="doc-qa-dashboard-docs">${docLines || '<p class="hint">Aucun document dans le catalogue.</p>'}</div>
      <p class="doc-qa-meta-secondary">${lastLine}</p>`
  }

  function renderContextGrid(onboarding) {
    const grid = $('docQaContextGrid')
    if (!grid) return
    grid.innerHTML = CONTEXT_FIELDS.map((f) => {
      const val = onboarding[f.key] || (f.altKey ? onboarding[f.altKey] : '') || '—'
      return `<div class="doc-qa-context-item"><dt>${escapeHtml(f.label)}</dt><dd>${escapeHtml(val)}</dd></div>`
    }).join('')

    const warn = $('docQaOnboardingWarn')
    if (warn) {
      if (!onboarding.onboardingComplete) {
        warn.hidden = false
        warn.textContent = 'La prise de connaissance n\'est pas terminée. Certaines informations projet seront marquées [À COMPLÉTER] dans les prompts — elles ne seront pas inventées.'
      } else {
        warn.hidden = true
      }
    }

    const badge = $('docQaStatusBadge')
    if (badge) {
      badge.textContent = onboarding.onboardingComplete ? 'Contexte disponible' : 'Contexte partiel'
      badge.classList.toggle('is-ok', Boolean(onboarding.onboardingComplete))
      badge.classList.toggle('is-warn', !onboarding.onboardingComplete)
    }
  }

  function renderDocumentPicker() {
    const root = $('docQaDocumentsPicker')
    if (!root) return
    const docs = pageState.documents || []
    if (!docs.length) {
      root.innerHTML = '<p class="hint">Catalogue indisponible — vérifiez la configuration des gabarits.</p>'
      return
    }

    root.innerHTML = docs.map((doc) => {
      const ds = doc.documentStatus || {}
      const selected = pageState.selectedDocId === doc.id ? ' is-selected' : ''
      const objective = doc.coverSubtitle || doc.wizardSection || 'Livrable du pack Documentation QA.'
      return `
        <article class="doc-qa-doc-card-v2${selected}" data-doc-id="${escapeHtml(doc.id)}">
          <div class="doc-qa-doc-card-v2-head">
            <h3 class="doc-qa-doc-card-v2-title">${escapeHtml(doc.id)} — ${escapeHtml(doc.coverTitle)}</h3>
            <span class="${statusBadgeClass('doc', ds.status)}">${escapeHtml(ds.label || 'Non commencé')}</span>
          </div>
          <p class="doc-qa-doc-card-v2-objective">${escapeHtml(objective)}</p>
          <div class="doc-qa-progress-bar" role="progressbar" aria-valuenow="${ds.ratio || 0}" aria-valuemin="0" aria-valuemax="100">
            <div class="doc-qa-progress-bar-fill" style="width:${ds.ratio || 0}%"></div>
          </div>
          <p class="doc-qa-meta-secondary">${ds.done ?? 0} / ${ds.total ?? 0} chapitres complétés</p>
          <div class="doc-qa-doc-card-v2-foot">
            <span class="doc-qa-meta-secondary">Fichier : <code>${escapeHtml(doc.file)}</code></span>
            <button type="button" class="btn-primary doc-qa-continue-doc-btn" data-doc-id="${escapeHtml(doc.id)}">Continuer ce document</button>
          </div>
        </article>`
    }).join('')

    root.querySelectorAll('.doc-qa-continue-doc-btn').forEach((btn) => {
      btn.addEventListener('click', () => selectDocument(btn.dataset.docId))
    })
    root.querySelectorAll('.doc-qa-doc-card-v2').forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('button')) return
        selectDocument(card.dataset.docId)
      })
    })
  }

  function selectDocument(docId) {
    pageState.selectedDocId = docId
    pageState.selectedChapterId = null
    pageState.aiResponseRaw = ''
    pageState.extractedContent = ''
    $('docQaZoneChapters').hidden = false
    renderDocumentPicker()
    renderChaptersList()
    $('docQaZoneDetail').hidden = true
    $('docQaZoneAi').hidden = true
  }

  function renderChaptersList() {
    const root = $('docQaChaptersList')
    const doc = findDoc(pageState.selectedDocId)
    if (!root || !doc) return

    root.innerHTML = (doc.chapters || []).map((ch, idx) => {
      const st = getChapterStatus(ch)
      const action = CHAPTER_ACTIONS[st] || CHAPTER_ACTIONS.todo
      const selected = pageState.selectedChapterId === ch.id ? ' is-selected' : ''
      const lastAt = ch.progress?.lastAppliedAt || ch.progress?.lastPromptGeneratedAt
      const lastLabel = lastAt ? `Dernière action : ${new Date(lastAt).toLocaleString('fr-FR')}` : 'Pas encore traité'
      return `
        <div class="doc-qa-chapter-row${selected}" data-doc-id="${escapeHtml(doc.id)}" data-chapter-id="${escapeHtml(ch.id)}">
          <span class="doc-qa-chapter-num">${idx + 1}</span>
          <div class="doc-qa-chapter-row-body">
            <p class="doc-qa-chapter-row-title">${escapeHtml(ch.title)}</p>
            <p class="doc-qa-chapter-row-meta">${escapeHtml(ch.focus || '')}</p>
            <p class="doc-qa-chapter-row-meta">${escapeHtml(lastLabel)}</p>
          </div>
          <div class="doc-qa-chapter-row-actions">
            <span class="${statusBadgeClass('chapter', st)}">${escapeHtml(ch.statusLabel || action.label)}</span>
            <button type="button" class="btn-hub-secondary btn-sm doc-qa-chapter-action-btn" data-doc-id="${escapeHtml(doc.id)}" data-chapter-id="${escapeHtml(ch.id)}">${escapeHtml(action.label)}</button>
          </div>
        </div>`
    }).join('')

    root.querySelectorAll('.doc-qa-chapter-row').forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.doc-qa-chapter-action-btn')) return
        selectChapter(row.dataset.docId, row.dataset.chapterId)
      })
    })
    root.querySelectorAll('.doc-qa-chapter-action-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        selectChapter(btn.dataset.docId, btn.dataset.chapterId, true)
      })
    })
  }

  async function selectChapter(docId, chapterId, runPrimary = false) {
    pageState.selectedDocId = docId
    pageState.selectedChapterId = chapterId
    pageState.aiResponseRaw = ''
    pageState.extractedContent = ''
    $('docQaZoneDetail').hidden = false
    $('docQaZoneAi').hidden = false
    renderChaptersList()
    await renderChapterDetail()
    renderAiWorkflow()
    if (runPrimary) await runPrimaryAction()
  }

  async function fetchReadiness(docId, chapterId, userNotes = '') {
    const q = new URLSearchParams({ docId, chapterId, userNotes })
    const r = await fetch(apiUrl(`/api/doc/wizard/chapter/readiness?${q}`))
    const data = await r.json()
    if (!r.ok || data.ok === false) throw new Error(data.error || 'Analyse indisponible')
    return data.readiness
  }

  async function renderChapterDetail() {
    const root = $('docQaChapterDetail')
    const docId = pageState.selectedDocId
    const chapterId = pageState.selectedChapterId
    const doc = findDoc(docId)
    const chapter = findChapter(docId, chapterId)
    if (!root || !doc || !chapter) return

    const st = getChapterStatus(chapter)
    const notesId = `docQaNotes_${docId}_${chapterId}`
    let readiness = null
    try {
      const notes = document.getElementById(notesId)?.value?.trim() || ''
      readiness = await fetchReadiness(docId, chapterId, notes)
    } catch {
      readiness = { readiness: 'partial', readinessLabel: 'Analyse partielle', canGenerate: true }
    }

    const readinessCls = `doc-qa-readiness doc-qa-readiness--${readiness.readiness === 'yes' ? 'yes' : readiness.readiness === 'no' ? 'no' : 'partial'}`
    const missingList = [...(readiness.required || []), ...(readiness.recommended || [])]
      .map((f) => `<li>${escapeHtml(f.label)}</li>`).join('') || '<li>Aucun champ critique identifié</li>'

    const sources = (pageState.availableSourceNames || []).length
      ? pageState.availableSourceNames.map((s) => `<li>${escapeHtml(s)}</li>`).join('')
      : '<li>Configuration Wizard et inventaire projet (si disponibles)</li>'

    root.innerHTML = `
      <div class="doc-qa-action-recommended">Action recommandée : ${escapeHtml(recommendedActionText(st))}.</div>
      <section>
        <h3>${escapeHtml(chapter.title)}</h3>
        <p>Ce chapitre explique : ${escapeHtml(chapter.focus || chapter.title)}. Le Wizard utilise les informations disponibles pour préparer un prompt IA. Les informations absentes seront marquées <strong>[À COMPLÉTER]</strong>.</p>
      </section>
      <div class="${readinessCls}">
        <strong>${escapeHtml(readiness.readinessLabel)}</strong>
        ${readiness.readiness === 'partial' ? '<p class="hint hint-tight">Le prompt sera généré avec des marqueurs [À COMPLÉTER] pour les informations absentes.</p>' : ''}
        ${readiness.readiness === 'no' ? '<p class="hint hint-tight">Complétez les champs minimaux via le contexte projet avant de générer si possible.</p>' : ''}
      </div>
      <section>
        <h3>Données attendues</h3>
        <p>${escapeHtml(chapter.dataToProvide || '—')}</p>
      </section>
      <section>
        <h3>Sources utilisées</h3>
        <ul>${sources}</ul>
      </section>
      <section>
        <h3>Informations manquantes</h3>
        <ul>${missingList}</ul>
      </section>
      <label for="${notesId}">Précisions pour ce chapitre (optionnel)</label>
      <textarea id="${notesId}" class="doc-qa-theme-notes" rows="2" placeholder="Contraintes métier, sources, exclusions…"></textarea>
      <details class="doc-qa-tech-fold">
        <summary>Voir les détails techniques</summary>
        <p class="hint hint-tight"><strong>Qualité attendue :</strong> ${escapeHtml(chapter.expectedQuality || '—')}</p>
        ${chapter.tableHeaders?.length ? `<p class="hint hint-tight"><strong>Colonnes tableau :</strong> <code>${escapeHtml(chapter.tableHeaders.join(' | '))}</code></p>` : ''}
        ${chapter.scan ? `<p class="hint hint-tight"><strong>Scan document :</strong> ${escapeHtml(chapter.scan.scanSummary || '')} (${escapeHtml(chapter.scan.sourcePath || '')})</p>` : ''}
        ${chapter.fill?.filledAt ? `<p class="hint hint-tight"><strong>Dernière application :</strong> ${escapeHtml(new Date(chapter.fill.filledAt).toLocaleString('fr-FR'))}</p>` : ''}
        <p class="hint hint-tight"><strong>Identifiant :</strong> ${escapeHtml(docId)} / ${escapeHtml(chapterId)} · <strong>Statut :</strong> ${escapeHtml(st)}</p>
      </details>
      <div class="doc-qa-primary-action-row" id="docQaDetailPrimaryRow"></div>`

    renderPrimaryActions('docQaDetailPrimaryRow', docId, chapterId, st)
  }

  function renderPrimaryActions(containerId, docId, chapterId, status) {
    const row = $(containerId)
    if (!row) return
    const action = CHAPTER_ACTIONS[status] || CHAPTER_ACTIONS.todo
    row.innerHTML = `
      <button type="button" class="btn-primary doc-qa-primary-btn" data-action="${escapeHtml(status)}">${escapeHtml(action.label)}</button>
      <button type="button" class="btn-hub-secondary btn-sm doc-qa-secondary-scan-btn">Nouveau scan du document</button>
      <div class="doc-qa-advanced-menu">
        <details>
          <summary>Options avancées</summary>
          <div class="doc-qa-advanced-panel">
            <button type="button" class="doc-qa-adv-regen">Regénérer le prompt</button>
            <button type="button" class="doc-qa-adv-sources">Voir les sources</button>
            <button type="button" class="doc-qa-adv-export">Exporter le prompt</button>
            <button type="button" class="doc-qa-adv-reset">Réinitialiser le chapitre</button>
          </div>
        </details>
      </div>`

    row.querySelector('.doc-qa-primary-btn')?.addEventListener('click', () => runPrimaryAction())
    row.querySelector('.doc-qa-secondary-scan-btn')?.addEventListener('click', () => scanDocument(docId).catch((e) => showStatus(false, e.message)))
    row.querySelector('.doc-qa-adv-regen')?.addEventListener('click', () => generatePrompt(docId, chapterId).catch((e) => showStatus(false, e.message)))
    row.querySelector('.doc-qa-adv-sources')?.addEventListener('click', () => {
      $('docQaContextFold')?.setAttribute('open', '')
      showStatus(true, 'Contexte projet et sources listés dans le détail du chapitre.')
    })
    row.querySelector('.doc-qa-adv-export')?.addEventListener('click', () => generatePrompt(docId, chapterId, true).catch((e) => showStatus(false, e.message)))
    row.querySelector('.doc-qa-adv-reset')?.addEventListener('click', () => resetChapter(docId, chapterId).catch((e) => showStatus(false, e.message)))
  }

  function renderAiWorkflow() {
    const root = $('docQaAiWorkflow')
    const docId = pageState.selectedDocId
    const chapterId = pageState.selectedChapterId
    const chapter = findChapter(docId, chapterId)
    if (!root || !chapter) return

    const st = getChapterStatus(chapter)
    const action = CHAPTER_ACTIONS[st] || CHAPTER_ACTIONS.todo
    const activeStep = action.step || 1

    const steps = [
      { n: 1, title: 'Générer le prompt IA', desc: 'Le Wizard prépare un prompt contextualisé à partir des informations projet.' },
      { n: 2, title: 'Copier le prompt dans Copilot ou Cursor', desc: 'Copiez ce prompt dans Copilot Agent ou Cursor Agent.' },
      { n: 3, title: 'Coller la réponse IA', desc: 'Collez la réponse obtenue dans la zone ci-dessous.' },
      { n: 4, title: 'Extraire le bloc documentaire', desc: 'Le contenu entre les marqueurs sera extrait automatiquement et préparé pour le document.' },
      { n: 5, title: 'Appliquer au document', desc: 'Vérifiez l\'aperçu puis injectez le contenu dans le fichier Word.' },
    ]

    root.innerHTML = `
      <div class="doc-qa-ai-steps">
        ${steps.map((s) => {
          const cls = s.n < activeStep ? 'is-done' : s.n === activeStep ? 'is-active' : ''
          return `<div class="doc-qa-ai-step ${cls}"><span class="doc-qa-ai-step-num">${s.n < activeStep ? '✓' : s.n}</span><div><strong>${escapeHtml(s.title)}</strong><p class="doc-qa-meta-secondary">${escapeHtml(s.desc)}</p></div></div>`
        }).join('')}
      </div>
      <div class="doc-qa-primary-action-row" id="docQaAiPrimaryRow"></div>
      <div class="doc-qa-ai-response-zone" id="docQaAiPasteZone" ${activeStep < 3 ? 'hidden' : ''}>
        <label for="docQaAiResponseInput">Réponse IA</label>
        <p class="hint hint-tight">Copiez ce prompt dans Copilot Agent ou Cursor Agent. Collez ensuite la réponse obtenue dans la zone ci-dessous.</p>
        <textarea id="docQaAiResponseInput" placeholder="Collez ici la réponse complète de l'IA…"></textarea>
        <div class="doc-qa-primary-action-row" style="margin-top:0.5rem">
          <button type="button" class="btn-primary" id="docQaExtractBtn">Extraire le contenu prêt à insérer</button>
          <button type="button" class="btn-ghost btn-sm" id="docQaPasteClipboardBtn">Coller depuis le presse-papiers</button>
        </div>
        <div id="docQaExtractPreview" class="doc-qa-extract-preview" hidden></div>
      </div>`

    renderPrimaryActions('docQaAiPrimaryRow', docId, chapterId, st)

    $('docQaPasteClipboardBtn')?.addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText()
        const ta = $('docQaAiResponseInput')
        if (ta) ta.value = text
        showStatus(true, 'Réponse collée — extrayez le bloc documentaire.')
      } catch (e) {
        showStatus(false, e.message || 'Coller impossible — utilisez Ctrl+V')
      }
    })

    $('docQaExtractBtn')?.addEventListener('click', () => handleExtractResponse(docId, chapterId))
  }

  async function runPrimaryAction() {
    const docId = pageState.selectedDocId
    const chapterId = pageState.selectedChapterId
    const chapter = findChapter(docId, chapterId)
    if (!chapter) return
    const st = getChapterStatus(chapter)
    if (st === 'todo' || st === 'applied' || st === 'review_needed' || st === 'error') {
      await generatePrompt(docId, chapterId)
    } else if (st === 'prompt_generated') {
      $('docQaAiPasteZone')?.removeAttribute('hidden')
      $('docQaAiResponseInput')?.focus()
      showStatus(true, 'Collez la réponse IA, puis extrayez le contenu prêt à insérer.')
    } else if (st === 'ai_response_pasted' || st === 'ready_to_apply') {
      const content = pageState.extractedContent || $('docQaAiResponseInput')?.value?.trim()
      if (!content) {
        showStatus(false, 'Extrayez d\'abord le bloc documentaire depuis la réponse IA.')
        return
      }
      openPreviewModal(docId, chapterId, content)
    }
  }

  async function generatePrompt(docId, chapterId, saveOnly = false) {
    const notesId = `docQaNotes_${docId}_${chapterId}`
    const userNotes = document.getElementById(notesId)?.value?.trim() || ''
    const readiness = await fetchReadiness(docId, chapterId, userNotes)
    if (!readiness.canGenerate) {
      showStatus(false, 'Informations minimales manquantes — complétez le contexte projet.')
      return
    }
    const data = await window.WizardDocCopilot.startThemeFlow({ docId, chapterId, userNotes })
    if (saveOnly && data.prompt) {
      await fetch(apiUrl('/api/doc/wizard/prompt/chapter/save'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docId, chapterId, prompt: data.prompt }),
      })
      showStatus(true, 'Prompt exporté dans .wizard-qa/doc-qa-prompts/')
    } else {
      showStatus(true, 'Prompt IA généré — copiez-le dans Copilot ou Cursor.')
    }
    await loadContext()
    if (pageState.selectedChapterId === chapterId) {
      await selectChapter(docId, chapterId)
    }
  }

  async function handleExtractResponse(docId, chapterId) {
    const raw = $('docQaAiResponseInput')?.value?.trim() || ''
    if (!raw) {
      showStatus(false, 'Collez d\'abord la réponse IA.')
      return
    }
    const extracted = extractDocQaBlock(raw)
    if (!extracted.found) {
      const ok = global.confirm('Aucun bloc structuré détecté. Voulez-vous utiliser tout le texte collé ?')
      if (!ok) return
    }
    if (!extracted.content) {
      showStatus(false, 'Contenu vide — impossible d\'appliquer.')
      return
    }
    if (extracted.content.length < 80) {
      showStatus(false, 'Contenu très court — vérifiez que la réponse IA est complète.')
    }
    const todoCount = countTodoMarkers(extracted.content)
    const aiComments = (raw.match(/^(voici|j'ai|note\s*:|remarque)/gim) || []).length
    if (aiComments > 2) {
      showStatus(true, 'Avertissement : la réponse semble contenir des commentaires hors bloc — seul le contenu extrait sera appliqué.')
    }

    pageState.aiResponseRaw = raw
    pageState.extractedContent = extracted.content

    const preview = $('docQaExtractPreview')
    if (preview) {
      preview.hidden = false
      preview.innerHTML = `${escapeHtml(extracted.content.slice(0, 1200))}${extracted.content.length > 1200 ? '\n…' : ''}${todoCount ? ` <span class="doc-qa-todo-badge">Informations à compléter (${todoCount})</span>` : ''}`
    }

    await fetch(apiUrl('/api/doc/wizard/progress'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        docId,
        chapterId,
        status: 'ready_to_apply',
        hasTodoMarkers: todoCount > 0,
        completionRatio: todoCount ? 80 : 95,
      }),
    })
    await loadContext()
    renderAiWorkflow()
    showStatus(true, 'Contenu prêt à insérer extrait — ouvrez l\'aperçu pour appliquer au document.')
  }

  function openPreviewModal(docId, chapterId, content) {
    const doc = findDoc(docId)
    const chapter = findChapter(docId, chapterId)
    const modal = $('docQaPreviewModal')
    if (!modal || !doc || !chapter) return
    pageState.pendingApplyContent = content
    const todoCount = countTodoMarkers(content)
    $('docQaPreviewMeta').innerHTML = `
      <strong>${escapeHtml(doc.coverTitle)}</strong> — chapitre « ${escapeHtml(chapter.title)} »<br>
      Source : réponse IA collée · ${escapeHtml(new Date().toLocaleString('fr-FR'))}
      ${todoCount ? ` · <span class="doc-qa-todo-badge">${todoCount} marqueur(s) [À COMPLÉTER]</span>` : ''}`
    $('docQaPreviewBody').textContent = content
    modal.hidden = false
  }

  function closePreviewModal() {
    const modal = $('docQaPreviewModal')
    if (modal) modal.hidden = true
    pageState.pendingApplyContent = ''
  }

  async function applyFromPreview() {
    const docId = pageState.selectedDocId
    const chapterId = pageState.selectedChapterId
    const content = pageState.pendingApplyContent
    if (!content) return
    closePreviewModal()
    await applyChapterBlock(docId, chapterId, content)
  }

  async function applyChapterBlock(docId, chapterId, content) {
    const r = await fetch(apiUrl('/api/doc/wizard/fill/chapter'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ docId, chapterId, content }),
    })
    const data = await r.json()
    if (!r.ok || data.ok === false) {
      await fetch(apiUrl('/api/doc/wizard/progress'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docId, chapterId, status: 'error', notes: data.error || 'Erreur application' }),
      })
      throw new Error(data.error || 'Application échouée')
    }
    await loadContext()
    const stats = data.fillStats || {}
    showStatus(true, [
      `Chapitre appliqué dans ${data.docxPath || 'le document Word'}`,
      stats.paragraphsReplaced != null ? `${stats.paragraphsReplaced} paragraphe(s) remplacé(s)` : null,
      data.todoMarkerCount ? `${data.todoMarkerCount} [À COMPLÉTER] à revoir` : null,
    ].filter(Boolean).join(' · '))
    if (pageState.selectedChapterId === chapterId) {
      await selectChapter(docId, chapterId)
    }
  }

  async function resetChapter(docId, chapterId) {
    if (!global.confirm('Réinitialiser la progression de ce chapitre ?')) return
    await fetch(apiUrl('/api/doc/wizard/progress'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ docId, chapterId, status: 'todo', notes: '', missingFields: [], hasTodoMarkers: false, completionRatio: 0 }),
    })
    pageState.extractedContent = ''
    pageState.aiResponseRaw = ''
    await loadContext()
    await selectChapter(docId, chapterId)
    showStatus(true, 'Chapitre réinitialisé.')
  }

  async function scanDocument(docId) {
    const r = await fetch(apiUrl('/api/doc/wizard/scan/document'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ docId }),
    })
    const data = await r.json()
    if (!r.ok || data.ok === false) throw new Error(data.error || 'Scan échoué')
    await loadContext()
    showStatus(true, `Nouveau scan terminé — ${data.resolvedFile || data.file}`)
    if (pageState.selectedDocId === docId) renderChaptersList()
  }

  async function loadContext() {
    const r = await fetch(apiUrl('/api/doc/wizard/context'))
    const data = await r.json()
    if (!r.ok || data.ok === false) throw new Error(data.error || 'Contexte indisponible')

    pageState.onboarding = data.onboarding || {}
    pageState.prefill = data.prefill || {}
    pageState.documents = data.documents || []
    pageState.dashboard = data.dashboard || null
    pageState.livrablesDir = data.livrablesDir || ''
    pageState.availableSourceNames = data.availableSourceNames || []

    renderDashboard()
    renderContextGrid(pageState.onboarding)
    renderDocumentPicker()
    if (pageState.selectedDocId) {
      renderChaptersList()
      if (pageState.selectedChapterId) {
        await renderChapterDetail()
        renderAiWorkflow()
      }
    }
    return data
  }

  function bindEvents() {
    $('docQaTourBtn')?.addEventListener('click', () => {
      window.DocQaLivrablesTour?.replay().catch((e) => showStatus(false, e.message))
    })
    const editBtn = $('docQaEditContextBtn')
    if (editBtn) editBtn.href = pageUrl('/?edit=project')

    $('docQaPreviewApplyBtn')?.addEventListener('click', () => applyFromPreview().catch((e) => showStatus(false, e.message)))
    $('docQaPreviewEditBtn')?.addEventListener('click', () => {
      closePreviewModal()
      const ta = $('docQaAiResponseInput')
      if (ta && pageState.extractedContent) ta.value = pageState.extractedContent
      $('docQaAiPasteZone')?.removeAttribute('hidden')
      ta?.focus()
    })
    document.querySelectorAll('[data-doc-qa-preview-close]').forEach((el) => {
      el.addEventListener('click', closePreviewModal)
    })
  }

  async function boot() {
    bindEvents()
    window.addEventListener('docQa:paste-block', async (e) => {
      const { docId, chapterId, content, extracted } = e.detail || {}
      if (!docId || !chapterId || !content) return
      await selectChapter(docId, chapterId)
      const ta = $('docQaAiResponseInput')
      if (ta) ta.value = content
      pageState.extractedContent = extracted || extractDocQaBlock(content).content
      $('docQaAiPasteZone')?.removeAttribute('hidden')
      await fetch(apiUrl('/api/doc/wizard/progress'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docId, chapterId, status: 'ai_response_pasted' }),
      })
      await loadContext()
      showStatus(true, 'Réponse IA reçue — extrayez ou appliquez le contenu prêt à insérer.')
    })
    try {
      await loadContext()
    } catch (e) {
      showStatus(false, e.message)
    }
    await window.DocQaLivrablesTour?.showOnLoadIfNeeded?.()
  }

  Portail.init('docQa', () => ({}), boot, () => ({ page: 'docQa' }))
})()

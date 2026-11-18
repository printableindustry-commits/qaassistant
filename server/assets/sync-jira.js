(function () {
  const state = {
    hookReady: false,
    readiness: null,
    analyzing: false,
    syncing: false,
    lastAnalyze: null,
    lastAnalyzeLog: null,
    lastSyncLog: null,
    lastAnalyzeOutput: '',
    lastSyncOutput: '',
    lastPreview: null,
  }

  const $ = id => document.getElementById(id)

  function apiUrl(path) {
    const base = window.__WIZARD_API_BASE__ || ''
    return base ? `${base.replace(/\/$/, '')}${path}` : path
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function setBadge(el, ok, okText, koText) {
    if (!el) return
    el.textContent = ok ? okText : koText
    el.classList.toggle('ok', ok)
    el.classList.toggle('warn', !ok)
  }

  function showStatus(ok, msg) {
    const el = $('status')
    if (!el) return
    Portail.showStatus(el, ok, msg)
    el.style.display = 'block'
  }

  function setConsoleHint(id, text, running) {
    const hint = $(id)
    if (!hint) return
    hint.textContent = text
    hint.className = 'console-hint' + (running ? ' console-hint-run' : '')
  }

  function setBusy(busy) {
    $('btnAnalyze').disabled = busy || !state.hookReady
    $('btnSyncLocal').disabled = busy || !state.hookReady
  }

  function renderPreviewBody(preview) {
    const folders = preview.folders || []
    const del = preview.ticketsDelete || []
    const create = preview.ticketsCreate || []
    const plans = preview.testPlans || []

    const listOrNone = (items, mapFn) => items.length
      ? `<ul class="sync-preview-list">${items.map(mapFn).join('')}</ul>`
      : '<p class="hint">Aucun</p>'

    return `
      <p class="sync-confirm-lead">Vous allez appliquer la synchronisation complète (local → JIRA / Xray) :</p>
      <div class="sync-preview-block">
        <h3>Dossiers à traiter (${folders.length})</h3>
        ${listOrNone(folders, f => `<li><code>${escapeHtml(f)}</code></li>`)}
      </div>
      <div class="sync-preview-block">
        <h3>Tickets à supprimer (${del.length})</h3>
        ${listOrNone(del, t => `<li><code>${escapeHtml(t.key || '—')}</code> [${escapeHtml(t.testId || '')}] ${escapeHtml(t.summary || t.reason || '')}</li>`)}
      </div>
      <div class="sync-preview-block">
        <h3>Tickets à créer (${create.length})</h3>
        ${listOrNone(create, t => `<li>[${escapeHtml(t.testId)}] ${escapeHtml(t.summary)}</li>`)}
      </div>
      <div class="sync-preview-block">
        <h3>Plans de test (${plans.length})</h3>
        ${listOrNone(plans, p => `<li><code>${escapeHtml(p.plan_key)}</code> — ${escapeHtml(p.folder)}</li>`)}
      </div>
      <p class="hook-sync-warning">Cette opération modifie JIRA et Xray Cloud. Vérifiez la liste avant de confirmer.</p>`
  }

  async function checkHookReadiness() {
    try {
      const data = await fetch(apiUrl('/api/hook/readiness')).then(r => r.json())
      state.hookReady = Boolean(data.readyForJiraSync)
      state.readiness = data
      const hint = $('readinessHint')
      if (hint) {
        const msg = state.hookReady
          ? (data.message || 'Hook Git prêt.')
          : (data.message || 'Configurez le Hook Git et validez un dry-run favorable.')
        hint.innerHTML = Portail.formatHookGitMention(msg)
        hint.hidden = false
      }
      setBadge($('badgeHook'), state.hookReady, 'Hook OK', 'Hook KO')
      setBusy(state.analyzing || state.syncing)
      return data
    } catch (err) {
      state.hookReady = false
      $('readinessHint').innerHTML = Portail.formatHookGitMention(err.message || 'Erreur')
      $('readinessHint').hidden = false
      setBadge($('badgeHook'), false, 'Hook OK', 'Hook KO')
      setBusy(true)
      return null
    }
  }

  async function refreshBadges() {
    try {
      const profile = await fetch(apiUrl('/api/project/profile')).then(r => r.json())
      const p = profile.project || {}
      const xrayOk = Boolean(
        (p.xrayClientId || profile.jiraSync?.xrayClientId)
        && (p.xrayClientSecret || profile.jiraSync?.xrayClientSecret),
      )
      const plans = profile.arborescences || []
      setBadge($('badgeXray'), xrayOk, 'Xray OK', 'Xray KO')
      setBadge($('badgePlans'), plans.length > 0, `${plans.length} plan(s)`, 'Aucun plan')
      if (state.lastAnalyze?.ok) setBadge($('badgeSync'), true, 'vérif OK', 'écart')
      else if (state.lastAnalyze) setBadge($('badgeSync'), false, 'vérif OK', 'écart')
      else setBadge($('badgeSync'), false, 'Sync OK', 'Sync —')
    } catch {
      /* badges optionnels */
    }
  }

  async function openWizardLogsFolder() {
    try {
      const r = await fetch(apiUrl('/api/wizard/open-folder'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: 'logs' }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error)
      Portail.showToast('Dossier des logs ouvert', { type: 'ok' })
    } catch (err) {
      Portail.showToast(err.message, { type: 'err' })
    }
  }

  function buildSyncJiraPromptOpts() {
    const analyzeOut = $('analyzeConsole')?.textContent || state.lastAnalyzeOutput || ''
    const syncOut = $('syncLocalConsole')?.textContent || state.lastSyncOutput || ''
    const combinedLog = [
      '=== Étape 1 — Analyse des écarts (dry-run) ===',
      analyzeOut,
      '',
      '=== Étape 2 — Synchronisation Local → JIRA / Xray ===',
      syncOut,
    ].join('\n')
    const logFile = state.lastSyncLog?.fileName || state.lastAnalyzeLog?.fileName || ''
    const logPath = state.lastSyncLog?.relativePath || state.lastAnalyzeLog?.relativePath || ''
    const hasError = (state.lastAnalyze && !state.lastAnalyze.ok) || (state.lastSyncOutput && /échec|ERREUR|KO/i.test(state.lastSyncOutput))

    return {
      title: 'Debug Sync JIRA — analyse et synchronisation Local ↔ JIRA / Xray',
      context: 'Échec ou analyse Sync JIRA (analyse dry-run par plan + synchronisation hook-run.mjs --force). Le prompt agrège toute la configuration Wizard : .env, hooks.conf, plans VS Code, profil projet, project.variables.json, les deux sorties terminal Sync JIRA et les logs .wizard-qa/logs.',
      log: combinedLog,
      error: hasError ? 'Analyse ou synchronisation Sync JIRA en échec ou avec écarts' : '',
      enrich: true,
      scope: 'sync-jira',
      agentModel: 'Claude Sonnet 4.6',
      environment: {
        'Page': 'Sync JIRA — Xray Cloud',
        'Dernier log analyse': state.lastAnalyzeLog?.fileName || '—',
        'Chemin log analyse': state.lastAnalyzeLog?.relativePath || '—',
        'Dernier log synchro': state.lastSyncLog?.fileName || '—',
        'Chemin log synchro': state.lastSyncLog?.relativePath || '—',
        'Log récent': logFile || '—',
        'Chemin log': logPath || '—',
        'Hook configuré': state.readiness?.configured ? 'oui' : 'non',
        'Dry-run Hook OK': state.readiness?.dryRunOk ? 'oui' : 'non',
      },
      stepsToReproduce: [
        'Vérifier Hook Git (.env, hooks.conf, post-commit) et dry-run favorable',
        'Ouvrir Sync JIRA dans le Wizard',
        'Lancer l\'analyse (dry-run JIRA + Xray par plan)',
        'Si écarts : lancer « Synchroniser vers JIRA » après confirmation',
        'Consulter les logs dans .wizard-qa/logs',
      ],
      suggestedQuestions: [
        'Quelle est la cause racine des écarts JIRA / Xray détectés ?',
        'Quels tickets seront créés, supprimés ou mis à jour ?',
        'Les dossiers VS Code des plans existent-ils et correspondent-ils à hooks.conf ?',
        'Le proxy ZGIE ou les credentials JIRA/Xray sont-ils en cause ?',
        'Quelle commande relancer pour valider la correction ?',
      ],
    }
  }

  async function openCopilotDebug() {
    if (typeof CopilotDebugPrompt === 'undefined') {
      Portail.showToast('Module prompt DEBUG indisponible — rechargez la fenêtre Wizard', { type: 'err' })
      return
    }
    const btn = $('copilotDebugBtn')
    if (btn) btn.disabled = true
    try {
      await CopilotDebugPrompt.fromLog(buildSyncJiraPromptOpts())
    } catch (err) {
      Portail.showToast(err.message, { type: 'err' })
    } finally {
      if (btn) btn.disabled = false
    }
  }

  async function runAnalyze() {
    if (!state.hookReady || state.analyzing) return
    state.analyzing = true
    setBusy(true)
    const consoleEl = $('analyzeConsole')
    if (consoleEl) consoleEl.textContent = 'Analyse JIRA / Xray en cours…\n'
    setConsoleHint('analyzeHint', 'En cours…', true)
    try {
      const data = await fetch(apiUrl('/api/hook/jira-analyze'), { method: 'POST' }).then(r => r.json())
      if (!data.plans && data.error) throw new Error(data.error)
      const output = data.output || data.error || '(aucune sortie)'
      state.lastAnalyze = data
      state.lastAnalyzeLog = data.log || null
      state.lastAnalyzeOutput = output
      if (consoleEl) consoleEl.textContent = output
      setConsoleHint('analyzeHint', data.ok ? 'OK' : 'Écarts', false)
      showStatus(data.ok, data.ok ? 'Analyse terminée — tout est OK' : 'Analyse terminée — écarts détectés')
      if (data.log?.fileName) {
        Portail.showToast(`Log enregistré : ${data.log.fileName}`, { type: data.ok ? 'ok' : 'warn' })
      }
      refreshBadges()
    } catch (err) {
      state.lastAnalyze = null
      state.lastAnalyzeOutput = err.message
      if (consoleEl) consoleEl.textContent = err.message
      setConsoleHint('analyzeHint', 'Erreur', false)
      showStatus(false, err.message)
    } finally {
      state.analyzing = false
      setBusy(state.syncing)
    }
  }

  async function readTickets() {
    const btn = $('btnReadTickets')
    const consoleEl = $('analyzeConsole')
    btn.disabled = true
    if (consoleEl) consoleEl.textContent = 'Lecture des tickets JIRA (Récits et Tests)…\n'
    try {
      const data = await fetch(apiUrl('/api/hook/jira-tickets'), { method: 'POST' }).then(r => r.json())
      if (!data.ok) throw new Error(data.error)
      const lines = data.tickets.map(t => `${t.key}\t[${t.type}]\t${t.status}\t${t.summary}`)
      if (consoleEl) {
        consoleEl.textContent = `Projet ${data.project} — ${data.total} ticket(s) (${data.issueTypes.join(', ')})\nEnregistré : ${data.file}\n\n${lines.join('\n')}`
      }
      showStatus(true, `${data.total} tickets JIRA capturés`)
    } catch (err) {
      if (consoleEl) consoleEl.textContent = err.message
      showStatus(false, err.message)
    } finally {
      btn.disabled = false
    }
  }

  function openConfirmModal(preview) {
    $('syncConfirmBody').innerHTML = renderPreviewBody(preview)
    $('syncConfirmModal').hidden = false
  }

  function closeConfirmModal() {
    $('syncConfirmModal').hidden = true
  }

  async function loadPreviewAndConfirm() {
    if (!state.hookReady || state.syncing) return
    state.syncing = true
    setBusy(true)
    const btn = $('btnSyncLocal')
    const prevLabel = btn.textContent
    btn.textContent = 'Chargement aperçu…'
    try {
      const preview = await fetch(apiUrl('/api/hook/sync-preview'), { method: 'POST' }).then(r => r.json())
      if (preview.error) throw new Error(preview.error)
      state.lastPreview = preview
      openConfirmModal(preview)
    } catch (err) {
      showStatus(false, err.message)
    } finally {
      state.syncing = false
      btn.textContent = prevLabel
      setBusy(false)
    }
  }

  async function runSync() {
    closeConfirmModal()
    state.syncing = true
    setBusy(true)
    const consoleEl = $('syncLocalConsole')
    if (consoleEl) consoleEl.textContent = 'Synchronisation Local → JIRA / Xray en cours…\n'
    setConsoleHint('syncLocalHint', 'En cours…', true)
    try {
      const data = await fetch(apiUrl('/api/hook/sync'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }).then(r => r.json())
      const output = data.output || data.error || '(aucune sortie)'
      state.lastSyncOutput = output
      state.lastSyncLog = data.log || null
      if (consoleEl) consoleEl.textContent = output
      setConsoleHint('syncLocalHint', data.ok ? 'Terminé' : 'Échec', false)
      showStatus(data.ok, data.ok ? 'Synchronisation terminée' : 'Synchronisation échouée')
      if (data.log?.fileName) {
        Portail.showToast(`Log enregistré : ${data.log.fileName}`, { type: data.ok ? 'ok' : 'err' })
      }
      if (data.ok) refreshBadges()
    } catch (err) {
      state.lastSyncOutput = err.message
      if (consoleEl) consoleEl.textContent = err.message
      setConsoleHint('syncLocalHint', 'Erreur', false)
      showStatus(false, err.message)
    } finally {
      state.syncing = false
      setBusy(false)
    }
  }

  function bindUi() {
    $('btnAnalyze').onclick = () => runAnalyze()
    $('btnSyncLocal').onclick = () => loadPreviewAndConfirm()
    $('btnReadTickets').onclick = () => readTickets()
    $('syncConfirmCancel').onclick = () => closeConfirmModal()
    $('syncConfirmOk').onclick = () => runSync()
    document.querySelectorAll('[data-close="syncConfirmModal"]').forEach(el => {
      el.onclick = () => closeConfirmModal()
    })
  }

  async function init() {
    bindUi()
    const readiness = await checkHookReadiness()
    // Dernière analyse connue (fournie en démonstration) : affichée sans relancer le script.
    const last = readiness?.lastAnalyze
    if (last?.output && !state.lastAnalyze) {
      state.lastAnalyze = last
      state.lastAnalyzeOutput = last.output
      const consoleEl = $('analyzeConsole')
      if (consoleEl) consoleEl.textContent = last.output
      setConsoleHint('analyzeHint', last.ok ? 'OK' : 'Écarts', false)
    }
    const lastSync = readiness?.lastSync
    if (lastSync?.output && !state.lastSyncOutput) {
      state.lastSyncOutput = lastSync.output
      const syncEl = $('syncLocalConsole')
      if (syncEl) syncEl.textContent = lastSync.output
      setConsoleHint('syncLocalHint', 'Terminé', false)
    }
    await refreshBadges()
    Portail.applyEmbedLinks()
  }

  function boot() {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
    else init()
    if (!window.__syncJiraSoftNavHook) {
      window.__syncJiraSoftNavHook = true
      window.addEventListener('wizard:page-ready', (e) => {
        if (String(e.detail?.path || '') === '/project.html') init()
      })
    }
  }

  boot()
})()

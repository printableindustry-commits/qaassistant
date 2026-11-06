/**
 * Correction automatique des installations en échec avec Copilot local.
 * Une page d'installation appelle InstallAutofix.offer() en cas d'échec ; la boucle
 * prépare la demande (serveur), l'envoie à Copilot (extension VS Code), attend son
 * résultat, relance l'installation, et recommence jusqu'au succès ou à la limite.
 */
;(function (global) {
  const POLL_MS = 3000
  const TIMEOUT_MS = 20 * 60 * 1000

  const ERROR_HINTS = [
    { re: /ENOTFOUND|ETIMEDOUT|ECONNREFUSED|ECONNRESET|EAI_AGAIN|proxy|timed? out/i, title: 'Le poste n’arrive pas à joindre le serveur de téléchargement', text: 'Le réseau ou le proxy d’entreprise bloque probablement la connexion.' },
    { re: /E401|E403|401|403|unauthorized|forbidden|authToken/i, title: 'L’accès au dépôt d’entreprise a été refusé', text: 'Votre jeton d’accès est peut-être expiré ou absent.' },
    { re: /ERESOLVE|peer dep|conflict|version/i, title: 'Deux composants demandent des versions incompatibles', text: 'Les dépendances du projet ne sont pas alignées.' },
    { re: /ENOENT|not recognized|introuvable|not found|cannot find|command not found/i, title: 'Un programme ou un dossier nécessaire est introuvable', text: 'Un chemin est incorrect ou un outil n’est pas installé sur le poste.' },
    { re: /EPERM|EACCES|access is denied|accès refusé|administrateur/i, title: 'Les droits du poste sont insuffisants', text: 'Windows a refusé l’écriture ou l’exécution.' },
  ]

  const state = { active: false, cancelled: false, runId: null }

  function apiUrl(path) {
    const base = global.__WIZARD_API_BASE__ || ''
    return base ? `${base.replace(/\/$/, '')}${path}` : path
  }

  async function api(path, body) {
    const res = await fetch(apiUrl(path), body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : undefined)
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    return data
  }

  function esc(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  function ensureStyles() {
    if (document.querySelector('link[href*="install-autofix.css"]')) return
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = apiUrl('/assets/install-autofix.css')
    document.head.appendChild(link)
  }

  function explain(errorText) {
    const hint = ERROR_HINTS.find((h) => h.re.test(errorText || ''))
    return hint || { title: 'L’installation n’a pas abouti', text: 'Une étape s’est arrêtée avant la fin.' }
  }

  function mountCard(anchorId) {
    ensureStyles()
    let card = document.getElementById('autofixCard')
    if (!card) {
      card = document.createElement('section')
      card.id = 'autofixCard'
      card.className = 'autofix-card'
      card.setAttribute('aria-live', 'polite')
      const anchor = document.getElementById(anchorId || 'status')
      if (anchor?.parentNode) anchor.parentNode.insertBefore(card, anchor.nextSibling)
      else document.querySelector('.wrap')?.appendChild(card)
    }
    return card
  }

  function render(card, { tone, title, text, extra = '', actions = '' }) {
    card.className = `autofix-card autofix-card--${tone}`
    card.hidden = false
    card.innerHTML = `
      <div class="autofix-icon" aria-hidden="true"></div>
      <div class="autofix-body">
        <h3 class="autofix-title">${esc(title)}</h3>
        <p class="autofix-text">${esc(text)}</p>
        ${extra}
        <div class="autofix-actions">${actions}</div>
      </div>`
  }

  function details(log) {
    const tail = String(log || '').trim().split('\n').slice(-25).join('\n')
    if (!tail) return ''
    return `<details class="autofix-details"><summary>Voir le détail technique</summary><pre>${esc(tail)}</pre></details>`
  }

  function bind(card, handlers) {
    Object.entries(handlers).forEach(([id, fn]) => {
      card.querySelector(`[data-autofix="${id}"]`)?.addEventListener('click', fn)
    })
  }

  function sendToCopilot(begin) {
    let api2 = global.__wizardVsCodeApi
    if (!api2 && typeof global.acquireVsCodeApi === 'function') {
      try {
        api2 = global.acquireVsCodeApi()
        global.__wizardVsCodeApi = api2
      } catch { /* déjà acquis */ }
    }
    if (!api2) return false
    api2.postMessage({ type: 'askCopilot', query: begin.agentQuery, runId: begin.runId })
    return true
  }

  async function waitResult(runId, iteration) {
    const deadline = Date.now() + TIMEOUT_MS
    while (Date.now() < deadline && !state.cancelled) {
      await sleep(POLL_MS)
      const res = await api(`/api/autofix/result?runId=${encodeURIComponent(runId)}&iteration=${iteration}`).catch(() => null)
      if (res?.ready) return res
    }
    return null
  }

  function showWorking(card, iteration, max, phase) {
    render(card, {
      tone: 'working',
      title: `Copilot corrige le problème (tentative ${iteration} sur ${max})`,
      text: phase || 'Il analyse votre poste, répare les chemins et les dépendances. Gardez VS Code ouvert : acceptez les commandes que Copilot vous demande d’autoriser.',
      actions: '<button type="button" class="btn-secondary btn-sm" data-autofix="stop">Arrêter</button>',
    })
    bind(card, { stop: () => { state.cancelled = true } })
  }

  function showStopped(card, ctx, title, text, begin) {
    const copy = begin?.prompt
      ? '<button type="button" class="btn-secondary btn-sm" data-autofix="copy">Copier la demande pour Copilot</button>'
      : ''
    render(card, {
      tone: 'warn',
      title,
      text,
      extra: details(ctx.log),
      actions: `<button type="button" class="btn-primary btn-sm" data-autofix="retry">Réessayer avec Copilot</button>${copy}`,
    })
    bind(card, {
      retry: () => { void start(ctx) },
      copy: async () => {
        await navigator.clipboard?.writeText(begin.agentQuery).catch(() => {})
        global.Portail?.showToast?.('Demande copiée — collez-la dans Copilot Chat (mode agent)', { type: 'ok' })
      },
    })
  }

  async function start(ctx) {
    state.active = true
    state.cancelled = false
    state.runId = null
    const card = mountCard(ctx.anchorId)
    let begin = null

    try {
      for (;;) {
        begin = await api('/api/autofix/begin', {
          scope: ctx.scope,
          error: ctx.error,
          log: ctx.log,
          runId: state.runId,
          pagePath: global.location.pathname,
          title: `Correction automatique — ${ctx.scope}`,
        })
        if (begin.exhausted) {
          showStopped(card, ctx, 'Copilot n’a pas réussi seul', `Après ${begin.max} tentatives, le problème persiste. Votre intervention est nécessaire.`, null)
          return
        }
        state.runId = begin.runId
        showWorking(card, begin.iteration, begin.max)
        const delivered = sendToCopilot(begin)
        if (!delivered) {
          showWorking(card, begin.iteration, begin.max, 'Copilot Chat n’est pas accessible depuis cette page. Collez la demande copiée ci-dessous dans Copilot Chat (mode agent) : la page continuera toute seule.')
          await navigator.clipboard?.writeText(begin.agentQuery).catch(() => {})
        }

        const result = await waitResult(begin.runId, begin.iteration)
        if (state.cancelled) {
          showStopped(card, ctx, 'Correction automatique arrêtée', 'Vous pouvez la relancer quand vous voulez.', begin)
          return
        }
        if (!result) {
          showStopped(card, ctx, 'Copilot n’a pas répondu', 'Aucun résultat reçu après 20 minutes.', begin)
          return
        }
        if (result.status === 'needs_user') {
          showStopped(card, ctx, 'Copilot a besoin de vous', result.summary || 'Une action de votre part est nécessaire (droit administrateur, identifiant…).', begin)
          return
        }

        showWorking(card, begin.iteration, begin.max, `Copilot a corrigé : ${result.summary || 'modifications appliquées'}. Nouvelle tentative d’installation…`)
        const outcome = await ctx.rerun()
        if (outcome.ok) {
          await api('/api/autofix/finish', { runId: begin.runId, resolution: result.summary }).catch(() => {})
          const changes = (result.changes || []).map((c) => `<li>${esc(c)}</li>`).join('')
          render(card, {
            tone: 'ok',
            title: 'Problème corrigé, installation terminée',
            text: result.summary || 'Copilot a réparé l’installation.',
            extra: changes ? `<ul class="autofix-changes">${changes}</ul>` : '',
          })
          return
        }
        ctx.error = outcome.error
        ctx.log = outcome.log
      }
    } catch (err) {
      showStopped(card, ctx, 'Correction automatique indisponible', err.message, begin)
    } finally {
      state.active = false
    }
  }

  function offer(ctx) {
    if (state.active) return
    const card = mountCard(ctx.anchorId)
    const hint = explain(`${ctx.error || ''}\n${ctx.log || ''}`)
    render(card, {
      tone: 'error',
      title: hint.title,
      text: `${hint.text} Copilot peut le corriger à votre place : il analyse le poste, répare les chemins et les dépendances, puis relance l’installation (5 tentatives maximum).`,
      extra: details(ctx.log),
      actions: '<button type="button" class="btn-primary btn-sm" data-autofix="go">Laisser Copilot corriger</button>',
    })
    bind(card, { go: () => { void start(ctx) } })
  }

  function clear() {
    if (state.active) return
    document.getElementById('autofixCard')?.remove()
  }

  global.InstallAutofix = {
    offer,
    clear,
    isActive: () => state.active,
  }
})(typeof window !== 'undefined' ? window : globalThis)

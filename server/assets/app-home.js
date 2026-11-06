/**
 * Accueil « Que voulez-vous mettre en place ? » — rendu à partir du modèle /api/app/model.
 * Aucune liste de parcours ici : tout vient du registre (server/lib/app-registry.json).
 */
;(function (global) {
  const SESSION_KEY = 'wizardQa.launchDisclaimerShown'
  const CTA_LABEL = { start: 'Commencer', resume: 'Continuer', review: 'Revoir' }

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function assetUrl(path) {
    const base = global.__WIZARD_API_BASE__ || ''
    return base ? `${base.replace(/\/$/, '')}${path}` : path
  }

  function href(page, journeyId) {
    const target = journeyId ? `${page.path}${page.path.includes('?') ? '&' : '?'}journey=${encodeURIComponent(journeyId)}` : page.path
    return global.Portail?.pageUrl ? global.Portail.pageUrl(target) : target
  }

  function journeyMode(journey) {
    if (journey.complete) return 'review'
    return journey.doneCount > 0 ? 'resume' : 'start'
  }

  function entryPage(model, journey) {
    return model.pages[journey.nextStep || journey.steps[0]]
  }

  function pendingPrerequisites(model, page) {
    return (page.prerequisites || []).filter((id) => model.statuses[id]?.state !== 'done').length
  }

  function pickFocus(model) {
    const open = model.journeys.filter((j) => !j.complete)
    return open.find((j) => j.doneCount > 0) || open[0] || null
  }

  function pill(model, journey) {
    const state = model.statuses[journey.nextStep || journey.steps[0]]?.state
    if (journey.complete) return { tone: 'done', text: 'Prêt' }
    const pending = pendingPrerequisites(model, entryPage(model, journey))
    if (pending > 0) return { tone: 'todo', text: `${pending} prérequis du poste` }
    return state === 'blocked' ? { tone: 'blocked', text: 'Pas encore disponible' } : { tone: 'todo', text: 'À faire' }
  }

  function renderStepper(model, journey) {
    if (journey.steps.length < 2) return ''
    const items = journey.steps.map((id, i) => {
      const state = model.statuses[id]?.state || 'info'
      const mark = state === 'done' ? '&#10003;' : String(i + 1)
      return `<li class="ah-st ah-st--${esc(state)}"><span class="ah-st-dot" aria-hidden="true">${mark}</span><a href="${esc(href(model.pages[id], journey.id))}">${esc(model.pages[id].label)}</a></li>`
    }).join('')
    return `<ol class="ah-stepper">${items}</ol>`
  }

  function renderTile(model, journey) {
    const mode = journeyMode(journey)
    const entry = entryPage(model, journey)
    const p = pill(model, journey)
    return `
      <article class="ah-tile${journey.complete ? ' is-complete' : ''}">
        <div class="ah-tile-head">
          <span class="ah-ico"><img src="${esc(assetUrl(journey.logo))}" alt="" width="22" height="22" /></span>
          <div class="ah-tile-text">
            <h3>${esc(journey.title)}</h3>
            <p>${esc(journey.summary)}</p>
          </div>
        </div>
        ${renderStepper(model, journey)}
        <div class="ah-tile-foot">
          <span class="ah-pill ah-pill--${esc(p.tone)}">${esc(p.text)}</span>
          <a class="ah-btn${mode === 'review' ? ' ah-btn--ghost' : ''}" href="${esc(href(entry, journey.id))}">${esc(CTA_LABEL[mode])}</a>
        </div>
      </article>`
  }

  function renderStrip(model) {
    if (model.project?.needsOnboarding) {
      return `
        <section class="ah-strip ah-strip--warn">
          <div class="ah-strip-text"><strong>Commencez par décrire votre projet</strong><span>2 minutes : l'assistant préremplit ensuite tous les écrans.</span></div>
          <a class="ah-btn" href="${esc(href(model.pages.projet))}">Décrire mon projet</a>
        </section>`
    }
    const journey = pickFocus(model)
    if (!journey) {
      return '<section class="ah-strip ah-strip--ok"><div class="ah-strip-text"><strong>Tout est en place</strong><span>Tous vos objectifs sont terminés.</span></div></section>'
    }
    const page = entryPage(model, journey)
    const pending = pendingPrerequisites(model, page)
    const detail = pending > 0
      ? `L'assistant vérifie d'abord votre poste (${pending} point${pending > 1 ? 's' : ''}), puis vous guide.`
      : `Prochaine étape : ${esc(page.label)}`
    const lead = journey.doneCount > 0 ? 'Reprendre' : 'Conseillé'
    return `
      <section class="ah-strip">
        <span class="ah-kicker">${lead}</span>
        <div class="ah-strip-text"><strong>${esc(journey.title)}</strong><span>${detail}</span></div>
        <a class="ah-btn" href="${esc(href(page, journey.id))}">${esc(CTA_LABEL[journeyMode(journey)])}</a>
      </section>`
  }

  function renderLinks(model) {
    const items = [
      { label: 'Mon projet et sauvegarde', page: model.pages.projet },
      { label: 'Aide et documentation', page: model.pages.wiki },
    ].filter((i) => i.page)
    return `
      <footer class="ah-links">
        <span>Un souci pendant une installation ? Copilot propose de le corriger tout seul.</span>
        ${items.map((i) => `<a href="${esc(href(i.page))}">${esc(i.label)}</a>`).join('')}
      </footer>`
  }

  function render(model) {
    const root = document.getElementById('appHome')
    if (!root) return
    root.innerHTML = `
      <header class="ah-hero">
        <h1>Que voulez-vous mettre en place ?</h1>
        <p>Choisissez un objectif : l'assistant vous guide pas à pas, sans compétence technique.</p>
      </header>
      ${renderStrip(model)}
      <section class="ah-grid" aria-label="Objectifs">${model.journeys.map((j) => renderTile(model, j)).join('')}</section>
      ${renderLinks(model)}`
  }

  function renderError() {
    const root = document.getElementById('appHome')
    if (!root) return
    root.innerHTML = `
      <section class="ah-strip ah-strip--warn">
        <div class="ah-strip-text"><strong>Accueil indisponible</strong><span>Le serveur ne répond pas. Lancez « Wizard QA : Redémarrer le serveur », puis rechargez.</span></div>
        <button type="button" class="ah-btn" id="ahRetry">Réessayer</button>
      </section>`
    document.getElementById('ahRetry')?.addEventListener('click', () => global.location.reload())
  }

  async function showLaunchNotice() {
    if (typeof global.WizardDisclaimer === 'undefined') return
    try {
      if (global.sessionStorage.getItem(SESSION_KEY)) return
      global.sessionStorage.setItem(SESSION_KEY, '1')
    } catch { /* stockage indisponible : on affiche */ }
    const shown = await global.WizardDisclaimer.show('launchDisclaimer', { force: true })
    if (shown) await global.WizardDisclaimer.waitUntilClosed()
  }

  function whenModel() {
    return new Promise((resolve) => {
      if (global.AppShell?.model) {
        resolve(global.AppShell.model)
        return
      }
      global.addEventListener('appshell:ready', (e) => resolve(e.detail.model), { once: true })
      setTimeout(() => resolve(null), 10000)
    })
  }

  async function boot() {
    const model = await whenModel()
    if (!model) {
      renderError()
      return
    }
    render(model)
    void showLaunchNotice()
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
  else boot()
})(typeof window !== 'undefined' ? window : globalThis)

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

  function journeyEntryPage(model, journey) {
    return model.pages[journey.nextStep || journey.steps[0]]
  }

  function pickFocus(model) {
    const open = model.journeys.filter((j) => !j.complete)
    return open.find((j) => j.doneCount > 0) || open[0] || null
  }

  function stepIcon(state, index) {
    if (state === 'done') return '<span class="ah-step-icon ah-step-icon--done" aria-hidden="true">&#10003;</span>'
    if (state === 'blocked') return `<span class="ah-step-icon ah-step-icon--blocked" aria-hidden="true">${index}</span>`
    return `<span class="ah-step-icon ah-step-icon--todo" aria-hidden="true">${index}</span>`
  }

  function renderOnboardingCard(model) {
    if (!model.project?.needsOnboarding) return ''
    const page = model.pages.projet
    return `
      <section class="ah-callout">
        <div>
          <h2>Commencez par décrire votre projet</h2>
          <p>Deux minutes pour indiquer votre équipe et votre application : l'assistant préremplira ensuite tous les écrans.</p>
        </div>
        <a class="btn-primary" href="${esc(href(page))}">Décrire mon projet</a>
      </section>`
  }

  function renderFocus(model) {
    const journey = pickFocus(model)
    if (!journey) {
      return `
        <section class="ah-focus ah-focus--done">
          <h2>Tout est en place</h2>
          <p>Tous vos parcours sont terminés. Vous pouvez les revoir à tout moment.</p>
        </section>`
    }
    const page = journeyEntryPage(model, journey)
    const status = model.statuses[journey.nextStep] || {}
    const lead = journey.doneCount > 0 ? 'Reprendre là où vous en étiez' : 'Par où commencer ?'
    return `
      <section class="ah-focus">
        <span class="ah-kicker">${esc(lead)}</span>
        <h2>${esc(journey.title)}</h2>
        <p>Prochaine étape : <strong>${esc(page.label)}</strong>${status.message ? ` &mdash; ${esc(status.message)}` : ''}</p>
        <a class="btn-primary" href="${esc(href(page, journey.id))}">${esc(CTA_LABEL[journeyMode(journey)])}</a>
      </section>`
  }

  function renderJourney(model, journey) {
    const mode = journeyMode(journey)
    const entry = journeyEntryPage(model, journey)
    const percent = journey.total ? Math.round((journey.doneCount / journey.total) * 100) : 0
    const steps = journey.steps.map((id, i) => {
      const page = model.pages[id]
      const st = model.statuses[id] || { state: 'info', message: '' }
      return `
        <li class="ah-step ah-step--${esc(st.state)}">
          ${stepIcon(st.state, i + 1)}
          <a href="${esc(href(page, journey.id))}">${esc(page.label)}</a>
          ${st.message ? `<span class="ah-step-msg">${esc(st.message)}</span>` : ''}
        </li>`
    }).join('')

    return `
      <article class="ah-journey${journey.complete ? ' is-complete' : ''}">
        <header class="ah-journey-head">
          <img src="${esc(assetUrl(journey.logo))}" alt="" width="36" height="36" />
          <div>
            <h3>${esc(journey.title)}</h3>
            <p>${esc(journey.summary)}</p>
          </div>
        </header>
        ${journey.total ? `
        <div class="ah-progress" role="progressbar" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100" aria-label="Avancement">
          <div class="ah-progress-fill" style="width:${percent}%"></div>
        </div>
        <p class="ah-progress-label">${journey.doneCount} étape${journey.doneCount > 1 ? 's' : ''} terminée${journey.doneCount > 1 ? 's' : ''} sur ${journey.total}</p>` : ''}
        <ol class="ah-steps">${steps}</ol>
        <a class="${mode === 'review' ? 'btn-secondary' : 'btn-primary'}" href="${esc(href(entry, journey.id))}">${esc(CTA_LABEL[mode])}</a>
      </article>`
  }

  function renderHelp(model) {
    const cards = [
      { title: 'Un problème pendant une installation ?', text: 'Copilot analyse votre poste, répare les chemins et les dépendances, puis relance l’installation. Le bouton apparaît tout seul en cas d’échec.' },
      { title: 'Mon projet et sauvegarde', text: 'Modifiez les informations de votre équipe, exportez ou importez votre configuration.', page: model.pages.projet },
      { title: 'Aide et documentation', text: 'Le Wiki explique chaque outil avec des mots simples.', page: model.pages.wiki },
    ]
    return `
      <section class="ah-help">
        ${cards.map((c) => `
          <div class="ah-help-card">
            <h3>${esc(c.title)}</h3>
            <p>${esc(c.text)}</p>
            ${c.page ? `<a href="${esc(href(c.page))}">Ouvrir</a>` : ''}
          </div>`).join('')}
      </section>`
  }

  function render(model) {
    const root = document.getElementById('appHome')
    if (!root) return
    root.innerHTML = `
      <header class="ah-hero">
        <h1>Que voulez-vous mettre en place ?</h1>
        <p>Choisissez un objectif. L'assistant vous guide étape par étape : aucune compétence technique n'est nécessaire.</p>
      </header>
      ${renderOnboardingCard(model)}
      ${renderFocus(model)}
      <section class="ah-journeys" aria-label="Objectifs">${model.journeys.map((j) => renderJourney(model, j)).join('')}</section>
      ${renderHelp(model)}`
  }

  function renderError() {
    const root = document.getElementById('appHome')
    if (!root) return
    root.innerHTML = `
      <section class="ah-callout">
        <div>
          <h2>Accueil indisponible</h2>
          <p>Le serveur de l'assistant ne répond pas. Lancez la commande « Wizard QA : Redémarrer le serveur », puis rechargez.</p>
        </div>
        <button type="button" class="btn-primary" id="ahRetry">Réessayer</button>
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

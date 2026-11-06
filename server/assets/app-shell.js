/**
 * Shell applicatif : en-tête de marque, navigation latérale, guide de page et étape suivante.
 * La navigation, les guides et les statuts viennent de /api/app/model (registre app-registry.json) :
 * aucun menu n'est codé ici.
 */
;(function (global) {
  const STATE_LABEL = { done: 'Terminé', todo: 'À faire', blocked: 'Bloqué', info: '' }
  const GUIDE_KEY = 'wizardQa.guideCollapsed'

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

  function currentPath() {
    const p = global.location.pathname || '/'
    return p.endsWith('/') && p.length > 1 ? p.slice(0, -1) : p
  }

  function pageHref(page, journeyId) {
    let href = page.path
    if (journeyId) href += `${href.includes('?') ? '&' : '?'}journey=${encodeURIComponent(journeyId)}`
    return global.Portail && typeof global.Portail.pageUrl === 'function' ? global.Portail.pageUrl(href) : href
  }

  function findPageId(model, path) {
    return Object.keys(model.pages).find((id) => (model.pages[id].match || [model.pages[id].path]).includes(path)) || null
  }

  function journeyContext(model, pageId) {
    const wanted = new URLSearchParams(global.location.search).get('journey')
    const journeys = model.journeys.filter((j) => j.steps.includes(pageId))
    return journeys.find((j) => j.id === wanted) || journeys[0] || null
  }

  function navSections(model) {
    return model.nav.map((section) => {
      const journey = section.journey ? model.journeys.find((j) => j.id === section.journey) : null
      const ids = journey
        ? journey.steps.filter((id) => !(section.skip || []).includes(id))
        : (section.pages || [])
      return { title: section.title, help: section.help, journeyId: journey?.id || null, ids: ids.filter((id) => model.pages[id]) }
    })
  }

  function buildHeader() {
    const header = document.createElement('header')
    header.className = 'ks-brand'
    header.setAttribute('role', 'banner')
    header.innerHTML = `
      <div class="ks-brand-row">
        <button type="button" class="ks-menu-btn" aria-label="Ouvrir la navigation" aria-expanded="false">&#9776;</button>
        <img class="ks-brand-logo" src="${esc(assetUrl('/assets/logo-qa.png'))}" alt="" width="36" height="36" />
        <div class="ks-brand-titles">
          <span class="ks-brand-name">Wizard QA Assistant</span>
          <span class="ks-brand-sub">Installez et pilotez votre stack de test pas à pas &mdash; poste CA-TS</span>
        </div>
        <span class="ks-brand-spacer"></span>
        <img class="ks-brand-ca" src="${esc(assetUrl('/assets/logo-cats-full.png'))}" alt="Crédit Agricole Technologies et Services" />
      </div>
      <div class="ks-brand-accent"></div>`
    return header
  }

  function buildSidebarShell() {
    const aside = document.createElement('aside')
    aside.className = 'ks-sidebar'
    aside.setAttribute('aria-label', 'Navigation')
    aside.innerHTML = `
      <div class="ks-side-brand">
        <span class="ks-side-name">Wizard QA</span>
        <span class="ks-side-tagline">Assistant d'installation</span>
        <span class="ks-badge" id="ksProjectBadge">Mode poste local</span>
      </div>
      <nav class="ks-nav" id="ksNav" aria-label="Parcours"></nav>
      <div class="ks-side-footer"><span class="ks-chip">Copilot local &middot; sans serveur externe</span></div>`
    return aside
  }

  function renderNav(model, path) {
    const activeId = findPageId(model, path)
    const html = navSections(model).map((section) => {
      const items = section.ids.map((id) => {
        const page = model.pages[id]
        const st = model.statuses[id] || { state: 'info', message: '' }
        const active = id === activeId
        const label = STATE_LABEL[st.state]
        return `<a class="ks-nav-item${active ? ' is-active' : ''}" href="${esc(pageHref(page, section.journeyId))}"${active ? ' aria-current="page"' : ''} title="${esc(st.message || page.label)}">
          <span class="ks-nav-dot ks-nav-dot--${esc(st.state)}" aria-hidden="true"></span>
          <span class="ks-nav-label">${esc(page.label)}</span>
          ${label ? `<span class="ks-nav-state ks-nav-state--${esc(st.state)}">${esc(label)}</span>` : ''}</a>`
      }).join('')
      return `<div class="ks-nav-section"><div class="ks-nav-title" title="${esc(section.help || '')}">${esc(section.title)}</div>${items}</div>`
    }).join('')
    const nav = document.getElementById('ksNav')
    if (nav) nav.innerHTML = html

    const badge = document.getElementById('ksProjectBadge')
    if (badge && model.project?.name) badge.textContent = model.project.name
  }

  function guideCollapsed(pageId) {
    try {
      return Boolean(JSON.parse(global.localStorage.getItem(GUIDE_KEY) || '{}')[pageId])
    } catch {
      return false
    }
  }

  function rememberGuide(pageId, collapsed) {
    try {
      const all = JSON.parse(global.localStorage.getItem(GUIDE_KEY) || '{}')
      all[pageId] = collapsed
      global.localStorage.setItem(GUIDE_KEY, JSON.stringify(all))
    } catch { /* stockage indisponible */ }
  }

  function renderGuide(model, pageId, main) {
    const page = model.pages[pageId]
    if (!page?.guide) return
    const journey = journeyContext(model, pageId)
    const position = journey ? journey.steps.indexOf(pageId) + 1 : 0
    const st = model.statuses[pageId]
    const steps = (page.guide.youDo || []).map((s) => `<li>${esc(s)}</li>`).join('')

    const section = document.createElement('details')
    section.className = 'ks-guide'
    section.open = !guideCollapsed(pageId)
    section.innerHTML = `
      <summary>
        <span class="ks-guide-kicker">${journey ? `${esc(journey.title)} &middot; étape ${position} sur ${journey.steps.length}` : 'Guide'}</span>
        <span class="ks-guide-title">${esc(page.label)}</span>
        ${st && STATE_LABEL[st.state] ? `<span class="ks-nav-state ks-nav-state--${esc(st.state)}">${esc(STATE_LABEL[st.state])}</span>` : ''}
      </summary>
      <div class="ks-guide-body">
        <p class="ks-guide-goal">${esc(page.guide.goal)}</p>
        ${steps ? `<p class="ks-guide-label">Ce que vous avez à faire</p><ol class="ks-guide-steps">${steps}</ol>` : ''}
        ${page.guide.after ? `<p class="ks-guide-after"><strong>Ensuite :</strong> ${esc(page.guide.after)}</p>` : ''}
        ${st?.state === 'blocked' ? `<p class="ks-guide-blocked">${esc(st.message)}</p>` : ''}
      </div>`
    section.addEventListener('toggle', () => rememberGuide(pageId, !section.open))
    main.insertBefore(section, main.firstChild)
  }

  function renderNextStep(model, pageId, main) {
    const journey = journeyContext(model, pageId)
    if (!journey) return
    const next = journey.steps[journey.steps.indexOf(pageId) + 1]
    if (!next || !model.pages[next]) return
    const ready = model.statuses[pageId]?.state === 'done' || model.statuses[pageId]?.state === 'info'
    const bar = document.createElement('div')
    bar.className = `ks-next${ready ? ' is-ready' : ''}`
    bar.innerHTML = `
      <span class="ks-next-text">${ready ? 'Cette étape est terminée.' : 'Terminez cette étape pour continuer.'} Prochaine étape : <strong>${esc(model.pages[next].label)}</strong></span>
      <a class="btn-primary btn-sm ks-next-btn" href="${esc(pageHref(model.pages[next], journey.id))}">Étape suivante</a>`
    main.appendChild(bar)
  }

  async function fetchModel() {
    const res = await fetch(assetUrl('/api/app/model'))
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  }

  function build() {
    const body = document.body
    if (!body || body.classList.contains('ks-on')) return null

    body.querySelectorAll('.wizard-brand-bar').forEach((el) => el.remove())

    const movable = Array.from(body.childNodes).filter((node) => {
      if (node.nodeType !== 1) return false
      const tag = node.tagName
      return tag !== 'SCRIPT' && tag !== 'LINK' && tag !== 'STYLE' && !node.classList.contains('wizard-footer')
    })

    const main = document.createElement('div')
    main.className = 'ks-main'
    movable.forEach((node) => main.appendChild(node))

    const aside = buildSidebarShell()
    const row = document.createElement('div')
    row.className = 'ks-body'
    row.append(aside, main)

    const header = buildHeader()
    body.classList.add('ks-on')
    body.insertBefore(row, body.firstChild)
    body.insertBefore(header, row)

    const btn = header.querySelector('.ks-menu-btn')
    btn.addEventListener('click', () => {
      const open = aside.classList.toggle('is-open')
      btn.setAttribute('aria-expanded', String(open))
    })
    return main
  }

  const AppShell = { model: null, ready: null }

  async function boot() {
    const main = build()
    if (!main) return
    const path = currentPath()
    AppShell.ready = fetchModel()
      .then((model) => {
        AppShell.model = model
        renderNav(model, path)
        const pageId = findPageId(model, path)
        if (pageId) {
          renderGuide(model, pageId, main)
          renderNextStep(model, pageId, main)
        }
        global.dispatchEvent(new CustomEvent('appshell:ready', { detail: { model, pageId } }))
        return model
      })
      .catch(() => {
        global.dispatchEvent(new CustomEvent('appshell:ready', { detail: { model: null, pageId: null } }))
        return null
      })
    await AppShell.ready
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
  else boot()

  global.AppShell = AppShell
})(typeof window !== 'undefined' ? window : globalThis)

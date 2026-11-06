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
      return { title: section.title, help: section.help, journeyId: journey?.id || null, ids: ids.filter((id) => model.pages[id] && !model.pages[id].hidden) }
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

  const ICONS = {
    check: '<svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    lock: '<svg viewBox="0 0 16 16" width="9" height="9" aria-hidden="true"><rect x="3.5" y="7" width="9" height="6.5" rx="1.5" fill="currentColor"/><path d="M5.5 7V5.2a2.5 2.5 0 015 0V7" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
    chevron: '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  }
  const COLLAPSED_KEY = 'wizardQa.navCollapsed'

  function stateIcon(state) {
    const inner = state === 'done' ? ICONS.check : state === 'blocked' ? ICONS.lock : ''
    return `<span class="ks-ico ks-ico--${esc(state)}">${inner}</span>`
  }

  function readCollapsed() {
    try {
      return JSON.parse(global.localStorage.getItem(COLLAPSED_KEY) || '{}')
    } catch {
      return {}
    }
  }

  function buildSidebarShell() {
    const aside = document.createElement('aside')
    aside.className = 'ks-sidebar'
    aside.setAttribute('aria-label', 'Navigation')
    aside.innerHTML = `
      <div class="ks-side-top" id="ksSideTop"></div>
      <nav class="ks-nav" id="ksNav" aria-label="Parcours"></nav>
      <div class="ks-side-footer">
        <span class="ks-live" aria-hidden="true"></span>
        <div><strong>Copilot local</strong><span>Corrige vos installations en cas d'échec</span></div>
      </div>`
    return aside
  }

  function overallProgress(model) {
    const tracked = Object.keys(model.pages).filter((id) => model.pages[id].tracked && !model.pages[id].hidden)
    const done = tracked.filter((id) => model.statuses[id]?.state === 'done').length
    return { done, total: tracked.length, percent: tracked.length ? Math.round((done / tracked.length) * 100) : 0 }
  }

  function renderSideTop(model) {
    const needs = model.project?.needsOnboarding
    const name = needs ? 'Projet à décrire' : (model.project?.name || 'Mon projet')
    const sub = needs
      ? 'Renseignez vos informations'
      : [model.project?.tribu, model.project?.squad].filter(Boolean).join(' · ') || 'Informations projet'
    const progress = overallProgress(model)
    const host = document.getElementById('ksSideTop')
    if (!host) return
    host.innerHTML = `
      <a class="ks-project" href="${esc(pageHref(model.pages.projet || { path: '/projet.html' }))}" title="Modifier mon projet">
        <span class="ks-avatar" aria-hidden="true">${esc((name.trim()[0] || 'W').toUpperCase())}</span>
        <span class="ks-project-text"><strong>${esc(name)}</strong><span>${esc(sub)}</span></span>
      </a>
      <div class="ks-overall" title="${progress.done} sur ${progress.total} étapes terminées">
        <div class="ks-overall-head"><span>Progression</span><b>${progress.done}/${progress.total}</b></div>
        <div class="ks-bar"><i style="width:${progress.percent}%"></i></div>
      </div>`
  }

  function renderNav(model, path) {
    const activeId = findPageId(model, path)
    const collapsed = readCollapsed()
    const html = navSections(model).map((section) => {
      const journey = section.journeyId ? model.journeys.find((j) => j.id === section.journeyId) : null
      const hasActive = section.ids.includes(activeId)
      const open = hasActive || !collapsed[section.title]
      const count = journey && journey.total > 1 ? `<span class="ks-group-count">${journey.doneCount}/${journey.total}</span>` : ''
      const items = section.ids.map((id) => {
        const page = model.pages[id]
        const st = model.statuses[id] || { state: 'info', message: '' }
        const active = id === activeId
        return `<a class="ks-item ks-item--${esc(st.state)}${active ? ' is-active' : ''}" href="${esc(pageHref(page, section.journeyId))}"${active ? ' aria-current="page"' : ''} title="${esc(st.message ? `${page.label} — ${st.message}` : page.label)}">
          ${stateIcon(st.state)}<span class="ks-item-label">${esc(page.label)}</span></a>`
      }).join('')
      return `<section class="ks-group${open ? '' : ' is-collapsed'}${section.journeyId ? ' ks-group--steps' : ''}">
        <button type="button" class="ks-group-head" data-group="${esc(section.title)}" aria-expanded="${open}" title="${esc(section.help || '')}">
          <span class="ks-group-title">${esc(section.title)}</span>${count}<span class="ks-chev">${ICONS.chevron}</span>
        </button>
        <div class="ks-group-items">${items}</div>
      </section>`
    }).join('')
    const nav = document.getElementById('ksNav')
    if (!nav) return
    nav.innerHTML = html
    nav.querySelectorAll('.ks-group-head').forEach((btn) => {
      btn.addEventListener('click', () => {
        const group = btn.closest('.ks-group')
        const nowCollapsed = !group.classList.contains('is-collapsed')
        group.classList.toggle('is-collapsed', nowCollapsed)
        btn.setAttribute('aria-expanded', String(!nowCollapsed))
        const all = readCollapsed()
        all[btn.dataset.group] = nowCollapsed
        try {
          global.localStorage.setItem(COLLAPSED_KEY, JSON.stringify(all))
        } catch { /* stockage indisponible */ }
      })
    })
    renderSideTop(model)
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

  function renderPrerequisites(model, page) {
    if (!page.prerequisites?.length) return ''
    const rows = page.prerequisites.map((id) => {
      const req = model.pages[id]
      const st = model.statuses[id] || { state: 'todo', message: '' }
      const action = st.state === 'done'
        ? ''
        : `<a class="btn-secondary btn-sm" href="${esc(pageHref(req))}">Configurer</a>`
      return `<li class="ks-prereq ks-prereq--${esc(st.state)}">
        <span class="ks-nav-dot ks-nav-dot--${esc(st.state)}" aria-hidden="true"></span>
        <span class="ks-prereq-label">${esc(req.label)}<small>${esc(st.message)}</small></span>${action}</li>`
    }).join('')
    return `<p class="ks-guide-label">Avant de commencer</p><ul class="ks-prereqs">${rows}</ul>`
  }

  function guideKicker(model, page, journey, position) {
    if (journey) return `${esc(journey.title)} &middot; étape ${position} sur ${journey.steps.length}`
    const parent = (page.requiredBy || []).map((id) => model.pages[id]).find(Boolean)
    return parent ? `Prérequis · ${esc(parent.label)}` : 'Guide'
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
        <span class="ks-guide-kicker">${guideKicker(model, page, journey, position)}</span>
        <span class="ks-guide-title">${esc(page.label)}</span>
        ${st && STATE_LABEL[st.state] ? `<span class="ks-nav-state ks-nav-state--${esc(st.state)}">${esc(STATE_LABEL[st.state])}</span>` : ''}
      </summary>
      <div class="ks-guide-body">
        <p class="ks-guide-goal">${esc(page.guide.goal)}</p>
        ${renderPrerequisites(model, page)}
        ${steps ? `<p class="ks-guide-label">Ce que vous avez à faire</p><ol class="ks-guide-steps">${steps}</ol>` : ''}
        ${page.guide.after ? `<p class="ks-guide-after"><strong>Ensuite :</strong> ${esc(page.guide.after)}</p>` : ''}
        ${st?.state === 'blocked' ? `<p class="ks-guide-blocked">${esc(st.message)}</p>` : ''}
      </div>`
    section.addEventListener('toggle', () => rememberGuide(pageId, !section.open))
    main.insertBefore(section, main.firstChild)
  }

  function renderNextStep(model, pageId, main) {
    const journey = journeyContext(model, pageId)
    if (!journey) {
      const parent = (model.pages[pageId].requiredBy || []).map((id) => model.pages[id]).find(Boolean)
      if (!parent) return
      const back = document.createElement('div')
      back.className = 'ks-next is-ready'
      back.innerHTML = `
        <span class="ks-next-text">Quand ce prérequis est prêt, reprenez l'installation.</span>
        <a class="btn-primary btn-sm ks-next-btn" href="${esc(pageHref(parent))}">Retour : ${esc(parent.label)}</a>`
      main.appendChild(back)
      return
    }
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

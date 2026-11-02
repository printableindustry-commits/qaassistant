/**
 * Wiki Wizard QA — documentation interactive (thème npmrc compact).
 */
const WikiPage = {
  activeSection: 'intro',

  stackProfiles: {
    cypress: {
      logo: '/assets/logo-cypress.png',
      label: 'Cypress',
      href: '/repair.html',
      desc: 'Node & dépendances',
    },
    robot: {
      logo: '/assets/logo-robot.png',
      label: 'Robot Framework',
      href: '/',
      desc: 'Initialisation stack',
    },
    playwright: {
      logo: '/assets/logo-playwright.png',
      label: 'Playwright',
      href: '/',
      desc: 'Initialisation stack',
    },
    postman: {
      logo: '/assets/logo-postman.png',
      label: 'Postman',
      href: '/postman-install.html',
      desc: 'Collections API',
    },
    k6: {
      logo: '/assets/logo-k6.png',
      label: 'k6',
      href: '/k6-install.html',
      desc: 'Tests de performance',
    },
  },

  recommendedStack: {
    id: 'cypress',
    label: 'Cypress',
  },

  trail: [
    { id: 'profil', label: 'Profil projet', href: '/', logo: '/assets/logo-qa.png', desc: 'Tribu, codes JIRA, plans' },
    { id: 'npmrc', label: '.npmrc', href: '/npmrc.html', logo: '/assets/logo-npm.png', desc: 'Registry & proxy' },
    { id: 'nodeInstall', label: 'Node.js', href: '/node-install.html', logo: '/assets/logo-npm.png', desc: 'Volta & package.json' },
    { id: 'npmInstall', label: 'npm install', href: '/npm-install.html', logo: '/assets/logo-npm.png', desc: 'Dépendances projet' },
    { id: 'stack', label: 'Stack test', href: '/wiki.html#cypress', logo: '/assets/logo-cypress.png', desc: 'Questionnaire orientation' },
    { id: 'repair', label: 'Stack', href: '/repair.html', logo: '/assets/logo-cypress.png', desc: 'Initialiser la stack' },
    { id: 'hook', label: 'Hook Git', href: '/hook-git.html', logo: '/assets/logo-git-hook.png', desc: '.env, hooks.conf' },
    { id: 'sync', label: 'Sync JIRA', href: '/project.html', logo: '/assets/logo-jira.png', desc: 'Local ↔ Xray' },
    { id: 'doc', label: 'Livrables QA', href: '/doc-qa.html', logo: '/assets/logo-qa.png', desc: 'Documentation IA' },
  ],

  sections: [],

  buildSections() {
    const base = typeof WikiSections !== 'undefined' ? [...WikiSections] : []
    if (base.some((s) => s.id === 'cypress')) return base

    const stacks = typeof WikiStackSections !== 'undefined' ? WikiStackSections : []
    if (!stacks.length) return base

    const idx = base.findIndex((s) => s.id === 'fichiers')
    if (idx === -1) return [...base, ...stacks]
    return [...base.slice(0, idx), ...stacks, ...base.slice(idx)]
  },

  pageUrl(href) {
    return typeof Portail !== 'undefined' && Portail.pageUrl ? Portail.pageUrl(href) : href
  },

  assetUrl(path) {
    const base = window.__WIZARD_API_BASE__ || ''
    return base ? `${base.replace(/\/$/, '')}${path}` : path
  },

  getLocalStackChoice() {
    try {
      const raw = sessionStorage.getItem('wizardQa.localStackChoice')
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  },

  applyRecommendedStackToTrail() {
    const profile = this.stackProfiles[this.recommendedStack.id] || this.stackProfiles.cypress
    const label = this.recommendedStack.label || profile.label

    const stackStep = this.trail.find((s) => s.id === 'stack')
    if (stackStep) {
      stackStep.logo = profile.logo
      stackStep.label = label
      stackStep.desc = 'Questionnaire — stack retenue'
    }

    const repairStep = this.trail.find((s) => s.id === 'repair')
    if (repairStep) {
      repairStep.logo = profile.logo
      repairStep.label = label
      repairStep.href = profile.href
      repairStep.desc = this.recommendedStack.id === 'cypress' ? 'Node & dépendances' : 'Initialiser la stack'
    }

    const note = document.getElementById('wikiTrailStackNote')
    if (note) {
      note.hidden = false
      note.innerHTML = `Stack recommandée par le questionnaire : <strong>${label}</strong> — les étapes 3 et 4 du parcours utilisent ce logo.`
    }
  },

  async loadRecommendedStack() {
    try {
      const base = window.__WIZARD_API_BASE__ || ''
      const url = base ? `${base.replace(/\/$/, '')}/api/home/catalog` : '/api/home/catalog'
      const r = await fetch(url)
      if (r.ok) {
        const data = await r.json()
        const id = data.recommendedStack
          || data.project?.recommendedStack
          || null
        if (id && this.stackProfiles[id]) {
          this.recommendedStack = {
            id,
            label: data.project?.recommendedStackLabel
              || data.stackRecommendation?.recommendedLabel
              || this.stackProfiles[id].label,
          }
          return
        }
      }
    } catch { /* ignore */ }

    const local = this.getLocalStackChoice()
    if (local?.stackId && this.stackProfiles[local.stackId]) {
      this.recommendedStack = {
        id: local.stackId,
        label: local.label || this.stackProfiles[local.stackId].label,
      }
    }
  },

  renderTrail() {
    const root = document.getElementById('wikiTrail')
    if (!root) return
    root.innerHTML = this.trail.map((step, i) => `
      <a class="wiki-trail-step${step.id === 'repair' || step.id === 'stack' ? ' wiki-trail-step--stack' : ''}" href="${this.pageUrl(step.href)}" title="${step.desc}">
        <span class="wiki-trail-num">${i + 1}</span>
        <img class="wiki-trail-logo" src="${this.assetUrl(step.logo)}" alt="" width="24" height="24" />
        <span class="wiki-trail-label">${step.label}</span>
        <span class="wiki-trail-desc">${step.desc}</span>
      </a>`).join('')
  },

  renderNav() {
    const nav = document.getElementById('wikiNav')
    if (!nav) return
    nav.innerHTML = `<ul class="wiki-nav-list">${this.sections.map((s) => `
      <li><button type="button" class="wiki-nav-link${s.id === this.activeSection ? ' is-active' : ''}" data-wiki-nav="${s.id}">${s.title}</button></li>`).join('')}</ul>`
  },

  patchMainLinks(root) {
    if (!root) return
    root.querySelectorAll('a[href^="/"]').forEach((a) => {
      const h = a.getAttribute('href')
      if (h) a.setAttribute('href', this.pageUrl(h))
    })
    root.querySelectorAll('img[src^="/"]').forEach((img) => {
      const s = img.getAttribute('src')
      if (s) img.setAttribute('src', this.assetUrl(s))
    })
  },

  showSection(id) {
    const section = this.sections.find((s) => s.id === id) || this.sections[0]
    if (!section) return
    this.activeSection = section.id

    const main = document.getElementById('wikiMain')
    if (!main) return

    main.innerHTML = `
      <article class="card card-compact wiki-section-panel" id="${section.id}" data-wiki-section>
        <header class="wiki-section-panel-head">
          <h2 class="wiki-section-title">${section.title}</h2>
        </header>
        <div class="wiki-section-body">${section.body}</div>
      </article>`

    this.patchMainLinks(main)
    this.initSectionNavLinks(main)
    this.initCopyButtons(main)
    this.renderNav()
    this.setNavActive(section.id)

    if (location.hash !== `#${section.id}`) {
      history.replaceState(null, '', `#${section.id}`)
    }
    main.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  },

  setNavActive(id) {
    document.querySelectorAll('[data-wiki-nav]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.wikiNav === id)
    })
  },

  initSectionNavLinks(root) {
    if (!root) return
    root.querySelectorAll('[data-wiki-nav]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.preventDefault()
        this.showSection(el.dataset.wikiNav)
      })
    })
  },

  initPageNav() {
    document.getElementById('wikiNav')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-wiki-nav]')
      if (!btn) return
      e.preventDefault()
      this.showSection(btn.dataset.wikiNav)
    })
    document.getElementById('wikiNavHome')?.addEventListener('click', () => {
      this.showSection('intro')
    })
    window.addEventListener('hashchange', () => {
      const id = (location.hash || '#intro').slice(1)
      if (this.sections.some((s) => s.id === id) && id !== this.activeSection) {
        this.showSection(id)
      }
    })
  },

  renderSections() {
    const initial = (location.hash || '#intro').slice(1)
    const id = this.sections.some((s) => s.id === initial) ? initial : 'intro'
    this.showSection(id)
  },

  initCopyButtons(root = document) {
    root.querySelectorAll('.wiki-code').forEach((pre) => {
      if (pre.querySelector('.wiki-copy-btn')) return
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'wiki-copy-btn btn-secondary btn-sm'
      btn.textContent = 'Copier'
      btn.addEventListener('click', async () => {
        const code = pre.querySelector('code')?.textContent || pre.textContent || ''
        try {
          await navigator.clipboard.writeText(code.trim())
          btn.textContent = 'Copié'
          setTimeout(() => { btn.textContent = 'Copier' }, 1500)
        } catch {
          btn.textContent = 'Erreur'
        }
      })
      pre.classList.add('wiki-code-wrap')
      pre.appendChild(btn)
    })
  },

  async init() {
    this.sections = this.buildSections()

    const ver = document.getElementById('wikiVersionBadge')
    if (ver) ver.textContent = `v${window.__WIZARD_VERSION__ || '…'}`

    await this.loadRecommendedStack()
    this.applyRecommendedStackToTrail()
    this.renderTrail()
    this.renderNav()
    this.initPageNav()
    this.renderSections()
    Portail.applyEmbedLinks?.(document.querySelector('.wiki-app'))
  },
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => WikiPage.init())
} else {
  WikiPage.init()
}

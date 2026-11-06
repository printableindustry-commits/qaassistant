/**
 * Shell applicatif (en-tête de marque, navigation latérale, pied de page) — charte Kontext.AI.
 * Chargé par portail.js sur toutes les pages ; le contenu existant est déplacé dans .ks-main.
 */
;(function (global) {
  const NAV = [
    {
      title: 'Accueil',
      help: "Vue d'ensemble et progression",
      items: [{ label: 'Tableau de bord', href: '/', match: ['/', '/index.html'] }],
    },
    {
      title: 'Poste de travail',
      help: 'Node, registry npm et dépendances du projet',
      items: [
        { label: 'Installer Node', href: '/node-install.html' },
        { label: 'Registry npm (.npmrc)', href: '/npmrc.html' },
        { label: 'Installer NPM', href: '/npm-install.html' },
        { label: 'Pré-configuration poste', href: '/repair.html' },
      ],
    },
    {
      title: 'Stack de test',
      help: 'Tests end-to-end',
      items: [{ label: 'Installer Playwright', href: '/playwright-install.html' }],
    },
    {
      title: 'Performance k6',
      help: 'Tests de charge Grafana k6',
      items: [
        { label: 'Wizard performance', href: '/k6-wizard.html' },
        { label: 'Installation k6', href: '/k6-install.html' },
      ],
    },
    {
      title: 'JIRA et Git',
      help: 'Synchronisation des tests avec JIRA / Xray',
      items: [
        { label: 'Hook Git', href: '/hook-git.html', match: ['/hook-git.html', '/hook.html'] },
        { label: 'Sync JIRA', href: '/project.html' },
      ],
    },
    {
      title: 'Documentation',
      help: 'Livrables QA et guides',
      items: [
        { label: 'Livrables QA', href: '/doc-qa.html' },
        { label: 'Wiki', href: '/wiki.html' },
      ],
    },
  ]

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function assetUrl(path) {
    const base = global.__WIZARD_API_BASE__ || ''
    return base ? `${base.replace(/\/$/, '')}${path}` : path
  }

  function pageUrl(href) {
    return global.Portail && typeof global.Portail.pageUrl === 'function' ? global.Portail.pageUrl(href) : href
  }

  function currentPath() {
    const p = global.location.pathname || '/'
    return p.endsWith('/') && p.length > 1 ? p.slice(0, -1) : p
  }

  function isActive(item, path) {
    const targets = item.match || [item.href]
    return targets.includes(path) || (path === '/index.html' && targets.includes('/'))
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
          <span class="ks-brand-sub">Installation et pilotage de la stack de test Playwright &mdash; poste CA-TS</span>
        </div>
        <span class="ks-brand-spacer"></span>
        <img class="ks-brand-ca" src="${esc(assetUrl('/assets/logo-cats-full.png'))}" alt="Crédit Agricole Technologies et Services" />
      </div>
      <div class="ks-brand-accent"></div>`
    return header
  }

  function buildSidebar(path) {
    const aside = document.createElement('aside')
    aside.className = 'ks-sidebar'
    aside.setAttribute('aria-label', 'Navigation')

    const sections = NAV.map((section) => {
      const items = section.items
        .map((item) => {
          const active = isActive(item, path)
          return `<a class="ks-nav-item${active ? ' is-active' : ''}" href="${esc(pageUrl(item.href))}"${active ? ' aria-current="page"' : ''}>
            <span class="ks-nav-dot" aria-hidden="true"></span>${esc(item.label)}</a>`
        })
        .join('')
      return `<div class="ks-nav-section"><div class="ks-nav-title" title="${esc(section.help)}">${esc(section.title)}</div>${items}</div>`
    }).join('')

    aside.innerHTML = `
      <div class="ks-side-brand">
        <span class="ks-side-name">Wizard QA</span>
        <span class="ks-side-tagline">Assistant d'installation</span>
        <span class="ks-badge">Mode poste local</span>
      </div>
      <nav class="ks-nav">${sections}</nav>
      <div class="ks-side-footer"><span class="ks-chip">Playwright &middot; k6</span></div>`
    return aside
  }

  function build() {
    const body = document.body
    if (!body || body.classList.contains('ks-on')) return

    body.querySelectorAll('.wizard-brand-bar').forEach((el) => el.remove())

    const movable = Array.from(body.childNodes).filter((node) => {
      if (node.nodeType !== 1) return false
      const tag = node.tagName
      return tag !== 'SCRIPT' && tag !== 'LINK' && tag !== 'STYLE' && !node.classList.contains('wizard-footer')
    })

    const main = document.createElement('div')
    main.className = 'ks-main'
    movable.forEach((node) => main.appendChild(node))

    const row = document.createElement('div')
    row.className = 'ks-body'
    const aside = buildSidebar(currentPath())
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
  }

  function boot() {
    build()
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
  else boot()

  global.AppShell = { build, NAV }
})(typeof window !== 'undefined' ? window : globalThis)

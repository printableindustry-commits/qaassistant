/* Écran de connexion (page publique, sans shell). */
;(function () {
  'use strict'
  const P = window.Prisme
  const $ = (id) => document.getElementById(id)
  const form = $('form')
  const errorBox = $('error')
  const next = (() => {
    const n = new URLSearchParams(location.search).get('next') || '/'
    // Uniquement un chemin local : pas de redirection ouverte vers un autre site.
    return n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/login.html') ? n : '/'
  })()

  const FEATURES = [
    ['download', 'Installation complète', 'Node, npm, Playwright, k6 et extensions, vérifiés.'],
    ['compass', 'Scan JIRA', 'Récits, critères d’acceptation, épopées.'],
    ['wand', 'Gherkin assisté', 'Scénarios proposés par récit, relus, exportés.'],
    ['activity', 'Performance k6', 'Runs en direct, seuils, comparaison.'],
  ]
  $('features').replaceChildren(...FEATURES.map(([ic, t, d]) => P.h('div', { class: 'p-login-feature' }, P.icon(ic), P.h('div', null, P.h('b', null, t), d))))

  const pwd = $('password')
  const toggle = $('togglePwd')
  toggle.appendChild(P.icon('eye'))
  toggle.addEventListener('click', () => {
    const show = pwd.type === 'password'
    pwd.type = show ? 'text' : 'password'
    toggle.replaceChildren(P.icon(show ? 'eyeOff' : 'eye'))
    toggle.setAttribute('aria-label', show ? 'Masquer le mot de passe' : 'Afficher le mot de passe')
  })

  function showError(msg) {
    errorBox.replaceChildren(P.icon('xCircle'), P.h('div', null, msg))
    errorBox.classList.add('show')
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    errorBox.classList.remove('show')
    const username = $('username').value.trim()
    const password = pwd.value
    if (!username || !password) {
      showError('Saisissez votre identifiant et votre mot de passe.')
      return
    }
    await P.busy($('submit'), async () => {
      try {
        await P.api('/api/auth/login', { body: { username, password }, allow401: true })
        location.replace(next)
      } catch (err) {
        showError(err.message)
        pwd.select()
      }
    })
  })

  $('useDemo').addEventListener('click', () => {
    $('username').value = 'demo'
    pwd.value = 'demo'
    form.requestSubmit()
  })
  $('demoIcon').appendChild(P.icon('info', 16))

  P.api('/api/auth/session', { allow401: true }).then((s) => {
    if (s.authenticated) location.replace(next)
    if (s.demoAvailable) $('demo').classList.remove('p-hidden')
  }).catch(() => {})
  P.api('/api/health', { allow401: true }).then((h) => {
    $('version').textContent = `Wizard QA v${h.version}`
    $('versionSmall').textContent = `v${h.version}`
  }).catch(() => {})

  $('username').focus()
})()

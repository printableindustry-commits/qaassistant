/*
 * Réglages — compte, utilisateurs, configuration et informations de l'application.
 *
 *   Mon compte     : identité, changement de mot de passe (POST /api/auth/password)
 *   Utilisateurs   : admin — liste, création, suppression (/api/auth/users)
 *   Configuration  : admin — emplacements (/api/wizard/paths), fichiers (/api/wizard/config-files),
 *                    export (GET /api/wizard/export) et import (POST /api/wizard/import)
 *   JIRA / Xray    : connexion JIRA (rappel), réglages Xray (/api/xray/settings), test de connexion,
 *                    historique des envois de tickets Test (/api/xray/pushed)
 *   À propos       : version (/api/health, /api/wizard/meta) et emplacement des données
 */
;(function () {
  'use strict'
  const P = window.Prisme
  const { h } = P

  const TAB_IDS = ['compte', 'utilisateurs', 'configuration', 'jira-xray', 'a-propos']
  const ROLE_LABEL = { admin: 'Administrateur', user: 'Utilisateur' }
  const isLocalHost = ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname)

  const state = {
    user: null,
    isAdmin: false,
    tab: 'compte',
    users: null,
    paths: null,
    files: null,
    meta: null,
    health: null,
    xray: null,
  }

  let app = null
  let tabsCtl = null
  let panelHost = null

  // ---------------------------------------------------------------- outils

  function initials(name) {
    return String(name || '?').split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join('') || '?'
  }

  const avatar = (u) => h('span', { class: 'p-avatar', 'aria-hidden': 'true' }, initials(u.displayName || u.username))

  let fieldSeq = 0

  /** Champ libellé : le <label> est relié au premier input du contrôle (clic et lecteurs d'écran). */
  function field(label, control, hint) {
    const target = control.matches?.('input, select, textarea') ? control : control.querySelector?.('input, select, textarea')
    if (target && !target.id) target.id = `rgField${++fieldSeq}`
    return h('div', { class: 'p-field' },
      h('label', { for: target ? target.id : null }, label),
      control,
      hint ? h('div', { class: 'p-hint' }, hint) : null)
  }

  function input(attrs = {}) {
    const el = h('input', { class: 'p-input', type: 'text', autocomplete: 'off', ...attrs })
    if (attrs.value != null) el.value = attrs.value
    return el
  }

  /** Champ mot de passe avec bouton afficher / masquer. */
  function passwordInput(attrs = {}) {
    const el = input({ type: 'password', ...attrs })
    const toggle = h('button', { class: 'p-icon-btn', type: 'button', title: 'Afficher le mot de passe', 'aria-label': 'Afficher le mot de passe' }, P.icon('eye'))
    toggle.addEventListener('click', () => {
      const show = el.type === 'password'
      el.type = show ? 'text' : 'password'
      toggle.replaceChildren(P.icon(show ? 'eyeOff' : 'eye'))
      toggle.title = show ? 'Masquer le mot de passe' : 'Afficher le mot de passe'
    })
    return { el, wrap: h('div', { class: 'rg-pwd' }, el, toggle) }
  }

  /** Estimation simple de la robustesse : longueur et variété des caractères. */
  function strength(pwd) {
    if (!pwd) return { score: 0, label: '', tone: '' }
    let score = Math.min(pwd.length, 16) / 16 * 50
    const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pwd)).length
    score += classes * 12.5
    if (/^(.)\1+$/.test(pwd) || /^(demo|password|motdepasse|azerty|qwerty|12345678)/i.test(pwd)) score = Math.min(score, 15)
    if (score < 40) return { score, label: 'Faible', tone: 'red' }
    if (score < 70) return { score, label: 'Correct', tone: 'amber' }
    return { score, label: 'Robuste', tone: '' }
  }

  function generatePassword(length = 16) {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_!?'
    const bytes = new Uint32Array(length)
    crypto.getRandomValues(bytes)
    return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
  }

  function copyButton(text, label = 'Copier') {
    return h('button', { class: 'p-icon-btn', type: 'button', title: label, 'aria-label': label, onclick: () => P.copy(text) }, P.icon('copy'))
  }

  function pathRow(value) {
    if (!value) return h('span', { class: 'p-faint' }, 'non défini')
    return h('span', { class: 'rg-path' }, h('code', null, value), copyButton(value, 'Copier le chemin'))
  }

  /** Assemble un chemin pour l'affichage ; un chemin déjà absolu (C:\…, \\serveur, /…) est gardé tel quel. */
  function joinPath(root, rel) {
    if (!root) return rel || ''
    if (!rel) return root
    if (/^([a-zA-Z]:)?[\\/]/.test(rel)) return rel
    const sep = root.includes('\\') ? '\\' : '/'
    return root.replace(/[\\/]+$/, '') + sep + String(rel).replace(/[\\/]/g, sep)
  }

  function errorBanner(err, retry) {
    return P.banner('error', [
      h('strong', null, 'Chargement impossible. '),
      err?.message || String(err),
      retry ? h('span', null, ' — ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); retry() } }, 'Réessayer')) : null,
    ])
  }

  function loadingCard(text) {
    return h('div', { class: 'p-card' }, h('div', { class: 'p-empty' }, h('span', { class: 'p-spinner' }), h('div', { class: 'p-empty-title' }, text)))
  }

  function downloadJson(data, fileName) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = h('a', { href: url, download: fileName })
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const today = () => new Date().toISOString().slice(0, 10)

  /**
   * Dossier de configuration réel : déduit du catalogue (wizard.defaults.json) quand il est connu,
   * car WIZARD_CONF_DIR peut le placer hors du projet de test.
   */
  function confDirOf(p) {
    const defaults = (state.files || []).find((f) => f.id === 'wizardDefaults')
    if (defaults?.relativePath) {
      const full = joinPath(p.repoRoot, defaults.relativePath)
      return full.replace(/[\\/][^\\/]+$/, '')
    }
    return joinPath(p.repoRoot, p.localConfDir || '.wizard-qa/conf')
  }

  // ---------------------------------------------------------------- onglets

  function tabItems() {
    const items = [{ id: 'compte', label: 'Mon compte', icon: 'lock' }]
    if (state.isAdmin) {
      items.push({
        id: 'utilisateurs',
        label: 'Utilisateurs',
        icon: 'users',
        count: state.users ? state.users.length : null,
        tone: state.users?.some((u) => u.demo) ? 'amber' : '',
      })
      items.push({ id: 'configuration', label: 'Configuration', icon: 'settings', count: state.files ? state.files.length : null })
    }
    items.push({ id: 'jira-xray', label: 'JIRA / Xray', icon: 'link', tone: state.xray && !state.xray.settings.configured ? 'amber' : '', count: state.xray ? state.xray.pushed.length : null })
    items.push({ id: 'a-propos', label: 'À propos', icon: 'info' })
    return items
  }

  function refreshTabs() {
    if (tabsCtl) tabsCtl.update(tabItems())
  }

  function selectTab(id, { push = true } = {}) {
    const allowed = tabItems().map((t) => t.id)
    state.tab = allowed.includes(id) ? id : 'compte'
    if (tabsCtl) tabsCtl.set(state.tab)
    // Ancre corrigée aussi quand l'onglet demandé est refusé (onglet admin pour un utilisateur simple).
    if (push || state.tab !== id) history.replaceState(null, '', `#${state.tab}`)
    renderPanel()
  }

  function renderPanel() {
    P.clear(panelHost)
    const render = {
      compte: renderAccount,
      utilisateurs: renderUsers,
      configuration: renderConfiguration,
      'jira-xray': renderXray,
      'a-propos': renderAbout,
    }[state.tab]
    panelHost.appendChild(render())
  }

  // ---------------------------------------------------------------- Mon compte

  function renderAccount() {
    const u = state.user
    const root = h('div', { class: 'rg-panel' })

    if (u.demo) {
      root.appendChild(P.banner('warn', [
        h('strong', null, 'Compte de démonstration. '),
        'Son mot de passe « demo » est connu de tous : choisissez un mot de passe personnel ci-dessous.',
        state.isAdmin ? ' Créez ensuite les comptes de l’équipe dans l’onglet Utilisateurs.' : null,
      ]))
    }
    if (u.embedded) {
      root.appendChild(P.banner('info', 'Mode intégré à VS Code : vous êtes connecté avec l’utilisateur local de l’extension, sans mot de passe.'))
    }

    const identity = P.card({
      title: 'Identité',
      sub: 'Informations de votre session',
      icon: 'users',
      body: [
        h('div', { class: 'rg-identity' },
          avatar(u),
          h('div', null,
            h('div', { class: 'rg-identity-name' }, u.displayName || u.username),
            h('div', { class: 'rg-identity-sub' }, `@${u.username}`),
            h('div', { class: 'p-row' },
              P.badge(ROLE_LABEL[u.role] || u.role, u.role === 'admin' ? 'mint' : ''),
              u.demo ? P.badge('Démonstration', 'amber') : null))),
        h('dl', { class: 'p-dl' },
          h('dt', null, 'Identifiant'), h('dd', null, h('span', { class: 'p-mono' }, u.username)),
          h('dt', null, 'Rôle'), h('dd', null, u.role === 'admin'
            ? 'Administrateur — gestion des comptes et de la configuration'
            : 'Utilisateur — accès aux outils QA'),
          h('dt', null, 'Compte créé'), h('dd', null, P.fmtDate(u.createdAt)),
          h('dt', null, 'Dernière connexion'), h('dd', null, u.lastLoginAt ? `${P.fmtDate(u.lastLoginAt)} (${P.fmtAgo(u.lastLoginAt)})` : '—'),
          h('dt', null, 'Session'), h('dd', null, 'Cookie sécurisé (HttpOnly), valable 12 heures')),
      ],
    })

    root.appendChild(h('div', { class: 'p-grid p-grid-2' }, identity, u.embedded ? passwordUnavailableCard() : passwordCard()))
    return root
  }

  function passwordUnavailableCard() {
    return P.card({
      title: 'Mot de passe',
      icon: 'lock',
      body: P.empty('Aucun mot de passe à gérer', 'L’utilisateur intégré de VS Code n’a pas de mot de passe. Ouvrez l’application dans le navigateur pour utiliser un compte nominatif.', 'lock'),
    })
  }

  function passwordCard() {
    const current = passwordInput({ autocomplete: 'current-password', id: 'rgCurrent' })
    const next = passwordInput({ autocomplete: 'new-password', id: 'rgNew' })
    const confirm = passwordInput({ autocomplete: 'new-password', id: 'rgConfirm' })
    const meterFill = h('div', { class: 'p-meter-fill', style: { width: '0%' } })
    const meterLabel = h('span', { class: 'rg-strength-label' }, '')
    const rules = [
      { test: (p) => p.length >= 8, text: 'Au moins 8 caractères' },
      { test: (p, c, cur) => p.length > 0 && p !== cur, text: 'Différent du mot de passe actuel' },
      { test: (p, c) => p.length > 0 && p === c, text: 'Confirmation identique' },
    ]
    const ruleEls = rules.map((r) => h('li', null, P.icon('checkCircle'), r.text))
    const feedback = h('div')
    const submit = h('button', { class: 'p-btn p-btn--primary', type: 'submit', disabled: true }, P.icon('save'), 'Changer le mot de passe')

    function update() {
      const p = next.el.value
      const s = strength(p)
      meterFill.style.width = `${Math.round(s.score)}%`
      meterFill.className = `p-meter-fill ${s.tone}`
      meterLabel.textContent = s.label
      let allOk = true
      rules.forEach((r, i) => {
        const ok = r.test(p, confirm.el.value, current.el.value)
        ruleEls[i].classList.toggle('ok', ok)
        allOk = allOk && ok
      })
      submit.disabled = !allOk || !current.el.value
    }
    for (const el of [current.el, next.el, confirm.el]) el.addEventListener('input', update)

    const form = h('form', { class: 'rg-form', novalidate: true },
      field('Mot de passe actuel', current.wrap),
      field('Nouveau mot de passe', next.wrap),
      h('div', { class: 'rg-strength' }, h('div', { class: 'p-meter' }, meterFill), meterLabel),
      field('Confirmation', confirm.wrap),
      h('ul', { class: 'rg-rules' }, ruleEls),
      feedback,
      h('div', { class: 'p-row' }, submit))

    form.addEventListener('submit', async (e) => {
      e.preventDefault()
      P.clear(feedback)
      await P.busy(submit, async () => {
        try {
          await P.api('/api/auth/password', { body: { currentPassword: current.el.value, newPassword: next.el.value } })
          P.toast('Mot de passe modifié')
          state.user = { ...state.user, demo: false }
          if (P.shell?.refreshStrip) P.shell.refreshStrip()
          await reloadSession()
          renderPanel()
        } catch (err) {
          feedback.appendChild(P.banner('error', err.message))
          current.el.focus()
        }
      })
      update()
    })

    return P.card({ title: 'Changer de mot de passe', sub: 'Le nouveau mot de passe prend effet immédiatement', icon: 'key', body: form })
  }

  async function reloadSession() {
    try {
      const s = await P.api('/api/auth/session')
      if (s.user) state.user = s.user
    } catch { /* la session reste celle connue */ }
  }

  // ---------------------------------------------------------------- Utilisateurs

  /** Une seule requête à la fois (chargement de fond des compteurs et ouverture de l'onglet). */
  function once(fn) {
    let pending = null
    return () => {
      if (!pending) pending = fn().finally(() => { pending = null })
      return pending
    }
  }

  const loadUsers = once(async () => {
    const data = await P.api('/api/auth/users')
    state.users = data.users || []
    refreshTabs()
  })

  function renderUsers() {
    const root = h('div', { class: 'rg-panel' })
    if (!state.users) {
      root.appendChild(loadingCard('Chargement des comptes…'))
      loadUsers().then(renderPanel, (err) => {
        P.clear(root)
        root.appendChild(errorBanner(err, () => renderPanel()))
      })
      return root
    }

    const users = state.users
    const admins = users.filter((u) => u.role === 'admin').length
    const demos = users.filter((u) => u.demo).length
    const neverLogged = users.filter((u) => !u.lastLoginAt).length
    root.appendChild(h('div', { class: 'p-kpis' },
      P.kpi({ label: 'Comptes', value: users.length, detail: `${users.length - admins} utilisateur(s), ${admins} administrateur(s)` }),
      P.kpi({ label: 'Administrateurs', value: admins, tone: admins === 1 ? 'amber' : 'mint', detail: admins === 1 ? 'Prévoyez un second administrateur' : 'Gestion des comptes assurée' }),
      P.kpi({ label: 'À sécuriser', value: demos, tone: demos ? 'red' : 'mint', detail: demos ? 'Compte de démonstration actif' : 'Aucun mot de passe par défaut' }),
      P.kpi({ label: 'Jamais connectés', value: neverLogged, detail: 'Comptes créés sans première connexion' })))

    if (demos) {
      root.appendChild(P.banner('warn', [
        h('strong', null, 'Le compte de démonstration est encore actif. '),
        'Créez votre compte administrateur nominatif, connectez-vous avec, puis supprimez « demo » (ou changez son mot de passe).',
      ]))
    }

    const search = input({ type: 'search', placeholder: 'Filtrer par nom ou identifiant…', 'aria-label': 'Filtrer les utilisateurs', class: 'p-input' })
    const count = h('span', { class: 'p-toolbar-count' })
    const tableHost = h('div')

    function renderTable() {
      const q = search.value.trim().toLowerCase()
      const list = users.filter((u) => !q || `${u.username} ${u.displayName}`.toLowerCase().includes(q))
      count.textContent = `${list.length} / ${users.length}`
      P.clear(tableHost)
      if (!list.length) {
        tableHost.appendChild(P.empty('Aucun compte ne correspond', 'Modifiez le filtre ou créez un nouvel utilisateur.', 'users'))
        return
      }
      tableHost.appendChild(h('table', { class: 'p-table' },
        h('thead', null, h('tr', null,
          h('th', null, 'Utilisateur'), h('th', null, 'Rôle'), h('th', null, 'Créé le'), h('th', null, 'Dernière connexion'), h('th', { class: 'num' }, ''))),
        h('tbody', null, list.map(userRow))))
    }
    search.addEventListener('input', renderTable)
    renderTable()

    root.appendChild(P.card({
      title: 'Comptes de l’équipe',
      sub: 'Chaque testeur dispose de son propre compte ; les administrateurs gèrent les comptes et la configuration.',
      icon: 'users',
      flush: true,
      actions: h('button', { class: 'p-btn p-btn--primary', type: 'button', onclick: openCreateUser }, P.icon('plus'), 'Nouvel utilisateur'),
      body: [h('div', { class: 'p-toolbar', style: { border: 0, borderBottom: '1px solid var(--p-line)', borderRadius: 0 } }, search, count), tableHost],
    }))
    return root
  }

  function userRow(u) {
    const self = u.username === state.user.username
    const del = h('button', {
      class: 'p-btn p-btn--sm p-btn--danger',
      type: 'button',
      disabled: self,
      title: self ? 'Vous ne pouvez pas supprimer votre propre compte' : `Supprimer ${u.username}`,
    }, P.icon('trash'), 'Supprimer')
    del.addEventListener('click', () => removeUser(u, del))
    return h('tr', u.demo ? { class: 'warning' } : null,
      h('td', null, h('div', { class: 'rg-user-cell' }, avatar(u),
        h('div', null,
          h('div', { class: 'rg-user-name' }, u.displayName || u.username, self ? h('span', { class: 'p-faint' }, ' (vous)') : null),
          h('div', { class: 'rg-user-id' }, `@${u.username}`)))),
      h('td', null, P.badge(ROLE_LABEL[u.role] || u.role, u.role === 'admin' ? 'mint' : ''), u.demo ? [' ', P.badge('Démonstration', 'amber')] : null),
      h('td', null, P.fmtDate(u.createdAt)),
      h('td', null, u.lastLoginAt ? h('span', { title: P.fmtDate(u.lastLoginAt) }, P.fmtAgo(u.lastLoginAt)) : h('span', { class: 'p-faint' }, 'jamais')),
      h('td', { class: 'rg-actions' }, del))
  }

  async function removeUser(u, button) {
    const ok = await P.confirm(
      `Le compte « ${u.displayName || u.username} » (@${u.username}) sera supprimé et ses sessions fermées. Cette action est définitive.`,
      { title: 'Supprimer l’utilisateur', okLabel: 'Supprimer', danger: true })
    if (!ok) return
    await P.busy(button, async () => {
      try {
        await P.api(`/api/auth/users/${encodeURIComponent(u.username)}`, { method: 'DELETE' })
        P.toast(`Compte @${u.username} supprimé`)
        await loadUsers()
        renderPanel()
        if (P.shell?.refreshStrip) P.shell.refreshStrip()
      } catch (err) {
        P.toast(err.message, 'error', 6000)
      }
    })
  }

  function openCreateUser() {
    const username = input({ placeholder: 'ex. m.dupont', maxlength: 40, autocomplete: 'off' })
    const displayName = input({ placeholder: 'ex. Marie Dupont', maxlength: 80 })
    const pwd = passwordInput({ autocomplete: 'new-password' })
    let role = 'user'
    const seg = h('div', { class: 'p-seg', role: 'radiogroup', 'aria-label': 'Rôle' })
    const renderSeg = () => {
      P.clear(seg)
      for (const r of ['user', 'admin']) {
        seg.appendChild(h('button', {
          type: 'button',
          class: r === role ? 'active' : '',
          role: 'radio',
          'aria-checked': r === role ? 'true' : 'false',
          onclick: () => { role = r; renderSeg() },
        }, ROLE_LABEL[r]))
      }
    }
    renderSeg()
    const generated = h('div')
    const genBtn = h('button', { class: 'p-btn p-btn--sm', type: 'button' }, P.icon('wand'), 'Générer')
    genBtn.addEventListener('click', () => {
      const value = generatePassword()
      pwd.el.value = value
      pwd.el.type = 'text'
      P.clear(generated)
      generated.appendChild(h('div', { class: 'rg-generated' }, h('code', null, value), copyButton(value, 'Copier le mot de passe')))
    })
    const errorHost = h('div')

    const body = h('div', { class: 'rg-form' },
      h('div', { class: 'p-form-grid' },
        field('Identifiant', username, '2 à 40 caractères : lettres minuscules, chiffres, point, tiret, souligné.'),
        field('Nom affiché', displayName, 'Facultatif : affiché dans l’en-tête et les journaux.')),
      field('Rôle', seg, 'Administrateur : gère les comptes et la configuration. Utilisateur : utilise les outils QA.'),
      field('Mot de passe initial', h('div', { class: 'p-stack' }, h('div', { class: 'p-row', style: { flexWrap: 'nowrap' } }, h('div', { style: { flex: 1 } }, pwd.wrap), genBtn), generated),
        'Au moins 8 caractères. Transmettez-le de façon sûre : l’utilisateur pourra le changer dans Réglages › Mon compte.'),
      errorHost)

    P.modal({
      title: 'Nouvel utilisateur',
      body,
      actions: [
        { label: 'Annuler', kind: 'ghost' },
        {
          label: 'Créer le compte',
          kind: 'primary',
          icon: 'plus',
          onClick: async (_close, e) => {
            P.clear(errorHost)
            const payload = {
              username: username.value.trim().toLowerCase(),
              displayName: displayName.value.trim(),
              password: pwd.el.value,
              role,
            }
            const problem = !/^[a-z0-9._-]{2,40}$/.test(payload.username)
              ? 'Identifiant invalide (2 à 40 caractères : lettres, chiffres, point, tiret, souligné).'
              : payload.password.length < 8 ? 'Le mot de passe doit contenir au moins 8 caractères.' : null
            if (problem) {
              errorHost.appendChild(P.banner('error', problem))
              return false
            }
            try {
              await P.busy(e?.currentTarget, () => P.api('/api/auth/users', { body: payload }))
              P.toast(`Compte @${payload.username} créé`)
              await loadUsers()
              renderPanel()
              return true
            } catch (err) {
              errorHost.appendChild(P.banner('error', err.message))
              return false
            }
          },
        },
      ],
    })
    setTimeout(() => username.focus(), 40)
  }

  // ---------------------------------------------------------------- Configuration

  const loadConfiguration = once(async () => {
    const [paths, files] = await Promise.all([
      P.api('/api/wizard/paths'),
      P.api('/api/wizard/config-files'),
    ])
    state.paths = paths
    state.files = files.files || []
    refreshTabs()
  })

  function renderConfiguration() {
    const root = h('div', { class: 'rg-panel' })
    if (!state.paths || !state.files) {
      root.appendChild(loadingCard('Lecture de la configuration…'))
      loadConfiguration().then(renderPanel, (err) => {
        P.clear(root)
        root.appendChild(errorBanner(err, () => renderPanel()))
      })
      return root
    }
    root.appendChild(locationsCard())
    root.appendChild(h('div', { class: 'p-grid p-grid-2' }, exportCard(), importCard()))
    root.appendChild(filesCard())
    return root
  }

  function locationsCard() {
    const p = state.paths
    const openBtn = isLocalHost
      ? h('button', { class: 'p-btn p-btn--sm', type: 'button' }, P.icon('folder'), 'Ouvrir le projet')
      : null
    if (openBtn) {
      openBtn.addEventListener('click', () => P.busy(openBtn, async () => {
        try {
          await P.api('/api/wizard/open-folder', { body: { target: 'project' } })
          P.toast('Dossier ouvert dans l’explorateur')
        } catch (err) {
          P.toast(err.message, 'error', 6000)
        }
      }))
    }
    return P.card({
      title: 'Emplacements',
      sub: 'Projet de test et dossiers de données utilisés par l’application',
      icon: 'folder',
      actions: openBtn,
      body: [
        h('dl', { class: 'p-dl' },
          h('dt', null, 'Projet de test'), h('dd', null, pathRow(p.repoRoot)),
          h('dt', null, 'Configuration locale'), h('dd', null, pathRow(confDirOf(p))),
          h('dt', null, 'Rapports de documentation'), h('dd', null, pathRow(p.docReportsDir)),
          h('dt', null, 'Livrables'), h('dd', null, pathRow(p.livrablesDir)),
          h('dt', null, 'Modèle de livrable'), h('dd', null, pathRow(p.templateDir)),
          h('dt', null, 'Hook Git'), h('dd', null, pathRow(p.hooksConfPath || p.hookDir)),
          h('dt', null, 'Fichier .npmrc'), h('dd', null, pathRow(p.npmrcDisplay))),
        h('p', { class: 'p-hint', style: { margin: '12px 0 0' } },
          'Les chemins relatifs partent du projet de test. Pour changer de projet, démarrez le serveur avec la variable ',
          h('code', null, 'WIZARD_REPO_ROOT'), ' ; pour déplacer les dossiers, éditez ', h('code', null, 'wizard.paths.json'),
          ' dans la configuration locale.'),
      ],
    })
  }

  function exportCard() {
    const secrets = h('input', { type: 'checkbox' })
    const warn = h('div')
    secrets.addEventListener('change', () => {
      P.clear(warn)
      if (secrets.checked) {
        warn.appendChild(P.banner('warn', 'Le fichier contiendra les jetons et mots de passe en clair (JIRA, Artifactory…). Ne le partagez pas et supprimez-le après usage.'))
      }
    })
    const result = h('div')
    const btn = h('button', { class: 'p-btn p-btn--primary', type: 'button' }, P.icon('download'), 'Télécharger l’export')
    btn.addEventListener('click', () => P.busy(btn, async () => {
      P.clear(result)
      try {
        const data = await P.api(`/api/wizard/export?secrets=${secrets.checked ? '1' : '0'}`)
        downloadJson(data, `wizard-qa-configuration-${today()}${secrets.checked ? '-avec-secrets' : ''}.json`)
        const confCount = Object.keys(data.confFiles || {}).length
        result.appendChild(P.banner('info', `Export téléchargé : profil projet et ${confCount} fichier(s) de configuration${secrets.checked ? ', secrets inclus' : ', secrets exclus'}.`))
      } catch (err) {
        result.appendChild(P.banner('error', `Export impossible : ${err.message}`))
      }
    }))
    return P.card({
      title: 'Exporter la configuration',
      sub: 'Sauvegarde ou partage avec un autre poste',
      icon: 'download',
      body: h('div', { class: 'rg-form' },
        h('p', { class: 'p-muted', style: { margin: 0 } },
          'Produit un fichier JSON unique : profil projet, paramètres des assistants et fichiers de ', h('code', null, '.wizard-qa/conf'), '.'),
        h('label', { class: 'p-check' }, secrets, 'Inclure les secrets (jetons, mots de passe)'),
        warn,
        h('div', { class: 'p-row' }, btn),
        result),
    })
  }

  // Champs secrets du profil (cf. stripSecrets côté serveur) : vidés dans un export « sans secrets ».
  const SECRET_PATHS = [
    ['npmrc', 'authToken'],
    ['hook', 'simple', 'env', 'JIRA_TOKEN'],
    ['hook', 'simple', 'env', 'XRAY_CLIENT_SECRET'],
    ['hook', 'advanced', 'jiraToken'],
    ['hook', 'advanced', 'xrayClientSecret'],
  ]
  const SAFE_PROMPT_NAME = /^[\w .()-]+\.md$/

  const isBundle = (data) => data?.format === 'wizard-qa-bundle' && data.wizardDefaults && typeof data.wizardDefaults === 'object'

  function parentOf(obj, keys) {
    let node = obj
    for (const k of keys.slice(0, -1)) {
      if (!node || typeof node !== 'object') return null
      node = node[k]
    }
    return node && typeof node === 'object' ? node : null
  }

  /** Secrets vides du fichier : profil (chemins ci-dessus) et project.variables.json. */
  function emptySecrets(data) {
    const defaults = isBundle(data) ? data.wizardDefaults : data
    const found = SECRET_PATHS.filter((keys) => parentOf(defaults, keys)?.[keys.at(-1)] === '').map((keys) => keys.join('.'))
    try {
      const vars = JSON.parse(data.confFiles?.['project.variables.json'] || 'null')
      if (vars?.jiraToken === '') found.push('project.variables.json › jiraToken')
      if (vars?.xrayClientSecret === '') found.push('project.variables.json › xrayClientSecret')
    } catch { /* fichier illisible : le serveur l'écrira tel quel */ }
    return found
  }

  /**
   * Prépare l'envoi : en fusion, un secret vide (export « sans secrets ») ne doit pas effacer
   * celui du poste ; les noms de prompts archivés sont limités à de simples fichiers .md.
   */
  function prepareImport(data, merge) {
    const copy = JSON.parse(JSON.stringify(data))
    if (merge) {
      const defaults = isBundle(copy) ? copy.wizardDefaults : copy
      for (const keys of SECRET_PATHS) {
        const parent = parentOf(defaults, keys)
        if (parent && parent[keys.at(-1)] === '') delete parent[keys.at(-1)]
      }
    }
    if (copy.docQaPrompts && typeof copy.docQaPrompts === 'object') {
      for (const name of Object.keys(copy.docQaPrompts)) {
        if (!SAFE_PROMPT_NAME.test(name) || name.includes('..')) delete copy.docQaPrompts[name]
      }
    }
    return copy
  }

  /** Résultat de applyWizardToSystem : { ok, applied[], errors[], skipped[] }. */
  function applySummary(a) {
    const line = (label, items) => (items?.length ? h('div', null, `${label} : ${items.join(', ')}`) : null)
    return h('div', { style: { marginTop: '6px' } },
      h('strong', null, a.ok === false ? 'Application au poste partielle.' : 'Application au poste effectuée.'),
      line('Appliqué', a.applied),
      line('Ignoré', a.skipped),
      line('Erreurs', a.errors))
  }

  function importCard() {
    let parsed = null
    let fileName = ''
    const fileInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true })
    const drop = h('div', { class: 'rg-drop', role: 'button', tabindex: '0', 'aria-label': 'Choisir un fichier de configuration' },
      P.icon('upload'),
      h('div', null, h('strong', null, 'Déposez un export JSON'), ' ou cliquez pour choisir un fichier'),
      h('div', { class: 'p-hint' }, 'Fichier produit par « Exporter la configuration » (format wizard-qa-bundle).'))
    const preview = h('div')
    const merge = h('input', { type: 'checkbox', checked: true })
    const apply = h('input', { type: 'checkbox' })
    const applyWarn = h('div')
    const result = h('div')
    const btn = h('button', { class: 'p-btn p-btn--primary', type: 'button', disabled: true }, P.icon('upload'), 'Importer')

    apply.addEventListener('change', () => {
      P.clear(applyWarn)
      if (apply.checked) {
        applyWarn.appendChild(P.banner('warn', 'Les fichiers du poste seront réécrits : .npmrc de l’utilisateur, repair.conf.json et configuration du hook Git.'))
      }
    })

    async function readFile(file) {
      P.clear(preview)
      P.clear(result)
      parsed = null
      btn.disabled = true
      if (!file) return
      fileName = file.name
      try {
        if (file.size > 1.8 * 1024 * 1024) throw new Error('Fichier trop volumineux (1,8 Mo maximum).')
        const data = JSON.parse(await file.text())
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Le fichier ne contient pas un objet JSON.')
        parsed = data
        preview.appendChild(previewOf(data))
        btn.disabled = false
      } catch (err) {
        preview.appendChild(P.banner('error', `« ${file.name} » est illisible : ${err.message}`))
      }
    }

    function previewOf(data) {
      const known = isBundle(data)
      const conf = known ? Object.keys(data.confFiles || {}) : []
      const prompts = known ? Object.keys(data.docQaPrompts || {}) : []
      const unsafe = prompts.filter((n) => !SAFE_PROMPT_NAME.test(n) || n.includes('..'))
      const sections = Object.keys(known ? data.wizardDefaults : data)
        .filter((k) => !['version', 'updatedAt', 'format', 'exportedAt', 'confFiles', 'confDir'].includes(k))
      const blanks = emptySecrets(data)
      return h('div', { class: 'p-stack' },
        known ? null : P.banner('warn', 'Format non reconnu : le contenu sera importé comme profil wizard brut (sans fichiers de configuration).'),
        blanks.length ? P.banner('info', [
          h('strong', null, 'Export sans secrets. '),
          'En fusion, les jetons actuels du profil sont conservés. ',
          blanks.some((b) => b.startsWith('project.variables.json'))
            ? 'En revanche, project.variables.json est remplacé : ses jetons JIRA / Xray seront à ressaisir (Sync JIRA ou Hook Git).'
            : null,
        ]) : null,
        unsafe.length ? P.banner('warn', `${unsafe.length} prompt(s) archivé(s) au nom invalide seront ignorés : ${unsafe.join(', ')}`) : null,
        h('dl', { class: 'p-dl' },
          h('dt', null, 'Fichier'), h('dd', null, fileName),
          h('dt', null, 'Format'), h('dd', null, known ? `wizard-qa-bundle v${data.version ?? '?'}` : 'inconnu'),
          h('dt', null, 'Exporté le'), h('dd', null, P.fmtDate(data.exportedAt)),
          h('dt', null, 'Sections'), h('dd', null, sections.length ? sections.join(', ') : '—'),
          h('dt', null, 'Fichiers de conf'), h('dd', null, conf.length ? conf.join(', ') : 'aucun'),
          prompts.length ? [h('dt', null, 'Prompts Doc QA'), h('dd', null, `${prompts.length - unsafe.length} fichier(s)`)] : null))
    }

    fileInput.addEventListener('change', () => readFile(fileInput.files[0]))
    drop.addEventListener('click', () => fileInput.click())
    drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click() } })
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-over') })
    drop.addEventListener('dragleave', () => drop.classList.remove('is-over'))
    drop.addEventListener('drop', (e) => {
      e.preventDefault()
      drop.classList.remove('is-over')
      readFile(e.dataTransfer.files[0])
    })

    btn.addEventListener('click', async () => {
      if (!parsed) return
      const ok = await P.confirm(
        merge.checked
          ? 'Les valeurs du fichier seront fusionnées avec la configuration actuelle (les champs absents sont conservés).'
          : 'La configuration actuelle sera remplacée par celle du fichier.',
        { title: 'Importer la configuration', okLabel: 'Importer', danger: !merge.checked || apply.checked })
      if (!ok) return
      await P.busy(btn, async () => {
        P.clear(result)
        try {
          const config = prepareImport(parsed, merge.checked)
          const r = await P.api('/api/wizard/import', { body: { config, merge: merge.checked, applyToSystem: apply.checked } })
          const written = r.writtenConfFiles || []
          result.appendChild(P.banner(r.apply?.ok === false ? 'warn' : 'info', [
            h('strong', null, 'Configuration importée. '),
            `Profil mis à jour le ${P.fmtDate(r.updatedAt)}`,
            written.length ? [' — fichiers écrits :', h('ul', { class: 'rg-written' }, written.map((f) => h('li', null, h('code', null, f))))] : '.',
            r.apply ? applySummary(r.apply) : null,
          ]))
          P.toast('Configuration importée')
          state.files = null
          loadConfiguration().catch(() => {})
        } catch (err) {
          result.appendChild(P.banner('error', `Import refusé : ${err.message}`))
        }
      })
    })

    return P.card({
      title: 'Importer une configuration',
      sub: 'Reprendre la configuration d’un collègue ou d’une sauvegarde',
      icon: 'upload',
      body: h('div', { class: 'rg-form' },
        drop, fileInput, preview,
        h('label', { class: 'p-check' }, merge, 'Fusionner avec la configuration actuelle'),
        h('label', { class: 'p-check' }, apply, 'Appliquer aussi au poste (.npmrc, réparation, hook)'),
        applyWarn,
        h('div', { class: 'p-row' }, btn),
        result),
    })
  }

  function filesCard() {
    const files = state.files || []
    const present = files.filter((f) => f.exists).length
    const body = files.length
      ? h('table', { class: 'p-table' },
        h('thead', null, h('tr', null, h('th', null, 'Fichier'), h('th', null, 'Rôle'), h('th', null, 'État'))),
        h('tbody', null, files.map((f) => h('tr', null,
          h('td', null, h('div', { class: 'p-strong' }, f.title), h('div', { class: 'rg-path' }, h('code', { class: 'p-faint' }, f.relativePath))),
          h('td', null, h('div', { class: 'rg-file-role' }, f.role || '—')),
          h('td', { class: 'p-nowrap' },
            P.badge(f.exists ? 'Présent' : 'Absent', f.exists ? 'mint' : ''),
            f.secrets ? [' ', P.badge('Secrets', 'amber', 'Contient des données sensibles : exclues de l’export par défaut')] : null)))))
      : P.empty('Aucun fichier recensé', 'Le catalogue des fichiers de configuration est vide.', 'fileText')
    return P.card({
      title: 'Fichiers de configuration',
      sub: `${present} présent(s) sur ${files.length} — un fichier absent est créé au premier usage de l’assistant concerné`,
      icon: 'fileText',
      flush: true,
      body,
    })
  }

  // ---------------------------------------------------------------- JIRA / Xray

  const XRAY_MODES = [
    { id: 'auto', label: 'Automatique (selon le JIRA détecté)' },
    { id: 'cloud', label: 'Xray Cloud (clé d’API)' },
    { id: 'server', label: 'Xray Server / Data Center (identifiants JIRA)' },
  ]
  const MODE_SHORT = { cloud: 'Xray Cloud', server: 'Xray Server / DC', 'jira-only': 'JIRA seul', simulation: 'Simulation' }

  async function loadXray() {
    const [settings, jira, pushed] = await Promise.all([
      P.api('/api/xray/settings'),
      P.api('/api/jira/settings').catch(() => null),
      P.api('/api/xray/pushed?limit=20').catch(() => ({ entries: [] })),
    ])
    state.xray = { settings, jira, pushed: pushed.entries || [], test: null }
    refreshTabs()
  }

  function renderXray() {
    const root = h('div', { class: 'rg-panel' })
    if (!state.xray) {
      root.appendChild(loadingCard('Lecture des réglages JIRA / Xray…'))
      loadXray().then(renderPanel, (err) => {
        P.clear(root)
        root.appendChild(errorBanner(err, () => renderPanel()))
      })
      return root
    }
    const x = state.xray
    root.appendChild(h('div', { class: 'p-grid rg-xray-grid' }, jiraCard(x), historyCard(x)))
    root.appendChild(xrayCard(x))
    return root
  }

  function jiraCard(x) {
    const j = x.settings.jira
    const scan = x.settings.scan
    const dep = { cloud: 'JIRA Cloud', server: 'JIRA Server / Data Center', auto: 'Détection automatique' }[j.deployment] || j.deployment
    return P.card({
      title: 'Connexion JIRA',
      sub: 'Utilisée pour créer les tickets Test et les liens',
      icon: 'server',
      actions: h('a', { class: 'p-btn p-btn--sm', href: '/connaissance.html' }, P.icon('edit'), 'Modifier'),
      body: [
        j.configured ? null : P.banner('warn', [
          h('strong', null, 'JIRA n’est pas connecté. '),
          'L’adresse et le jeton se règlent dans ',
          h('a', { href: '/connaissance.html' }, 'Prise de connaissance'),
          ' (étape « Connexion JIRA »).',
        ]),
        h('dl', { class: 'p-dl' },
          h('dt', null, 'Adresse'), h('dd', null, j.baseUrl ? h('span', { class: 'p-mono' }, j.baseUrl) : h('span', { class: 'p-faint' }, 'non renseignée')),
          h('dt', null, 'Déploiement'), h('dd', null, dep),
          h('dt', null, 'Projet'), h('dd', null, j.projectKey || '—'),
          h('dt', null, 'Jeton'), h('dd', null, x.jira?.settings?.hasToken ? P.status('enregistré (masqué)', 'mint') : P.status('absent', 'amber')),
          h('dt', null, 'Récits'), h('dd', null, scan
            ? [`${scan.count} récits (${scan.projectKey || '—'}) `, scan.source === 'demo' ? P.badge('démonstration', 'amber') : P.badge('JIRA', 'mint')]
            : h('span', { class: 'p-faint' }, 'aucun scan'))),
        scan?.source === 'demo'
          ? h('div', { class: 'p-hint' }, 'Les récits de démonstration sont envoyés en simulation : aucune écriture dans JIRA, clés fictives.')
          : null,
      ],
    })
  }

  function historyCard(x) {
    const rows = x.pushed
    const body = rows.length
      ? h('div', { class: 'rg-xray-table-wrap' }, h('table', { class: 'p-table' },
        h('thead', null, h('tr', null, h('th', null, 'Récit'), h('th', null, 'Ticket Test'), h('th', null, 'Source'), h('th', null, 'Plan'), h('th', null, 'Envoyé'))),
        h('tbody', null, rows.map((e) => h('tr', null,
          h('td', null, h('span', { class: 'p-mono' }, e.storyKey)),
          h('td', null,
            /^https?:\/\//i.test(e.testUrl || '') ? h('a', { href: e.testUrl, target: '_blank', rel: 'noopener noreferrer', class: 'p-mono' }, e.testKey) : h('span', { class: 'p-mono' }, e.testKey),
            ' ',
            e.simulated ? P.badge('simulé', 'amber') : P.badge(MODE_SHORT[e.mode] || e.mode),
            e.linked === false ? P.badge('sans lien', 'red') : null),
          h('td', null, e.sourceKind === 'playwright' ? 'Playwright' : 'Gherkin'),
          h('td', null, e.planKey ? h('span', { class: 'p-mono' }, e.planKey) : '—'),
          h('td', { class: 'p-nowrap', title: P.fmtDate(e.updatedAt || e.pushedAt) },
            P.fmtAgo(e.updatedAt || e.pushedAt),
            e.pushCount > 1 ? h('span', { class: 'p-faint' }, ` · ${e.pushCount} envois`) : null,
            e.by ? h('div', { class: 'p-faint' }, e.by) : null))))))
      : P.empty('Aucun envoi pour l’instant', 'Les tickets Test envoyés depuis Récits ou Automatisation apparaîtront ici.', 'upload')
    return P.card({
      title: 'Envois récents',
      sub: 'Tickets Test créés ou mis à jour',
      icon: 'clock',
      flush: rows.length > 0,
      actions: h('button', { class: 'p-icon-btn', type: 'button', title: 'Actualiser', 'aria-label': 'Actualiser', onclick: () => { state.xray = null; renderPanel() } }, P.icon('refresh')),
      body,
    })
  }

  function xrayCard(x) {
    const s = x.settings.settings
    const canEdit = x.settings.canEdit
    const regions = x.settings.regions || []

    const mode = h('select', { class: 'p-select', disabled: !canEdit }, XRAY_MODES.map((m) => h('option', { value: m.id, selected: m.id === s.mode }, m.label)))
    const region = h('select', { class: 'p-select', disabled: !canEdit },
      regions.map((r) => h('option', { value: r.id, selected: r.id === s.region }, `${r.label} — ${r.url.replace(/^https:\/\//, '')}`)),
      h('option', { value: 'custom', selected: s.region === 'custom' }, 'Adresse personnalisée'))
    const cloudUrl = input({ value: s.cloudBaseUrl, disabled: !canEdit, placeholder: 'https://xray.cloud.getxray.app' })
    const clientId = input({ value: s.clientId, disabled: !canEdit, placeholder: 'Client ID de la clé d’API Xray' })
    const secret = passwordInput({ value: '', disabled: !canEdit, autocomplete: 'new-password', placeholder: s.hasClientSecret ? `${s.clientSecret} — laisser vide pour conserver` : 'Client Secret de la clé d’API Xray' })
    const testType = input({ value: s.testIssueType, disabled: !canEdit })
    const planType = input({ value: s.testPlanIssueType, disabled: !canEdit })
    const linkType = input({ value: s.linkType, disabled: !canEdit })
    const defaultPlan = input({ value: s.defaultTestPlanKey, disabled: !canEdit, placeholder: 'Aucun (ex. IRMA-120)' })
    const pwType = input({ value: s.playwrightTestType, disabled: !canEdit })
    const ghType = input({ value: s.gherkinTestType, disabled: !canEdit })
    const labels = input({ value: (s.labels || []).join(', '), disabled: !canEdit })

    const regionField = field('Région Xray Cloud', region, 'Celle de votre instance Xray (Paramètres globaux › API Keys).')
    const urlField = field('Adresse Xray Cloud', cloudUrl)
    const cloudBlock = h('div', { class: 'p-form-grid span-2 rg-xray-cloud' },
      regionField, urlField,
      field('Client ID', clientId),
      field('Client Secret', secret.wrap, s.hasClientSecret ? 'Enregistré et masqué. Saisissez une nouvelle valeur pour le remplacer.' : 'Jamais affiché en clair ni écrit dans les journaux.'))

    function syncVisibility() {
      cloudBlock.hidden = mode.value === 'server'
      urlField.hidden = region.value !== 'custom'
    }
    mode.addEventListener('change', syncVisibility)
    region.addEventListener('change', () => {
      const r = regions.find((it) => it.id === region.value)
      if (r) cloudUrl.value = r.url
      syncVisibility()
    })
    syncVisibility()

    function payload() {
      const out = {
        mode: mode.value,
        region: region.value,
        cloudBaseUrl: cloudUrl.value,
        clientId: clientId.value,
        testIssueType: testType.value,
        testPlanIssueType: planType.value,
        linkType: linkType.value,
        defaultTestPlanKey: defaultPlan.value,
        playwrightTestType: pwType.value,
        gherkinTestType: ghType.value,
        labels: labels.value,
      }
      if (secret.el.value.trim()) out.clientSecret = secret.el.value.trim()
      return out
    }

    const feedback = h('div', { class: 'rg-xray-feedback' })
    const saveBtn = h('button', { class: 'p-btn p-btn--primary', type: 'button', disabled: !canEdit }, P.icon('save'), 'Enregistrer')
    const testBtn = h('button', { class: 'p-btn', type: 'button', disabled: !x.settings.jira.configured, title: x.settings.jira.configured ? '' : 'Connectez d’abord JIRA' }, P.icon('zap'), 'Tester la connexion')

    saveBtn.addEventListener('click', () => P.busy(saveBtn, async () => {
      try {
        const r = await P.api('/api/xray/settings', { method: 'PUT', body: payload() })
        state.xray.settings = r
        P.toast('Réglages Xray enregistrés')
        renderPanel()
        refreshTabs()
      } catch (err) {
        P.clear(feedback)
        feedback.appendChild(P.banner('error', err.message))
      }
    }))

    testBtn.addEventListener('click', () => P.busy(testBtn, async () => {
      P.clear(feedback)
      feedback.appendChild(h('div', { class: 'rg-xray-testing' }, h('span', { class: 'p-spinner' }), 'Test de JIRA et d’Xray en cours…'))
      try {
        const r = await P.api('/api/xray/test-connection', { body: canEdit ? payload() : {} })
        state.xray.test = r
        P.clear(feedback)
        feedback.appendChild(testResult(r))
      } catch (err) {
        P.clear(feedback)
        const hint = err?.data?.details?.hint
        feedback.appendChild(P.banner('error', [h('strong', null, err.message), hint ? h('div', null, hint) : null]))
      }
    }))
    if (x.test) feedback.appendChild(testResult(x.test))

    const inherited = (x.settings.inheritedFrom || []).length && !x.settings.saved
    return P.card({
      title: 'Xray',
      sub: `Mode retenu : ${x.settings.effectiveModeLabel || '—'}${x.settings.configured ? '' : ' — à configurer'}`,
      icon: 'flask',
      actions: x.settings.configured ? P.badge('Configuré', 'mint') : P.badge('À configurer', 'amber'),
      body: [
        canEdit ? null : P.banner('info', 'Seul un administrateur peut modifier ces réglages. Vous pouvez tester la connexion et consulter l’historique.'),
        inherited ? P.banner('blue', 'Identifiants Xray repris du Hook Git (.env) ou du profil projet : enregistrez pour les conserver ici.') : null,
        h('p', { class: 'p-muted rg-xray-intro' },
          'Chaque test validé devient un ticket ', h('strong', null, s.testIssueType || 'Test'),
          ' relié au récit (le test « tests » le récit), avec sa définition Xray : code Playwright (type Generic) ou scénarios Gherkin (type Cucumber), et peut être ajouté à un plan de test.'),
        h('div', { class: 'p-form-grid' },
          field('Mode', mode, 'Automatique : Xray Cloud si JIRA est sur atlassian.net, sinon Xray Server / Data Center (API /rest/raven avec le jeton JIRA).'),
          field('Plan de test par défaut', defaultPlan, 'Proposé à chaque envoi ; modifiable au moment de l’envoi.'),
          cloudBlock,
          field('Type d’issue Test', testType),
          field('Type d’issue Plan de test', planType),
          field('Type de lien vers le récit', linkType, 'Type Xray « Test » : le test « tests » le récit.'),
          field('Étiquettes ajoutées', labels, 'Séparées par des virgules ; « playwright » devient « gherkin » pour un envoi Gherkin.'),
          field('Type Xray des tests Playwright', pwType),
          field('Type Xray des tests Gherkin', ghType)),
        h('div', { class: 'p-row rg-xray-actions' }, saveBtn, testBtn),
        feedback,
      ],
    })
  }

  function testResult(r) {
    return h('div', { class: 'rg-xray-result' },
      P.banner(r.success ? 'info' : 'warn', [
        h('strong', null, r.success ? 'Connexion réussie. ' : 'Certaines vérifications ont échoué. '),
        `Mode : ${r.modeLabel || r.mode} — ${P.fmtDuration(r.durationMs)}.`,
      ], r.success ? 'checkCircle' : 'alert'),
      h('ul', { class: 'rg-xray-checks' }, (r.checks || []).map((c) => h('li', { class: c.ok ? 'ok' : 'ko' },
        P.icon(c.ok ? 'checkCircle' : 'xCircle', 15),
        h('div', null, h('strong', null, c.label), c.message ? h('span', null, ` — ${c.message}`) : null, c.hint ? h('div', { class: 'p-hint' }, c.hint) : null)))))
  }

  // ---------------------------------------------------------------- À propos

  async function loadAbout() {
    const [health, meta, paths] = await Promise.all([
      P.api('/api/health').catch(() => null),
      P.api('/api/wizard/meta').catch(() => null),
      state.paths ? Promise.resolve(state.paths) : P.api('/api/wizard/paths').catch(() => null),
    ])
    state.health = health || {}
    state.meta = meta || {}
    if (paths) state.paths = paths
  }

  function renderAbout() {
    const root = h('div', { class: 'rg-panel' })
    if (!state.meta) {
      root.appendChild(loadingCard('Lecture des informations…'))
      loadAbout().then(renderPanel, (err) => {
        P.clear(root)
        root.appendChild(errorBanner(err, () => renderPanel()))
      })
      return root
    }
    const meta = state.meta
    const version = state.health.version || meta.version || '—'
    const p = state.paths || {}
    const confDir = confDirOf(p)

    root.appendChild(h('div', { class: 'p-kpis' },
      P.kpi({ label: 'Version', value: version, detail: meta.name || 'Wizard QA' }),
      P.kpi({ label: 'Mode', value: state.user.embedded ? 'VS Code' : 'Web', detail: state.user.embedded ? 'Extension (utilisateur local)' : 'Application authentifiée' }),
      P.kpi({ label: 'Serveur', value: location.port || (location.protocol === 'https:' ? '443' : '80'), detail: isLocalHost ? 'Boucle locale (poste)' : location.hostname }),
      P.kpi({ label: 'Session', value: state.user.username, detail: ROLE_LABEL[state.user.role] || state.user.role })))

    root.appendChild(P.card({
      title: meta.name || 'Wizard QA',
      sub: meta.footerLabel || '',
      icon: 'info',
      body: h('div', { class: 'p-stack' },
        h('p', { class: 'p-muted', style: { margin: 0 } },
          'Assistant de l’équipe QA : préparation du poste, récits JIRA et scénarios Gherkin, tests web Playwright, ',
          'tests de performance k6, synchronisation Xray et livrables de documentation.'),
        h('div', { class: 'p-row' },
          h('a', { class: 'p-btn p-btn--sm', href: '/wiki.html' }, P.icon('book'), 'Wiki'),
          h('a', { class: 'p-btn p-btn--sm', href: '/' }, P.icon('gauge'), 'Pilotage'))),
    }))

    root.appendChild(h('div', { class: 'p-grid p-grid-2' },
      P.card({
        title: 'Emplacement des données',
        sub: 'Tout reste sur ce poste, dans le projet de test',
        icon: 'server',
        body: h('dl', { class: 'p-dl' },
          h('dt', null, 'Projet de test'), h('dd', null, pathRow(p.repoRoot)),
          h('dt', null, 'Configuration'), h('dd', null, pathRow(confDir)),
          h('dt', null, 'Comptes'), h('dd', null, pathRow(joinPath(confDir, 'users.json'))),
          h('dt', null, 'Sessions'), h('dd', null, pathRow(joinPath(confDir, 'sessions.json'))),
          h('dt', null, 'Données des modules'), h('dd', null, pathRow(joinPath(p.repoRoot, '.wizard-qa')))),
      }),
      P.card({
        title: 'Sécurité',
        icon: 'shield',
        body: h('ul', { class: 'rg-list' },
          h('li', null, 'Mots de passe hachés (scrypt avec sel), jamais stockés en clair.'),
          h('li', null, 'Session par cookie HttpOnly, expirée après 12 heures.'),
          h('li', null, 'Blocage de 10 minutes après 5 échecs de connexion.'),
          h('li', null, 'Jetons et clés d’API masqués dans les écrans et exclus de l’export par défaut.'),
          h('li', null, 'Écoute limitée à la boucle locale, sauf hôtes explicitement autorisés.')),
      })))
    return root
  }

  // ---------------------------------------------------------------- démarrage

  async function init(ready) {
    app = document.getElementById('app')
    state.user = ready?.user || null
    await reloadSession()
    // On ne vide pas #app : le shell y a inséré le guide de page.
    document.getElementById('rgLoading')?.remove()
    if (!state.user) {
      app.appendChild(P.banner('error', 'Session introuvable : reconnectez-vous.'))
      return
    }
    state.isAdmin = state.user.role === 'admin'

    const tabsHost = h('div')
    panelHost = h('div')
    app.append(tabsHost, panelHost)

    const wanted = decodeURIComponent(location.hash.replace(/^#/, ''))
    state.tab = TAB_IDS.includes(wanted) ? wanted : 'compte'
    tabsCtl = P.tabs(tabsHost, tabItems(), state.tab, (id) => selectTab(id))
    selectTab(state.tab, { push: false })

    // Compteurs des onglets administrateur, chargés en arrière-plan.
    if (state.isAdmin) {
      if (!state.users) loadUsers().catch(() => {})
      if (!state.files) loadConfiguration().catch(() => {})
    }
    window.addEventListener('hashchange', () => {
      const id = location.hash.replace(/^#/, '')
      if (TAB_IDS.includes(id) && id !== state.tab) selectTab(id, { push: false })
    })
  }

  P.whenShell().then(init).catch((err) => {
    document.getElementById('rgLoading')?.remove()
    const root = document.getElementById('app')
    if (root) root.appendChild(errorBanner(err, () => location.reload()))
  })
})()

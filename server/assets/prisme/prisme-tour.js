/*
 * PRISME — visite guidée (autodémo encadrée), transposée de l'autopilote PRISME (docs/demo/VISITE-GUIDEE.md).
 *
 * Les pages ne savent rien de la visite : elle navigue par l'URL de l'étape, clique au besoin un onglet ou un
 * bouton (action), attend la cible (sélecteur CSS ou texte, 6 s au plus) puis l'entoure d'un halo qui respire,
 * voile le reste de l'écran et affiche une étiquette numérotée (titre + une phrase) qui suit la cible.
 * Barre du bas : ◇ Démonstration, ⏮ ⏯ ⏭, étapes cliquables, temps, vitesse, « ■ Arrêter l'autodémo ».
 *
 * L'état (étape, temps, vitesse, pause, arrêt) vit dans sessionStorage : la coquille (prisme-shell.js) charge
 * ce fichier à chaque page tant qu'une visite est en cours et la reprend où elle en était.
 *
 * API : Prisme.tour.start(idEtape?), .resume(), .stop(), .close(), .next(), .prev(), .jump(i), .toggle(),
 *       .state() (instantané), .script() (script normalisé).
 */
;(function () {
  'use strict'
  const P = window.Prisme
  if (!P || P.tour) return
  const { h } = P

  const KEY = 'p-tour'
  const SCRIPT_KEY = 'p-tour-script'
  const WAIT_MS = 6000
  const SPEEDS = [0.5, 1, 2]
  const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  let script = null      // { titre, etapes: [...] } normalisé
  let st = null          // { idx, t, speed, paused, stopped, done, acted }
  let ui = null
  let target = null
  let preparing = false
  let seq = 0
  let lastFrame = 0
  let lastSave = 0
  let lastRefind = 0
  let labelFor = -1
  let scrolledAt = 0
  let scrollTries = 0

  // ---------------------------------------------------------------- stockage (session)

  function readStore(key) {
    try { return JSON.parse(sessionStorage.getItem(key) || 'null') } catch { return null }
  }
  function writeStore(key, value) {
    try {
      if (value == null) sessionStorage.removeItem(key)
      else sessionStorage.setItem(key, JSON.stringify(value))
    } catch { /* stockage indisponible : la visite reste sur cette page */ }
  }
  const save = () => { lastSave = performance.now(); writeStore(KEY, st) }

  // ---------------------------------------------------------------- script

  const pick = (o, ...keys) => { for (const k of keys) if (o[k] != null) return o[k]; return undefined }

  function normAction(a) {
    if (a == null) return []
    const list = Array.isArray(a) ? a : [a]
    return list.map((x) => (typeof x === 'string' ? { clic: x } : { clic: pick(x, 'clic', 'click'), attente: Number(pick(x, 'attente', 'wait')) || 0 }))
      .filter((x) => x.clic)
  }

  function normalize(raw) {
    const etapes = (pick(raw || {}, 'etapes', 'steps') || []).map((e, i) => {
      const sec = Number(pick(e, 'secondes', 'seconds'))
      return {
        id: String(e.id || `etape-${i + 1}`),
        page: String(pick(e, 'page', 'screen') || '/'),
        action: normAction(e.action),
        cible: pick(e, 'cible', 'target') || '',
        texteCible: pick(e, 'texteCible', 'match') || '',
        rang: Number(pick(e, 'rang', 'index')) || 0,
        voile: pick(e, 'voile', 'dim') !== false,
        secondes: Number.isFinite(sec) ? Math.min(300, Math.max(2, sec)) : 12,
        titre: String(pick(e, 'titre', 'title') || ''),
        texte: String(pick(e, 'texte', 'text') || ''),
      }
    })
    return { titre: String(pick(raw || {}, 'titre', 'title') || 'Visite guidée'), etapes }
  }

  async function loadScript() {
    if (script) return script
    const cached = readStore(SCRIPT_KEY)
    if (cached?.etapes?.length) return (script = cached)
    const raw = await P.api('/api/demo/visite')
    script = normalize(raw)
    if (!script.etapes.length) throw new Error('Le script de visite ne contient aucune étape.')
    writeStore(SCRIPT_KEY, script)
    return script
  }

  // ---------------------------------------------------------------- temps

  const steps = () => script.etapes
  const dur = (i) => steps()[i].secondes * 1000
  const total = () => steps().reduce((s, e) => s + e.secondes * 1000, 0)
  const elapsed = () => steps().slice(0, st.idx).reduce((s, e) => s + e.secondes * 1000, 0) + Math.min(st.t, dur(st.idx))
  function fmt(ms) {
    const s = Math.max(0, Math.round(ms / 1000))
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  }
  const speedLabel = (v) => `×${String(v).replace('.', ',')}`

  // ---------------------------------------------------------------- pages et cibles

  const normPath = (p) => {
    const x = String(p || '/')
    return x === '/index.html' ? '/' : x.replace(/\/$/, '') || '/'
  }

  /** 'ici' : bonne page ; 'hash' : bonne page, ancre à poser ; 'ailleurs' : navigation nécessaire. */
  function where(step) {
    const u = new URL(step.page, location.origin)
    if (normPath(u.pathname) !== normPath(location.pathname)) return 'ailleurs'
    const here = new URLSearchParams(location.search)
    for (const [k, v] of u.searchParams) if (here.get(k) !== v) return 'ailleurs'
    if (u.hash && u.hash !== location.hash) return 'hash'
    return 'ici'
  }

  /** Découpe « .a, .b » en sélecteurs de repli (les virgules entre crochets ou parenthèses restent). */
  function splitSelectors(sel) {
    const out = []
    let depth = 0
    let quote = ''
    let cur = ''
    for (const c of String(sel || '')) {
      if (quote) { if (c === quote) quote = ''; cur += c; continue }
      if (c === '"' || c === "'") quote = c
      else if (c === '(' || c === '[') depth++
      else if (c === ')' || c === ']') depth--
      else if (c === ',' && depth === 0) { if (cur.trim()) out.push(cur.trim()); cur = ''; continue }
      cur += c
    }
    if (cur.trim()) out.push(cur.trim())
    return out
  }

  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase()

  function visible(el) {
    if (!el || !el.isConnected || el.closest('.p-tour-ui')) return false
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) return false
    const cs = getComputedStyle(el)
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05
  }

  function query(sel) {
    try { return [...document.querySelectorAll(sel)] } catch { return null }
  }

  /** Garde les éléments les plus intérieurs (un parent qui contient un autre candidat est écarté). */
  function innermost(list) {
    return list.filter((el) => !list.some((o) => o !== el && el.contains(o)))
  }

  function readingOrder(list) {
    return list.map((el) => ({ el, r: el.getBoundingClientRect() }))
      .sort((a, b) => (Math.abs(a.r.top - b.r.top) > 4 ? a.r.top - b.r.top : a.r.left - b.r.left))
      .map((x) => x.el)
  }

  function findTarget(step) {
    const text = norm(step.texteCible)
    const sels = step.cible ? splitSelectors(step.cible) : ['h1, h2, h3, .p-card, .p-kpi, button, a, label, th, li']
    for (const sel of sels) {
      let list = (query(sel) || []).filter(visible)
      if (text) list = innermost(list.filter((el) => norm(el.textContent).includes(text)))
      list = readingOrder(list)
      const el = list[Math.min(step.rang, list.length - 1)]
      if (el && list.length > step.rang) return el
    }
    return null
  }

  const CLICKABLE = 'button, a, [role="tab"], [role="button"], [role="option"], summary, .p-step, .p-tab, tr.clickable, label'

  function findClickable(spec) {
    const bySel = query(spec)
    if (bySel) {
      const el = bySel.find(visible)
      if (el) return el
    }
    const text = norm(spec)
    const list = (query(CLICKABLE) || []).filter((el) => visible(el) && norm(el.textContent).includes(text))
    if (!list.length) return null
    const exact = list.filter((el) => norm(el.textContent).startsWith(text))
    return readingOrder(innermost(exact.length ? exact : list))[0]
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  async function waitFor(fn, my) {
    const until = performance.now() + WAIT_MS
    while (performance.now() < until) {
      if (my !== seq) return null
      const el = fn()
      if (el) return el
      await sleep(150)
    }
    return null
  }

  function closeModals() {
    for (const b of document.querySelectorAll('.p-overlay .p-modal-head [aria-label="Fermer"]')) b.click()
  }

  // ---------------------------------------------------------------- interface

  function buildUi() {
    if (ui) return ui
    const hole = h('div', { class: 'p-tour-ui p-tour-hole', 'aria-hidden': 'true' })
    const label = h('div', { class: 'p-tour-ui p-tour-label', role: 'status', 'aria-live': 'polite' })
    const btn = (cls, text, title, onclick) => h('button', { class: `p-tour-btn ${cls}`, type: 'button', title, 'aria-label': title, onclick }, text)
    const prevB = btn('', '⏮', 'Étape précédente (Page préc.)', () => prev())
    const playB = btn('p-tour-play', '⏸', 'Pause / lecture (Espace)', () => toggle())
    const nextB = btn('', '⏭', 'Étape suivante (Page suiv.)', () => next())
    const track = h('div', { class: 'p-tour-track', role: 'group', 'aria-label': 'Étapes de la visite' })
    const now = h('div', { class: 'p-tour-now' })
    const time = h('div', { class: 'p-tour-time p-mono' })
    const speed = h('div', { class: 'p-tour-speed', role: 'group', 'aria-label': 'Vitesse' },
      SPEEDS.map((v) => h('button', { type: 'button', 'data-speed': String(v), onclick: () => setSpeed(v) }, speedLabel(v))))
    const actions = h('div', { class: 'p-tour-actions' })
    const bar = h('div', { class: 'p-tour-ui p-tour-bar', role: 'region', 'aria-label': 'Démonstration guidée' },
      h('div', { class: 'p-tour-brand', title: 'Données de démonstration (◇ simulées)' }, h('span', { class: 'p-tour-diamond' }, '◇'), h('span', { class: 'p-tour-brand-text' }, 'Démonstration')),
      h('div', { class: 'p-tour-ctrl' }, prevB, playB, nextB),
      h('div', { class: 'p-tour-mid' }, track, h('div', { class: 'p-tour-info' }, now, time)),
      speed,
      actions)
    document.body.append(hole, label, bar)
    document.documentElement.classList.add('p-tour-on')
    ui = { hole, label, bar, track, now, time, speed, actions, playB, prevB, nextB, trackBuilt: false }
    return ui
  }

  function removeUi() {
    if (!ui) return
    ui.hole.remove()
    ui.label.remove()
    ui.bar.remove()
    ui = null
    document.documentElement.classList.remove('p-tour-on', 'p-tour-veiled')
  }

  function buildTrack() {
    P.clear(ui.track)
    steps().forEach((s, i) => {
      ui.track.appendChild(h('button', {
        type: 'button',
        class: 'p-tour-seg',
        style: { flexGrow: String(s.secondes) },
        title: `${i + 1}. ${s.titre}`,
        'aria-label': `Étape ${i + 1} : ${s.titre}`,
        onclick: () => jump(i),
      }, h('span', { class: 'p-tour-seg-fill' })))
    })
    ui.trackBuilt = true
  }

  function renderBar() {
    if (!ui || !st) return
    if (!ui.trackBuilt) buildTrack()
    const n = steps().length
    const s = steps()[st.idx]
    const segs = ui.track.children
    for (let i = 0; i < segs.length; i++) {
      segs[i].classList.toggle('done', i < st.idx || st.done)
      segs[i].classList.toggle('current', i === st.idx && !st.done)
      segs[i].firstChild.style.width = i < st.idx || st.done ? '100%' : i === st.idx ? `${Math.min(100, (st.t / dur(i)) * 100)}%` : '0%'
    }
    ui.now.textContent = st.done ? 'Visite terminée' : `${st.idx + 1}/${n} · ${s.titre}${st.stopped ? ' — arrêtée' : st.paused ? ' — en pause' : ''}`
    const tot = total()
    const el = st.done ? tot : elapsed()
    ui.time.textContent = `${fmt(el)} / ${fmt(tot)} · reste ${fmt(tot - el)}`
    ui.playB.textContent = st.paused || st.stopped || st.done ? '▶' : '⏸'
    ui.playB.classList.toggle('is-paused', Boolean(st.paused))
    for (const b of ui.speed.children) b.classList.toggle('active', Number(b.dataset.speed) === st.speed)
    const mode = st.done ? 'done' : st.stopped ? 'stopped' : 'run'
    if (ui.actions.dataset.mode !== mode) {
      ui.actions.dataset.mode = mode
      P.clear(ui.actions)
      if (mode === 'run') {
        ui.actions.append(h('button', { class: 'p-tour-stop', type: 'button', title: 'Rendre la main (Échap)', onclick: () => stop() }, '■ Arrêter l’autodémo'))
      } else {
        ui.actions.append(
          mode === 'done'
            ? h('button', { class: 'p-tour-resume', type: 'button', onclick: () => start() }, '↺ Rejouer')
            : h('button', { class: 'p-tour-resume', type: 'button', onclick: () => resume() }, '▶ Reprendre la visite'),
          h('button', { class: 'p-tour-btn p-tour-close', type: 'button', title: 'Quitter la démonstration', 'aria-label': 'Quitter la démonstration', onclick: () => close() }, '✕'))
      }
    }
    ui.bar.classList.toggle('is-stopped', mode !== 'run')
  }

  function hideSpot() {
    target = null
    labelFor = -1
    if (!ui) return
    ui.hole.classList.remove('is-on', 'is-target', 'no-veil')
    ui.label.classList.remove('is-on')
    document.documentElement.classList.remove('p-tour-veiled')
  }

  function renderLabel(step) {
    P.clear(ui.label)
    ui.label.append(
      h('div', { class: 'p-tour-label-head' },
        h('span', { class: 'p-tour-num' }, String(st.idx + 1)),
        h('span', { class: 'p-tour-title' }, step.titre),
        h('span', { class: 'p-tour-pause' }, '⏸ En pause')),
      h('div', { class: 'p-tour-text' }, step.texte))
    labelFor = st.idx
  }

  function showSpot(step) {
    if (!ui) return
    if (labelFor !== st.idx) renderLabel(step)
    ui.hole.classList.add('is-on')
    ui.hole.classList.toggle('is-target', Boolean(target))
    ui.hole.classList.toggle('no-veil', !step.voile)
    ui.label.classList.add('is-on')
    ui.label.classList.toggle('is-free', !target)
    document.documentElement.classList.toggle('p-tour-veiled', step.voile)
    place()
  }

  /** Place le halo sur la cible et l'étiquette à côté, sans jamais sortir de l'écran. */
  function place() {
    if (!ui || !ui.hole.classList.contains('is-on')) return
    const vw = window.innerWidth
    const barH = ui.bar.offsetHeight || 56
    const vh = window.innerHeight - barH
    const lw = ui.label.offsetWidth || 320
    const lh = ui.label.offsetHeight || 80
    const gap = 14
    ui.label.classList.toggle('is-paused', Boolean(st?.paused))
    if (!target) {
      ui.hole.style.cssText = `left:${vw / 2}px;top:${vh / 2}px;width:0;height:0`
      ui.label.style.left = `${Math.max(12, (vw - lw) / 2)}px`
      ui.label.style.top = `${Math.min(76, vh - lh - 12)}px`
      return
    }
    const r = target.getBoundingClientRect()
    const pad = 6
    const left = Math.max(4, r.left - pad)
    const top = Math.max(4, r.top - pad)
    const right = Math.min(vw - 4, r.right + pad)
    const bottom = Math.min(vh - 4, r.bottom + pad)
    ui.hole.style.cssText = `left:${left}px;top:${top}px;width:${Math.max(0, right - left)}px;height:${Math.max(0, bottom - top)}px`
    let y = bottom + gap
    if (y + lh > vh - 8) y = top - gap - lh
    if (y < 8) y = Math.min(Math.max(8, top + 12), vh - lh - 8)
    const x = Math.min(Math.max(12, left), vw - lw - 12)
    ui.label.style.left = `${Math.max(12, x)}px`
    ui.label.style.top = `${Math.max(8, Math.min(y, vh - lh - 8))}px`
  }

  // ---------------------------------------------------------------- déroulé

  async function enterStep(i, fresh) {
    const n = steps().length
    st.idx = Math.max(0, Math.min(n - 1, i))
    if (fresh) { st.t = 0; st.acted = false }
    st.done = false
    save()
    buildUi()
    renderBar()
    const step = steps()[st.idx]
    const my = ++seq
    hideSpot()
    const w = where(step)
    if (w === 'ailleurs') {
      preparing = true
      location.href = step.page
      return
    }
    if (w === 'hash') location.hash = new URL(step.page, location.origin).hash
    preparing = true
    if (!st.acted && step.action.length) {
      st.acted = true
      save()
      for (const a of step.action) {
        const el = await waitFor(() => findClickable(a.clic), my)
        if (my !== seq) return
        if (el) {
          el.click()
          await sleep(a.attente || 450)
        } else {
          console.warn('[visite] action introuvable :', step.id, a.clic)
        }
        if (my !== seq) return
      }
    }
    const el = step.cible || step.texteCible ? await waitFor(() => findTarget(step), my) : null
    if (my !== seq) return
    if (!el && (step.cible || step.texteCible)) console.warn('[visite] cible absente :', step.id, step.cible)
    target = el
    document.documentElement.dataset.tourStep = step.id
    document.documentElement.dataset.tourFound = el ? '1' : '0'
    scrollTries = 0
    if (el) bringIntoView(el, true)
    preparing = false
    showSpot(step)
    lastFrame = performance.now()
  }

  /** Amène la cible à l'écran (la page peut défiler d'elle-même juste après : on réessaie, 3 fois au plus). */
  function bringIntoView(el, first) {
    const r = el.getBoundingClientRect()
    const tall = r.height > (window.innerHeight - 120) * 0.8
    const far = r.top < -window.innerHeight || r.bottom > window.innerHeight * 2
    scrolledAt = performance.now()
    scrollTries++
    el.scrollIntoView({ block: tall ? 'start' : 'center', inline: 'nearest', behavior: reduced() || far || !first ? 'auto' : 'smooth' })
  }

  function offscreen(el) {
    const r = el.getBoundingClientRect()
    const vh = window.innerHeight - (ui?.bar.offsetHeight || 56)
    return r.bottom < 70 || r.top > vh - 30
  }

  function leaveStep() {
    const step = steps()[st.idx]
    if (step?.action.length) closeModals()
  }

  function next() {
    if (!st) return
    if (st.stopped) st.stopped = false
    if (st.idx >= steps().length - 1) return finish()
    leaveStep()
    enterStep(st.idx + 1, true)
  }

  function prev() {
    if (!st) return
    st.stopped = false
    leaveStep()
    enterStep(st.idx - 1, true)
  }

  function jump(i) {
    if (!st) return
    st.stopped = false
    st.paused = false
    leaveStep()
    enterStep(i, true)
  }

  function toggle() {
    if (!st) return
    if (st.done) return start()
    if (st.stopped) return resume()
    st.paused = !st.paused
    save()
    // en pause sur une autre page : la lecture ramène sur l'écran de l'étape
    if (!st.paused && (where(steps()[st.idx]) === 'ailleurs' || (!preparing && !ui?.hole.classList.contains('is-on')))) return enterStep(st.idx, false)
    renderBar()
    place()
  }

  function setSpeed(v) {
    if (!st) return
    st.speed = v
    save()
    renderBar()
  }

  function finish() {
    leaveStep()
    seq++
    st.done = true
    st.paused = false
    st.t = dur(st.idx)
    save()
    hideSpot()
    renderBar()
  }

  /** « Arrêter l'autodémo » : la main est rendue, la barre reste pour reprendre. */
  function stop() {
    if (!st) return
    seq++
    preparing = false
    st.stopped = true
    st.paused = false
    save()
    hideSpot()
    renderBar()
  }

  function resume() {
    if (!st) return
    st.stopped = false
    st.paused = false
    if (where(steps()[st.idx]) === 'ailleurs') st.acted = false
    enterStep(st.idx, false)
  }

  function close() {
    seq++
    st = null
    writeStore(KEY, null)
    hideSpot()
    removeUi()
    delete document.documentElement.dataset.tourStep
  }

  async function start(fromId) {
    // un nouveau départ relit le script (il a pu être modifié depuis la dernière visite)
    script = null
    writeStore(SCRIPT_KEY, null)
    await loadScript()
    const i = fromId ? steps().findIndex((s) => s.id === fromId) : 0
    st = { idx: Math.max(0, i), t: 0, speed: st?.speed || 1, paused: false, stopped: false, done: false, acted: false }
    enterStep(st.idx, true)
  }

  /** Au chargement d'une page : reprend la visite en cours (ou affiche seulement la barre). */
  async function restore() {
    const saved = readStore(KEY)
    if (!saved) return false
    await loadScript()
    st = { idx: 0, t: 0, speed: 1, paused: false, stopped: false, done: false, acted: false, ...saved }
    if (st.idx >= steps().length) st.idx = steps().length - 1
    buildUi()
    renderBar()
    const away = where(steps()[st.idx]) === 'ailleurs'
    if (st.done || st.stopped || (st.paused && away)) return true
    enterStep(st.idx, false)
    return true
  }

  // ---------------------------------------------------------------- horloge et suivi

  // horloge : intervalle (continue si l'onglet ralentit les images) ; suivi de la cible : à chaque image
  function tick() {
    const now = performance.now()
    const dt = Math.min(1000, Math.max(0, now - (lastFrame || now)))
    lastFrame = now
    if (st && ui && !st.stopped && !st.done && !preparing && !st.paused) {
      st.t += dt * st.speed
      if (st.t >= dur(st.idx)) next()
    }
    if (st && ui) {
      if (now - lastSave > 1000 && !st.done) save()
      renderBar()
    }
  }
  setInterval(tick, 200)

  function frame(now) {
    if (st && ui && !st.stopped && !st.done && !preparing && ui.hole.classList.contains('is-on')) {
      if (target && !target.isConnected && now - lastRefind > 400) {
        lastRefind = now
        target = findTarget(steps()[st.idx])
        ui.hole.classList.toggle('is-target', Boolean(target))
        ui.label.classList.toggle('is-free', !target)
      }
      if (target && scrollTries < 4 && now - scrolledAt > 900 && offscreen(target)) bringIntoView(target, false)
      place()
    }
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)

  const typing = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))

  document.addEventListener('keydown', (e) => {
    if (!st || st.done || e.ctrlKey || e.metaKey || e.altKey) return
    if (st.stopped) return
    if (e.key === ' ' || e.code === 'Space') {
      // sur un bouton de la page, Espace garde son sens ; sur la barre de la visite, c'est pause / lecture
      if (typing(e.target) || (e.target.closest && e.target.closest('button, a, summary') && !e.target.closest('.p-tour-ui'))) return
      e.preventDefault()
      toggle()
    } else if (e.key === 'PageDown') {
      e.preventDefault()
      next()
    } else if (e.key === 'PageUp') {
      e.preventDefault()
      prev()
    } else if (e.key === 'Escape') {
      if (document.querySelector('.p-overlay, .p-palette')) return
      e.preventDefault()
      stop()
    }
  })

  // un clic de souris dans l'écran met la visite en pause (la barre et l'étiquette exceptées)
  document.addEventListener('mousedown', (e) => {
    if (!e.isTrusted || !st || st.stopped || st.done || st.paused) return
    if (e.target.closest && e.target.closest('.p-tour-ui')) return
    st.paused = true
    save()
    renderBar()
    place()
  }, true)

  window.addEventListener('resize', () => place())
  window.addEventListener('scroll', () => place(), true)

  P.tour = {
    start,
    restore,
    resume,
    stop,
    close,
    next,
    prev,
    jump,
    toggle,
    setSpeed,
    state: () => (st ? { ...st, total: script ? total() : 0, elapsed: script ? elapsed() : 0, target: Boolean(target), preparing } : null),
    script: () => script,
  }
})()

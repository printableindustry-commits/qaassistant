// Enregistreur d'animations : pilote Wizard QA avec playwright-core (Edge, sans fenêtre) et capture
// l'écran à intervalle régulier pendant des actions réelles. Chaque image garde sa légende courante.
// Sortie : <dossier>/<nom>/NNNNN.jpg + manifest.json ({ images: [{ f, t, legende }] }).
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'

const WORKSPACE = process.env.SUPPORTS_NODE_MODULES_ROOT || 'C:/Users/verge/OneDrive/Documents/qaassistant/workspace'
const require = createRequire(path.join(WORKSPACE, 'package.json'))
const { chromium } = require('playwright-core')

export const BASE = process.env.SUPPORTS_BASE_URL || 'http://127.0.0.1:4001'
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Masque toute mention interne (organisation réelle, chemins du poste) dans les captures : supports 100 % fictifs.
function masque() {
  const R = [[/Outil\s*[—-]\s*TRIBU IT pour CA-TS/g, 'Démonstration'], [/TRIBU IT pour CA-TS/g, 'Démonstration'],
    [/poste CA-TS/g, 'poste de test'], [/CA-TS/g, 'Banque Horizon'], [/\(CATS\)/g, ''],
    [/C:\\Users\\[^\\\s]+\\AppData\\Local\\Temp\\[^\s,;)]*?ws-\d+/g, 'D:\\QA\\irma-tests'],
    [/C:\\Users\\[^\\\s]+\\AppData\\Local\\wizard-qa/g, 'D:\\QA\\outils'],
    [/C:\\Users\\[^\\\s]+/g, 'D:\\QA'],
    [/^\s*null\s*$/, ''], [/(^|\s)[A-Za-z0-9-]+ \((Windows_NT)/, '$1POSTE-QA-01 ($2'],
    [/\bEclipse\b/g, 'POSTE-QA-01']]
  const fix = (n) => { let v = n.nodeValue; const o = v; for (const [a, b] of R) v = v.replace(a, b); if (v !== o) n.nodeValue = v }
  const walk = (root) => { const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) fix(n) }
  const go = () => {
    walk(document.body)
    new MutationObserver((ms) => { for (const m of ms) {
      if (m.type === 'characterData') fix(m.target)
      else m.addedNodes.forEach((x) => { if (x.nodeType === 3) fix(x); else if (x.nodeType === 1) walk(x) })
    } }).observe(document.body, { subtree: true, childList: true, characterData: true })
  }
  if (document.body) go(); else document.addEventListener('DOMContentLoaded', go)
}

export async function ouvrirNavigateur({ connecte = true } = {}) {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'fr-FR' })
  await context.addInitScript(masque)
  if (connecte) {
    const r = await context.request.post(`${BASE}/api/auth/login`, {
      headers: { Origin: BASE }, data: { username: 'demo', password: 'demo' } })
    if (!r.ok()) throw new Error('Connexion refusée : ' + r.status())
  }
  const page = await context.newPage()
  return { browser, context, page }
}

// Capture par le flux d'écran du navigateur (CDP Page.startScreencast) : une image à chaque changement
// d'affichage, ramenée à « ips » images par seconde au plus (la dernière image avant un temps calme est gardée).
export class Enregistreur {
  constructor(page, dossier, { ips = 7, qualite = 90 } = {}) {
    this.page = page; this.dossier = dossier; this.periode = 1000 / ips; this.qualite = qualite
    this.images = []; this.legende = ''; this.actif = false; this.attente = null
    fs.rmSync(dossier, { recursive: true, force: true }); fs.mkdirSync(dossier, { recursive: true })
  }
  legender(texte) { this.legende = texte }
  ecrire(img) {
    const f = String(this.images.length).padStart(5, '0') + '.jpg'
    fs.writeFileSync(path.join(this.dossier, f), Buffer.from(img.data, 'base64'))
    this.images.push({ f, t: img.t, legende: img.legende })
    this.dernier = img.t
  }
  async demarrer(legende) {
    if (legende) this.legende = legende
    this.actif = true; this.t0 = Date.now(); this.dernier = -1e9
    this.cdp = await this.page.context().newCDPSession(this.page)
    this.cdp.on('Page.screencastFrame', async (ev) => {
      this.cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => {})
      if (!this.actif || this.suspendu || Date.now() < this.ignorerJusqua) return  // 1re image du flux parfois périmée
      const img = { data: ev.data, t: Date.now() - this.t0, legende: this.legende }
      clearTimeout(this.minuteur)
      if (img.t - this.dernier >= this.periode) { this.attente = null; this.ecrire(img) }
      else {
        this.attente = img
        this.minuteur = setTimeout(() => { if (this.attente) { this.ecrire(this.attente); this.attente = null } }, this.periode)
      }
    })
    this.ignorerJusqua = Date.now() + 250
    await this.cdp.send('Page.startScreencast', { format: 'jpeg', quality: this.qualite, maxWidth: 960, maxHeight: 600, everyNthFrame: 1 })
    await sleep(300)
    this.t0 = Date.now()
    // force une image fraîche (changement invisible d'un pixel)
    await this.page.evaluate(() => {
      const d = document.createElement('div'); d.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;background:rgba(0,0,0,.01);z-index:2147483646'
      document.documentElement.appendChild(d); setTimeout(() => d.remove(), 120)
    }).catch(() => {})
    // Légende changée sans changement d'écran : on force une image.
    this.veille = setInterval(() => {
      const der = this.images[this.images.length - 1]
      if (der && der.legende !== this.legende && !this.attente && !this.suspendu) this.dupliquer()
    }, 200)
  }
  // Suspend la capture (chargement d'une page) : l'écran de chargement n'apparaît pas dans le GIF.
  // Le temps passé en suspension est retiré de la chronologie du GIF.
  suspendre() { if (this.suspendu) return; this.suspendu = true; this.debutSuspension = Date.now(); clearTimeout(this.minuteur); this.attente = null }
  reprendre() { if (!this.suspendu) return; this.t0 += Date.now() - this.debutSuspension; this.suspendu = false }
  dupliquer() {
    const der = this.images[this.images.length - 1]
    const f = String(this.images.length).padStart(5, '0') + '.jpg'
    fs.copyFileSync(path.join(this.dossier, der.f), path.join(this.dossier, f))
    this.images.push({ f, t: Date.now() - this.t0, legende: this.legende })
  }
  async arreter(attenteFinale = 300) {
    await sleep(attenteFinale)
    clearInterval(this.veille); clearTimeout(this.minuteur)
    if (this.attente) { this.ecrire(this.attente); this.attente = null }
    this.actif = false
    await this.cdp?.send('Page.stopScreencast').catch(() => {})
    const fin = Date.now() - (this.t0 || Date.now())
    fs.writeFileSync(path.join(this.dossier, 'manifest.json'), JSON.stringify({ fin, images: this.images }, null, 1))
    return { images: this.images.length, duree: fin }
  }
}

// --- Gestes « humains » -------------------------------------------------------------------------
export async function curseur(page) {
  // Pointeur visible dans les captures (le mode sans fenêtre n'en dessine pas).
  await page.evaluate(() => {
    if (document.getElementById('gif-curseur')) return
    const c = document.createElement('div'); c.id = 'gif-curseur'
    c.style.cssText = 'position:fixed;left:-50px;top:-50px;width:22px;height:22px;z-index:2147483647;pointer-events:none;transition:left .45s ease,top .45s ease'
    c.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2l15 11-7 1-3 7z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>'
    document.documentElement.appendChild(c)
    window.__gifPos = (x, y) => { c.style.left = x + 'px'; c.style.top = y + 'px' }
    window.__gifClic = () => { c.animate([{ transform: 'scale(1)' }, { transform: 'scale(.75)' }, { transform: 'scale(1)' }], { duration: 260 }) }
  }).catch(() => {})
}

async function centre(page, loc) {
  await loc.scrollIntoViewIfNeeded().catch(() => {})
  const b = await loc.boundingBox()
  if (!b) throw new Error('Élément invisible')
  return { x: b.x + Math.min(b.width / 2, 60), y: b.y + b.height / 2 }
}

export async function survoler(page, loc, pause = 500) {
  await curseur(page)
  const p = await centre(page, loc)
  await page.evaluate(([x, y]) => window.__gifPos && window.__gifPos(x, y), [p.x, p.y])
  await page.mouse.move(p.x, p.y, { steps: 8 })
  await sleep(pause)
  return p
}

// rec : si fourni, la capture est suspendue pendant un éventuel écran de chargement après le clic.
export async function cliquer(page, loc, { pause = 700, avant = 450, rec = null } = {}) {
  if (typeof loc === 'string') loc = page.locator(loc).first()
  await survoler(page, loc, avant)
  await page.evaluate(() => window.__gifClic && window.__gifClic()).catch(() => {})
  await loc.click()
  await sleep(120)
  const charge = rec && await page.evaluate(() => [...document.querySelectorAll('.p-page > .p-empty .p-spinner')].some((e) => e.offsetParent)).catch(() => false)
  if (charge) rec.suspendre()
  await pretes(page)
  if (charge) { await sleep(300); rec.reprendre() }
  await sleep(pause)
}

// Attend la fin des indicateurs de chargement de page (pas ceux des traitements en cours).
export const pretes = (page, ms = 12000) => page.waitForFunction(
  () => ![...document.querySelectorAll('.p-page > .p-empty .p-spinner, .p-strip .p-spinner')].some((e) => e.offsetParent), null, { timeout: ms }).catch(() => {})

export async function taper(page, loc, texte, { delai = 70, pause = 500, vider = true } = {}) {
  if (typeof loc === 'string') loc = page.locator(loc).first()
  await cliquer(page, loc, { pause: 200 })
  if (vider) await loc.fill('')
  await loc.pressSequentially(texte, { delay: delai })
  await sleep(pause)
}

export async function defiler(page, dy, { pas = 12, ms = 40, selecteur = null } = {}) {
  for (let i = 0; i < pas; i++) {
    if (selecteur) await page.evaluate(([s, d]) => { const e = document.querySelector(s); if (e) e.scrollBy(0, d) }, [selecteur, dy / pas])
    else await page.mouse.wheel(0, dy / pas)
    await sleep(ms)
  }
}

// Navigation pendant un enregistrement : capture suspendue jusqu'à la page prête.
export async function naviguer(page, rec, url, attente = 500) {
  rec.suspendre()
  await aller(page, url, attente)
  rec.reprendre()
  await page.evaluate(() => { const c = document.getElementById('gif-curseur'); if (c) c.style.opacity = '0.99' }).catch(() => {})
}

export async function aller(page, url, attente = 900) {
  await page.goto(BASE + url, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('load').catch(() => {})
  // la page charge ses données après « load » : on attend la fin des indicateurs de chargement
  await pretes(page, 15000)
  await curseur(page)
  await sleep(attente)
}

// Bouton / lien / onglet par son texte visible.
// Une chaîne est cherchée en début de texte (« Lancer le scan » ne prend pas « Relancer le scan »).
export const parTexte = (page, texte, sel = 'button, a, [role=tab], .p-tab, .p-step') => {
  const motif = typeof texte === 'string' ? new RegExp('^\\s*' + texte.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : texte
  return page.locator(sel).filter({ hasText: motif }).filter({ visible: true }).first()
}

// --- Mise en évidence --------------------------------------------------------------------------
// Halo + étiquette dans le style de la visite guidée (sans la barre de visite), sur un sélecteur ou un locator.
export async function marquer(page, cible, titre, texte = '') {
  const loc = typeof cible === 'string' ? page.locator(cible).filter({ visible: true }).first() : cible
  await loc.scrollIntoViewIfNeeded().catch(() => {})
  const b = await loc.boundingBox()
  if (!b) return false
  await page.evaluate(([b, titre, texte]) => {
    document.getElementById('gif-halo')?.remove(); document.getElementById('gif-etiq')?.remove()
    const m = 6
    const h = document.createElement('div'); h.id = 'gif-halo'
    h.style.cssText = `position:fixed;left:${b.x - m}px;top:${b.y - m}px;width:${b.width + 2 * m}px;height:${b.height + 2 * m}px;` +
      'border:3px solid #0f7a5a;border-radius:12px;box-shadow:0 0 0 9999px rgba(15,23,32,.38),0 0 18px 4px rgba(15,122,90,.55);' +
      'z-index:2147483600;pointer-events:none;transition:all .35s ease'
    document.documentElement.appendChild(h)
    if (titre) {
      const e = document.createElement('div'); e.id = 'gif-etiq'
      e.style.cssText = 'position:fixed;z-index:2147483601;pointer-events:none;max-width:380px;background:#fff;border-radius:10px;' +
        'box-shadow:0 8px 28px rgba(0,0,0,.25);padding:12px 16px;font:14px/1.4 "Segoe UI",system-ui,sans-serif;color:#1d2733;border-left:5px solid #0f7a5a'
      e.innerHTML = `<div style="font-weight:700;font-size:15px;margin-bottom:3px">${titre}</div>${texte ? `<div>${texte}</div>` : ''}`
      document.documentElement.appendChild(e)
      const W = innerWidth, H = innerHeight, r = e.getBoundingClientRect()
      let x = b.x, y = b.y + b.height + 16
      if (y + r.height > H - 10) y = b.y - r.height - 16
      if (y < 10) { y = Math.min(H - r.height - 10, b.y + 16); x = b.x + b.width + 16 }
      x = Math.max(10, Math.min(x, W - r.width - 10))
      e.style.left = x + 'px'; e.style.top = y + 'px'
    }
  }, [b, titre, texte])
  return true
}
export const effacer = (page) => page.evaluate(() => { document.getElementById('gif-halo')?.remove(); document.getElementById('gif-etiq')?.remove() }).catch(() => {})

// Étape de la visite guidée (halo, étiquette et barre de la visite), lancée sur la page courante puis refermée.
export async function visite(page, id, ms = 3500) {
  await page.evaluate(async (id) => {
    if (!window.Prisme?.tour) await new Promise((ok, ko) => { const s = document.createElement('script'); s.src = '/assets/prisme/prisme-tour.js'; s.onload = ok; s.onerror = ko; document.head.appendChild(s) })
    await window.Prisme.tour.start(id)
  }, id)
  await page.waitForFunction(() => document.documentElement.dataset.tourFound !== undefined, null, { timeout: 7000 }).catch(() => {})
  await sleep(ms)
  await page.evaluate(() => window.Prisme?.tour?.close()).catch(() => {})
  await sleep(250)
}

// --- Données ------------------------------------------------------------------------------------
export async function chargerDemo(context) {
  const r = await context.request.post(`${BASE}/api/demo/load`, { headers: { Origin: BASE }, data: {} , timeout: 60000 })
  const j = await r.json(); if (!j.ok) throw new Error('Chargement de la démo : ' + JSON.stringify(j))
  return j
}

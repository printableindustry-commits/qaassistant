// Outils communs aux scripts de supports : connexion, chargement de la démo, navigateur Playwright.
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const BASE = process.env.SUPPORTS_BASE || 'http://127.0.0.1:4002'
const NM = process.env.SUPPORTS_NODE_MODULES || path.join(RACINE, 'workspace', 'node_modules')

export function playwright () {
  const req = createRequire(path.join(NM, 'x.js'))
  return req('playwright-core')
}

// Connexion demo/demo : renvoie la valeur du cookie qa_sid.
export async function connexion (user = 'demo', pass = 'demo') {
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json', origin: BASE },
    body: JSON.stringify({ username: user, password: pass })
  })
  const c = r.headers.get('set-cookie') || ''
  const m = c.match(/qa_sid=([^;]+)/)
  if (!m) throw new Error('connexion refusée : ' + r.status + ' ' + await r.text())
  return m[1]
}

export async function chargerDemo (sid) {
  const r = await fetch(BASE + '/api/demo/load', { method: 'POST', headers: { cookie: 'qa_sid=' + sid, origin: BASE, 'content-type': 'application/json' }, body: '{}' })
  return r.json()
}

export async function navigateur ({ sid, largeur = 1440, hauteur = 900 } = {}) {
  const { chromium } = playwright()
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const context = await browser.newContext({ viewport: { width: largeur, height: hauteur }, deviceScaleFactor: 1, locale: 'fr-FR' })
  if (sid) {
    const u = new URL(BASE)
    await context.addCookies([{ name: 'qa_sid', value: sid, domain: u.hostname, path: '/', httpOnly: true, sameSite: 'Lax' }])
  }
  const page = await context.newPage()
  return { browser, context, page }
}

// Rend les schémas HTML de tools/supports/schemas en PNG 1920×1080 dans supports/schemas.
// Usage : node tools/supports/rendre-schemas.mjs [nom-sans-extension …]
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { RACINE, playwright } from './commun.mjs'

const SRC = path.join(RACINE, 'tools', 'supports', 'schemas')
const OUT = path.join(RACINE, 'supports', 'schemas')
fs.mkdirSync(OUT, { recursive: true })
const noms = process.argv.slice(2).length ? process.argv.slice(2) : fs.readdirSync(SRC).filter(f => f.endsWith('.html')).map(f => f.slice(0, -5))
const { chromium } = playwright()
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
page.on('console', m => { if (m.type() === 'warning' || m.type() === 'error') console.warn('  ' + m.text()) })
for (const n of noms) {
  await page.goto(pathToFileURL(path.join(SRC, n + '.html')).href)
  await page.waitForTimeout(400)
  // contrôle : rien ne doit dépasser du cadre 1920×1080
  const deborde = await page.evaluate(() => [...document.querySelectorAll('.bloc, .carte, .legende')].filter(e => { const r = e.getBoundingClientRect(); return r.right > 1921 || r.bottom > 1081 }).length)
  await page.screenshot({ path: path.join(OUT, n + '.png') })
  console.log(n + '.png' + (deborde ? `  ! ${deborde} élément(s) hors cadre` : ''))
}
await browser.close()

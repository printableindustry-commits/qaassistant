// Rend les icônes du design system Prisme (server/assets/prisme/prisme-ui.js) en PNG transparents
// pour les slides : pictos/<nom>.png (vert Prisme) et pictos/<nom>-gris.png (gris des encadrés « Données »).
// Usage : node tools/supports/slides/pictos.mjs
import fs from 'node:fs'
import path from 'node:path'
import { RACINE, playwright } from '../commun.mjs'

const SORTIE = path.join(RACINE, 'tools', 'supports', 'slides', 'pictos')
const COULEURS = { '': '#00694D', '-gris': '#4A5D56' }
const TAILLE = 96

const source = fs.readFileSync(path.join(RACINE, 'server', 'assets', 'prisme', 'prisme-ui.js'), 'utf8')
const bloc = source.slice(source.indexOf('const ICONS = {'), source.indexOf('\n  }', source.indexOf('const ICONS = {')))
const icones = {}
for (const m of bloc.matchAll(/^\s+([a-zA-Z0-9]+): '(.*)',?$/gm)) icones[m[1]] = m[2]

fs.mkdirSync(SORTIE, { recursive: true })
const { chromium } = playwright()
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 200, height: 200 }, deviceScaleFactor: 1 })
  for (const [nom, traces] of Object.entries(icones)) {
    for (const [suffixe, couleur] of Object.entries(COULEURS)) {
      const svg = `<svg id="i" xmlns="http://www.w3.org/2000/svg" width="${TAILLE}" height="${TAILLE}" viewBox="0 0 24 24" fill="none" stroke="${couleur}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${traces}</svg>`
      await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`)
      await page.locator('#i').screenshot({ path: path.join(SORTIE, nom + suffixe + '.png'), omitBackground: true })
    }
  }
  console.log(Object.keys(icones).length + ' icônes rendues dans ' + SORTIE)
} finally {
  await browser.close()
}

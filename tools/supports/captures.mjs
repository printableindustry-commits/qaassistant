// Captures d'écran brutes + boîtes des repères (positions réelles des éléments).
// Usage : node tools/supports/captures.mjs [--demo] [--seulement 01,05] [--decouvrir]
//   --demo        : charge la démo avant les captures (POST /api/demo/load)
//   --decouvrir   : écrit aussi la liste des éléments visibles de chaque écran (aide au choix des sélecteurs)
// Sortie : supports/captures/NN-ecran.png et <SUPPORTS_TMP>/boites.json (lu par annoter.py).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { RACINE, BASE, connexion, chargerDemo, navigateur } from './commun.mjs'
import { ECRANS } from './ecrans.mjs'

const args = process.argv.slice(2)
const seulement = (args.includes('--seulement') ? args[args.indexOf('--seulement') + 1] : '').split(',').filter(Boolean)
const decouvrir = args.includes('--decouvrir')
const TMP = process.env.SUPPORTS_TMP || path.join(os.tmpdir(), 'wizard-qa-supports')
const SORTIE = path.join(RACINE, 'supports', 'captures')
fs.mkdirSync(SORTIE, { recursive: true }); fs.mkdirSync(TMP, { recursive: true })

const sid = await connexion()
if (args.includes('--demo')) console.log('démo :', JSON.stringify((await chargerDemo(sid)).counts))
const { browser, context } = await navigateur({ sid })

// Localisateur : "css" ou { sel, texte, rang }
function loc (page, c) {
  if (typeof c === 'string') c = { sel: c }
  let l = page.locator(c.sel)
  if (c.texte) l = l.filter({ hasText: c.texte })
  return l.nth(c.rang || 0)
}

async function jouer (page, a) {
  if (a.clic) { await loc(page, a.clic).click({ timeout: 15000 }); await page.waitForTimeout(a.attente ?? 900) }
  if (a.defiler) { // fait défiler la page pour que l'élément soit à `haut` px du haut de l'écran
    const el = await loc(page, a.defiler).elementHandle({ timeout: 8000 })
    await page.evaluate(([e, haut]) => { const r = e.getBoundingClientRect(); window.scrollBy(0, r.top - haut) }, [el, a.haut ?? 110])
    await page.waitForTimeout(500)
  }
  if (a.touche) { await page.keyboard.press(a.touche); await page.waitForTimeout(a.attente ?? 500) }
  if (a.taper) { await page.keyboard.type(a.taper, { delay: 40 }); await page.waitForTimeout(a.attente ?? 700) }
  if (a.survol) { await loc(page, a.survol).hover(); await page.waitForTimeout(400) }
  if (a.attendre) await page.waitForTimeout(a.attendre)
  if (a.script) await page.evaluate(a.script)
}

const boites = fs.existsSync(path.join(TMP, 'boites.json')) ? JSON.parse(fs.readFileSync(path.join(TMP, 'boites.json'), 'utf8')) : {}
for (const e of ECRANS) {
  if (seulement.length && !seulement.includes(e.n)) continue
  const page = await context.newPage()
  await page.goto(BASE + e.url, { waitUntil: 'load' })
  await page.waitForTimeout(e.attente ?? 2200)
  for (const a of e.actions || []) {
    try { await jouer(page, a) } catch (err) { console.warn(`  ! ${e.n} action ${JSON.stringify(a)} : ${err.message.split('\n')[0]}`) }
  }
  await page.mouse.move(1439, 899)
  await page.waitForTimeout(300)
  const fichier = `${e.n}-${e.id}`
  await page.screenshot({ path: path.join(SORTIE, fichier + '.png') })
  const reperes = []
  for (const [i, r] of e.reperes.entries()) {
    let b = null
    try { b = await loc(page, r.cible).boundingBox({ timeout: 3000 }) } catch {}
    if (!b) { console.warn(`  ! ${fichier} repère ${i + 1} introuvable : ${JSON.stringify(r.cible)}`); continue }
    const x = Math.max(0, Math.round(b.x) - (r.marge ?? 4)); const y = Math.max(0, Math.round(b.y) - (r.marge ?? 4))
    const x2 = Math.min(1440, Math.round(b.x + b.width) + (r.marge ?? 4)); const y2 = Math.min(900, Math.round(b.y + b.height) + (r.marge ?? 4))
    if (y2 - y < 8) { console.warn(`  ! ${fichier} repère ${i + 1} hors écran`); continue }
    reperes.push({ n: reperes.length + 1, x, y, w: x2 - x, h: y2 - y, titre: r.titre, texte: r.texte })
  }
  boites[fichier] = { fichier, titre: e.titre, sousTitre: e.sousTitre, page: e.url, reperes }
  console.log(`${fichier} : ${reperes.length}/${e.reperes.length} repères`)
  if (decouvrir) {
    const els = await page.evaluate(() => [...document.querySelectorAll('body *')].map(el => {
      const r = el.getBoundingClientRect(); const cls = [...el.classList].join('.')
      if (!cls || r.width < 60 || r.height < 18 || r.bottom < 0 || r.top > 900) return null
      return `${el.tagName.toLowerCase()}.${cls} [${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)}x${Math.round(r.height)}] ${(el.innerText || '').replace(/\s+/g, ' ').slice(0, 40)}`
    }).filter(Boolean))
    fs.writeFileSync(path.join(TMP, fichier + '.txt'), els.join('\n'))
  }
  fs.writeFileSync(path.join(TMP, 'boites.json'), JSON.stringify(boites, null, 2))
  await page.close()
}
fs.writeFileSync(path.join(TMP, 'boites.json'), JSON.stringify(boites, null, 2))
await browser.close()

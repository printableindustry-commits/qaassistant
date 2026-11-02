#!/usr/bin/env node
/**
 * Reconstruit css_theme_app.css (sélecteurs embed uniquement).
 * Usage : node scripts/split-theme-css.mjs [--from-hub]
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const assetsDir = path.join(__dirname, '..', 'server', 'assets')
const homeHubPath = path.join(assetsDir, 'home-hub.css')
const themeAppPath = path.join(assetsDir, 'css_theme_app.css')
const vscodeAppLegacyPath = path.join(assetsDir, 'vscode-app.css')

const THEME_SELECTOR = /html\.vscode-app|html\.embed-mode/

const HEADER = `/* =============================================================================
 * css_theme_app.css — THÈME UNIQUE EXTENSION VS CODE (webview embed)
 * =============================================================================
 * Source de vérité pour tout le rendu en mode embed (html.vscode-app).
 *
 * RÈGLES :
 * - Ne PAS ajouter de règles html.vscode-app dans home-hub.css ni theme.css
 * - Modifier UNIQUEMENT ce fichier pour titres, boutons, tuiles, footer, etc.
 * - Ordre de chargement : theme.css → home-hub.css → css_theme_app.css (priorité max)
 * ============================================================================= */

`

function splitCssRules(css) {
  const rules = []
  let i = 0
  const len = css.length

  while (i < len) {
    while (i < len) {
      if (css.slice(i, i + 2) === '/*') {
        const end = css.indexOf('*/', i)
        i = end === -1 ? len : end + 2
        continue
      }
      if (/\s/.test(css[i])) {
        i++
        continue
      }
      break
    }
    if (i >= len) break

    const start = i
    let depth = 0
    let inString = false
    let stringChar = ''

    while (i < len) {
      const ch = css[i]
      if (!inString && (ch === '"' || ch === "'")) {
        inString = true
        stringChar = ch
      } else if (inString && ch === stringChar && css[i - 1] !== '\\') {
        inString = false
      } else if (!inString) {
        if (ch === '{') depth++
        else if (ch === '}') {
          depth--
          if (depth === 0) {
            i++
            rules.push(css.slice(start, i))
            break
          }
        }
      }
      i++
    }
  }
  return rules
}

function selectorPart(rule) {
  const idx = rule.indexOf('{')
  return idx === -1 ? rule.trim() : rule.slice(0, idx).trim()
}

function isThemeRule(rule) {
  const sel = selectorPart(rule)
  if (!sel) return false

  if (sel.startsWith('@keyframes') || sel.startsWith('@import') || sel.startsWith('@charset')) {
    return false
  }

  if (sel.startsWith('@media') || sel.startsWith('@supports')) {
    if (!THEME_SELECTOR.test(rule)) return false
    const innerStart = rule.indexOf('{') + 1
    const innerEnd = rule.lastIndexOf('}')
    const inner = rule.slice(innerStart, innerEnd)
    const innerRules = splitCssRules(inner)
    if (!innerRules.length) return THEME_SELECTOR.test(rule)
    return innerRules.every(isThemeRule)
  }

  return THEME_SELECTOR.test(sel)
}

function extractThemeRules(css) {
  const theme = []
  const layout = []

  for (const rule of splitCssRules(css)) {
    const trimmed = rule.trim()
    if (!trimmed) continue
    if (isThemeRule(trimmed)) theme.push(trimmed)
    else layout.push(trimmed)
  }

  return {
    theme: theme.join('\n\n') + '\n',
    layout: layout.join('\n\n') + '\n',
  }
}

function readIfExists(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : ''
}

const fromHub = process.argv.includes('--from-hub')
const homeHub = readIfExists(homeHubPath)
const existingTheme = readIfExists(themeAppPath)

let themeRules = ''

if (fromHub && homeHub) {
  const { theme, layout } = extractThemeRules(homeHub)
  themeRules = theme
  const guard = `/* =============================================================================
 * home-hub.css — mise en page et composants (navigateur + extension)
 * NE PAS ajouter de règles html.vscode-app ici → css_theme_app.css
 * ============================================================================= */

`
  const body = layout.trimStart().replace(/^\/\* ={5,}[\s\S]*?\*\/\s*/m, '')
  fs.writeFileSync(homeHubPath, guard + body, 'utf8')
} else {
  const sources = [existingTheme, homeHub].filter(Boolean).join('\n')
  themeRules = extractThemeRules(sources).theme
}

fs.writeFileSync(themeAppPath, HEADER + themeRules.trim() + '\n', 'utf8')
fs.writeFileSync(
  vscodeAppLegacyPath,
  '/* OBSOLÈTE — le thème extension est dans css_theme_app.css (ne pas charger ce fichier). */\n',
  'utf8'
)

const count = (themeRules.match(/html\.vscode-app|html\.embed-mode/g) || []).length
console.log(`css_theme_app.css : ${count} sélecteurs embed`)
console.log(`home-hub.css : ${fs.readFileSync(homeHubPath, 'utf8').split('\n').length} lignes`)

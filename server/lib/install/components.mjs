/**
 * Composants de l'installation : chacun expose detect(ctx), install(ctx), verify(ctx) et describe(ctx).
 *
 * detect  → { state: 'ok'|'missing'|'outdated'|'error'|'skipped', version, expected, message }
 *           lecture seule, rapide, sans effet de bord (hors ajout d'un outil portable au PATH du processus).
 * install → réalise l'installation via ctx (ctx.exec, ctx.write, ctx.download… simulés en mode dryRun).
 * verify  → par défaut, nouvelle détection qui doit renvoyer « ok ».
 * describe→ commandes prévues (aperçu avant lancement).
 *
 * Le contexte (voir orchestrator.mjs) fournit : plan, stacks, dryRun, env, log(), exec(), write(), mkdir(),
 * fetchArchive(), tools (cache partagé du run : Node et npm résolus).
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import { REPO_ROOT } from '../paths.mjs'
import { readNpmrcValues, mergeNpmrcValues, getNpmrcPath } from '../npmrc.mjs'
import { resolveVersion, readJson, EDITOR_CLI_RE } from './plan.mjs'
import {
  IS_WIN, findOnPath, probe, parseVersion, versionString, compareVersions, satisfies,
  toolsRoot, prependProcessPath, addToUserPath, maskSecrets,
} from './system.mjs'

const ok = (version, message, extra = {}) => ({ state: 'ok', version: version || '', message, ...extra })
const missing = (message, extra = {}) => ({ state: 'missing', version: '', message, ...extra })
const outdated = (version, message, extra = {}) => ({ state: 'outdated', version: version || '', message, ...extra })
const skipped = (message, extra = {}) => ({ state: 'skipped', version: '', message, ...extra })

const ARCH = process.arch === 'arm64' ? 'arm64' : 'x64'

/** Contenu texte normalisé (sans BOM, fins de ligne LF) pour comparer un fichier généré. */
function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  } catch {
    return null
  }
}

function exists(file) {
  try {
    fs.accessSync(file)
    return true
  } catch {
    return false
  }
}

/* ================================================================== Node et npm */

function portableNodeDir(plan) {
  return path.join(toolsRoot(), 'node', plan.versions.node)
}

function nodeExeIn(dir) {
  return IS_WIN ? path.join(dir, 'node.exe') : path.join(dir, 'bin', 'node')
}

/** Résout le Node utilisé pour la suite (PATH compatible d'abord, sinon Node portable). Mis en cache dans ctx.tools. */
export function resolveNode(ctx) {
  if (!ctx.tools.nodePromise) ctx.tools.nodePromise = findNode(ctx)
  return ctx.tools.nodePromise
}

async function findNode(ctx) {
  const min = Number(ctx.plan.versions.nodeMinMajor) || 20
  const portable = nodeExeIn(portableNodeDir(ctx.plan))
  const candidates = [
    { exe: findOnPath('node'), source: 'PATH' },
    { exe: exists(portable) ? portable : null, source: 'portable' },
  ].filter((c) => c.exe)
  let best = null
  for (const c of candidates) {
    const r = await probe(c.exe, ['-v'])
    const version = versionString(r.output)
    if (!version) continue
    const found = { ...c, version, compatible: parseVersion(version)[0] >= min }
    if (found.compatible) {
      best = found
      break
    }
    best = best || found
  }
  if (best?.source === 'portable') prependProcessPath(path.dirname(best.exe))
  return best
}

function npmCliFor(nodeExe) {
  if (!nodeExe) return null
  const dir = path.dirname(nodeExe)
  const candidates = [
    path.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(dir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ]
  return candidates.find(exists) || null
}

/** Lance npm sans shell : <node> <npm-cli.js> args (fonctionne aussi pour les chemins avec espaces). */
async function npmInvocation(ctx) {
  const node = await resolveNode(ctx)
  const exe = node?.exe || process.execPath
  const cli = npmCliFor(exe) || npmCliFor(process.execPath)
  if (!cli) return null
  return { exe, cli }
}

async function runNpm(ctx, args, opts = {}) {
  const inv = await npmInvocation(ctx)
  if (!inv) throw new Error('npm est introuvable : réinstallez Node.js (composant « Node.js », option Réinstaller).')
  return ctx.exec(inv.exe, [inv.cli, ...args], { cwd: REPO_ROOT, label: `npm ${args.join(' ')}`, ...opts })
}

function nodeArchive(plan) {
  const v = plan.versions.node
  const suffix = IS_WIN ? `win-${ARCH}` : process.platform === 'darwin' ? `darwin-${ARCH}` : `linux-${ARCH}`
  const ext = IS_WIN ? 'zip' : process.platform === 'darwin' ? 'tar.gz' : 'tar.xz'
  const name = `node-v${v}-${suffix}`
  const base = `${String(plan.mirrors.node).replace(/\/+$/, '')}/v${v}`
  return { name, fileName: `${name}.${ext}`, url: `${base}/${name}.${ext}`, sumsUrl: `${base}/SHASUMS256.txt` }
}

async function installPortableNode(ctx) {
  const a = nodeArchive(ctx.plan)
  const dest = portableNodeDir(ctx.plan)
  await ctx.fetchArchive({
    url: a.url,
    sumsUrl: a.sumsUrl,
    fileName: a.fileName,
    destDir: dest,
    pickDir: (root) => path.join(root, a.name),
  })
  const binDir = IS_WIN ? dest : path.join(dest, 'bin')
  if (ctx.dryRun) ctx.log(`[simulation] ajout de ${binDir} au PATH utilisateur et au PATH du processus`)
  else if (ctx.plan.options.addToUserPath) await addToUserPath(binDir, { log: ctx.log })
  else prependProcessPath(binDir)
  ctx.tools.nodePromise = undefined
}

const node = {
  async detect(ctx) {
    const min = Number(ctx.plan.versions.nodeMinMajor) || 20
    const expected = `>= ${min} (portable : ${ctx.plan.versions.node})`
    const n = await resolveNode(ctx)
    if (!n) return missing(`Aucun Node.js trouvé dans le PATH (le serveur tourne sur Node ${process.versions.node}, invisible des terminaux).`, { expected })
    if (!n.compatible) return outdated(n.version, `Node ${n.version} est trop ancien (majeure ${min} minimum).`, { expected })
    const where = n.source === 'portable' ? `portable, ${path.dirname(n.exe)}` : n.exe
    return ok(n.version, `Node ${n.version} (${where})`, { expected })
  },
  install: installPortableNode,
  describe(ctx) {
    const a = nodeArchive(ctx.plan)
    return [`Télécharger ${a.url}`, `Vérifier SHASUMS256 (${a.sumsUrl})`, `Extraire vers ${portableNodeDir(ctx.plan)}`, 'Ajouter au PATH utilisateur']
  },
}

const npm = {
  async detect(ctx) {
    const inv = await npmInvocation(ctx)
    if (!inv) return missing('npm est introuvable à côté de Node.')
    const r = await probe(inv.exe, [inv.cli, '-v'], { env: ctx.env })
    const version = versionString(r.output)
    return version ? ok(version, `npm ${version}`) : missing(`npm ne répond pas : ${r.output.slice(0, 200)}`)
  },
  async install(ctx) {
    ctx.log('npm est livré avec Node : installation du Node portable, qui inclut npm.')
    await installPortableNode(ctx)
  },
  describe: () => ['Réinstaller le Node portable (npm inclus)'],
}

/* ================================================================== .npmrc */

function desiredNpmrc(plan) {
  const p = plan.proxy || {}
  const want = {}
  if (plan.mirrors.npmRegistry) want.registry = `${plan.mirrors.npmRegistry.replace(/\/+$/, '')}/`
  if (p.http) want.proxy = p.http
  if (p.https || p.http) want['https-proxy'] = p.https || p.http
  if ((p.http || p.https) && p.noProxy) want.noproxy = p.noProxy
  if (p.strictSsl === false) want['strict-ssl'] = 'false'
  if (p.caFile) want.cafile = p.caFile
  return want
}

function npmrcDiff(plan) {
  const file = getNpmrcPath()
  const current = exists(file) ? readNpmrcValues(fs.readFileSync(file, 'utf8')) : {}
  const want = desiredNpmrc(plan)
  const diff = Object.keys(want).filter((k) => String(current[k] || '').replace(/\/+$/, '') !== String(want[k]).replace(/\/+$/, ''))
  return { file, current, want, diff }
}

const npmrc = {
  async detect(ctx) {
    const { current, want, diff } = npmrcDiff(ctx.plan)
    const registry = current.registry || 'registre public npm'
    if (!Object.keys(want).length) return ok('', `Aucune clé imposée par le plan (${registry}).`)
    if (diff.length) return outdated('', `Clés à mettre à jour : ${diff.join(', ')}.`)
    return ok('', `Configuration conforme (${maskSecrets(registry)}).`)
  },
  async install(ctx) {
    const { want, diff } = npmrcDiff(ctx.plan)
    const updates = Object.fromEntries(diff.map((k) => [k, want[k]]))
    if (!diff.length) {
      ctx.log('.npmrc déjà conforme au plan : aucune clé à écrire.')
      return
    }
    if (ctx.dryRun) {
      for (const [k, v] of Object.entries(updates)) ctx.log(`[simulation] .npmrc : ${k}=${maskSecrets(v)}`)
      return
    }
    const r = mergeNpmrcValues(updates)
    if (r.backup) ctx.log(`Sauvegarde : ${r.backup}`)
    ctx.log(r.changed.length ? `Clés écrites dans ${r.path} : ${r.changed.join(', ')}` : '.npmrc déjà conforme.')
  },
  async verify(ctx) {
    const d = await npmrc.detect(ctx)
    if (d.state !== 'ok') return d
    const r = await runNpm(ctx, ['ping'], { timeoutMs: 45000, quiet: true })
    if (r.code !== 0) {
      return { state: 'error', version: '', message: 'Le registre npm ne répond pas (npm ping) : vérifiez le proxy, le certificat ou le jeton d\'accès.' }
    }
    return ok('', `${d.message} Registre joignable.`)
  },
  describe(ctx) {
    const { diff, want } = npmrcDiff(ctx.plan)
    return [...diff.map((k) => `.npmrc : ${k}=${maskSecrets(want[k])}`), 'npm ping']
  },
}

/* ================================================================== Git */

const GIT_DIRS = IS_WIN ? [path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'cmd')] : []

function findGit() {
  const onPath = findOnPath('git')
  if (onPath) return onPath
  for (const dir of GIT_DIRS) {
    const exe = path.join(dir, 'git.exe')
    if (exists(exe)) {
      prependProcessPath(dir)
      return exe
    }
  }
  return null
}

function wingetArgs(id) {
  return ['install', '-e', '--id', id, '--silent', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity']
}

async function wingetInstall(ctx, id, label) {
  if (!IS_WIN) throw new Error(`Installez ${label} avec le gestionnaire de paquets du système.`)
  const winget = findOnPath('winget')
  if (!winget || !ctx.plan.options.useWinget) {
    throw new Error(`winget est ${winget ? 'désactivé dans les paramètres' : 'indisponible'} : installez ${label} manuellement puis relancez la vérification.`)
  }
  const r = await ctx.exec(winget, wingetArgs(id), { timeoutMs: 30 * 60000 })
  if (r.code !== 0 && !/already installed|déjà installé/i.test(r.output || '')) throw new Error(`winget a échoué (code ${r.code}).`)
}

const git = {
  async detect() {
    const exe = findGit()
    if (!exe) return missing('Git est introuvable.')
    const r = await probe(exe, ['--version'])
    const version = versionString(r.output)
    return version ? ok(version, `Git ${version}`) : missing('Git ne répond pas.')
  },
  async install(ctx) {
    await wingetInstall(ctx, 'Git.Git', 'Git (https://git-scm.com/download/win)')
    for (const dir of GIT_DIRS) if (exists(dir)) prependProcessPath(dir)
  },
  describe: () => [`winget ${wingetArgs('Git.Git').join(' ')}`],
}

/* ================================================================== projet de test */

const GENERATED_MARK = '// Généré par Wizard QA'

function wants(stacks) {
  return {
    e2e: stacks.includes('playwright') || stacks.includes('gherkin'),
    bdd: stacks.includes('gherkin'),
    perf: stacks.includes('k6'),
  }
}

function playwrightConfig(stacks) {
  const w = wants(stacks)
  const lines = [
    `${GENERATED_MARK} — régénéré tant que cette ligne est présente ; supprimez-la pour le personnaliser.`,
    "import 'dotenv/config'",
    "import { defineConfig, devices } from '@playwright/test'",
  ]
  if (w.bdd) {
    lines.push("import { defineBddConfig } from 'playwright-bdd'", '',
      "const bddTestDir = defineBddConfig({ features: 'tests/features/**/*.feature', steps: 'tests/steps/**/*.ts' })")
  }
  lines.push('', 'export default defineConfig({',
    "  reporter: [['list'], ['html', { open: 'never' }]],",
    '  retries: process.env.CI ? 2 : 0,',
    '  use: {',
    '    baseURL: process.env.BASE_URL,',
    "    trace: 'on-first-retry',",
    "    screenshot: 'only-on-failure',",
    '  },',
    '  projects: [',
    "    { name: 'e2e', testDir: './tests/e2e', use: { ...devices['Desktop Chrome'] } },")
  if (w.bdd) lines.push("    { name: 'bdd', testDir: bddTestDir, use: { ...devices['Desktop Chrome'] } },")
  lines.push('  ],', '})', '')
  return lines.join('\n')
}

const SAMPLE_SPEC = `import { test, expect } from '@playwright/test'

// Exemple : remplacez BASE_URL dans .env par l'adresse de l'application à tester.
test('la page d\\'accueil répond', async ({ page }) => {
  await page.goto(process.env.BASE_URL || 'https://playwright.dev')
  await expect(page).toHaveTitle(/.+/)
})
`

const BDD_FIXTURES = `import { test as base, createBdd } from 'playwright-bdd'

// Point d'entrée des étapes Gherkin : importez Given / When / Then depuis ce fichier.
export const test = base
export const { Given, When, Then } = createBdd(test)
`

const GITIGNORE = ['node_modules/', 'test-results/', 'playwright-report/', 'blob-report/', '.features-gen/', 'reports/', '.env', '.wizard-qa/']

async function k6SmokeScript() {
  try {
    const m = await import('../k6-scaffold.mjs')
    return m.buildK6SmokeScript(m.resolveK6Paths({}))
  } catch {
    return "import http from 'k6/http'\nimport { check } from 'k6'\n\nexport default function () {\n  const res = http.get(__ENV.BASE_URL || 'https://test.k6.io')\n  check(res, { 'statut 200': (r) => r.status === 200 })\n}\n"
  }
}

function hasFile(dir, re) {
  try {
    return fs.readdirSync(dir).some((f) => re.test(f))
  } catch {
    return false
  }
}

/** Liste des éléments manquants du projet de test pour les stacks choisies. */
function workspaceGaps(stacks) {
  const w = wants(stacks)
  const p = (rel) => path.join(REPO_ROOT, rel)
  const gaps = []
  const pkg = readJson(p('package.json'))
  // Un package.json présent mais illisible ne doit jamais être écrasé (dépendances perdues).
  const pkgBroken = !pkg && exists(p('package.json'))
  if (!pkg) gaps.push({ kind: 'package', label: pkgBroken ? 'package.json (JSON invalide)' : 'package.json' })
  const scripts = pkg?.scripts || {}
  const wantedScripts = scriptsFor(stacks)
  const missingScripts = Object.keys(wantedScripts).filter((k) => !scripts[k])
  if (pkg && missingScripts.length) gaps.push({ kind: 'scripts', label: `scripts ${missingScripts.join(', ')}`, keys: missingScripts })
  const gi = readText(p('.gitignore')) || ''
  const giMissing = GITIGNORE.filter((l) => !gi.split(/\r?\n/).some((x) => x.trim() === l))
  if (giMissing.length) gaps.push({ kind: 'gitignore', label: '.gitignore', lines: giMissing })
  const dirs = [w.e2e && 'tests/e2e', w.bdd && 'tests/features', w.bdd && 'tests/steps', w.perf && 'k6/scripts'].filter(Boolean)
  for (const d of dirs) if (!exists(p(d))) gaps.push({ kind: 'dir', label: `${d}/`, rel: d })
  if (w.e2e) {
    const cfg = p('playwright.config.ts')
    const content = readText(cfg)
    const generated = content?.startsWith(GENERATED_MARK)
    if (!content && !exists(p('playwright.config.js'))) gaps.push({ kind: 'config', label: 'playwright.config.ts' })
    else if (generated && content !== playwrightConfig(stacks)) gaps.push({ kind: 'config', label: 'playwright.config.ts (à régénérer)' })
    if (!hasFile(p('tests/e2e'), /\.(spec|test)\.[jt]s$/)) gaps.push({ kind: 'file', label: 'exemple de test e2e', rel: 'tests/e2e/exemple.spec.ts', content: SAMPLE_SPEC })
    if (!exists(p('.env.example'))) gaps.push({ kind: 'file', label: '.env.example', rel: '.env.example', content: 'BASE_URL=https://app-recette.example.com\n' })
  }
  if (w.bdd && !hasFile(p('tests/steps'), /\.[jt]s$/)) gaps.push({ kind: 'file', label: 'fixtures Gherkin', rel: 'tests/steps/fixtures.ts', content: BDD_FIXTURES })
  if (w.perf && !hasFile(p('k6/scripts'), /\.js$/)) gaps.push({ kind: 'k6smoke', label: 'k6/scripts/smoke.js', rel: 'k6/scripts/smoke.js' })
  return { gaps, pkg, pkgBroken }
}

function scriptsFor(stacks) {
  const w = wants(stacks)
  const s = {}
  if (w.e2e) s['test:e2e'] = 'playwright test --project=e2e'
  if (w.bdd) s['test:bdd'] = 'bddgen && playwright test --project=bdd'
  if (w.perf) s['test:perf'] = 'k6 run k6/scripts/smoke.js'
  return s
}

const workspace = {
  async detect(ctx) {
    const { gaps, pkg, pkgBroken } = workspaceGaps(ctx.stacks)
    if (pkgBroken) return { state: 'error', version: '', message: `package.json est illisible (JSON invalide) dans ${REPO_ROOT} : corrigez-le, il ne sera pas écrasé.` }
    if (!gaps.length) return ok('', `Projet prêt dans ${REPO_ROOT}`)
    const list = gaps.map((g) => g.label).join(', ')
    return pkg ? outdated('', `À compléter : ${list}.`) : missing(`Projet à initialiser dans ${REPO_ROOT} : ${list}.`)
  },
  async install(ctx) {
    const { gaps, pkgBroken } = workspaceGaps(ctx.stacks)
    if (pkgBroken) throw new Error(`package.json est illisible (JSON invalide) dans ${REPO_ROOT} : corrigez-le puis relancez (il n'est jamais écrasé).`)
    const p = (rel) => path.join(REPO_ROOT, rel)
    let pkg = readJson(p('package.json'))
    if (!pkg) pkg = { name: path.basename(REPO_ROOT).toLowerCase().replace(/[^a-z0-9-]+/g, '-') || 'projet-qa', version: '1.0.0', private: true, description: 'Projet de test QA (Wizard QA)', scripts: {} }
    // package.json n'est réécrit que s'il manque ou s'il lui manque des scripts (mise en forme préservée sinon).
    if (gaps.some((g) => g.kind === 'package' || g.kind === 'scripts')) {
      pkg.scripts = { ...scriptsFor(ctx.stacks), ...(pkg.scripts || {}) }
      await ctx.write(p('package.json'), `${JSON.stringify(pkg, null, 2)}\n`)
    }
    for (const g of gaps) {
      if (g.kind === 'gitignore') {
        const cur = exists(p('.gitignore')) ? fs.readFileSync(p('.gitignore'), 'utf8') : ''
        const eol = cur.includes('\r\n') ? '\r\n' : '\n'
        const sep = cur && !cur.endsWith('\n') ? eol : ''
        await ctx.write(p('.gitignore'), `${cur}${sep}${cur ? eol : ''}# Wizard QA${eol}${g.lines.join(eol)}${eol}`)
      } else if (g.kind === 'dir') await ctx.mkdir(p(g.rel))
      else if (g.kind === 'config') await ctx.write(p('playwright.config.ts'), playwrightConfig(ctx.stacks))
      else if (g.kind === 'file') await ctx.write(p(g.rel), g.content)
      else if (g.kind === 'k6smoke') await ctx.write(p(g.rel), await k6SmokeScript())
    }
  },
  describe(ctx) {
    return workspaceGaps(ctx.stacks).gaps.map((g) => `Créer / compléter ${g.label}`)
  },
}

/* ================================================================== paquets npm */

function installedVersion(name) {
  return readJson(path.join(REPO_ROOT, 'node_modules', ...name.split('/'), 'package.json'))?.version || ''
}

function packageSpecs(ctx, def) {
  return (def.packages || []).map((p) => ({ name: p.name, spec: resolveVersion(ctx.plan, p.version) || 'latest' }))
}

const isExact = (spec) => /^\d+\.\d+\.\d+/.test(spec)

function npmPackages(def) {
  return {
    async detect(ctx) {
      const specs = packageSpecs(ctx, def)
      const rows = specs.map((s) => ({ ...s, version: installedVersion(s.name) }))
      const expected = specs.map((s) => `${s.name}@${s.spec}`).join(', ')
      const bad = rows.filter((r) => !satisfies(r.version, r.spec))
      const version = rows[0]?.version || ''
      if (!bad.length) return ok(version, rows.map((r) => `${r.name} ${r.version}`).join(', '), { expected })
      const absent = bad.filter((r) => !r.version)
      const msg = bad.map((r) => (r.version ? `${r.name} ${r.version} (attendu ${r.spec})` : `${r.name} absent`)).join(', ')
      return absent.length === bad.length && !rows.some((r) => r.version) ? missing(msg, { expected }) : outdated(version, msg, { expected })
    },
    async install(ctx) {
      const specs = packageSpecs(ctx, def)
      const exact = specs.filter((s) => isExact(s.spec)).map((s) => `${s.name}@${s.spec}`)
      const ranges = specs.filter((s) => !isExact(s.spec)).map((s) => `${s.name}@${s.spec}`)
      const base = ['install', '--save-dev', '--no-fund', '--no-audit']
      for (const [list, extra] of [[exact, ['--save-exact']], [ranges, []]]) {
        if (!list.length) continue
        const r = await runNpm(ctx, [...base, ...extra, ...list], { timeoutMs: 20 * 60000 })
        if (r.code !== 0) throw new Error(`npm install a échoué (code ${r.code}) : vérifiez le registre et le proxy (.npmrc).`)
      }
    },
    describe(ctx) {
      return [`npm install --save-dev ${packageSpecs(ctx, def).map((s) => `${s.name}@${s.spec}`).join(' ')}`]
    },
  }
}

/* ================================================================== navigateurs Playwright */

function browsersCacheDir() {
  const env = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (env === '0') return path.join(REPO_ROOT, 'node_modules', 'playwright-core', '.local-browsers')
  if (env) return path.resolve(env)
  if (IS_WIN) return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'ms-playwright')
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright')
  return path.join(os.homedir(), '.cache', 'ms-playwright')
}

function expectedBrowserDirs(plan) {
  const manifest = readJson(path.join(REPO_ROOT, 'node_modules', 'playwright-core', 'browsers.json'))
  if (!manifest) return null
  const wanted = plan.options.browsers || ['chromium']
  const names = wanted.flatMap((b) => (b === 'chromium' ? ['chromium', 'chromium-headless-shell'] : [b]))
  return manifest.browsers
    .filter((b) => names.includes(b.name))
    .map((b) => ({ name: b.name, revision: b.revision, browserVersion: b.browserVersion || '', dir: `${b.name.replace(/-/g, '_')}-${b.revision}` }))
}

function playwrightCli() {
  const candidates = ['@playwright/test/cli.js', 'playwright/cli.js', 'playwright-core/cli.js']
  return candidates.map((c) => path.join(REPO_ROOT, 'node_modules', ...c.split('/'))).find(exists) || null
}

const playwrightBrowsers = {
  async detect(ctx) {
    const expected = expectedBrowserDirs(ctx.plan)
    const wanted = (ctx.plan.options.browsers || ['chromium']).join(', ')
    if (!expected) return missing('@playwright/test n\'est pas installé : la version des navigateurs attendue est inconnue.', { expected: wanted })
    const cache = browsersCacheDir()
    const absent = expected.filter((b) => {
      const dir = path.join(cache, b.dir)
      return !exists(path.join(dir, 'INSTALLATION_COMPLETE')) && !(exists(dir) && fs.readdirSync(dir).length > 1)
    })
    const chromium = expected.find((b) => b.name === 'chromium') || expected[0]
    const label = `${wanted} (${expected.map((b) => b.dir).join(', ')})`
    if (!absent.length) return ok(chromium?.browserVersion || '', `Navigateurs présents dans ${cache}`, { expected: label })
    const others = exists(cache) ? fs.readdirSync(cache).filter((d) => absent.some((a) => d.startsWith(`${a.dir.split('-')[0]}-`))) : []
    const msg = `Manquants : ${absent.map((b) => b.dir).join(', ')}`
    return others.length ? outdated('', `${msg} (révisions présentes : ${others.join(', ')}).`, { expected: label }) : missing(`${msg}.`, { expected: label })
  },
  async install(ctx) {
    const cli = playwrightCli()
    if (!cli && !ctx.dryRun) throw new Error('Playwright est introuvable dans node_modules : installez d\'abord les paquets Playwright.')
    const node = await resolveNode(ctx)
    const args = [cli || 'node_modules/@playwright/test/cli.js', 'install', ...(ctx.plan.options.browsers || ['chromium'])]
    if (!IS_WIN) args.push('--with-deps')
    if (ctx.plan.mirrors.playwrightDownloadHost) ctx.log(`Miroir des navigateurs : ${ctx.plan.mirrors.playwrightDownloadHost}`)
    const r = await ctx.exec(node?.exe || process.execPath, args, { cwd: REPO_ROOT, timeoutMs: 40 * 60000 })
    if (r.code !== 0) throw new Error('Le téléchargement des navigateurs a échoué : derrière un proxy, renseignez le proxy ou un miroir (PLAYWRIGHT_DOWNLOAD_HOST) dans les paramètres.')
  },
  describe(ctx) {
    return [`node node_modules/@playwright/test/cli.js install ${(ctx.plan.options.browsers || ['chromium']).join(' ')}${IS_WIN ? '' : ' --with-deps'}`]
  },
}

/* ================================================================== k6 */

function k6BinDir() {
  return path.join(toolsRoot(), 'bin')
}

function k6Archive(plan) {
  const v = plan.versions.k6
  const arch = ARCH === 'arm64' ? 'arm64' : 'amd64'
  const suffix = IS_WIN ? `windows-${arch}.zip` : process.platform === 'darwin' ? `macos-${arch}.zip` : `linux-${arch}.tar.gz`
  const fileName = `k6-v${v}-${suffix}`
  const base = `${String(plan.mirrors.k6).replace(/\/+$/, '')}/v${v}`
  return { fileName, url: `${base}/${fileName}`, sumsUrl: `${base}/k6-v${v}-checksums.txt` }
}

async function findK6() {
  const portable = path.join(k6BinDir(), IS_WIN ? 'k6.exe' : 'k6')
  const candidates = [findOnPath('k6'), exists(portable) ? portable : null]
  if (IS_WIN) candidates.push(path.join(process.env.ProgramFiles || 'C:\\Program Files', 'k6', 'k6.exe'))
  const found = []
  for (const exe of [...new Set(candidates.filter(Boolean))]) {
    if (!exists(exe)) continue
    const r = await probe(exe, ['version'])
    const version = versionString(r.output)
    if (version) found.push({ exe, version })
  }
  return found
}

const k6 = {
  async detect(ctx) {
    const want = ctx.plan.versions.k6
    const found = await findK6()
    if (!found.length) return missing('k6 est introuvable.', { expected: want })
    const best = found.sort((a, b) => compareVersions(b.version, a.version))[0]
    if (!findOnPath('k6') || path.dirname(findOnPath('k6')) !== path.dirname(best.exe)) prependProcessPath(path.dirname(best.exe))
    if (compareVersions(best.version, want) < 0) return outdated(best.version, `k6 ${best.version} est plus ancien que la version épinglée ${want}.`, { expected: want })
    return ok(best.version, `k6 ${best.version} (${best.exe})`, { expected: want })
  },
  async install(ctx) {
    const a = k6Archive(ctx.plan)
    const binDir = k6BinDir()
    const exeName = IS_WIN ? 'k6.exe' : 'k6'
    try {
      await ctx.fetchArchive({ url: a.url, sumsUrl: a.sumsUrl, fileName: a.fileName, destDir: binDir, pickFile: exeName })
      if (ctx.dryRun) ctx.log(`[simulation] ajout de ${binDir} au PATH utilisateur`)
      else if (ctx.plan.options.addToUserPath) await addToUserPath(binDir, { log: ctx.log })
      else prependProcessPath(binDir)
    } catch (e) {
      if (ctx.cancelled()) throw e
      if (!IS_WIN || !ctx.plan.options.useWinget || !findOnPath('winget')) throw e
      ctx.log(`Binaire portable impossible (${e.message}) : repli sur winget.`)
      await wingetInstall(ctx, 'GrafanaLabs.k6', 'k6')
      prependProcessPath(path.join(process.env.ProgramFiles || 'C:\\Program Files', 'k6'))
    }
  },
  describe(ctx) {
    const a = k6Archive(ctx.plan)
    return [`Télécharger ${a.url}`, `Vérifier la somme (${a.sumsUrl})`, `Copier k6 dans ${k6BinDir()} et l'ajouter au PATH`, 'Repli : winget install GrafanaLabs.k6']
  },
}

/* ================================================================== extensions VS Code */

function vscodeCli(plan) {
  const custom = plan.options.vscodeCli
  if (custom && EDITOR_CLI_RE.test(path.basename(custom)) && exists(custom)) return custom
  const local = process.env.LOCALAPPDATA || ''
  const known = IS_WIN
    ? [
      path.join(local, 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft VS Code', 'bin', 'code.cmd'),
    ]
    : ['/usr/bin/code', '/usr/local/bin/code', '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code']
  return known.find(exists) || findOnPath('code')
}

function wantedExtensions(ctx) {
  const map = ctx.plan.options.vscodeExtensions || {}
  return [...new Set(ctx.stacks.flatMap((s) => map[s] || []))]
}

async function listExtensions(cli, env) {
  const r = await probe(cli, ['--list-extensions', '--show-versions'], { timeoutMs: 60000, env })
  if (!r.ok) return null
  const map = new Map()
  for (const line of r.output.split(/\r?\n/)) {
    const [id, version] = line.trim().split('@')
    if (id && /\./.test(id)) map.set(id.toLowerCase(), version || '')
  }
  return map
}

const vscodeExtensions = {
  async detect(ctx) {
    const wanted = wantedExtensions(ctx)
    if (!wanted.length) return ok('', 'Aucune extension demandée par les stacks choisies.')
    const cli = vscodeCli(ctx.plan)
    if (!cli) return skipped('Commande « code » introuvable : installez VS Code (ou, dans VS Code, Ctrl+Maj+P › « Shell Command: Install code in PATH »), ou indiquez son chemin dans les paramètres.', { expected: wanted.join(', ') })
    const installed = await listExtensions(cli, ctx.env)
    if (!installed) return { state: 'error', version: '', message: `La commande ${cli} ne répond pas.`, expected: wanted.join(', ') }
    const absent = wanted.filter((id) => !installed.has(id.toLowerCase()))
    const editor = /cursor/i.test(cli) ? ' (éditeur Cursor)' : ''
    if (!absent.length) return ok(`${wanted.length}/${wanted.length}`, `Extensions présentes${editor}.`, { expected: wanted.join(', ') })
    const msg = `Manquantes${editor} : ${absent.join(', ')}`
    return absent.length === wanted.length ? missing(msg, { expected: wanted.join(', ') }) : outdated(`${wanted.length - absent.length}/${wanted.length}`, msg, { expected: wanted.join(', ') })
  },
  async install(ctx) {
    const cli = vscodeCli(ctx.plan)
    if (!cli) throw new Error('Commande « code » introuvable.')
    const installed = (await listExtensions(cli, ctx.env)) || new Map()
    const failed = []
    for (const id of wantedExtensions(ctx).filter((x) => !installed.has(x.toLowerCase()))) {
      const r = await ctx.exec(cli, ['--install-extension', id], { timeoutMs: 10 * 60000 })
      if (r.code !== 0) failed.push(id)
      if (ctx.cancelled()) return
    }
    if (failed.length) throw new Error(`Extensions non installées : ${failed.join(', ')} (accès à la Marketplace bloqué ?).`)
  },
  describe(ctx) {
    return wantedExtensions(ctx).map((id) => `code --install-extension ${id}`)
  },
}

/* ================================================================== Copilot CLI */

async function globalPrefix(ctx) {
  const inv = await npmInvocation(ctx)
  if (!inv) return null
  const r = await probe(inv.exe, [inv.cli, 'prefix', '-g'], { env: ctx.env })
  return r.ok ? r.output.split(/\r?\n/).pop().trim() : null
}

const copilotCli = {
  async detect(ctx) {
    const spec = ctx.plan.versions.copilotCli || 'latest'
    const prefix = await globalPrefix(ctx)
    const pkg = prefix && (readJson(path.join(prefix, 'node_modules', '@github', 'copilot', 'package.json'))
      || readJson(path.join(prefix, 'lib', 'node_modules', '@github', 'copilot', 'package.json')))
    if (!pkg) return missing('Copilot CLI n\'est pas installé (npm -g @github/copilot).', { expected: spec })
    if (!satisfies(pkg.version, spec)) return outdated(pkg.version, `Copilot CLI ${pkg.version} (attendu ${spec}).`, { expected: spec })
    return ok(pkg.version, `Copilot CLI ${pkg.version} — connectez-vous une fois avec « copilot » puis /login.`, { expected: spec })
  },
  async install(ctx) {
    const n = await resolveNode(ctx)
    if (n && parseVersion(n.version)[0] < 22) throw new Error(`Copilot CLI exige Node 22 ou plus (trouvé ${n.version}).`)
    const spec = ctx.plan.versions.copilotCli || 'latest'
    const r = await runNpm(ctx, ['install', '-g', '--no-fund', '--no-audit', `@github/copilot@${spec}`], { timeoutMs: 15 * 60000 })
    if (r.code !== 0) throw new Error(`npm install -g @github/copilot a échoué (code ${r.code}).`)
  },
  describe: (ctx) => [`npm install -g @github/copilot@${ctx.plan.versions.copilotCli || 'latest'}`],
}

/* ================================================================== détection seule */

const python = {
  detectOnly: true,
  async detect() {
    const candidates = [
      IS_WIN ? [findOnPath('py'), ['-3', '--version']] : null,
      [findOnPath('python', { skip: ['WindowsApps'] }), ['--version']],
      [findOnPath('python3', { skip: ['WindowsApps'] }), ['--version']],
    ].filter((c) => c && c[0])
    for (const [exe, args] of candidates) {
      const r = await probe(exe, args)
      const version = /python/i.test(r.output) ? versionString(r.output) : ''
      if (version) return ok(version, `Python ${version} (${exe})`)
    }
    return missing('Python est introuvable (facultatif) : https://www.python.org/downloads/')
  },
  describe: () => ['Détection seule'],
}

const java = {
  detectOnly: true,
  async detect() {
    const home = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', IS_WIN ? 'java.exe' : 'java') : null
    const exe = findOnPath('java') || (home && exists(home) ? home : null)
    if (!exe) return missing('Java est introuvable (facultatif) : https://adoptium.net/')
    const r = await probe(exe, ['-version'])
    const m = r.output.match(/version "([^"]+)"/)
    const version = m ? versionString(m[1].replace(/^1\./, '')) || m[1] : versionString(r.output)
    return version ? ok(version, `Java ${version} (${exe})`) : missing('Java ne répond pas.')
  },
  describe: () => ['Détection seule'],
}

/* ================================================================== registre */

/** Implémentations indexées par identifiant de composant du plan. */
export function getImplementation(id, def = {}) {
  const map = {
    node, npm, npmrc, git, workspace,
    'npm-playwright': npmPackages(def),
    'npm-gherkin': npmPackages(def),
    'npm-k6': npmPackages(def),
    'playwright-browsers': playwrightBrowsers,
    k6,
    'vscode-extensions': vscodeExtensions,
    'copilot-cli': copilotCli,
    python,
    java,
  }
  return map[id] || null
}

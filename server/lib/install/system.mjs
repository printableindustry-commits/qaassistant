/**
 * Primitives système de l'installateur : recherche dans le PATH, exécution de processus
 * (sans shell, avec journal ligne à ligne, délai et annulation), téléchargement vérifié,
 * extraction d'archives, PATH utilisateur, comparaison de versions, masquage des secrets.
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import { spawn } from 'child_process'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { StringDecoder } from 'string_decoder'

export const IS_WIN = process.platform === 'win32'

/* ------------------------------------------------------------------ secrets */

/** Masque mots de passe d'URL, jetons npm et en-têtes d'autorisation dans une ligne de journal. */
export function maskSecrets(text) {
  return String(text ?? '')
    .replace(/(\/\/[^:/@\s"']+:)[^@\s"']+@/g, '$1••••@')
    .replace(/(_authToken\s*=\s*)\S+/gi, '$1••••')
    .replace(/(_auth\s*=\s*)\S+/gi, '$1••••')
    .replace(/(authorization:\s*\w+\s+)\S+/gi, '$1••••')
}

/* ------------------------------------------------------------------ PATH */

export function pathKey(env = process.env) {
  return Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || 'PATH'
}

export function pathEntries(env = process.env) {
  return String(env[pathKey(env)] || '').split(path.delimiter).filter(Boolean)
}

/** Ajoute un dossier en tête du PATH du processus serveur (effet immédiat pour les commandes suivantes). */
export function prependProcessPath(dir) {
  const norm = (p) => path.resolve(p).toLowerCase()
  const entries = pathEntries().filter((p) => norm(p) !== norm(dir))
  process.env.PATH = [dir, ...entries].join(path.delimiter)
}

/** Cherche un exécutable dans le PATH (sans lancer de processus). */
export function findOnPath(name, { skip = [] } = {}) {
  const exts = IS_WIN ? ['.exe', '.cmd', '.bat', ''] : ['']
  for (const dir of pathEntries()) {
    if (skip.some((s) => dir.toLowerCase().includes(s.toLowerCase()))) continue
    for (const ext of exts) {
      const file = path.join(dir, name + ext)
      try {
        if (fs.statSync(file).isFile()) return file
      } catch {
        // Alias d'exécution d'application (WindowsApps\winget.exe…) : point d'analyse illisible par stat.
        try { if (!fs.lstatSync(file).isDirectory()) return file } catch { /* absent */ }
      }
    }
  }
  return null
}

export function localAppData() {
  return process.env.LOCALAPPDATA || path.join(os.homedir(), IS_WIN ? 'AppData/Local' : '.local/share')
}

/** Dossier racine des outils portables installés par Wizard QA (sans droits administrateur). */
export function toolsRoot() {
  return path.join(localAppData(), 'wizard-qa')
}

/* ------------------------------------------------------------------ versions */

export function parseVersion(text) {
  const m = String(text || '').match(/(\d+)\.(\d+)(?:\.(\d+))?/)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] || 0)] : null
}

export function versionString(text) {
  const v = parseVersion(text)
  return v ? v.join('.') : ''
}

export function compareVersions(a, b) {
  const x = parseVersion(a) || [0, 0, 0]
  const y = parseVersion(b) || [0, 0, 0]
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]
  return 0
}

/** Sous-ensemble de semver suffisant pour le plan : exact, ^, ~, majeure seule, majeure.mineure, latest. */
export function satisfies(version, spec) {
  const s = String(spec || '').trim()
  if (!version) return false
  if (!s || s === 'latest' || s === '*') return true
  const v = parseVersion(version)
  const body = s.replace(/^[\^~=v]+/, '')
  const parts = body.split('.').filter((p) => /^\d+$/.test(p)).map(Number)
  const want = [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0]
  if (!v) return false
  const ge = compareVersions(version, want.join('.')) >= 0
  if (s.startsWith('^')) return ge && (want[0] > 0 ? v[0] === want[0] : v[0] === 0 && v[1] === want[1])
  if (s.startsWith('~')) return ge && v[0] === want[0] && v[1] === want[1]
  if (parts.length === 1) return v[0] === want[0]
  if (parts.length === 2) return v[0] === want[0] && v[1] === want[1]
  return compareVersions(version, body) === 0
}

/* ------------------------------------------------------------------ processus */

const UNSAFE_CMD_ARG = /["%!\r\n]/

/** Ligne de commande lisible (journal). */
export function formatCommand(cmd, args = []) {
  const q = (s) => (/[\s]/.test(s) ? `"${s}"` : s)
  return maskSecrets([path.basename(cmd), ...args].map((a) => q(String(a))).join(' '))
}

/**
 * Un script .cmd/.bat ne peut pas être lancé sans cmd.exe : on construit la ligne nous-mêmes,
 * chaque argument entre guillemets, après refus de " % ! et des sauts de ligne (aucune injection possible).
 */
function cmdScriptInvocation(file, args) {
  for (const a of [file, ...args]) {
    if (UNSAFE_CMD_ARG.test(String(a))) throw new Error(`Argument refusé (caractère spécial) : ${a}`)
  }
  const line = [file, ...args].map((a) => `"${a}"`).join(' ')
  return { cmd: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], verbatim: true }
}

/** Termine un processus et ses descendants. */
export function killTree(child) {
  if (!child || child.exitCode !== null || child.killed) return
  if (IS_WIN && child.pid) {
    try {
      const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' })
      // Sans écouteur, un échec de lancement (ENOENT…) ferait tomber le serveur.
      killer.on('error', () => { try { child.kill() } catch { /* déjà terminé */ } })
      return
    } catch { /* repli ci-dessous */ }
  }
  try { child.kill('SIGTERM') } catch { /* déjà terminé */ }
}

/**
 * Lance une commande sans shell. options : cwd, env, timeoutMs, onLine(ligne, flux), onChild(child).
 * Résout toujours { code, output, timedOut, error } (jamais d'exception).
 */
export function runProcess(cmd, args = [], options = {}) {
  const { cwd, env = process.env, timeoutMs = 120000, onLine, onChild, input } = options
  return new Promise((resolve) => {
    let inv = { cmd, args, verbatim: false }
    try {
      if (IS_WIN && /\.(cmd|bat)$/i.test(cmd)) inv = cmdScriptInvocation(cmd, args)
    } catch (e) {
      resolve({ code: 1, output: e.message, timedOut: false, error: e.message })
      return
    }
    let output = ''
    let timedOut = false
    const buffers = { out: '', err: '' }
    // Un caractère UTF-8 peut être coupé entre deux paquets : décodage incrémental.
    const decoders = { out: new StringDecoder('utf8'), err: new StringDecoder('utf8') }
    let child
    try {
      child = spawn(inv.cmd, inv.args, {
        cwd,
        env,
        shell: false,
        windowsHide: true,
        windowsVerbatimArguments: inv.verbatim,
      })
    } catch (e) {
      resolve({ code: 1, output: e.message, timedOut: false, error: e.message })
      return
    }
    if (onChild) onChild(child)
    // Processus terminé avant la lecture de stdin : EPIPE sans écouteur ferait tomber le serveur.
    child.stdin?.on('error', () => {})
    child.stdout?.on('error', () => {})
    child.stderr?.on('error', () => {})
    if (input !== undefined) child.stdin?.end(input)
    else child.stdin?.end()

    const feed = (stream, chunk) => {
      const text = decoders[stream].write(chunk)
      output += text
      if (output.length > 400000) output = output.slice(-300000)
      buffers[stream] += text
      const lines = buffers[stream].split(/\r?\n|\r(?!\n)/)
      buffers[stream] = lines.pop()
      if (onLine) for (const l of lines) if (l.trim()) onLine(maskSecrets(l), stream)
    }
    child.stdout?.on('data', (c) => feed('out', c))
    child.stderr?.on('data', (c) => feed('err', c))
    const timer = setTimeout(() => {
      timedOut = true
      killTree(child)
    }, timeoutMs)
    let settled = false
    const finish = (code, error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (onLine) for (const s of ['out', 'err']) if (buffers[s].trim()) onLine(maskSecrets(buffers[s]), s)
      resolve({ code, output: maskSecrets(output), timedOut, error })
    }
    child.on('error', (e) => finish(1, e.message))
    child.on('close', (code) => finish(code ?? 1, timedOut ? `Délai dépassé (${Math.round(timeoutMs / 1000)} s)` : undefined))
  })
}

/** Exécution courte pour la détection : renvoie la sortie (stdout + stderr) ou '' en cas d'échec. */
export async function probe(cmd, args, { timeoutMs = 15000, env } = {}) {
  if (!cmd) return { ok: false, output: '' }
  const r = await runProcess(cmd, args, { timeoutMs, env })
  return { ok: r.code === 0, output: (r.output || '').trim(), code: r.code }
}

/* ------------------------------------------------------------------ fichiers */

export async function sha256File(file) {
  const hash = crypto.createHash('sha256')
  await pipeline(fs.createReadStream(file), hash)
  return hash.digest('hex')
}

/** Dossier temporaire unique sur le même volume que les outils (renommage atomique possible). */
export function makeTempDir(prefix) {
  const base = path.join(toolsRoot(), 'tmp')
  fs.mkdirSync(base, { recursive: true })
  return fs.mkdtempSync(path.join(base, `${prefix}-`))
}

export function removeDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* ignoré */ }
}

/**
 * Télécharge une URL vers un fichier. Sans proxy : fetch natif ; avec proxy : curl (inclus dans Windows 10+).
 * Journalise la progression tous les 10 %.
 */
export async function download(url, dest, { proxy, caFile, insecure, signal, log, onChild, env } = {}) {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  if (proxy) {
    const curl = findOnPath('curl')
    if (!curl) throw new Error('Proxy configuré mais curl est introuvable pour le téléchargement.')
    const args = ['-fL', '--retry', '2', '-sS', '-x', proxy, '-o', dest, url]
    if (caFile) args.splice(0, 0, '--cacert', caFile)
    if (insecure) args.splice(0, 0, '-k')
    log?.(`$ ${formatCommand(curl, args)}`)
    const r = await runProcess(curl, args, { timeoutMs: 30 * 60000, onLine: log, onChild, env })
    if (r.code !== 0) throw new Error(`Téléchargement impossible (${url}) : ${r.error || r.output || `code ${r.code}`}`)
    return dest
  }
  log?.(`Téléchargement : ${url}`)
  const res = await fetch(url, { signal, redirect: 'follow', headers: { 'User-Agent': 'wizard-qa-installer' } })
  if (!res.ok || !res.body) throw new Error(`Téléchargement impossible (${url}) : HTTP ${res.status}`)
  const total = Number(res.headers.get('content-length')) || 0
  let received = 0
  let nextStep = 10
  const body = Readable.fromWeb(res.body)
  body.on('data', (c) => {
    received += c.length
    const pct = total ? Math.floor((received / total) * 100) : 0
    if (total && pct >= nextStep) {
      log?.(`… ${pct} % (${(received / 1048576).toFixed(1)} Mo / ${(total / 1048576).toFixed(1)} Mo)`)
      nextStep = Math.floor(pct / 10) * 10 + 10
    }
  })
  await pipeline(body, fs.createWriteStream(dest))
  return dest
}

/** Lit la somme attendue d'un fichier dans une liste « <sha256>  <nom> » (SHASUMS256.txt, checksums.txt). */
export async function fetchExpectedSha(listUrl, fileName, opts = {}) {
  const tmp = path.join(makeTempDir('sum'), 'sums.txt')
  try {
    await download(listUrl, tmp, { ...opts, log: undefined })
    const line = fs.readFileSync(tmp, 'utf8').split(/\r?\n/).find((l) => l.trim().endsWith(fileName))
    const m = line && line.match(/^([a-f0-9]{64})\s/i)
    if (!m) throw new Error(`Somme de contrôle de ${fileName} absente de ${listUrl}`)
    return m[1].toLowerCase()
  } finally {
    removeDir(path.dirname(tmp))
  }
}

/** Extrait une archive (zip, tar.gz, tar.xz) : tar (natif sous Windows 10+), repli PowerShell pour les zip. */
export async function extractArchive(file, destDir, { log, onChild } = {}) {
  fs.mkdirSync(destDir, { recursive: true })
  const tar = IS_WIN ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : findOnPath('tar')
  if (tar && fs.existsSync(tar)) {
    const r = await runProcess(tar, ['-xf', file, '-C', destDir], { timeoutMs: 10 * 60000, onChild })
    if (r.code === 0) return
    log?.(`tar a échoué (${r.output.slice(0, 200)}), tentative avec PowerShell…`)
  }
  if (!IS_WIN || !/\.zip$/i.test(file)) throw new Error(`Extraction impossible : ${path.basename(file)}`)
  const env = { ...process.env, WIZARD_ZIP: file, WIZARD_DEST: destDir }
  const script = "$ErrorActionPreference='Stop'; Expand-Archive -Force -LiteralPath $env:WIZARD_ZIP -DestinationPath $env:WIZARD_DEST"
  const r = await runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { env, timeoutMs: 10 * 60000, onChild })
  if (r.code !== 0) throw new Error(`Extraction impossible : ${r.output.slice(0, 400)}`)
}

/* ------------------------------------------------------------------ PATH utilisateur */

/** Lit le PATH utilisateur persistant (Windows) — '' si indisponible. */
export async function readUserPath() {
  if (!IS_WIN) return ''
  const r = await probe('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "[Environment]::GetEnvironmentVariable('Path','User')"])
  return r.ok ? r.output : ''
}

/**
 * Ajoute un dossier au PATH utilisateur (Windows, via [Environment]::SetEnvironmentVariable)
 * et au PATH du processus. Le dossier passe par une variable d'environnement : aucune concaténation.
 */
export async function addToUserPath(dir, { log } = {}) {
  prependProcessPath(dir)
  if (!IS_WIN) {
    log?.(`Ajoutez ${dir} à votre PATH (ex. dans ~/.profile) pour les nouveaux terminaux.`)
    return { ok: true, changed: false }
  }
  const script = [
    "$ErrorActionPreference='Stop'",
    '$dir = $env:WIZARD_ADD_PATH',
    "$cur = [Environment]::GetEnvironmentVariable('Path','User')",
    '$parts = @(); if ($cur) { $parts = $cur.Split(";") | Where-Object { $_ } }',
    'if ($parts | Where-Object { $_.TrimEnd("\\") -ieq $dir.TrimEnd("\\") }) { "deja-present"; exit 0 }',
    "[Environment]::SetEnvironmentVariable('Path', (@($dir) + $parts) -join ';', 'User')",
    '"ajoute"',
  ].join('; ')
  const r = await runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: { ...process.env, WIZARD_ADD_PATH: dir },
    timeoutMs: 30000,
  })
  if (r.code !== 0) throw new Error(`Mise à jour du PATH utilisateur impossible : ${r.output.slice(0, 300)}`)
  const changed = r.output.includes('ajoute')
  log?.(changed
    ? `PATH utilisateur mis à jour : ${dir} (nouveaux terminaux uniquement ; redémarrez VS Code pour qu'il le voie).`
    : `${dir} est déjà dans le PATH utilisateur.`)
  return { ok: true, changed }
}

/* ------------------------------------------------------------------ environnement réseau */

/** Variables d'environnement des commandes lancées (proxy, certificats, miroirs). */
export function buildEnv(plan) {
  const env = { ...process.env }
  const p = plan.proxy || {}
  const set = (k, v) => { if (v) { env[k] = v; env[k.toLowerCase()] = v } }
  set('HTTP_PROXY', p.http)
  set('HTTPS_PROXY', p.https || p.http)
  set('NO_PROXY', p.noProxy)
  if (p.caFile) env.NODE_EXTRA_CA_CERTS = p.caFile
  if (plan.mirrors?.playwrightDownloadHost) env.PLAYWRIGHT_DOWNLOAD_HOST = plan.mirrors.playwrightDownloadHost
  if (plan.mirrors?.npmRegistry) env.npm_config_registry = plan.mirrors.npmRegistry
  env.npm_config_fund = 'false'
  env.npm_config_audit = 'false'
  env.npm_config_update_notifier = 'false'
  return env
}

/**
 * Moteur navigateur de l'exploration (docs/V3-ARCHITECTURE.md §5.2).
 *
 *   engineStatus() → { available, version, module, reason, browsers: [{ id, label, available, path? }] }
 *   openBrowser(opts) → session navigateur pilotée par un processus enfant (runner/runner.mjs)
 *
 * Le processus enfant est lancé sans shell, dans REPO_ROOT, pour résoudre playwright-core / playwright /
 * @playwright/test depuis <REPO_ROOT>/node_modules. Dialogue en lignes JSON sur stdin/stdout.
 * Les secrets (mots de passe des comptes de démo) passent uniquement par stdin, jamais par argv,
 * l'environnement ou les journaux. Nettoyage : arrêt à close(), à la sortie du serveur, et l'enfant
 * s'arrête de lui-même si le parent disparaît (stdin fermé).
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawn, spawnSync } from 'child_process'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import { REPO_ROOT } from '../paths.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const RUNNER = path.join(HERE, 'runner', 'runner.mjs')
const MODULES = ['playwright-core', 'playwright', '@playwright/test']
const INSTALL_HINT = 'Installez la stack Playwright depuis la page Installation.'

const BROWSER_LABELS = { msedge: 'Microsoft Edge', chrome: 'Google Chrome', chromium: 'Chromium (Playwright)' }

// ---------- Détection ----------
function findPackageJson(resolvedMain) {
  let dir = path.dirname(resolvedMain)
  for (let i = 0; i < 6; i++) {
    const p = path.join(dir, 'package.json')
    if (fs.existsSync(p)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(p, 'utf8'))
        if (pkg.name && pkg.version) return { dir, pkg }
      } catch { /* ignoré */ }
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

/** Module Playwright résolu depuis REPO_ROOT : { name, modulePath, version, dir } | null */
export function resolvePlaywright(root = REPO_ROOT) {
  let req
  try {
    req = createRequire(path.join(root, 'package.json'))
  } catch {
    return null
  }
  for (const name of MODULES) {
    try {
      const modulePath = req.resolve(name)
      const info = findPackageJson(modulePath)
      return { name, modulePath, version: info ? info.pkg.version : '', dir: info ? info.dir : path.dirname(modulePath) }
    } catch { /* suivant */ }
  }
  return null
}

function exists(p) {
  try { return !!p && fs.existsSync(p) } catch { return false }
}

function browserCandidates() {
  const env = process.env
  if (process.platform === 'win32') {
    const roots = [env['PROGRAMFILES(X86)'] || env['ProgramFiles(x86)'], env.PROGRAMFILES || env.ProgramFiles, env.LOCALAPPDATA].filter(Boolean)
    return {
      msedge: roots.map((r) => path.join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe')),
      chrome: roots.map((r) => path.join(r, 'Google', 'Chrome', 'Application', 'chrome.exe')),
    }
  }
  if (process.platform === 'darwin') {
    const home = os.homedir()
    return {
      msedge: ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', path.join(home, 'Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge')],
      chrome: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', path.join(home, 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome')],
    }
  }
  return {
    msedge: ['/opt/microsoft/msedge/msedge', '/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable'],
    chrome: ['/opt/google/chrome/chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'],
  }
}

function playwrightCacheDirs(pw) {
  const dirs = []
  if (process.env.PLAYWRIGHT_BROWSERS_PATH && process.env.PLAYWRIGHT_BROWSERS_PATH !== '0') dirs.push(process.env.PLAYWRIGHT_BROWSERS_PATH)
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) dirs.push(path.join(process.env.LOCALAPPDATA, 'ms-playwright'))
  else if (process.platform === 'darwin') dirs.push(path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'))
  else dirs.push(path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'ms-playwright'))
  if (pw) {
    dirs.push(path.join(pw.dir, '.local-browsers'))
    dirs.push(path.join(REPO_ROOT, 'node_modules', 'playwright-core', '.local-browsers'))
  }
  return dirs
}

function chromiumRevision(pw) {
  const candidates = pw ? [path.join(pw.dir, 'browsers.json'), path.join(REPO_ROOT, 'node_modules', 'playwright-core', 'browsers.json')] : []
  for (const f of candidates) {
    try {
      const j = JSON.parse(fs.readFileSync(f, 'utf8'))
      const c = (j.browsers || []).find((b) => b.name === 'chromium')
      if (c) return String(c.revision)
    } catch { /* suivant */ }
  }
  return null
}

function detectChromium(pw) {
  const rev = chromiumRevision(pw)
  for (const dir of playwrightCacheDirs(pw)) {
    if (!exists(dir)) continue
    if (rev && exists(path.join(dir, `chromium-${rev}`))) return path.join(dir, `chromium-${rev}`)
    if (!rev) {
      try {
        const found = fs.readdirSync(dir).find((n) => /^chromium-\d+$/.test(n))
        if (found) return path.join(dir, found)
      } catch { /* ignoré */ }
    }
  }
  return null
}

export function engineStatus() {
  const pw = resolvePlaywright()
  const cands = browserCandidates()
  const browsers = []
  for (const id of ['msedge', 'chrome']) {
    const found = cands[id].find(exists)
    browsers.push({ id, label: BROWSER_LABELS[id], available: !!found, ...(found ? { path: found } : {}) })
  }
  const chromiumPath = detectChromium(pw)
  browsers.push({ id: 'chromium', label: BROWSER_LABELS.chromium, available: !!chromiumPath, ...(chromiumPath ? { path: chromiumPath } : {}) })
  const anyBrowser = browsers.some((b) => b.available)
  let reason = ''
  if (!pw) reason = `Playwright est introuvable dans ${path.join(REPO_ROOT, 'node_modules')}. ${INSTALL_HINT}`
  else if (!anyBrowser) reason = `Aucun navigateur compatible (Edge, Chrome ou Chromium de Playwright) n'a été trouvé. ${INSTALL_HINT}`
  return {
    available: !!pw && anyBrowser,
    version: pw ? pw.version : null,
    module: pw ? pw.name : null,
    reason,
    browsers,
  }
}

// ---------- Sessions navigateur ----------
const OPEN = new Set()
let exitHooked = false

function killTree(child, sync = false) {
  if (!child || child.exitCode !== null || child.signalCode) return
  const pid = child.pid
  if (!pid) return
  try {
    if (process.platform === 'win32') {
      const args = ['/PID', String(pid), '/T', '/F']
      if (sync) spawnSync('taskkill', args, { windowsHide: true, shell: false, stdio: 'ignore', timeout: 5000 })
      else spawn('taskkill', args, { windowsHide: true, shell: false, stdio: 'ignore' }).on('error', () => child.kill())
    } else {
      try { process.kill(-pid, 'SIGKILL') } catch { child.kill('SIGKILL') }
    }
  } catch {
    try { child.kill() } catch { /* ignoré */ }
  }
}

function hookExit() {
  if (exitHooked) return
  exitHooked = true
  process.once('exit', () => {
    for (const s of OPEN) killTree(s.child, true)
  })
  // Arrêt du serveur par signal : on ferme les navigateurs puis on laisse sortir le processus
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    try {
      if (process.listenerCount(sig) === 0) {
        process.once(sig, () => {
          for (const s of OPEN) killTree(s.child, true)
          process.exit(sig === 'SIGINT' ? 130 : 143)
        })
      }
    } catch { /* signal non pris en charge */ }
  }
}

/** Liste des sessions navigateur ouvertes (diagnostic). */
export function openBrowsers() {
  return [...OPEN].map((s) => ({ pid: s.pid, browser: s.browser, startedAt: s.startedAt }))
}

/** Ferme toutes les sessions navigateur (arrêt du serveur, tests). */
export async function closeAllBrowsers() {
  await Promise.all([...OPEN].map((s) => s.close().catch(() => {})))
}

function normalizeOrigins(baseUrl, list) {
  const out = new Set()
  for (const u of [baseUrl, ...(Array.isArray(list) ? list : [])]) {
    try {
      if (u) out.add(new URL(String(u)).origin)
    } catch { /* ignorée */ }
  }
  return [...out]
}

/**
 * Ouvre un navigateur piloté.
 * opts : { browser: 'msedge'|'chrome'|'chromium', headless, baseUrl, allowedOrigins, secrets, viewport, onEvent, timeoutMs }
 */
export async function openBrowser(opts = {}) {
  const status = engineStatus()
  const pw = resolvePlaywright()
  if (!pw) throw new Error(status.reason || INSTALL_HINT)
  if (!opts.baseUrl) throw new Error('Adresse de l\'application (baseUrl) requise.')
  try { new URL(opts.baseUrl) } catch { throw new Error(`Adresse de l'application invalide : ${opts.baseUrl}`) }
  if (!status.browsers.some((b) => b.available)) throw new Error(status.reason)

  // ordre d'essai : navigateur demandé puis replis disponibles
  const wanted = ['msedge', 'chrome', 'chromium'].includes(opts.browser) ? opts.browser : 'msedge'
  const order = [wanted, ...['msedge', 'chrome', 'chromium'].filter((b) => b !== wanted)]
    .filter((id) => status.browsers.find((b) => b.id === id)?.available)

  hookExit()
  const onEvent = typeof opts.onEvent === 'function' ? opts.onEvent : () => {}
  const child = spawn(process.execPath, [RUNNER], {
    cwd: REPO_ROOT,
    shell: false,
    windowsHide: true,
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, NODE_OPTIONS: '', WQA_PARENT_PID: String(process.pid) },
  })

  let seq = 0
  const pending = new Map()
  let closed = false
  let exitInfo = null
  const session = {
    pid: child.pid,
    child,
    browser: null,
    startedAt: new Date().toISOString(),
    get closed() { return closed },
  }

  const safeEvent = (type, data) => {
    try { onEvent(type, data) } catch { /* l'écouteur ne doit pas casser le moteur */ }
  }

  let buf = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    buf += chunk
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (!line) continue
      let msg
      try { msg = JSON.parse(line) } catch { continue }
      if (msg.event) {
        if (msg.event === 'log') safeEvent('log', msg.data && msg.data.text ? msg.data.text : msg.data)
        else safeEvent(msg.event, msg.data)
        if (msg.event === 'screenshot') session.lastScreenshot = msg.data
        continue
      }
      const p = pending.get(msg.id)
      if (!p) continue
      pending.delete(msg.id)
      clearTimeout(p.timer)
      if (msg.ok) p.resolve(msg.result)
      else p.reject(new Error(msg.error || 'Erreur du moteur navigateur.'))
    }
  })
  let errBuf = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => {
    errBuf += chunk
    let i
    while ((i = errBuf.indexOf('\n')) >= 0) {
      const line = errBuf.slice(0, i).trim()
      errBuf = errBuf.slice(i + 1)
      if (line) safeEvent('log', `[moteur] ${line.slice(0, 500)}`)
    }
  })
  const finish = (info) => {
    if (closed) return
    closed = true
    exitInfo = info
    OPEN.delete(session)
    for (const [, p] of pending) {
      clearTimeout(p.timer)
      p.reject(new Error('Le moteur navigateur s\'est arrêté.'))
    }
    pending.clear()
    safeEvent('exit', info)
  }
  child.on('exit', (code, signal) => finish({ code, signal }))
  child.on('error', (e) => finish({ code: -1, error: e.message }))
  child.stdin.on('error', () => { /* enfant arrêté */ })
  OPEN.add(session)

  function request(cmd, args = {}, timeoutMs = 30000) {
    if (closed) return Promise.reject(new Error('Le navigateur est fermé.'))
    const id = ++seq
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`Délai dépassé pour « ${cmd} » (${Math.round(timeoutMs / 1000)} s).`))
      }, timeoutMs)
      pending.set(id, { resolve, reject, timer })
      try {
        child.stdin.write(JSON.stringify({ id, cmd, args }) + '\n')
      } catch (e) {
        clearTimeout(timer)
        pending.delete(id)
        reject(e)
      }
    })
  }
  // Variante qui ne lève pas : { ok:false, error } en cas d'échec
  async function call(cmd, args, timeoutMs) {
    try {
      return await request(cmd, args, timeoutMs)
    } catch (e) {
      return { ok: false, error: e.message }
    }
  }

  const secrets = {}
  for (const [k, v] of Object.entries(opts.secrets || {})) {
    if (v != null && v !== '') secrets[String(k).replace(/^\{\{|\}\}$/g, '')] = String(v)
  }
  try {
    const info = await request('init', {
      modulePath: pw.modulePath,
      browsers: order,
      headless: opts.headless !== false,
      baseUrl: opts.baseUrl,
      allowedOrigins: normalizeOrigins(opts.baseUrl, opts.allowedOrigins),
      secrets,
      viewport: opts.viewport || { width: 1280, height: 800 },
    }, opts.timeoutMs || 90000)
    session.browser = info.browser
    session.version = info.version
    session.allowedOrigins = info.allowedOrigins
  } catch (e) {
    killTree(child)
    finish({ code: -1, error: e.message })
    throw new Error(`Ouverture du navigateur impossible : ${e.message}`)
  }

  Object.assign(session, {
    goto: (url) => call('goto', { url }, 45000),
    snapshot: (o = {}) => call('snapshot', { screenshot: o.screenshot !== false, limit: o.limit }, 45000),
    act: (o = {}) => call('act', o, 30000),
    expect: (o = {}) => call('expect', o, 25000),
    startRecording: () => call('startRecording', {}, 15000),
    stopRecording: async () => {
      const r = await call('stopRecording', {}, 20000)
      return r && r.events ? r.events : []
    },
    clickAt: (p = {}) => call('clickAt', p, 20000),
    typeText: (text) => call('typeText', { text: typeof text === 'object' && text ? text.text : text }, 60000),
    pressKey: (key) => call('pressKey', { key: typeof key === 'object' && key ? key.key : key }, 20000),
    screenshot: () => call('screenshot', {}, 20000),
    annotate: (o = {}) => call('annotate', o, 15000),
    clearAnnotations: () => call('clearAnnotations', {}, 5000),
    setSecrets: (s) => call('secrets', { secrets: s }, 5000),
    ping: () => call('ping', {}, 5000),
    exitInfo: () => exitInfo,
    close: async () => {
      if (closed) return { ok: true }
      await request('close', {}, 10000).catch(() => {})
      await new Promise((resolve) => {
        if (closed) return resolve()
        const t = setTimeout(resolve, 6000)
        child.once('exit', () => { clearTimeout(t); resolve() })
      })
      killTree(child)
      finish({ code: 0, closed: true })
      return { ok: true }
    },
  })
  return session
}

/**
 * Fournisseur « copilot-cli » : GitHub Copilot CLI (commande « copilot », paquet npm @github/copilot)
 * en mode non interactif (-p). Aucun outil n'est autorisé par défaut : Copilot répond sans agir sur le poste.
 *
 * Sécurité : spawn sans shell ; le prompt est un argument distinct, jamais concaténé à une commande.
 * Sous Windows, le lanceur npm « copilot.cmd » est résolu vers son script Node pour éviter cmd.exe.
 */
import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import { REPO_ROOT } from '../../paths.mjs'
import { ProviderError, stripAnsi } from '../prompt.mjs'
import { scrubSecrets } from '../config.mjs'

export const id = 'copilot-cli'

const IS_WIN = process.platform === 'win32'
const DETECT_TTL_MS = 5 * 60 * 1000
const MAX_PROMPT_CHARS = IS_WIN ? 28000 : 120000
const WORKDIR = path.join(REPO_ROOT, '.wizard-qa', 'llm', 'copilot-cli')

let detection = null      // { command, found, path, launch: { cmd, prefix }, version, reason, checkedAt }
let detecting = null

/** Exécute un programme sans shell ; résout { code, stdout, stderr, timedOut }. */
function execFile(cmd, args, { timeoutMs = 10000, signal, cwd } = {}) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(cmd, args, { shell: false, windowsHide: true, cwd, env: { ...process.env, NO_COLOR: '1' } })
    } catch (e) {
      resolve({ code: -1, stdout: '', stderr: e.message, error: e })
      return
    }
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const cap = (s, d) => (s.length > 2_000_000 ? s : s + d)
    // Décodage par flux : un caractère accentué coupé entre deux paquets reste intact.
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (d) => { stdout = cap(stdout, d) })
    child.stderr.on('data', (d) => { stderr = cap(stderr, d) })
    const kill = () => { try { child.kill() } catch { /* déjà arrêté */ } }
    const timer = setTimeout(() => { timedOut = true; kill() }, timeoutMs)
    const onAbort = () => kill()
    signal?.addEventListener('abort', onAbort, { once: true })
    child.on('error', (e) => { stderr += e.message })
    child.on('close', (code) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      resolve({ code, stdout, stderr, timedOut })
    })
  })
}

/**
 * Recherche dans le PATH faite par Node sous Windows : la sortie de where.exe suit la page de code
 * de la console et abîme les chemins accentués (C:\Users\Prénom\…).
 */
function searchWindowsPath(command) {
  const exts = path.extname(command) ? [''] : ['.exe', '.cmd', '.bat']
  const dirs = String(process.env.PATH || process.env.Path || '').split(';')
    .map((d) => d.trim().replace(/^"|"$/g, '')).filter(Boolean)
  const found = []
  for (const dir of dirs) {
    for (const ext of exts) {
      const file = path.join(dir, command + ext)
      try {
        if (fs.statSync(file).isFile() && !found.includes(file)) found.push(file)
      } catch { /* absent de ce dossier */ }
    }
  }
  return found
}

async function locate(command) {
  if (/[\\/]/.test(command)) {
    if (fs.existsSync(command)) return [path.resolve(command)]
    // Chemin sans extension sous Windows : on essaie .exe, .cmd et .bat.
    return IS_WIN ? ['.exe', '.cmd', '.bat'].map((e) => path.resolve(command + e)).filter((f) => fs.existsSync(f)) : []
  }
  if (IS_WIN) {
    const found = searchWindowsPath(command)
    if (found.length) return found
  }
  const r = await execFile(IS_WIN ? 'where.exe' : 'which', [command], { timeoutMs: 8000 })
  if (r.code !== 0) return []
  return r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
}

/** Lanceur npm Windows (.cmd) → script Node qu'il appelle. */
function scriptFromShim(shimPath) {
  try {
    const text = fs.readFileSync(shimPath, 'utf8')
    const m = text.match(/"%~?dp0%?\\?([^"]+?\.(?:js|mjs|cjs))"/i)
    if (!m) return null
    const script = path.join(path.dirname(shimPath), m[1])
    return fs.existsSync(script) ? script : null
  } catch {
    return null
  }
}

/** Choisit comment lancer la commande : exécutable direct, ou node + script derrière un .cmd. */
function launcherFor(candidates) {
  if (!IS_WIN) return candidates[0] ? { cmd: candidates[0], prefix: [], path: candidates[0] } : null
  const exe = candidates.find((c) => /\.exe$/i.test(c))
  if (exe) return { cmd: exe, prefix: [], path: exe }
  for (const shim of candidates.filter((c) => /\.(cmd|bat)$/i.test(c))) {
    const script = scriptFromShim(shim)
    if (script) return { cmd: process.execPath, prefix: [script], path: shim }
  }
  return null
}

async function runDetection(command) {
  const base = { command, checkedAt: new Date().toISOString() }
  const candidates = await locate(command)
  if (!candidates.length) {
    return { ...base, found: false, reason: `Commande « ${command} » introuvable : installez GitHub Copilot CLI (npm install -g @github/copilot).` }
  }
  const launch = launcherFor(candidates)
  if (!launch) {
    return { ...base, found: false, path: candidates[0], reason: `« ${candidates[0]} » trouvé mais impossible à lancer sans shell (lanceur non reconnu).` }
  }
  const v = await execFile(launch.cmd, [...launch.prefix, '--version'], { timeoutMs: 15000, cwd: ensureWorkdir() })
  if (v.code !== 0) {
    const why = v.timedOut ? 'délai dépassé' : (stripAnsi(v.stderr || v.stdout).trim().split(/\r?\n/).pop() || `code ${v.code}`)
    return { ...base, found: false, path: launch.path, launch, reason: `Copilot CLI trouvé mais « --version » échoue : ${scrubSecrets(why).slice(0, 200)}` }
  }
  const version = stripAnsi(v.stdout).trim().split(/\r?\n/)[0].slice(0, 80)
  return { ...base, found: true, path: launch.path, launch, version, reason: `Version ${version || 'inconnue'} détectée.` }
}

/** Détection (mise en cache 5 min) ; `force` relance immédiatement. */
export function detect({ command = 'copilot', force = false } = {}) {
  const fresh = detection && detection.command === command && Date.now() - Date.parse(detection.checkedAt) < DETECT_TTL_MS
  if (fresh && !force) return Promise.resolve(detection)
  if (detecting) return detecting
  detecting = runDetection(command)
    .catch((e) => ({ command, found: false, checkedAt: new Date().toISOString(), reason: `Détection impossible : ${e.message}` }))
    .then((d) => {
      detection = d
      detecting = null
      return d
    })
  return detecting
}

export function detectionInfo() {
  if (!detection) return null
  const { launch, ...rest } = detection
  return { ...rest, viaNode: Boolean(launch?.prefix?.length) }
}

export function availability(cfg) {
  if (!cfg.enabled) return { available: false, reason: 'Désactivé dans les réglages.' }
  const fresh = detection && detection.command === cfg.command && Date.now() - Date.parse(detection.checkedAt) < DETECT_TTL_MS
  if (!fresh) detect({ command: cfg.command }).catch(() => {})
  if (!detection || detection.command !== cfg.command) return { available: false, reason: 'Détection de Copilot CLI en cours…' }
  if (!detection.found) return { available: false, reason: detection.reason }
  return { available: true, reason: detection.reason, model: cfg.model || 'modèle par défaut' }
}

function ensureWorkdir() {
  fs.mkdirSync(WORKDIR, { recursive: true })
  return WORKDIR
}

/** Arguments finaux : gabarit (« {prompt} », « {model} »), modèle facultatif, outils autorisés explicites. */
export function buildArgs(cfg, prompt) {
  // Un prompt commençant par « - » serait lu comme une option (--allow-all-tools…) : on le décale d'un espace.
  if (/^-/.test(prompt)) prompt = ` ${prompt}`
  const fill = (a) => a.split('{prompt}').join(prompt).split('{model}').join(cfg.model || '')
  const args = cfg.args.map(fill)
  if (cfg.model) args.push(...(cfg.modelArgs || []).map(fill))
  for (const tool of cfg.allowTools || []) args.push('--allow-tool', tool)
  return args
}

/** Retire les statistiques d'usage que la CLI affiche après la réponse. */
function cleanOutput(stdout) {
  const lines = stripAnsi(stdout).replace(/\r/g, '').split('\n')
  const cut = lines.findIndex((l) => /^\s*(Total usage|Usage by model|Total duration|Total code changes|Total session time)\b/i.test(l))
  return (cut >= 0 ? lines.slice(0, cut) : lines).join('\n').trim()
}

function failureReason(r) {
  const tail = scrubSecrets(stripAnsi(r.stderr || r.stdout)).trim().split(/\r?\n/).slice(-3).join(' ').slice(0, 300)
  if (/not (logged|authenticated)|\/login|authenticat|unauthori[sz]ed|401/i.test(tail)) {
    return new ProviderError('auth', 'Copilot CLI n\'est pas connecté à GitHub : lancez « copilot » dans un terminal puis la commande /login.')
  }
  if (/unknown option|unrecognized|invalid option/i.test(tail)) {
    return new ProviderError('bad_args', `Copilot CLI refuse les arguments configurés : ${tail}`)
  }
  return new ProviderError('exit', `Copilot CLI s'est arrêté avec le code ${r.code}${tail ? ` : ${tail}` : ''}`)
}

export async function run({ prompt, signal, timeoutMs }, cfg) {
  const d = await detect({ command: cfg.command })
  if (!d.found) throw new ProviderError('missing', d.reason)
  // Sous Windows, guillemets et barres obliques inverses sont échappés sur la ligne de commande : ils comptent double.
  const cost = prompt.length + (IS_WIN ? (prompt.match(/["\\]/g) || []).length : 0)
  if (cost > MAX_PROMPT_CHARS) {
    throw new ProviderError('prompt_too_long', `Prompt trop long pour la ligne de commande (${cost} caractères une fois échappé, ${MAX_PROMPT_CHARS} au plus).`)
  }
  const r = await execFile(d.launch.cmd, [...d.launch.prefix, ...buildArgs(cfg, prompt)], { timeoutMs, signal, cwd: ensureWorkdir() })
  if (signal?.aborted) throw signal.reason || new DOMException('Annulé', 'AbortError')
  if (r.timedOut) throw new ProviderError('timeout', `Copilot CLI n'a pas répondu dans le délai (${Math.round(timeoutMs / 1000)} s).`)
  if (r.code !== 0) throw failureReason(r)
  const text = cleanOutput(r.stdout)
  if (!text) throw new ProviderError('empty', 'Copilot CLI a renvoyé une réponse vide.')
  return { text, model: cfg.model || 'copilot-cli' }
}

import { spawnSync } from 'child_process'
import { platform } from 'os'

let cachedExecutable = null
let cacheChecked = false

function probe(cmd, args = ['-c', 'import sys; print(sys.executable)']) {
  try {
    const r = spawnSync(cmd, args, {
      encoding: 'utf8',
      timeout: 15000,
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    })
    const line = (r.stdout || '').trim().split(/\r?\n/).find((l) => l.trim())?.trim()
    if (r.status === 0 && line && !line.includes('Microsoft Store')) return line
  } catch { /* ignore */ }
  return null
}

/** Résout un interpréteur Python utilisable (spawn depuis l’extension VS Code). */
export function resolvePythonExecutable() {
  if (cacheChecked) return cachedExecutable
  cacheChecked = true

  if (process.env.WIZARD_PYTHON?.trim()) {
    cachedExecutable = process.env.WIZARD_PYTHON.trim()
    cachedCommandPrefix = []
    return cachedExecutable
  }

  const candidates = platform() === 'win32'
    ? [['py', ['-3']], ['py', []], ['python3', []], ['python', []]]
    : [['python3', []], ['python', []]]

  for (const [cmd, prefix] of candidates) {
    const exe = probe(cmd, [...prefix, '-c', 'import sys; print(sys.executable)'])
    if (exe) {
      cachedExecutable = cmd
      cachedCommandPrefix = prefix
      return cachedExecutable
    }
  }

  cachedExecutable = null
  return null
}

let cachedCommandPrefix = []

export function spawnPython(args, options = {}) {
  const cmd = resolvePythonExecutable()
  if (!cmd) {
    return { status: 127, stdout: '', stderr: 'Python introuvable (installez Python ou définissez WIZARD_PYTHON)' }
  }
  const prefix = cmd === process.env.WIZARD_PYTHON ? [] : cachedCommandPrefix
  return spawnSync(cmd, [...prefix, ...args], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    ...options,
  })
}

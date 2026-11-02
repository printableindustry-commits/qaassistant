import fs from 'fs'
import path from 'path'
import { spawnPython } from './python-runner.mjs'

const PLAIN_TEXT_SCRIPT = 'docx-plain-text.py'
const BACKUP_DIR = 'doc-qa-backups'

function scriptPath() {
  return path.join(DOC_QA_DIR, PLAIN_TEXT_SCRIPT)
}

function backupDirAbs() {
  return path.join(CONF_DIR, BACKUP_DIR)
}

function runPython(args) {
  const r = spawnPython(args)
  let result
  try {
    result = JSON.parse((r.stdout || '').trim() || '{}')
  } catch {
    result = { ok: false, error: r.stderr || r.stdout || 'Script Word échoué' }
  }
  if (r.status !== 0 || result.ok === false) {
    throw new Error(result.error || r.stderr || 'Script Word échoué (python-docx requis)')
  }
  return result
}

export function extractDocxPlainTextViaScript(absPath) {
  const script = scriptPath()
  if (!fs.existsSync(script)) return null
  const r = spawnPython([script, 'extract', '--docx', absPath, '--json-out'])
  try {
    const data = JSON.parse((r.stdout || '').trim() || '{}')
    if (r.status === 0 && data.ok && data.text != null) return data.text
  } catch { /* fallback */ }
  return null
}

export function syncDocxPlainText(absPath, content) {
  const script = scriptPath()
  if (!fs.existsSync(script)) {
    throw new Error(`Script Word introuvable : ${script}`)
  }
  fs.mkdirSync(CONF_DIR, { recursive: true })
  const tmpContent = path.join(CONF_DIR, `sync-word-${Date.now()}.txt`)
  fs.writeFileSync(tmpContent, content ?? '', 'utf8')
  try {
    return runPython([
      script,
      'sync',
      '--docx', absPath,
      '--content-file', tmpContent,
      '--backup-dir', backupDirAbs(),
      '--json-out',
    ])
  } finally {
    try { fs.unlinkSync(tmpContent) } catch { /* ignore */ }
  }
}

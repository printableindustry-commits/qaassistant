#!/usr/bin/env node
/**
 * Active les hooks Git versionnés (.githooks/) : chaque commit reconstruit l'appli web et l'extension.
 * Lancé par « npm run setup-hooks » et automatiquement par « npm install » (script prepare).
 */
import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

if (!fs.existsSync(path.join(ROOT, '.git'))) {
  console.log('[setup-hooks] pas de dépôt Git : rien à faire')
  process.exit(0)
}
try {
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: ROOT, stdio: 'inherit' })
  fs.chmodSync(path.join(ROOT, '.githooks', 'pre-commit'), 0o755)
  console.log('[setup-hooks] hooks Git actifs (.githooks/pre-commit : build web + extension à chaque commit)')
} catch (err) {
  console.error(`[setup-hooks] impossible d'activer les hooks : ${err.message}`)
  process.exit(0)
}

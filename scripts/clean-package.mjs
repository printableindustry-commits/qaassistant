#!/usr/bin/env node
/**
 * Nettoyage avant packaging VSIX — supprime artefacts temporaires et anciens VSIX.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const EXT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const TEMP_DIRS = ['_backup_compare', '_vsix_extract', 'wizard-qa-extract']
const TEMP_FILES = ['wizard-qa-temp.zip', 'nul']

function rmrf(abs) {
  if (!fs.existsSync(abs)) return
  fs.rmSync(abs, { recursive: true, force: true })
  console.log(`  supprimé : ${path.relative(EXT_ROOT, abs)}`)
}

console.log('clean:package — nettoyage extension Wizard QA…')

for (const dir of TEMP_DIRS) {
  rmrf(path.join(EXT_ROOT, dir))
}

for (const file of TEMP_FILES) {
  const abs = path.join(EXT_ROOT, file)
  if (fs.existsSync(abs)) {
    fs.unlinkSync(abs)
    console.log(`  supprimé : ${file}`)
  }
}

for (const entry of fs.readdirSync(EXT_ROOT)) {
  if (entry.endsWith('.vsix')) {
    const abs = path.join(EXT_ROOT, entry)
    fs.unlinkSync(abs)
    console.log(`  supprimé : ${entry}`)
  }
  if (entry.endsWith('.zip') && entry !== 'package-lock.json') {
    const abs = path.join(EXT_ROOT, entry)
    if (fs.statSync(abs).isFile()) {
      fs.unlinkSync(abs)
      console.log(`  supprimé : ${entry}`)
    }
  }
}

console.log('clean:package — terminé.')

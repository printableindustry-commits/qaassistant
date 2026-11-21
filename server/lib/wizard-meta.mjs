import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const SERVER_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const EXTENSION_DIR = path.dirname(SERVER_DIR)

export const WIZARD_FOOTER_LABEL = 'Wizard QA'

export function readExtensionVersion() {
  const fromEnv = String(process.env.WIZARD_EXTENSION_VERSION || '').trim()
  if (fromEnv) return fromEnv
  try {
    const pkgPath = path.join(EXTENSION_DIR, 'package.json')
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
    return String(pkg.version || '0.0.0').trim() || '0.0.0'
  } catch {
    return '0.0.0'
  }
}

/** Version lue à chaque appel (évite un serveur Node lancé avant mise à jour VSIX). */
export function getExtensionVersion() {
  return readExtensionVersion()
}

export const WIZARD_EXTENSION_VERSION = readExtensionVersion()

export function getWizardMeta() {
  return {
    version: getExtensionVersion(),
    footerLabel: WIZARD_FOOTER_LABEL,
    name: 'Wizard QA',
  }
}

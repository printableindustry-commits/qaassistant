import fs from 'fs'
import path from 'path'
import { CONF_DIR, REPO_ROOT } from './paths.mjs'

export const UI_WORDING_PREFERENCES_FILE = 'ui-wording.preferences.json'

/** Pop-ups réaffichés une fois à chaque nouvelle version de l'extension VSIX. */
export const POPUPS_RESET_ON_EXTENSION_VERSION = ['launchDisclaimer']

const USER_PREFERENCES_PATH = () => path.join(CONF_DIR, UI_WORDING_PREFERENCES_FILE)

export function getBuiltinUiWordingPreferences() {
  return {
    version: 1,
    description: 'Préférences des pop-ups Wizard QA — pop-ups masqués définitivement.',
    lastExtensionVersion: null,
    hiddenPopups: {},
  }
}

function normalizePreferences(raw = {}) {
  const builtin = getBuiltinUiWordingPreferences()
  const hiddenPopups = { ...(builtin.hiddenPopups || {}) }
  if (raw.hiddenPopups && typeof raw.hiddenPopups === 'object') {
    for (const [popupId, entry] of Object.entries(raw.hiddenPopups)) {
      if (!popupId || !entry) continue
      hiddenPopups[popupId] = {
        hidden: entry.hidden !== false,
        at: entry.at || null,
      }
    }
  }
  return {
    version: raw.version || builtin.version,
    description: raw.description || builtin.description,
    lastExtensionVersion: raw.lastExtensionVersion ?? builtin.lastExtensionVersion ?? null,
    hiddenPopups,
  }
}

export function ensureUiWordingPreferences() {
  const userPath = USER_PREFERENCES_PATH()
  if (!fs.existsSync(userPath)) {
    fs.mkdirSync(CONF_DIR, { recursive: true })
    fs.writeFileSync(
      userPath,
      `${JSON.stringify(getBuiltinUiWordingPreferences(), null, 2)}\n`,
      'utf8',
    )
  }
  return userPath
}

export function loadUiWordingPreferences() {
  const userPath = ensureUiWordingPreferences()
  const relativePath = path.relative(REPO_ROOT, userPath).replace(/\\/g, '/')
  let raw = getBuiltinUiWordingPreferences()
  try {
    raw = JSON.parse(fs.readFileSync(userPath, 'utf8'))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[wizard-qa] ${relativePath} invalide, préférences vides utilisées : ${msg}`)
  }
  const config = normalizePreferences(raw)
  return {
    ...config,
    path: userPath,
    relativePath,
  }
}

/**
 * Réactive launchDisclaimer (et pop-ups listés) quand la version VSIX change.
 * Permet de revoir le pop-up d'introduction après installation d'une nouvelle extension.
 */
export function maybeResetPopupsForNewExtensionVersion(extensionVersion) {
  const currentVer = String(extensionVersion || '').trim()
  const userPath = ensureUiWordingPreferences()
  let config = loadUiWordingPreferences()

  if (!currentVer || config.lastExtensionVersion === currentVer) {
    return config
  }

  const hiddenPopups = { ...config.hiddenPopups }
  for (const popupId of POPUPS_RESET_ON_EXTENSION_VERSION) {
    delete hiddenPopups[popupId]
  }

  const next = {
    version: config.version,
    description: config.description,
    lastExtensionVersion: currentVer,
    hiddenPopups,
  }
  fs.writeFileSync(userPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  return {
    ...next,
    path: userPath,
    relativePath: path.relative(REPO_ROOT, userPath).replace(/\\/g, '/'),
  }
}

export function hideUiWordingPopup(popupId) {
  const id = String(popupId || '').trim()
  if (!id) throw new Error('popupId requis')
  const userPath = ensureUiWordingPreferences()
  const config = loadUiWordingPreferences()
  const hiddenPopups = {
    ...config.hiddenPopups,
    [id]: { hidden: true, at: new Date().toISOString() },
  }
  const next = {
    version: config.version,
    description: config.description,
    lastExtensionVersion: config.lastExtensionVersion || null,
    hiddenPopups,
  }
  fs.writeFileSync(userPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  return {
    ...next,
    path: userPath,
    relativePath: path.relative(REPO_ROOT, userPath).replace(/\\/g, '/'),
  }
}

export function isUiWordingPopupHidden(popupId, config = loadUiWordingPreferences()) {
  const id = String(popupId || '').trim()
  if (!id) return false
  return Boolean(config.hiddenPopups?.[id]?.hidden)
}

export function getUiWordingPreferencesForApi(extensionVersion = '') {
  const config = maybeResetPopupsForNewExtensionVersion(extensionVersion)
  return {
    version: config.version,
    description: config.description,
    relativePath: config.relativePath,
    hiddenPopups: config.hiddenPopups,
    lastExtensionVersion: config.lastExtensionVersion || null,
  }
}

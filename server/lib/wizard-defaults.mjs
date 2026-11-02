import fs from 'fs'
import path from 'path'
import { CONF_DIR, SERVER_CONF_DIR } from './paths.mjs'

const DEFAULTS_PATH = path.join(CONF_DIR, 'wizard.defaults.json')
const EXAMPLE_PATH = path.join(SERVER_CONF_DIR, 'wizard.defaults.example.json')

export const WIZARD_VERSION = 1

export function emptyDefaults() {
  return {
    version: WIZARD_VERSION,
    updatedAt: null,
    project: null,
    npmrc: null,
    repair: { config: null, actions: null },
    hook: { simple: null, advanced: null },
    hookGit: { dryRunOk: false, lastDryRunAt: null, lastDryRunOutput: null },
    docQa: {
      questionnaireAnswers: {},
      questionnaireUpdatedAt: null,
      lastPromptAt: null,
      lastPromptPath: null,
      lastChapterPromptAt: null,
      chapterPrompts: {},
      documentScans: {},
      lastDocumentScanAt: null,
      chapterFills: {},
      lastChapterFillAt: null,
      livrablesTourHidden: false,
      livrablesTourHiddenAt: null,
    },
  }
}

function ensureConfDir() {
  fs.mkdirSync(CONF_DIR, { recursive: true })
}

export function loadWizardDefaults() {
  ensureConfDir()
  if (!fs.existsSync(DEFAULTS_PATH)) {
    if (fs.existsSync(EXAMPLE_PATH)) {
      try {
        return { ...emptyDefaults(), ...JSON.parse(fs.readFileSync(EXAMPLE_PATH, 'utf8')) }
      } catch { /* ignore */ }
    }
    return emptyDefaults()
  }
  try {
    const data = JSON.parse(fs.readFileSync(DEFAULTS_PATH, 'utf8'))
    return { ...emptyDefaults(), ...data }
  } catch {
    return emptyDefaults()
  }
}

export function saveWizardDefaults(data) {
  ensureConfDir()
  const merged = { ...loadWizardDefaults(), ...data, version: WIZARD_VERSION, updatedAt: new Date().toISOString() }
  fs.writeFileSync(DEFAULTS_PATH, `${JSON.stringify(merged, null, '\t')}\n`, 'utf8')
  return merged
}

export function savePageDefaults(page, pageData) {
  const all = loadWizardDefaults()
  if (page === 'npmrc') all.npmrc = pageData
  else if (page === 'repair') all.repair = { ...all.repair, ...pageData }
  else if (page === 'hook') all.hook = { ...all.hook, ...pageData }
  else if (page === 'docQa') all.docQa = { ...all.docQa, ...pageData }
  else if (page === 'project') all.project = { ...(all.project || {}), ...pageData }
  else throw new Error(`Page inconnue : ${page}`)
  return saveWizardDefaults(all)
}

export function getPageDefaults(page) {
  const all = loadWizardDefaults()
  if (page === 'npmrc') return all.npmrc
  if (page === 'repair') return all.repair
  if (page === 'hook') return all.hook
  if (page === 'docQa') return all.docQa
  if (page === 'project') return all.project
  return all
}

export function exportConfig({ includeSecrets = true } = {}) {
  const data = loadWizardDefaults()
  if (!includeSecrets) {
    return stripSecrets(JSON.parse(JSON.stringify(data)))
  }
  return data
}

function stripSecrets(data) {
  const copy = JSON.parse(JSON.stringify(data))
  if (copy.npmrc?.authToken) copy.npmrc.authToken = ''
  if (copy.hook?.simple?.env) {
    copy.hook.simple.env.JIRA_TOKEN = ''
    copy.hook.simple.env.XRAY_CLIENT_SECRET = ''
  }
  if (copy.hook?.advanced) {
    copy.hook.advanced.jiraToken = ''
    copy.hook.advanced.xrayClientSecret = ''
  }
  return copy
}

export function importConfig(imported, { merge = true } = {}) {
  if (!imported || typeof imported !== 'object') throw new Error('JSON invalide')
  if (merge) {
    const current = loadWizardDefaults()
    const merged = deepMerge(current, imported)
    merged.version = WIZARD_VERSION
    merged.updatedAt = new Date().toISOString()
    fs.writeFileSync(DEFAULTS_PATH, `${JSON.stringify(merged, null, '\t')}\n`, 'utf8')
    return merged
  }
  const clean = { ...emptyDefaults(), ...imported, version: WIZARD_VERSION, updatedAt: new Date().toISOString() }
  fs.writeFileSync(DEFAULTS_PATH, `${JSON.stringify(clean, null, '\t')}\n`, 'utf8')
  return clean
}

function deepMerge(target, source) {
  const out = { ...target }
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      out[key] = deepMerge(out[key] || {}, source[key])
    } else if (source[key] !== undefined && source[key] !== null) {
      out[key] = source[key]
    }
  }
  return out
}

export function getDefaultsPath() {
  return DEFAULTS_PATH
}

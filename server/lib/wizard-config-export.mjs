import fs from 'fs'
import path from 'path'
import { CONF_DIR, REPO_ROOT } from './paths.mjs'
import { exportConfig, importConfig, loadWizardDefaults } from './wizard-defaults.mjs'

const WIZARD_QA_DIR = path.join(REPO_ROOT, '.wizard-qa')
const DOC_QA_PROMPTS_DIR = path.join(WIZARD_QA_DIR, 'doc-qa-prompts')

/** Fichiers .wizard-qa/conf exportés avec le bundle (hors wizard.defaults.json, traité à part). */
export const WIZARD_CONF_EXPORT_FILES = [
  'project.variables.json',
  'onboarding.snapshot.json',
  'stack-questionnaire.conf.json',
  'ui-wording.conf.json',
  'ui-wording.preferences.json',
  'npm-install.conf.json',
  'cypress-install.conf.json',
  'playwright-install.conf.json',
  'robot-install.conf.json',
  'postman-init.conf.json',
  'postman-install.conf.json',
  'k6-init.conf.json',
  'k6-install.conf.json',
  'k6-perf-questionnaire.conf.json',
  'wizard.paths.json',
  'doc-qa-templates.conf.json',
]

/** Fichiers à la racine de .wizard-qa/ (hors conf/). */
export const WIZARD_QA_DATA_FILES = [
  'doc-qa-progress.json',
]

function readWizardQaDataFiles() {
  const out = {}
  for (const filename of WIZARD_QA_DATA_FILES) {
    const filePath = path.join(WIZARD_QA_DIR, filename)
    if (!fs.existsSync(filePath)) continue
    out[filename] = fs.readFileSync(filePath, 'utf8')
  }
  return out
}

function readDocQaPromptArchive() {
  const out = {}
  if (!fs.existsSync(DOC_QA_PROMPTS_DIR)) return out
  for (const name of fs.readdirSync(DOC_QA_PROMPTS_DIR)) {
    if (!name.endsWith('.md')) continue
    out[name] = fs.readFileSync(path.join(DOC_QA_PROMPTS_DIR, name), 'utf8')
  }
  return out
}

function writeWizardQaDataFiles(dataFiles = {}) {
  const written = []
  if (!dataFiles || typeof dataFiles !== 'object') return written
  fs.mkdirSync(WIZARD_QA_DIR, { recursive: true })
  for (const [filename, content] of Object.entries(dataFiles)) {
    if (!WIZARD_QA_DATA_FILES.includes(filename)) continue
    if (content == null || content === '') continue
    const filePath = path.join(WIZARD_QA_DIR, filename)
    const text = String(content).endsWith('\n') ? String(content) : `${String(content)}\n`
    fs.writeFileSync(filePath, text, 'utf8')
    written.push(`.wizard-qa/${filename}`)
  }
  return written
}

function writeDocQaPromptArchive(promptFiles = {}) {
  const written = []
  if (!promptFiles || typeof promptFiles !== 'object') return written
  fs.mkdirSync(DOC_QA_PROMPTS_DIR, { recursive: true })
  for (const [name, content] of Object.entries(promptFiles)) {
    // Nom de fichier simple uniquement : pas de chemin (../) ni de fichier caché.
    if (!/^[\w-][\w.-]*\.md$/.test(name) || content == null || content === '') continue
    const text = String(content).endsWith('\n') ? String(content) : `${String(content)}\n`
    fs.writeFileSync(path.join(DOC_QA_PROMPTS_DIR, name), text, 'utf8')
    written.push(`.wizard-qa/doc-qa-prompts/${name}`)
  }
  return written
}

function stripVariablesSecrets(rawText) {
  try {
    const data = JSON.parse(rawText)
    if (data.jiraToken) data.jiraToken = ''
    if (data.xrayClientSecret) data.xrayClientSecret = ''
    if (data.credentials && typeof data.credentials === 'object') {
      for (const key of Object.keys(data.credentials)) {
        if (/token|secret|password|auth/i.test(key)) data.credentials[key] = ''
      }
    }
    return `${JSON.stringify(data, null, 2)}\n`
  } catch {
    return rawText
  }
}

function readConfFileText(filename) {
  const filePath = path.join(CONF_DIR, filename)
  if (!fs.existsSync(filePath)) return null
  return fs.readFileSync(filePath, 'utf8')
}

function writeConfFileText(filename, content) {
  if (content == null || content === '') return false
  fs.mkdirSync(CONF_DIR, { recursive: true })
  const filePath = path.join(CONF_DIR, filename)
  const text = String(content).endsWith('\n') ? String(content) : `${String(content)}\n`
  fs.writeFileSync(filePath, text, 'utf8')
  return true
}

export function isWizardConfigBundle(data) {
  return Boolean(data && typeof data === 'object' && data.format === 'wizard-qa-bundle' && data.wizardDefaults)
}

export function exportFullWizardConfig({ includeSecrets = true } = {}) {
  const confFiles = {}
  for (const filename of WIZARD_CONF_EXPORT_FILES) {
    const raw = readConfFileText(filename)
    if (raw == null) continue
    if (!includeSecrets && filename === 'project.variables.json') {
      confFiles[filename] = stripVariablesSecrets(raw)
    } else {
      confFiles[filename] = raw
    }
  }

  return {
    format: 'wizard-qa-bundle',
    version: 3,
    exportedAt: new Date().toISOString(),
    confDir: '.wizard-qa/conf',
    wizardDefaults: exportConfig({ includeSecrets }),
    confFiles,
    docQaData: readWizardQaDataFiles(),
    docQaPrompts: readDocQaPromptArchive(),
  }
}

export function importFullWizardConfig(imported, { merge = true, includeConfFiles = true } = {}) {
  if (!imported || typeof imported !== 'object') throw new Error('JSON invalide')

  if (isWizardConfigBundle(imported)) {
    const saved = importConfig(imported.wizardDefaults, { merge })
    const written = []
    if (includeConfFiles && imported.confFiles && typeof imported.confFiles === 'object') {
      for (const [filename, content] of Object.entries(imported.confFiles)) {
        if (!WIZARD_CONF_EXPORT_FILES.includes(filename)) continue
        if (writeConfFileText(filename, content)) written.push(filename)
      }
    }
    if (imported.docQaData) written.push(...writeWizardQaDataFiles(imported.docQaData))
    if (imported.docQaPrompts) written.push(...writeDocQaPromptArchive(imported.docQaPrompts))
    return { saved, written, format: 'wizard-qa-bundle' }
  }

  const saved = importConfig(imported, { merge })
  return { saved, written: [], format: 'wizard-defaults-only' }
}

export function getWizardConfigExportSummary() {
  const present = ['wizard.defaults.json']
  for (const filename of WIZARD_CONF_EXPORT_FILES) {
    if (fs.existsSync(path.join(CONF_DIR, filename))) present.push(filename)
  }
  for (const filename of WIZARD_QA_DATA_FILES) {
    if (fs.existsSync(path.join(WIZARD_QA_DIR, filename))) present.push(`.wizard-qa/${filename}`)
  }
  if (fs.existsSync(DOC_QA_PROMPTS_DIR)) {
    const count = fs.readdirSync(DOC_QA_PROMPTS_DIR).filter((n) => n.endsWith('.md')).length
    if (count) present.push(`.wizard-qa/doc-qa-prompts/ (${count} fichier(s))`)
  }
  return {
    format: 'wizard-qa-bundle',
    bundleVersion: 3,
    fileCount: present.length,
    files: present,
    defaultsPath: path.relative(process.cwd(), path.join(CONF_DIR, 'wizard.defaults.json')).replace(/\\/g, '/'),
  }
}

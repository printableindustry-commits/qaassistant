import fs from 'fs'
import path from 'path'
import { CONF_DIR, REPO_ROOT, SERVER_CONF_DIR } from './paths.mjs'
import { parseStackQuestionnaireText } from './stack-questionnaire-jsonc.mjs'

export const NPM_INSTALL_FILE = 'npm-install.conf.json'
export const NPM_INSTALL_REFERENCE = 'npm-install.conf.reference.json'

const USER_CONFIG_PATH = () => path.join(CONF_DIR, NPM_INSTALL_FILE)
const REFERENCE_CONFIG_PATH = () => path.join(SERVER_CONF_DIR, NPM_INSTALL_REFERENCE)

export function getBuiltinNpmInstallConfig() {
  return {
    version: 1,
    description: 'Dépendances npm installées après génération du .npmrc — modifiez ce fichier pour ajuster les versions.',
    projectDir: '.',
    installCommand: 'install',
    preferCi: false,
    packages: [
      { name: '@cats-cdf/e2e', version: '^2.12.0', dev: false },
      { name: 'axios', version: '^1.7.7', dev: false },
      { name: 'cypress', version: '^14.0.3', dev: true },
      { name: 'cypress-axe', version: '^1.7.0', dev: true },
      { name: 'cypress-real-events', version: '^1.15.0', dev: true },
      { name: 'sharp', version: '^0.33.5', dev: true },
    ],
    steps: [
      { id: 'packageJson', label: 'Vérification du package.json' },
      { id: 'node', label: 'Vérification Node / Volta' },
      { id: 'npm', label: 'Vérification npm' },
      { id: 'npmrc', label: 'Vérification du .npmrc utilisateur' },
      { id: 'config', label: 'Lecture de npm-install.conf.json' },
      { id: 'install', label: 'Exécution npm install' },
      { id: 'verify', label: 'Contrôle node_modules' },
    ],
    runtime: {
      targetNodeVersion: '22.12.0',
      targetNpmVersion: '10.9.0',
      nodeMajorMin: 20,
      nodeMajorMax: 26,
      voltaHome: '%LOCALAPPDATA%\\Volta',
      voltaNodeInventoryRel: 'tools/inventory/node',
      voltaNodeImageRel: 'tools/image/node',
      nodeDistBaseUrl: 'https://nodejs.org/dist',
      packageJsonTemplateFile: 'package.json.cypress.template.json',
      voltaInstallShell: 'volta install node@{nodeVersion} & setx VOLTA_NODE_VERSION {nodeVersion} & volta install npm@bundle',
    },
  }
}

function normalizePackage(pkg) {
  if (!pkg?.name) return null
  return {
    name: String(pkg.name).trim(),
    version: String(pkg.version || 'latest').trim(),
    dev: Boolean(pkg.dev),
  }
}

export function normalizeNpmInstallConfig(raw = {}) {
  const builtin = getBuiltinNpmInstallConfig()
  const packages = (Array.isArray(raw.packages) ? raw.packages : builtin.packages)
    .map(normalizePackage)
    .filter(Boolean)
  const steps = (Array.isArray(raw.steps) && raw.steps.length ? raw.steps : builtin.steps)
    .map((s) => ({
      id: s.id || 'step',
      label: s.label || s.id || 'Étape',
    }))
  const runtimeRaw = { ...builtin.runtime, ...(raw.runtime || {}) }
  return {
    version: raw.version || builtin.version,
    description: raw.description || builtin.description,
    projectDir: raw.projectDir || builtin.projectDir,
    installCommand: raw.installCommand || builtin.installCommand,
    preferCi: raw.preferCi === true,
    packages: packages.length ? packages : builtin.packages,
    steps,
    runtime: {
      targetNodeVersion: String(runtimeRaw.targetNodeVersion || builtin.runtime.targetNodeVersion),
      targetNpmVersion: String(runtimeRaw.targetNpmVersion || builtin.runtime.targetNpmVersion),
      nodeMajorMin: Number(runtimeRaw.nodeMajorMin) || builtin.runtime.nodeMajorMin,
      nodeMajorMax: Number(runtimeRaw.nodeMajorMax) || builtin.runtime.nodeMajorMax,
      voltaHome: runtimeRaw.voltaHome || builtin.runtime.voltaHome,
      voltaNodeInventoryRel: runtimeRaw.voltaNodeInventoryRel || builtin.runtime.voltaNodeInventoryRel,
      voltaNodeImageRel: runtimeRaw.voltaNodeImageRel || builtin.runtime.voltaNodeImageRel,
      nodeDistBaseUrl: runtimeRaw.nodeDistBaseUrl || builtin.runtime.nodeDistBaseUrl,
      packageJsonTemplateFile: runtimeRaw.packageJsonTemplateFile || builtin.runtime.packageJsonTemplateFile,
      voltaInstallShell: runtimeRaw.voltaInstallShell || builtin.runtime.voltaInstallShell,
    },
  }
}

export function ensureNpmInstallConfig() {
  const userPath = USER_CONFIG_PATH()
  if (!fs.existsSync(userPath)) {
    fs.mkdirSync(CONF_DIR, { recursive: true })
    const referencePath = REFERENCE_CONFIG_PATH()
    if (fs.existsSync(referencePath)) {
      fs.copyFileSync(referencePath, userPath)
    } else {
      fs.writeFileSync(userPath, `${JSON.stringify(getBuiltinNpmInstallConfig(), null, 2)}\n`, 'utf8')
    }
  }
  return userPath
}

export function loadNpmInstallConfig() {
  const userPath = ensureNpmInstallConfig()
  const relativePath = path.relative(REPO_ROOT, userPath).replace(/\\/g, '/')
  let raw = getBuiltinNpmInstallConfig()
  try {
    raw = parseStackQuestionnaireText(fs.readFileSync(userPath, 'utf8'))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[wizard-qa] ${relativePath} invalide, config intégrée utilisée : ${msg}`)
  }
  const config = normalizeNpmInstallConfig(raw)
  return {
    ...config,
    path: userPath,
    relativePath,
    projectPath: path.resolve(REPO_ROOT, config.projectDir || '.'),
  }
}

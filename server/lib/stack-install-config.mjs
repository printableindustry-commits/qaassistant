import fs from 'fs'
import path from 'path'
import { CONF_DIR, REPO_ROOT, SERVER_CONF_DIR } from './paths.mjs'
import { parseStackQuestionnaireText } from './stack-questionnaire-jsonc.mjs'

export const CYPRESS_INSTALL_FILE = 'cypress-install.conf.json'
export const CYPRESS_INSTALL_REFERENCE = 'cypress-install.conf.reference.json'
export const PLAYWRIGHT_INSTALL_FILE = 'playwright-install.conf.json'
export const PLAYWRIGHT_INSTALL_REFERENCE = 'playwright-install.conf.reference.json'
export const ROBOT_INSTALL_FILE = 'robot-install.conf.json'
export const ROBOT_INSTALL_REFERENCE = 'robot-install.conf.reference.json'
export const POSTMAN_INIT_FILE = 'postman-init.conf.json'
export const POSTMAN_INIT_REFERENCE = 'postman-init.conf.reference.json'
export const POSTMAN_INSTALL_FILE = 'postman-install.conf.json'
export const POSTMAN_INSTALL_REFERENCE = 'postman-install.conf.reference.json'
export const K6_INIT_FILE = 'k6-init.conf.json'
export const K6_INIT_REFERENCE = 'k6-init.conf.reference.json'
export const K6_INSTALL_FILE = 'k6-install.conf.json'
export const K6_INSTALL_REFERENCE = 'k6-install.conf.reference.json'

const NPM_RUNNERS = ['npm', 'npx']
const PYTHON_RUNNERS = ['pip', 'python', 'robot']
const POSTMAN_RUNNERS = ['npm', 'npx', 'scaffold']
const K6_RUNNERS = ['npm', 'npx', 'scaffold', 'k6', 'shell']

function userPath(filename) {
  return path.join(CONF_DIR, filename)
}

function referencePath(filename) {
  return path.join(SERVER_CONF_DIR, filename)
}

function normalizeRunner(value, allowed = NPM_RUNNERS, fallback = 'npm') {
  const r = String(value || fallback).trim().toLowerCase()
  return allowed.includes(r) ? r : fallback
}

function normalizeArgs(args) {
  if (!Array.isArray(args)) return []
  return args.map((a) => String(a).trim()).filter(Boolean)
}

function normalizeStep(step, fallback, allowedRunners = NPM_RUNNERS, defaultRunner = 'npm') {
  const id = String(step?.id || fallback?.id || '').trim()
  if (!id) return null
  const args = normalizeArgs(step?.args)
  if (!args.length && fallback?.args) {
    args.push(...fallback.args)
  }
  const runner = normalizeRunner(step?.runner || fallback?.runner, allowedRunners, defaultRunner)
  const label = String(step?.label || fallback?.label || `${runner} ${args.join(' ')}`).trim()
  return { id, label, runner, args }
}

function normalizeSteps(rawSteps, builtinSteps, allowedRunners = NPM_RUNNERS, defaultRunner = 'npm') {
  const builtin = Array.isArray(builtinSteps) ? builtinSteps : []
  const raw = Array.isArray(rawSteps) ? rawSteps : []
  if (!raw.length) return builtin
  return raw
    .map((step, idx) => normalizeStep(
      step,
      builtin[idx] || builtin.find((b) => b.id === step?.id),
      allowedRunners,
      defaultRunner,
    ))
    .filter(Boolean)
}

export function getBuiltinCypressInstallConfig() {
  return {
    version: 1,
    description: 'Commandes exécutées par l’assistant Installer Cypress — modifiez .wizard-qa/conf/cypress-install.conf.json.',
    projectDir: '.',
    steps: [
      {
        id: 'e2e',
        label: 'npm install @cats-cdf/e2e',
        runner: 'npm',
        args: ['install', '@cats-cdf/e2e'],
      },
      {
        id: 'cypress',
        label: 'npm install -D cypress@14.0.3',
        runner: 'npm',
        args: ['install', '-D', 'cypress@14.0.3'],
      },
    ],
  }
}

export function getBuiltinPlaywrightInstallConfig() {
  return {
    version: 1,
    description: 'Commandes exécutées par l’assistant Installer Playwright — modifiez .wizard-qa/conf/playwright-install.conf.json.',
    projectDir: '.',
    vscodeExtensionId: 'ms-playwright.playwright',
    vscodeInstallCommand: 'ms-playwright.playwright.install',
    steps: [
      {
        id: 'package',
        label: 'npm install -D @playwright/test@latest',
        runner: 'npm',
        args: ['install', '-D', '@playwright/test@latest'],
      },
      {
        id: 'browsers',
        label: 'npx playwright install',
        runner: 'npx',
        args: ['playwright', 'install'],
      },
    ],
  }
}

function ensureConfig(userFilename, referenceFilename, builtin) {
  const dest = userPath(userFilename)
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(CONF_DIR, { recursive: true })
    const ref = referencePath(referenceFilename)
    if (fs.existsSync(ref)) {
      fs.copyFileSync(ref, dest)
    } else {
      fs.writeFileSync(dest, `${JSON.stringify(builtin, null, 2)}\n`, 'utf8')
    }
  }
  return dest
}

function loadConfig(userFilename, referenceFilename, builtin, normalize) {
  const filePath = ensureConfig(userFilename, referenceFilename, builtin)
  const relativePath = path.relative(REPO_ROOT, filePath).replace(/\\/g, '/')
  let raw = builtin
  try {
    raw = parseStackQuestionnaireText(fs.readFileSync(filePath, 'utf8'))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[wizard-qa] ${relativePath} invalide, config intégrée utilisée : ${msg}`)
  }
  const config = normalize(raw)
  return {
    ...config,
    path: filePath,
    relativePath,
    projectPath: path.resolve(REPO_ROOT, config.projectDir || '.'),
  }
}

export function normalizeCypressInstallConfig(raw = {}) {
  const builtin = getBuiltinCypressInstallConfig()
  return {
    version: raw.version || builtin.version,
    description: raw.description || builtin.description,
    projectDir: raw.projectDir || builtin.projectDir,
    steps: normalizeSteps(raw.steps, builtin.steps),
  }
}

export function normalizePlaywrightInstallConfig(raw = {}) {
  const builtin = getBuiltinPlaywrightInstallConfig()
  return {
    version: raw.version || builtin.version,
    description: raw.description || builtin.description,
    projectDir: raw.projectDir || builtin.projectDir,
    vscodeExtensionId: String(raw.vscodeExtensionId || builtin.vscodeExtensionId).trim(),
    vscodeInstallCommand: String(raw.vscodeInstallCommand || builtin.vscodeInstallCommand).trim(),
    steps: normalizeSteps(raw.steps, builtin.steps),
  }
}

export function loadCypressInstallConfig() {
  return loadConfig(
    CYPRESS_INSTALL_FILE,
    CYPRESS_INSTALL_REFERENCE,
    getBuiltinCypressInstallConfig(),
    normalizeCypressInstallConfig,
  )
}

export function loadPlaywrightInstallConfig() {
  return loadConfig(
    PLAYWRIGHT_INSTALL_FILE,
    PLAYWRIGHT_INSTALL_REFERENCE,
    getBuiltinPlaywrightInstallConfig(),
    normalizePlaywrightInstallConfig,
  )
}

export function getCypressStepMap(config = loadCypressInstallConfig()) {
  const map = Object.create(null)
  for (const step of config.steps) {
    map[step.id] = step
  }
  return map
}

export function getPlaywrightStepMap(config = loadPlaywrightInstallConfig()) {
  const map = Object.create(null)
  for (const step of config.steps) {
    map[step.id] = step
  }
  return map
}

export function getBuiltinRobotInstallConfig() {
  return {
    version: 1,
    description: 'Commandes exécutées par l’assistant Installer Robot Framework — modifiez .wizard-qa/conf/robot-install.conf.json.',
    projectDir: '.',
    pythonMinMajor: 3,
    verify: {
      id: 'verify',
      label: 'robot --version',
      runner: 'robot',
      args: ['--version'],
    },
    steps: [
      {
        id: 'pipUpgrade',
        label: 'python -m pip install --upgrade pip',
        runner: 'pip',
        args: ['install', '--upgrade', 'pip'],
      },
      {
        id: 'robotCore',
        label: 'pip install robotframework==7.1.1',
        runner: 'pip',
        args: ['install', 'robotframework==7.1.1'],
      },
      {
        id: 'seleniumLib',
        label: 'pip install robotframework-seleniumlibrary==6.6.1',
        runner: 'pip',
        args: ['install', 'robotframework-seleniumlibrary==6.6.1'],
      },
      {
        id: 'requestsLib',
        label: 'pip install robotframework-requests==0.9.7',
        runner: 'pip',
        args: ['install', 'robotframework-requests==0.9.7'],
      },
      {
        id: 'pyyaml',
        label: 'pip install PyYAML==6.0.2',
        runner: 'pip',
        args: ['install', 'PyYAML==6.0.2'],
      },
    ],
  }
}

export function normalizeRobotInstallConfig(raw = {}) {
  const builtin = getBuiltinRobotInstallConfig()
  const verify = normalizeStep(
    { ...(raw.verify || {}), id: raw.verify?.id || builtin.verify.id },
    builtin.verify,
    PYTHON_RUNNERS,
    'robot',
  )
  return {
    version: raw.version || builtin.version,
    description: raw.description || builtin.description,
    projectDir: raw.projectDir || builtin.projectDir,
    pythonMinMajor: Number(raw.pythonMinMajor || builtin.pythonMinMajor) || 3,
    verify,
    steps: normalizeSteps(raw.steps, builtin.steps, PYTHON_RUNNERS, 'pip'),
  }
}

export function loadRobotInstallConfig() {
  return loadConfig(
    ROBOT_INSTALL_FILE,
    ROBOT_INSTALL_REFERENCE,
    getBuiltinRobotInstallConfig(),
    normalizeRobotInstallConfig,
  )
}

export function getRobotStepMap(config = loadRobotInstallConfig()) {
  const map = Object.create(null)
  for (const step of config.steps) {
    map[step.id] = step
  }
  if (config.verify?.id) {
    map[config.verify.id] = config.verify
  }
  return map
}

export function getBuiltinPostmanInitConfig() {
  return {
    version: 1,
    description: 'Paramètres de génération Postman — modifiez .wizard-qa/conf/postman-init.conf.json.',
    projectName: 'MonProjet-API',
    baseUrl: 'https://api-recette.example.com',
    environmentLabel: 'recette',
    postmanDir: 'postman',
  }
}

export function normalizePostmanInitConfig(raw = {}) {
  const builtin = getBuiltinPostmanInitConfig()
  return {
    version: raw.version || builtin.version,
    description: raw.description || builtin.description,
    projectName: String(raw.projectName || builtin.projectName).trim() || builtin.projectName,
    baseUrl: String(raw.baseUrl || builtin.baseUrl).trim() || builtin.baseUrl,
    environmentLabel: String(raw.environmentLabel || builtin.environmentLabel).trim() || builtin.environmentLabel,
    postmanDir: String(raw.postmanDir || builtin.postmanDir).trim() || builtin.postmanDir,
  }
}

export function loadPostmanInitConfig() {
  return loadConfig(
    POSTMAN_INIT_FILE,
    POSTMAN_INIT_REFERENCE,
    getBuiltinPostmanInitConfig(),
    normalizePostmanInitConfig,
  )
}

export function getBuiltinPostmanInstallConfig() {
  return {
    version: 1,
    description: 'Scaffold Postman et installation Newman — modifiez .wizard-qa/conf/postman-install.conf.json.',
    projectDir: '.',
    verify: {
      id: 'verify',
      label: 'npx newman --version',
      runner: 'npx',
      args: ['newman', '--version'],
    },
    steps: [
      {
        id: 'scaffold',
        label: 'Création arborescence postman/ et fichiers modèles',
        runner: 'scaffold',
        args: [],
      },
      {
        id: 'newman',
        label: 'npm install -D newman@latest',
        runner: 'npm',
        args: ['install', '-D', 'newman@latest'],
      },
      {
        id: 'htmlextra',
        label: 'npm install -D newman-reporter-htmlextra@latest',
        runner: 'npm',
        args: ['install', '-D', 'newman-reporter-htmlextra@latest'],
      },
    ],
  }
}

export function normalizePostmanInstallConfig(raw = {}) {
  const builtin = getBuiltinPostmanInstallConfig()
  const verify = normalizeStep(
    { ...(raw.verify || {}), id: raw.verify?.id || builtin.verify.id },
    builtin.verify,
    POSTMAN_RUNNERS,
    'npx',
  )
  return {
    version: raw.version || builtin.version,
    description: raw.description || builtin.description,
    projectDir: raw.projectDir || builtin.projectDir,
    verify,
    steps: normalizeSteps(raw.steps, builtin.steps, POSTMAN_RUNNERS, 'npm'),
  }
}

export function loadPostmanInstallConfig() {
  return loadConfig(
    POSTMAN_INSTALL_FILE,
    POSTMAN_INSTALL_REFERENCE,
    getBuiltinPostmanInstallConfig(),
    normalizePostmanInstallConfig,
  )
}

export function getPostmanStepMap(config = loadPostmanInstallConfig()) {
  const map = Object.create(null)
  for (const step of config.steps) {
    map[step.id] = step
  }
  if (config.verify?.id) {
    map[config.verify.id] = config.verify
  }
  return map
}

export function getBuiltinK6InitConfig() {
  return {
    version: 1,
    description: 'Paramètres de génération k6 — modifiez .wizard-qa/conf/k6-init.conf.json.',
    projectName: 'MonProjet-perf',
    baseUrl: 'https://app-recette.example.com',
    k6Dir: 'k6',
    defaultVus: 5,
    defaultDuration: '30s',
    p95ThresholdMs: 500,
  }
}

export function normalizeK6InitConfig(raw = {}) {
  const builtin = getBuiltinK6InitConfig()
  return {
    version: raw.version || builtin.version,
    description: raw.description || builtin.description,
    projectName: String(raw.projectName || builtin.projectName).trim() || builtin.projectName,
    baseUrl: String(raw.baseUrl || builtin.baseUrl).trim() || builtin.baseUrl,
    k6Dir: String(raw.k6Dir || builtin.k6Dir).trim() || builtin.k6Dir,
    defaultVus: Number(raw.defaultVus) || builtin.defaultVus,
    defaultDuration: String(raw.defaultDuration || builtin.defaultDuration).trim() || builtin.defaultDuration,
    p95ThresholdMs: Number(raw.p95ThresholdMs) || builtin.p95ThresholdMs,
  }
}

export function loadK6InitConfig() {
  return loadConfig(
    K6_INIT_FILE,
    K6_INIT_REFERENCE,
    getBuiltinK6InitConfig(),
    normalizeK6InitConfig,
  )
}

export function getBuiltinK6InstallConfig() {
  return {
    version: 1,
    description: 'Scaffold k6 et installation — modifiez .wizard-qa/conf/k6-install.conf.json.',
    projectDir: '.',
    verify: {
      id: 'verify',
      label: 'k6 version',
      runner: 'k6',
      args: ['version'],
    },
    steps: [
      {
        id: 'scaffold',
        label: 'Création arborescence k6/ et script smoke',
        runner: 'scaffold',
        args: [],
      },
      {
        id: 'types',
        label: 'npm install -D @types/k6',
        runner: 'npm',
        args: ['install', '-D', '@types/k6'],
      },
      {
        id: 'winget',
        label: 'Installation du binaire k6 (winget, repli choco)',
        runner: 'shell',
        args: ['winget', 'install', '-e', '--id', 'GrafanaLabs.k6', '--accept-package-agreements', '--accept-source-agreements'],
      },
    ],
  }
}

export function normalizeK6InstallConfig(raw = {}) {
  const builtin = getBuiltinK6InstallConfig()
  const verify = normalizeStep(
    { ...(raw.verify || {}), id: raw.verify?.id || builtin.verify.id },
    builtin.verify,
    K6_RUNNERS,
    'k6',
  )
  return {
    version: raw.version || builtin.version,
    description: raw.description || builtin.description,
    projectDir: raw.projectDir || builtin.projectDir,
    verify,
    steps: normalizeSteps(raw.steps, builtin.steps, K6_RUNNERS, 'npm'),
  }
}

export function loadK6InstallConfig() {
  return loadConfig(
    K6_INSTALL_FILE,
    K6_INSTALL_REFERENCE,
    getBuiltinK6InstallConfig(),
    normalizeK6InstallConfig,
  )
}

export function getK6StepMap(config = loadK6InstallConfig()) {
  const map = Object.create(null)
  for (const step of config.steps) {
    map[step.id] = step
  }
  if (config.verify?.id) {
    map[config.verify.id] = config.verify
  }
  return map
}

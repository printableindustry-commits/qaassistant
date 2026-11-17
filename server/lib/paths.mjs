import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const SERVER_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const EXTENSION_DIR = path.dirname(SERVER_DIR)
const SCRIPTS_IMPL = path.dirname(EXTENSION_DIR)
const SERVER_CONF_DIR = path.join(SERVER_DIR, 'conf')
const PATHS_EXAMPLE = path.join(SERVER_CONF_DIR, 'wizard.paths.example.json')

const DEFAULT_PATHS = {
  scriptsDir: '00_Scripts_Implementation',
  repairDir: '00_Scripts_Implementation/01_reparation-poste-travail',
  docQaDir: '00_Scripts_Implementation/02_documentation-qa',
  hookDir: '0_Hook_Synchro_Ticket_Test_JIRA',
  docReportsDir: '2_Documentation/doc-reports',
  livrablesDir: '2_Documentation/Livrables',
  livrablesOverridesDir: '2_Documentation/Livrables/overrides',
  templateDir: '2_Documentation/Livrables/modele_livrable_CA-TS',
  localConfDir: '.wizard-qa/conf',
  repairConfFile: 'repair.conf.json',
  hooksConfFile: 'hooks.conf',
  npmrcDisplay: '%USERPROFILE%\\.npmrc',
  docInventoryFile: 'doc-inventory.json',
  docGapsFile: 'doc-gaps.md',
  snapshotJsonFile: 'project-qa-snapshot.json',
  snapshotMdFile: 'project-qa-snapshot.md',
  promptMdFile: 'PROMPT_MAJ_LIVRABLES_QA.md',
  scanConfigFile: 'doc-qa-scan.conf.json',
  scanProjectScript: 'scan-project.mjs',
  vendorNodeRel: 'vendor/node/node.exe',
  legacyDefaultsFile: '00_Scripts_Implementation/00_portail-poste-travail/conf/wizard.defaults.json',
}

function findRepoRoot() {
  if (process.env.WIZARD_REPO_ROOT) {
    return path.resolve(process.env.WIZARD_REPO_ROOT)
  }
  // Application web autonome (pas rangée sous 00_Scripts_Implementation d'un dépôt client) :
  // le projet de test vit dans ./workspace, jamais dans le dossier de l'application.
  if (path.basename(SCRIPTS_IMPL) !== '00_Scripts_Implementation') {
    const workspace = path.join(EXTENSION_DIR, 'workspace')
    fs.mkdirSync(workspace, { recursive: true })
    return workspace
  }
  let cur = SCRIPTS_IMPL
  for (let i = 0; i < 4; i++) {
    if (fs.existsSync(path.join(cur, 'package.json'))) {
      return cur
    }
    const parent = path.dirname(cur)
    if (parent === cur) break
    cur = parent
  }
  return path.dirname(SCRIPTS_IMPL)
}

export const REPO_ROOT = findRepoRoot()
export { SERVER_DIR, SERVER_CONF_DIR }

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return {}
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return {}
  }
}

function envPath(key, fallbackRel) {
  const v = process.env[key]
  if (v && String(v).trim()) return path.resolve(v)
  return path.join(REPO_ROOT, fallbackRel)
}

export function loadPathConfig() {
  const confDir = process.env.WIZARD_CONF_DIR
    ? path.resolve(process.env.WIZARD_CONF_DIR)
    : path.join(REPO_ROOT, DEFAULT_PATHS.localConfDir)

  const merged = {
    ...DEFAULT_PATHS,
    ...readJsonIfExists(PATHS_EXAMPLE),
    ...readJsonIfExists(path.join(confDir, 'wizard.paths.json')),
    ...readJsonIfExists(path.join(SERVER_CONF_DIR, 'wizard.paths.json')),
  }

  const docScanConf = readJsonIfExists(path.join(REPO_ROOT, merged.docQaDir, merged.scanConfigFile))
  if (docScanConf.livrablesDir) merged.livrablesDir = docScanConf.livrablesDir
  if (docScanConf.outputDir) merged.docReportsDir = docScanConf.outputDir
  if (docScanConf.templateDocx) {
    merged.templateDir = path.dirname(docScanConf.templateDocx).replace(/\\/g, '/')
  }
  if (docScanConf.hooksConf) merged.hookDir = path.dirname(docScanConf.hooksConf).replace(/\\/g, '/')

  return merged
}

export const PATH_CFG = loadPathConfig()

export const CONF_DIR = process.env.WIZARD_CONF_DIR
  ? path.resolve(process.env.WIZARD_CONF_DIR)
  : path.join(REPO_ROOT, PATH_CFG.localConfDir)

export const SCRIPTS_DIR = envPath('WIZARD_SCRIPTS_DIR', PATH_CFG.scriptsDir)
export const REPAIR_DIR = envPath('WIZARD_REPAIR_DIR', PATH_CFG.repairDir)
export const DOC_QA_DIR = envPath('WIZARD_DOC_QA_DIR', PATH_CFG.docQaDir)
export const HOOK_DIR = envPath('WIZARD_HOOK_DIR', PATH_CFG.hookDir)

export function repoPath(relSegment) {
  if (!relSegment) return REPO_ROOT
  if (path.isAbsolute(relSegment)) return relSegment
  return path.join(REPO_ROOT, relSegment.replace(/\//g, path.sep))
}

export function relPath(...segments) {
  return path.join(...segments).replace(/\\/g, '/')
}

export const DOC_REPORTS_DIR = repoPath(PATH_CFG.docReportsDir)
export const LIVRABLES_DIR = repoPath(PATH_CFG.livrablesDir)
export const LIVRABLES_OVERRIDES_DIR = repoPath(PATH_CFG.livrablesOverridesDir)
export const TEMPLATE_DIR = repoPath(PATH_CFG.templateDir)

export function getPathsForApi() {
  const rel = (abs) => path.relative(REPO_ROOT, abs).replace(/\\/g, '/')
  return {
    repoRoot: REPO_ROOT,
    scriptsDir: rel(SCRIPTS_DIR),
    repairDir: rel(REPAIR_DIR),
    docQaDir: rel(DOC_QA_DIR),
    hookDir: rel(HOOK_DIR),
    docReportsDir: PATH_CFG.docReportsDir,
    livrablesDir: PATH_CFG.livrablesDir,
    livrablesOverridesDir: PATH_CFG.livrablesOverridesDir,
    templateDir: PATH_CFG.templateDir,
    localConfDir: PATH_CFG.localConfDir,
    repairConfPath: rel(path.join(REPAIR_DIR, PATH_CFG.repairConfFile)),
    hooksConfPath: rel(path.join(HOOK_DIR, PATH_CFG.hooksConfFile)),
    npmrcDisplay: PATH_CFG.npmrcDisplay,
    vendorNodePath: rel(path.join(REPAIR_DIR, PATH_CFG.vendorNodeRel)),
  }
}

export function applyPathPlaceholders(html) {
  const p = getPathsForApi()
  return html.replace(/\{\{paths\.(\w+)\}\}/g, (_, key) => p[key] ?? '')
}

export function promptMdAbsPath() {
  return path.join(TEMPLATE_DIR, PATH_CFG.promptMdFile)
}

export function docReportRel(fileName) {
  return relPath(PATH_CFG.docReportsDir, fileName)
}

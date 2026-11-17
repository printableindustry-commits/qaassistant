import fs from 'fs'
import { spawnSync } from 'child_process'
import path from 'path'
import { readNpmrc } from './npmrc.mjs'
import { loadRepairConfig } from './repair-api.mjs'
import { checkProjectPackage, getVendorStatus } from './vendor-upload.mjs'
import { loadHookConfig } from './hook-config.mjs'
import { getHookInstallStatus } from './install-hook.mjs'
import { DOC_REPORTS_DIR, DOC_QA_DIR, HOOK_DIR, PATH_CFG, REPAIR_DIR } from './paths.mjs'
import { getPageDefaults } from './wizard-defaults.mjs'
import { getProjectProfile } from './project-profile.mjs'

export function verifyPage(page, body = {}) {
  if (page === 'npmrc') return verifyNpmrc(body.fields)
  if (page === 'repair') return verifyRepair(body.config || loadRepairConfig())
  if (page === 'hook') return verifyHook()
  if (page === 'docQa') return verifyDocQa()
  throw new Error(`Page inconnue : ${page}`)
}

function verifyNpmrc(fields) {
  const disk = readNpmrc()
  const f = fields || disk.fields
  const checks = []
  const add = (name, ok, msg, optional = false) => checks.push({ name, ok, message: msg, optional })

  add('Fichier .npmrc', disk.exists, disk.exists ? 'Présent sur le profil' : 'Absent — enregistrez la configuration')
  add('Registry', !!f.registry, f.registry || 'Registry vide')
  add('Token auth', !!f.authToken, f.authToken ? 'Token renseigné' : 'Token manquant')
  add('Email', !!f.email, f.email || 'Email recommandé pour npm')

  if (f.registry) {
    const ping = tryNpmPing(f.registry)
    add('Accès registry (npm ping)', ping, ping ? 'Registry joignable' : 'Offline ou proxy requis — normal sur poste CATS', true)
  }

  const required = checks.filter(c => !c.optional)
  return { ok: required.every(c => c.ok), checks }
}

function tryNpmPing(registry) {
  // shell:true (npm.cmd sous Windows) : on refuse tout registre contenant des caractères de shell.
  if (!/^https?:\/\/[\w.:@/~+-]+$/.test(String(registry || ''))) return false
  try {
    const r = spawnSync('npm', ['ping', '--registry', registry], {
      encoding: 'utf8',
      timeout: 15000,
      shell: true,
      env: { ...process.env, npm_config_registry: registry },
    })
    return r.status === 0
  } catch {
    return false
  }
}

function verifyRepair(cfg) {
  const checks = []
  const add = (name, ok, msg, optional = false) => checks.push({ name, ok, message: msg, optional })

  const projectOk = !!(cfg.project && fs.existsSync(cfg.project))
  add('Chemin projet', projectOk, cfg.project
    ? (projectOk ? cfg.project : `Introuvable : ${cfg.project}`)
    : 'Non renseigné')

  const vendor = getVendorStatus(cfg.versions)
  add('Node portable', vendor.node.ok, vendor.node.ok ? 'vendor/node OK' : 'Absent — charger ZIP Node')
  add('npm portable', vendor.npm.ok, vendor.npm.ok ? `npm ${vendor.npm.version || 'OK'}` : 'Absent — inclus dans ZIP Node', true)
  add('Cypress offline', vendor.cypress.ok, vendor.cypress.ok ? 'ZIP Cypress présent' : 'Absent — charger ZIP Cypress', true)
  add('node_modules.tgz', vendor.nodeModules.ok,
    vendor.nodeModules.ok ? `${vendor.nodeModules.sizeMb} Mo` : 'Absent (npm en ligne requis)', true)

  const pkg = checkProjectPackage(cfg.project)
  add('package.json', pkg.packageJson.exists && pkg.packageJson.valid,
    pkg.packageJson.valid ? (pkg.packageJson.voltaNode ? `OK — volta.node ${pkg.packageJson.voltaNode}` : 'OK')
      : (pkg.packageJson.error || 'Absent'))
  add('package-lock.json', true,
    pkg.packageLock.exists ? 'Présent (npm ci)' : 'Absent (npm install)', true)

  add('Version Node', !!cfg.versions?.node, cfg.versions?.node || '?')

  const required = checks.filter(c => !c.optional)
  return { ok: required.every(c => c.ok), checks }
}

export function verifyHook() {
  const checks = []
  const add = (name, ok, msg, optional = false) => checks.push({ name, ok, message: msg, optional })

  const install = getHookInstallStatus(HOOK_DIR)
  add('Dépôt git', !!install.repoRoot, install.repoRoot || 'Pas un dépôt git')
  add('Hook post-commit', install.valid, install.valid ? 'Installé et valide' : install.installed ? 'Présent — réinstaller' : 'Non installé')

  const cfg = loadHookConfig(HOOK_DIR)
  add('hooks.conf', cfg.confExists, cfg.confExists ? 'OK' : 'Manquant')
  add('Fichier .env', cfg.envExists, cfg.envExists ? 'OK' : 'Manquant')
  add('JIRA_TOKEN', !!cfg.env?.JIRA_TOKEN, cfg.env?.JIRA_TOKEN ? 'Renseigné' : 'Manquant', true)
  add('XRAY credentials', !!(cfg.env?.XRAY_CLIENT_ID && cfg.env?.XRAY_CLIENT_SECRET), 'Client ID + secret', true)

  const required = checks.filter(c => !c.optional)
  return { ok: required.every(c => c.ok), checks }
}

function verifyDocQa() {
  const checks = []
  const add = (name, ok, msg, optional = false) => checks.push({ name, ok, message: msg, optional })

  const project = getProjectProfile()
  add('Prise de connaissance', project.onboardingComplete, project.onboardingComplete ? 'Terminée' : 'Complétez l\'accueil')

  const templates = path.join(DOC_QA_DIR, 'doc-qa-templates.conf.json')
  add('Catalogue templates', fs.existsSync(templates), fs.existsSync(templates) ? 'doc-qa-templates.conf.json' : 'Générer via 02_documentation-qa')

  const docQa = getPageDefaults('docQa') || {}
  const chapterCount = Object.keys(docQa.chapterPrompts || {}).length
  add('Prompts thématiques', chapterCount > 0, chapterCount > 0 ? `${chapterCount} prompt(s) généré(s)` : 'Générez au moins un prompt par thématique', true)

  const required = checks.filter((c) => !c.optional)
  return { ok: required.every((c) => c.ok), checks }
}

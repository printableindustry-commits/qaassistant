import fs from 'fs'
import path from 'path'
import { readNpmrc } from './npmrc.mjs'
import { checkNpmRuntime } from './npm-runtime-api.mjs'
import { loadRepairConfig } from './repair-api.mjs'
import { loadHookConfig } from './hook-config.mjs'
import { getHookInstallStatus } from './install-hook.mjs'
import { loadWizardDefaults } from './wizard-defaults.mjs'
import {
  DOC_REPORTS_DIR,
  HOOK_DIR,
  PATH_CFG,
  REPAIR_DIR,
  REPO_ROOT,
} from './paths.mjs'

const DOC_GAPS = path.join(DOC_REPORTS_DIR, PATH_CFG.docGapsFile)
const DOC_INV = path.join(DOC_REPORTS_DIR, PATH_CFG.docInventoryFile)

function statOk(p) {
  try { return fs.existsSync(p) } catch { return false }
}

function mtime(p) {
  try { return fs.statSync(p).mtime.toISOString() } catch { return null }
}

export function getDashboard() {
  const npmrc = readNpmrc()
  const repair = loadRepairConfig()
  const hookCfg = loadHookConfig(HOOK_DIR)
  const hookInstall = getHookInstallStatus(HOOK_DIR)
  const vendorNode = path.join(REPAIR_DIR, 'vendor/node/node.exe')
  const vendorModules = path.join(REPAIR_DIR, 'vendor/node_modules.tgz')
  const wizard = loadWizardDefaults()

  const npmrcOk = npmrc.exists && npmrc.fields.registry && npmrc.fields.authToken
  const npmrcWarn = npmrc.exists && (!npmrc.fields.authToken || !npmrc.fields.email)

  const runtime = checkNpmRuntime()
  const packageJsonOk = runtime.packageJsonExists
  const nodeRuntimeOk = runtime.nodePresent
    && (runtime.nodeInVoltaImage || runtime.nodeInVoltaInventory)
  const npmRuntimeOk = runtime.npmPresent

  const projectPath = repair.project || ''
  const projectOk = projectPath && statOk(projectPath)

  const steps = [
    {
      id: 'npmrc',
      order: 1,
      label: 'Configuration npm (.npmrc)',
      href: '/npmrc.html',
      status: npmrcOk ? 'ok' : npmrcWarn ? 'warn' : npmrc.exists ? 'warn' : 'ko',
      message: npmrcOk
        ? 'Registry et token présents'
        : npmrc.exists
          ? 'Fichier présent — token ou email manquant'
          : 'Fichier .npmrc absent',
    },
    {
      id: 'nodeInstall',
      order: 2,
      label: 'Installation Node.js',
      href: '/node-install.html',
      status: nodeRuntimeOk && packageJsonOk ? 'ok' : nodeRuntimeOk || packageJsonOk ? 'warn' : npmrcOk ? 'pending' : 'ko',
      message: nodeRuntimeOk && packageJsonOk
        ? `Node ${runtime.nodeVersion || '—'} · package.json présent`
        : packageJsonOk
          ? 'package.json OK — installer Node via Volta'
          : nodeRuntimeOk
            ? 'Node OK — enregistrer package.json'
            : npmrcOk
              ? 'Node et package.json à configurer'
              : 'Générer le .npmrc d\'abord',
    },
    {
      id: 'npmInstall',
      order: 3,
      label: 'Installation npm (dépendances)',
      href: '/npm-install.html',
      status: npmRuntimeOk && nodeRuntimeOk && packageJsonOk && npmrcOk ? 'ok' : 'pending',
      message: npmRuntimeOk
        ? `npm ${runtime.npmVersion || '—'} — lancer npm install si besoin`
        : 'Installer les paquets npm du projet',
    },
    {
      id: 'repair',
      order: 4,
      label: 'Environnement Node / Cypress',
      href: '/repair.html',
      status: statOk(vendorNode) && projectOk ? 'ok' : statOk(vendorNode) || projectOk ? 'warn' : 'ko',
      message: statOk(vendorNode)
        ? (projectOk ? 'Vendor portable + projet configuré' : 'Vendor OK — vérifier chemin projet')
        : 'Vendor/node absent — lancer téléchargement ou réparation',
    },
    {
      id: 'hook',
      order: 5,
      label: 'Hook JIRA / Xray',
      href: '/hook-git.html',
      status: hookInstall.valid && hookCfg.env?.JIRA_TOKEN ? 'ok'
        : hookInstall.valid ? 'warn'
          : hookInstall.installed ? 'warn' : 'ko',
      message: hookInstall.valid
        ? 'Hook installé'
        : hookInstall.installed
          ? 'Hook présent — réinstallation recommandée'
          : 'Hook post-commit non installé',
    },
    {
      id: 'doc',
      order: 6,
      label: 'Livrables QA (optionnel)',
      href: '/doc-qa.html',
      status: statOk(DOC_GAPS) && statOk(DOC_INV) ? 'ok' : statOk(DOC_INV) ? 'warn' : 'pending',
      message: statOk(DOC_GAPS)
        ? `Rapport à jour (${mtime(DOC_GAPS)?.slice(0, 10) || '?'})`
        : statOk(DOC_INV)
          ? 'Inventaire seul — générer le rapport d\'écarts'
          : 'Non généré',
    },
  ]

  const wizardUpdated = wizard.updatedAt || null
  const npmrcWizardDiff = hasNpmrcWizardDiff(wizard, npmrc.fields)

  return {
    steps,
    wizardUpdated,
    npmrcWizardDiff,
    paths: {
      npmrc: npmrc.displayPath,
      vendorNode: statOk(vendorNode),
      vendorModules: statOk(vendorModules),
      docGaps: DOC_GAPS,
      docInventory: DOC_INV,
    },
  }
}

function hasNpmrcWizardDiff(wizard, diskFields) {
  if (!wizard.npmrc) return false
  const keys = ['email', 'registry', 'authToken', 'SASS_BINARY_SITE']
  return keys.some(k => {
    const w = wizard.npmrc[k] ?? wizard.npmrc[k === 'authToken' ? 'authToken' : k]
    const d = diskFields[k] ?? diskFields[k === 'authToken' ? 'authToken' : k]
    return String(w || '').trim() !== String(d || '').trim()
  })
}

export function getNpmrcDiff() {
  const wizard = loadWizardDefaults()
  const disk = readNpmrc()
  if (!wizard.npmrc) return { hasDiff: false, wizard: null, disk: disk.fields }
  const keys = ['email', 'registry', 'authToken', 'always-auth', 'SASS_BINARY_SITE', 'strict-ssl', 'proxy', 'https-proxy', 'noproxy']
  const diff = []
  for (const k of keys) {
    const w = String(wizard.npmrc[k] ?? '').trim()
    const d = String(disk.fields[k] ?? '').trim()
    if (w !== d) diff.push({ key: k, wizard: k === 'authToken' ? mask(w) : w, disk: k === 'authToken' ? mask(d) : d })
  }
  return { hasDiff: diff.length > 0, diff, diskExists: disk.exists }
}

function mask(s) {
  if (!s) return '(vide)'
  if (s.length <= 4) return '****'
  return `${s.slice(0, 2)}…${s.slice(-2)} (${s.length} car.)`
}

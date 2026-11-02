import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import { REPO_ROOT, REPAIR_DIR } from './paths.mjs'
const CONF_PATH = path.join(REPAIR_DIR, 'repair.conf.json')
const VERSIONS_PATH = path.join(REPAIR_DIR, 'versions.json')

export function loadRepairConfig() {
  if (fs.existsSync(CONF_PATH)) {
    return JSON.parse(fs.readFileSync(CONF_PATH, 'utf8'))
  }
  if (fs.existsSync(VERSIONS_PATH)) {
    const v = JSON.parse(fs.readFileSync(VERSIONS_PATH, 'utf8'))
    return {
      project: v.defaultProject || REPO_ROOT,
      voltaHome: v.defaultVoltaHome || '',
      versions: { node: v.node, npm: v.npm, cypress: v.cypress },
      catsRegistry: v.catsRegistry,
      proxyFromHookEnv: true,
      defaults: { portable: true, purge: true, cypress: true },
    }
  }
  return {
    project: REPO_ROOT,
    voltaHome: '',
    versions: { node: '22.13.0', npm: '10.9.0', cypress: '14.0.3' },
    catsRegistry: '',
    proxyFromHookEnv: true,
    defaults: { portable: true, purge: true, cypress: true },
  }
}

export function saveRepairConfig(cfg) {
  fs.writeFileSync(CONF_PATH, `${JSON.stringify(cfg, null, '\t')}\n`, 'utf8')
  const v = {
    node: cfg.versions?.node || '22.13.0',
    npm: cfg.versions?.npm || '10.9.0',
    cypress: cfg.versions?.cypress || '14.0.3',
    nodeDist: `https://nodejs.org/dist/v${cfg.versions?.node || '22.13.0'}/node-v${cfg.versions?.node || '22.13.0'}-win-x64.zip`,
    cypressDist: `https://download.cypress.io/desktop/${cfg.versions?.cypress || '14.0.3'}?platform=win32&arch=x64`,
    defaultProject: cfg.project,
    defaultVoltaHome: cfg.voltaHome || '',
    catsRegistry: cfg.catsRegistry || '',
  }
  fs.writeFileSync(VERSIONS_PATH, `${JSON.stringify(v, null, '\t')}\n`, 'utf8')
}

function buildRepairArgs(cfg, actions) {
  const args = ['repair.mjs', '--project', cfg.project, '--node', cfg.versions?.node || '22.13.0']
  if (cfg.voltaHome) args.push('--volta-home', cfg.voltaHome)
  if (actions.dryRun) args.push('--dry-run')
  if (actions.diagnosticOnly) return args
  if (actions.install) args.push('--install')
  if (actions.cypress !== false && cfg.defaults?.cypress !== false) args.push('--cypress')
  if (actions.portable !== false) args.push('--portable')
  if (actions.noPurge) args.push('--no-purge')
  if (actions.online) args.push('--online')
  if (actions.removePackageLock) args.push('--remove-package-lock')
  return args
}

function buildDownloadArgs() {
  return ['download-vendor.mjs']
}

function runScript(script, scriptArgs) {
  return new Promise((resolve) => {
    const full = path.join(REPAIR_DIR, script)
    let out = `\n$ node ${script} ${scriptArgs.join(' ')}\n`
    const child = spawn(process.execPath, [full, ...scriptArgs], {
      cwd: REPAIR_DIR,
      env: process.env,
      shell: false,
      windowsHide: true,
    })
    child.stdout?.on('data', (d) => { out += d.toString() })
    child.stderr?.on('data', (d) => { out += d.toString() })
    child.on('close', (code) => resolve({ code: code ?? 1, output: out }))
  })
}

export async function executeRepairPlan(cfg, actions) {
  const blocks = []
  if (actions.downloadVendor) {
    blocks.push({ script: 'download-vendor.mjs', args: buildDownloadArgs() })
  }
  blocks.push({ script: 'repair.mjs', args: buildRepairArgs(cfg, actions) })

  let full = ''
  for (const b of blocks) {
    const r = await runScript(b.script, b.args)
    full += r.output
    if (r.code !== 0 && !actions.dryRun) {
      full += `\n[ERR] ${b.script} exit=${r.code}\n`
      return { ok: false, output: full, code: r.code }
    }
  }
  return { ok: true, output: full, code: 0 }
}

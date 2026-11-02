import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import { readNpmrc, getNpmrcPath } from './npmrc.mjs'
import { loadNpmInstallConfig } from './npm-install-config.mjs'
import { REPO_ROOT } from './paths.mjs'

function stepResult(id, label, status, message = '') {
  return { id, label, status, message }
}

function resolveNpmInvocation(installArgs, env = process.env) {
  const mergedEnv = { ...env }
  let nodeExe = process.execPath

  if (mergedEnv.WIZARD_VENDOR_NODE && fs.existsSync(mergedEnv.WIZARD_VENDOR_NODE)) {
    nodeExe = mergedEnv.WIZARD_VENDOR_NODE
    const nodeDir = path.dirname(nodeExe)
    mergedEnv.PATH = `${nodeDir}${path.delimiter}${mergedEnv.PATH || ''}`
    const npmCli = path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js')
    if (fs.existsSync(npmCli)) {
      return { cmd: nodeExe, args: [npmCli, ...installArgs], env: mergedEnv }
    }
  }

  if (process.platform === 'win32') {
    return {
      cmd: mergedEnv.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', 'npm', ...installArgs],
      env: mergedEnv,
    }
  }

  return { cmd: 'npm', args: installArgs, env: mergedEnv }
}

function runCommand(cmd, args, cwd, env = process.env) {
  return new Promise((resolve) => {
    let output = `\n$ ${cmd} ${args.join(' ')}\n`
    let child
    try {
      child = spawn(cmd, args, {
        cwd,
        env,
        shell: false,
        windowsHide: true,
      })
    } catch (err) {
      output += `\n[ERR] ${err.message}\n`
      resolve({ code: 1, output })
      return
    }
    child.stdout?.on('data', (d) => { output += d.toString() })
    child.stderr?.on('data', (d) => { output += d.toString() })
    child.on('error', (err) => {
      output += `\n[ERR] ${err.message}\n`
      resolve({ code: 1, output })
    })
    child.on('close', (code) => resolve({ code: code ?? 1, output }))
  })
}

export async function runNpmInstallArgs(installArgs, projectPath = REPO_ROOT) {
  const env = { ...process.env }
  const { cmd, args, env: runEnv } = resolveNpmInvocation(installArgs, env)
  const command = `npm ${installArgs.join(' ')}`
  const run = await runCommand(cmd, args, projectPath, runEnv)
  return {
    ok: run.code === 0,
    output: run.output,
    command,
    code: run.code ?? 1,
  }
}

function resolveNpxInvocation(npxArgs, env = process.env) {
  const mergedEnv = { ...env }
  let nodeExe = process.execPath

  if (mergedEnv.WIZARD_VENDOR_NODE && fs.existsSync(mergedEnv.WIZARD_VENDOR_NODE)) {
    nodeExe = mergedEnv.WIZARD_VENDOR_NODE
    const nodeDir = path.dirname(nodeExe)
    mergedEnv.PATH = `${nodeDir}${path.delimiter}${mergedEnv.PATH || ''}`
  }

  if (process.platform === 'win32') {
    return {
      cmd: mergedEnv.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', 'npx', ...npxArgs],
      env: mergedEnv,
    }
  }

  return { cmd: 'npx', args: npxArgs, env: mergedEnv }
}

export async function runNpxArgs(npxArgs, projectPath = REPO_ROOT) {
  const env = { ...process.env }
  const { cmd, args, env: runEnv } = resolveNpxInvocation(npxArgs, env)
  const command = `npx ${npxArgs.join(' ')}`
  const run = await runCommand(cmd, args, projectPath, runEnv)
  return {
    ok: run.code === 0,
    output: run.output,
    command,
    code: run.code ?? 1,
  }
}

function buildInstallArgs(config) {
  const pkgs = config.packages || []
  if (!pkgs.length) {
    return config.preferCi && fs.existsSync(path.join(config.projectPath, 'package-lock.json'))
      ? ['ci']
      : [config.installCommand || 'install']
  }
  const specs = pkgs.map((p) => `${p.name}@${p.version}`)
  const args = [config.installCommand || 'install', ...specs]
  const allDev = pkgs.every((p) => p.dev)
  if (allDev) args.push('--save-dev')
  return args
}

export async function executeNpmInstall() {
  const config = loadNpmInstallConfig()
  const stepsOut = []
  const stepDefs = config.steps || []

  const def = (id) => stepDefs.find((s) => s.id === id) || { id, label: id }

  try {
    const npmrc = readNpmrc()
    if (!npmrc.exists) {
      stepsOut.push(stepResult(
        def('npmrc').id,
        def('npmrc').label,
        'error',
        `Fichier absent — générez d'abord le .npmrc (${getNpmrcPath()})`,
      ))
      return { ok: false, steps: stepsOut, output: '', command: '' }
    }
    stepsOut.push(stepResult(def('npmrc').id, def('npmrc').label, 'ok', npmrc.path))
  } catch (err) {
    stepsOut.push(stepResult(def('npmrc').id, def('npmrc').label, 'error', err.message))
    return { ok: false, steps: stepsOut, output: '', command: '' }
  }

  if (!fs.existsSync(config.projectPath)) {
    stepsOut.push(stepResult(
      def('config').id,
      def('config').label,
      'error',
      `Dossier projet introuvable : ${config.projectDir}`,
    ))
    return { ok: false, steps: stepsOut, output: '', command: '' }
  }
  const pkgJson = path.join(config.projectPath, 'package.json')
  if (!fs.existsSync(pkgJson)) {
    stepsOut.push(stepResult(
      def('config').id,
      def('config').label,
      'error',
      'package.json introuvable à la racine du dépôt',
    ))
    return { ok: false, steps: stepsOut, output: '', command: '' }
  }
  stepsOut.push(stepResult(
    def('config').id,
    def('config').label,
    'ok',
    `${config.packages.length} paquet(s) — ${config.relativePath}`,
  ))

  const installArgs = buildInstallArgs(config)
  const env = { ...process.env }
  const { cmd, args, env: runEnv } = resolveNpmInvocation(installArgs, env)
  const command = `${cmd} ${args.join(' ')}`
  const run = await runCommand(cmd, args, config.projectPath, runEnv)
  stepsOut.push(stepResult(
    def('install').id,
    def('install').label,
    run.code === 0 ? 'ok' : 'error',
    run.code === 0 ? 'Terminé' : `Code de sortie ${run.code}`,
  ))

  const nodeModules = path.join(config.projectPath, 'node_modules')
  const verifyOk = run.code === 0 && fs.existsSync(nodeModules)
  stepsOut.push(stepResult(
    def('verify').id,
    def('verify').label,
    verifyOk ? 'ok' : 'error',
    verifyOk ? 'node_modules présent' : 'node_modules absent ou installation échouée',
  ))

  return {
    ok: verifyOk,
    steps: stepsOut,
    output: run.output,
    command,
    projectPath: path.relative(REPO_ROOT, config.projectPath).replace(/\\/g, '/') || '.',
  }
}

export function getNpmInstallConfigForApi() {
  const config = loadNpmInstallConfig()
  return {
    version: config.version,
    description: config.description,
    relativePath: config.relativePath,
    projectDir: config.projectDir,
    packages: config.packages,
    steps: config.steps,
    runtime: config.runtime,
  }
}

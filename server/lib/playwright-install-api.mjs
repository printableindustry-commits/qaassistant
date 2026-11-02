import fs from 'fs'
import path from 'path'
import { readNpmrc, getNpmrcPath } from './npmrc.mjs'
import { runNpmInstallArgs, runNpxArgs } from './npm-install-api.mjs'
import { REPO_ROOT } from './paths.mjs'
import { loadPlaywrightInstallConfig, getPlaywrightStepMap } from './stack-install-config.mjs'

function resolveStep(stepId, config = loadPlaywrightInstallConfig()) {
  const key = String(stepId || '').trim()
  const step = getPlaywrightStepMap(config)[key]
  if (!step) {
    const ids = config.steps.map((s) => s.id).join(', ')
    throw new Error(`Étape inconnue : ${key || '(vide)'} — attendu : ${ids}`)
  }
  return step
}

function checkPrereqs() {
  const npmrc = readNpmrc()
  if (!npmrc.exists) {
    throw new Error(`Fichier .npmrc absent — configurez-le d'abord (${getNpmrcPath()})`)
  }
  if (!npmrc.fields?.registry || !npmrc.fields?.authToken) {
    throw new Error('.npmrc incomplet — registry et _authToken requis')
  }
  const pkgJson = path.join(REPO_ROOT, 'package.json')
  if (!fs.existsSync(pkgJson)) {
    throw new Error('package.json introuvable à la racine du dépôt')
  }
}

async function runStepCommand(step, projectPath) {
  if (step.runner === 'npx') {
    return runNpxArgs(step.args, projectPath)
  }
  return runNpmInstallArgs(step.args, projectPath)
}

export function getPlaywrightInstallConfigForApi() {
  const config = loadPlaywrightInstallConfig()
  return {
    description: config.description,
    relativePath: config.relativePath,
    projectPath: path.relative(REPO_ROOT, config.projectPath).replace(/\\/g, '/') || '.',
    vscodeExtensionId: config.vscodeExtensionId,
    vscodeInstallCommand: config.vscodeInstallCommand,
    steps: config.steps.map(({ id, label, runner, args }) => ({ id, label, runner, args })),
  }
}

export async function executePlaywrightInstall(stepId) {
  const config = loadPlaywrightInstallConfig()
  const step = resolveStep(stepId, config)
  checkPrereqs()

  const run = await runStepCommand(step, config.projectPath)
  const nodeModules = path.join(config.projectPath, 'node_modules')
  const verifyOk = run.ok && fs.existsSync(nodeModules)

  return {
    ok: verifyOk,
    step: step.id,
    label: step.label,
    output: run.output,
    command: run.command,
    projectPath: path.relative(REPO_ROOT, config.projectPath).replace(/\\/g, '/') || '.',
    configPath: config.relativePath,
    verifyMessage: verifyOk
      ? (step.id === 'browsers' ? 'Navigateurs Playwright installés' : 'node_modules présent')
      : 'Installation échouée — voir le journal',
  }
}

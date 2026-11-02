import fs from 'fs'
import path from 'path'
import { readNpmrc, getNpmrcPath } from './npmrc.mjs'
import { runNpmInstallArgs, runNpxArgs } from './npm-install-api.mjs'
import { REPO_ROOT } from './paths.mjs'
import {
  loadPostmanInitConfig,
  loadPostmanInstallConfig,
  getPostmanStepMap,
} from './stack-install-config.mjs'
import { runPostmanScaffold, resolvePostmanPaths } from './postman-scaffold.mjs'

function checkNpmPrereqs() {
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

function resolveStep(stepId, config = loadPostmanInstallConfig()) {
  const key = String(stepId || '').trim()
  const step = getPostmanStepMap(config)[key]
  if (!step) {
    const ids = [...config.steps.map((s) => s.id), config.verify?.id].filter(Boolean).join(', ')
    throw new Error(`Étape inconnue : ${key || '(vide)'} — attendu : ${ids}`)
  }
  return step
}

async function runStepCommand(step, projectPath) {
  if (step.runner === 'scaffold') {
    const init = loadPostmanInitConfig()
    const result = runPostmanScaffold(init, REPO_ROOT)
    const lines = [
      result.message,
      '',
      'Créés :',
      ...(result.created.length ? result.created.map((f) => `  + ${f}`) : ['  (aucun nouveau fichier)']),
    ]
    if (result.skipped?.length) {
      lines.push('', 'Conservés (déjà présents) :', ...result.skipped.map((f) => `  · ${f}`))
    }
    if (result.pkgScripts?.updated) {
      lines.push('', `Scripts npm ajoutés : ${result.pkgScripts.scripts.join(', ')}`)
    }
    return {
      ok: true,
      output: `${lines.join('\n')}\n`,
      command: 'postman scaffold',
      code: 0,
      scaffold: result,
    }
  }
  if (step.runner === 'npx') {
    return runNpxArgs(step.args, projectPath)
  }
  return runNpmInstallArgs(step.args, projectPath)
}

export function getPostmanInitConfigForApi() {
  const config = loadPostmanInitConfig()
  const paths = resolvePostmanPaths(config)
  return {
    description: config.description,
    relativePath: config.relativePath,
    projectName: config.projectName,
    baseUrl: config.baseUrl,
    environmentLabel: config.environmentLabel,
    postmanDir: config.postmanDir,
    paths,
  }
}

export function savePostmanInitConfig(body = {}) {
  const current = loadPostmanInitConfig()
  const next = {
    ...current,
    projectName: String(body.projectName || current.projectName).trim() || current.projectName,
    baseUrl: String(body.baseUrl || current.baseUrl).trim() || current.baseUrl,
    environmentLabel: String(body.environmentLabel || current.environmentLabel).trim() || current.environmentLabel,
  }
  delete next.path
  delete next.relativePath
  fs.writeFileSync(current.path, `${JSON.stringify({
    version: next.version,
    description: next.description,
    projectName: next.projectName,
    baseUrl: next.baseUrl,
    environmentLabel: next.environmentLabel,
    postmanDir: next.postmanDir,
  }, null, 2)}\n`, 'utf8')
  return getPostmanInitConfigForApi()
}

export function checkPostmanRuntime() {
  const init = loadPostmanInitConfig()
  const paths = resolvePostmanPaths(init)
  const collPath = path.join(REPO_ROOT, paths.collectionFile)
  const envPath = path.join(REPO_ROOT, paths.environmentFile)
  const newmanBin = path.join(REPO_ROOT, 'node_modules', 'newman', 'package.json')
  return {
    scaffoldReady: fs.existsSync(collPath) && fs.existsSync(envPath),
    collectionPath: paths.collectionFile,
    environmentPath: paths.environmentFile,
    newmanInstalled: fs.existsSync(newmanBin),
    configPath: init.relativePath,
    installConfigPath: loadPostmanInstallConfig().relativePath,
  }
}

export function getPostmanInstallConfigForApi() {
  const config = loadPostmanInstallConfig()
  return {
    description: config.description,
    relativePath: config.relativePath,
    projectPath: path.relative(REPO_ROOT, config.projectPath).replace(/\\/g, '/') || '.',
    verify: config.verify,
    steps: config.steps.map(({ id, label, runner, args }) => ({ id, label, runner, args })),
  }
}

export async function executePostmanInstall(stepId) {
  const config = loadPostmanInstallConfig()
  const step = resolveStep(stepId, config)
  if (step.runner !== 'scaffold') {
    checkNpmPrereqs()
  }

  const run = await runStepCommand(step, config.projectPath)
  let verifyOk = run.ok

  if (step.id === 'verify') {
    verifyOk = run.ok && /newman/i.test(run.output)
  } else if (step.runner === 'scaffold') {
    const runtime = checkPostmanRuntime()
    verifyOk = runtime.scaffoldReady
  } else if (step.runner === 'npm' || step.runner === 'npx') {
    verifyOk = run.ok
  }

  return {
    ok: verifyOk,
    step: step.id,
    label: step.label,
    output: run.output,
    command: run.command,
    projectPath: path.relative(REPO_ROOT, config.projectPath).replace(/\\/g, '/') || '.',
    configPath: config.relativePath,
    verifyMessage: verifyOk
      ? (step.id === 'verify' ? 'Newman détecté' : 'Étape terminée')
      : 'Échec — voir le journal',
  }
}

import fs from 'fs'
import path from 'path'
import { readNpmrc, getNpmrcPath } from './npmrc.mjs'
import { runNpmInstallArgs } from './npm-install-api.mjs'
import { REPO_ROOT } from './paths.mjs'
import { runK6CliArgs, probeK6, runShellCommand } from './stack-command-runner.mjs'
import {
  loadK6InitConfig,
  loadK6InstallConfig,
  getK6StepMap,
} from './stack-install-config.mjs'
import { runK6Scaffold, resolveK6Paths } from './k6-scaffold.mjs'
import { installK6Portable } from './k6-portable.mjs'

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

function resolveStep(stepId, config = loadK6InstallConfig()) {
  const key = String(stepId || '').trim()
  const step = getK6StepMap(config)[key]
  if (!step) {
    const ids = [...config.steps.map((s) => s.id), config.verify?.id].filter(Boolean).join(', ')
    throw new Error(`Étape inconnue : ${key || '(vide)'} — attendu : ${ids}`)
  }
  return step
}

async function installK6Binary(step, projectPath) {
  const cmd = step.args?.[0]
  const args = (step.args || []).slice(1).map((a) => (a === 'Grafana.k6' ? 'GrafanaLabs.k6' : a))
  if (!cmd) throw new Error('Étape shell : args[0] = commande requise')
  let output = ''
  const attempts = []
  if (process.platform === 'win32') attempts.push({ portable: true })
  attempts.push({ cmd, args })
  if (process.platform === 'win32') {
    attempts.push({ cmd: 'choco', args: ['install', 'k6', '-y'] })
  } else if (process.platform === 'darwin') {
    attempts.push({ cmd: 'brew', args: ['install', 'k6'] })
  }
  let last = { ok: false, output: '', command: `${cmd} ${args.join(' ')}`, code: 1 }
  for (const attempt of attempts) {
    last = attempt.portable
      ? await installK6Portable(process.env)
      : await runShellCommand(attempt.cmd, attempt.args, projectPath, process.env)
    output += last.output
    const probe = await probeK6(process.env)
    if (probe.k6Present) {
      return { ...last, ok: true, output: `${output}\nk6 détecté après installation (${probe.k6Version}).\n` }
    }
    output += `\n→ k6 introuvable après « ${attempt.portable ? 'téléchargement portable' : attempt.cmd} », tentative suivante…\n`
  }
  return { ...last, ok: false, output }
}

async function runStepCommand(step, projectPath) {
  if (step.runner === 'scaffold') {
    const init = loadK6InitConfig()
    const result = runK6Scaffold(init, REPO_ROOT)
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
      command: 'k6 scaffold',
      code: 0,
      scaffold: result,
    }
  }
  if (step.runner === 'k6') {
    return runK6CliArgs(step.args || [], projectPath, process.env)
  }
  if (step.runner === 'shell') {
    return installK6Binary(step, projectPath)
  }
  return runNpmInstallArgs(step.args, projectPath)
}

export function getK6InitConfigForApi() {
  const config = loadK6InitConfig()
  const paths = resolveK6Paths(config)
  return {
    description: config.description,
    relativePath: config.relativePath,
    projectName: config.projectName,
    baseUrl: config.baseUrl,
    k6Dir: config.k6Dir,
    defaultVus: config.defaultVus,
    defaultDuration: config.defaultDuration,
    p95ThresholdMs: config.p95ThresholdMs,
    paths,
  }
}

export function saveK6InitConfig(body = {}) {
  const current = loadK6InitConfig()
  const next = {
    ...current,
    projectName: String(body.projectName || current.projectName).trim() || current.projectName,
    baseUrl: String(body.baseUrl || current.baseUrl).trim() || current.baseUrl,
    defaultVus: Number(body.defaultVus) || current.defaultVus || 5,
    defaultDuration: String(body.defaultDuration || current.defaultDuration).trim() || current.defaultDuration,
    p95ThresholdMs: Number(body.p95ThresholdMs) || current.p95ThresholdMs || 500,
  }
  delete next.path
  delete next.relativePath
  fs.writeFileSync(current.path, `${JSON.stringify({
    version: next.version,
    description: next.description,
    projectName: next.projectName,
    baseUrl: next.baseUrl,
    k6Dir: next.k6Dir,
    defaultVus: next.defaultVus,
    defaultDuration: next.defaultDuration,
    p95ThresholdMs: next.p95ThresholdMs,
  }, null, 2)}\n`, 'utf8')
  return getK6InitConfigForApi()
}

export function getK6InstallStateSync() {
  const init = loadK6InitConfig()
  const paths = resolveK6Paths(init)
  const smokePath = path.join(REPO_ROOT, paths.smokeScript)
  const scaffoldReady = fs.existsSync(smokePath)
  return {
    scaffoldReady,
    installed: scaffoldReady,
    wizardHref: scaffoldReady ? '/k6-wizard.html' : '/k6-install.html',
    installHref: '/k6-install.html',
    smokeScript: paths.smokeScript,
  }
}

export async function checkK6Runtime() {
  const init = loadK6InitConfig()
  const paths = resolveK6Paths(init)
  const smokePath = path.join(REPO_ROOT, paths.smokeScript)
  const k6Info = await probeK6(process.env)
  const sync = getK6InstallStateSync()
  return {
    ...sync,
    k6Installed: k6Info.k6Present,
    k6Version: k6Info.k6Version || '',
    configPath: init.relativePath,
    installConfigPath: loadK6InstallConfig().relativePath,
  }
}

export function getK6InstallConfigForApi() {
  const config = loadK6InstallConfig()
  return {
    description: config.description,
    relativePath: config.relativePath,
    projectPath: path.relative(REPO_ROOT, config.projectPath).replace(/\\/g, '/') || '.',
    verify: config.verify,
    steps: config.steps.map(({ id, label, runner, args }) => ({ id, label, runner, args })),
  }
}

export async function executeK6Install(stepId) {
  const config = loadK6InstallConfig()
  const step = resolveStep(stepId, config)
  if (step.runner !== 'scaffold' && step.runner !== 'k6') {
    if (step.runner === 'shell') {
      const k6Info = await probeK6(process.env)
      if (k6Info.k6Present) {
        return {
          ok: true,
          step: step.id,
          label: step.label,
          output: `k6 déjà installé (${k6Info.k6Version}) — étape winget ignorée.\n`,
          command: 'k6 version',
          projectPath: path.relative(REPO_ROOT, config.projectPath).replace(/\\/g, '/') || '.',
          configPath: config.relativePath,
          verifyMessage: 'Binaire k6 détecté',
        }
      }
    } else {
      try {
        checkNpmPrereqs()
      } catch (err) {
        return {
          ok: true,
          step: step.id,
          label: step.label,
          output: `Étape ignorée (non bloquante) : ${err.message}\n→ Les types @types/k6 sont facultatifs ; k6 fonctionne sans.\n`,
          command: `npm ${(step.args || []).join(' ')}`,
          projectPath: path.relative(REPO_ROOT, config.projectPath).replace(/\\/g, '/') || '.',
          configPath: config.relativePath,
          verifyMessage: 'Étape ignorée — prérequis npm absents',
        }
      }
    }
  }

  const run = await runStepCommand(step, config.projectPath)
  let verifyOk = run.ok

  if (step.id === 'verify') {
    verifyOk = run.ok && /k6/i.test(run.output)
    if (!verifyOk) {
      run.output += '\n\n→ Installez Grafana k6 : winget install GrafanaLabs.k6, choco install k6, ou https://grafana.com/docs/k6/latest/set-up/install-k6/\n'
    }
  } else if (step.runner === 'scaffold') {
    const runtime = await checkK6Runtime()
    verifyOk = runtime.scaffoldReady
  } else if (step.runner === 'shell') {
    verifyOk = run.ok
    if (!run.ok) {
      run.output += '\n\n→ Installation automatique impossible (droits administrateur, winget/choco absents ou réseau). Installez k6 manuellement : https://grafana.com/docs/k6/latest/set-up/install-k6/ puis relancez.\n'
    }
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
      ? (step.id === 'verify' ? `k6 détecté — ${(await probeK6(process.env)).k6Version}` : 'Étape terminée')
      : 'Échec — voir le journal',
  }
}

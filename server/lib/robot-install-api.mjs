import {
  probePython,
  probePip,
  runStackStep,
} from './stack-command-runner.mjs'
import {
  loadRobotInstallConfig,
  getRobotStepMap,
} from './stack-install-config.mjs'
let cachedPython = null

async function getPythonRuntime(force = false) {
  if (!force && cachedPython?.pythonPresent) return cachedPython
  const pythonInfo = await probePython(process.env)
  const pipInfo = await probePip(pythonInfo, process.env)
  cachedPython = { ...pythonInfo, ...pipInfo }
  return cachedPython
}

function resolveStep(stepId, config = loadRobotInstallConfig()) {
  const key = String(stepId || '').trim()
  const map = getRobotStepMap(config)
  const step = map[key]
  if (!step) {
    const ids = [...config.steps.map((s) => s.id), config.verify?.id].filter(Boolean).join(', ')
    throw new Error(`Étape inconnue : ${key || '(vide)'} — attendu : ${ids}`)
  }
  return step
}

export async function checkRobotRuntime() {
  const config = loadRobotInstallConfig()
  const runtime = await getPythonRuntime(true)
  const major = parseInt(String(runtime.pythonVersion || '').split('.')[0], 10)
  const pythonOk = runtime.pythonPresent && (!config.pythonMinMajor || major >= config.pythonMinMajor)
  return {
    pythonPresent: runtime.pythonPresent,
    pipPresent: runtime.pipPresent,
    pythonVersion: runtime.pythonVersion || '',
    pythonCmd: runtime.pythonCmd || '',
    pythonOk,
    ready: pythonOk && runtime.pipPresent,
    configPath: config.relativePath,
  }
}

export function getRobotInstallConfigForApi() {
  const config = loadRobotInstallConfig()
  return {
    description: config.description,
    relativePath: config.relativePath,
    projectPath: '.',
    pythonMinMajor: config.pythonMinMajor,
    verify: config.verify,
    steps: config.steps.map(({ id, label, runner, args }) => ({ id, label, runner, args })),
  }
}

export async function executeRobotInstall(stepId) {
  const config = loadRobotInstallConfig()
  const step = resolveStep(stepId, config)
  const runtime = await getPythonRuntime(true)

  if (!runtime.pythonPresent) {
    throw new Error('Python introuvable — installez Python 3.10+ (py -3 ou python dans le PATH)')
  }
  if (!runtime.pipPresent && step.runner !== 'robot') {
    throw new Error('pip indisponible — vérifiez Python et relancez python -m ensurepip --upgrade')
  }

  const run = await runStackStep(step, config.projectPath, runtime, process.env)
  const verifyOk = run.ok && (step.id !== 'verify' || /robot framework/i.test(run.output))

  return {
    ok: verifyOk,
    step: step.id,
    label: step.label,
    output: run.output,
    command: run.command,
    projectPath: '.',
    configPath: config.relativePath,
    verifyMessage: verifyOk
      ? (step.id === 'verify' ? 'Robot Framework détecté' : 'Commande terminée')
      : 'Installation échouée — voir le journal',
  }
}

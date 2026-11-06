import { spawn } from 'child_process'
import path from 'path'
import { getK6PortableDir } from './k6-portable.mjs'

const activeK6Children = new Set()
let k6StopRequested = false

export function stopK6Runs() {
  k6StopRequested = true
  let n = 0
  for (const child of activeK6Children) {
    try {
      if (process.platform === 'win32' && child.pid) {
        spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
      } else {
        child.kill('SIGTERM')
      }
      n += 1
    } catch { /* déjà terminé */ }
  }
  return n
}

function runCommand(cmd, args, cwd, env = process.env, track = null) {
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
    if (track) track.add(child)
    child.stdout?.on('data', (d) => { output += d.toString() })
    child.stderr?.on('data', (d) => { output += d.toString() })
    child.on('error', (err) => {
      if (track) track.delete(child)
      output += `\n[ERR] ${err.message}\n`
      resolve({ code: 1, output })
    })
    child.on('close', (code) => {
      if (track) track.delete(child)
      resolve({ code: code ?? 1, output })
    })
  })
}

export function detectPythonCandidates() {
  if (process.platform === 'win32') {
    return [
      { cmd: 'py', args: ['-3'] },
      { cmd: 'python', args: [] },
      { cmd: 'python3', args: [] },
    ]
  }
  return [
    { cmd: 'python3', args: [] },
    { cmd: 'python', args: [] },
  ]
}

export async function probePython(env = process.env) {
  for (const candidate of detectPythonCandidates()) {
    const versionArgs = [...candidate.args, '--version']
    const run = await runCommand(candidate.cmd, versionArgs, process.cwd(), env)
    if (run.code === 0) {
      const versionLine = run.output.split('\n').find((l) => /python/i.test(l)) || run.output.trim()
      const version = versionLine.replace(/^Python\s+/i, '').trim()
      return {
        pythonPresent: true,
        pythonCmd: candidate.cmd,
        pythonArgsPrefix: candidate.args,
        pythonVersion: version,
        probeOutput: run.output,
      }
    }
  }
  return { pythonPresent: false, pythonCmd: '', pythonArgsPrefix: [], pythonVersion: '' }
}

export async function probePip(pythonInfo, env = process.env) {
  if (!pythonInfo?.pythonPresent) {
    return { pipPresent: false, pipOutput: '' }
  }
  const args = [...pythonInfo.pythonArgsPrefix, '-m', 'pip', '--version']
  const run = await runCommand(pythonInfo.pythonCmd, args, process.cwd(), env)
  return {
    pipPresent: run.code === 0,
    pipOutput: run.output,
  }
}

function pythonCommand(pythonInfo) {
  return {
    cmd: pythonInfo.pythonCmd,
    prefix: [...(pythonInfo.pythonArgsPrefix || [])],
  }
}

export async function runPipArgs(pipArgs, projectPath, pythonInfo, env = process.env) {
  const py = pythonCommand(pythonInfo)
  const args = [...py.prefix, '-m', 'pip', ...pipArgs]
  const command = `${py.cmd} ${args.join(' ')}`
  const run = await runCommand(py.cmd, args, projectPath, env)
  return {
    ok: run.code === 0,
    output: run.output,
    command,
    code: run.code ?? 1,
  }
}

export async function runPythonArgs(pyArgs, projectPath, pythonInfo, env = process.env) {
  const py = pythonCommand(pythonInfo)
  const args = [...py.prefix, ...pyArgs]
  const command = `${py.cmd} ${args.join(' ')}`
  const run = await runCommand(py.cmd, args, projectPath, env)
  return {
    ok: run.code === 0,
    output: run.output,
    command,
    code: run.code ?? 1,
  }
}

export async function runRobotCliArgs(robotArgs, projectPath, pythonInfo, env = process.env) {
  const mergedEnv = { ...env }
  if (pythonInfo?.pythonPresent && process.platform === 'win32') {
    const localAppData = env.LOCALAPPDATA || ''
    const candidates = [
      path.join(localAppData, 'Programs', 'Python', 'Python311', 'Scripts'),
      path.join(localAppData, 'Programs', 'Python', 'Python310', 'Scripts'),
      path.join(localAppData, 'Programs', 'Python', 'Python312', 'Scripts'),
    ]
    for (const scriptsDir of candidates) {
      mergedEnv.PATH = `${scriptsDir}${path.delimiter}${mergedEnv.PATH || ''}`
    }
  }

  const tryRobot = async () => {
    const command = `robot ${robotArgs.join(' ')}`
    const run = await runCommand('robot', robotArgs, projectPath, mergedEnv)
    return { ...run, command }
  }

  let run = await tryRobot()
  if (run.code === 0) {
    return {
      ok: true,
      output: run.output,
      command: run.command,
      code: 0,
    }
  }

  const py = pythonCommand(pythonInfo)
  const args = [...py.prefix, '-m', 'robot', ...robotArgs]
  const command = `${py.cmd} ${args.join(' ')}`
  run = await runCommand(py.cmd, args, projectPath, mergedEnv)
  return {
    ok: run.code === 0,
    output: run.output,
    command,
    code: run.code ?? 1,
  }
}

function k6ExtraDirs(env = process.env) {
  if (process.platform !== 'win32') return ['/usr/local/bin', '/opt/homebrew/bin', '/usr/bin']
  const pf = env.ProgramFiles || 'C:\\Program Files'
  const pf86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
  const local = env.LOCALAPPDATA || ''
  const pd = env.ProgramData || 'C:\\ProgramData'
  return [
    getK6PortableDir(env),
    path.join(pf, 'k6'),
    path.join(pf86, 'k6'),
    local && path.join(local, 'Microsoft', 'WinGet', 'Links'),
    local && path.join(local, 'Programs', 'k6'),
    path.join(pd, 'chocolatey', 'bin'),
  ].filter(Boolean)
}

/** Env avec PATH complété : un k6 installé pendant la session n'est pas dans le PATH du processus. */
export function withK6Path(env = process.env) {
  const merged = { ...env }
  const key = Object.keys(merged).find((k) => k.toLowerCase() === 'path') || 'PATH'
  const current = String(merged[key] || '')
  const have = new Set(current.split(path.delimiter).map((p) => p.toLowerCase()))
  const extra = k6ExtraDirs(env).filter((d) => !have.has(d.toLowerCase()))
  merged[key] = [current, ...extra].filter(Boolean).join(path.delimiter)
  return merged
}

export async function runK6CliArgs(k6Args, projectPath, env = process.env) {
  const command = `k6 ${k6Args.join(' ')}`
  k6StopRequested = false
  const run = await runCommand('k6', k6Args, projectPath, withK6Path(env), activeK6Children)
  const stopped = k6StopRequested
  k6StopRequested = false
  return {
    ok: run.code === 0 && !stopped,
    output: stopped ? `${run.output}\n[STOP] Exécution interrompue par l'utilisateur.\n` : run.output,
    command,
    code: run.code ?? 1,
    stopped,
  }
}

export async function probeK6(env = process.env) {
  const run = await runCommand('k6', ['version'], process.cwd(), withK6Path(env))
  if (run.code !== 0) {
    return { k6Present: false, k6Version: '', probeOutput: run.output }
  }
  const versionLine = run.output.split('\n').find((l) => /^k6(\.exe)?\s+v?\d/i.test(l.trim()))
    || run.output.split('\n').find((l) => /k6/i.test(l) && !l.trim().startsWith('$'))
    || run.output.trim()
  const version = versionLine.replace(/^k6(\.exe)?\s+v?/i, '').trim()
  return {
    k6Present: true,
    k6Version: version || versionLine,
    probeOutput: run.output,
  }
}

export async function runShellCommand(cmd, args, projectPath, env = process.env) {
  const command = `${cmd} ${args.join(' ')}`
  const run = await runCommand(cmd, args, projectPath, env)
  return {
    ok: run.code === 0,
    output: run.output,
    command,
    code: run.code ?? 1,
  }
}

export async function runStackStep(step, projectPath, pythonInfo, env = process.env) {
  const runner = String(step?.runner || 'pip').toLowerCase()
  if (runner === 'python') {
    return runPythonArgs(step.args || [], projectPath, pythonInfo, env)
  }
  if (runner === 'robot') {
    return runRobotCliArgs(step.args || [], projectPath, pythonInfo, env)
  }
  return runPipArgs(step.args || [], projectPath, pythonInfo, env)
}

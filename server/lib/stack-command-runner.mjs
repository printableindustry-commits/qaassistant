import { spawn } from 'child_process'
import path from 'path'

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

export async function runK6CliArgs(k6Args, projectPath, env = process.env) {
  const command = `k6 ${k6Args.join(' ')}`
  const run = await runCommand('k6', k6Args, projectPath, env)
  return {
    ok: run.code === 0,
    output: run.output,
    command,
    code: run.code ?? 1,
  }
}

export async function probeK6(env = process.env) {
  const run = await runCommand('k6', ['version'], process.cwd(), env)
  if (run.code !== 0) {
    return { k6Present: false, k6Version: '', probeOutput: run.output }
  }
  const versionLine = run.output.split('\n').find((l) => /k6/i.test(l)) || run.output.trim()
  const version = versionLine.replace(/^k6\s+v?/i, '').trim()
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

import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

export function detectGitRoot(fromDir) {
  try {
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf8', cwd: fromDir }).trim()
  } catch {
    return null
  }
}

export function getHookInstallStatus(hookDir) {
  const repoRoot = detectGitRoot(hookDir)
  if (!repoRoot) {
    return { installed: false, repoRoot: null, hookPath: null, message: 'Pas un dépôt git' }
  }
  const hookPath = path.join(repoRoot, '.git', 'hooks', 'post-commit')
  const templatePath = path.join(hookDir, 'install', 'post-commit.template')
  const installed = fs.existsSync(hookPath)
  let valid = false
  if (installed) {
    const content = fs.readFileSync(hookPath, 'utf8')
    const hookDirName = path.basename(hookDir)
    valid = content.includes(hookDirName) && !content.includes('@HOOK_DIR@')
  }
  return {
    installed,
    valid,
    repoRoot,
    hookPath,
    templatePath,
    hookDirName: path.basename(hookDir),
    templateExists: fs.existsSync(templatePath),
  }
}

export function installHook(hookDir) {
  const status = getHookInstallStatus(hookDir)
  if (!status.repoRoot) throw new Error('Lancez depuis un dépôt git')
  if (!status.templateExists) throw new Error(`Template introuvable : ${status.templatePath}`)

  const content = fs.readFileSync(status.templatePath, 'utf8').replace(/@HOOK_DIR@/g, status.hookDirName)
  fs.mkdirSync(path.dirname(status.hookPath), { recursive: true })
  fs.writeFileSync(status.hookPath, content, 'utf8')

  return {
    ok: true,
    hookPath: status.hookPath,
    hookDirName: status.hookDirName,
    message: `Hook installé : ${status.hookPath}`,
  }
}

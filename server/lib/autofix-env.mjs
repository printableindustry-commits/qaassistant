/** Photographie de l'environnement d'installation, jointe aux prompts de correction Copilot. */
import fs from 'fs'
import os from 'os'
import path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
import { REPO_ROOT } from './paths.mjs'
import { getNpmrcPath } from './npmrc.mjs'

const execAsync = promisify(exec)
const PROBE_TIMEOUT_MS = 5000

async function run(command) {
  try {
    const { stdout } = await execAsync(command, { encoding: 'utf8', timeout: PROBE_TIMEOUT_MS, windowsHide: true })
    return stdout.trim()
  } catch (err) {
    return `(échec : ${String(err.message || err).split('\n')[0]})`
  }
}

async function locate(binary) {
  const cmd = process.platform === 'win32' ? `where ${binary}` : `command -v ${binary}`
  return (await run(cmd)).split(/\r?\n/).filter(Boolean)
}

function maskSecrets(text) {
  return String(text || '').replace(/(_auth(?:Token)?|_password|password|token)\s*=\s*.+/gi, '$1=***')
}

function readIfExists(abs, max = 3000) {
  if (!abs || !fs.existsSync(abs)) return '(absent)'
  const raw = fs.readFileSync(abs, 'utf8')
  return raw.length <= max ? raw : `${raw.slice(0, max)}\n…(tronqué)`
}

export async function probeInstallEnvironment() {
  const pkgPath = path.join(REPO_ROOT, 'package.json')
  let dependencies = '(package.json absent)'
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
      dependencies = JSON.stringify({ dependencies: pkg.dependencies, devDependencies: pkg.devDependencies }, null, 2)
    } catch {
      dependencies = '(package.json illisible)'
    }
  }

  const browsersDir = process.env.PLAYWRIGHT_BROWSERS_PATH
    || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.cache'), 'ms-playwright')

  const [nodeV, npmV, nodePaths, npmPaths, npxPaths, k6Paths, volta, registry, proxy] = await Promise.all([
    run('node -v'),
    run('npm -v'),
    locate('node'),
    locate('npm'),
    locate('npx'),
    locate('k6'),
    run('volta --version'),
    run('npm config get registry'),
    run('npm config get proxy'),
  ])

  return {
    système: `${os.platform()} ${os.release()} (${os.arch()})`,
    'répertoire projet': REPO_ROOT,
    node: nodeV,
    npm: npmV,
    'chemins node': nodePaths,
    'chemins npm': npmPaths,
    'chemins npx': npxPaths,
    'chemins k6': k6Paths,
    volta,
    'npm config registry': registry,
    'npm config proxy': maskSecrets(proxy),
    'node_modules présent': fs.existsSync(path.join(REPO_ROOT, 'node_modules')),
    '@playwright/test installé': fs.existsSync(path.join(REPO_ROOT, 'node_modules', '@playwright', 'test')),
    'navigateurs Playwright': fs.existsSync(browsersDir) ? fs.readdirSync(browsersDir).join(', ') || '(dossier vide)' : `(absent : ${browsersDir})`,
    'package.json': dependencies,
    '.npmrc utilisateur (secrets masqués)': maskSecrets(readIfExists(getNpmrcPath())),
  }
}

/** Version texte pour insertion dans un prompt Markdown. */
export function formatInstallEnvironment(env) {
  return Object.entries(env)
    .map(([key, value]) => {
      const text = Array.isArray(value) ? (value.join('\n') || '(introuvable)') : String(value)
      return text.includes('\n') ? `- **${key}** :\n\`\`\`\n${text}\n\`\`\`` : `- **${key}** : ${text}`
    })
    .join('\n')
}

import * as cp from 'child_process'
import * as fs from 'fs'
import * as http from 'http'
import * as path from 'path'
import { promisify } from 'util'
import * as vscode from 'vscode'

const execAsync = promisify(cp.exec)

const BASE_PORT = 3920
const MAX_PORT = 3925
const START_TIMEOUT_MS = 45_000

interface WizardPathConfig {
  repairDir?: string
  vendorNodeRel?: string
  legacyDefaultsFile?: string
}

const FALLBACK_PATHS: WizardPathConfig = {
  repairDir: '00_Scripts_Implementation/01_reparation-poste-travail',
  vendorNodeRel: 'vendor/node/node.exe',
  legacyDefaultsFile:
    '00_Scripts_Implementation/00_portail-poste-travail/conf/wizard.defaults.json',
}

function loadWizardPathConfig(
  extensionPath: string,
  repoRoot: string,
  confDir: string
): WizardPathConfig {
  const merged: WizardPathConfig = { ...FALLBACK_PATHS }
  const files = [
    path.join(extensionPath, 'server', 'conf', 'wizard.paths.example.json'),
    path.join(confDir, 'wizard.paths.json'),
  ]
  for (const file of files) {
    if (!fs.existsSync(file)) continue
    try {
      Object.assign(merged, JSON.parse(fs.readFileSync(file, 'utf8')))
    } catch {
      /* ignore invalid JSON */
    }
  }
  return merged
}

function vendorNodePath(
  repoRoot: string,
  cfg: WizardPathConfig
): string | undefined {
  const repairDir = cfg.repairDir || FALLBACK_PATHS.repairDir
  const vendorRel = cfg.vendorNodeRel || FALLBACK_PATHS.vendorNodeRel
  if (!repairDir || !vendorRel) return undefined
  return path.join(repoRoot, repairDir, ...vendorRel.split('/'))
}

export class PortailServer {
  private process: cp.ChildProcess | undefined
  private activePort = BASE_PORT

  constructor(
    private readonly extensionPath: string,
    private readonly repoRoot: string,
    private readonly confDir: string
  ) {}

  getPort(): number {
    return this.activePort
  }

  getBaseUrl(): string {
    return `http://127.0.0.1:${this.activePort}`
  }

  pageUrl(pagePath: string, query = ''): string {
    const q = query ? (query.startsWith('?') ? query : `?${query}`) : ''
    const embed = q.includes('embed=') ? q : `${q}${q ? '&' : '?'}embed=vscode`
    return `${this.getBaseUrl()}${pagePath}${embed}`
  }

  async start(): Promise<number> {
    const expectedVersion = this.getExtensionVersion()

    if (this.process && !this.process.killed) {
      if (await this.probeHealth(this.activePort, expectedVersion)) {
        return this.activePort
      }
      await this.stop()
    }

    const config = vscode.workspace.getConfiguration('wizardQa')
    const port = config.get<number>('port', BASE_PORT)

    // Libère les ports si un ancien serveur Node orphelin écoute encore (cause fréquente après Reload Window).
    await this.releaseWizardPorts(port, expectedVersion)

    const script = path.join(this.extensionPath, 'server', 'portail.mjs')
    if (!fs.existsSync(script)) {
      throw new Error(`Serveur introuvable : ${script}`)
    }

    const nodePath = this.resolveNodePath(config.get<string>('nodePath', ''))
    const pathCfg = loadWizardPathConfig(
      this.extensionPath,
      this.repoRoot,
      this.confDir
    )
    const vendor = vendorNodePath(this.repoRoot, pathCfg)

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      WIZARD_REPO_ROOT: this.repoRoot,
      WIZARD_CONF_DIR: this.confDir,
      PORTAIL_EMBEDDED: '1',
      PORTAIL_PORT: String(port),
      WIZARD_EXTENSION_VERSION: expectedVersion,
    }
    if (vendor && fs.existsSync(vendor)) {
      env.WIZARD_VENDOR_NODE = vendor
    }

    let announcedPort: number | undefined

    this.process = cp.spawn(nodePath, [script, '--embedded'], {
      cwd: this.repoRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    let lastStderr = ''

    this.process.stdout?.on('data', (d) => {
      console.log(`[wizard-qa] ${d}`)
      const m = /127\.0\.0\.1:(\d+)/.exec(d.toString())
      if (m) announcedPort = Number(m[1])
    })
    this.process.stderr?.on('data', (d) => {
      const text = d.toString()
      lastStderr = `${lastStderr}${text}`.slice(-2000)
      console.error(`[wizard-qa] ${d}`)
    })
    this.process.on('exit', (code) => {
      if (code && code !== 0) {
        vscode.window.showWarningMessage(`Wizard QA : serveur arrêté (code ${code})`)
      }
    })

    const deadline = Date.now() + START_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (this.process.exitCode !== null) {
        const hint = lastStderr.trim()
          ? ` Détail : ${lastStderr.trim().slice(-400)}`
          : ''
        throw new Error(`Le serveur Node s'est arrêté avant d'être prêt.${hint}`)
      }

      const tryPort = announcedPort ?? port
      if (await this.probeHealth(tryPort, expectedVersion)) {
        this.activePort = tryPort
        return this.activePort
      }

      await sleep(250)
    }

    await this.stop()
    throw new Error(`Timeout : aucune réponse sur le port ${port}–${Math.min(port + 5, MAX_PORT)}`)
  }

  async stop(): Promise<void> {
    if (!this.process) return
    const proc = this.process
    this.process = undefined
    if (!proc.killed) {
      proc.kill()
      await sleep(500)
      if (!proc.killed) proc.kill('SIGKILL')
    }
  }

  async restart(): Promise<number> {
    await this.stop()
    await sleep(400)
    return this.start()
  }

  private resolveNodePath(configured: string): string {
    if (configured && fs.existsSync(configured)) return configured
    const envVendor = process.env.WIZARD_VENDOR_NODE
    if (envVendor && fs.existsSync(envVendor)) return envVendor
    const pathCfg = loadWizardPathConfig(
      this.extensionPath,
      this.repoRoot,
      this.confDir
    )
    const vendor = vendorNodePath(this.repoRoot, pathCfg)
    if (vendor && fs.existsSync(vendor)) return vendor
    return process.platform === 'win32' ? 'node.exe' : 'node'
  }

  private getExtensionVersion(): string {
    try {
      const pkgPath = path.join(this.extensionPath, 'package.json')
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
      return String(pkg.version || '0.0.0')
    } catch {
      return '0.0.0'
    }
  }

  /** Tue les serveurs Wizard orphelins (autre version ou processus sans parent extension). */
  private async releaseWizardPorts(basePort: number, expectedVersion: string): Promise<void> {
    const maxPort = Math.min(basePort + 5, MAX_PORT)
    for (let p = basePort; p <= maxPort; p++) {
      const remote = await this.fetchHealth(p)
      if (!remote?.ok) continue
      const sameVersion = remote.version === expectedVersion
      const owned = Boolean(this.process && !this.process.killed && p === this.activePort)
      if (!sameVersion || !owned) {
        await this.killListenersOnPort(p)
      }
    }
  }

  private async killListenersOnPort(port: number): Promise<void> {
    if (process.platform === 'win32') {
      try {
        const { stdout } = await execAsync(`netstat -ano | findstr :${port}`)
        const pids = new Set<number>()
        for (const line of stdout.split('\n')) {
          if (!/LISTENING/i.test(line)) continue
          const parts = line.trim().split(/\s+/)
          const pid = Number.parseInt(parts[parts.length - 1] || '', 10)
          if (pid > 0 && pid !== process.pid) pids.add(pid)
        }
        for (const pid of pids) {
          try {
            await execAsync(`taskkill /PID ${pid} /F`)
          } catch { /* déjà arrêté */ }
        }
      } catch { /* port libre */ }
      return
    }
    try {
      await execAsync(`fuser -k ${port}/tcp`)
    } catch { /* ignore */ }
  }

  private fetchHealth(port: number): Promise<{ ok: boolean; version: string } | null> {
    return new Promise((resolve) => {
      const req = http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c as Buffer))
        res.on('end', () => {
          if (res.statusCode !== 200) {
            resolve(null)
            return
          }
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            resolve({ ok: Boolean(data.ok), version: String(data.version || '') })
          } catch {
            resolve(null)
          }
        })
      })
      req.on('error', () => resolve(null))
      req.setTimeout(400, () => {
        req.destroy()
        resolve(null)
      })
    })
  }

  private probeHealth(port: number, expectedVersion: string): Promise<boolean> {
    return this.fetchHealth(port).then((h) => Boolean(h?.ok && h.version === expectedVersion))
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export function getRepoRoot(): string | undefined {
  const folders = vscode.workspace.workspaceFolders
  if (!folders?.length) return undefined
  for (const folder of folders) {
    const root = folder.uri.fsPath
    if (fs.existsSync(path.join(root, 'package.json'))) {
      return root
    }
  }
  return folders[0].uri.fsPath
}

export function getConfDir(repoRoot: string): string {
  return path.join(repoRoot, '.wizard-qa', 'conf')
}

export function migrateLegacyDefaults(
  repoRoot: string,
  confDir: string,
  extensionPath: string
): void {
  const pathCfg = loadWizardPathConfig(extensionPath, repoRoot, confDir)
  const legacyRel = pathCfg.legacyDefaultsFile
  if (!legacyRel) return
  const legacy = path.join(repoRoot, legacyRel)
  const target = path.join(confDir, 'wizard.defaults.json')
  if (fs.existsSync(legacy) && !fs.existsSync(target)) {
    fs.mkdirSync(confDir, { recursive: true })
    fs.copyFileSync(legacy, target)
  }
}

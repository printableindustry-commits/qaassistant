/**
 * Serveur Wizard QA intégré : lance ../server/portail.mjs (copié dans l'extension au build)
 * en processus fils, sur un port libre de la boucle locale, en mode --embedded.
 */
import * as cp from 'child_process'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as http from 'http'
import * as net from 'net'
import * as path from 'path'
import * as vscode from 'vscode'

const START_TIMEOUT_MS = 45_000

export class EmbeddedServer implements vscode.Disposable {
  private proc: cp.ChildProcess | undefined
  private port = 0
  private starting: Promise<string> | undefined
  /** Jeton d'appairage du pont Copilot local, transmis au serveur (WIZARD_BRIDGE_TOKEN). */
  readonly bridgeToken = crypto.randomBytes(24).toString('base64url')

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel,
    private readonly onChange: () => void
  ) {}

  isRunning(): boolean {
    return Boolean(this.proc && this.proc.exitCode === null && this.port)
  }

  get baseUrl(): string | undefined {
    return this.isRunning() ? `http://127.0.0.1:${this.port}` : undefined
  }

  /** Démarre le serveur s'il ne tourne pas ; renvoie son URL de base. */
  start(): Promise<string> {
    if (this.isRunning()) return Promise.resolve(this.baseUrl as string)
    if (!this.starting) {
      this.starting = this.launch().finally(() => {
        this.starting = undefined
      })
    }
    return this.starting
  }

  async restart(): Promise<string> {
    await this.stop()
    return this.start()
  }

  async stop(): Promise<void> {
    const proc = this.proc
    this.proc = undefined
    this.port = 0
    if (!proc || proc.exitCode !== null) return
    this.log('Arrêt du serveur intégré.')
    await killTree(proc)
    this.onChange()
  }

  dispose(): void {
    void this.stop()
  }

  private async launch(): Promise<string> {
    const script = path.join(this.context.extensionPath, 'server', 'portail.mjs')
    if (!fs.existsSync(script)) throw new Error(`Serveur introuvable : ${script}`)

    const config = vscode.workspace.getConfiguration('wizardQa')
    const repoRoot = resolveRepoRoot(this.context, config.get<string>('repoRoot', ''))
    fs.mkdirSync(repoRoot, { recursive: true })
    const node = resolveNode(config.get<string>('nodePath', ''))
    const port = await freePort()
    const version = String(this.context.extension.packageJSON.version || '0.0.0')

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...node.env,
      WIZARD_REPO_ROOT: repoRoot,
      WIZARD_EXTENSION_VERSION: version,
      WIZARD_BRIDGE_TOKEN: this.bridgeToken,
      PORTAIL_PORT: String(port),
      PORTAIL_HOST: '127.0.0.1',
      PORTAIL_NO_BROWSER: '1',
      PORTAIL_EMBEDDED: '1',
    }
    this.log(`Démarrage du serveur intégré (${node.label}, port ${port}, projet ${repoRoot}).`)

    const proc = cp.spawn(node.command, [script, '--embedded'], {
      cwd: repoRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.proc = proc
    let announced = 0
    let lastErr = ''
    let spawnError: Error | undefined

    proc.on('error', (err) => {
      spawnError = err
    })
    proc.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      this.output.append(text)
      const m = /http:\/\/127\.0\.0\.1:(\d+)\//.exec(text)
      if (m) announced = Number(m[1])
    })
    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      lastErr = `${lastErr}${text}`.slice(-2000)
      this.output.append(text)
    })
    proc.on('exit', (code) => {
      this.log(`Serveur intégré arrêté (code ${code ?? 'signal'}).`)
      if (this.proc === proc) {
        this.proc = undefined
        this.port = 0
        this.onChange()
      }
    })

    const deadline = Date.now() + START_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (spawnError) {
        this.proc = undefined
        throw new Error(`Node.js introuvable (${node.command}) : ${spawnError.message}. Renseignez wizardQa.nodePath.`)
      }
      if (proc.exitCode !== null) {
        this.proc = undefined
        const hint = lastErr.trim() ? ` Détail : ${lastErr.trim().slice(-400)}` : ''
        throw new Error(`Le serveur s'est arrêté avant d'être prêt.${hint}`)
      }
      const p = announced || port
      if (await healthy(p)) {
        this.port = p
        this.log(`Serveur intégré prêt : http://127.0.0.1:${p}/`)
        this.onChange()
        return `http://127.0.0.1:${p}`
      }
      await sleep(250)
    }
    await killTree(proc)
    this.proc = undefined
    throw new Error(`Le serveur intégré ne répond pas sur le port ${port}.`)
  }

  private log(message: string): void {
    this.output.appendLine(`[${new Date().toLocaleTimeString('fr-FR')}] ${message}`)
  }
}

/** Réglage wizardQa.repoRoot, sinon premier dossier ouvert, sinon stockage global de l'extension. */
export function resolveRepoRoot(context: vscode.ExtensionContext, configured: string): string {
  if (configured.trim()) return path.resolve(configured.trim())
  const folder = vscode.workspace.workspaceFolders?.[0]
  if (folder && folder.uri.scheme === 'file') return folder.uri.fsPath
  return path.join(context.globalStorageUri.fsPath, 'workspace')
}

/** Node du réglage, sinon celui du PATH, sinon le Node embarqué par VS Code (ELECTRON_RUN_AS_NODE). */
function resolveNode(configured: string): { command: string; env: NodeJS.ProcessEnv; label: string } {
  if (configured.trim()) return { command: configured.trim(), env: {}, label: configured.trim() }
  const probe = cp.spawnSync('node', ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 5000 })
  if (probe.status === 0) return { command: 'node', env: {}, label: `node ${probe.stdout.trim()}` }
  return { command: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' }, label: `Node de VS Code ${process.versions.node}` }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      srv.close(() => resolve(port))
    })
  })
}

function healthy(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout: 800 }, (res) => {
      res.resume()
      resolve(res.statusCode === 200)
    })
    req.on('error', () => resolve(false))
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
  })
}

/** Arrête le serveur et ses processus fils (runs k6, Playwright…). */
async function killTree(proc: cp.ChildProcess): Promise<void> {
  if (proc.exitCode !== null || !proc.pid) return
  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      cp.execFile('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true }, () => resolve())
    })
  } else {
    proc.kill('SIGTERM')
    await sleep(500)
    if (proc.exitCode === null) proc.kill('SIGKILL')
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

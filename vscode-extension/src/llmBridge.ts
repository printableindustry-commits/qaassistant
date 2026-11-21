/**
 * Pont « Copilot local » : relaie au serveur Wizard QA les requêtes destinées à GitHub Copilot.
 *
 * Le serveur ne peut pas joindre VS Code ; l'extension vient donc chercher le travail :
 *   POST /api/llm/bridge/hello       présentation et modèles Copilot visibles
 *   GET  /api/llm/bridge/next        attente longue (25 s) d'une requête
 *   POST /api/llm/bridge/:id/result  texte produit par Copilot, ou erreur explicite
 *   POST /api/llm/bridge/heartbeat   signe de vie toutes les 10 s
 * Chaque appel porte le jeton d'appairage (Authorization: Bearer …), jamais écrit dans les journaux.
 *
 * L'API vscode.lm (VS Code 1.90+) est atteinte via (vscode as any).lm : @types/vscode est en 1.85.
 */
import * as http from 'http'
import * as https from 'https'
import * as vscode from 'vscode'

export interface BridgeTarget {
  baseUrl: string
  token: string
  source: 'settings' | 'embedded'
}

interface CopilotModelInfo {
  id: string
  name: string
  family: string
  vendor: string
  maxInputTokens?: number
}

interface CopilotInfo {
  available: boolean
  reason: string
  models: CopilotModelInfo[]
}

interface BridgeJob {
  id: string
  purpose: string
  system: string
  messages: { role: 'user' | 'assistant'; content: string }[]
  maxTokens: number
  family: string
  deadline: string
}

interface JobResult {
  ok: boolean
  text?: string
  model?: string
  error?: string
  code?: string
}

type BridgeState = 'off' | 'waiting' | 'connected' | 'error'

class BridgeHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

const POLL_WAIT_MS = 25_000
const HEARTBEAT_MS = 10_000
const MODELS_TTL_MS = 60_000
const MAX_BACKOFF_MS = 30_000
const COPILOT_CHAT_ID = 'GitHub.copilot-chat'
const JUSTIFICATION = 'Wizard QA utilise GitHub Copilot pour rédiger des scénarios de test, des diagnostics et des scripts de charge.'

// --------------------------------------------------------------------------- API vscode.lm

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const lmApi = (): any => (vscode as any).lm
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const lmMessage = (): any => (vscode as any).LanguageModelChatMessage

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Modèles Copilot accessibles depuis ce VS Code, avec la raison précise sinon. */
async function readCopilotInfo(): Promise<CopilotInfo> {
  const lm = lmApi()
  if (!lm?.selectChatModels || !lmMessage()) {
    return { available: false, reason: `VS Code ${vscode.version} ne fournit pas l'API vscode.lm : installez VS Code 1.90 ou plus récent.`, models: [] }
  }
  if (!vscode.extensions.getExtension(COPILOT_CHAT_ID)) {
    return { available: false, reason: 'L\'extension GitHub Copilot Chat n\'est pas installée dans VS Code.', models: [] }
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const models: any[] = await lm.selectChatModels({ vendor: 'copilot' })
    if (!models.length) {
      return {
        available: false,
        reason: 'GitHub Copilot Chat est installé, mais aucun modèle n\'est accessible : connectez-vous à GitHub dans VS Code avec un compte disposant d\'une licence Copilot.',
        models: [],
      }
    }
    return {
      available: true,
      reason: '',
      models: models.map((m) => ({ id: m.id, name: m.name || m.id, family: m.family || '', vendor: m.vendor || 'copilot', maxInputTokens: m.maxInputTokens })),
    }
  } catch (err) {
    return { available: false, reason: `Lecture des modèles Copilot impossible : ${errorText(err)}`, models: [] }
  }
}

/** Traduit une erreur vscode.lm en message actionnable. */
function describeLmError(err: unknown, cancelled: boolean): JobResult {
  if (cancelled) return { ok: false, code: 'timeout', error: 'Délai dépassé : Copilot n\'a pas terminé sa réponse à temps.' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const code = String((err as any)?.code || '')
  const messages: Record<string, string> = {
    NoPermissions: 'Accès à Copilot refusé : autorisez Wizard QA à utiliser les modèles de langage (commande « Wizard QA: Connecter Copilot local »).',
    Blocked: 'Copilot a bloqué la requête (quota atteint ou limite de débit) : réessayez plus tard.',
    NotFound: 'Le modèle Copilot demandé n\'est plus disponible dans VS Code.',
  }
  return { ok: false, code: code || 'error', error: messages[code] || `Erreur Copilot : ${errorText(err)}` }
}

// --------------------------------------------------------------------------- pont

export class LlmBridge implements vscode.Disposable {
  private running = false
  private loopId = 0
  private generation = 0
  private state: BridgeState = 'off'
  private detail = ''
  private connectedUrl = ''
  private heartbeat: NodeJS.Timeout | undefined
  private copilot: CopilotInfo | undefined
  private copilotAt = 0
  private warnedToken = false
  private wakeUp: (() => void) | undefined
  private readonly inflight = new Set<http.ClientRequest>()
  private readonly jobs = new Set<vscode.CancellationTokenSource>()
  private readonly statusItem: vscode.StatusBarItem
  private readonly disposables: vscode.Disposable[] = []

  constructor(
    private readonly extensionVersion: string,
    private readonly resolveTarget: () => BridgeTarget | undefined,
    private readonly output: vscode.OutputChannel
  ) {
    this.statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90)
    this.statusItem.command = 'wizardQa.connectCopilot'
    const lm = lmApi()
    if (lm?.onDidChangeChatModels) {
      this.disposables.push(lm.onDidChangeChatModels(() => {
        this.copilotAt = 0
        this.wakeUp?.()
      }))
    }
    this.render()
  }

  get isRunning(): boolean {
    return this.running
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.log('Pont Copilot local démarré.')
    // Un arrêt suivi d'un redémarrage rapide ne doit pas laisser tourner deux boucles en parallèle.
    void this.loop(++this.loopId)
  }

  stop(): void {
    if (!this.running) return
    this.running = false
    this.interrupt()
    for (const cts of this.jobs) cts.cancel()
    this.setState('off', 'Pont désactivé')
    this.log('Pont Copilot local arrêté.')
  }

  /** Coupe la connexion en cours ; la boucle repart aussitôt avec la cible à jour. */
  reconnect(): void {
    this.copilotAt = 0
    this.warnedToken = false
    this.interrupt()
  }

  dispose(): void {
    this.stop()
    this.statusItem.dispose()
    for (const d of this.disposables) d.dispose()
  }

  /** Lit les modèles Copilot puis lance un premier appel, qui déclenche le consentement de VS Code. */
  async authorizeCopilot(): Promise<CopilotInfo & { tested?: boolean; error?: string }> {
    const info = await this.copilotInfo(true)
    if (!info.available) return info
    const lm = lmApi()
    const models = await lm.selectChatModels({ vendor: 'copilot' })
    const cts = new vscode.CancellationTokenSource()
    const timer = setTimeout(() => cts.cancel(), 60_000)
    try {
      const response = await models[0].sendRequest(
        [lmMessage().User('Test de connexion de Wizard QA. Réponds exactement par : OK Wizard QA')],
        { justification: JUSTIFICATION },
        cts.token
      )
      let text = ''
      for await (const chunk of response.text) text += chunk
      return { ...info, tested: text.trim().length > 0 }
    } catch (err) {
      return { ...info, tested: false, error: describeLmError(err, cts.token.isCancellationRequested).error }
    } finally {
      clearTimeout(timer)
      cts.dispose()
    }
  }

  describe(): string {
    return this.detail
  }

  // ------------------------------------------------------------------ boucle principale

  private async loop(id: number): Promise<void> {
    let backoff = 2000
    const alive = (): boolean => this.running && id === this.loopId
    while (alive()) {
      const gen = this.generation
      const target = this.resolveTarget()
      if (!target) {
        this.setState('waiting', 'En attente d\'un serveur Wizard QA (serveur intégré arrêté et wizardQa.serverUrl vide).')
        await this.pause(10_000)
        continue
      }
      if (!target.token) {
        this.setState('error', 'Jeton d\'appairage manquant : renseignez wizardQa.bridgeToken (affiché sur la page Assistant IA).')
        await this.pause(15_000)
        continue
      }
      try {
        await this.hello(target)
        backoff = 2000
        this.connectedUrl = target.baseUrl
        this.setState('connected', `Connecté à ${target.baseUrl}`)
        this.startHeartbeat(target)
        while (alive() && gen === this.generation) {
          const r = await this.call(target, 'GET', `/api/llm/bridge/next?wait=${POLL_WAIT_MS}`, undefined, POLL_WAIT_MS + 10_000)
          if (r?.job) void this.handleJob(target, r.job as BridgeJob)
        }
      } catch (err) {
        this.stopHeartbeat()
        if (!alive() || gen !== this.generation) continue
        if (err instanceof BridgeHttpError && err.status === 401) {
          this.setState('error', `Jeton d'appairage refusé par ${target.baseUrl}.`)
          if (!this.warnedToken) {
            this.warnedToken = true
            void vscode.window.showWarningMessage(
              'Wizard QA : le serveur refuse le jeton d\'appairage. Copiez le jeton affiché sur la page « Assistant IA » dans le réglage wizardQa.bridgeToken.',
              'Ouvrir les réglages'
            ).then((choice) => {
              if (choice) void vscode.commands.executeCommand('workbench.action.openSettings', 'wizardQa.bridgeToken')
            })
          }
          backoff = MAX_BACKOFF_MS
        } else {
          this.setState('error', `Serveur injoignable (${target.baseUrl}) : ${errorText(err)}`)
        }
        this.log(`Connexion interrompue : ${errorText(err)} — nouvel essai dans ${Math.round(backoff / 1000)} s.`)
        await this.pause(backoff)
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS)
      }
    }
    if (id === this.loopId) this.stopHeartbeat()
  }

  private async hello(target: BridgeTarget): Promise<void> {
    await this.call(target, 'POST', '/api/llm/bridge/hello', {
      client: { name: 'vscode', version: this.extensionVersion, vscodeVersion: vscode.version },
      copilot: await this.copilotInfo(),
    })
  }

  private startHeartbeat(target: BridgeTarget): void {
    this.stopHeartbeat()
    this.heartbeat = setInterval(() => {
      void (async () => {
        try {
          await this.call(target, 'POST', '/api/llm/bridge/heartbeat', { copilot: await this.copilotInfo() })
        } catch {
          /* la boucle principale gère la reconnexion */
        }
      })()
    }, HEARTBEAT_MS)
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = undefined
  }

  private async copilotInfo(force = false): Promise<CopilotInfo> {
    if (!force && this.copilot && Date.now() - this.copilotAt < MODELS_TTL_MS) return this.copilot
    this.copilot = await readCopilotInfo()
    this.copilotAt = Date.now()
    this.render()
    return this.copilot
  }

  // ------------------------------------------------------------------ traitement d'une requête

  private async handleJob(target: BridgeTarget, job: BridgeJob): Promise<void> {
    const started = Date.now()
    this.log(`Requête ${job.id.slice(0, 8)} reçue (usage : ${job.purpose || 'chat'}).`)
    const result = await this.runJob(job)
    this.log(`Requête ${job.id.slice(0, 8)} ${result.ok ? 'traitée' : `en échec (${result.code})`} en ${Date.now() - started} ms.`)
    try {
      await this.call(target, 'POST', `/api/llm/bridge/${encodeURIComponent(job.id)}/result`, result)
    } catch (err) {
      this.log(`Résultat non transmis : ${errorText(err)}`)
    }
  }

  private async runJob(job: BridgeJob): Promise<JobResult> {
    const info = await this.copilotInfo()
    if (!info.available) return { ok: false, code: 'unavailable', error: info.reason }
    const lm = lmApi()
    const Msg = lmMessage()
    let models = job.family ? await lm.selectChatModels({ vendor: 'copilot', family: job.family }) : []
    if (!models.length) models = await lm.selectChatModels({ vendor: 'copilot' })
    if (!models.length) return { ok: false, code: 'unavailable', error: 'Aucun modèle Copilot accessible dans VS Code.' }
    const model = models[0]

    // vscode.lm n'a pas de rôle « système » : les consignes ouvrent la conversation.
    const messages = []
    if (job.system) messages.push(Msg.User(`Consignes à respecter pour toute la conversation :\n\n${job.system}`))
    for (const m of job.messages) messages.push(m.role === 'assistant' ? Msg.Assistant(m.content) : Msg.User(m.content))

    const cts = new vscode.CancellationTokenSource()
    this.jobs.add(cts)
    const remaining = Math.max(Date.parse(job.deadline) - Date.now() - 1000, 1000)
    const timer = setTimeout(() => cts.cancel(), remaining)
    try {
      const response = await model.sendRequest(messages, { justification: JUSTIFICATION }, cts.token)
      let text = ''
      for await (const chunk of response.text) text += chunk
      if (!text.trim()) return { ok: false, code: 'empty', error: 'Copilot a renvoyé une réponse vide.' }
      return { ok: true, text, model: model.name || model.id }
    } catch (err) {
      return describeLmError(err, cts.token.isCancellationRequested)
    } finally {
      clearTimeout(timer)
      this.jobs.delete(cts)
      cts.dispose()
    }
  }

  // ------------------------------------------------------------------ HTTP

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private call(target: BridgeTarget, method: string, pathname: string, body?: unknown, timeoutMs = 15_000): Promise<any> {
    return new Promise((resolve, reject) => {
      let url: URL
      try {
        url = new URL(pathname, `${target.baseUrl}/`)
      } catch {
        reject(new Error(`URL de serveur invalide : ${target.baseUrl}`))
        return
      }
      const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body), 'utf8')
      const client = url.protocol === 'https:' ? https : http
      const req = client.request(url, {
        method,
        headers: {
          Authorization: `Bearer ${target.token}`,
          Accept: 'application/json',
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
        },
      }, (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          this.inflight.delete(req)
          const raw = Buffer.concat(chunks).toString('utf8')
          let data: { ok?: boolean; error?: string } | null = null
          try {
            data = raw ? JSON.parse(raw) : {}
          } catch {
            data = null
          }
          const status = res.statusCode || 0
          if (status < 200 || status >= 300 || !data || data.ok === false) {
            reject(new BridgeHttpError(status, data?.error || `HTTP ${status}`))
            return
          }
          resolve(data)
        })
      })
      this.inflight.add(req)
      req.setTimeout(timeoutMs, () => req.destroy(new Error('délai de réponse dépassé')))
      req.on('error', (err) => {
        this.inflight.delete(req)
        reject(err)
      })
      req.end(payload)
    })
  }

  private interrupt(): void {
    this.generation += 1
    this.stopHeartbeat()
    for (const req of this.inflight) req.destroy(new Error('reconnexion'))
    this.inflight.clear()
    this.wakeUp?.()
  }

  private pause(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms)
      const self = this
      function done(): void {
        clearTimeout(timer)
        if (self.wakeUp === done) self.wakeUp = undefined
        resolve()
      }
      this.wakeUp = done
    })
  }

  // ------------------------------------------------------------------ affichage

  private setState(state: BridgeState, detail: string): void {
    const changed = state !== this.state || detail !== this.detail
    this.state = state
    this.detail = detail
    if (changed) this.render()
  }

  private render(): void {
    const item = this.statusItem
    const copilotOk = Boolean(this.copilot?.available)
    if (this.state === 'off') {
      item.hide()
      return
    }
    if (this.state === 'connected' && copilotOk) {
      item.text = '$(sparkle) Copilot ↔ Wizard QA'
      item.tooltip = `Copilot local branché sur ${this.connectedUrl}`
      item.backgroundColor = undefined
    } else if (this.state === 'connected') {
      item.text = '$(warning) Copilot ↔ Wizard QA'
      item.tooltip = `Connecté au serveur, mais Copilot est inaccessible : ${this.copilot?.reason || 'détection en cours'}`
      item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground')
    } else {
      item.text = this.state === 'error' ? '$(debug-disconnect) Copilot ↔ Wizard QA' : '$(sync) Copilot ↔ Wizard QA'
      item.tooltip = this.detail
      item.backgroundColor = this.state === 'error' ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined
    }
    item.show()
  }

  private log(message: string): void {
    this.output.appendLine(`[${new Date().toLocaleTimeString('fr-FR')}] ${message}`)
  }
}

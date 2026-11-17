import * as vscode from 'vscode'
import {
  getConfDir,
  getRepoRoot,
  migrateLegacyDefaults,
  PortailServer,
} from './portailServer'
import { WIZARD_PAGES, WizardPage, WizardAppPanel, WizardTreeProvider } from './wizardViews'
import { BridgeTarget, LlmBridge } from './llmBridge'

function pageById(id: string): WizardPage {
  const page = WIZARD_PAGES.find((p) => p.id === id)
  if (!page) throw new Error(`Page wizard inconnue : ${id}`)
  return page
}

let server: PortailServer | undefined
let treeProvider: WizardTreeProvider | undefined
let serverExtensionVersion: string | undefined
let llmBridge: LlmBridge | undefined

/** Cible du pont Copilot local : serveur configuré (wizardQa.serverUrl), sinon le serveur intégré lancé. */
function bridgeTarget(): BridgeTarget | undefined {
  const config = vscode.workspace.getConfiguration('wizardQa')
  const url = (config.get<string>('serverUrl', '') || '').trim().replace(/\/+$/, '')
  if (url) {
    return { baseUrl: url, token: (config.get<string>('bridgeToken', '') || '').trim(), source: 'settings' }
  }
  if (server?.isRunning()) {
    return { baseUrl: server.getBaseUrl(), token: server.getBridgeToken(), source: 'embedded' }
  }
  return undefined
}

function bridgeEnabled(): boolean {
  return vscode.workspace.getConfiguration('wizardQa').get<boolean>('llmBridge.enabled', true)
}

function setupLlmBridge(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Wizard QA — Copilot local')
  llmBridge = new LlmBridge(context.extension.packageJSON.version || '0.0.0', bridgeTarget, output)
  context.subscriptions.push(output, llmBridge)
  if (bridgeEnabled()) llmBridge.start()

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('wizardQa.llmBridge.enabled')) {
        if (bridgeEnabled()) llmBridge?.start()
        else llmBridge?.stop()
      } else if (e.affectsConfiguration('wizardQa.serverUrl') || e.affectsConfiguration('wizardQa.bridgeToken')) {
        llmBridge?.reconnect()
      }
    }),
    vscode.commands.registerCommand('wizardQa.connectCopilot', () => connectCopilot(context, output))
  )
}

/** Commande « Connecter Copilot local » : vérifie Copilot, obtient le consentement, branche le pont. */
async function connectCopilot(context: vscode.ExtensionContext, output: vscode.OutputChannel): Promise<void> {
  if (!llmBridge) return
  if (!bridgeEnabled()) {
    const choice = await vscode.window.showInformationMessage(
      'Wizard QA : le pont Copilot local est désactivé (wizardQa.llmBridge.enabled).',
      'Activer'
    )
    if (!choice) return
    await vscode.workspace.getConfiguration('wizardQa').update('llmBridge.enabled', true, vscode.ConfigurationTarget.Global)
  }

  if (!bridgeTarget()) {
    const choice = await vscode.window.showInformationMessage(
      'Wizard QA : aucun serveur à relier. Démarrer le serveur intégré, ou relier un serveur Wizard QA déjà lancé ?',
      'Démarrer le serveur intégré',
      'Relier un serveur'
    )
    if (choice === 'Démarrer le serveur intégré') {
      try {
        await ensureServer(context)
      } catch (err) {
        vscode.window.showErrorMessage(`Wizard QA : ${err instanceof Error ? err.message : String(err)}`)
        return
      }
    } else if (choice === 'Relier un serveur') {
      if (!(await askRemoteServer())) return
    } else {
      return
    }
  }

  llmBridge.start()
  llmBridge.reconnect()

  const result = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Wizard QA : vérification de GitHub Copilot…' },
    () => llmBridge!.authorizeCopilot()
  )
  if (!result.available) {
    const choice = await vscode.window.showWarningMessage(`Wizard QA : ${result.reason}`, 'Installer GitHub Copilot Chat')
    if (choice) void vscode.commands.executeCommand('workbench.extensions.search', 'GitHub.copilot-chat')
    return
  }
  if (result.error) {
    vscode.window.showWarningMessage(`Wizard QA : ${result.error}`)
    return
  }
  const target = bridgeTarget()
  output.appendLine(`Copilot vérifié (${result.models.map((m) => m.name).join(', ')}).`)
  vscode.window.showInformationMessage(
    `Wizard QA : Copilot local est branché sur ${target?.baseUrl ?? 'le serveur'} (${result.models.length} modèle(s) Copilot).`
  )
}

/** Demande l'URL et le jeton d'un serveur Wizard QA distant, puis les enregistre dans les réglages. */
async function askRemoteServer(): Promise<boolean> {
  const config = vscode.workspace.getConfiguration('wizardQa')
  const url = await vscode.window.showInputBox({
    title: 'Wizard QA : URL du serveur',
    prompt: 'Adresse affichée sur la page « Assistant IA » (par exemple http://127.0.0.1:3920).',
    value: config.get<string>('serverUrl', '') || 'http://127.0.0.1:3920',
    ignoreFocusOut: true,
    validateInput: (v) => (/^https?:\/\/[^\s]+$/i.test(v.trim()) ? undefined : 'Adresse http:// ou https:// attendue.'),
  })
  if (!url) return false
  const token = await vscode.window.showInputBox({
    title: 'Wizard QA : jeton d\'appairage',
    prompt: 'Copiez le jeton affiché sur la page « Assistant IA » › Brancher Copilot local.',
    password: true,
    ignoreFocusOut: true,
    validateInput: (v) => (v.trim().length >= 16 ? undefined : 'Jeton trop court.'),
  })
  if (!token) return false
  await config.update('serverUrl', url.trim().replace(/\/+$/, ''), vscode.ConfigurationTarget.Global)
  await config.update('bridgeToken', token.trim(), vscode.ConfigurationTarget.Global)
  return true
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  treeProvider = new WizardTreeProvider()
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('wizardQa.explorer', treeProvider)
  )
  setupLlmBridge(context)

  const openPage = async (page: WizardPage, query?: string) => {
    try {
      const srv = await ensureServer(context)
      await WizardAppPanel.show(context, page, srv.getBaseUrl(), query)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      vscode.window.showErrorMessage(`Wizard QA : ${msg}`)
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('wizardQa.open', (page: WizardPage) => openPage(page)),
    vscode.commands.registerCommand('wizardQa.openAccueil', () =>
      openPage(pageById('accueil'))
    ),
    vscode.commands.registerCommand('wizardQa.openHookGit', () =>
      openPage(pageById('hookGit'))
    ),
    vscode.commands.registerCommand('wizardQa.openProject', () =>
      openPage(pageById('project'))
    ),
    vscode.commands.registerCommand('wizardQa.openNpmrc', () =>
      openPage(pageById('npmrc'))
    ),
    vscode.commands.registerCommand('wizardQa.openRepair', () =>
      openPage(pageById('repair'))
    ),
    vscode.commands.registerCommand('wizardQa.openHook', () =>
      openPage(pageById('hook'))
    ),
    vscode.commands.registerCommand('wizardQa.openDocQa', () =>
      openPage(pageById('docQa'))
    ),
    vscode.commands.registerCommand('wizardQa.openWiki', () =>
      openPage(pageById('wiki'))
    ),
    vscode.commands.registerCommand('wizardQa.restartServer', async (options?: { skipReload?: boolean }) => {
      if (!server) {
        vscode.window.showInformationMessage('Wizard QA : serveur non démarré.')
        return
      }
      try {
        await server.restart()
        llmBridge?.reconnect()
        vscode.window.showInformationMessage(
          `Wizard QA : serveur redémarré (port ${server.getPort()}, v${context.extension.packageJSON.version})`
        )
        if (!options?.skipReload) {
          await WizardAppPanel.reload()
        }
        treeProvider?.refresh()
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        vscode.window.showErrorMessage(`Wizard QA : ${msg}`)
      }
    }),
    vscode.commands.registerCommand('wizardQa.stopServer', async () => {
      if (server) {
        await server.stop()
        server = undefined
        vscode.window.showInformationMessage('Wizard QA : serveur arrêté.')
      }
    })
  )

  context.subscriptions.push({
    dispose: () => {
      void server?.stop()
    },
  })

  if (vscode.workspace.getConfiguration('wizardQa').get('autoStart', true)) {
    const repo = getRepoRoot()
    if (repo) {
      void ensureServer(context).then(() => {
        void WizardAppPanel.reload()
      }).catch(() => {
        /* ouverture explicite affichera l'erreur */
      })
    }
  }

  const extensionVersion = context.extension.packageJSON.version || '0.0.0'
  if (server && serverExtensionVersion && serverExtensionVersion !== extensionVersion) {
    void (async () => {
      try {
        await server?.restart()
        serverExtensionVersion = extensionVersion
        await WizardAppPanel.reload()
      } catch {
        /* ignore */
      }
    })()
  }
}

export async function deactivate(): Promise<void> {
  await server?.stop()
  server = undefined
}

async function ensureServer(context: vscode.ExtensionContext): Promise<PortailServer> {
  const repoRoot = getRepoRoot()
  if (!repoRoot) {
    throw new Error(
      'Ouvrez le dossier racine du dépôt de tests (contenant package.json).'
    )
  }

  const confDir = getConfDir(repoRoot)
  migrateLegacyDefaults(repoRoot, confDir, context.extensionPath)

  const extensionVersion = context.extension.packageJSON.version || '0.0.0'
  const versionChanged = Boolean(
    server && serverExtensionVersion && serverExtensionVersion !== extensionVersion
  )

  if (!server) {
    server = new PortailServer(context.extensionPath, repoRoot, confDir)
  } else if (versionChanged) {
    await server.restart()
  }

  await server.start()
  serverExtensionVersion = extensionVersion
  // Le pont Copilot local se branche aussitôt sur le serveur intégré (port éventuellement changé).
  llmBridge?.reconnect()
  return server
}

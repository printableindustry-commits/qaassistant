/**
 * Extension VS Code « Wizard QA » : la même application web que `npm start`, servie par un serveur
 * intégré (copie de server/ embarquée dans le .vsix) et affichée dans un panneau, plus le pont Copilot local.
 */
import * as vscode from 'vscode'
import { BridgeTarget, LlmBridge } from './llmBridge'
import { AppPanel } from './panel'
import { PagesProvider, WizardPage } from './pages'
import { EmbeddedServer } from './server'

let server: EmbeddedServer | undefined

function config(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('wizardQa')
}

/** Serveur externe configuré (wizardQa.serverUrl), sans barre finale. */
function externalUrl(): string {
  return (config().get<string>('serverUrl', '') || '').trim().replace(/\/+$/, '')
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Wizard QA')
  const pages = new PagesProvider()
  const embedded = new EmbeddedServer(context, output, () => void pages.refresh(currentUrl()))
  server = embedded

  function currentUrl(): string | undefined {
    return externalUrl() || embedded.baseUrl
  }

  /** URL du serveur à utiliser : externe si configuré, sinon le serveur intégré (démarré au besoin). */
  async function ensureUrl(): Promise<string> {
    const ext = externalUrl()
    if (ext) return ext
    return vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: 'Wizard QA : démarrage du serveur…' },
      () => embedded.start()
    )
  }

  function pagePath(arg?: WizardPage | string): string {
    const p = typeof arg === 'string' ? arg : arg?.path
    return p && p.startsWith('/') ? p : '/'
  }

  async function open(arg?: WizardPage | string): Promise<void> {
    try {
      const url = await ensureUrl()
      if (externalUrl()) {
        // La session (cookie SameSite=Lax) d'un serveur externe ne passe pas dans une vue VS Code.
        await vscode.env.openExternal(vscode.Uri.parse(`${url}${pagePath(arg)}`))
        return
      }
      await AppPanel.show(context, url, pagePath(arg))
    } catch (err) {
      output.appendLine(`Erreur : ${errorText(err)}`)
      void vscode.window.showErrorMessage(`Wizard QA : ${errorText(err)}`, 'Afficher le journal').then((c) => {
        if (c) output.show()
      })
    }
  }

  async function openInBrowser(arg?: WizardPage | string): Promise<void> {
    try {
      const url = await ensureUrl()
      const target = await vscode.env.asExternalUri(vscode.Uri.parse(`${url}${pagePath(arg)}`))
      await vscode.env.openExternal(target)
    } catch (err) {
      void vscode.window.showErrorMessage(`Wizard QA : ${errorText(err)}`)
    }
  }

  // ------------------------------------------------------------------ pont Copilot local

  const bridgeOutput = vscode.window.createOutputChannel('Wizard QA — Copilot local')
  const bridgeTarget = (): BridgeTarget | undefined => {
    const ext = externalUrl()
    if (ext) return { baseUrl: ext, token: (config().get<string>('bridgeToken', '') || '').trim(), source: 'settings' }
    const url = embedded.baseUrl
    return url ? { baseUrl: url, token: embedded.bridgeToken, source: 'embedded' } : undefined
  }
  const bridgeEnabled = (): boolean => config().get<boolean>('llmBridge.enabled', true)
  const bridge = new LlmBridge(String(context.extension.packageJSON.version || '0.0.0'), bridgeTarget, bridgeOutput)
  if (bridgeEnabled()) bridge.start()

  async function connectCopilot(): Promise<void> {
    if (!bridgeEnabled()) {
      const choice = await vscode.window.showInformationMessage('Wizard QA : le pont Copilot local est désactivé.', 'Activer')
      if (!choice) return
      await config().update('llmBridge.enabled', true, vscode.ConfigurationTarget.Global)
    }
    try {
      await ensureUrl()
    } catch (err) {
      void vscode.window.showErrorMessage(`Wizard QA : ${errorText(err)}`)
      return
    }
    bridge.start()
    bridge.reconnect()
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Wizard QA : vérification de GitHub Copilot…' },
      () => bridge.authorizeCopilot()
    )
    if (!result.available) {
      const choice = await vscode.window.showWarningMessage(`Wizard QA : ${result.reason}`, 'Installer GitHub Copilot Chat')
      if (choice) void vscode.commands.executeCommand('workbench.extensions.search', 'GitHub.copilot-chat')
      return
    }
    if (result.error) {
      void vscode.window.showWarningMessage(`Wizard QA : ${result.error}`)
      return
    }
    void vscode.window.showInformationMessage(
      `Wizard QA : Copilot local est branché sur ${bridgeTarget()?.baseUrl ?? 'le serveur'} (${result.models.length} modèle(s)).`
    )
  }

  // ------------------------------------------------------------------ enregistrement

  // Ordre de libération = ordre d'ajout : les canaux de sortie en dernier (le pont y écrit en s'arrêtant).
  context.subscriptions.push(
    bridge,
    pages,
    embedded,
    vscode.window.registerTreeDataProvider('wizardQa.pages', pages),
    vscode.commands.registerCommand('wizardQa.open', (arg?: WizardPage | string) => open(arg)),
    vscode.commands.registerCommand('wizardQa.openInBrowser', (arg?: WizardPage | string) => openInBrowser(arg)),
    vscode.commands.registerCommand('wizardQa.demo', () => open('/?demo=1')),
    vscode.commands.registerCommand('wizardQa.refreshPages', () => pages.refresh(currentUrl())),
    vscode.commands.registerCommand('wizardQa.showLog', () => output.show()),
    vscode.commands.registerCommand('wizardQa.connectCopilot', () => connectCopilot()),
    vscode.commands.registerCommand('wizardQa.restartServer', async () => {
      if (externalUrl()) {
        void vscode.window.showInformationMessage('Wizard QA : serveur externe configuré (wizardQa.serverUrl), rien à redémarrer.')
        return
      }
      try {
        const url = await embedded.restart()
        bridge.reconnect()
        await AppPanel.show(context, url, '/')
      } catch (err) {
        void vscode.window.showErrorMessage(`Wizard QA : ${errorText(err)}`)
      }
    }),
    vscode.commands.registerCommand('wizardQa.stopServer', async () => {
      AppPanel.close()
      await embedded.stop()
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('wizardQa.llmBridge.enabled')) {
        if (bridgeEnabled()) bridge.start()
        else bridge.stop()
      }
      if (e.affectsConfiguration('wizardQa.serverUrl') || e.affectsConfiguration('wizardQa.bridgeToken')) {
        bridge.reconnect()
        void pages.refresh(currentUrl())
      }
    }),
    bridgeOutput,
    output
  )

  output.appendLine(`Wizard QA ${context.extension.packageJSON.version} activé.`)
  void pages.refresh(currentUrl())
}

/** VS Code attend la promesse : le serveur intégré et ses processus fils sont arrêtés proprement. */
export function deactivate(): Promise<void> | undefined {
  return server?.stop()
}

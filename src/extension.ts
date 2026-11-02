import * as vscode from 'vscode'
import {
  getConfDir,
  getRepoRoot,
  migrateLegacyDefaults,
  PortailServer,
} from './portailServer'
import { WIZARD_PAGES, WizardPage, WizardAppPanel, WizardTreeProvider } from './wizardViews'

function pageById(id: string): WizardPage {
  const page = WIZARD_PAGES.find((p) => p.id === id)
  if (!page) throw new Error(`Page wizard inconnue : ${id}`)
  return page
}

let server: PortailServer | undefined
let treeProvider: WizardTreeProvider | undefined
let serverExtensionVersion: string | undefined

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  treeProvider = new WizardTreeProvider()
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('wizardQa.explorer', treeProvider)
  )

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
  return server
}

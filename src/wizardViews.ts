import * as vscode from 'vscode'
import * as path from 'path'
import { loadWizardPageHtml, pagePathFromUrl } from './pageLoader'

export interface WizardPage {
  id: string
  label: string
  path: string
  description: string
}

export const WIZARD_PAGES: WizardPage[] = [
  { id: 'accueil', label: 'Accueil', path: '/', description: 'Parcours guidés et prochaine étape' },
  { id: 'projet', label: 'Mon projet', path: '/projet.html', description: 'Équipe, application et sauvegarde de la configuration' },
  { id: 'hookGit', label: 'Hook Git', path: '/hook-git.html', description: '.env, hooks.conf, post-commit' },
  { id: 'project', label: 'Sync JIRA', path: '/project.html', description: 'Plans de test, Testing Board, Xray Cloud' },
  { id: 'npmrc', label: 'Éditer .npmrc', path: '/npmrc.html', description: 'Registry CATS et token npm' },
  { id: 'nodeInstall', label: 'Installation Node.js', path: '/node-install.html', description: 'Volta, Node et package.json' },
  { id: 'npmInstall', label: 'Installer NPM', path: '/npm-install.html', description: 'npm install des dépendances' },
  { id: 'playwrightInstall', label: 'Installer Playwright', path: '/playwright-install.html', description: '@playwright/test et navigateurs' },
  { id: 'k6Wizard', label: 'Wizard k6 Performance', path: '/k6-wizard.html', description: 'Questionnaire charge, profils & historique' },
  { id: 'k6Install', label: 'Installer k6', path: '/k6-install.html', description: 'Binaire Grafana k6 et scaffold' },
  { id: 'repair', label: 'Pré-configuration poste', path: '/repair.html', description: 'Node, npm, Cypress offline' },
  { id: 'hook', label: 'Hook JIRA / Xray', path: '/hook-git.html', description: '.env, hooks.conf, assistant multi-étapes' },
  { id: 'docQa', label: 'Documentation QA', path: '/doc-qa.html', description: 'Assistant rédaction livrables Word + prompt IA' },
  { id: 'wiki', label: 'Wiki', path: '/wiki.html', description: 'Documentation interactive CA-TS' },
]

export class WizardTreeProvider implements vscode.TreeDataProvider<WizardTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<WizardTreeItem | undefined>()
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined)
  }

  getTreeItem(element: WizardTreeItem): vscode.TreeItem {
    return element
  }

  getChildren(): vscode.ProviderResult<WizardTreeItem[]> {
    return WIZARD_PAGES.map(
      (p) =>
        new WizardTreeItem(
          p.label,
          vscode.TreeItemCollapsibleState.None,
          p,
          p.description
        )
    )
  }
}

export class WizardTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly page: WizardPage,
    description: string
  ) {
    super(label, collapsibleState)
    this.description = description
    this.contextValue = 'wizardPage'
    this.iconPath = new vscode.ThemeIcon('settings-gear')
    this.command = {
      command: 'wizardQa.open',
      title: 'Ouvrir',
      arguments: [page],
    }
  }
}

function resolveWizardPage(pagePath: string): WizardPage | undefined {
  const pathOnly = pagePath.split('?')[0] || '/'
  const normalized = pathOnly === '/index.html' ? '/' : pathOnly
  return WIZARD_PAGES.find((p) => p.path === normalized)
}

/** Panneau unique — contenu injecté (plus d'iframe), thème VS Code. */
export class WizardAppPanel {
  private static panel: vscode.WebviewPanel | undefined
  private static context: vscode.ExtensionContext | undefined
  private static baseUrl = ''
  private static currentPage: WizardPage | undefined
  /** false tant que le premier HTML n'a pas été chargé dans la webview */
  private static shellReady = false

  static async show(
    context: vscode.ExtensionContext,
    page: WizardPage,
    baseUrl: string,
    query?: string
  ): Promise<void> {
    WizardAppPanel.context = context
    WizardAppPanel.baseUrl = baseUrl
    WizardAppPanel.currentPage = page

    if (!WizardAppPanel.panel) {
      WizardAppPanel.panel = vscode.window.createWebviewPanel(
        'wizardQa',
        'Wizard QA Assistant',
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: false,
          localResourceRoots: [],
        }
      )
      WizardAppPanel.panel.iconPath = vscode.Uri.joinPath(
        context.extensionUri,
        'media',
        'icon.png'
      )
      WizardAppPanel.panel.webview.onDidReceiveMessage((msg) => {
        void WizardAppPanel.handleMessage(msg)
      })
      WizardAppPanel.panel.onDidDispose(() => {
        WizardAppPanel.panel = undefined
        WizardAppPanel.currentPage = undefined
        WizardAppPanel.shellReady = false
      })
    }

    await WizardAppPanel.render(page, query)
    WizardAppPanel.panel.reveal(vscode.ViewColumn.One)
  }

  static async reload(): Promise<void> {
    if (WizardAppPanel.panel && WizardAppPanel.currentPage) {
      await WizardAppPanel.render(WizardAppPanel.currentPage)
    }
  }

  private static async openCopilotAgent(query: string): Promise<boolean> {
    const attempts: Array<Record<string, unknown>> = [
      { query, mode: 'agent', isPartialQuery: false },
      { query, isPartialQuery: false },
    ]
    for (const args of attempts) {
      try {
        await vscode.commands.executeCommand('workbench.action.chat.open', args)
        return true
      } catch {
        /* version de VS Code sans ce mode : essai suivant */
      }
    }
    await vscode.env.clipboard.writeText(query)
    vscode.window.showWarningMessage(
      'Wizard QA — Copilot Chat indisponible : la demande est copiée dans le presse-papiers, collez-la dans le chat.',
    )
    return false
  }

  private static async handleMessage(msg: {
    type?: string
    path?: string
    relativePath?: string
    skipReload?: boolean
    extensionId?: string
    command?: string
    query?: string
    runId?: string
  }): Promise<void> {
    if (msg.type === 'askCopilot' && msg.query) {
      const ok = await WizardAppPanel.openCopilotAgent(msg.query)
      void WizardAppPanel.panel?.webview.postMessage({ type: 'copilotOpened', ok, runId: msg.runId })
      return
    }
    if (msg.type === 'openExternal' && msg.relativePath) {
      const repoRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
      if (repoRoot) {
        const fileUri = vscode.Uri.file(
          path.join(repoRoot, msg.relativePath.replace(/\//g, path.sep))
        )
        await vscode.env.openExternal(fileUri)
      }
      return
    }
    if (msg.type === 'openFile' && msg.relativePath && WizardAppPanel.context) {
      const abs = vscode.Uri.file(
        path.join(WizardAppPanel.context.extensionUri.fsPath, '..', '..', msg.relativePath)
      )
      const repoRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
      const fileUri = repoRoot
        ? vscode.Uri.file(path.join(repoRoot, msg.relativePath.replace(/\//g, path.sep)))
        : abs
      try {
        await vscode.window.showTextDocument(fileUri)
      } catch {
        vscode.env.openExternal(fileUri)
      }
      return
    }
    if (msg.type === 'restartServer') {
      await vscode.commands.executeCommand('wizardQa.restartServer', {
        skipReload: Boolean(msg.skipReload),
      })
      return
    }
    if (msg.type === 'installVscodeExtension' && msg.extensionId) {
      try {
        await vscode.commands.executeCommand(
          'workbench.extensions.installExtension',
          msg.extensionId,
        )
        vscode.window.showInformationMessage(
          `Playwright : extension ${msg.extensionId} installée (ou déjà présente).`,
        )
      } catch (err) {
        const text = err instanceof Error ? err.message : String(err)
        vscode.window.showErrorMessage(`Wizard QA — extension VS Code : ${text}`)
      }
      return
    }
    if (msg.type === 'runVscodeCommand' && msg.command) {
      try {
        await vscode.commands.executeCommand(msg.command)
      } catch (err) {
        const text = err instanceof Error ? err.message : String(err)
        vscode.window.showWarningMessage(
          `Commande Playwright indisponible (${text}) — installez d'abord l'extension Playwright Test.`,
        )
        await vscode.commands.executeCommand(
          'workbench.extensions.search',
          '@id:ms-playwright.playwright',
        )
      }
      return
    }
    if (msg.type !== 'navigate' || !msg.path || !WizardAppPanel.context) return
    const pagePath = pagePathFromUrl(WizardAppPanel.baseUrl, msg.path)
    const page = resolveWizardPage(pagePath)
    const query = pagePath.includes('?') ? pagePath.slice(pagePath.indexOf('?')) : undefined
    if (page) {
      WizardAppPanel.currentPage = page
      await WizardAppPanel.render(page, query)
      return
    }
    if (WizardAppPanel.panel) {
      WizardAppPanel.panel.title = 'Wizard QA'
      const html = await loadWizardPageHtml(
        WizardAppPanel.baseUrl,
        pagePath
      )
      await WizardAppPanel.deliverHtml(html, pagePath)
    }
  }

  /** Premier chargement : webview.html. Ensuite : replacePage (conserve acquireVsCodeApi). */
  private static async deliverHtml(html: string, pathOnly = '/'): Promise<void> {
    if (!WizardAppPanel.panel) return
    if (!WizardAppPanel.shellReady) {
      WizardAppPanel.panel.webview.html = html
      WizardAppPanel.shellReady = true
      return
    }
    WizardAppPanel.panel.webview.postMessage({
      type: 'replacePage',
      html,
      pathOnly,
    })
  }

  private static async render(page: WizardPage, query?: string): Promise<void> {
    if (!WizardAppPanel.panel) return
    WizardAppPanel.panel.title = `Wizard QA — ${page.label}`
    try {
      const html = await loadWizardPageHtml(
        WizardAppPanel.baseUrl,
        page.path,
        query
      )
      await WizardAppPanel.deliverHtml(html, page.path + (query || ''))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      WizardAppPanel.shellReady = false
      WizardAppPanel.panel.webview.html = `<!DOCTYPE html><html><body style="padding:24px;font-family:var(--vscode-font-family);color:var(--vscode-errorForeground)"><h2>Erreur</h2><p>${escapeHtml(msg)}</p></body></html>`
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** @deprecated alias */
export const WizardPanel = WizardAppPanel

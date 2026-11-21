/**
 * Vue « Pages » : la navigation de l'application (rail Prisme), lue sur le serveur
 * (GET /api/app/model) quand il répond, sinon la liste statique ci-dessous.
 */
import * as http from 'http'
import * as https from 'https'
import * as vscode from 'vscode'

export interface WizardPage {
  label: string
  path: string
  icon?: string
}

const STATIC_PAGES: WizardPage[] = [
  { label: 'Pilotage', path: '/', icon: 'gauge' },
  { label: 'Connaissance', path: '/connaissance.html', icon: 'compass' },
  { label: 'Récits', path: '/recits.html', icon: 'listChecks' },
  { label: 'Automatiser', path: '/automatisation.html', icon: 'bot' },
  { label: 'Installation', path: '/installation.html', icon: 'download' },
  { label: 'Perf k6', path: '/perf.html', icon: 'activity' },
  { label: 'JIRA Xray', path: '/hook-git.html', icon: 'gitBranch' },
  { label: 'Livrables', path: '/livrables.html', icon: 'fileText' },
  { label: 'IA', path: '/ia.html', icon: 'sparkles' },
  { label: 'Aide', path: '/wiki.html', icon: 'book' },
  { label: 'Réglages', path: '/reglages.html', icon: 'settings' },
]

const DEMO_PAGE: WizardPage = { label: 'Démo', path: '/?demo=1', icon: 'play' }

/** Icônes Prisme → codicons VS Code (repli : cercle). */
const CODICONS: Record<string, string> = {
  gauge: 'dashboard',
  compass: 'compass',
  listChecks: 'checklist',
  bot: 'robot',
  download: 'cloud-download',
  activity: 'pulse',
  gitBranch: 'git-branch',
  fileText: 'file-text',
  sparkles: 'sparkle',
  book: 'book',
  settings: 'settings-gear',
  play: 'play',
}

export class PagesProvider implements vscode.TreeDataProvider<WizardPage> {
  private pages: WizardPage[] = STATIC_PAGES
  private readonly changed = new vscode.EventEmitter<void>()
  readonly onDidChangeTreeData = this.changed.event

  /** Relit la navigation sur le serveur ; garde la liste statique en cas d'échec. */
  async refresh(baseUrl: string | undefined): Promise<void> {
    let pages = STATIC_PAGES
    if (baseUrl) {
      try {
        const model = await getJson(`${baseUrl}/api/app/model`)
        const rail = Array.isArray(model?.rail) ? model.rail : []
        const fromServer = rail
          .filter((r: { label?: unknown; path?: unknown }) => typeof r.label === 'string' && typeof r.path === 'string')
          .map((r: { label: string; path: string; icon?: string }) => ({ label: r.label, path: r.path, icon: r.icon }))
        if (fromServer.length) pages = fromServer
      } catch {
        /* serveur protégé par session (serveur externe) ou injoignable : liste statique */
      }
    }
    this.pages = pages
    this.changed.fire()
  }

  getChildren(element?: WizardPage): WizardPage[] {
    return element ? [] : [...this.pages, DEMO_PAGE]
  }

  getTreeItem(page: WizardPage): vscode.TreeItem {
    const item = new vscode.TreeItem(page.label, vscode.TreeItemCollapsibleState.None)
    item.iconPath = new vscode.ThemeIcon(CODICONS[page.icon || ''] || 'circle-outline')
    item.tooltip = page.path
    item.contextValue = 'wizardPage'
    item.command = { command: 'wizardQa.open', title: 'Ouvrir', arguments: [page] }
    return item
  }

  dispose(): void {
    this.changed.dispose()
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http
    const req = client.get(url, { headers: { Accept: 'application/json' }, timeout: 3000 }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`))
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
        } catch (err) {
          reject(err)
        }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('délai dépassé')))
  })
}

/**
 * Panneau « Wizard QA » : l'application web du serveur intégré, affichée telle quelle dans une iframe.
 * Le serveur en mode --embedded rattache les requêtes locales à l'utilisateur « vscode » :
 * aucune session (cookie) n'est nécessaire dans la vue, qui reste conservée en arrière-plan.
 */
import * as vscode from 'vscode'

export class AppPanel {
  private static current: AppPanel | undefined
  private revision = 0

  private constructor(private readonly panel: vscode.WebviewPanel) {
    panel.onDidDispose(() => {
      if (AppPanel.current === this) AppPanel.current = undefined
    })
  }

  /** Affiche `pagePath` du serveur `baseUrl` (crée le panneau ou le réutilise). */
  static async show(context: vscode.ExtensionContext, baseUrl: string, pagePath: string): Promise<void> {
    const external = await vscode.env.asExternalUri(vscode.Uri.parse(`${baseUrl}${pagePath}`))
    if (!AppPanel.current) {
      const panel = vscode.window.createWebviewPanel('wizardQa.app', 'Wizard QA', vscode.ViewColumn.Active, {
        enableScripts: true,
        retainContextWhenHidden: true,
      })
      panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.png')
      AppPanel.current = new AppPanel(panel)
    }
    AppPanel.current.load(external)
    AppPanel.current.panel.reveal()
  }

  static close(): void {
    AppPanel.current?.panel.dispose()
  }

  private load(url: vscode.Uri): void {
    const src = url.toString(true)
    const origin = `${url.scheme}://${url.authority}`
    this.revision += 1
    this.panel.webview.html = `<!DOCTYPE html>
<html lang="fr" data-rev="${this.revision}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${escapeAttr(origin)}; style-src 'unsafe-inline';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; background: #fff; }
  iframe { border: 0; width: 100%; height: 100%; display: block; }
</style>
</head>
<body>
<iframe src="${escapeAttr(src)}" title="Wizard QA" allow="clipboard-read; clipboard-write"></iframe>
</body>
</html>`
  }
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

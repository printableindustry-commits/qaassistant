import * as http from 'http'
import * as fs from 'fs'
import * as path from 'path'

const EXTENSION_VERSION = (() => {
  try {
    const pkgPath = path.join(__dirname, '..', 'package.json')
    return JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version || '0.0.0'
  } catch {
    return '0.0.0'
  }
})()

const WIZARD_FOOTER_LABEL = 'Outil — TRIBU IT pour CA-TS'

export async function loadWizardPageHtml(
  baseUrl: string,
  pagePath: string,
  query = ''
): Promise<string> {
  const bootId = String(Date.now())
  const pathOnly = pagePath.split('?')[0] || '/'
  const extra = query ? (query.startsWith('?') ? query.slice(1) : query) : ''
  const qs = new URLSearchParams(extra)
  qs.set('embed', 'vscode')
  qs.set('_boot', bootId)
  const fetchPath =
    pathOnly === '/' ? `/?${qs.toString()}` : `${pathOnly}?${qs.toString()}`

  const appParams = new URLSearchParams()
  for (const key of ['prompt', 'autostart']) {
    const v = qs.get(key)
    if (v) appParams.set(key, v)
  }
  const navSearch = appParams.toString() ? `?${appParams.toString()}` : ''

  let html = await httpGet(`${baseUrl}${fetchPath}`)
  html = rewriteRootUrls(html, baseUrl)
  html = applyHtmlPageClasses(html)
  html = injectVsCodeShell(html, baseUrl, { bootId, pathOnly, navSearch })
  return html
}

function httpGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode} pour ${url}`))
          res.resume()
          return
        }
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      })
      .on('error', reject)
  })
}

function rewriteRootUrls(html: string, baseUrl: string): string {
  const base = baseUrl.replace(/\/$/, '')
  return html
    .replace(/(\s(href|src)=)"\//g, `$1"${base}/`)
    .replace(/(\s(href|src)=')\//g, `$1'${base}/`)
}

function hasWizardFooterMarkup(html: string): boolean {
  return /class=["']wizard-footer["']/.test(html)
}

/** Copie les classes page-* du body vers <html> pour les sélecteurs html.vscode-app.page-* */
function applyHtmlPageClasses(html: string): string {
  const bodyMatch = html.match(/<body[^>]*\sclass=["']([^"']*)["']/)
  if (!bodyMatch) return html
  const pageClasses = bodyMatch[1].split(/\s+/).filter((c) => c.startsWith('page-'))
  if (!pageClasses.length) return html
  return html.replace(/<html([^>]*)>/, (_full, attrs: string) => {
    const classMatch = attrs.match(/\sclass=["']([^"']*)["']/)
    const nonPage = classMatch
      ? classMatch[1].split(/\s+/).filter((c) => c && !c.startsWith('page-'))
      : []
    const merged = [...nonPage, ...pageClasses]
    if (classMatch) {
      const newAttrs = merged.length
        ? attrs.replace(/\sclass=["'][^"']*["']/, ` class="${merged.join(' ')}"`)
        : attrs.replace(/\sclass=["'][^"']*["']/, '')
      return `<html${newAttrs}>`
    }
    return `<html${attrs} class="${pageClasses.join(' ')}">`
  })
}

function injectVsCodeShell(
  html: string,
  baseUrl: string,
  ctx: { bootId: string; pathOnly: string; navSearch?: string } = {
    bootId: String(Date.now()),
    pathOnly: '/',
    navSearch: '',
  }
): string {
  const base = baseUrl.replace(/\/$/, '')
  const { bootId, pathOnly, navSearch = '' } = ctx
  const csp = [
    "default-src 'none'",
    `script-src ${base} 'unsafe-inline' 'unsafe-eval'`,
    `style-src ${base} 'unsafe-inline'`,
    `img-src ${base} data:`,
    `connect-src ${base}`,
    `font-src ${base}`,
  ].join('; ')

  const injectThemeCss =
    !html.includes('css_theme_app.css') && !html.includes('vscode-app.css')
  const injectHubCss = !html.includes('home-hub.css')
  const isHomePage = pathOnly === '/' || pathOnly === '/index.html' || html.includes('page-home')
  const headInject = `
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <base href="${base}/">
  <script>window.__WIZARD_API_BASE__=${JSON.stringify(base)};window.__WIZARD_VERSION__=${JSON.stringify(EXTENSION_VERSION)};window.__WIZARD_FOOTER_LABEL__=${JSON.stringify(WIZARD_FOOTER_LABEL)};window.__WIZARD_BOOT_ID__=${JSON.stringify(bootId)};window.__WIZARD_NAV_SEARCH__=${JSON.stringify(navSearch)};</script>
  ${injectHubCss ? `<link rel="stylesheet" href="${base}/assets/home-hub.css?v=${EXTENSION_VERSION}">` : ''}
  ${injectThemeCss ? `<link rel="stylesheet" href="${base}/assets/css_theme_app.css?v=${EXTENSION_VERSION}">` : ''}
  <script src="${base}/assets/wizard-home-shell.js?v=${EXTENSION_VERSION}"></script>
  <script src="${base}/assets/wizard-page-bridge.js?v=${EXTENSION_VERSION}"></script>
  <script>
  (function(){
    document.documentElement.classList.add('embed-mode','vscode-app');
    try {
      if (!window.__wizardVsCodeApi && typeof acquireVsCodeApi==='function') {
        window.__wizardVsCodeApi = acquireVsCodeApi();
      }
    } catch (e) {}
    if (window.WizardPageBridge && typeof WizardPageBridge.boot==='function') {
      WizardPageBridge.boot();
    }
  })();
  </script>`

  const navScript = `
  <script>
  (function () {
    if (window.__wizardNavInstalled) return;
    var api = window.__wizardVsCodeApi;
    if (!api) return;
    window.__wizardNavInstalled = true;
    document.addEventListener('click', function (e) {
      var a = e.target.closest('a[href]');
      if (!a || a.hasAttribute('download')) return;
      var href = a.getAttribute('href') || '';
      if (!href || href.charAt(0) === '#') return;
      if (/^https?:\\/\\//i.test(href) && href.indexOf('127.0.0.1') === -1 && href.indexOf('localhost') === -1) return;
      e.preventDefault();
      try {
        var u = new URL(href, '${base}/');
        api.postMessage({ type: 'navigate', path: u.pathname + u.search });
      } catch (err) {
        api.postMessage({ type: 'navigate', path: href });
      }
    }, true);
  })();
  </script>`

  if (html.includes('</head>')) {
    html = html.replace('</head>', `${headInject}\n</head>`)
  }
  html = html.replace(
    /((?:href|src)=["'][^"']*\.(?:js|css))(\?v=[^"']*)?(["'])/g,
    `$1?v=${EXTENSION_VERSION}$3`,
  )

  if (html.match(/<body[^>]*>/)) {
    const brandBar = `
  <header class="wizard-brand-bar" role="banner">
    <img class="wizard-logo-cats" src="${base}/assets/logo-cats-full.png" alt="Crédit Agricole Technologies et Services" />
    <span class="wizard-brand-spacer"></span>
    <img class="wizard-logo-qa" src="${base}/assets/logo-qa.png" alt="QA" />
  </header>`
    if (!html.includes('wizard-brand-bar')) {
      html = html.replace(/<body([^>]*)>/, `<body$1>${brandBar}`)
    }
  }

  if (html.includes('</body>')) {
    const shellScript = `
  <script>
  (function () {
    function syncPageClass() {
      var body = document.body;
      if (!body) return;
      document.documentElement.classList.forEach(function (c) {
        if (c.indexOf('page-') === 0) document.documentElement.classList.remove(c);
      });
      body.classList.forEach(function (c) {
        if (c.indexOf('page-') === 0) document.documentElement.classList.add(c);
      });
    }
    function runShell() {
      syncPageClass();
      if (window.Portail && typeof Portail.syncHtmlPageClass === 'function') {
        Portail.syncHtmlPageClass();
      }
      if (window.WizardFooter && typeof WizardFooter.sync === 'function') {
        WizardFooter.sync();
      }
      if (window.Portail) {
        if (typeof Portail.applyEmbedLinks === 'function') Portail.applyEmbedLinks();
      }
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', runShell);
    } else {
      runShell();
    }
  })();
  </script>`
    const footerScript = html.includes('wizard-footer.js')
      ? ''
      : `\n  <script src="${base}/assets/wizard-footer.js?v=${EXTENSION_VERSION}"></script>`
    const footer = hasWizardFooterMarkup(html)
      ? ''
      : `
  <footer class="wizard-footer" role="contentinfo">
    <span class="wizard-footer-version">v${EXTENSION_VERSION}</span>
    <span class="wizard-footer-label">${WIZARD_FOOTER_LABEL}</span>
  </footer>`
    const disclaimerScript = !html.includes('wizard-disclaimer.js')
      ? `\n  <script src="${base}/assets/wizard-disclaimer.js?v=${EXTENSION_VERSION}"></script>`
      : ''
    const debugCopilotScript = !html.includes('wizard-debug-copilot.js')
      ? `\n  <script src="${base}/assets/wizard-debug-copilot.js?v=${EXTENSION_VERSION}"></script>`
      : ''
    const debugNavScript = !html.includes('wizard-debug-nav.js')
      ? `\n  <script src="${base}/assets/wizard-debug-nav.js?v=${EXTENSION_VERSION}"></script>`
      : ''
    const debugBindingsScript = !html.includes('wizard-debug-page-bindings.js')
      ? `\n  <script src="${base}/assets/wizard-debug-page-bindings.js?v=${EXTENSION_VERSION}"></script>`
      : ''
    html = html.replace('</body>', `${footer}${footerScript}${disclaimerScript}${debugCopilotScript}${debugNavScript}${debugBindingsScript}\n${shellScript}\n${navScript}\n</body>`)
  }
  return html
}

export function pagePathFromUrl(baseUrl: string, raw: string): string {
  try {
    const u = new URL(raw, `${baseUrl}/`)
    return u.pathname + u.search
  } catch {
    return raw.startsWith('/') ? raw : `/${raw}`
  }
}

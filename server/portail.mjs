#!/usr/bin/env node
/**
 * Wizard QA Assistant — serveur HTTP (extension VS Code)
 *
 *   node portail.mjs --embedded
 */
import http from 'http'
import fs from 'fs'
import path from 'path'
import { exec, spawn } from 'child_process'
import { readNpmrc, readTemplate, readEmptyTemplate, writeNpmrc, writeEmptyNpmrc, getNpmrcPath, archiveNpmrc } from './lib/npmrc.mjs'
import { loadRepairConfig, saveRepairConfig, executeRepairPlan } from './lib/repair-api.mjs'
import {
  getVendorStatus, getVendorUrls, handleVendorUpload,
  checkProjectPackage, ensurePackageJson, removePackageLock,
} from './lib/vendor-upload.mjs'
import { runDocAction, getDocOutputPaths } from './lib/doc-api.mjs'
import { getPromptPackage } from './lib/doc-prompt-template.mjs'
import {
  listDocumentCatalog,
  readDocument,
  saveDocumentText,
  saveDocumentDocxText,
  saveOverride,
  uploadDocumentBinary,
  getDocumentDownloadPath,
} from './lib/doc-library.mjs'
import { loadHookConfig, saveHookSimple } from './lib/hook-config.mjs'
import { installHook, getHookInstallStatus } from './lib/install-hook.mjs'
import { generateConfig, getWizardDefaults } from './lib/wizard-core.mjs'
import {
  loadWizardDefaults, savePageDefaults, getPageDefaults,
  exportConfig, importConfig, getDefaultsPath,
} from './lib/wizard-defaults.mjs'
import { exportFullWizardConfig, importFullWizardConfig } from './lib/wizard-config-export.mjs'
import { getDashboard, getNpmrcDiff } from './lib/status.mjs'
import { verifyPage } from './lib/verify.mjs'
import { applyWizardToSystem } from './lib/apply-config.mjs'
import {
  getHookMeta,
  createPlanFolder,
  savePlanBoards,
  scanLocalPlanFolders,
  removePlanFromConf,
  registerPlanFolder,
  listHookConfigFiles,
  verifyPlansAgainstCloud,
  getHookCommandCatalog,
  executeHookCommand,
} from './lib/hook-plan-api.mjs'
import {
  getHookGitReadiness,
  saveHookDryRunResult,
  invalidateHookDryRun,
  restartHookWizard,
  assertHookGitReadyForJiraSync,
} from './lib/hook-git-readiness.mjs'
import { analyzeJiraXrayPlans, previewLocalSync } from './lib/sync-jira-page.mjs'
import { readHooksConf, saveHooksConf, readEmptyHooksConfTemplate, writeEmptyHooksConf } from './lib/hooks-conf-editor.mjs'
import { TERMINAL_MODES } from './lib/terminal-modes.mjs'
import { HOOK_DIR, REPO_ROOT, SERVER_DIR, applyPathPlaceholders, getPathsForApi, promptMdAbsPath } from './lib/paths.mjs'
import {
  completeOnboarding,
  createArborescence,
  addPlanFolder,
  getOnboardingState,
  getProjectProfile,
  getProjectVariables,
  listArborescences,
  saveProjectProfile,
  saveJiraSyncSettings,
  getJiraSyncSettings,
  updateProjectSettings,
  saveStackRecommendationProfile,
  saveStackChoiceProfile,
} from './lib/project-profile.mjs'
import {
  getStackRecommendationState,
  readOnboardingSnapshot,
  saveStackRecommendation,
  saveStackChoice,
} from './lib/onboarding-snapshot.mjs'
import {
  getQuestionnaire,
  getToolProfiles,
  STACK_CHART_COLORS,
  STACK_LABELS,
} from './lib/stack-recommendation.mjs'
import {
  getQuestionnaireConfigPath,
  loadStackQuestionnaireConfig,
} from './lib/stack-questionnaire-config.mjs'
import { getWizardConfigCatalog } from './lib/wizard-config-catalog.mjs'
import { loadUiWordingConfig } from './lib/ui-wording-config.mjs'
import {
  getUiWordingPreferencesForApi,
  hideUiWordingPopup,
} from './lib/ui-wording-preferences.mjs'
import { executeNpmInstall, getNpmInstallConfigForApi } from './lib/npm-install-api.mjs'
import { executeCypressInstall, getCypressInstallConfigForApi } from './lib/cypress-install-api.mjs'
import { executePlaywrightInstall, getPlaywrightInstallConfigForApi } from './lib/playwright-install-api.mjs'
import {
  checkRobotRuntime,
  executeRobotInstall,
  getRobotInstallConfigForApi,
} from './lib/robot-install-api.mjs'
import {
  checkPostmanRuntime,
  executePostmanInstall,
  getPostmanInitConfigForApi,
  getPostmanInstallConfigForApi,
  savePostmanInitConfig,
} from './lib/postman-install-api.mjs'
import {
  checkK6Runtime,
  executeK6Install,
  getK6InitConfigForApi,
  getK6InstallConfigForApi,
  saveK6InitConfig,
} from './lib/k6-install-api.mjs'
import { getK6PerfQuestionnaireForApi } from './lib/k6-perf-questionnaire-config.mjs'
import {
  listK6Profiles,
  getK6Profile,
  saveK6Profile,
  deleteK6Profile,
  duplicateK6Profile,
  exportK6Profiles,
  importK6Profiles,
  applyK6Profile,
  getProfilesDirRelative,
} from './lib/k6-profiles.mjs'
import { getK6CampaignTreeForApi } from './lib/k6-campaign-tree.mjs'
import { getK6OnboardingContextForApi } from './lib/k6-onboarding-context.mjs'
import {
  listK6RunHistory,
  appendK6Run,
  deleteK6Run,
  exportK6History,
  importK6History,
  getHistoryDirRelative,
} from './lib/k6-run-history.mjs'
import { buildProfileSummary } from './lib/k6-perf-generator.mjs'
import { runK6Campaign } from './lib/k6-run-api.mjs'
import {
  checkNpmRuntime,
  getRuntimeConfigForApi,
  installNodeToVoltaInventory,
  listNodeDistVersions,
  readPackageJsonState,
  runVoltaInstall,
  savePackageJson,
} from './lib/npm-runtime-api.mjs'
import { getDemoFormDefaults } from './lib/demo-defaults.mjs'
import { getHomeCatalog } from './lib/home-catalog.mjs'
import { writeDryRunLog, writeSyncLog, getWizardLogsDir, WIZARD_LOGS_REL, listWizardLogs } from './lib/wizard-logs.mjs'
import {
  startPageDebugFlow,
  regeneratePageDebugPrompt,
  resolvePageDebugSession,
  saveDebugPromptToFile,
  getSessionStatus,
  buildFullDebugPrompt,
  collectVerboseFromClient,
} from './lib/debug-prompt-api.mjs'
import { getDebugLogDir, DEBUG_LOGS_REL } from './lib/debug-verbose-logs.mjs'
import { getWizardMeta, WIZARD_EXTENSION_VERSION, WIZARD_FOOTER_LABEL } from './lib/wizard-meta.mjs'
import {
  getDocWizardContext,
  getDocWizardDocuments,
  getDocWizardQuestionnaire,
  saveDocWizardAnswers,
  buildFullDocPrompt,
  buildChapterDocPrompt,
  saveDocPromptToFile,
  saveChapterPromptToFile,
  scanDocWizardDocument,
  applyChapterBlockToDocument,
  applyChapterBlockWithProgress,
  getDocQaDashboard,
  getChapterReadiness,
  patchDocQaProgress,
} from './lib/doc-qa-wizard.mjs'
import { getLivrablesTourPayload, dismissLivrablesTour } from './lib/doc-qa-livrables-tour.mjs'

const PORTAIL_DIR = SERVER_DIR
const PAGES_DIR = path.join(PORTAIL_DIR, 'pages')
const ASSETS_DIR = path.join(PORTAIL_DIR, 'assets')
const BASE_PORT = Number(process.env.PORTAIL_PORT) || 3920
const HOST = '127.0.0.1'
const EMBEDDED = process.env.PORTAIL_EMBEDDED === '1' || process.argv.includes('--embedded')

let repairRunning = false

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...cors() })
  res.end(JSON.stringify(data))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {})
      } catch {
        reject(new Error('JSON invalide'))
      }
    })
    req.on('error', reject)
  })
}

function sendFile(res, filePath, contentType, noCache = false) {
  if (!fs.existsSync(filePath)) {
    sendJson(res, 404, { error: 'Not found' })
    return
  }
  const headers = { 'Content-Type': contentType, ...cors() }
  if (noCache) {
    headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    headers.Pragma = 'no-cache'
  }
  res.writeHead(200, headers)
  res.end(fs.readFileSync(filePath))
}

function sendHtml(res, filePath, reqUrl = '') {
  if (!fs.existsSync(filePath)) {
    sendJson(res, 404, { error: 'Not found' })
    return
  }
  let html = fs.readFileSync(filePath, 'utf8')
  html = applyPathPlaceholders(html)
  html = applyHtmlPageClasses(html)
  html = injectWizardChrome(html, reqUrl)
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...cors() })
  res.end(html)
}

function isEmbedRequest(reqUrl = '') {
  if (EMBEDDED) return true
  return /[?&]embed=(?:vscode|1)(?:&|$)/.test(reqUrl)
}

function hasWizardFooterMarkup(html) {
  return /class=["']wizard-footer["']/.test(html)
}

function applyHtmlPageClasses(html) {
  const bodyMatch = html.match(/<body[^>]*\sclass=["']([^"']*)["']/)
  if (!bodyMatch) return html
  const pageClasses = bodyMatch[1].split(/\s+/).filter((c) => c.startsWith('page-'))
  if (!pageClasses.length) return html
  return html.replace(/<html([^>]*)>/, (_full, attrs) => {
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

function injectWizardChrome(html, reqUrl = '') {
  if (!isEmbedRequest(reqUrl)) return html
  const meta = getWizardMeta()
  const ver = meta.version
  const bootId = String(Date.now())
  const isHomePage = /class=["'][^"']*page-home/.test(html)

  if (!html.includes('__WIZARD_VERSION__')) {
    const headInject = `
  <script>window.__WIZARD_VERSION__=${JSON.stringify(ver)};window.__WIZARD_FOOTER_LABEL__=${JSON.stringify(meta.footerLabel)};window.__WIZARD_BOOT_ID__=${JSON.stringify(bootId)};</script>`
    if (html.includes('</head>')) {
      html = html.replace('</head>', `${headInject}\n</head>`)
    }
  }

  if (!html.includes('css_theme_app.css') && !html.includes('vscode-app.css')) {
    const cssLink = `\n  <link rel="stylesheet" href="/assets/css_theme_app.css?v=${ver}">`
    if (html.includes('</head>')) {
      html = html.replace('</head>', `${cssLink}\n</head>`)
    }
  }

  if (!html.includes('wizard-home-shell.js')) {
    const homeShellScript = `\n  <script src="/assets/wizard-home-shell.js?v=${ver}"></script>`
    if (html.includes('</head>')) {
      html = html.replace('</head>', `${homeShellScript}\n</head>`)
    }
  }

  html = html.replace(
    /((?:href|src)=["'][^"']*\.(?:js|css))(\?v=[^"']*)?(["'])/g,
    `$1?v=${ver}$3`,
  )

  const footerBlock = `
  <footer class="wizard-footer" role="contentinfo">
    <span class="wizard-footer-version">v${ver}</span>
    <span class="wizard-footer-label">${meta.footerLabel}</span>
  </footer>`
  const footScript = `\n  <script src="/assets/wizard-footer.js?v=${ver}"></script>`
  const launchDisclaimerScript = !html.includes('wizard-disclaimer.js')
    ? `\n  <script src="/assets/wizard-disclaimer.js?v=${ver}"></script>`
    : ''
  const debugCopilotScript = !html.includes('wizard-debug-copilot.js')
    ? `\n  <script src="/assets/wizard-debug-copilot.js?v=${ver}"></script>`
    : ''
  const debugNavScript = !html.includes('wizard-debug-nav.js')
    ? `\n  <script src="/assets/wizard-debug-nav.js?v=${ver}"></script>`
    : ''
  const debugBindingsScript = !html.includes('wizard-debug-page-bindings.js')
    ? `\n  <script src="/assets/wizard-debug-page-bindings.js?v=${ver}"></script>`
    : ''

  let tail = ''
  if (!hasWizardFooterMarkup(html)) tail += footerBlock
  if (!html.includes('wizard-footer.js')) tail += footScript
  if (launchDisclaimerScript) tail += launchDisclaimerScript
  if (debugCopilotScript) tail += debugCopilotScript
  if (debugNavScript) tail += debugNavScript
  if (debugBindingsScript) tail += debugBindingsScript

  if (tail && html.includes('</body>')) {
    html = html.replace('</body>', `${tail}\n</body>`)
  }

  return html
}

function openFolderInOs(absPath) {
  if (!fs.existsSync(absPath)) throw new Error(`Dossier introuvable : ${absPath}`)
  if (process.platform === 'win32') {
    exec(`explorer "${absPath.replace(/\//g, '\\')}"`)
  } else if (process.platform === 'darwin') {
    exec(`open "${absPath}"`)
  } else {
    exec(`xdg-open "${absPath}"`)
  }
}

function openBrowser(url) {
  if (process.platform === 'win32') exec(`start "" "${url}"`)
  else if (process.platform === 'darwin') exec(`open "${url}"`)
  else exec(`xdg-open "${url}"`)
}

function runHookScript(args, cwd = HOOK_DIR) {
  return new Promise((resolve) => {
    const full = path.join(cwd, args[0])
    let out = `\n$ node ${args.join(' ')}\n`
    const child = spawn(process.execPath, [full, ...args.slice(1)], {
      cwd,
      env: process.env,
      shell: false,
      windowsHide: true,
    })
    child.stdout?.on('data', (d) => { out += d.toString() })
    child.stderr?.on('data', (d) => { out += d.toString() })
    child.on('close', (code) => resolve({ code: code ?? 1, output: out }))
  })
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors())
    res.end()
    return
  }

  const url = new URL(req.url, `http://${HOST}:${listenPort}`)
  let pathname = url.pathname
  if (pathname.length > 1 && pathname.endsWith('/')) {
    pathname = pathname.slice(0, -1)
  }

  // Pages HTML
  if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    sendHtml(res, path.join(PAGES_DIR, 'index.html'), req.url)
    return
  }
  if (req.method === 'GET' && pathname.endsWith('.html')) {
    const page = pathname.slice(1)
    sendHtml(res, path.join(PAGES_DIR, page), req.url)
    return
  }

  // Static assets
  if (req.method === 'GET' && pathname.startsWith('/assets/')) {
    const assetPath = path.join(ASSETS_DIR, pathname.replace('/assets/', ''))
    if (!assetPath.startsWith(ASSETS_DIR)) {
      sendJson(res, 403, { error: 'Forbidden' })
      return
    }
    const ext = path.extname(assetPath).toLowerCase()
    const types = { '.css': 'text/css', '.png': 'image/png', '.js': 'application/javascript', '.svg': 'image/svg+xml' }
    sendFile(res, assetPath, types[ext] || 'application/octet-stream', EMBEDDED && (ext === '.js' || ext === '.css'))
    return
  }

  // --- npmrc API ---
  if (req.method === 'GET' && pathname === '/api/npmrc') {
    try {
      sendJson(res, 200, readNpmrc())
    } catch (e) {
      sendJson(res, 500, { error: e.message })
    }
    return
  }
  if (req.method === 'GET' && pathname === '/api/npmrc/template') {
    try {
      const empty = url.searchParams.get('empty') === '1' || url.searchParams.get('variant') === 'empty'
      sendJson(res, 200, empty ? readEmptyTemplate() : readTemplate())
    } catch (e) {
      sendJson(res, 500, { error: e.message })
    }
    return
  }
  if (req.method === 'POST' && pathname === '/api/npmrc/empty') {
    try {
      const result = writeEmptyNpmrc()
      sendJson(res, 200, { ok: true, path: result.path, content: result.content, bare: true })
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'POST' && pathname === '/api/npmrc') {
    try {
      const body = await readBody(req)
      const bare = body.bare === true
      const exact = body.exact === true
      const result = writeNpmrc(body.fields || body, { bare, exact })
      sendJson(res, 200, { ok: true, path: result.path, content: result.content, bare: result.bare })
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'POST' && pathname === '/api/npmrc/open-profile') {
    try {
      const npmrcPath = getNpmrcPath()
      const profileDir = path.dirname(npmrcPath)
      if (process.platform === 'win32') {
        exec(`explorer "${profileDir}"`)
      } else if (process.platform === 'darwin') {
        exec(`open "${profileDir}"`)
      } else {
        exec(`xdg-open "${profileDir}"`)
      }
      sendJson(res, 200, { ok: true, path: profileDir })
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'POST' && pathname === '/api/npmrc/archive') {
    try {
      const result = archiveNpmrc()
      sendJson(res, 200, { ok: true, ...result })
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }

  if (req.method === 'GET' && pathname === '/api/npm/install-config') {
    try {
      sendJson(res, 200, { ok: true, ...getNpmInstallConfigForApi() })
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'POST' && pathname === '/api/npm/install') {
    try {
      const result = await executeNpmInstall()
      sendJson(res, 200, { ok: result.ok, ...result })
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message })
    }
    return
  }

  if (req.method === 'GET' && pathname === '/api/cypress/install-config') {
    try {
      sendJson(res, 200, { ok: true, ...getCypressInstallConfigForApi() })
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'POST' && pathname === '/api/cypress/install') {
    try {
      const body = await readBody(req)
      const result = await executeCypressInstall(body?.step)
      sendJson(res, 200, { ok: result.ok, ...result })
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }

  if (req.method === 'GET' && pathname === '/api/playwright/install-config') {
    try {
      sendJson(res, 200, { ok: true, ...getPlaywrightInstallConfigForApi() })
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'POST' && pathname === '/api/playwright/install') {
    try {
      const body = await readBody(req)
      const result = await executePlaywrightInstall(body?.step)
      sendJson(res, 200, { ok: result.ok, ...result })
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }

  if (req.method === 'GET' && pathname === '/api/robot/runtime/check') {
    try {
      const runtime = await checkRobotRuntime()
      sendJson(res, 200, { ok: true, ...runtime })
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'GET' && pathname === '/api/robot/install-config') {
    try {
      sendJson(res, 200, { ok: true, ...getRobotInstallConfigForApi() })
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'POST' && pathname === '/api/robot/install') {
    try {
      const body = await readBody(req)
      const result = await executeRobotInstall(body?.step)
      sendJson(res, 200, { ok: result.ok, ...result })
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }

  if (req.method === 'GET' && pathname === '/api/postman/init-config') {
    try {
      sendJson(res, 200, { ok: true, ...getPostmanInitConfigForApi() })
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'POST' && pathname === '/api/postman/init-config') {
    try {
      const body = await readBody(req)
      const result = savePostmanInitConfig(body)
      sendJson(res, 200, { ok: true, ...result })
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'GET' && pathname === '/api/postman/runtime/check') {
    try {
      sendJson(res, 200, { ok: true, ...checkPostmanRuntime() })
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'GET' && pathname === '/api/postman/install-config') {
    try {
      sendJson(res, 200, { ok: true, ...getPostmanInstallConfigForApi() })
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'POST' && pathname === '/api/postman/install') {
    try {
      const body = await readBody(req)
      const result = await executePostmanInstall(body?.step)
      sendJson(res, 200, { ok: result.ok, ...result })
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }

  if (req.method === 'GET' && pathname === '/api/k6/init-config') {
    try {
      sendJson(res, 200, { ok: true, ...getK6InitConfigForApi() })
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'POST' && pathname === '/api/k6/init-config') {
    try {
      const body = await readBody(req)
      const result = saveK6InitConfig(body)
      sendJson(res, 200, { ok: true, ...result })
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'GET' && pathname === '/api/k6/runtime/check') {
    try {
      const runtime = await checkK6Runtime()
      sendJson(res, 200, { ok: true, ...runtime })
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'GET' && pathname === '/api/k6/install-config') {
    try {
      sendJson(res, 200, { ok: true, ...getK6InstallConfigForApi() })
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'POST' && pathname === '/api/k6/install') {
    try {
      const body = await readBody(req)
      const result = await executeK6Install(body?.step)
      sendJson(res, 200, { ok: result.ok, ...result })
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }

  if (req.method === 'GET' && pathname === '/api/k6/perf/questionnaire') {
    try {
      sendJson(res, 200, getK6PerfQuestionnaireForApi())
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'GET' && pathname === '/api/k6/onboarding-context') {
    try {
      sendJson(res, 200, getK6OnboardingContextForApi())
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'GET' && pathname === '/api/k6/campaign-tree') {
    try {
      sendJson(res, 200, getK6CampaignTreeForApi())
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'GET' && pathname === '/api/k6/profiles') {
    try {
      sendJson(res, 200, { ok: true, profiles: listK6Profiles(), profilesDir: getProfilesDirRelative() })
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'GET' && pathname.startsWith('/api/k6/profiles/') && pathname.endsWith('/export')) {
    try {
      const id = pathname.split('/')[4]
      const bundle = exportK6Profiles(!id || id === 'all' ? null : [id])
      sendJson(res, 200, { ok: true, ...bundle })
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'GET' && pathname.startsWith('/api/k6/profiles/')) {
    try {
      const id = pathname.split('/')[4]
      const profile = getK6Profile(id)
      if (!profile) {
        sendJson(res, 404, { ok: false, error: 'Profil introuvable' })
        return
      }
      sendJson(res, 200, { ok: true, profile, summary: buildProfileSummary(profile.answers) })
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'POST' && pathname === '/api/k6/profiles/import') {
    try {
      const body = await readBody(req)
      const result = importK6Profiles(body.bundle || body, { merge: body.merge !== false })
      sendJson(res, 200, { ok: true, ...result })
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'POST' && pathname === '/api/k6/profiles') {
    try {
      const body = await readBody(req)
      const profile = saveK6Profile(body)
      sendJson(res, 200, { ok: true, profile, summary: buildProfileSummary(profile.answers) })
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'POST' && pathname.startsWith('/api/k6/profiles/') && pathname.endsWith('/duplicate')) {
    try {
      const id = pathname.split('/')[4]
      const body = await readBody(req)
      const profile = duplicateK6Profile(id, body.name)
      sendJson(res, 200, { ok: true, profile })
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'POST' && pathname.startsWith('/api/k6/profiles/') && pathname.endsWith('/run')) {
    try {
      const id = pathname.split('/')[4]
      const body = await readBody(req)
      const result = await runK6Campaign(id, { mode: body.mode === 'incremental' ? 'incremental' : 'full' })
      sendJson(res, result.ok ? 200 : 500, { ok: result.ok, ...result })
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'POST' && pathname.startsWith('/api/k6/profiles/') && pathname.endsWith('/delete')) {
    try {
      const id = pathname.split('/')[4]
      sendJson(res, 200, deleteK6Profile(id))
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'POST' && pathname.startsWith('/api/k6/profiles/') && pathname.endsWith('/apply')) {
    try {
      const id = pathname.split('/')[4]
      const result = applyK6Profile(id)
      sendJson(res, 200, { ok: true, ...result })
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'DELETE' && pathname.startsWith('/api/k6/profiles/')) {
    try {
      const id = pathname.split('/')[4]
      sendJson(res, 200, deleteK6Profile(id))
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'GET' && pathname === '/api/k6/history/export') {
    try {
      sendJson(res, 200, { ok: true, ...exportK6History() })
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'GET' && pathname === '/api/k6/history') {
    try {
      const profileId = url.searchParams.get('profileId')
      const limit = Number(url.searchParams.get('limit') || 100)
      sendJson(res, 200, {
        ok: true,
        runs: listK6RunHistory({ limit, profileId }),
        historyDir: getHistoryDirRelative(),
      })
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'POST' && pathname === '/api/k6/history/import') {
    try {
      const body = await readBody(req)
      const result = importK6History(body.bundle || body, { merge: body.merge !== false })
      sendJson(res, 200, { ok: true, ...result })
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'POST' && pathname === '/api/k6/history') {
    try {
      const body = await readBody(req)
      const run = appendK6Run(body)
      sendJson(res, 200, { ok: true, run })
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'DELETE' && pathname.startsWith('/api/k6/history/')) {
    try {
      const id = pathname.split('/')[4]
      sendJson(res, 200, deleteK6Run(id))
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }

  if (req.method === 'GET' && pathname === '/api/npm/runtime/check') {
    try {
      sendJson(res, 200, checkNpmRuntime())
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message })
    }
    return
  }

  if (req.method === 'GET' && pathname === '/api/npm/runtime/config') {
    try {
      sendJson(res, 200, { ok: true, ...getRuntimeConfigForApi() })
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message })
    }
    return
  }

  if (req.method === 'GET' && pathname === '/api/npm/node-versions') {
    try {
      const result = await listNodeDistVersions()
      sendJson(res, 200, result)
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message })
    }
    return
  }

  if (req.method === 'GET' && pathname === '/api/npm/package-json') {
    try {
      sendJson(res, 200, { ok: true, ...readPackageJsonState() })
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message })
    }
    return
  }

  if (req.method === 'POST' && pathname === '/api/npm/package-json') {
    try {
      const body = await readBody(req)
      const result = savePackageJson(body.content || '')
      sendJson(res, 200, result)
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }

  if (req.method === 'POST' && pathname === '/api/npm/runtime/install-node-inventory') {
    try {
      const body = await readBody(req)
      const result = await installNodeToVoltaInventory(body.version)
      sendJson(res, 200, result)
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }

  if (req.method === 'POST' && pathname === '/api/npm/runtime/volta-setup') {
    try {
      const body = await readBody(req)
      const result = runVoltaInstall(body.nodeVersion)
      sendJson(res, 200, result)
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }

  // --- repair API ---
  if (req.method === 'GET' && pathname === '/api/repair/config') {
    sendJson(res, 200, loadRepairConfig())
    return
  }
  if (req.method === 'POST' && pathname === '/api/repair/config') {
    try {
      const body = await readBody(req)
      saveRepairConfig(body)
      sendJson(res, 200, { ok: true })
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'GET' && pathname === '/api/repair/vendor') {
    try {
      const cfg = loadRepairConfig()
      const q = new URL(req.url || '', `http://${HOST}`).searchParams
      const versions = {
        node: q.get('node') || cfg.versions?.node,
        npm: q.get('npm') || cfg.versions?.npm,
        cypress: q.get('cypress') || cfg.versions?.cypress,
      }
      const project = q.get('project') || cfg.project
      sendJson(res, 200, {
        urls: getVendorUrls(versions),
        status: getVendorStatus(versions),
        package: checkProjectPackage(project),
      })
    } catch (e) {
      sendJson(res, 500, { error: e.message })
    }
    return
  }
  if (req.method === 'POST' && pathname === '/api/repair/vendor/upload') {
    try {
      const cfg = loadRepairConfig()
      const result = await handleVendorUpload(req, cfg.versions)
      sendJson(res, 200, { ok: true, ...result, status: getVendorStatus(cfg.versions) })
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'POST' && pathname === '/api/repair/package') {
    try {
      const body = await readBody(req)
      const cfg = body.config || loadRepairConfig()
      const project = body.project || cfg.project
      let result = {}
      if (body.action === 'ensure') {
        result = ensurePackageJson(project, body.nodeVersion || cfg.versions?.node)
      } else if (body.action === 'removeLock') {
        result = removePackageLock(project)
      } else {
        throw new Error('action invalide (ensure | removeLock)')
      }
      sendJson(res, 200, {
        ok: true,
        ...result,
        package: checkProjectPackage(project),
      })
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'POST' && pathname === '/api/repair/run') {
    if (repairRunning) {
      sendJson(res, 409, { ok: false, error: 'Une exécution est déjà en cours' })
      return
    }
    try {
      const body = await readBody(req)
      const cfg = body.config || loadRepairConfig()
      saveRepairConfig(cfg)
      repairRunning = true
      const result = await executeRepairPlan(cfg, body.actions || {})
      repairRunning = false
      sendJson(res, 200, result)
    } catch (e) {
      repairRunning = false
      sendJson(res, 500, { ok: false, error: e.message })
    }
    return
  }

  // --- doc QA API ---
  if (req.method === 'GET' && pathname === '/api/doc/prompt') {
    sendFile(res, promptMdAbsPath(), 'text/markdown; charset=utf-8')
    return
  }
  if (req.method === 'GET' && pathname === '/api/doc/prompt-template') {
    sendJson(res, 200, getPromptPackage())
    return
  }
  if (req.method === 'GET' && pathname === '/api/doc/outputs') {
    sendJson(res, 200, getDocOutputPaths())
    return
  }
  if (req.method === 'POST' && pathname === '/api/doc/run') {
    try {
      const body = await readBody(req)
      const action = body.action || 'report'
      const result = await runDocAction(action)
      sendJson(res, 200, result)
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'GET' && pathname === '/api/doc/library') {
    try {
      sendJson(res, 200, listDocumentCatalog())
    } catch (e) {
      sendJson(res, 500, { error: e.message })
    }
    return
  }
  if (req.method === 'GET' && pathname.startsWith('/api/doc/file/')) {
    try {
      const docId = decodeURIComponent(pathname.slice('/api/doc/file/'.length))
      if (url.searchParams.get('download') === '1') {
        const dl = getDocumentDownloadPath(docId)
        const mime = {
          docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          markdown: 'text/markdown; charset=utf-8',
          json: 'application/json; charset=utf-8',
          csv: 'text/csv; charset=utf-8',
          text: 'text/plain; charset=utf-8',
        }
        sendFile(res, dl.abs, mime[dl.kind] || 'application/octet-stream')
        return
      }
      sendJson(res, 200, readDocument(docId))
    } catch (e) {
      sendJson(res, 404, { error: e.message })
    }
    return
  }
  if (req.method === 'POST' && pathname === '/api/doc/file/save') {
    try {
      const body = await readBody(req)
      if (!body.id) throw new Error('id requis')
      let result
      if (body.mode === 'override') {
        result = saveOverride(body.id, body.content ?? '')
      } else if (body.mode === 'docx-text') {
        result = saveDocumentDocxText(body.id, body.content ?? '')
      } else {
        result = saveDocumentText(body.id, body.content ?? '')
      }
      sendJson(res, 200, result)
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'POST' && pathname === '/api/doc/file/upload') {
    try {
      const body = await readBody(req)
      if (!body.id || !body.dataBase64) throw new Error('id et dataBase64 requis')
      const buf = Buffer.from(body.dataBase64, 'base64')
      const result = uploadDocumentBinary(body.id, buf)
      sendJson(res, 200, result)
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }

  // --- Documentation QA wizard (assistant + prompt) ---
  if (req.method === 'GET' && pathname === '/api/doc/wizard/dashboard') {
    try {
      sendJson(res, 200, getDocQaDashboard())
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'GET' && pathname === '/api/doc/wizard/chapter/readiness') {
    try {
      const docId = url.searchParams.get('docId')
      const chapterId = url.searchParams.get('chapterId')
      const userNotes = url.searchParams.get('userNotes') || ''
      if (!docId || !chapterId) throw new Error('docId et chapterId requis')
      sendJson(res, 200, getChapterReadiness(docId, chapterId, userNotes))
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'POST' && pathname === '/api/doc/wizard/progress') {
    try {
      const body = await readBody(req)
      const result = patchDocQaProgress(body)
      sendJson(res, 200, result)
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'GET' && pathname === '/api/doc/wizard/context') {
    try {
      sendJson(res, 200, getDocWizardContext())
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'GET' && pathname === '/api/doc/wizard/questionnaire') {
    try {
      sendJson(res, 200, getDocWizardQuestionnaire())
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'POST' && pathname === '/api/doc/wizard/answers') {
    try {
      const body = await readBody(req)
      const result = saveDocWizardAnswers(body.answers || body)
      sendJson(res, 200, result)
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'POST' && pathname === '/api/doc/wizard/prompt') {
    try {
      const body = await readBody(req)
      const built = buildFullDocPrompt(body)
      sendJson(res, 200, {
        ok: true,
        title: body.title || built.title,
        prompt: built.prompt,
        promptLength: built.promptLength,
        tokenEstimate: built.tokenEstimate,
        promptSizeKb: built.promptSizeKb,
        documentCount: built.documentCount,
        chapterCount: built.chapterCount,
        validation: built.validation,
        prefill: built.prefill,
      })
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'POST' && pathname === '/api/doc/wizard/prompt/save') {
    try {
      const body = await readBody(req)
      const saved = saveDocPromptToFile(body.prompt)
      sendJson(res, 200, { ok: true, ...saved })
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'GET' && pathname === '/api/doc/wizard/documents') {
    try {
      sendJson(res, 200, getDocWizardDocuments())
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'POST' && pathname === '/api/doc/wizard/prompt/chapter') {
    try {
      const body = await readBody(req)
      const built = buildChapterDocPrompt(body)
      sendJson(res, 200, {
        ok: true,
        title: built.title,
        prompt: built.prompt,
        docId: built.docId,
        chapterId: built.chapterId,
        file: built.file,
        promptLength: built.prompt.length,
        tokenEstimate: built.tokenEstimate,
        promptSizeKb: built.promptSizeKb,
        readiness: built.readiness,
        templateVersion: built.templateVersion,
        promptArchive: built.promptArchive,
      })
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'POST' && pathname === '/api/doc/wizard/prompt/chapter/save') {
    try {
      const body = await readBody(req)
      const saved = saveChapterPromptToFile(body.docId, body.chapterId, body.prompt)
      sendJson(res, 200, { ok: true, ...saved })
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'POST' && pathname === '/api/doc/wizard/fill/chapter') {
    try {
      const body = await readBody(req)
      const result = applyChapterBlockWithProgress({
        docId: body.docId,
        chapterId: body.chapterId,
        content: body.content || body.block || body.text,
      })
      sendJson(res, 200, result)
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'POST' && pathname === '/api/doc/wizard/scan/document') {
    try {
      const body = await readBody(req)
      const docId = body.docId || body.id
      if (!docId) throw new Error('docId requis')
      const result = scanDocWizardDocument(docId)
      sendJson(res, 200, result)
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'GET' && pathname === '/api/doc/wizard/livrables-tour') {
    try {
      sendJson(res, 200, getLivrablesTourPayload())
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'POST' && pathname === '/api/doc/wizard/tour/dismiss') {
    try {
      sendJson(res, 200, dismissLivrablesTour())
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }

  // --- hook API ---
  if (req.method === 'GET' && pathname === '/api/hook/config') {
    try {
      const hookDir = HOOK_DIR
      const config = loadHookConfig(hookDir)
      const install = getHookInstallStatus(hookDir)
      const profile = getProjectProfile()
      const profileEnv = {
        JIRA_BASE_URL: profile.jiraBaseUrl || '',
        XRAY_CLIENT_ID: profile.xrayClientId || '',
        XRAY_CLIENT_SECRET: profile.xrayClientSecret || '',
      }
      const env = { ...config.env }
      for (const [key, value] of Object.entries(profileEnv)) {
        if (value && !String(env[key] || '').trim()) env[key] = value
      }
      sendJson(res, 200, { ...config, env, install, profileCredentials: profileEnv })
    } catch (e) {
      sendJson(res, 500, { error: e.message })
    }
    return
  }
  if (req.method === 'POST' && pathname === '/api/hook/config') {
    try {
      const body = await readBody(req)
      saveHookSimple(HOOK_DIR, { env: body.env, defaults: body.defaults })
      invalidateHookDryRun('Configuration hook modifiée')
      sendJson(res, 200, { ok: true })
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'GET' && pathname === '/api/hook/defaults') {
    try {
      sendJson(res, 200, getWizardDefaults(PORTAIL_DIR))
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'POST' && pathname === '/api/hook/generate') {
    try {
      const body = await readBody(req)
      const result = generateConfig(body.config || {}, {
        wizardDir: PORTAIL_DIR,
        dryRun: Boolean(body.dryRun),
      })
      sendJson(res, 200, result)
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'POST' && pathname === '/api/hook/install') {
    try {
      const result = installHook(HOOK_DIR)
      sendJson(res, 200, result)
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'POST' && pathname === '/api/hook/test') {
    try {
      const result = await runHookScript(['hook-run.mjs', '--force', '--dry-run'])
      const ok = result.code === 0
      const readiness = getHookGitReadiness()
      const logMeta = writeDryRunLog({
        output: result.output || '',
        ok,
        readiness,
        command: 'node hook-run.mjs --force --dry-run',
        exitCode: result.code,
        checks: readiness.checks || [],
      })
      saveHookDryRunResult(ok, result.output || '', logMeta)
      sendJson(res, 200, {
        ok,
        ...result,
        log: logMeta,
        logsDir: getWizardLogsDir(),
        logsRelativeDir: WIZARD_LOGS_REL,
        readiness: getHookGitReadiness(),
      })
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'GET' && pathname === '/api/hook/readiness') {
    try {
      sendJson(res, 200, getHookGitReadiness())
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'POST' && pathname === '/api/hook/restart-wizard') {
    try {
      sendJson(res, 200, restartHookWizard())
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'GET' && pathname === '/api/hook/meta') {
    try {
      sendJson(res, 200, getHookMeta(HOOK_DIR))
    } catch (e) {
      sendJson(res, 500, { error: e.message })
    }
    return
  }
  if (req.method === 'POST' && pathname === '/api/hook/create-plan-folder') {
    try {
      const body = await readBody(req)
      const result = createPlanFolder(HOOK_DIR, {
        planKey: body.planKey || body.plan_key,
        name: body.name,
        suiteKey: body.suiteKey || body.suite_key,
      })
      invalidateHookDryRun('Plan ajouté dans hooks.conf')
      sendJson(res, 200, result)
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'POST' && pathname === '/api/hook/plans/board') {
    try {
      const body = await readBody(req)
      const cfg = loadHookConfig(HOOK_DIR)
      const jiraBaseUrl = body.jiraBaseUrl || cfg.env?.JIRA_BASE_URL || ''
      const result = savePlanBoards(HOOK_DIR, body.plans || [], jiraBaseUrl)
      invalidateHookDryRun('Testing Board configuré')
      sendJson(res, 200, result)
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'GET' && pathname === '/api/hook/scan-folders') {
    try {
      sendJson(res, 200, scanLocalPlanFolders(HOOK_DIR))
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'GET' && pathname === '/api/hook/config-files') {
    try {
      sendJson(res, 200, listHookConfigFiles(HOOK_DIR))
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'POST' && pathname === '/api/hook/plans/toggle') {
    try {
      const body = await readBody(req)
      const folder = String(body.folder || '').trim()
      if (!folder) throw new Error('folder requis')
      let result
      if (body.action === 'remove') {
        result = removePlanFromConf(HOOK_DIR, folder)
      } else if (body.action === 'add') {
        result = registerPlanFolder(HOOK_DIR, { folder, suiteKey: body.suiteKey || body.suite_key })
      } else {
        throw new Error('action invalide (add | remove)')
      }
      invalidateHookDryRun('hooks.conf modifié (plans)')
      sendJson(res, 200, result)
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'POST' && pathname === '/api/hook/verify-cloud') {
    try {
      const result = await verifyPlansAgainstCloud(HOOK_DIR, (args) => runHookScript(args))
      sendJson(res, 200, result)
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'POST' && pathname === '/api/hook/jira-analyze') {
    try {
      assertHookGitReadyForJiraSync()
      const result = await analyzeJiraXrayPlans(HOOK_DIR, (args) => runHookScript(args))
      const readiness = getHookGitReadiness()
      const logMeta = writeSyncLog({
        kind: 'analyze',
        output: result.output || '',
        ok: Boolean(result.ok),
        command: 'sync-jira.mjs + xray-sync.mjs (dry-run par plan)',
        exitCode: result.ok ? 0 : 1,
        summary: result.ok ? 'Analyse OK — local et cloud alignés' : 'Analyse KO — écarts détectés',
        plans: result.plans || [],
      })
      sendJson(res, 200, { ...result, log: logMeta, logsDir: getWizardLogsDir(), logsRelativeDir: WIZARD_LOGS_REL })
    } catch (e) {
      sendJson(res, e.code === 'HOOK_GIT_NOT_READY' ? 403 : 500, { ok: false, error: e.message, readiness: e.readiness })
    }
    return
  }
  if (req.method === 'POST' && pathname === '/api/hook/sync-preview') {
    try {
      assertHookGitReadyForJiraSync()
      const result = await previewLocalSync(HOOK_DIR, (args) => runHookScript(args))
      const logMeta = writeSyncLog({
        kind: 'sync-preview',
        output: result.output || '',
        ok: Boolean(result.ok),
        command: 'node hook-run.mjs --force --dry-run',
        exitCode: result.code ?? (result.ok ? 0 : 1),
        summary: 'Aperçu avant synchronisation Local → JIRA / Xray',
      })
      sendJson(res, 200, { ...result, log: logMeta })
    } catch (e) {
      sendJson(res, e.code === 'HOOK_GIT_NOT_READY' ? 403 : 500, { ok: false, error: e.message, readiness: e.readiness })
    }
    return
  }
  if (req.method === 'POST' && pathname === '/api/hook/open-file') {
    try {
      const body = await readBody(req)
      const rel = String(body.relativePath || body.path || '').trim()
      if (!rel) throw new Error('relativePath requis')
      const abs = path.isAbsolute(rel) ? rel : path.join(REPO_ROOT, rel.replace(/\//g, path.sep))
      if (!fs.existsSync(abs)) throw new Error(`Fichier introuvable : ${abs}`)
      if (process.platform === 'win32') {
        exec(`start "" "${abs}"`)
      } else if (process.platform === 'darwin') {
        exec(`open "${abs}"`)
      } else {
        exec(`xdg-open "${abs}"`)
      }
      sendJson(res, 200, { ok: true, path: abs })
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'POST' && pathname === '/api/hook/sync') {
    try {
      const body = await readBody(req)
      const args = ['hook-run.mjs', '--force']
      if (body.dryRun) args.push('--dry-run')
      const result = await runHookScript(args)
      const ok = result.code === 0
      const logMeta = writeSyncLog({
        kind: 'sync-local',
        output: result.output || '',
        ok,
        command: `node ${args.join(' ')}`,
        exitCode: result.code,
        summary: ok ? 'Synchronisation Local → JIRA / Xray terminée' : 'Synchronisation Local → JIRA / Xray en échec',
      })
      sendJson(res, 200, { ok, ...result, log: logMeta, logsDir: getWizardLogsDir(), logsRelativeDir: WIZARD_LOGS_REL })
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'GET' && pathname === '/api/hook/commands') {
    try {
      sendJson(res, 200, getHookCommandCatalog(HOOK_DIR))
    } catch (e) {
      sendJson(res, 500, { error: e.message })
    }
    return
  }
  if (req.method === 'POST' && pathname === '/api/hook/run-command') {
    try {
      const body = await readBody(req)
      const commandId = String(body.commandId || body.command || '').trim()
      if (!commandId) throw new Error('commandId requis')
      const result = await executeHookCommand(HOOK_DIR, (args) => runHookScript(args), {
        commandId,
        planKey: body.planKey || body.plan_key,
        suiteKey: body.suiteKey || body.suite_key,
        dryRun: Boolean(body.dryRun || body.dry_run),
      })
      const ok = result.ok != null ? Boolean(result.ok) : result.code === 0
      sendJson(res, 200, { ok, ...result })
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'GET' && pathname === '/api/wizard/logs') {
    try {
      const dir = getWizardLogsDir()
      sendJson(res, 200, {
        dir,
        relativeDir: WIZARD_LOGS_REL,
        files: listWizardLogs(),
      })
    } catch (e) {
      sendJson(res, 500, { error: e.message })
    }
    return
  }
  if (req.method === 'POST' && pathname === '/api/wizard/open-folder') {
    try {
      const body = await readBody(req)
      let abs
      if (body.target === 'logs' || body.relativePath === WIZARD_LOGS_REL) {
        abs = getWizardLogsDir()
      } else if (body.target === 'debug-logs' && body.scope) {
        abs = getDebugLogDir(body.scope)
      } else if (body.relativePath?.startsWith(DEBUG_LOGS_REL)) {
        abs = path.join(REPO_ROOT, String(body.relativePath).replace(/\//g, path.sep))
      } else if (body.target === 'repo' || body.target === 'project') {
        abs = REPO_ROOT
      } else if (body.relativePath) {
        abs = path.isAbsolute(body.relativePath)
          ? body.relativePath
          : path.join(REPO_ROOT, String(body.relativePath).replace(/\//g, path.sep))
      } else if (body.path) {
        abs = path.resolve(String(body.path))
      } else {
        throw new Error('target, relativePath ou path requis')
      }
      openFolderInOs(abs)
      sendJson(res, 200, { ok: true, path: abs })
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'POST' && pathname === '/api/copilot/debug-prompt') {
    try {
      const body = await readBody(req)
      const built = buildFullDebugPrompt(body)
      sendJson(res, 200, {
        ok: true,
        title: body.title || 'Debug',
        prompt: built.prompt,
        enriched: body.enrich !== false,
        promptLength: built.prompt.length,
        tokenEstimate: built.tokenEstimate,
        promptSizeKb: built.promptSizeKb,
        preflight: built.preflight,
        hasWizardSection: built.hasWizardSection,
      })
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'POST' && pathname === '/api/debug/verbose-collect') {
    try {
      const body = await readBody(req)
      const result = collectVerboseFromClient(body)
      sendJson(res, 200, { ok: true, ...result })
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'POST' && pathname === '/api/debug/session/start') {
    try {
      const body = await readBody(req)
      const result = startPageDebugFlow(body)
      sendJson(res, 200, {
        ok: true,
        title: body.title || result.session?.pageTitle || 'Debug',
        prompt: result.prompt,
        tokenEstimate: result.tokenEstimate,
        promptSizeKb: result.promptSizeKb,
        preflight: result.preflight,
        session: result.session,
        logEntry: result.logEntry,
        promptFile: result.promptFile,
        hasWizardSection: result.hasWizardSection,
      })
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'GET' && pathname === '/api/debug/session/status') {
    try {
      const scope = url.searchParams.get('scope') || ''
      const pagePath = url.searchParams.get('pagePath') || ''
      sendJson(res, 200, getSessionStatus({ scope, pagePath }))
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'POST' && pathname === '/api/debug/session/regenerate') {
    try {
      const body = await readBody(req)
      const result = regeneratePageDebugPrompt(body)
      sendJson(res, 200, {
        ok: true,
        title: body.title || 'Debug',
        prompt: result.prompt,
        tokenEstimate: result.tokenEstimate,
        promptSizeKb: result.promptSizeKb,
        preflight: result.preflight,
        logEntry: result.logEntry,
        promptFile: result.promptFile,
        hasWizardSection: result.hasWizardSection,
      })
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'POST' && pathname === '/api/debug/session/resolve') {
    try {
      const body = await readBody(req)
      const result = resolvePageDebugSession(body)
      sendJson(res, result.ok ? 200 : 400, result)
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'POST' && pathname === '/api/copilot/debug-prompt/save') {
    try {
      const body = await readBody(req)
      const saved = saveDebugPromptToFile(body.scope, body.prompt)
      sendJson(res, 200, { ok: true, ...saved })
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'GET' && pathname === '/api/hook/terminal-modes') {
    sendJson(res, 200, { modes: TERMINAL_MODES })
    return
  }
  if (req.method === 'GET' && pathname === '/api/hook/hooks-conf') {
    try {
      sendJson(res, 200, readHooksConf(HOOK_DIR))
    } catch (e) {
      sendJson(res, 500, { error: e.message })
    }
    return
  }
  if (req.method === 'GET' && pathname === '/api/hook/hooks-conf/empty-template') {
    try {
      sendJson(res, 200, readEmptyHooksConfTemplate(HOOK_DIR))
    } catch (e) {
      sendJson(res, 500, { error: e.message })
    }
    return
  }
  if (req.method === 'POST' && pathname === '/api/hook/hooks-conf/empty') {
    try {
      const result = await writeEmptyHooksConf(HOOK_DIR)
      sendJson(res, 200, { ok: true, ...result, bare: true })
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'POST' && pathname === '/api/hook/hooks-conf') {
    try {
      const body = await readBody(req)
      const result = await saveHooksConf(HOOK_DIR, body)
      invalidateHookDryRun('hooks.conf modifié')
      sendJson(res, 200, result)
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }

  // --- wizard defaults / export / import ---
  if (req.method === 'GET' && pathname === '/api/wizard/defaults') {
    const page = url.searchParams.get('page')
    if (page) {
      sendJson(res, 200, { page, data: getPageDefaults(page) })
    } else {
      sendJson(res, 200, loadWizardDefaults())
    }
    return
  }
  if (req.method === 'POST' && pathname === '/api/wizard/defaults') {
    try {
      const body = await readBody(req)
      if (!body.page) throw new Error('Paramètre page requis')
      const saved = savePageDefaults(body.page, body.data)
      sendJson(res, 200, { ok: true, updatedAt: saved.updatedAt })
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }
  if (req.method === 'GET' && pathname === '/api/wizard/export') {
    const includeSecrets = url.searchParams.get('secrets') !== '0'
    sendJson(res, 200, exportFullWizardConfig({ includeSecrets }))
    return
  }
  if (req.method === 'POST' && pathname === '/api/wizard/import') {
    try {
      const body = await readBody(req)
      const { saved, written, format } = importFullWizardConfig(body.config, { merge: body.merge !== false })
      let applyResult = null
      if (body.applyToSystem) {
        applyResult = applyWizardToSystem(saved, {
          npmrc: body.applyNpmrc !== false,
          repair: body.applyRepair !== false,
          hook: body.applyHook !== false,
        })
      }
      sendJson(res, 200, {
        ok: true,
        updatedAt: saved.updatedAt,
        format,
        writtenConfFiles: written,
        apply: applyResult,
      })
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }

  if (req.method === 'POST' && pathname === '/api/wizard/apply') {
    try {
      const body = await readBody(req)
      const wizard = body.config || loadWizardDefaults()
      const result = applyWizardToSystem(wizard, {
        npmrc: body.npmrc !== false,
        repair: body.repair !== false,
        hook: body.hook !== false,
      })
      sendJson(res, 200, result)
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }

  if (req.method === 'GET' && pathname === '/api/home/catalog') {
    sendJson(res, 200, getHomeCatalog())
    return
  }

  if (req.method === 'GET' && pathname === '/api/project/onboarding') {
    sendJson(res, 200, getOnboardingState())
    return
  }

  if (req.method === 'GET' && pathname === '/api/project/profile') {
    const project = getProjectProfile()
    const jiraSync = getJiraSyncSettings()
    sendJson(res, 200, {
      project: {
        ...project,
        jiraBaseUrl: project.jiraBaseUrl || jiraSync.jiraBaseUrl,
        xrayClientId: project.xrayClientId || jiraSync.xrayClientId,
        xrayClientSecret: project.xrayClientSecret || jiraSync.xrayClientSecret,
      },
      jiraSync,
      arborescences: listArborescences(),
      variables: getProjectVariables(),
    })
    return
  }

  if (req.method === 'POST' && pathname === '/api/project/profile') {
    try {
      const body = await readBody(req)
      const project = saveProjectProfile(body.project || body)
      sendJson(res, 200, { ok: true, project, arborescences: listArborescences() })
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }

  if (req.method === 'GET' && pathname === '/api/project/arborescences') {
    sendJson(res, 200, { arborescences: listArborescences() })
    return
  }

  if (req.method === 'POST' && pathname === '/api/project/arborescences') {
    try {
      assertHookGitReadyForJiraSync()
      const body = await readBody(req)
      const result = createArborescence(body)
      sendJson(res, 200, { ok: true, ...result })
    } catch (e) {
      sendJson(res, e.code === 'HOOK_GIT_NOT_READY' ? 403 : 400, { ok: false, error: e.message, readiness: e.readiness })
    }
    return
  }

  if (req.method === 'POST' && pathname === '/api/project/onboarding/complete') {
    try {
      const body = await readBody(req)
      const result = completeOnboarding(body)
      sendJson(res, 200, { ok: true, ...result })
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }

  if (req.method === 'GET' && pathname === '/api/project/onboarding/snapshot') {
    sendJson(res, 200, {
      ok: true,
      state: getStackRecommendationState(),
      snapshot: readOnboardingSnapshot(),
    })
    return
  }

  if (req.method === 'GET' && pathname === '/api/project/stack-questionnaire') {
    try {
      const config = loadStackQuestionnaireConfig()
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        ...cors(),
      })
      res.end(JSON.stringify({
        ok: true,
        ...getStackRecommendationState(),
        questions: config.questions,
        questionCount: config.questionCount,
        questionIds: config.questionIds,
        questionnaireConfigPath: config.relativePath,
        questionnaireConfigAbsolutePath: config.absolutePath,
        stackIds: config.stackIds,
        chartColors: config.chartColors,
        stackLabels: config.stackLabels,
        toolsComparison: getToolProfiles(),
      }))
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message })
    }
    return
  }

  if (req.method === 'POST' && pathname === '/api/project/stack-choice') {
    try {
      const body = await readBody(req)
      const stackId = body.stackId || body.id
      const saved = saveStackChoice(stackId)
      const project = saveStackChoiceProfile(stackId, saved.label)
      sendJson(res, 200, {
        ok: true,
        project,
        stackId: saved.stackId,
        label: saved.label,
        snapshotPath: saved.relativePath,
        snapshot: saved.payload,
      })
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }

  if (req.method === 'POST' && pathname === '/api/project/stack-recommendation') {
    try {
      const body = await readBody(req)
      const saved = saveStackRecommendation(body.answers || body)
      const project = saveStackRecommendationProfile(saved.recommendation)
      sendJson(res, 200, {
        ok: true,
        project,
        snapshotPath: saved.relativePath,
        recommendation: saved.recommendation,
        snapshot: saved.payload,
      })
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }

  if (req.method === 'POST' && pathname === '/api/project/settings/update') {
    try {
      const body = await readBody(req)
      const result = updateProjectSettings(body)
      sendJson(res, 200, { ok: true, ...result })
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }

  if (req.method === 'POST' && pathname === '/api/project/jira-sync') {
    try {
      assertHookGitReadyForJiraSync()
      const body = await readBody(req)
      const result = saveJiraSyncSettings(body)
      sendJson(res, 200, { ok: true, ...result })
    } catch (e) {
      sendJson(res, e.code === 'HOOK_GIT_NOT_READY' ? 403 : 400, { ok: false, error: e.message, readiness: e.readiness })
    }
    return
  }

  if (req.method === 'GET' && pathname === '/api/wizard/config-files') {
    try {
      sendJson(res, 200, { ok: true, ...getWizardConfigCatalog() })
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message })
    }
    return
  }

  if (req.method === 'GET' && pathname === '/api/wizard/ui-wording') {
    try {
      res.setHeader('Cache-Control', 'no-store')
      const config = loadUiWordingConfig()
      const meta = getWizardMeta()
      const preferences = getUiWordingPreferencesForApi(meta.version)
      sendJson(res, 200, {
        ok: true,
        version: config.version,
        description: config.description,
        relativePath: config.relativePath,
        neverShowButton: config.neverShowButton,
        popups: config.popups,
        hiddenPopups: preferences.hiddenPopups,
        lastExtensionVersion: preferences.lastExtensionVersion,
        preferencesRelativePath: preferences.relativePath,
      })
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message })
    }
    return
  }

  if (req.method === 'POST' && pathname === '/api/wizard/ui-wording/preferences/hide') {
    try {
      const body = await readBody(req)
      const popupId = String(body?.popupId || '').trim()
      if (!popupId) throw new Error('popupId requis')
      const preferences = hideUiWordingPopup(popupId)
      sendJson(res, 200, {
        ok: true,
        popupId,
        hiddenPopups: preferences.hiddenPopups,
        relativePath: preferences.relativePath,
      })
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }

  if (req.method === 'GET' && pathname === '/api/project/demo-defaults') {
    sendJson(res, 200, { ok: true, defaults: getDemoFormDefaults(REPO_ROOT) })
    return
  }

  if (req.method === 'GET' && pathname === '/api/wizard/paths') {
    sendJson(res, 200, getPathsForApi())
    return
  }

  if (req.method === 'GET' && pathname === '/api/wizard/meta') {
    sendJson(res, 200, getWizardMeta())
    return
  }

  if (req.method === 'GET' && pathname === '/api/health') {
    const meta = getWizardMeta()
    sendJson(res, 200, {
      ok: true,
      port: listenPort,
      embedded: EMBEDDED,
      version: meta.version,
      footerLabel: meta.footerLabel,
    })
    return
  }

  if (req.method === 'GET' && pathname === '/api/dashboard') {
    sendJson(res, 200, getDashboard())
    return
  }

  if (req.method === 'GET' && pathname === '/api/npmrc/diff') {
    sendJson(res, 200, getNpmrcDiff())
    return
  }

  if (req.method === 'POST' && pathname === '/api/verify') {
    try {
      const body = await readBody(req)
      const page = body.page || url.searchParams.get('page')
      if (!page) throw new Error('Paramètre page requis')
      sendJson(res, 200, verifyPage(page, body))
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return
  }

  sendJson(res, 404, { error: 'Not found' })
})

let listenPort = BASE_PORT

function onListenReady() {
  const home = `http://${HOST}:${listenPort}/`
  console.log('\n╔════════════════════════════════════════════════════════════════════╗')
  console.log('║  Wizard QA Assistant (CATS)                                        ║')
  console.log('║  TRIBU IT pour CA-TS                                               ║')
  console.log('╚════════════════════════════════════════════════════════════════════╝')
  console.log(`\n  Accueil : ${home}`)
  console.log(`  Défauts : ${getDefaultsPath()}`)
  if (listenPort !== BASE_PORT) console.log(`  (port ${BASE_PORT} occupé → ${listenPort})`)
  if (EMBEDDED) console.log('  Mode intégré (extension) — pas d\'ouverture navigateur')
  else openBrowser(home)
  console.log('  Ctrl+C pour arrêter\n')
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE' && listenPort < BASE_PORT + 5) {
    listenPort += 1
    console.log(`Port ${listenPort - 1} occupé, essai ${listenPort}…`)
    server.listen(listenPort, HOST, onListenReady)
    return
  }
  console.error(err.code === 'EADDRINUSE'
    ? `\nERREUR : ports ${BASE_PORT}-${BASE_PORT + 5} occupés.\n`
    : `\nERREUR serveur : ${err.message}\n`)
  process.exit(1)
})

server.listen(listenPort, HOST, onListenReady)

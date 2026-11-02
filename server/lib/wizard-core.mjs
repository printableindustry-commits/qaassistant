/**
 * Logique partagée — wizard CLI et GUI
 */
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import { PATH_CFG } from './paths.mjs'

export const DEFAULT_HOOK_DIR_NAME = PATH_CFG.hookDir

export const COPY_SKIP = new Set([
  '.env',
  'hook-debug.log',
  'sync-out.txt',
  'SETUP_RECAP.txt',
  'node_modules',
  '.git',
])

export const ENV_PRESETS = {
  prod: {
    label: 'Production (CATS)',
    jiraBaseUrl: 'https://jirasoftware-cats.atlassian.net',
  },
  recette: {
    label: 'Recette / intégration',
    jiraBaseUrl: 'https://jirasoftware-recette.atlassian.net',
  },
  dev: {
    label: 'Développement / autre',
    jiraBaseUrl: '',
  },
}

export function detectGitRoot(hookDir) {
  try {
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf8', cwd: hookDir }).trim()
  } catch {
    return path.resolve(hookDir, '..')
  }
}

export function extractJiraKey(input) {
  const trimmed = String(input || '').trim()
  const m = trimmed.match(/([A-Z][A-Z0-9]+-\d+)/i)
  return m ? m[1].toUpperCase() : trimmed
}

export function normalizeRepositoryPath(input, fallbackFolder) {
  const trimmed = String(input || '').trim()
  if (!trimmed) return `/${fallbackFolder}`
  if (trimmed.startsWith('/')) return trimmed.replace(/\/+$/, '') || `/${fallbackFolder}`
  return `/${trimmed.replace(/\\/g, '/').replace(/\/+$/, '')}`
}

export function repositoryPathFromUrl(url, fallbackFolder) {
  const trimmed = String(url || '').trim()
  if (!trimmed) return null
  try {
    const u = new URL(trimmed)
    const parts = u.pathname.split('/').filter(Boolean)
    const repoIdx = parts.findIndex(p => /repository|test-repository|testing-board/i.test(p))
    if (repoIdx !== -1 && parts[repoIdx + 1]) {
      return normalizeRepositoryPath(parts.slice(repoIdx + 1).join('/'), fallbackFolder)
    }
  } catch { /* ignore */ }
  return null
}

export function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (COPY_SKIP.has(entry.name)) continue
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

export function enrichSuite(suite, jiraBaseUrl) {
  const urlOrKey = suite.urlOrKey || suite.suite_key || ''
  const suite_key = extractJiraKey(urlOrKey)
  const browseUrl = urlOrKey.startsWith('http')
    ? urlOrKey
    : `${jiraBaseUrl}/browse/${suite_key}`
  return {
    suite_key,
    name: suite.name?.trim() || null,
    link_type: suite.link_type?.trim() || null,
    browseUrl,
  }
}

export function enrichPlan(plan, jiraBaseUrl, defaultSuiteKey = '') {
  const folder = plan.folder?.trim()
  if (!folder) throw new Error('Nom du dossier VS Code requis pour chaque plan')

  const planUrlOrKey = plan.planUrlOrKey || plan.plan_key || ''
  const plan_key = extractJiraKey(planUrlOrKey)
  if (!plan_key) throw new Error('Clé JIRA du plan requise')

  const tbUrl = plan.testingBoardUrl?.trim() || ''
  let repositoryPath = repositoryPathFromUrl(tbUrl, folder)
  if (!repositoryPath) {
    repositoryPath = normalizeRepositoryPath(plan.repositoryPath || `/${folder}`, folder)
  }

  const suiteRaw = plan.suite_key || defaultSuiteKey
  const suite_key = suiteRaw ? extractJiraKey(suiteRaw) : null
  const testingBoardUrl = tbUrl || `${jiraBaseUrl}/browse/${plan_key}`

  return { folder, plan_key, suite_key, repositoryPath, testingBoardUrl }
}

export function resolveHookTemplateDir(wizardDir, hookDirName = DEFAULT_HOOK_DIR_NAME) {
  return path.join(detectGitRoot(wizardDir), hookDirName)
}

export function normalizeConfig(raw, wizardDir) {
  const preset = ENV_PRESETS[raw.environment] || ENV_PRESETS.prod
  const jiraBaseUrl = (raw.jiraBaseUrl || preset.jiraBaseUrl || 'https://jirasoftware-cats.atlassian.net').replace(/\/$/, '')

  const suites = (raw.suites || []).map(s => enrichSuite(s, jiraBaseUrl))
  const defaultSuite = suites.length === 1 ? suites[0].suite_key : ''

  const plans = (raw.plans || []).map(p => enrichPlan(p, jiraBaseUrl, defaultSuite))
  if (!plans.length) throw new Error('Au moins un plan de test est requis')

  return {
    createNew: Boolean(raw.createNew),
    overwriteOnCopy: Boolean(raw.overwriteOnCopy),
    repoRoot: raw.repoRoot?.trim() || detectGitRoot(wizardDir),
    hookDirName: raw.hookDirName?.trim() || DEFAULT_HOOK_DIR_NAME,
    environment: raw.environment || 'prod',
    jiraBaseUrl,
    project: raw.project?.trim() || 'P0326',
    label: raw.label?.trim() || 'TR_Cypress',
    httpsProxy: raw.httpsProxy?.trim() || '',
    excludeDirs: raw.excludeDirs?.trim() || '_legacy,_legacy_before_fragmentation',
    indexationDelay: String(raw.indexationDelay || '9'),
    suiteLinkType: raw.suiteLinkType?.trim() || 'Relates',
    terminalMode: raw.terminalMode?.trim().toUpperCase() || 'B',
    jiraEmail: raw.jiraEmail?.trim() || '',
    jiraToken: raw.jiraToken?.trim() || '',
    xrayClientId: raw.xrayClientId?.trim() || '',
    xrayClientSecret: raw.xrayClientSecret?.trim() || '',
    suites,
    plans,
    copiedFrom: null,
  }
}

export function resolveOutputDir(cfg, templateDir) {
  if (cfg.createNew) {
    return {
      outputDir: path.join(cfg.repoRoot, cfg.hookDirName),
      copiedFrom: templateDir,
    }
  }
  return {
    outputDir: path.join(cfg.repoRoot, cfg.hookDirName),
    copiedFrom: null,
  }
}

export function buildHooksConf(cfg) {
  const lines = [
    '# hooks.conf — Généré par le portail poste travail',
    `# Projet : ${cfg.project} | Environnement : ${cfg.environment} | Dossier hook : ${cfg.hookDirName}`,
    '# ─────────────────────────────────────────────────────────────────────────────',
    '',
    '[defaults]',
    `project=${cfg.project}`,
    `environment=${cfg.environment}`,
    `label=${cfg.label}`,
    `exclude_dirs=${cfg.excludeDirs}`,
    `jira_indexation_delay_sec=${cfg.indexationDelay}`,
    `suite_link_type=${cfg.suiteLinkType}`,
    `terminal_mode=${cfg.terminalMode || 'B'}`,
    '',
  ]

  for (const suite of cfg.suites) {
    lines.push(`# ── Suite : ${suite.name || suite.suite_key} ──`)
    if (suite.browseUrl) lines.push(`# URL : ${suite.browseUrl}`)
    lines.push('[suite]')
    lines.push(`suite_key=${suite.suite_key}`)
    if (suite.name) lines.push(`name=${suite.name}`)
    if (suite.link_type && suite.link_type !== cfg.suiteLinkType)
      lines.push(`link_type=${suite.link_type}`)
    lines.push('')
  }

  for (const plan of cfg.plans) {
    lines.push(`# Plan ${plan.plan_key} → Testing Board : ${plan.repositoryPath}`)
    if (plan.testingBoardUrl) lines.push(`# URL Testing Board : ${plan.testingBoardUrl}`)
    lines.push('[plan]')
    lines.push(`folder=${plan.folder}`)
    lines.push(`plan_key=${plan.plan_key}`)
    if (plan.suite_key) lines.push(`suite_key=${plan.suite_key}`)
    if (plan.repositoryPath !== `/${plan.folder}`)
      lines.push(`repository_path=${plan.repositoryPath}`)
    lines.push('')
  }

  return lines.join('\n')
}

export function buildEnv(cfg) {
  return [
    '# Credentials JIRA / Xray — NE PAS COMMITER',
    '# Généré par le portail poste travail',
    `HOOK_ENVIRONMENT=${cfg.environment}`,
    `JIRA_BASE_URL=${cfg.jiraBaseUrl}`,
    `JIRA_EMAIL=${cfg.jiraEmail}`,
    `JIRA_TOKEN=${cfg.jiraToken}`,
    `HTTPS_PROXY=${cfg.httpsProxy}`,
    `XRAY_CLIENT_ID=${cfg.xrayClientId}`,
    `XRAY_CLIENT_SECRET=${cfg.xrayClientSecret}`,
    '',
  ].join('\n')
}

export function buildPostCommit(cfg) {
  return `#!/bin/sh

# post-commit — Hook Git JIRA/Xray
# Généré par le portail — Dossier hook : ${cfg.hookDirName}
# terminal_mode : hooks.conf
# @HOOK_DIR@ remplacé par install-hook.ps1 à l'installation

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOK_DIR="$REPO_ROOT/@HOOK_DIR@"

if [ ! -f "$HOOK_DIR/install/post-commit-run.mjs" ]; then
  echo "[post-commit] post-commit-run.mjs introuvable — hook ignoré."
  exit 0
fi

if command -v node >/dev/null 2>&1; then
  NODE=node
elif [ -x "/c/Program Files/Volta/node" ]; then
  NODE="/c/Program Files/Volta/node"
else
  echo "[post-commit] node introuvable — hook ignoré."
  exit 0
fi

COMMIT_SHA=$(git -C "$REPO_ROOT" rev-parse HEAD)
exec "$NODE" "$HOOK_DIR/install/post-commit-run.mjs" "$COMMIT_SHA"
`
}

export function buildInstallHookCmd(cfg) {
  return `@echo off
REM install-hook.cmd — Installation manuelle du hook (sans PowerShell)
REM Généré par le portail poste travail

cd /d "%~dp0"
for /f "delims=" %%R in ('git -C "%~dp0.." rev-parse --show-toplevel 2^>nul') do set "REPO_ROOT=%%R"
if not defined REPO_ROOT (
  echo ERREUR: lancez depuis un depot git.
  exit /b 1
)

copy /Y "%~dp0post-commit.template" "%REPO_ROOT%\\.git\\hooks\\post-commit"
echo.
echo Hook installe : %REPO_ROOT%\\.git\\hooks\\post-commit
echo Dossier hook  : %REPO_ROOT%\\${cfg.hookDirName}
echo.
echo Verifiez le fichier .env dans le dossier hook.
pause
`
}

export function buildInstallHookPs1(cfg) {
  return `# install-hook.ps1 — Installe le hook post-commit JIRA/Xray
# Généré par le portail — Dossier attendu : ${cfg.hookDirName}

$ErrorActionPreference = "Stop"
$RepoRoot = git rev-parse --show-toplevel
if (-not $RepoRoot) { Write-Error "Pas un dépôt git."; exit 1 }

$HookDir     = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$HookDirName = Split-Path $HookDir -Leaf
$Template    = Join-Path $HookDir "install\\post-commit.template"
$TargetHook  = Join-Path $RepoRoot ".git\\hooks\\post-commit"

if (-not (Test-Path $Template)) {
    Write-Error "Template introuvable : $Template"
    exit 1
}

$content = Get-Content $Template -Raw -Encoding UTF8
$content = $content -replace '@HOOK_DIR@', $HookDirName
Set-Content -Path $TargetHook -Value $content -Encoding UTF8 -NoNewline

Write-Host "Hook installé : $TargetHook"
Write-Host "Dossier hook  : $HookDir"
Write-Host "Vérifiez .env : $HookDir\\.env"
`
}

export function buildRecap(cfg) {
  const plansList = cfg.plans.map(p => {
    const lines = [
      `  - ${p.plan_key} | dossier VS Code: ${p.folder}`,
      `    Testing Board (chemin Xray): ${p.repositoryPath}`,
    ]
    if (p.testingBoardUrl) lines.push(`    URL Testing Board: ${p.testingBoardUrl}`)
    lines.push(`    Plan JIRA: ${cfg.jiraBaseUrl}/browse/${p.plan_key}`)
    return lines.join('\n')
  }).join('\n\n')

  const copyNote = cfg.copiedFrom
    ? `\nToolkit copié depuis : ${cfg.copiedFrom}\n`
    : ''

  return `SETUP RECAP — Hook JIRA/Xray
Généré le ${new Date().toLocaleString('fr-FR')}
${copyNote}
═══════════════════════════════════════════════════════════════
CONFIGURATION
═══════════════════════════════════════════════════════════════
Dépôt Cypress (racine)     : ${cfg.repoRoot}
Dossier hook               : ${cfg.hookDirName}
Chemin complet hook        : ${path.join(cfg.repoRoot, cfg.hookDirName)}
Environnement              : ${cfg.environment} (${ENV_PRESETS[cfg.environment]?.label || cfg.environment})
URL JIRA                   : ${cfg.jiraBaseUrl}
Projet JIRA                : ${cfg.project}
Label tickets              : ${cfg.label}
Proxy HTTPS                : ${cfg.httpsProxy || '(aucun)'}

Suites (${cfg.suites.length}) :
${cfg.suites.map(s => {
  const line = `  - ${s.suite_key}${s.name ? ` (${s.name})` : ''}`
  return s.browseUrl ? `${line}\n    ${s.browseUrl}` : line
}).join('\n')}

Plans (${cfg.plans.length}) :
${plansList}

═══════════════════════════════════════════════════════════════
FICHIERS GÉNÉRÉS
═══════════════════════════════════════════════════════════════
  hooks.conf
  .env
  install/post-commit.template
  install/install-hook.cmd    ← si PowerShell bloqué par le SI
  install/install-hook.ps1
  docs/GUIDE_HOOK_JIRA_XRAY.html

Assistant de configuration :
  Extension VS Code « Wizard QA Assistant »  →  vue Hook JIRA/Xray

═══════════════════════════════════════════════════════════════
ÉTAPES SUIVANTES
═══════════════════════════════════════════════════════════════

1) Vérifier / compléter .env (tokens personnels)

2) Installer le hook Git (depuis le portail, onglet Installation)
   ou : node ${cfg.hookDirName}/install/install-hook.ps1

3) Créer les dossiers .feature à la racine du dépôt :
${cfg.plans.map(p => `   - ${path.join(cfg.repoRoot, p.folder)}`).join('\n')}

4) Tester :
   cd ${path.join(cfg.repoRoot, cfg.hookDirName)}
   node hook-run.mjs --force --dry-run
   node hook-run.mjs --force

5) Après un commit .feature :
   Get-Content hook-debug.log -Tail 20

═══════════════════════════════════════════════════════════════
COMMANDES UTILES
═══════════════════════════════════════════════════════════════
  node hook-run.mjs --force
  node scripts/xray-sync.mjs --folder "<dossier>" --plan-key <P0326-xxxx>

Relancer l'assistant :
  Extension VS Code « Wizard QA Assistant »
`
}

function writeOutputFile(outputDir, relPath, content, dryRun) {
  const full = path.join(outputDir, relPath)
  if (dryRun) return relPath
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, content, 'utf8')
  return relPath
}

export function generateConfig(rawCfg, { wizardDir, dryRun = false }) {
  const cfg = normalizeConfig(rawCfg, wizardDir)
  const templateDir = resolveHookTemplateDir(wizardDir, DEFAULT_HOOK_DIR_NAME)
  const { outputDir, copiedFrom } = resolveOutputDir(cfg, templateDir)
  cfg.copiedFrom = copiedFrom

  if (cfg.createNew) {
    if (!fs.existsSync(path.join(templateDir, 'hook-run.mjs'))) {
      throw new Error(`Dossier modèle introuvable : ${templateDir}`)
    }
    if (fs.existsSync(outputDir) && !cfg.overwriteOnCopy) {
      throw new Error(`Le dossier existe déjà : ${outputDir}`)
    }
    if (!dryRun) {
      copyDirRecursive(templateDir, outputDir)
    }
  } else if (!fs.existsSync(path.join(outputDir, 'hook-run.mjs'))) {
    throw new Error(`hook-run.mjs introuvable dans ${outputDir}`)
  }

  const files = {
    'hooks.conf': buildHooksConf(cfg),
    '.env': buildEnv(cfg),
    'install/post-commit.template': buildPostCommit(cfg),
    'install/install-hook.cmd': buildInstallHookCmd(cfg),
    'install/install-hook.ps1': buildInstallHookPs1(cfg),
    'SETUP_RECAP.txt': buildRecap(cfg),
  }

  const written = []
  for (const [rel, content] of Object.entries(files)) {
    writeOutputFile(outputDir, rel, content, dryRun)
    written.push(rel)
  }

  return {
    ok: true,
    dryRun,
    outputDir,
    hookDirName: cfg.hookDirName,
    copiedFrom,
    files: written,
    recap: files['SETUP_RECAP.txt'],
    cfg,
  }
}

export function getWizardDefaults(wizardDir) {
  return {
    hookDirName: DEFAULT_HOOK_DIR_NAME,
    repoRoot: detectGitRoot(wizardDir),
    environments: ENV_PRESETS,
    defaults: {
      project: 'P0326',
      label: 'TR_Cypress',
      excludeDirs: '_legacy,_legacy_before_fragmentation',
      indexationDelay: '9',
      suiteLinkType: 'Relates',
      environment: 'prod',
      jiraBaseUrl: ENV_PRESETS.prod.jiraBaseUrl,
    },
  }
}

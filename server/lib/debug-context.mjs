import fs from 'fs'
import path from 'path'
import { loadHookConfig } from './hook-config.mjs'
import { getHookMeta } from './hook-plan-api.mjs'
import { getHookGitReadiness } from './hook-git-readiness.mjs'
import { getProjectProfile } from './project-profile.mjs'
import { getPathsForApi, REPO_ROOT, HOOK_DIR, CONF_DIR } from './paths.mjs'
import { getWizardLogsDir, listWizardLogs, WIZARD_LOGS_REL } from './wizard-logs.mjs'
import { loadWizardDefaults } from './wizard-defaults.mjs'

const SECRET_KEYS = new Set([
  'JIRA_TOKEN',
  'XRAY_CLIENT_SECRET',
  'HTTPS_PROXY',
])

function maskSecret(value, { includeSecrets = false } = {}) {
  const s = String(value ?? '').trim()
  if (!s) return '*(non défini / vide)*'
  if (includeSecrets) return s
  if (s.length <= 6) return `*[défini — ${s.length} car.]*`
  return `*${s.slice(0, 2)}…${s.slice(-3)}* (${s.length} car.)`
}

function maskProxyUrl(proxy) {
  const s = String(proxy || '').trim()
  if (!s) return '*(non défini)*'
  try {
    const u = new URL(s)
    if (u.password) u.password = '***'
    if (u.username) u.username = u.username.slice(0, 2) + '***'
    return u.toString()
  } catch {
    return maskSecret(s)
  }
}

function fileInfo(absPath) {
  if (!absPath || !fs.existsSync(absPath)) {
    return { path: absPath || '', exists: false, size: 0, mtime: null }
  }
  const st = fs.statSync(absPath)
  return {
    path: absPath,
    exists: true,
    size: st.size,
    mtime: st.mtime.toISOString(),
  }
}

function readTail(absPath, maxChars = 12000) {
  if (!absPath || !fs.existsSync(absPath)) return ''
  try {
    const raw = fs.readFileSync(absPath, 'utf8')
    if (raw.length <= maxChars) return raw
    return `…(tronqué, ${raw.length} car. au total)\n${raw.slice(-maxChars)}`
  } catch (err) {
    return `(lecture impossible : ${err.message})`
  }
}

export function collectWizardDebugContext({
  hookDir: hookDirArg,
  includeSecrets = false,
  scope = 'wizard',
} = {}) {
  const hookDir = hookDirArg ?? HOOK_DIR
  const paths = getPathsForApi()
  const profile = getProjectProfile()
  const readiness = getHookGitReadiness()
  const wizardDefaults = loadWizardDefaults()
  const logsDir = getWizardLogsDir()
  const logFiles = listWizardLogs({ limit: 15 })

  let hook = null
  let meta = null
  try {
    hook = loadHookConfig(hookDir)
  } catch { /* ignore */ }
  try {
    meta = getHookMeta(hookDir)
  } catch { /* ignore */ }

  const env = hook?.env || {}
  const defaults = hook?.defaults || {}
  const plans = meta?.plans || []

  const hookDebugLog = path.join(hookDir, 'hook-debug.log')
  const hookLastRun = path.join(hookDir, 'hook-last-run.txt')
  const hookLastRunJson = path.join(hookDir, 'hook-last-run.json')
  const envPath = hook?.envPath || path.join(hookDir, '.env')
  const confPath = hook?.confPath || path.join(hookDir, 'hooks.conf')
  const variablesPath = path.join(CONF_DIR, 'project.variables.json')
  const wizardDefaultsPath = path.join(CONF_DIR, 'wizard.defaults.json')

  const lastDryRunLog = wizardDefaults?.hookGit?.lastDryRunLogPath
    ? path.join(REPO_ROOT, wizardDefaults.hookGit.lastDryRunLogPath.replace(/\//g, path.sep))
    : logFiles[0]?.fileName
      ? path.join(logsDir, logFiles[0].fileName)
      : null

  const credentials = {
    JIRA_BASE_URL: env.JIRA_BASE_URL || profile.jiraBaseUrl || '*(vide)*',
    JIRA_TOKEN: maskSecret(env.JIRA_TOKEN, { includeSecrets }),
    JIRA_EMAIL: env.JIRA_EMAIL || '*(vide)*',
    HOOK_ENVIRONMENT: env.HOOK_ENVIRONMENT || '*(vide)*',
    XRAY_CLIENT_ID: maskSecret(env.XRAY_CLIENT_ID, { includeSecrets }),
    XRAY_CLIENT_SECRET: maskSecret(env.XRAY_CLIENT_SECRET, { includeSecrets }),
    HTTPS_PROXY: maskProxyUrl(env.HTTPS_PROXY),
  }

  const hooksConfDefaults = {
    project: defaults.project || '*(vide)*',
    label: defaults.label || '*(vide)*',
    exclude_dirs: defaults.exclude_dirs || '*(vide)*',
    jira_indexation_delay_sec: defaults.jira_indexation_delay_sec || '*(vide)*',
    terminal_mode: defaults.terminal_mode || '*(vide)*',
    suite_link_type: defaults.suite_link_type || '*(vide)*',
  }

  const planRows = plans.map((p) => ({
    plan_key: p.plan_key,
    folder: p.folder,
    folder_abs: meta?.repoRoot ? path.join(meta.repoRoot, p.folder) : p.folder,
    suite_key: p.suite_key || '—',
    testing_board_url: p.testingBoardUrl || p.testing_board_url || '*(non renseigné)*',
    repository_path: p.repository_path || p.repositoryPath || '—',
  }))

  const profileTestPlans = (profile.testPlans || []).map((p) => ({
    planKey: p.planKey || '—',
    planName: p.planName || '—',
    folderName: p.folderName || '—',
    testingBoardUrl: p.testingBoardUrl || '*(non renseigné)*',
  }))

  const arborescences = (profile.arborescences || []).map((a) => ({
    label: a.label || a.name || '—',
    path: a.path || a.folder || '—',
    path_abs: a.path ? path.resolve(REPO_ROOT, a.path) : (a.folder ? path.join(REPO_ROOT, a.folder) : '—'),
  }))

  let projectVariables = null
  if (fs.existsSync(variablesPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(variablesPath, 'utf8'))
      projectVariables = {
        ...raw,
        jiraSync: raw.jiraSync ? {
          ...raw.jiraSync,
          xrayClientSecret: maskSecret(raw.jiraSync.xrayClientSecret, { includeSecrets }),
        } : undefined,
        variables: raw.variables ? {
          ...raw.variables,
          $XRAY_CLIENT_SECRET: maskSecret(raw.variables.$XRAY_CLIENT_SECRET, { includeSecrets }),
        } : undefined,
      }
    } catch { /* ignore */ }
  }

  const absolutePaths = {
    repoRoot: REPO_ROOT,
    hookDir,
    hooksConf: confPath,
    hookEnv: envPath,
    wizardConfDir: CONF_DIR,
    wizardLogsDir: logsDir,
    wizardLogsRelative: WIZARD_LOGS_REL,
    projectVariables: variablesPath,
    wizardDefaults: wizardDefaultsPath,
    hookDebugLog,
    hookLastRunTxt: hookLastRun,
    hookLastRunJson,
    lastDryRunLogMd: lastDryRunLog,
    npmrc: process.env.USERPROFILE
      ? path.join(process.env.USERPROFILE, '.npmrc')
      : paths.npmrcDisplay,
  }

  return {
    scope,
    generatedAt: new Date().toISOString(),
    includeSecrets,
    credentials,
    hooksConfDefaults,
    plans: planRows,
    profileTestPlans,
    arborescences,
    projectVariables,
    profile: {
      tribu: profile.tribu,
      squad: profile.squad,
      productCode: profile.productCode,
      solutionCode: profile.solutionCode,
      applicationLabel: profile.applicationLabel,
      gitRepository: profile.gitRepository || REPO_ROOT,
      poName: profile.poName,
      baName: profile.baName,
      scrumMasterName: profile.scrumMasterName,
      qaName: profile.qaName,
      usesJiraPlans: profile.usesJiraPlans,
      onboardingComplete: profile.onboardingComplete,
      arborescencesCount: (profile.arborescences || []).length,
      testPlansCount: (profile.testPlans || []).length,
    },
    readiness: {
      configured: readiness.configured,
      dryRunOk: readiness.dryRunOk,
      readyForJiraSync: readiness.readyForJiraSync,
      message: readiness.message,
      lastDryRunAt: readiness.lastDryRunAt,
      lastDryRunLogFile: readiness.lastDryRunLogFile,
      checks: readiness.checks || [],
    },
    paths: absolutePaths,
    pathsApi: paths,
    logFiles: logFiles.map((f) => {
      const abs = path.join(logsDir, f.fileName)
      const st = fs.existsSync(abs) ? fs.statSync(abs) : null
      return { ...f, absolutePath: abs, size: st?.size ?? 0 }
    }),
    fileStatus: {
      env: fileInfo(envPath),
      hooksConf: fileInfo(confPath),
      hookDebugLog: fileInfo(hookDebugLog),
      hookLastRun: fileInfo(hookLastRun),
      lastDryRunLog: fileInfo(lastDryRunLog),
    },
    logExcerpts: {
      hookDebugLog: readTail(hookDebugLog, 8000),
      hookLastRun: readTail(hookLastRun, 6000),
      lastDryRunLog: readTail(lastDryRunLog, 12000),
    },
  }
}

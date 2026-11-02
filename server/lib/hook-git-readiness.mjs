import { verifyHook } from './verify.mjs'
import { loadWizardDefaults, saveWizardDefaults } from './wizard-defaults.mjs'

export function getHookGitReadiness() {
  const verify = verifyHook()
  const hookGit = loadWizardDefaults().hookGit || {}
  const dryRunOk = Boolean(hookGit.dryRunOk)
  const configured = verify.ok
  const readyForJiraSync = configured && dryRunOk

  let message = 'Paramétrez .env, hooks.conf et installez post-commit'
  if (configured && !dryRunOk) {
    message = 'La configuration du Hook Git est nécessaire pour effectuer un lien entre votre local et JIRA/XRAY'
  } else if (readyForJiraSync) {
    message = 'Hook Git opérationnel — Sync JIRA débloquée'
  }

  return {
    configured,
    dryRunOk,
    readyForJiraSync,
    lastDryRunAt: hookGit.lastDryRunAt || null,
    lastDryRunLogFile: hookGit.lastDryRunLogPath || hookGit.lastDryRunLogFile || null,
    lastDryRunLogDisplayTime: hookGit.lastDryRunLogDisplayTime || null,
    checks: verify.checks,
    message,
  }
}

export function saveHookDryRunResult(ok, output = '', logMeta = null) {
  const current = loadWizardDefaults()
  const hookGit = {
    ...(current.hookGit || {}),
    dryRunOk: Boolean(ok),
    lastDryRunAt: new Date().toISOString(),
    lastDryRunOutput: String(output).slice(-8000),
    lastDryRunLogFile: logMeta?.fileName || null,
    lastDryRunLogPath: logMeta?.relativePath || null,
    lastDryRunLogDisplayTime: logMeta?.displayTime || null,
  }
  saveWizardDefaults({ hookGit })
  return hookGit
}

export function invalidateHookDryRun(reason = 'Configuration modifiée — relancez le dry-run') {
  const current = loadWizardDefaults()
  const hookGit = {
    ...(current.hookGit || {}),
    dryRunOk: false,
    invalidatedAt: new Date().toISOString(),
    invalidationReason: reason,
  }
  saveWizardDefaults({ hookGit })
  return hookGit
}

/** Réinitialise le wizard Hook Git (dry-run invalidé, brouillon wizard effacé). */
export function restartHookWizard() {
  const current = loadWizardDefaults()
  const hookGit = {
    ...(current.hookGit || {}),
    dryRunOk: false,
    restartedAt: new Date().toISOString(),
    invalidationReason: 'Reconfiguration demandée depuis le wizard',
    lastDryRunOutput: '',
  }
  saveWizardDefaults({
    hookGit,
    hook: { ...(current.hook || {}), simple: null },
  })
  return { ok: true, readiness: getHookGitReadiness() }
}

export function assertHookGitReadyForJiraSync() {
  const readiness = getHookGitReadiness()
  if (readiness.readyForJiraSync) return readiness
  const err = new Error(
    readiness.configured
      ? 'Hook Git configuré mais dry-run non validé — ouvrez Hook Git et lancez un dry-run réussi.'
      : 'Hook Git non configuré — paramétrez .env, hooks.conf et installez post-commit avant Sync JIRA.',
  )
  err.code = 'HOOK_GIT_NOT_READY'
  err.readiness = readiness
  throw err
}

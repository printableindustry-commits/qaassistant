import path from 'path'
import { HOOK_DIR, REPO_ROOT } from './paths.mjs'
import { mergeHookEnv } from './hook-config.mjs'

/** Reporte URL JIRA et tokens Xray du profil projet vers le .env du Hook Git. */
export function syncProfileCredentialsToHook(profile) {
  if (!profile) return { synced: false, reason: 'Profil vide' }

  const patch = {}
  const jiraBaseUrl = String(profile.jiraBaseUrl || '').trim()
  const xrayClientId = String(profile.xrayClientId || '').trim()
  const xrayClientSecret = String(profile.xrayClientSecret || '').trim()

  if (jiraBaseUrl) patch.JIRA_BASE_URL = jiraBaseUrl
  if (xrayClientId) patch.XRAY_CLIENT_ID = xrayClientId
  if (xrayClientSecret) patch.XRAY_CLIENT_SECRET = xrayClientSecret

  if (!Object.keys(patch).length) {
    return { synced: false, reason: 'Aucun credential à synchroniser' }
  }

  const result = mergeHookEnv(HOOK_DIR, patch)
  if (!result.written) return { synced: false, reason: result.reason }

  return {
    synced: true,
    envPath: path.relative(REPO_ROOT, result.envPath).replace(/\\/g, '/'),
    absolutePath: result.envPath,
    keys: Object.keys(patch),
  }
}

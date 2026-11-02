import path from 'path'
import { REPO_ROOT } from './paths.mjs'
import { getK6Profile } from './k6-profiles.mjs'
import { applyK6ProfileToProject } from './k6-perf-generator.mjs'
import { runK6CliArgs } from './stack-command-runner.mjs'
import { appendK6Run } from './k6-run-history.mjs'

export async function runK6Campaign(profileId, { mode = 'full' } = {}) {
  const profile = getK6Profile(profileId)
  if (!profile) throw new Error('Profil introuvable')

  const applied = applyK6ProfileToProject(profile)
  const scriptAbs = path.join(REPO_ROOT, applied.scriptPath)
  const baseUrl = String(profile.answers?.baseUrl || '').trim()
  const answers = profile.answers || {}

  const k6Args = ['run', scriptAbs]
  if (baseUrl) k6Args.push('-e', `BASE_URL=${baseUrl}`)

  const tokenVar = answers.tokenEnvVar || 'AUTH_TOKEN'
  if (answers.authMode === 'bearer' && tokenVar) {
    k6Args.push('-e', `${tokenVar}=${process.env[tokenVar] || ''}`)
  }

  if (mode === 'incremental') {
    const smokeVus = Math.min(Number(answers.virtualUsers) || 5, 10)
    const smokeDuration = '30s'
    k6Args.push('--vus', String(smokeVus), '--duration', smokeDuration)
  }

  const result = await runK6CliArgs(k6Args, REPO_ROOT)

  const historyEntry = {
    profileId: profile.id,
    profileName: profile.name,
    campaignName: answers.campaignName || profile.name,
    environment: answers.environment || '',
    objective: answers.campaignObjective || '',
    status: result.ok ? 'success' : 'failed',
    command: result.command,
    notes: mode === 'incremental' ? 'Exécution incrémentale (smoke 30s)' : 'Exécution complète',
    summary: {
      vus: answers.virtualUsers,
      duration: mode === 'incremental' ? '30s' : answers.duration,
      p95Ms: answers.p95Ms,
      solutionCode: profile.meta?.solutionCode || answers.solutionCode,
      exitCode: result.code,
    },
  }

  try {
    appendK6Run(historyEntry)
  } catch { /* historique non bloquant */ }

  return {
    ok: result.ok,
    code: result.code,
    output: result.output,
    command: result.command,
    scriptPath: applied.scriptPath,
    mode,
    message: result.ok
      ? `Campagne « ${profile.name} » terminée (code ${result.code}).`
      : `Campagne « ${profile.name} » échouée (code ${result.code}).`,
  }
}

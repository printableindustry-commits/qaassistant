/**
 * Exécution bloquante d'une campagne (écran V2 « Scénarios k6 », POST /api/k6/profiles/:id/run).
 * L'écran Performance (V3) utilise le gestionnaire non bloquant server/lib/perf/run-manager.mjs.
 *
 * Les secrets (jeton, mot de passe) sont transmis par l'environnement du processus k6, jamais sur
 * la ligne de commande (ils finiraient dans l'historique et la console). Les métriques mesurées
 * sont lues dans --summary-export et consignées dans l'historique.
 */
import path from 'path'
import fs from 'fs'
import { REPO_ROOT } from './paths.mjs'
import { getK6Profile } from './k6-profiles.mjs'
import { applyK6ProfileToProject } from './k6-perf-generator.mjs'
import { runK6CliArgs } from './stack-command-runner.mjs'
import { appendK6Run } from './k6-run-history.mjs'
import { parseSummary, verdictOf } from './perf/summary.mjs'

function buildEnv(answers) {
  const env = { ...process.env }
  if (answers.useProxy === 'custom' && answers.proxyUrl) {
    env.HTTP_PROXY = answers.proxyUrl
    env.HTTPS_PROXY = answers.proxyUrl
  } else if (answers.useProxy === 'no') {
    for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy']) delete env[k]
  }
  return env
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

export async function runK6Campaign(profileId, { mode = 'full' } = {}) {
  const profile = getK6Profile(profileId)
  if (!profile) throw new Error('Profil introuvable')
  const answers = profile.answers || {}

  const applied = applyK6ProfileToProject(profile)
  const scriptAbs = path.join(REPO_ROOT, applied.scriptPath)
  const baseUrl = String(answers.baseUrl || '').trim()

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const reportsDir = path.join(REPO_ROOT, 'reports', 'k6')
  fs.mkdirSync(reportsDir, { recursive: true })
  const summaryPath = path.join(reportsDir, `run-${stamp}.summary.json`)

  const k6Args = ['run', '--summary-export', summaryPath]
  if (baseUrl) k6Args.push('-e', `BASE_URL=${baseUrl}`)
  if (answers.tlsInsecure === 'yes') k6Args.push('--insecure-skip-tls-verify')
  const outputs = Array.isArray(answers.outputFormats) ? answers.outputFormats : []
  if (outputs.includes('json')) k6Args.push('--out', `json=${path.join(reportsDir, `run-${stamp}.json`)}`)
  if (outputs.includes('csv')) k6Args.push('--out', `csv=${path.join(reportsDir, `run-${stamp}.csv`)}`)

  // Test rapide : on réduit la charge via les variables lues par le script, sans remplacer
  // le modèle d'exécution (--vus/--duration écraseraient les scénarios).
  const quickVus = Math.min(Number(answers.virtualUsers) || 5, 10)
  if (mode === 'incremental') k6Args.push('-e', `VUS=${quickVus}`, '-e', 'DURATION=30s')
  k6Args.push(scriptAbs)

  const startedAt = Date.now()
  const result = await runK6CliArgs(k6Args, REPO_ROOT, buildEnv(answers))
  const durationMs = Date.now() - startedAt
  const parsed = parseSummary(readJson(summaryPath) || {})
  const hasMetrics = parsed.metrics.p95 != null
  const status = verdictOf({
    thresholds: parsed.thresholds,
    exitCode: result.code,
    stopped: result.stopped,
    error: !hasMetrics && result.code !== 0 && result.code !== 99 ? 'sans mesure' : null,
  })

  try {
    appendK6Run({
      profileId: profile.id,
      profileName: profile.name,
      campaignName: answers.campaignName || profile.name,
      environment: answers.environment || '',
      objective: answers.campaignObjective || '',
      status,
      command: result.command,
      reportPath: path.relative(REPO_ROOT, summaryPath).replace(/\\/g, '/'),
      notes: mode === 'incremental' ? 'Exécution incrémentale (test rapide 30 s)' : 'Exécution complète',
      summary: {
        measured: hasMetrics,
        durationMs,
        exitCode: result.code,
        vus: mode === 'incremental' ? quickVus : answers.virtualUsers,
        duration: mode === 'incremental' ? '30s' : answers.duration,
        p95Ms: hasMetrics ? parsed.metrics.p95 : null,
        metrics: hasMetrics ? parsed.metrics : null,
        solutionCode: profile.meta?.solutionCode || answers.solutionCode,
      },
    })
  } catch { /* historique non bloquant */ }

  const verdictText = {
    passed: 'terminée — seuils respectés',
    failed: 'terminée — seuils non respectés',
    error: `en erreur (code ${result.code})`,
    stopped: 'arrêtée',
  }[status]
  return {
    ok: status === 'passed',
    code: result.code,
    output: result.output,
    command: result.command,
    scriptPath: applied.scriptPath,
    mode,
    status,
    metrics: hasMetrics ? parsed.metrics : null,
    thresholds: parsed.thresholds,
    stopped: !!result.stopped,
    message: `Campagne « ${profile.name} » ${verdictText}.`,
  }
}

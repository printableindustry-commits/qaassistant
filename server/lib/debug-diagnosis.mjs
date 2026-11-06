import { collectScopeAdapterBundle, detectWizardExtensionPaths } from './debug-page-adapters.mjs'
import { collectScopeVerboseBundle } from './debug-verbose-logs.mjs'
import { getHookGitReadiness } from './hook-git-readiness.mjs'

function extractErrors(text) {
  const lines = String(text || '').split('\n')
  const hits = lines.filter((l) => /ERREUR|ERROR|échec|failed|KO\b/i.test(l))
  return hits.slice(-5)
}

const SCOPE_HYPOTHESES = {
  'hook-git': [
    'Credentials JIRA / Xray invalides ou expirés',
    'Proxy ZGIE mal configuré dans .env',
    'hooks.conf : plan_key ou dossier VS Code incorrect',
    'Délai indexation JIRA insuffisant',
    'Hook post-commit non installé',
  ],
  'sync-jira': [
    'Écarts dry-run JIRA vs Xray par plan',
    'Tickets orphelins ou doublons dans JIRA',
    'Dossier local absent pour un plan déclaré',
    'Dry-run Hook non validé',
  ],
  'node-install': [
    'Volta non installé ou absent du PATH',
    'Téléchargement Node bloqué par proxy',
    'Version Node incompatible avec le projet',
  ],
  npmrc: [
    'Token Artifactory expiré ou mal encodé',
    'proxy / https-proxy incorrects dans .npmrc',
    'Registry npm interne inaccessible',
  ],
  'npm-install': [
    'Registry Artifactory inaccessible',
    'Dépendance absente ou version conflictuelle',
    '.npmrc non configuré avant npm install',
  ],
  'playwright-install': [
    'npm ou npx introuvable dans le PATH',
    'Paquet @playwright/test absent ou en conflit de version',
    'Téléchargement des navigateurs bloqué par le proxy',
    'Dossier projet incorrect ou package.json absent',
  ],
  'k6-install': [
    'Binaire k6 absent du PATH après installation',
    'winget / choco indisponible ou bloqué',
    'Droits insuffisants pour installer k6',
  ],
  'k6-wizard': [
    'k6 introuvable ou version incompatible',
    'Script k6 généré invalide ou chemin de rapport inaccessible',
  ],
  'doc-qa': [
    'Snapshot projet obsolète ou incomplet',
    'Fichiers livrables manquants dans le dépôt',
    'Configuration scan doc-qa incorrecte',
  ],
}

export function buildDebugDiagnosis({
  scope = 'wizard',
  log = '',
  error = '',
  verboseBundle = null,
  adapterBundle = null,
} = {}) {
  const readiness = getHookGitReadiness()
  const adapter = adapterBundle || collectScopeAdapterBundle(scope)
  const verbose = verboseBundle || collectScopeVerboseBundle(scope)
  const combinedLog = [log, verbose.combinedOutput].filter(Boolean).join('\n')
  const errors = extractErrors(combinedLog)
  const lastError = errors[errors.length - 1] || String(error || '').trim() || null

  const checks = []
  if (['hook-git', 'sync-jira'].includes(scope)) {
    checks.push({ name: 'Hook configuré', ok: readiness.configured, message: readiness.message })
    checks.push({ name: 'Dry-run OK', ok: readiness.dryRunOk, message: readiness.lastDryRunAt || '—' })
    checks.push({ name: 'Sync JIRA débloquée', ok: readiness.readyForJiraSync, message: '' })
  }
  checks.push({
    name: 'Logs verbeux scope',
    ok: (verbose.recentLogs || []).length > 0,
    message: `${(verbose.recentLogs || []).length} fichier(s) dans ${verbose.logDirRelative}`,
  })

  const koChecks = checks.filter((c) => !c.ok)
  const hypotheses = (SCOPE_HYPOTHESES[scope] || SCOPE_HYPOTHESES['hook-git']).slice(0, 5)

  const summaryLines = [
    `Scope **${scope}** — page **${adapter.title || scope}**.`,
    koChecks.length
      ? `${koChecks.length} vérification(s) en échec : ${koChecks.map((c) => c.name).join(', ')}.`
      : 'Toutes les vérifications automatiques sont OK.',
    lastError ? `Dernière erreur détectée : \`${lastError.slice(0, 180)}\`` : 'Aucune erreur explicite dans les logs récents.',
    `Logs verbeux : \`${verbose.logDirRelative}\` (${(verbose.recentLogs || []).length} fichier(s) récent(s)).`,
  ]

  const extensionPaths = detectWizardExtensionPaths()

  return {
    summary: summaryLines.join('\n'),
    checks,
    hypotheses,
    lastError,
    koCount: koChecks.length,
    adapter,
    verbose,
    extensionPaths,
  }
}

export function formatDiagnosisMarkdown(diagnosis) {
  if (!diagnosis) return '_Diagnostic indisponible._'
  const checkTable = (diagnosis.checks || [])
    .map((c) => `| ${c.name} | ${c.ok ? 'OK' : 'KO'} | ${c.message || '—'} |`)
    .join('\n')
  const hypo = (diagnosis.hypotheses || []).map((h, i) => `${i + 1}. ${h}`).join('\n')
  return `## Résumé exécutif

${diagnosis.summary}

## Diagnostic automatique

| Vérification | Statut | Détail |
| --- | --- | --- |
${checkTable || '| — | — | — |'}

### Hypothèses prioritaires
${hypo || '_Aucune_'}

${diagnosis.lastError ? `### Dernière erreur\n\`${diagnosis.lastError}\`\n` : ''}`
}

export function buildPreflight(diagnosis) {
  const d = diagnosis || {}
  return {
    hookOk: d.checks?.find((c) => c.name === 'Hook configuré')?.ok ?? null,
    dryRunOk: d.checks?.find((c) => c.name === 'Dry-run OK')?.ok ?? null,
    syncUnlocked: d.checks?.find((c) => c.name === 'Sync JIRA débloquée')?.ok ?? null,
    verboseLogsCount: d.verbose?.recentLogs?.length ?? 0,
    koCount: d.koCount ?? 0,
  }
}

export function estimatePromptTokens(text) {
  const len = String(text || '').length
  return {
    charCount: len,
    promptSizeKb: Math.round((len / 1024) * 10) / 10,
    tokenEstimate: Math.ceil(len / 4),
  }
}

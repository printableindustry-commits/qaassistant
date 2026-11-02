import fs from 'fs'
import path from 'path'
import { REPO_ROOT } from './paths.mjs'

export const WIZARD_LOGS_REL = '.wizard-qa/logs'

export function getWizardLogsDir() {
  const dir = path.join(REPO_ROOT, WIZARD_LOGS_REL)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** Nom fichier sûr Windows : YYYY-MM-DD_HH-mm-ss_Log_DryRun_Hook_Git.md */
export function formatDryRunLogFileName(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  const y = date.getFullYear()
  const m = pad(date.getMonth() + 1)
  const d = pad(date.getDate())
  const h = pad(date.getHours())
  const mi = pad(date.getMinutes())
  const s = pad(date.getSeconds())
  return `${y}-${m}-${d}_${h}-${mi}-${s}_Log_DryRun_Hook_Git.md`
}

export function formatDryRunLogDisplayTime(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

const SYNC_LOG_LABELS = {
  analyze: 'Sync_JIRA_Analyze',
  'sync-local': 'Sync_Local_JIRA',
  'sync-preview': 'Sync_JIRA_Preview',
}

export function formatSyncLogFileName(kind, date = new Date()) {
  const label = SYNC_LOG_LABELS[kind] || 'Sync_JIRA'
  const pad = (n) => String(n).padStart(2, '0')
  const y = date.getFullYear()
  const m = pad(date.getMonth() + 1)
  const d = pad(date.getDate())
  const h = pad(date.getHours())
  const mi = pad(date.getMinutes())
  const s = pad(date.getSeconds())
  return `${y}-${m}-${d}_${h}-${mi}-${s}_Log_${label}.md`
}

export function writeSyncLog({
  kind = 'analyze',
  output = '',
  ok = false,
  command = '',
  exitCode = null,
  summary = '',
  plans = [],
} = {}) {
  const dir = getWizardLogsDir()
  const now = new Date()
  const fileName = formatSyncLogFileName(kind, now)
  const filePath = path.join(dir, fileName)
  const displayTime = formatDryRunLogDisplayTime(now)
  const title = kind === 'sync-local'
    ? 'Log Synchronisation Local → JIRA / Xray'
    : kind === 'sync-preview'
      ? 'Log Aperçu synchronisation Sync JIRA'
      : 'Log Analyse Sync JIRA'

  const planLines = (plans || []).map((p) =>
    `- **${p.plan_key || p.folder}** : ${String(p.status || '').toUpperCase()}`
      + ` (JIRA ${String(p.jira?.status || '—').toUpperCase()}`
      + ` / Xray ${String(p.xray?.status || '—').toUpperCase()})`,
  ).join('\n')

  const content = `# ${title}

| Champ | Valeur |
|-------|--------|
| Horodatage | ${displayTime} |
| Fichier | \`${fileName}\` |
| Statut | **${ok ? 'OK' : 'KO'}** |
| Code retour | ${exitCode ?? (ok ? 0 : 1)} |
| Commande | \`${command || '—'}\` |

${summary ? `## Résumé\n\n${summary}\n` : ''}
${planLines ? `\n## Plans\n\n${planLines}\n` : ''}
## Sortie console (verbose)

\`\`\`text
${String(output || '(aucune sortie)').trimEnd()}
\`\`\`

---
*Généré par Wizard QA Assistant — Sync JIRA*
`

  fs.writeFileSync(filePath, content, 'utf8')
  const relativePath = path.join(WIZARD_LOGS_REL, fileName).replace(/\\/g, '/')
  return { fileName, filePath, relativePath, displayTime }
}

export function writeDryRunLog({
  output = '',
  ok = false,
  readiness = null,
  command = 'node hook-run.mjs --force --dry-run',
  exitCode = null,
  checks = [],
} = {}) {
  const dir = getWizardLogsDir()
  const now = new Date()
  const fileName = formatDryRunLogFileName(now)
  const filePath = path.join(dir, fileName)
  const displayTime = formatDryRunLogDisplayTime(now)

  const checkLines = (checks || []).map((c) =>
    `- **${c.name || c.label}** : ${c.ok ? 'OK' : 'KO'}${c.message ? ` — ${c.message}` : ''}`,
  ).join('\n')

  const content = `# Log Dry-run Hook Git

| Champ | Valeur |
|-------|--------|
| Horodatage | ${displayTime} |
| Fichier | \`${fileName}\` |
| Statut | **${ok ? 'OK' : 'KO'}** |
| Code retour | ${exitCode ?? (ok ? 0 : 1)} |
| Commande | \`${command}\` |

## Résumé

- Hook configuré : **${readiness?.configured ? 'oui' : 'non'}**
- Dry-run validé : **${ok ? 'oui' : 'non'}**
- Sync JIRA débloquée : **${readiness?.readyForJiraSync ? 'oui' : 'non'}**
${readiness?.message ? `\n> ${readiness.message}\n` : ''}
${checkLines ? `\n## Vérifications\n\n${checkLines}\n` : ''}
## Sortie console (verbose)

\`\`\`text
${String(output || '(aucune sortie)').trimEnd()}
\`\`\`

---
*Généré par Wizard QA Assistant — Hook Git dry-run*
`

  fs.writeFileSync(filePath, content, 'utf8')
  const relativePath = path.join(WIZARD_LOGS_REL, fileName).replace(/\\/g, '/')
  return { fileName, filePath, relativePath, displayTime }
}

export function listWizardLogs({ limit = 20 } = {}) {
  const dir = getWizardLogsDir()
  const files = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const abs = path.join(dir, f)
      const st = fs.statSync(abs)
      return { fileName: f, relativePath: path.join(WIZARD_LOGS_REL, f).replace(/\\/g, '/'), mtime: st.mtimeMs }
    })
    .sort((a, b) => b.mtime - a.mtime)
  return files.slice(0, limit)
}

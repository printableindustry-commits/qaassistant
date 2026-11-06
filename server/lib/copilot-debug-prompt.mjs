/**
 * Construction de prompts DEBUG — agent IA (Claude Sonnet 4.6, Copilot, etc.)
 * Réutilisable dans tout le portail Wizard QA.
 */
import fs from 'fs'
import { collectWizardDebugContext } from './debug-context.mjs'
import { getMemoryBlockForPrompt } from './debug-agent-memory.mjs'
import { collectScopeVerboseBundle } from './debug-verbose-logs.mjs'
import { collectScopeAdapterBundle, detectWizardExtensionPaths } from './debug-page-adapters.mjs'
import { buildDebugDiagnosis, formatDiagnosisMarkdown, estimatePromptTokens } from './debug-diagnosis.mjs'

function table(rows) {
  if (!rows?.length) return '_Aucune entrée_'
  const headers = Object.keys(rows[0])
  const sep = `| ${headers.join(' | ')} |`
  const line = `| ${headers.map(() => '---').join(' | ')} |`
  const body = rows.map((r) => `| ${headers.map((h) => String(r[h] ?? '—').replace(/\|/g, '\\|')).join(' | ')} |`).join('\n')
  return [sep, line, body].join('\n')
}

function kvList(obj) {
  return Object.entries(obj || {})
    .map(([k, v]) => `- **${k}** : ${String(v ?? '—')}`)
    .join('\n')
}

function pathsTableSafe(paths) {
  return Object.entries(paths || {})
    .map(([k, v]) => {
      const exists = v && fs.existsSync(v)
      return `- **${k}** : \`${v}\`${exists === false ? ' *(absent)*' : exists ? '' : ''}`
    })
    .join('\n')
}

export function buildCopilotDebugPrompt({
  title = 'Debug Wizard QA Assistant',
  context = '',
  log = '',
  error = '',
  environment = {},
  stepsToReproduce = [],
  suggestedQuestions = [],
  source = 'Wizard QA Assistant',
  wizardContext = null,
  enrich = true,
  hookDir = undefined,
  includeSecrets = false,
  scope = 'wizard',
  agentModel = 'Claude Sonnet 4.6',
  userEnrichment = '',
  verboseBundle = null,
  diagnosis = null,
} = {}) {
  const adapterBundle = collectScopeAdapterBundle(scope)
  const verbose = verboseBundle || (scope !== 'wizard' ? collectScopeVerboseBundle(scope) : null)
  const diag = diagnosis || buildDebugDiagnosis({
    scope,
    log,
    error,
    verboseBundle: verbose,
    adapterBundle,
  })

  const ctx = wizardContext || (enrich && ['hook-git', 'sync-jira', 'wizard'].includes(scope)
    ? collectWizardDebugContext({ hookDir, includeSecrets, scope })
    : null)

  const memoryBlock = scope !== 'wizard' ? getMemoryBlockForPrompt(scope) : '_Scope générique._'
  const diagnosisBlock = formatDiagnosisMarkdown(diag)
  const extensionPaths = diag.extensionPaths || detectWizardExtensionPaths()

  const mergedLog = [log, verbose?.combinedOutput].filter(Boolean).join('\n\n')

  const stepsBlock = (stepsToReproduce || []).length
    ? stepsToReproduce.map((s, i) => `${i + 1}. ${s}`).join('\n')
    : '_Non renseigné_'

  const questions = (suggestedQuestions || []).length
    ? suggestedQuestions.map((q) => `- ${q}`).join('\n')
    : (adapterBundle.suggestedQuestions || []).map((q) => `- ${q}`).join('\n') || `- Identifier la cause racine de l'échec
- Proposer des corrections fichier par fichier
- Valider avec une nouvelle exécution`

  const enrichmentBlock = String(userEnrichment || '').trim()
    ? `\n## Enrichissement utilisateur\n${userEnrichment.trim()}\n`
    : ''

  const extensionBlock = extensionPaths
    ? `\n## Code source extension Wizard (base de travail)\n- **Racine extension** : \`${extensionPaths.extensionRoot}\`\n- **Serveur** : \`${extensionPaths.serverDir}\`\n> ${extensionPaths.note}\n> Le bug peut concerner l'extension Wizard elle-même — proposez des patches sur les fichiers listés.\n`
    : ''

  const adapterBlock = verbose?.adapterBundle || adapterBundle
    ? `\n## Contexte page (${scope})\n${adapterBundle.title ? `- **Page** : ${adapterBundle.title}` : ''}\n${adapterBundle.keyFiles ? Object.entries(adapterBundle.keyFiles).map(([k, v]) => `- **${k}** : \`${v}\``).join('\n') : ''}\n`
    : ''

  const extraEnv = Object.keys(environment || {}).length
    ? `\n### Contexte page / action\n${kvList(environment)}\n`
    : ''

  let wizardBlock = ''
  if (ctx) {
    const credRows = Object.entries(ctx.credentials).map(([k, v]) => ({ Variable: k, Valeur: v }))
    const planRows = ctx.plans.map((p) => ({
      'Plan JIRA': p.plan_key,
      'Dossier VS Code': p.folder,
      'Chemin absolu': p.folder_abs,
      'Suite': p.suite_key,
      'Testing Board URL': p.testing_board_url || p.testingBoardUrl,
    }))

    const checkLines = (ctx.readiness.checks || [])
      .map((c) => `- ${c.name} : ${c.ok ? 'OK' : 'KO'} — ${c.message || ''}`)
      .join('\n') || '_Aucune vérification_'

    const logFileLines = (ctx.logFiles || [])
      .map((f) => `- \`${f.absolutePath}\` (${Math.round(f.size / 1024)} Ko, ${f.fileName})`)
      .join('\n') || '_Aucun log Wizard pour l\'instant_'

    wizardBlock = `
## Configuration Wizard — prise de référence & Hook Git

### Credentials (.env du hook)
${table(credRows)}

> Les secrets sont masqués dans ce prompt. Fichier complet : \`${ctx.paths.hookEnv}\`
> ${ctx.includeSecrets ? '_Secrets inclus sur demande explicite._' : '_Pour inclure les secrets, regénérer avec `includeSecrets: true` (usage local uniquement)._'}

### hooks.conf — [defaults]
${kvList(ctx.hooksConfDefaults)}

### Plans de test — dossiers VS Code ↔ JIRA / Xray
${planRows.length ? table(planRows) : '_Aucun plan dans hooks.conf_'}

### Profil projet (prise de connaissance)
${kvList(ctx.profile)}

### Plans de test — prise de référence (onboarding)
${(ctx.profileTestPlans || []).length ? table(ctx.profileTestPlans.map((p) => ({
  'Plan JIRA': p.planKey,
  'Nom': p.planName,
  'Dossier': p.folderName,
  'Testing Board URL': p.testingBoardUrl,
}))) : '_Aucun plan dans le profil projet_'}

### Arborescences VS Code (dossiers du dépôt)
${(ctx.arborescences || []).length ? table(ctx.arborescences.map((a) => ({
  Libellé: a.label,
  'Chemin relatif': a.path,
  'Chemin absolu': a.path_abs,
}))) : '_Aucune arborescence déclarée_'}

### project.variables.json
\`\`\`json
${ctx.projectVariables ? JSON.stringify(ctx.projectVariables, null, 2) : '(fichier absent ou illisible)'}
\`\`\`

### État Hook / dry-run
- **Hook configuré** : ${ctx.readiness.configured ? 'oui' : 'non'}
- **Dry-run OK** : ${ctx.readiness.dryRunOk ? 'oui' : 'non'}
- **Sync JIRA débloquée** : ${ctx.readiness.readyForJiraSync ? 'oui' : 'non'}
- **Message** : ${ctx.readiness.message || '—'}
- **Dernier dry-run** : ${ctx.readiness.lastDryRunAt || '—'}
- **Dernier log dry-run** : ${ctx.readiness.lastDryRunLogFile || '—'}

#### Vérifications automatiques
${checkLines}

## Chemins absolus — poste de travail (logs & config)

${pathsTableSafe(ctx.paths)}

### Fichiers de logs Wizard (\`${ctx.paths.wizardLogsRelative}\`)
${logFileLines}

### Statut fichiers clés
${kvList(Object.fromEntries(
  Object.entries(ctx.fileStatus || {}).map(([k, v]) => [
    k,
    v.exists ? `${v.path} (${v.size} octets, ${v.mtime})` : `${v.path || '—'} — absent`,
  ]),
))}

### Extraits logs (si présents)

#### hook-debug.log
\`\`\`text
${ctx.logExcerpts.hookDebugLog || '(vide ou absent)'}
\`\`\`

#### hook-last-run.txt
\`\`\`text
${ctx.logExcerpts.hookLastRun || '(vide ou absent)'}
\`\`\`

#### Dernier log dry-run Markdown
\`\`\`text
${ctx.logExcerpts.lastDryRunLog || '(vide ou absent)'}
\`\`\`
`
  }

  const body = `# ${title}

Tu es **${agentModel}** en mode **agent** sur un poste de travail **Wizard QA / Playwright + k6 + Hook JIRA/Xray Cloud (CA-TS)**.
Tu as accès au dépôt local, aux fichiers listés ci-dessous et tu peux proposer des modifications concrètes (y compris sur l'extension Wizard si pertinent).

${diagnosisBlock}

## Mémoire DEBUG projet
${memoryBlock}
${enrichmentBlock}${extensionBlock}${adapterBlock}
## Mission
Analyser l'échec ou le comportement anormal, diagnostiquer la cause racine et proposer un plan de correction **actionnable** (fichiers, commandes, validation).

## Contexte utilisateur
${String(context || 'Analyse demandée depuis le Wizard QA Assistant — Prompt DEBUG Copilot.').trim()}
${extraEnv}

## Erreur / symptôme
${String(error || diag.lastError || 'Voir les logs ci-dessous.').trim()}

## Étapes pour reproduire
${stepsBlock}
${wizardBlock}

## Sortie console / logs verbeux (${scope})
\`\`\`text
${String(mergedLog || '(vide — voir extraits logs ci-dessus)').trimEnd()}
\`\`\`

## Ce que j'attends de toi (mode agent)
1. **Lire** les fichiers aux chemins absolus indiqués (ne pas inventer de chemins).
2. **Croiser** configuration, logs scope et mémoire DEBUG projet.
3. **Identifier** la cause racine selon les hypothèses du diagnostic.
4. **Proposer** des corrections précises (fichiers, lignes, commandes).
5. **Valider** avec une nouvelle exécution et vérifier \`${verbose?.logDirRelative || '.wizard-qa/logs/debug/' + scope}\`.

## Questions guidées
${questions}

---
_Source : ${source} — ${new Date().toISOString()} — scope: ${scope}_`

  const metrics = estimatePromptTokens(body)
  return { prompt: body, ...metrics, diagnosis: diag }
}

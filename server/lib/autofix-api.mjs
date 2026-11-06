/**
 * Boucle de correction automatique des installations avec Copilot local.
 * Le serveur prépare le prompt et l'extension VS Code l'ouvre en mode agent ; Copilot écrit
 * un fichier résultat que la page lit avant de relancer l'installation.
 */
import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { REPO_ROOT } from './paths.mjs'
import { normalizeDebugScope, savePromptMarkdown } from './debug-verbose-logs.mjs'
import { getActiveSession, resolveDebugSession } from './debug-session.mjs'
import { startPageDebugFlow, regeneratePageDebugPrompt, resolvePageDebugSession } from './debug-prompt-api.mjs'
import { probeInstallEnvironment, formatInstallEnvironment } from './autofix-env.mjs'

export const AUTOFIX_MAX_ITERATIONS = 5
const AUTOFIX_REL = '.wizard-qa/autofix'

const runs = new Map()

function resultRelPath(runId, iteration) {
  return `${AUTOFIX_REL}/${runId}/result-${iteration}.json`
}

function buildProtocol({ resultRel, iteration }) {
  return `## Mode correction automatique (tentative ${iteration}/${AUTOFIX_MAX_ITERATIONS})
Tu corriges toi-même les problèmes de **chemins** (PATH, dossiers introuvables, mauvais répertoire de travail) et de **dépendances** (paquets manquants, versions en conflit, navigateurs ou binaires absents).

### Autorisé
- Lire les journaux et fichiers cités, lancer des commandes de diagnostic.
- Modifier les fichiers du projet (package.json, configuration Playwright / k6, fichiers de \`.wizard-qa/conf\`).
- Relancer la commande qui a échoué pour vérifier ta correction.

### Interdit
- Afficher, copier ou modifier un secret (token, mot de passe, \`_authToken\`).
- Désactiver la vérification TLS, contourner le proxy ou le registry d'entreprise.
- Supprimer des fichiers hors du projet ou lancer une commande globale destructrice.

### Cas où tu t'arrêtes
Si la correction exige un droit administrateur, un secret, ou une décision de l'utilisateur, ne devine pas : réponds \`needs_user\`.

### Livrable obligatoire
À la fin, écris le fichier \`${resultRel}\` avec exactement ce JSON :
\`\`\`json
{ "status": "fixed" | "needs_user", "summary": "explication en français simple, 2 phrases maximum", "changes": ["fichier ou commande modifié"] }
\`\`\`
Ne mets \`fixed\` que si la commande qui échouait a été relancée avec succès.
`
}

function buildAgentQuery({ promptRel, resultRel, iteration }) {
  return [
    `Wizard QA — correction automatique d'une installation en échec (tentative ${iteration}/${AUTOFIX_MAX_ITERATIONS}).`,
    `1. Lis entièrement le fichier \`${promptRel}\` (diagnostic, journaux, environnement).`,
    '2. Corrige les problèmes de chemins et de dépendances en respectant ses contraintes.',
    '3. Relance la commande qui a échoué pour vérifier.',
    `4. Écris le résultat dans \`${resultRel}\` (JSON status / summary / changes).`,
  ].join('\n')
}

function closeForeignSession(scope, pagePath) {
  const active = getActiveSession()
  if (active && (active.scope !== scope || active.pagePath !== pagePath)) {
    resolveDebugSession({ resolution: 'Remplacée par une correction automatique' })
  }
}

export async function beginAutofix(body = {}) {
  const scope = normalizeDebugScope(body.scope)
  const runId = String(body.runId || randomUUID().slice(0, 8))
  const run = runs.get(runId) || { scope, iteration: 0 }
  runs.set(runId, run)

  if (run.iteration >= AUTOFIX_MAX_ITERATIONS) {
    return { ok: false, exhausted: true, runId, iteration: run.iteration, max: AUTOFIX_MAX_ITERATIONS }
  }
  run.iteration += 1

  const resultRel = resultRelPath(runId, run.iteration)
  fs.mkdirSync(path.join(REPO_ROOT, AUTOFIX_REL, runId), { recursive: true })

  const pagePath = String(body.pagePath || '')
  closeForeignSession(scope, pagePath)
  const active = getActiveSession()
  const flowBody = {
    ...body,
    scope,
    pagePath,
    context: `${buildProtocol({ resultRel, iteration: run.iteration })}\n${body.context || ''}`,
    environment: { ...(body.environment || {}), 'environnement poste': `\n${formatInstallEnvironment(await probeInstallEnvironment())}` },
  }
  const flow = active && active.scope === scope
    ? regeneratePageDebugPrompt(flowBody)
    : startPageDebugFlow(flowBody)

  const promptFile = flow.promptFile
    || savePromptMarkdown(scope, flow.prompt, { sessionId: runId, iteration: run.iteration })

  return {
    ok: true,
    runId,
    iteration: run.iteration,
    max: AUTOFIX_MAX_ITERATIONS,
    promptRelativePath: promptFile.relativePath,
    resultRelativePath: resultRel,
    agentQuery: buildAgentQuery({ promptRel: promptFile.relativePath, resultRel, iteration: run.iteration }),
    prompt: flow.prompt,
  }
}

export function getAutofixResult(runId, iteration) {
  const rel = resultRelPath(String(runId).replace(/[^a-z0-9-]/gi, ''), Number(iteration) || 0)
  const abs = path.join(REPO_ROOT, rel)
  if (!fs.existsSync(abs)) return { ready: false }
  try {
    const parsed = JSON.parse(fs.readFileSync(abs, 'utf8'))
    const status = parsed.status === 'fixed' ? 'fixed' : 'needs_user'
    return {
      ready: true,
      status,
      summary: String(parsed.summary || '').slice(0, 600),
      changes: Array.isArray(parsed.changes) ? parsed.changes.slice(0, 20).map(String) : [],
    }
  } catch {
    return { ready: false }
  }
}

export function finishAutofix(body = {}) {
  runs.delete(String(body.runId || ''))
  return resolvePageDebugSession({ resolution: body.resolution || 'Installation corrigée avec Copilot' })
}

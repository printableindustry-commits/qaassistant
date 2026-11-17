/**
 * Routes du module Installation (/api/install/*).
 *
 *   GET  /api/install/plan                 plan effectif (secrets masqués) + état courant
 *   GET  /api/install/state                dernier état connu des composants (sans détection)
 *   GET  /api/install/settings             paramètres (plan) + informations sur la machine
 *   PUT  /api/install/settings             mise à jour (administrateur)
 *   POST /api/install/settings/reset       retour au plan de référence (administrateur)
 *   POST /api/install/detect               détection { stacks?, components? }
 *   POST /api/install/preview              aperçu { stacks, components?, force? }
 *   POST /api/install/runs                 lancement { stacks, components?, force?, dryRun? } → { runId }
 *   GET  /api/install/runs                 historique
 *   GET  /api/install/runs/:id             détail (journaux par composant)
 *   GET  /api/install/runs/:id/log         journal texte complet
 *   GET  /api/install/runs/:id/events      flux SSE : snapshot, step, log, done
 *   POST /api/install/runs/:id/cancel      annulation
 *   POST /api/install/runs/:id/diagnose    diagnostic IA d'un composant { componentId }
 */
import os from 'os'
import path from 'path'
import { HttpError } from '../http/router.mjs'
import { registerStatus, statusOf } from '../app-model.mjs'
import { REPO_ROOT } from '../paths.mjs'
import { getNpmrcPath } from '../npmrc.mjs'
import { loadPlan, publicPlan, savePlanSettings, resetPlan, PLAN_PATH } from './plan.mjs'
import { toolsRoot } from './system.mjs'
import {
  InstallError, currentView, detectComponents, previewRun, startRun, getRun, listRuns,
  cancelRun, subscribe, publicRun, readRunLog, getActiveRun, getState, isValidRunId,
} from './orchestrator.mjs'

/** Convertit les erreurs métier en erreurs HTTP lisibles. */
async function guard(fn) {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof HttpError) throw e
    if (e instanceof InstallError || e.status) throw new HttpError(e.status || 500, e.message)
    throw e
  }
}

function machineInfo() {
  return {
    host: os.hostname(),
    platform: `${os.type()} ${os.release()}`,
    arch: process.arch,
    serverNode: process.versions.node,
    repoRoot: REPO_ROOT,
    toolsRoot: toolsRoot(),
    npmrcPath: getNpmrcPath(),
    planPath: PLAN_PATH,
    dryForced: process.env.WIZARD_INSTALL_DRY === '1',
  }
}

function requireRun(id) {
  const run = getRun(id)
  if (!run) throw new HttpError(404, 'Installation introuvable.')
  return run
}

function bool(v) {
  return v === true || v === 'true' || v === 1 || v === '1'
}

/** Liste d'identifiants reçue du client : chaînes uniquement, sinon undefined (valeur par défaut du plan). */
function idList(v) {
  if (!Array.isArray(v)) return undefined
  return v.filter((x) => typeof x === 'string' && x.length <= 64)
}

/** Demande normalisée d'un corps detect / preview / runs. */
async function readRequest(ctx) {
  const body = await ctx.body()
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Corps de requête invalide.')
  return { body, stacks: idList(body.stacks), components: idList(body.components) }
}

/* ------------------------------------------------------------------ diagnostic IA */

const DIAG_SYSTEM = [
  'Tu es un expert de l\'outillage de test (Node.js, npm, Playwright, k6, VS Code) sur des postes d\'entreprise',
  'souvent derrière un proxy, avec un registre npm interne (Artifactory) et sans droits administrateur.',
  'À partir du journal d\'installation fourni, réponds en français, en Markdown concis :',
  '1. **Cause probable** (une ou deux phrases) ;',
  '2. **Correction** : étapes concrètes, commandes PowerShell prêtes à copier si le poste est sous Windows ;',
  '3. **Vérification** : comment confirmer que c\'est réglé, puis relancer « Installer » dans Wizard QA.',
  'Ne demande jamais de mot de passe ni de jeton ; n\'invente pas de valeurs de proxy.',
].join('\n')

function diagnosticPrompt(run, c) {
  const plan = loadPlan()
  const lines = (c.log || []).slice(-160).join('\n')
  return [
    `Composant : ${c.label} (${c.id}) — état : ${c.state}`,
    `Message : ${c.message || '—'}`,
    c.expected ? `Version attendue : ${c.expected}` : null,
    `Système : ${os.type()} ${os.release()} (${process.arch}), Node du serveur ${process.versions.node}`,
    `Proxy configuré : ${plan.proxy.http || plan.proxy.https ? 'oui' : 'non'} ; registre npm imposé : ${plan.mirrors.npmRegistry || 'non'} ;`
      + ` miroir navigateurs : ${plan.mirrors.playwrightDownloadHost || 'non'} ; strict-ssl : ${plan.proxy.strictSsl === false ? 'désactivé' : 'actif'}`,
    `Stacks : ${run.stacks.join(', ')}${run.dryRun ? ' (simulation)' : ''}`,
    '',
    'Journal du composant (dernières lignes) :',
    '```',
    lines || '(vide)',
    '```',
  ].filter((l) => l !== null).join('\n')
}

async function diagnose(run, componentId) {
  const c = run.components.find((x) => x.id === componentId)
  if (!c) throw new HttpError(404, 'Composant absent de cette installation.')
  const content = diagnosticPrompt(run, c)
  const manualPrompt = `${DIAG_SYSTEM}\n\n${content}`
  const llm = await import('../llm/index.mjs').catch(() => null)
  if (typeof llm?.complete !== 'function') {
    return { ok: true, manual: true, prompt: manualPrompt, reason: 'L\'assistant IA n\'est pas disponible : copiez ce prompt dans Copilot Chat.' }
  }
  const r = await llm.complete({
    purpose: 'diagnostic',
    system: DIAG_SYSTEM,
    messages: [{ role: 'user', content }],
    maxTokens: 1500,
  }).catch((e) => ({ ok: false, reason: `Assistant IA en erreur : ${e.message}` }))
  if (r?.ok) return { ok: true, text: r.text, provider: r.provider, model: r.model, durationMs: r.durationMs }
  return { ok: true, manual: true, prompt: r?.prompt || manualPrompt, reason: r?.reason || 'Aucun fournisseur IA disponible.' }
}

/* ------------------------------------------------------------------ statut de la page */

function installStatus() {
  if (getActiveRun()) return statusOf.info('Installation en cours…')
  const view = currentView()
  if (!view.detectedAt) return statusOf.todo('À vérifier')
  if (view.ready) return statusOf.done('Poste prêt')
  const n = view.components.filter((c) => c.required && c.state !== 'ok').length
  return statusOf.todo(`${n} composant${n > 1 ? 's' : ''} requis à installer`)
}

/* ------------------------------------------------------------------ routes */

export function register(router) {
  registerStatus('install', installStatus)

  router.get('/api/install/plan', () => guard(() => ({
    ok: true,
    plan: publicPlan(),
    state: currentView(),
    activeRunId: getActiveRun()?.id || null,
  })))

  router.get('/api/install/state', (ctx) => guard(() => {
    const stacks = ctx.query.stacks ? ctx.query.stacks.split(',').map((s) => s.trim()).filter(Boolean) : undefined
    return { ok: true, ...currentView(stacks), lastRun: getState().lastRun, activeRunId: getActiveRun()?.id || null }
  }))

  router.get('/api/install/settings', (ctx) => guard(() => ({
    ok: true,
    plan: publicPlan(),
    machine: machineInfo(),
    canEdit: ctx.user?.role === 'admin',
  })))

  router.put('/api/install/settings', async (ctx) => guard(async () => {
    if (getActiveRun()) throw new HttpError(409, 'Une installation est en cours : réessayez à la fin.')
    const plan = savePlanSettings(await ctx.body())
    return { ok: true, plan: publicPlan(plan) }
  }), { role: 'admin' })

  router.post('/api/install/settings/reset', () => guard(() => {
    if (getActiveRun()) throw new HttpError(409, 'Une installation est en cours : réessayez à la fin.')
    return { ok: true, plan: publicPlan(resetPlan()) }
  }), { role: 'admin' })

  router.post('/api/install/detect', async (ctx) => guard(async () => {
    const { stacks, components } = await readRequest(ctx)
    return { ok: true, ...(await detectComponents({ stacks, components })) }
  }))

  router.post('/api/install/preview', async (ctx) => guard(async () => {
    const { body, stacks, components } = await readRequest(ctx)
    return { ok: true, ...previewRun({ stacks, components, force: bool(body.force) }) }
  }))

  router.post('/api/install/runs', async (ctx) => guard(async () => {
    const { body, stacks, components } = await readRequest(ctx)
    const dryRun = bool(body.dryRun) || process.env.WIZARD_INSTALL_DRY === '1'
    if (!dryRun && ctx.user?.role !== 'admin') {
      throw new HttpError(403, 'Seul un administrateur peut installer des logiciels sur cette machine (la simulation reste possible).')
    }
    const run = startRun({ stacks, components, force: bool(body.force), dryRun, user: ctx.user })
    return { ok: true, runId: run.id, dryRun: run.dryRun, components: run.components.map((c) => c.id) }
  }))

  router.get('/api/install/runs', (ctx) => guard(() => {
    const limit = Math.min(Number(ctx.query.limit) || 50, 200)
    return { ok: true, runs: listRuns(limit), activeRunId: getActiveRun()?.id || null }
  }))

  router.get('/api/install/runs/:id', (ctx) => guard(() => ({ ok: true, run: publicRun(requireRun(ctx.params.id)) })))

  router.get('/api/install/runs/:id/log', (ctx) => guard(() => {
    if (!isValidRunId(ctx.params.id)) throw new HttpError(404, 'Installation introuvable.')
    requireRun(ctx.params.id)
    ctx.text(200, readRunLog(ctx.params.id) || '(journal vide)\n', 'text/plain; charset=utf-8', {
      'Content-Disposition': `attachment; filename="installation-${path.basename(ctx.params.id)}.log"`,
    })
  }))

  router.get('/api/install/runs/:id/events', (ctx) => guard(() => {
    requireRun(ctx.params.id)
    const stream = ctx.sse()
    subscribe(ctx.params.id, stream)
  }))

  router.post('/api/install/runs/:id/cancel', (ctx) => guard(() => {
    const current = getActiveRun()
    // Une installation réelle ne peut être arrêtée que par un administrateur ou par celui qui l'a lancée.
    if (current?.id === ctx.params.id && !current.dryRun && ctx.user?.role !== 'admin' && current.user !== ctx.user?.username) {
      throw new HttpError(403, 'Seul un administrateur (ou l\'auteur du lancement) peut arrêter une installation réelle.')
    }
    const run = cancelRun(ctx.params.id)
    return { ok: true, runId: run.id, status: 'cancelling' }
  }))

  router.post('/api/install/runs/:id/diagnose', async (ctx) => guard(async () => {
    const run = requireRun(ctx.params.id)
    const body = await ctx.body()
    if (!body || typeof body.componentId !== 'string' || !body.componentId) throw new HttpError(400, 'componentId manquant.')
    return diagnose(run, String(body.componentId))
  }))
}

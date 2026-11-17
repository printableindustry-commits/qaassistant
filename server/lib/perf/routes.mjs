/**
 * Routes du module performance (k6).
 *   GET  /api/perf/k6                         état du binaire k6 (?refresh=1 pour relancer la détection)
 *   GET  /api/perf/profiles                   profils exécutables, scripts du projet, état de k6, réglages
 *   GET  /api/perf/profiles/:id/script        script k6 du profil (fichier existant ou aperçu)
 *   PUT  /api/perf/profiles/:id/baseline      { runId | null } → run de référence du profil
 *   POST /api/perf/runs                       { profileId | scriptPath, overrides, simulate? } → { runId }
 *   GET  /api/perf/runs                       historique unifié (?profileId=&status=&limit=)
 *   GET  /api/perf/runs/:id                   détail (métriques, seuils, série, console, écart à la référence)
 *   GET  /api/perf/runs/:id/events            flux SSE : snapshot, tick, log, done
 *   POST /api/perf/runs/:id/stop              arrêt d'un run
 *   DELETE /api/perf/runs/:id                 suppression d'un run terminé (fichiers de rapport)
 *   GET  /api/perf/compare?a=&b=&threshold=   comparaison de deux runs
 *   GET  /api/perf/settings, PUT /api/perf/settings { regressionPct }
 *   GET  /api/perf/requirements               exigences de performance détectées dans les récits
 *   POST /api/perf/requirements/:key/profile  crée le profil proposé pour un récit
 */
import fs from 'fs'
import path from 'path'
import { HttpError } from '../http/router.mjs'
import { registerStatus, statusOf } from '../app-model.mjs'
import { REPO_ROOT } from '../paths.mjs'
import { buildScriptFromAnswers } from '../k6-perf-generator.mjs'
import { deleteK6Run } from '../k6-run-history.mjs'
import { detectK6, k6StateSync } from './k6-binary.mjs'
import { listRunnableProfiles, listScripts, getRunnableProfile } from './profiles.mjs'
import { startRun, stopRun, subscribe, isActive, runningCount, STATUS_LABELS } from './run-manager.mjs'
import { listRuns, getRunDetail, compareRuns, findAny } from './history.mjs'
import { listRequirements, createProfileFromStory } from './requirements.mjs'
import { getSettings, saveSettings, getMeta, deleteRunFiles, isValidRunId } from './store.mjs'
import { getPerfSummary } from './index.mjs'

function perfStatus() {
  const { lastRun, running } = getPerfSummary()
  if (running) return statusOf.info(`${running} run${running > 1 ? 's' : ''} en cours`)
  if (!lastRun) {
    const k6 = k6StateSync()
    return statusOf.info(k6 && !k6.installed ? 'Simulation disponible' : 'Aucun run')
  }
  const p95 = lastRun.p95 != null ? ` · p95 ${Math.round(lastRun.p95)} ms` : ''
  const sim = lastRun.simulated ? ' (simulé)' : ''
  if (lastRun.status === 'passed') return statusOf.done(`Dernier run réussi${sim}${p95}`)
  if (lastRun.status === 'stopped') return statusOf.info(`Dernier run arrêté${sim}`)
  return statusOf.todo(`Dernier run : ${STATUS_LABELS[lastRun.detailedStatus] || 'échec'}${sim}`)
}

function requireRun(id) {
  if (!isValidRunId(id) && !/^[\w-]{8,64}$/.test(id)) throw new HttpError(400, 'Identifiant de run invalide.')
}

export function register(router) {
  registerStatus('perf', perfStatus)
  detectK6().catch(() => {})

  router.get('/api/perf/k6', async (ctx) => ({ ok: true, k6: await detectK6({ force: ctx.query.refresh === '1' }) }))

  router.get('/api/perf/profiles', async () => ({
    ok: true,
    profiles: listRunnableProfiles(),
    scripts: listScripts(),
    k6: await detectK6(),
    settings: getSettings(),
    running: runningCount(),
  }))

  router.get('/api/perf/profiles/:id/script', (ctx) => {
    const profile = getRunnableProfile(ctx.params.id)
    if (!profile) throw new HttpError(404, 'Profil introuvable.')
    const card = listRunnableProfiles().find((p) => p.id === profile.id)
    const abs = path.join(REPO_ROOT, card.scriptPath)
    const exists = fs.existsSync(abs)
    const content = exists ? fs.readFileSync(abs, 'utf8') : buildScriptFromAnswers(profile.answers || {}, { profileName: profile.name })
    return { ok: true, scriptPath: card.scriptPath, exists, content }
  })

  router.put('/api/perf/profiles/:id/baseline', async (ctx) => {
    const { runId = null } = await ctx.body()
    const profile = getRunnableProfile(ctx.params.id)
    if (!profile) throw new HttpError(404, 'Profil introuvable.')
    const settings = getSettings()
    if (runId) {
      const run = findAny(String(runId))
      if (!run) throw new HttpError(404, 'Run introuvable.')
      if (run.profileId !== profile.id) throw new HttpError(400, 'Ce run n’appartient pas à ce profil.')
      if (!run.metrics) throw new HttpError(400, 'Ce run n’a pas de métriques mesurées : il ne peut pas servir de référence.')
      if (run.status === 'running') throw new HttpError(409, 'Attendez la fin du run avant d’en faire la référence.')
      settings.baselines[profile.id] = run.id
    } else {
      delete settings.baselines[profile.id]
    }
    saveSettings({ baselines: settings.baselines })
    return { ok: true, profileId: profile.id, baselineRunId: settings.baselines[profile.id] || null }
  })

  router.post('/api/perf/runs', async (ctx) => {
    const body = await ctx.body()
    const run = await startRun({
      profileId: body.profileId ? String(body.profileId) : undefined,
      scriptPath: body.scriptPath ? String(body.scriptPath) : undefined,
      overrides: body.overrides || {},
      simulate: body.simulate === true ? true : body.simulate === false ? false : undefined,
      user: ctx.user,
    })
    return { ok: true, runId: run.id, run }
  })

  router.get('/api/perf/runs', (ctx) => {
    const limit = Math.min(Math.max(Number(ctx.query.limit) || 200, 1), 500)
    const runs = listRuns({ profileId: ctx.query.profileId || null, status: ctx.query.status || null, limit })
    return { ok: true, runs, total: runs.length, running: runningCount() }
  })

  router.get('/api/perf/runs/:id', (ctx) => {
    requireRun(ctx.params.id)
    const detail = getRunDetail(ctx.params.id)
    if (!detail) throw new HttpError(404, 'Run introuvable.')
    return { ok: true, ...detail }
  })

  router.get('/api/perf/runs/:id/events', (ctx) => {
    requireRun(ctx.params.id)
    const id = ctx.params.id
    if (!isActive(id) && !getMeta(id)) throw new HttpError(404, 'Run introuvable.')
    const stream = ctx.sse()
    if (subscribe(id, stream)) return undefined
    const detail = getRunDetail(id)
    stream.send('snapshot', detail)
    stream.send('done', { run: detail.run })
    stream.close()
    return undefined
  })

  router.post('/api/perf/runs/:id/stop', (ctx) => {
    requireRun(ctx.params.id)
    return { ok: true, run: stopRun(ctx.params.id) }
  })

  router.delete('/api/perf/runs/:id', (ctx) => {
    const id = ctx.params.id
    if (!isValidRunId(id)) throw new HttpError(400, 'Seuls les runs de l’écran Performance peuvent être supprimés ici.')
    if (isActive(id)) throw new HttpError(409, 'Arrêtez le run avant de le supprimer.')
    if (!getMeta(id)) throw new HttpError(404, 'Run introuvable.')
    const settings = getSettings()
    for (const [pid, rid] of Object.entries(settings.baselines)) if (rid === id) delete settings.baselines[pid]
    saveSettings({ baselines: settings.baselines })
    deleteRunFiles(id)
    // Copie consignée dans l'historique V2 : sans cela, le run réapparaîtrait comme run « V2 ».
    try { deleteK6Run(id) } catch { /* historique V2 secondaire */ }
    return { ok: true, id }
  })

  router.get('/api/perf/compare', (ctx) => {
    const { a, b } = ctx.query
    if (!a || !b) throw new HttpError(400, 'Choisissez deux runs à comparer (paramètres a et b).')
    if (a === b) throw new HttpError(400, 'Choisissez deux runs différents.')
    const result = compareRuns(a, b, Number(ctx.query.threshold))
    if (!result) throw new HttpError(404, 'Run introuvable : rechargez l’historique.')
    return { ok: true, ...result }
  })

  router.get('/api/perf/settings', () => ({ ok: true, settings: getSettings() }))

  router.put('/api/perf/settings', async (ctx) => {
    const body = await ctx.body()
    const pct = Number(body.regressionPct)
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) throw new HttpError(400, 'Le seuil de régression doit être compris entre 1 et 100 %.')
    return { ok: true, settings: saveSettings({ regressionPct: Math.round(pct * 10) / 10 }) }
  })

  router.get('/api/perf/requirements', async (ctx) => ({ ok: true, ...(await listRequirements({ demo: ctx.query.demo === '1' })) }))

  router.post('/api/perf/requirements/:key/profile', async (ctx) => {
    const key = ctx.params.key
    if (!/^[A-Z][A-Z0-9_]*-\d+$/i.test(key)) throw new HttpError(400, 'Clé de récit invalide.')
    return { ok: true, ...(await createProfileFromStory(key, await ctx.body())) }
  })
}

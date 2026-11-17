/**
 * Routes du module Gherkin (récits → scénarios de test).
 *   GET  /api/gherkin                         index + compteurs de couverture
 *   GET  /api/gherkin/batch                   génération par lot en cours (pour reprendre le suivi)
 *   POST /api/gherkin/batch                   { keys?, mode, provider?, overwrite?, includeAll? } → { jobId }
 *                                             sans keys : récits sans scénario décidés « À automatiser »
 *                                             (includeAll : tous les récits sans scénario, hors « Ignorés »)
 *   GET  /api/gherkin/batch/:jobId/events     progression (SSE : start, item, done, error)
 *   POST /api/gherkin/batch/:jobId/cancel     arrêter le lot après le récit en cours
 *   POST /api/gherkin/lint                    { text, key? } → analyse syntaxique et qualité
 *   POST /api/gherkin/export                  { keys?, includeDrafts? } → fichiers .feature écrits
 *   GET  /api/gherkin/:key                    récit, scénarios enregistrés, analyse, historique
 *   PUT  /api/gherkin/:key                    { featureText } → brouillon enregistré
 *   GET  /api/gherkin/:key/prompt             prompt complet à copier (mode manuel)
 *   POST /api/gherkin/:key/generate           { mode: 'auto'|'llm'|'template', provider? }
 *   POST /api/gherkin/:key/manual-answer      { text } → réponse collée, analysée et enregistrée
 *   POST /api/gherkin/:key/validate           brouillon → validé (refusé s'il reste des erreurs)
 *   POST /api/gherkin/:key/restore            { index } → restaure une version précédente
 */
import { HttpError } from '../http/router.mjs'
import { registerStatus, statusOf } from '../app-model.mjs'
import { listStories, getStory, getScanInfo } from '../jira/stories.mjs'
import { PROVIDER_IDS, getLlmStatus } from '../llm/index.mjs'
import { analyzeGherkin } from './parse.mjs'
import { extractFeature, manualPrompt } from './prompt.mjs'
import {
  getGherkinIndex, readEntry, saveFeature, validateFeature, restoreVersion,
  exportFeatures, exportPathFor, isExported, normalizeKey, FEATURES_DIR,
} from './store.mjs'
import { generateForStory, llmAvailable, withGenerationLock, MODES } from './service.mjs'
import { startBatch, getBatch, runningBatch, cancelBatch, defaultBatchKeys } from './batch.mjs'
import { REPO_ROOT } from '../paths.mjs'
import path from 'path'

const MAX_BATCH = 500

async function objectBody(ctx) {
  const body = await ctx.body()
  if (body == null || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Corps de requête invalide : un objet JSON est attendu.')
  return body
}

function keyParam(ctx) {
  const key = normalizeKey(ctx.params.key)
  if (!key) throw new HttpError(400, `Clé de récit invalide : « ${ctx.params.key} ».`)
  return key
}

function requireStory(key) {
  const story = getStory(key)
  if (!story) throw new HttpError(404, `Récit ${key} introuvable : relancez le scan des récits si besoin.`)
  return story
}

function textField(body, name) {
  const v = body[name]
  if (typeof v !== 'string') throw new HttpError(400, `Champ « ${name} » attendu (texte).`)
  return v
}

function checkProvider(provider) {
  if (provider == null || provider === '') return undefined
  if (!PROVIDER_IDS.includes(provider)) throw new HttpError(400, `Fournisseur d'IA inconnu : « ${provider} ».`)
  return provider
}

const relPath = (abs) => path.relative(REPO_ROOT, abs).replace(/\\/g, '/')

/** Entrée publique : texte, statut, historique (sans texte complet des anciennes versions superflues). */
function entryPayload(entry) {
  if (!entry) return null
  return {
    key: entry.key,
    text: entry.text,
    status: entry.status,
    generatedBy: entry.generatedBy,
    provider: entry.provider || '',
    model: entry.model || '',
    edited: Boolean(entry.edited),
    warnings: entry.warnings || [],
    scenarios: entry.scenarios,
    cases: entry.cases,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    updatedBy: entry.updatedBy,
    generatedAt: entry.generatedAt,
    validatedAt: entry.validatedAt,
    validatedBy: entry.validatedBy,
    exportedAt: entry.exportedAt,
    exportedPath: entry.exportedPath,
    exported: isExported(entry),
    versions: (entry.versions || []).map((v, index) => ({ index, ...v })),
  }
}

function coverage(stories, index) {
  const total = stories.length
  const of = (pred) => stories.filter((s) => pred(index[s.key])).length
  return {
    total,
    covered: of(Boolean),
    withoutScenario: of((e) => !e),
    drafts: of((e) => e?.status === 'draft'),
    validated: of((e) => e?.status === 'validated'),
    exported: of((e) => e?.exported),
    withErrors: of((e) => e && e.errors > 0),
    withoutCriteria: stories.filter((s) => !s.acceptanceCriteria?.length).length,
  }
}

function storiesStatus() {
  const stories = listStories()
  if (!stories.length) return statusOf.todo('Scan des récits à lancer')
  const c = coverage(stories, getGherkinIndex())
  if (c.validated === c.total) return statusOf.done(`${c.total}/${c.total} récits validés`)
  if (c.covered === c.total) return statusOf.info(`${c.covered}/${c.total} récits couverts, ${c.validated} validé${c.validated > 1 ? 's' : ''}`)
  return statusOf.todo(`${c.covered}/${c.total} récits couverts`)
}

function llmSummary() {
  try {
    const s = getLlmStatus()
    return { active: s.active, available: Boolean(s.active) }
  } catch {
    return { active: null, available: false }
  }
}

export function register(router) {
  registerStatus('stories', storiesStatus)

  router.get('/api/gherkin', () => {
    const stories = listStories()
    const index = getGherkinIndex()
    return {
      ok: true,
      index,
      summary: coverage(stories, index),
      scan: getScanInfo(),
      llm: llmSummary(),
      featuresDir: relPath(FEATURES_DIR),
      batch: runningBatch() ? { jobId: runningBatch().id, total: runningBatch().keys.length } : null,
    }
  })

  // ------------------------------------------------------------ lot

  router.get('/api/gherkin/batch', () => {
    const job = runningBatch()
    return { ok: true, running: job ? { jobId: job.id, total: job.keys.length, mode: job.mode, startedAt: job.startedAt } : null }
  })

  router.post('/api/gherkin/batch', async (ctx) => {
    const body = await objectBody(ctx)
    const mode = MODES.includes(body.mode) ? body.mode : 'auto'
    const provider = checkProvider(body.provider)
    if (mode === 'llm' && !provider && !llmAvailable()) {
      throw new HttpError(400, 'Aucun assistant IA disponible pour une génération par lot.', { hint: 'Configurez un fournisseur dans « Assistant IA », ou choisissez le modèle intégré.' })
    }
    let keys
    if (Array.isArray(body.keys)) {
      keys = body.keys.map(normalizeKey).filter(Boolean)
    } else {
      // Par défaut, seuls les récits triés « À automatiser » (page Récits) entrent dans le lot.
      const d = defaultBatchKeys({ includeAll: Boolean(body.includeAll) })
      keys = d.keys
      if (!keys.length && d.total) {
        throw new HttpError(400, `Aucun récit « À automatiser » sans scénario (${d.total} récit(s) sans scénario non triés ou écartés).`,
          { hint: 'Triez les récits sur la page Récits (onglet « À trier »), ou relancez avec « Inclure tous les récits ».', total: d.total })
      }
    }
    keys = [...new Set(keys)]
    if (!keys.length) throw new HttpError(400, 'Aucun récit à traiter : tous les récits ont déjà des scénarios.')
    if (keys.length > MAX_BATCH) throw new HttpError(400, `Lot trop important (${MAX_BATCH} récits au plus).`)
    const current = runningBatch()
    if (current) return { ok: true, jobId: current.id, alreadyRunning: true, total: current.keys.length }
    const job = startBatch({ keys, mode, provider, overwrite: Boolean(body.overwrite), user: ctx.user?.username })
    return { ok: true, jobId: job.id, total: keys.length }
  })

  router.get('/api/gherkin/batch/:jobId/events', (ctx) => {
    const job = getBatch(ctx.params.jobId)
    if (!job) throw new HttpError(404, 'Génération par lot introuvable (le serveur a peut-être redémarré).')
    const stream = ctx.sse()
    const unsubscribe = job.subscribe(({ event, data }) => {
      stream.send(event, data)
      if (event === 'done' || event === 'error') setTimeout(() => stream.close(), 50)
    })
    ctx.res.on('close', unsubscribe)
  })

  router.post('/api/gherkin/batch/:jobId/cancel', (ctx) => {
    if (!cancelBatch(ctx.params.jobId)) throw new HttpError(404, 'Aucune génération par lot en cours avec cet identifiant.')
    return { ok: true }
  })

  // ------------------------------------------------------------ analyse et export

  router.post('/api/gherkin/lint', async (ctx) => {
    const body = await objectBody(ctx)
    const text = textField(body, 'text')
    if (text.length > 400 * 1024) throw new HttpError(413, 'Texte trop volumineux (400 Ko au plus).')
    const key = normalizeKey(body.key)
    return { ok: true, ...analyzeGherkin(text, { storyKey: key || undefined }) }
  })

  router.post('/api/gherkin/export', async (ctx) => {
    const body = await objectBody(ctx)
    if (body.keys != null && !Array.isArray(body.keys)) throw new HttpError(400, '« keys » doit être une liste de clés de récits.')
    const result = exportFeatures({ keys: body.keys, includeDrafts: Boolean(body.includeDrafts) })
    if (!result.written.length && !result.skipped.length) throw new HttpError(400, 'Aucun scénario à exporter : générez puis validez des scénarios d\'abord.')
    return { ok: true, ...result }
  })

  // ------------------------------------------------------------ un récit

  router.get('/api/gherkin/:key', (ctx) => {
    const key = keyParam(ctx)
    const story = getStory(key)
    const entry = readEntry(key)
    if (!story && !entry) throw new HttpError(404, `Récit ${key} introuvable : relancez le scan des récits si besoin.`)
    return {
      ok: true,
      key,
      story,
      entry: entryPayload(entry),
      analysis: entry ? analyzeGherkin(entry.text, { storyKey: key }) : null,
      exportPath: relPath(exportPathFor(key, story)),
    }
  })

  router.put('/api/gherkin/:key', async (ctx) => {
    const key = keyParam(ctx)
    const body = await objectBody(ctx)
    const text = textField(body, 'featureText')
    if (!text.trim()) throw new HttpError(400, 'Le texte Gherkin est vide.')
    if (!getStory(key) && !readEntry(key)) requireStory(key)
    try {
      const { entry, analysis, unchanged } = saveFeature(key, text, { generatedBy: 'edit', user: ctx.user?.username })
      return { ok: true, entry: entryPayload(entry), analysis, unchanged: Boolean(unchanged) }
    } catch (e) {
      throw new HttpError(400, e.message)
    }
  })

  router.get('/api/gherkin/:key/prompt', async (ctx) => {
    const story = requireStory(keyParam(ctx))
    return { ok: true, prompt: await manualPrompt(story) }
  })

  router.post('/api/gherkin/:key/generate', async (ctx) => {
    const key = keyParam(ctx)
    const body = await objectBody(ctx)
    const mode = MODES.includes(body.mode) ? body.mode : 'auto'
    const provider = checkProvider(body.provider)
    const story = requireStory(key)
    const abort = new AbortController()
    ctx.res.on('close', () => { if (!ctx.res.writableEnded) abort.abort() })
    const r = await withGenerationLock(key, () => generateForStory(story, { mode, provider, user: ctx.user?.username, signal: abort.signal }))
    if (!r) throw new HttpError(409, `Une génération est déjà en cours pour ${key} (page ou génération par lot) : patientez quelques instants.`)
    if (r.manual) return { ok: true, manual: true, prompt: r.prompt, reason: r.reason }
    if (!r.ok) throw new HttpError(502, r.error, { hint: 'Vérifiez le fournisseur dans « Assistant IA », ou utilisez le modèle intégré.' })
    return {
      ok: true,
      manual: false,
      entry: entryPayload(r.entry),
      analysis: r.analysis,
      usedMode: r.usedMode,
      provider: r.provider,
      model: r.model,
      retried: r.retried,
      notice: r.notice,
      warnings: r.warnings || [],
      manualPrompt: r.manualPrompt || null,
    }
  })

  router.post('/api/gherkin/:key/manual-answer', async (ctx) => {
    const key = keyParam(ctx)
    const body = await objectBody(ctx)
    requireStory(key)
    const extracted = extractFeature(textField(body, 'text'))
    if (!extracted.ok) throw new HttpError(400, `Réponse inexploitable : ${extracted.reason}`, { hint: 'Collez la réponse complète de l\'assistant, marqueurs compris.' })
    try {
      const { entry, analysis } = saveFeature(key, extracted.text, { generatedBy: 'manual', provider: 'manual', user: ctx.user?.username })
      return { ok: true, entry: entryPayload(entry), analysis }
    } catch (e) {
      throw new HttpError(400, e.message)
    }
  })

  router.post('/api/gherkin/:key/validate', (ctx) => {
    const key = keyParam(ctx)
    const r = validateFeature(key, ctx.user?.username)
    if (r.notFound) throw new HttpError(404, `Aucun scénario enregistré pour ${key} : générez-les d'abord.`)
    if (!r.ok) {
      const n = r.analysis.counts.error
      throw new HttpError(422, `Validation impossible : ${n} erreur${n > 1 ? 's' : ''} à corriger.`, { analysis: r.analysis })
    }
    return { ok: true, entry: entryPayload(r.entry), analysis: r.analysis }
  })

  router.post('/api/gherkin/:key/restore', async (ctx) => {
    const key = keyParam(ctx)
    const body = await objectBody(ctx)
    const index = Number(body.index)
    if (!Number.isInteger(index) || index < 0) throw new HttpError(400, 'Numéro de version invalide.')
    const r = restoreVersion(key, index, ctx.user?.username)
    if (!r) throw new HttpError(404, 'Version introuvable.')
    return { ok: true, entry: entryPayload(r.entry), analysis: r.analysis }
  })
}

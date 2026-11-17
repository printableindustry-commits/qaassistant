/**
 * Routes du module Livrables ISTQB (contrat V3.2 §6.5), toutes authentifiées.
 *   GET    /api/livrables                      documents (statut, à actualiser, manquants, relecture) + KPI + résumé des faits
 *   GET    /api/livrables/facts                faits collectés
 *   GET    /api/livrables/docs/:id             { ok, doc, markdown, html, sources }
 *   POST   /api/livrables/docs/:id/generate    nouvelle version générée à partir des faits et du profil
 *   POST   /api/livrables/generate-all         génère les 11 documents
 *   PUT    /api/livrables/docs/:id             { markdown } → version « modifiée »
 *   POST   /api/livrables/docs/:id/review      relecture par l'agent ({ ai: false } : règles seules)
 *   POST   /api/livrables/docs/:id/approve     approbation de la dernière version
 *   GET    /api/livrables/docs/:id/versions    historique des versions
 *   GET    /api/livrables/docs/:id/export?format=md|html|docx
 *   GET    /api/livrables/export.zip           pack de tous les documents (docx + md + html)
 *   GET    /api/livrables/templates/:id        modèle courant et modèle de référence
 *   PUT    /api/livrables/templates/:id        { markdown } surcharge (administrateur)
 *   DELETE /api/livrables/templates/:id        retour au modèle de référence (administrateur)
 *   GET    /api/livrables/word-model           modèle Word de l'entreprise { ok, model: { name, savedAt, size, summary } | null }
 *   PUT    /api/livrables/word-model           dépôt (administrateur) : corps binaire application/octet-stream,
 *                                              nom d'origine dans l'en-tête X-File-Name (encodé URI) ou ?name= ;
 *                                              ou JSON { name, dataBase64 } ; 30 Mo au plus
 *   DELETE /api/livrables/word-model           retrait (administrateur) : retour à l'export Word standard
 *   GET|PUT /api/livrables/profile, POST /api/livrables/profile/demo   → profile.mjs
 *   GET|POST /api/livrables/campaigns, GET /api/livrables/campaigns/:id  → campaigns.mjs
 */
import { HttpError } from '../http/router.mjs'
import { checkTemplate } from './template.mjs'
import { catalogEntry, loadTemplate, saveTemplateOverride, deleteTemplateOverride } from './store.mjs'
import { getModel, saveModel, deleteModel, MAX_MODEL_BYTES } from './word-model.mjs'
import {
  listDocuments, getDocument, generateDocument, generateAll, editDocument, reviewDocumentById, approveDocument,
  listVersions, exportDocument, exportPack, getFacts, invalidateFacts,
} from './service.mjs'

async function objectBody(ctx) {
  const body = await ctx.body()
  if (body == null || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Corps de requête invalide : un objet JSON est attendu.')
  return body
}

/** Corps brut de la requête (Buffer), limité en taille. */
function rawBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > limit) {
        reject(new HttpError(413, `Fichier trop volumineux (${Math.round(MAX_MODEL_BYTES / 1048576)} Mo au plus).`))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/** Modèle Word déposé : binaire (application/octet-stream) ou JSON { name, dataBase64 }. */
async function uploadedModel(ctx) {
  const type = String(ctx.req.headers['content-type'] || '').toLowerCase()
  if (type.includes('application/json')) {
    const raw = await rawBody(ctx.req, Math.ceil(MAX_MODEL_BYTES * 1.4) + 4096)
    let body
    try {
      body = JSON.parse(raw.toString('utf8'))
    } catch {
      throw new HttpError(400, 'JSON invalide')
    }
    if (typeof body?.dataBase64 !== 'string' || !body.dataBase64) throw new HttpError(400, 'dataBase64 attendu (contenu du .docx en base64).')
    return { buffer: Buffer.from(body.dataBase64, 'base64'), name: String(body.name || '') }
  }
  let name = String(ctx.query.name || '')
  const header = ctx.req.headers['x-file-name']
  if (header) {
    try { name = decodeURIComponent(String(header)) } catch { name = String(header) }
  }
  return { buffer: await rawBody(ctx.req, MAX_MODEL_BYTES), name }
}

function knownId(ctx) {
  const id = ctx.params.id
  if (!catalogEntry(id)) throw new HttpError(404, `Document inconnu : ${id}`)
  return id
}

function attachment(ctx, { filename, type, body }) {
  const ascii = filename.replace(/[^\w.-]+/g, '_')
  ctx.text(200, body, type, {
    'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  })
}

/** Modules de l'autre piste (profil, campagnes), chargés à la demande. */
async function lib(name) {
  try {
    return await import(`./${name}.mjs`)
  } catch (e) {
    throw new HttpError(503, `Module ${name} indisponible : ${e.message}`)
  }
}

/** Profil + questionnaire + préremplissage depuis les faits, tel qu'attendu par l'assistant. */
async function profilePayload(m) {
  const p = m.getProfile()
  let prefill = {}
  try { prefill = m.prefillFromFacts(await getFacts()) } catch { /* faits indisponibles */ }
  return { ok: true, profile: p, values: p.values, questionnaire: m.getQuestionnaire(), prefill, completion: m.completion(p.values) }
}

export function register(router) {
  router.get('/api/livrables', () => listDocuments())

  router.get('/api/livrables/facts', async () => ({ ok: true, facts: await getFacts({ fresh: true }) }))

  router.get('/api/livrables/docs/:id', (ctx) => getDocument(knownId(ctx), ctx.user))

  router.post('/api/livrables/docs/:id/generate', (ctx) => generateDocument(knownId(ctx), ctx.user))

  router.post('/api/livrables/generate-all', (ctx) => generateAll(ctx.user))

  router.put('/api/livrables/docs/:id', async (ctx) => {
    const id = knownId(ctx)
    const body = await objectBody(ctx)
    return editDocument(id, body.markdown, ctx.user)
  })

  router.post('/api/livrables/docs/:id/review', async (ctx) => {
    const id = knownId(ctx)
    const body = await objectBody(ctx)
    return reviewDocumentById(id, ctx.user, { useAi: body.ai !== false })
  })

  router.post('/api/livrables/docs/:id/approve', (ctx) => approveDocument(knownId(ctx), ctx.user))

  router.get('/api/livrables/docs/:id/versions', (ctx) => listVersions(knownId(ctx)))

  router.get('/api/livrables/docs/:id/export', async (ctx) => {
    const id = knownId(ctx)
    attachment(ctx, await exportDocument(id, String(ctx.query.format || 'docx'), ctx.user))
  })

  router.get('/api/livrables/export.zip', async (ctx) => {
    const pack = await exportPack(ctx.user)
    attachment(ctx, { ...pack, type: 'application/zip' })
  })

  // --- modèles ---
  router.get('/api/livrables/templates/:id', (ctx) => {
    const t = loadTemplate(knownId(ctx))
    return { ok: true, id: t.id, markdown: t.source, reference: t.reference, overridden: t.overridden, hash: t.hash, canEdit: ctx.user?.role === 'admin' }
  })

  router.put('/api/livrables/templates/:id', async (ctx) => {
    const id = knownId(ctx)
    const { markdown } = await objectBody(ctx)
    if (typeof markdown !== 'string' || !markdown.trim()) throw new HttpError(400, 'Modèle Markdown attendu.')
    if (markdown.length > 300_000) throw new HttpError(413, 'Modèle trop volumineux.')
    const check = checkTemplate(markdown)
    if (!check.ok) throw new HttpError(400, `Modèle invalide : ${check.error}`)
    saveTemplateOverride(id, markdown)
    const t = loadTemplate(id)
    return { ok: true, id, overridden: true, hash: t.hash }
  }, { role: 'admin' })

  router.delete('/api/livrables/templates/:id', (ctx) => {
    const id = knownId(ctx)
    const removed = deleteTemplateOverride(id)
    return { ok: true, id, removed, overridden: false, hash: loadTemplate(id).hash }
  }, { role: 'admin' })

  // --- modèle Word de l'entreprise (word-model.mjs) ---
  const modelPayload = (ctx, model) => ({
    ok: true,
    model: model ? { name: model.name, savedAt: model.savedAt, savedBy: model.savedBy, size: model.size, summary: model.summary, error: model.error || null } : null,
    canEdit: ctx.user?.role === 'admin',
  })

  router.get('/api/livrables/word-model', (ctx) => modelPayload(ctx, getModel()))

  router.put('/api/livrables/word-model', async (ctx) => {
    const { buffer, name } = await uploadedModel(ctx)
    const model = saveModel(buffer, name, ctx.user?.username || '')
    return modelPayload(ctx, model)
  }, { role: 'admin' })

  router.delete('/api/livrables/word-model', (ctx) => {
    const removed = deleteModel()
    return { ...modelPayload(ctx, null), removed }
  }, { role: 'admin' })

  // --- informations projet (profile.mjs) ---
  router.get('/api/livrables/profile', async () => {
    const m = await lib('profile')
    return profilePayload(m)
  })

  router.put('/api/livrables/profile', async (ctx) => {
    const m = await lib('profile')
    const body = await objectBody(ctx)
    m.saveProfile(body.values, ctx.user?.username || '')
    invalidateFacts()
    return profilePayload(m)
  })

  router.post('/api/livrables/profile/demo', async (ctx) => {
    const m = await lib('profile')
    m.applyDemoProfile(ctx.user?.username || '')
    invalidateFacts()
    return profilePayload(m)
  })

  // --- campagnes d'exécution (campaigns.mjs) ---
  router.get('/api/livrables/campaigns', async () => {
    const m = await lib('campaigns')
    return { ok: true, campaigns: m.listCampaigns(), running: m.runningCampaign() }
  })

  router.post('/api/livrables/campaigns', async (ctx) => {
    const m = await lib('campaigns')
    const body = await objectBody(ctx)
    const campaign = m.startCampaign({
      simulate: body.simulate === true,
      user: ctx.user?.username || '',
      baseUrl: typeof body.baseUrl === 'string' ? body.baseUrl : '',
      browser: typeof body.browser === 'string' ? body.browser : '',
    })
    invalidateFacts()
    return { ok: true, campaign }
  })

  router.get('/api/livrables/campaigns/:id', async (ctx) => {
    const m = await lib('campaigns')
    const campaign = m.getCampaign(ctx.params.id)
    if (!campaign) throw new HttpError(404, 'Campagne introuvable.')
    return { ok: true, campaign }
  })
}

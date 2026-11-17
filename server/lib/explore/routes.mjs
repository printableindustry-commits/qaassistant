/**
 * Module explore : routes HTTP de l'automatisation Playwright (docs/V3-ARCHITECTURE.md §5.2).
 *
 *   GET  /api/explore/engine                      → état du moteur (Playwright, navigateurs) et de l'IA
 *   GET  /api/explore/targets                     → cibles (mots de passe masqués)
 *   PUT  /api/explore/targets                     { targets } (liste complète) | { target } (création / mise à jour)
 *   DELETE /api/explore/targets/:id
 *   POST /api/explore/sessions                    { storyKey, targetId, accountIds, instructions, maxIterations, headless }
 *   GET  /api/explore/sessions?storyKey=          → sessions de l'utilisateur (toutes pour un administrateur)
 *   GET  /api/explore/sessions/:id                → session + derniers événements
 *   GET  /api/explore/sessions/:id/events         → flux SSE
 *   POST …/chat { message } | { answer } | { reset: true } ; PUT …/plan { plan } | { rules: true }
 *   POST …/start ; POST …/takeover { mode } ; POST …/remote { kind, x, y, text, key } ; POST …/takeover/done
 *   GET  …/snapshot (éléments et boîtes de la page courante) ; PUT  …/steps { scenarios } ; POST …/replay ;
 *   POST …/validate { force } ; POST …/stop
 */
import { HttpError } from '../http/router.mjs'
import { registerStatus, statusOf } from '../app-model.mjs'
import { getStory } from '../jira/stories.mjs'
import { getLlmStatus } from '../llm/index.mjs'
import { engineStatus } from './engine.mjs'
import { listTargets, getTarget, saveTargets, upsertTarget, deleteTarget, setRuntimePort } from './targets.mjs'
import * as S from './sessions.mjs'
import * as A from './agent.mjs'

const KEY_RE = /^[A-Z][A-Z0-9_]*-\d+$/

/** Enveloppe : port réel (adresse de l'application de démo) et erreurs métier → HTTP. */
function wrap(fn) {
  return async (ctx) => {
    try {
      setRuntimePort(ctx.req?.socket?.localPort)
    } catch { /* ignoré */ }
    try {
      return await fn(ctx)
    } catch (e) {
      if (e instanceof A.AgentError) throw new HttpError(e.status, e.message, e.details)
      throw e
    }
  }
}

async function objectBody(ctx) {
  const body = await ctx.body()
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Corps de requête JSON (objet) attendu.')
  return body
}

function sessionOr404(ctx) {
  const id = String(ctx.params.id || '')
  if (!S.isValidId(id)) throw new HttpError(400, 'Identifiant de session invalide.')
  const rec = S.getSession(id)
  if (!rec) throw new HttpError(404, 'Session d\'exploration introuvable.')
  if (!S.canAccess(rec, ctx.user)) throw new HttpError(404, 'Session d\'exploration introuvable.')
  return rec
}

function enginePayload() {
  const engine = engineStatus()
  let llm = { active: null }
  try { llm = { active: getLlmStatus().active } } catch { /* ignoré */ }
  return { ok: true, ...engine, llm }
}

let statusCache = { at: 0, value: null }
function automationStatus() {
  const now = Date.now()
  if (statusCache.value && now - statusCache.at < 10000) return statusCache.value
  let value
  const engine = engineStatus()
  if (!engine.available) value = statusOf.blocked('Installez Playwright')
  else {
    let validated = 0
    try { validated = S.listSessions().filter((s) => s.status === 'validated').length } catch { validated = 0 }
    value = validated ? statusOf.done(`${validated} test${validated > 1 ? 's' : ''} validé${validated > 1 ? 's' : ''}`) : statusOf.info('Prêt à explorer')
  }
  statusCache = { at: now, value }
  return value
}

export function register(router) {
  registerStatus('automation', automationStatus)

  // ---------- Moteur et cibles ----------
  router.get('/api/explore/engine', wrap(() => enginePayload()))

  router.get('/api/explore/targets', wrap(() => ({ ok: true, targets: listTargets() })))

  router.put('/api/explore/targets', wrap(async (ctx) => {
    const body = await objectBody(ctx)
    try {
      if (Array.isArray(body.targets)) return { ok: true, targets: saveTargets(body.targets) }
      if (body.target && typeof body.target === 'object') {
        const target = upsertTarget(body.target)
        return { ok: true, target, targets: listTargets() }
      }
    } catch (e) {
      throw new HttpError(400, e.message)
    }
    throw new HttpError(400, 'Corps attendu : { targets: [...] } ou { target: {...} }.')
  }))

  router.delete('/api/explore/targets/:id', wrap((ctx) => {
    let removed
    try { removed = deleteTarget(String(ctx.params.id)) } catch (e) { throw new HttpError(400, e.message) }
    if (!removed) throw new HttpError(404, 'Application introuvable.')
    return { ok: true, targets: listTargets() }
  }))

  // ---------- Sessions ----------
  router.post('/api/explore/sessions', wrap(async (ctx) => {
    const body = await objectBody(ctx)
    const storyKey = String(body.storyKey || '').trim().toUpperCase()
    if (!KEY_RE.test(storyKey)) throw new HttpError(400, 'Clé de récit invalide (exemple : IRMA-12).')
    const story = getStory(storyKey)
    if (!story) throw new HttpError(404, `Récit ${storyKey} introuvable : relancez le scan JIRA si besoin.`)
    const target = getTarget(String(body.targetId || ''), { withSecrets: false })
    if (!target) throw new HttpError(404, 'Application à tester introuvable : choisissez-en une ou créez-la.')
    const known = new Set(target.accounts.map((a) => a.id))
    let accountIds = Array.isArray(body.accountIds) ? [...new Set(body.accountIds.map(String))] : null
    if (accountIds) {
      const unknown = accountIds.filter((id) => !known.has(id))
      if (unknown.length) throw new HttpError(400, `Compte(s) inconnu(s) pour cette application : ${unknown.join(', ')}.`)
    } else {
      accountIds = target.accounts.slice(0, 1).map((a) => a.id)
    }
    const maxIterations = body.maxIterations == null ? 4 : Number(body.maxIterations)
    if (!Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > 10) throw new HttpError(400, 'Nombre de tentatives par étape : entre 1 et 10.')
    if (body.headless != null && typeof body.headless !== 'boolean') throw new HttpError(400, '« headless » doit être vrai ou faux.')
    const active = S.findActive({ targetId: target.id, username: ctx.user?.username })
    if (active) {
      throw new HttpError(409, `Une session est déjà active sur « ${target.name} » (récit ${active.storyKey}, ${S.STATUS_LABEL[active.status] || active.status}) : arrêtez-la avant d'en ouvrir une autre.`, { sessionId: active.id, storyKey: active.storyKey })
    }
    const rec = S.createSession({
      storyKey,
      storySummary: story.summary || '',
      target: { id: target.id, name: target.name, baseUrl: target.baseUrl },
      browser: target.browser || 'msedge',
      accountIds,
      accounts: target.accounts.filter((a) => accountIds.includes(a.id)).map((a) => ({ id: a.id, label: a.label })),
      instructions: String(body.instructions || '').slice(0, 4000),
      maxIterations,
      headless: body.headless === true, // par défaut la fenêtre est visible sur le poste du testeur
      createdBy: ctx.user?.username || '',
    })
    rec.plan = A.initialPlan(rec)
    rec.scenarios = rec.plan.scenarios.map((sc) => ({ planScenarioId: sc.id, name: sc.name, steps: [] }))
    rec.chat.push({
      role: 'assistant',
      at: new Date().toISOString(),
      source: 'rule',
      content: `Bonjour ! J'ai préparé un premier plan à partir ${rec.plan.scenarios.length ? 'du Gherkin ou des critères d\'acceptation' : 'du récit'} : ${rec.plan.scenarios.length} scénario(s). Expliquez-moi comment vous voulez tester (parcours, compte à utiliser, vérifications importantes) et j'ajusterai le plan.`,
    })
    S.saveSession(rec)
    A.regenCode(rec)
    return ctx.json(201, { ok: true, session: S.publicSession(rec) })
  }))

  router.get('/api/explore/sessions', wrap((ctx) => {
    const key = ctx.query.storyKey ? String(ctx.query.storyKey).toUpperCase() : undefined
    const list = S.listSessions({ storyKey: key }).filter((r) => S.canAccess(r, ctx.user))
    return { ok: true, sessions: list.map(S.summarySession) }
  }))

  router.get('/api/explore/sessions/:id', wrap((ctx) => {
    const rec = sessionOr404(ctx)
    return { ok: true, session: S.publicSession(rec), events: S.readEvents(rec.id, { limit: 150 }), llm: { active: enginePayload().llm.active } }
  }))

  router.get('/api/explore/sessions/:id/events', wrap((ctx) => {
    const rec = sessionOr404(ctx)
    const stream = ctx.sse()
    stream.send('status', { status: rec.status, label: S.STATUS_LABEL[rec.status], reason: rec.statusReason || '', session: S.publicSession(rec) })
    const rt = S.runtimeOf(rec.id)
    if (rt.lastScreenshot && rt.browser) stream.send('screenshot', rt.lastScreenshot)
    else {
      // navigateur fermé : réaffiche la dernière capture enregistrée plutôt qu'un cadre vide
      const shot = S.lastSavedShot(rec.id)
      if (shot) stream.send('screenshot', shot)
    }
    if (rec.status === 'needs-human' && rec.needsHuman) stream.send('needs-human', rec.needsHuman)
    const off = S.subscribe(rec.id, (type, data) => {
      if (stream.closed) return off()
      stream.send(type, data)
    })
    ctx.req.on('close', off)
  }))

  router.post('/api/explore/sessions/:id/chat', wrap(async (ctx) => {
    const rec = sessionOr404(ctx)
    const body = await objectBody(ctx)
    if (body.message == null && body.answer == null && !body.reset) throw new HttpError(400, 'Message attendu.')
    if (body.answer != null && !String(body.answer).trim()) throw new HttpError(400, 'Réponse vide : collez la réponse de votre assistant.')
    const r = await A.chat(rec, { message: body.message, answer: body.answer, reset: body.reset === true })
    return { ok: true, ...r, session: S.publicSession(rec) }
  }))

  router.put('/api/explore/sessions/:id/plan', wrap(async (ctx) => {
    const rec = sessionOr404(ctx)
    const body = await objectBody(ctx)
    const plan = A.updatePlan(rec, { plan: body.plan, rules: body.rules === true })
    return { ok: true, plan, session: S.publicSession(rec) }
  }))

  router.post('/api/explore/sessions/:id/start', wrap(async (ctx) => {
    const rec = sessionOr404(ctx)
    const body = await objectBody(ctx).catch(() => ({}))
    if (rec.status === 'validated') throw new HttpError(409, 'Ce test est déjà validé : créez une nouvelle session pour le refaire.')
    A.startExploration(rec, { fromPlanStepId: body.fromPlanStepId ? String(body.fromPlanStepId) : null, restart: body.restart === true })
    return { ok: true, session: S.publicSession(rec) }
  }))

  router.post('/api/explore/sessions/:id/takeover', wrap(async (ctx) => {
    const rec = sessionOr404(ctx)
    const body = await objectBody(ctx).catch(() => ({}))
    const mode = body.mode === 'window' ? 'window' : 'remote'
    await A.takeover(rec, { mode, planStepId: body.planStepId ? String(body.planStepId) : null })
    return { ok: true, session: S.publicSession(rec) }
  }))

  router.post('/api/explore/sessions/:id/remote', wrap(async (ctx) => {
    const rec = sessionOr404(ctx)
    const body = await objectBody(ctx)
    if (!['click', 'type', 'key', 'check'].includes(body.kind)) throw new HttpError(400, 'Action à distance inconnue : click, type, key ou check.')
    const r = await A.remote(rec, body)
    if (r && r.ok === false) throw new HttpError(400, r.error || 'Action impossible.')
    return { ok: true, result: r }
  }))

  router.get('/api/explore/sessions/:id/snapshot', wrap(async (ctx) => {
    const rec = sessionOr404(ctx)
    return { ok: true, snapshot: await A.pageSnapshot(rec) }
  }))

  router.post('/api/explore/sessions/:id/takeover/done', wrap(async (ctx) => {
    const rec = sessionOr404(ctx)
    const body = await objectBody(ctx).catch(() => ({}))
    const r = await A.takeoverDone(rec, {
      discard: body.discard === true,
      skip: body.skip === true,
      coverUntil: body.coverUntil ? String(body.coverUntil) : null,
      resume: body.resume !== false,
    })
    return { ok: true, resumed: Boolean(r?.resumed), steps: r?.steps ?? 0, session: S.publicSession(rec) }
  }))

  router.put('/api/explore/sessions/:id/steps', wrap(async (ctx) => {
    const rec = sessionOr404(ctx)
    const body = await objectBody(ctx)
    A.updateSteps(rec, { scenarios: body.scenarios })
    return { ok: true, session: S.publicSession(rec) }
  }))

  router.post('/api/explore/sessions/:id/replay', wrap((ctx) => {
    const rec = sessionOr404(ctx)
    A.startReplay(rec)
    return { ok: true, session: S.publicSession(rec) }
  }))

  router.post('/api/explore/sessions/:id/validate', wrap(async (ctx) => {
    const rec = sessionOr404(ctx)
    const body = await objectBody(ctx).catch(() => ({}))
    const r = A.validate(rec, ctx.user, { force: body.force === true })
    statusCache = { at: 0, value: null }
    return { ok: true, ...r, session: S.publicSession(rec) }
  }))

  router.post('/api/explore/sessions/:id/stop', wrap(async (ctx) => {
    const rec = sessionOr404(ctx)
    await A.stopSession(rec)
    return { ok: true, session: S.publicSession(rec) }
  }))
}

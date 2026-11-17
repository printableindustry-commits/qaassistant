/**
 * Routes du module « Assistant IA ».
 *
 *   GET  /api/llm/status                    état des fournisseurs, du pont VS Code et de Copilot CLI
 *   GET  /api/llm/config                    réglages (secrets masqués)
 *   PUT  /api/llm/config                    enregistrer les réglages (administrateur)
 *   POST /api/llm/test                      essai d'un fournisseur { provider }
 *   POST /api/llm/chat                      bac à sable { purpose, system, messages, provider?, json? }
 *   GET  /api/llm/audit                     journal d'audit (sans contenu)
 *   POST /api/llm/bridge/token/reveal       jeton d'appairage en clair (administrateur)
 *   POST /api/llm/bridge/token/regenerate   nouveau jeton (administrateur)
 *   Pont de l'extension (publiques, protégées par le jeton) :
 *   POST /api/llm/bridge/hello · GET /api/llm/bridge/next · POST /api/llm/bridge/:id/result · POST /api/llm/bridge/heartbeat
 */
import { HttpError } from '../http/router.mjs'
import { registerStatus, statusOf } from '../app-model.mjs'
import { complete, getLlmStatus, refreshDetection, PROVIDER_IDS } from './index.mjs'
import { loadConfig, publicConfig, saveConfig, regenerateBridgeToken, providerLabel, CONFIG_PATH } from './config.mjs'
import { tokenFromRequest, isTokenValid, report, bridgeInfo, nextJob, completeJob, requeue } from './bridge.mjs'
import { detectionInfo, buildArgs } from './providers/copilot-cli.mjs'
import { readAudit, AUDIT_PATH } from './audit.mjs'

const TEST_PROMPT = 'Test de connexion de Wizard QA. Réponds exactement par : OK Wizard QA'
const lastTests = {}

// ------------------------------------------------------------------ jeton du pont

const failures = { count: 0, since: 0 }

function requireBridgeToken(ctx) {
  const now = Date.now()
  if (now - failures.since > 60000) Object.assign(failures, { count: 0, since: now })
  // Le jeton valide passe toujours : un tiers qui multiplie les essais ne bloque pas l'extension appairée.
  if (isTokenValid(tokenFromRequest(ctx.req))) return
  if (failures.count >= 30) throw new HttpError(429, 'Trop de tentatives avec un jeton invalide : réessayez dans une minute.')
  failures.count += 1
  throw new HttpError(401, 'Jeton d\'appairage absent ou invalide : copiez le jeton affiché sur la page Assistant IA dans le réglage wizardQa.bridgeToken.')
}

// ------------------------------------------------------------------ validation des saisies

/** Corps JSON attendu sous forme d'objet (un « null » ou un tableau est refusé proprement). */
async function objectBody(ctx) {
  const body = await ctx.body()
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Corps de requête : objet JSON attendu.')
  return body
}

function cleanMessages(body) {
  if (typeof body.prompt === 'string' && !body.messages) body.messages = [{ role: 'user', content: body.prompt }]
  const list = body.messages
  if (!Array.isArray(list) || !list.length) throw new HttpError(400, 'Saisissez au moins un message.')
  if (list.length > 50) throw new HttpError(400, 'Conversation trop longue (50 messages au plus).')
  return list.map((m, i) => {
    if (!['user', 'assistant', 'system'].includes(m?.role)) throw new HttpError(400, `Message ${i + 1} : rôle invalide.`)
    if (typeof m.content !== 'string' || !m.content.trim()) throw new HttpError(400, `Message ${i + 1} : contenu vide.`)
    return { role: m.role, content: m.content }
  })
}

function cleanProvider(value) {
  if (value === undefined || value === null || value === '' || value === 'auto') return undefined
  if (!PROVIDER_IDS.includes(value)) throw new HttpError(400, `Fournisseur inconnu : ${value}`)
  return value
}

/** Annule l'appel à l'IA si le navigateur abandonne la requête. */
function abortOnDisconnect(ctx) {
  const ctrl = new AbortController()
  ctx.res.on('close', () => { if (!ctx.res.writableEnded) ctrl.abort() })
  return ctrl.signal
}

// ------------------------------------------------------------------ vues

function fullStatus() {
  const cfg = loadConfig()
  const cli = cfg.providers['copilot-cli']
  return {
    ...getLlmStatus(),
    order: cfg.order,
    bridge: bridgeInfo(),
    cli: {
      detection: detectionInfo(),
      command: cli.command,
      preview: [cli.command, ...buildArgs(cli, '<prompt>')].map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' '),
    },
    lastTests,
    files: { config: CONFIG_PATH, audit: AUDIT_PATH },
  }
}

function auditStats(entries) {
  const ok = entries.filter((e) => e.ok)
  const avg = ok.length ? Math.round(ok.reduce((s, e) => s + e.durationMs, 0) / ok.length) : null
  return { total: entries.length, ok: ok.length, failed: entries.length - ok.length, avgDurationMs: avg, last: entries[0] || null }
}

// ------------------------------------------------------------------ enregistrement

export function register(router) {
  registerStatus('llm', () => {
    const { active } = getLlmStatus()
    if (!active) return statusOf.info('Mode copier-coller')
    return statusOf.done(active.model ? `${active.label} · ${active.model}` : active.label)
  })
  refreshDetection().catch(() => {})

  router.get('/api/llm/status', async (ctx) => {
    if (ctx.query.refresh === '1') await refreshDetection(true)
    return { ok: true, ...fullStatus() }
  })

  router.get('/api/llm/config', (ctx) => ({ ok: true, config: publicConfig(), canEdit: ctx.user?.role === 'admin' }))

  router.put('/api/llm/config', async (ctx) => {
    const body = await objectBody(ctx)
    saveConfig(body)
    if (body.providers?.['copilot-cli']) await refreshDetection(true)
    return { ok: true, config: publicConfig(), status: fullStatus() }
  }, { role: 'admin' })

  router.post('/api/llm/test', async (ctx) => {
    const body = await objectBody(ctx)
    const provider = cleanProvider(body.provider)
    if (!provider) throw new HttpError(400, 'Précisez le fournisseur à essayer.')
    if (provider === 'copilot-cli') await refreshDetection(true)
    const r = await complete({
      purpose: 'test',
      provider,
      messages: [{ role: 'user', content: TEST_PROMPT }],
      maxTokens: 60,
      timeoutMs: provider === 'copilot-cli' ? 120000 : 60000,
      signal: abortOnDisconnect(ctx),
    })
    const test = {
      provider,
      label: providerLabel(provider),
      success: r.ok || provider === 'manual',
      at: new Date().toISOString(),
      model: r.model || '',
      durationMs: r.durationMs ?? null,
      text: r.ok ? r.text.slice(0, 500) : '',
      error: r.ok || provider === 'manual' ? '' : r.reason,
    }
    lastTests[provider] = test
    return { ok: true, test, status: fullStatus() }
  })

  router.post('/api/llm/chat', async (ctx) => {
    const body = await objectBody(ctx)
    const result = await complete({
      purpose: String(body.purpose || 'chat').slice(0, 40),
      system: typeof body.system === 'string' ? body.system : '',
      messages: cleanMessages(body),
      json: Boolean(body.json),
      maxTokens: body.maxTokens,
      provider: cleanProvider(body.provider),
      signal: abortOnDisconnect(ctx),
    })
    return { ok: true, result }
  })

  router.get('/api/llm/audit', (ctx) => {
    const entries = readAudit(Math.min(Math.max(Math.floor(Number(ctx.query.limit)) || 100, 1), 500))
    return { ok: true, entries, stats: auditStats(entries) }
  })

  router.post('/api/llm/bridge/token/reveal', () => ({
    ok: true,
    token: loadConfig().bridge.token,
    envToken: Boolean(process.env.WIZARD_BRIDGE_TOKEN),
  }), { role: 'admin' })

  router.post('/api/llm/bridge/token/regenerate', () => ({ ok: true, token: regenerateBridgeToken() }), { role: 'admin' })

  // --- pont de l'extension VS Code (routes publiques, contrôle par jeton)

  router.post('/api/llm/bridge/hello', async (ctx) => {
    requireBridgeToken(ctx)
    report(await objectBody(ctx), ctx.req)
    return { ok: true, pollWaitMs: 25000, heartbeatMs: 10000, server: 'wizard-qa' }
  })

  router.post('/api/llm/bridge/heartbeat', async (ctx) => {
    requireBridgeToken(ctx)
    report(await objectBody(ctx), ctx.req)
    return { ok: true, queue: bridgeInfo().queue }
  })

  router.get('/api/llm/bridge/next', async (ctx) => {
    requireBridgeToken(ctx)
    const job = await nextJob(ctx.res, ctx.query.wait)
    if (job && (ctx.res.destroyed || ctx.res.writableEnded)) {
      requeue(job.id)
      return undefined
    }
    return { ok: true, job }
  })

  router.post('/api/llm/bridge/:id/result', async (ctx) => {
    requireBridgeToken(ctx)
    const accepted = completeJob(ctx.params.id, await objectBody(ctx))
    if (!accepted) throw new HttpError(404, 'Requête inconnue ou expirée (délai dépassé ou annulée).')
    return { ok: true }
  })
}

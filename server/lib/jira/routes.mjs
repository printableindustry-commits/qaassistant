/**
 * Routes du module JIRA (prise de connaissance, scan et lecture des récits).
 *   GET  /api/jira/settings              réglages de connexion (jeton masqué)
 *   PUT  /api/jira/settings              enregistrer les réglages (administrateur)
 *   POST /api/jira/test-connection       tester la connexion (déploiement, compte, champs, projet)
 *   GET  /api/jira/projects              projets visibles par le compte
 *   POST /api/jira/parse-url             analyser une URL JIRA collée { url } → { parsed, label, demo, sameInstance, hasToken, ready }
 *   POST /api/jira/scan                  lancer un scan { mode: 'jira'|'demo', projectKey?, jql? } ou { url } → { jobId }
 *                                        (URL d'une autre instance ou jeton absent : 400 { needsCredentials, baseUrl, projectKey })
 *   GET  /api/jira/scan/:jobId/events    progression en direct (SSE : progress, done, error)
 *   GET  /api/jira/scans                 historique des scans
 *   GET  /api/jira/stories               récits filtrés ?q=&status=&epic=&label=&limit=
 *   GET  /api/jira/stories/:key          un récit et sa relecture QA
 *   GET  /api/jira/overview              synthèse : compteurs, couverture, à clarifier, questions au PO
 *   GET  /api/jira/triage                décisions de tri + suggestions { ok, triage, suggestions, ai, counts }
 *   PUT  /api/jira/triage/:key           { decision: 'todo'|'later'|'skip'|null, reason }
 *   POST /api/jira/triage/bulk           { keys, decision, reason? } | { items: [{ key, decision, reason }] }
 *                                        | { applySuggestions: true, keys?, overwrite?, source?: 'rules'|'ai' }
 *   POST /api/jira/triage/ai             { keys? } classement par l'IA ; { keys?, answer } réponse collée (mode manuel)
 */
import { HttpError } from '../http/router.mjs'
import { registerStatus, statusOf } from '../app-model.mjs'
import { createJiraClient, JiraError } from './client.mjs'
import { discoverFields } from './fields.mjs'
import { loadSettings, saveSettings, mergeSettings, maskSettings, isConfigured, proposedJql } from './settings.mjs'
import { listStories, getStory, getScanInfo, getScanHistory } from './stories.mjs'
import { startScan, getJob, runningJob } from './scan.mjs'
import { buildOverview } from './overview.mjs'
import { reviewStory } from './review.mjs'
import { parseJiraUrl, describeParsedUrl, storableJiraUrl } from './url.mjs'
import {
  getTriage, getAiTriage, suggestTriage, setDecisions, saveAiSuggestions, normalizeDecision, DECISION_LABEL,
  selectAiKeys, storyForAi, AI_SYSTEM, buildAiMessages, validateAiAnswer,
} from './triage.mjs'
import { getGherkinIndex } from '../gherkin/store.mjs'
import { complete } from '../llm/index.mjs'

// Instance de démonstration : une URL de ce JIRA fictif lance le scan des données IRMA.
const DEMO_HOST = 'jira.demo.irma.local'
const KEY_RE = /^[A-Z][A-Z0-9_]*-\d+$/

const isAdmin = (ctx) => ctx.user?.role === 'admin'

/** Corps JSON attendu sous forme d'objet (un tableau, une chaîne ou null sont refusés). */
async function objectBody(ctx) {
  const body = await ctx.body()
  if (body == null || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Corps de requête invalide : un objet JSON est attendu.')
  return body
}

/** Convertit une erreur JIRA en réponse HTTP lisible (message + piste de résolution). */
function asHttpError(e) {
  if (!(e instanceof JiraError)) return e
  const status = e.code === 'CONFIG' ? 400 : 502
  return new HttpError(status, e.message, { hint: e.hint, code: e.code, upstreamStatus: e.status || undefined })
}

function settingsPayload(ctx) {
  const { settings, saved, inheritedFrom } = loadSettings()
  return {
    ok: true,
    settings: maskSettings(settings),
    configured: isConfigured(settings),
    saved,
    inheritedFrom,
    proposedJql: proposedJql(settings),
    canEdit: isAdmin(ctx),
  }
}

async function testConnection(settings) {
  const started = Date.now()
  const client = await createJiraClient(settings)
  const me = await client.myself()
  const fields = discoverFields(await client.fields(), { acceptanceField: settings.acceptanceField })
  let project = null
  if (settings.projectKey) {
    const p = await client.project(settings.projectKey)
    project = { key: p.key, name: p.name, issueTypes: (p.issueTypes || []).filter((t) => !t.subtask).map((t) => t.name) }
  }
  return {
    ok: true,
    deployment: client.deployment,
    version: client.serverInfo?.version || '',
    serverTitle: client.serverInfo?.serverTitle || '',
    user: { displayName: me.displayName || me.name || '', email: me.emailAddress || '' },
    fields,
    project,
    durationMs: Date.now() - started,
  }
}

function storyLimit(raw) {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.min(n, 5000) : null
}

function knowledgeStatus() {
  const scan = getScanInfo()
  if (scan) return statusOf.done(`${scan.count} récits${scan.source === 'demo' ? ' (démo)' : ''}`)
  return isConfigured(loadSettings().settings) ? statusOf.todo('Scan JIRA à lancer') : statusOf.todo('Connecter JIRA ou essayer la démo')
}

const sameBase = (a, b) => String(a || '').replace(/\/+$/, '').toLowerCase() === String(b || '').replace(/\/+$/, '').toLowerCase()

function isDemoUrl(parsed) {
  return Boolean(parsed?.ok && parsed.host.split(':')[0] === DEMO_HOST)
}

/** Analyse d'URL enrichie pour l'interface : instance déjà configurée ? jeton présent ? */
function describeUrl(url) {
  const parsed = parseJiraUrl(url)
  if (!parsed.ok) return { ok: false, error: parsed.error, baseUrl: parsed.baseUrl || null }
  const { settings } = loadSettings()
  const demo = isDemoUrl(parsed)
  const sameInstance = demo || sameBase(settings.baseUrl, parsed.baseUrl)
  return {
    ok: true,
    parsed,
    label: describeParsedUrl(parsed),
    demo,
    sameInstance,
    hasToken: Boolean(settings.token),
    ready: demo || (sameInstance && Boolean(settings.token)),
  }
}

/** Compteurs seuls (sans recalculer les suggestions de tous les récits). */
function triageCounts() {
  const triage = getTriage()
  const stories = listStories()
  const counts = { untriaged: 0, todo: 0, later: 0, skip: 0, total: stories.length }
  for (const s of stories) {
    const d = triage[s.key]?.decision
    if (d && Object.hasOwn(DECISION_LABEL, d)) counts[d] += 1
    else counts.untriaged += 1
  }
  return counts
}

function triagePayload() {
  const stories = listStories()
  const triage = getTriage()
  const ai = getAiTriage()
  const index = getGherkinIndex()
  const suggestions = {}
  const counts = { untriaged: 0, todo: 0, later: 0, skip: 0, total: stories.length }
  for (const s of stories) {
    suggestions[s.key] = suggestTriage(s, { gherkin: index[s.key] || null })
    const d = triage[s.key]?.decision
    if (d && Object.hasOwn(DECISION_LABEL, d)) counts[d] += 1
    else counts.untriaged += 1
  }
  return { ok: true, triage, suggestions, ai, counts, labels: DECISION_LABEL }
}

function storyKeys(list) {
  if (!Array.isArray(list)) throw new HttpError(400, '« keys » doit être une liste de clés de récits.')
  if (list.length > 5000) throw new HttpError(400, 'Trop de récits en une fois (5 000 au plus).')
  const keys = [...new Set(list.map((k) => String(k || '').trim().toUpperCase()).filter(Boolean))]
  const bad = keys.find((k) => !KEY_RE.test(k))
  if (bad) throw new HttpError(400, `Clé de récit invalide : ${bad.slice(0, 40)}`)
  return keys
}

function decisionOrThrow(value) {
  try {
    return normalizeDecision(value)
  } catch (e) {
    throw new HttpError(400, e.message)
  }
}

function buildManualPrompt(payload) {
  return `${AI_SYSTEM}\n\n${buildAiMessages(payload)[0].content}`
}

async function scanFromUrl(ctx, url) {
  const info = describeUrl(url)
  if (!info.ok) return ctx.json(400, { ok: false, error: info.error, baseUrl: info.baseUrl })
  const p = info.parsed
  const current = runningJob()
  if (current) return { ok: true, jobId: current.id, alreadyRunning: true, parsed: p, label: info.label }
  if (info.demo) {
    const job = startScan({ mode: 'demo', user: ctx.user?.username })
    return { ok: true, jobId: job.id, parsed: p, demo: true, label: info.label }
  }
  if (!info.ready) {
    // Le jeton enregistré ne part jamais vers une autre instance que celle des réglages.
    const { settings } = loadSettings()
    return ctx.json(400, {
      ok: false,
      needsCredentials: true,
      baseUrl: p.baseUrl,
      projectKey: p.projectKey,
      deployment: p.deployment,
      currentBaseUrl: settings.baseUrl || '',
      canEdit: isAdmin(ctx),
      error: info.sameInstance
        ? `Jeton JIRA manquant pour ${p.host} : saisissez votre e-mail et un jeton d’API pour scanner les récits.`
        : `Wizard QA n’a pas encore d’accès à ${p.host} : saisissez votre e-mail et un jeton d’API pour scanner les récits.`,
    })
  }
  const jql = p.jql ? p.jql.trim() : ''
  const job = startScan({
    mode: 'jira',
    projectKey: jql ? '' : (p.projectKey || ''),
    jql,
    user: ctx.user?.username,
    // Identifiants éventuellement collés dans l'adresse : jamais conservés ni réaffichés.
    fromUrl: { url: storableJiraUrl(url), kind: p.kind, boardId: p.boardId, filterId: p.filterId, issueKey: p.issueKey },
  })
  return { ok: true, jobId: job.id, parsed: p, label: info.label }
}

export function register(router) {
  registerStatus('knowledge', knowledgeStatus)

  router.get('/api/jira/settings', (ctx) => settingsPayload(ctx))

  router.put('/api/jira/settings', async (ctx) => {
    const body = await objectBody(ctx)
    try {
      saveSettings(body)
    } catch (e) {
      throw new HttpError(400, e.message)
    }
    return settingsPayload(ctx)
  }, { role: 'admin' })

  router.post('/api/jira/test-connection', async (ctx) => {
    const body = await objectBody(ctx)
    const { settings } = loadSettings()
    // Seul un administrateur peut tester des réglages non enregistrés (le jeton enregistré ne part
    // ainsi jamais vers une adresse saisie par un autre utilisateur).
    let candidate = settings
    if (isAdmin(ctx) && Object.keys(body).length) {
      try {
        candidate = mergeSettings(settings, body)
      } catch (e) {
        throw new HttpError(400, e.message)
      }
    }
    try {
      return await testConnection(candidate)
    } catch (e) {
      throw asHttpError(e)
    }
  })

  router.get('/api/jira/projects', async () => {
    const { settings } = loadSettings()
    if (!isConfigured(settings)) throw new HttpError(400, 'Connexion JIRA non configurée.', { hint: 'Renseignez l’URL et le jeton dans l’étape « Connexion JIRA », ou utilisez les données de démonstration.' })
    try {
      const client = await createJiraClient(settings)
      const projects = (await client.projects()).map((p) => ({ key: p.key, name: p.name, id: String(p.id || '') }))
      return { ok: true, projects, deployment: client.deployment }
    } catch (e) {
      throw asHttpError(e)
    }
  })

  router.post('/api/jira/parse-url', async (ctx) => {
    const body = await objectBody(ctx)
    const r = describeUrl(String(body.url ?? ''))
    if (!r.ok) return ctx.json(400, { ok: false, error: r.error, baseUrl: r.baseUrl })
    return r
  })

  router.post('/api/jira/scan', async (ctx) => {
    const body = await objectBody(ctx)
    if (body.url != null && String(body.url).trim()) return scanFromUrl(ctx, String(body.url))
    const mode = body.mode === 'jira' ? 'jira' : 'demo'
    const jql = String(body.jql || '').trim()
    if (jql.length > 4000) throw new HttpError(400, 'Requête JQL trop longue (4 000 caractères au plus).')
    const projectKey = String(body.projectKey || '').trim().toUpperCase()
    if (projectKey && !/^[A-Z][A-Z0-9_]{1,19}$/.test(projectKey)) throw new HttpError(400, 'Clé projet invalide.')
    if (mode === 'jira' && !isConfigured(loadSettings().settings)) {
      throw new HttpError(400, 'Connexion JIRA non configurée.', { hint: 'Enregistrez l’URL et le jeton JIRA, ou lancez le scan de démonstration.' })
    }
    const current = runningJob()
    if (current) return { ok: true, jobId: current.id, alreadyRunning: true }
    const job = startScan({ mode, projectKey, jql, user: ctx.user?.username })
    return { ok: true, jobId: job.id }
  })

  router.get('/api/jira/scan/:jobId/events', (ctx) => {
    const job = getJob(ctx.params.jobId)
    if (!job) throw new HttpError(404, 'Scan introuvable (le serveur a peut-être redémarré).')
    const stream = ctx.sse()
    const unsubscribe = job.subscribe(({ event, data }) => {
      stream.send(event, data)
      if (event === 'done' || event === 'error') setTimeout(() => stream.close(), 50)
    })
    ctx.req.on('close', unsubscribe)
  })

  router.get('/api/jira/scans', () => ({ ok: true, scans: getScanHistory() }))

  router.get('/api/jira/stories', (ctx) => {
    const { q, status, epic, label, limit } = ctx.query
    const all = listStories({ q, status, epic, label })
    const max = storyLimit(limit)
    return { ok: true, stories: max ? all.slice(0, max) : all, total: all.length, scan: getScanInfo() }
  })

  router.get('/api/jira/stories/:key', (ctx) => {
    const story = getStory(ctx.params.key)
    if (!story) throw new HttpError(404, `Récit ${ctx.params.key} introuvable : relancez le scan si besoin.`)
    return { ok: true, story, review: reviewStory(story) }
  })

  router.get('/api/jira/overview', () => ({ ok: true, ...buildOverview() }))

  // ------------------------------------------------------------ tri des récits

  router.get('/api/jira/triage', () => triagePayload())

  router.put('/api/jira/triage/:key', async (ctx) => {
    const body = await objectBody(ctx)
    const key = String(ctx.params.key || '').toUpperCase()
    if (!KEY_RE.test(key)) throw new HttpError(400, 'Clé de récit invalide.')
    if (!getStory(key)) throw new HttpError(404, `Récit ${key} introuvable : relancez le scan si besoin.`)
    const decision = decisionOrThrow(body.decision)
    setDecisions([{ key, decision, reason: body.reason }], ctx.user?.username)
    return { ok: true, key, entry: getTriage()[key] || null, counts: triageCounts() }
  })

  router.post('/api/jira/triage/bulk', async (ctx) => {
    const body = await objectBody(ctx)
    const stories = listStories()
    const known = new Set(stories.map((s) => s.key))
    let items
    if (body.applySuggestions) {
      // Suggestions (règles, ou IA si source = 'ai') appliquées aux récits sans décision, sauf overwrite.
      const triage = getTriage()
      const ai = getAiTriage()
      const index = getGherkinIndex()
      const keys = body.keys != null ? new Set(storyKeys(body.keys)) : null
      items = stories
        .filter((s) => (!keys || keys.has(s.key)) && (body.overwrite || !triage[s.key]))
        .map((s) => {
          if (body.source === 'ai') {
            const a = ai[s.key]
            return a ? { key: s.key, decision: a.suggestion, reason: `Proposition de l’IA : ${a.reason || DECISION_LABEL[a.suggestion]}` } : null
          }
          const sug = suggestTriage(s, { gherkin: index[s.key] || null })
          return { key: s.key, decision: sug.suggestion, reason: `Suggestion appliquée (score ${sug.score}/100)${sug.factors[0] ? ` : ${sug.factors[0].label}` : ''}` }
        })
        .filter(Boolean)
    } else if (Array.isArray(body.items)) {
      if (body.items.length > 5000) throw new HttpError(400, 'Trop de récits en une fois (5 000 au plus).')
      items = body.items.map((it) => ({ key: String(it?.key || '').trim().toUpperCase(), decision: decisionOrThrow(it?.decision), reason: it?.reason }))
      const badItem = items.find((i) => !KEY_RE.test(i.key))
      if (badItem) throw new HttpError(400, `Clé de récit invalide dans « items » : ${badItem.key.slice(0, 40) || '(vide)'}`)
      if (!items.length) throw new HttpError(400, 'Aucun récit sélectionné.')
    } else {
      const decision = decisionOrThrow(body.decision)
      items = storyKeys(body.keys || []).map((key) => ({ key, decision, reason: body.reason }))
      if (!items.length) throw new HttpError(400, 'Aucun récit sélectionné.')
    }
    const unknown = items.filter((i) => !known.has(i.key)).map((i) => i.key)
    if (unknown.length) throw new HttpError(404, `Récit(s) introuvable(s) dans le dernier scan : ${unknown.slice(0, 5).join(', ')}${unknown.length > 5 ? '…' : ''}`)
    const changed = setDecisions(items, ctx.user?.username)
    return { ...triagePayload(), changed, applied: items.length }
  })

  router.post('/api/jira/triage/ai', async (ctx) => {
    const body = await objectBody(ctx)
    const stories = listStories()
    if (!stories.length) throw new HttpError(400, 'Aucun récit scanné : lancez d’abord un scan.')
    const { list, truncated } = selectAiKeys(stories, body.keys != null ? storyKeys(body.keys) : null)
    if (!list.length) throw new HttpError(400, 'Aucun récit à classer : tous les récits ont déjà une décision (sélectionnez-en pour les reclasser).')
    const keys = list.map((s) => s.key)

    // Réponse collée par le testeur (mode copier-coller).
    if (body.answer != null) {
      const v = validateAiAnswer(String(body.answer).slice(0, 400000), keys)
      if (!v.ok) throw new HttpError(400, v.error, { hint: 'Collez la réponse complète de l’assistant : un JSON {"items":[…]}.' })
      saveAiSuggestions(v.items, { provider: 'manual' })
      return { ok: true, provider: 'manual', items: v.items, missing: v.missing, ignored: v.ignored, truncated, ai: getAiTriage() }
    }

    const index = getGherkinIndex()
    const payload = list.map((s) => storyForAi(s, suggestTriage(s, { gherkin: index[s.key] || null }), index[s.key]))
    const r = await complete({ purpose: 'triage', system: AI_SYSTEM, messages: buildAiMessages(payload), json: true, maxTokens: 4000 })
    if (!r.ok) return { ok: true, manual: true, prompt: r.prompt, reason: r.reason, keys, truncated }
    const v = validateAiAnswer(r.json ?? r.text, keys)
    if (!v.ok) {
      return {
        ok: true, manual: true, invalid: true, keys, truncated,
        reason: `Réponse de l’IA inexploitable (${v.error}) : relancez, ou utilisez le copier-coller.`,
        prompt: buildManualPrompt(payload),
      }
    }
    saveAiSuggestions(v.items, { provider: r.provider, model: r.model })
    return { ok: true, provider: r.provider, model: r.model, items: v.items, missing: v.missing, ignored: v.ignored, truncated, ai: getAiTriage() }
  })
}

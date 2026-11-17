/**
 * Routes du module JIRA (prise de connaissance, scan et lecture des récits).
 *   GET  /api/jira/settings              réglages de connexion (jeton masqué)
 *   PUT  /api/jira/settings              enregistrer les réglages (administrateur)
 *   POST /api/jira/test-connection       tester la connexion (déploiement, compte, champs, projet)
 *   GET  /api/jira/projects              projets visibles par le compte
 *   POST /api/jira/scan                  lancer un scan { mode: 'jira'|'demo', projectKey?, jql? } → { jobId }
 *   GET  /api/jira/scan/:jobId/events    progression en direct (SSE : progress, done, error)
 *   GET  /api/jira/scans                 historique des scans
 *   GET  /api/jira/stories               récits filtrés ?q=&status=&epic=&label=&limit=
 *   GET  /api/jira/stories/:key          un récit et sa relecture QA
 *   GET  /api/jira/overview              synthèse : compteurs, couverture, à clarifier, questions au PO
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

  router.post('/api/jira/scan', async (ctx) => {
    const body = await objectBody(ctx)
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
}

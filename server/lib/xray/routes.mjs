/**
 * Routes du module Xray (docs/V3-ARCHITECTURE.md §5.3).
 *   GET  /api/xray/settings          réglages Xray (secret masqué) + état de la connexion JIRA
 *   PUT  /api/xray/settings          enregistrer les réglages (administrateur)
 *   POST /api/xray/test-connection   tester JIRA + Xray (Cloud : authentification, Server : API raven)
 *   GET  /api/xray/plans?q=&project= plans de test du projet (JQL), simulés en données de démonstration
 *   POST /api/xray/preview           ce qui sera créé ou mis à jour, sans rien écrire ({ …, check: true } : vérifications JIRA)
 *   POST /api/xray/push              envoi { storyKey, source, summary, testPlanKey, testType, dryRun, forceNew, jiraOnly }
 *   GET  /api/xray/pushed?storyKey=  historique des envois
 */
import { HttpError } from '../http/router.mjs'
import { getScanInfo } from '../jira/stories.mjs'
import { loadSettings as loadJiraSettings, isConfigured as jiraConfigured } from '../jira/settings.mjs'
import { createJiraClient } from '../jira/client.mjs'
import { loadXraySettings, saveXraySettings, mergeXraySettings, maskXraySettings, guessMode, hasCloudCredentials, XRAY_REGIONS } from './settings.mjs'
import { createXrayCloudClient } from './client-cloud.mjs'
import { createXrayServerClient } from './client-server.mjs'
import { resolveLinkType, projectIssueTypes, searchPlans } from './jira-ops.mjs'
import { previewPush, pushTest, MODE_LABEL } from './push.mjs'
import { listPushed } from './history.mjs'
import { XrayError, translateError, errorPayload } from './errors.mjs'

const isAdmin = (ctx) => ctx.user?.role === 'admin'

async function objectBody(ctx) {
  const body = await ctx.body()
  if (body == null || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Corps de requête invalide : un objet JSON est attendu.')
  return body
}

/** Erreur Xray / JIRA → réponse HTTP avec piste de résolution (et étapes si l'envoi a commencé). */
function asHttp(e, step = '') {
  if (e instanceof HttpError) return e
  const err = translateError(e, { step })
  const status = err.status >= 400 && err.status < 500 && err.status !== 401 ? err.status : 502
  const details = errorPayload(err)
  if (e.steps) details.steps = e.steps
  return new HttpError(status, err.message, details)
}

async function settingsPayload(ctx) {
  const { settings, saved, inheritedFrom } = await loadXraySettings()
  const jira = loadJiraSettings().settings
  const mode = guessMode(settings, jira)
  const scan = getScanInfo()
  return {
    ok: true,
    settings: maskXraySettings(settings),
    saved,
    inheritedFrom,
    effectiveMode: mode,
    effectiveModeLabel: MODE_LABEL[mode],
    configured: mode === 'cloud' ? hasCloudCredentials(settings) && jiraConfigured(jira) : jiraConfigured(jira),
    canEdit: isAdmin(ctx),
    regions: XRAY_REGIONS,
    jira: {
      configured: jiraConfigured(jira),
      baseUrl: jira.baseUrl || '',
      deployment: jira.deployment || 'auto',
      projectKey: jira.projectKey || scan?.projectKey || '',
    },
    scan: scan ? { source: scan.source, projectKey: scan.projectKey, scannedAt: scan.scannedAt, count: scan.count } : null,
  }
}

async function testConnection(xray, jira) {
  const started = Date.now()
  const checks = []
  const add = (id, label, ok, message = '', hint = '') => checks.push({ id, label, ok, message, hint })
  let client = null
  try {
    client = await createJiraClient(jira)
    const me = await client.myself()
    add('jira', 'Connexion JIRA', true, `${client.deployment === 'cloud' ? 'JIRA Cloud' : 'JIRA Server / Data Center'} — compte ${me?.displayName || me?.name || ''}`.trim())
  } catch (e) {
    const err = translateError(e, { settings: xray })
    add('jira', 'Connexion JIRA', false, err.message, err.hint)
    return { ok: true, success: false, mode: guessMode(xray, jira), checks, durationMs: Date.now() - started }
  }
  const mode = xray.mode === 'auto' ? (client.deployment === 'cloud' ? 'cloud' : 'server') : xray.mode
  const projectKey = jira.projectKey || getScanInfo()?.projectKey || ''
  if (mode === 'cloud') {
    try {
      const x = createXrayCloudClient(xray)
      await x.authenticate({ force: true })
      add('xray-auth', 'Authentification Xray Cloud', true, `Jeton obtenu auprès de ${x.baseUrl}`)
      try {
        const r = await x.ping(projectKey)
        add('xray-api', 'API GraphQL Xray', true, r.testPlans != null ? `${r.testPlans} plan(s) de test${projectKey ? ` dans ${projectKey}` : ''}` : 'répond')
      } catch (e) {
        const err = translateError(e, { settings: xray })
        add('xray-api', 'API GraphQL Xray', false, err.message, err.hint)
      }
    } catch (e) {
      const err = translateError(e, { settings: xray })
      add('xray-auth', 'Authentification Xray Cloud', false, err.message, err.hint)
    }
  } else {
    try {
      await createXrayServerClient(client, jira).ping()
      add('xray-api', 'API Xray Server (/rest/raven/1.0)', true, 'répond')
    } catch (e) {
      const err = translateError(e, { settings: xray })
      add('xray-api', 'API Xray Server (/rest/raven/1.0)', false, err.message, err.hint || 'Le module Xray n’est peut-être pas installé : seul le mode « JIRA seul » sera possible.')
    }
  }
  try {
    const lt = await resolveLinkType(client, xray.linkType)
    add('link', `Type de lien « ${xray.linkType} »`, true, `${lt.name} : ${lt.reversed ? lt.inward : lt.outward} / ${lt.reversed ? lt.outward : lt.inward}`)
  } catch (e) {
    const err = translateError(e, { settings: xray })
    add('link', `Type de lien « ${xray.linkType} »`, false, err.message, err.hint)
  }
  if (projectKey) {
    const types = await projectIssueTypes(client, projectKey)
    if (types) {
      const has = (t) => types.some((x) => x.toLowerCase() === String(t).toLowerCase())
      add('issuetype', `Type d’issue « ${xray.testIssueType} » (${projectKey})`, has(xray.testIssueType), has(xray.testIssueType) ? 'disponible' : `absent — types du projet : ${types.join(', ')}`, has(xray.testIssueType) ? '' : 'Activez Xray sur le projet ou corrigez le nom du type d’issue.')
      add('plantype', `Type d’issue « ${xray.testPlanIssueType} » (${projectKey})`, has(xray.testPlanIssueType), has(xray.testPlanIssueType) ? 'disponible' : 'absent : l’ajout à un plan de test ne sera pas possible')
    }
  }
  return { ok: true, success: checks.every((c) => c.ok), mode, modeLabel: MODE_LABEL[mode], checks, durationMs: Date.now() - started }
}

const DEMO_PLANS = (projectKey) => [
  { key: `${projectKey}-9901`, id: '', summary: 'Plan de recette — sprint courant (démonstration)', status: 'En cours', simulated: true },
  { key: `${projectKey}-9902`, id: '', summary: 'Plan de non-régression (démonstration)', status: 'À faire', simulated: true },
]

function pushInput(body, ctx) {
  return {
    storyKey: body.storyKey,
    source: body.source,
    summary: body.summary,
    testPlanKey: body.testPlanKey,
    testType: body.testType,
    dryRun: Boolean(body.dryRun),
    forceNew: Boolean(body.forceNew),
    jiraOnly: Boolean(body.jiraOnly),
    check: Boolean(body.check),
    user: ctx.user,
  }
}

export function register(router) {
  router.get('/api/xray/settings', (ctx) => settingsPayload(ctx))

  router.put('/api/xray/settings', async (ctx) => {
    const body = await objectBody(ctx)
    try {
      await saveXraySettings(body)
    } catch (e) {
      throw new HttpError(400, e.message)
    }
    return settingsPayload(ctx)
  }, { role: 'admin' })

  router.post('/api/xray/test-connection', async (ctx) => {
    const body = await objectBody(ctx)
    const { settings } = await loadXraySettings()
    const jira = loadJiraSettings().settings
    if (!jiraConfigured(jira)) throw new HttpError(400, 'Connexion JIRA non configurée.', { hint: 'Renseignez l’URL et le jeton JIRA dans Prise de connaissance, puis revenez tester Xray.' })
    // Seul un administrateur peut tester des réglages non enregistrés.
    let candidate = settings
    if (isAdmin(ctx) && Object.keys(body).length) {
      try {
        candidate = mergeXraySettings(settings, body)
      } catch (e) {
        throw new HttpError(400, e.message)
      }
    }
    try {
      return await testConnection(candidate, jira)
    } catch (e) {
      throw asHttp(e)
    }
  })

  router.get('/api/xray/plans', async (ctx) => {
    const q = String(ctx.query.q || '').slice(0, 100)
    const scan = getScanInfo()
    const jira = loadJiraSettings().settings
    const { settings } = await loadXraySettings()
    const projectKey = String(ctx.query.project || scan?.projectKey || jira.projectKey || '').trim().toUpperCase()
    if (projectKey && !/^[A-Z][A-Z0-9_]{1,19}$/.test(projectKey)) throw new HttpError(400, 'Clé projet invalide.')
    if (ctx.query.demo === '1' || scan?.source === 'demo' || !jiraConfigured(jira)) {
      const plans = DEMO_PLANS(projectKey || 'IRMA').filter((p) => !q || `${p.key} ${p.summary}`.toLowerCase().includes(q.toLowerCase()))
      return { ok: true, plans, simulated: true, projectKey, defaultTestPlanKey: settings.defaultTestPlanKey || '' }
    }
    try {
      const client = await createJiraClient(jira)
      const plans = await searchPlans(client, { projectKey, issueType: settings.testPlanIssueType, q })
      return { ok: true, plans, simulated: false, projectKey, defaultTestPlanKey: settings.defaultTestPlanKey || '' }
    } catch (e) {
      throw asHttp(e)
    }
  })

  router.post('/api/xray/preview', async (ctx) => {
    const body = await objectBody(ctx)
    try {
      return await previewPush(pushInput(body, ctx))
    } catch (e) {
      throw asHttp(e)
    }
  })

  router.post('/api/xray/push', async (ctx) => {
    const body = await objectBody(ctx)
    try {
      return await pushTest(pushInput(body, ctx))
    } catch (e) {
      throw asHttp(e, 'test')
    }
  })

  router.get('/api/xray/pushed', (ctx) => {
    const storyKey = String(ctx.query.storyKey || '').trim().toUpperCase()
    if (storyKey && !/^[A-Z][A-Z0-9_]*-\d+$/.test(storyKey)) throw new HttpError(400, 'Clé de récit invalide.')
    const limit = Math.max(1, Math.min(Math.floor(Number(ctx.query.limit)) || 200, 1000))
    return { ok: true, entries: listPushed({ storyKey: storyKey || undefined, limit }) }
  })
}

export { XrayError }

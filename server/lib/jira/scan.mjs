/**
 * Scans de récits, exécutés en tâche de fond et suivis en direct (SSE).
 *   startScan({ mode: 'jira'|'demo', projectKey, jql, user, fromUrl }) → job
 *   fromUrl (scan lancé depuis une URL collée, voir url.mjs) : { url, kind, boardId, filterId, issueKey }
 *     → la JQL enregistrée dans les réglages est ignorée (l'URL désigne le périmètre) et, en cas de succès,
 *       la clé projet est retenue dans les réglages.
 *   getJob(id) → job | null ; job.subscribe(fn) rejoue les événements passés puis suit les nouveaux.
 * Événements : progress { phase, message, loaded, total, percent }, done { scan, summary }, error { message, hint, code }.
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import { createJiraClient, JiraError } from './client.mjs'
import { discoverFields, searchFields } from './fields.mjs'
import { normalizeIssue, isEpic } from './normalize.mjs'
import { saveScanResult } from './stories.mjs'
import { loadSettings, saveSettings, proposedJql } from './settings.mjs'

const DEMO_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'conf', 'demo', 'irma-jira.json')
const JOB_TTL_MS = 30 * 60 * 1000
const MAX_STORIES = 5000

const jobs = new Map()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function createJob(mode, user) {
  const listeners = new Set()
  const job = {
    id: crypto.randomUUID(),
    mode,
    user,
    status: 'running',
    startedAt: new Date().toISOString(),
    events: [],
    emit(event, data) {
      const entry = { event, data: { ...data, at: new Date().toISOString() } }
      job.events.push(entry)
      for (const fn of listeners) fn(entry)
    },
    subscribe(fn) {
      for (const e of job.events) fn(e)
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
  jobs.set(job.id, job)
  return job
}

function pruneJobs() {
  const limit = Date.now() - JOB_TTL_MS
  for (const [id, job] of jobs) {
    if (job.status !== 'running' && new Date(job.startedAt).getTime() < limit) jobs.delete(id)
  }
}

export function getJob(id) {
  return jobs.get(id) || null
}

export function runningJob() {
  return [...jobs.values()].find((j) => j.status === 'running') || null
}

function progress(job, phase, message, loaded = 0, total = null) {
  const percent = total ? Math.min(100, Math.round((loaded / total) * 100)) : null
  job.emit('progress', { phase, message, loaded, total, percent })
}

function summarize(stories, epics) {
  return {
    stories: stories.length,
    withCriteria: stories.filter((s) => s.acceptanceCriteria.length).length,
    epics: epics.length,
    fromField: stories.filter((s) => s.acceptanceCriteriaSource === 'field').length,
    fromDescription: stories.filter((s) => s.acceptanceCriteriaSource === 'description').length,
  }
}

// ---------------------------------------------------------------- démonstration

async function scanDemo(job) {
  const demo = JSON.parse(fs.readFileSync(DEMO_FILE, 'utf8'))
  progress(job, 'connect', `Connexion au JIRA de démonstration (${demo.serverInfo.serverTitle}, version ${demo.serverInfo.version})`)
  await sleep(300)
  const map = discoverFields(demo.fields)
  progress(job, 'fields', `Champs détectés : critères d’acceptation « ${map.acceptance?.name || 'aucun'} », lien d’épopée « ${map.epicLink?.name || 'aucun'} », story points « ${map.storyPoints?.name || 'aucun'} »`)
  await sleep(300)
  const jql = proposedJql({ projectKey: demo.project.key, issueTypes: ['Story', 'Récit'] })
  const total = demo.issues.length
  progress(job, 'search', `Recherche JQL : ${jql}`, 0, total)
  const epicSummaries = new Map(demo.epics.map((e) => [e.key, e.fields.summary]))
  const ctx = { baseUrl: demo.baseUrl, map, epicSummaries, source: 'demo' }
  const stories = []
  for (let i = 0; i < total; i += 4) {
    await sleep(220)
    stories.push(...demo.issues.slice(i, i + 4).map((issue) => normalizeIssue(issue, ctx)))
    progress(job, 'search', `${stories.length} récit(s) sur ${total} lus et analysés`, stories.length, total)
  }
  const epics = demo.epics.map((e) => ({ key: e.key, summary: e.fields.summary, status: e.fields.status?.name || '' }))
  return { stories, epics, jql, projectKey: demo.project.key, baseUrl: demo.baseUrl, deployment: 'server', fields: map }
}

// ---------------------------------------------------------------- JIRA réel

/** Types d'issues configurés qui existent vraiment dans le projet (évite l'erreur JQL « valeur inexistante »). */
async function resolveIssueTypes(client, projectKey, wanted) {
  const project = await client.project(projectKey)
  const available = project.issueTypes || []
  const lower = wanted.map((w) => w.toLowerCase())
  const found = available.filter((t) => lower.includes(String(t.name).toLowerCase()) || /^(story|r[ée]cit|user story)$/i.test(t.name))
  return { project, types: found }
}

const ISSUE_KEY_RE = /^[A-Z][A-Z0-9_]*-\d+$/i

async function fetchEpicSummaries(client, allKeys) {
  const map = new Map()
  // Seules des clés d'issue bien formées entrent dans la JQL (pas d'injection depuis un champ personnalisé).
  const keys = allKeys.filter((k) => ISSUE_KEY_RE.test(k))
  for (let i = 0; i < keys.length; i += 50) {
    const chunk = keys.slice(i, i + 50)
    for await (const page of client.search(`key in (${chunk.join(',')})`, ['summary', 'status', 'issuetype'])) {
      for (const issue of page.issues) map.set(issue.key, { summary: issue.fields?.summary || '', status: issue.fields?.status?.name || '' })
    }
  }
  return map
}

/** Tableau agile → clé projet (emplacement du tableau) ou, à défaut, JQL de son filtre. */
async function resolveBoard(client, boardId) {
  try {
    const board = await client.request(`/rest/agile/1.0/board/${encodeURIComponent(boardId)}`)
    const key = String(board?.location?.projectKey || '').toUpperCase()
    if (/^[A-Z][A-Z0-9_]{1,19}$/.test(key)) return { projectKey: key, name: board.name || '' }
  } catch { /* API agile indisponible : on tente la configuration */ }
  try {
    const conf = await client.request(`/rest/agile/1.0/board/${encodeURIComponent(boardId)}/configuration`)
    const id = String(conf?.filter?.id || '')
    if (/^-?\d+$/.test(id)) return { jql: `filter = ${id} ORDER BY key ASC`, name: conf.name || '' }
  } catch { /* ignoré : message explicite plus bas */ }
  throw new JiraError(`Tableau ${boardId} introuvable ou inaccessible.`, { code: 'CONFIG', hint: 'Vérifiez que votre compte voit ce tableau, ou collez l’URL d’un ticket du projet (…/browse/CLE-1).' })
}

async function scanJira(job, { projectKey, jql: customJql, fromUrl }) {
  const { settings } = loadSettings()
  let key = (projectKey || (fromUrl ? '' : settings.projectKey) || '').toUpperCase()
  progress(job, 'connect', `Connexion à ${settings.baseUrl || 'JIRA'}…`)
  const client = await createJiraClient(settings)
  const me = await client.myself()
  progress(job, 'connect', `Connecté à JIRA ${client.deployment === 'cloud' ? 'Cloud' : 'Server / Data Center'} en tant que ${me.displayName || me.name || me.emailAddress || 'utilisateur'}`)

  const map = discoverFields(await client.fields(), { acceptanceField: settings.acceptanceField })
  progress(job, 'fields', `Champs détectés : critères d’acceptation « ${map.acceptance?.name || 'aucun (lecture de la description)'} », lien d’épopée « ${map.epicLink?.name || (client.deployment === 'cloud' ? 'parent' : 'aucun')} », story points « ${map.storyPoints?.name || 'aucun'} »`)

  // Depuis une URL : le périmètre vient de l'adresse, jamais de la JQL enregistrée pour un autre projet.
  let jql = (customJql || (fromUrl ? '' : settings.jql) || '').trim()
  if (!jql && fromUrl?.filterId) jql = `filter = ${fromUrl.filterId} ORDER BY key ASC`
  if (!jql && !key && fromUrl?.boardId) {
    progress(job, 'search', `Lecture du tableau ${fromUrl.boardId}…`)
    const b = await resolveBoard(client, fromUrl.boardId)
    if (b.projectKey) key = b.projectKey
    else jql = b.jql
    progress(job, 'search', `Tableau ${fromUrl.boardId}${b.name ? ` « ${b.name} »` : ''} : ${b.projectKey ? `projet ${b.projectKey}` : jql}`)
  }
  if (!jql) {
    if (!key) throw new JiraError('Clé projet manquante.', { code: 'CONFIG', hint: 'Renseignez la clé du projet JIRA (par exemple P0326) ou une requête JQL personnalisée.' })
    const { types } = await resolveIssueTypes(client, key, settings.issueTypes)
    if (!types.length) throw new JiraError(`Aucun type « ${settings.issueTypes.join(' / ')} » dans le projet ${key}.`, { code: 'CONFIG', hint: 'Indiquez dans les réglages les types d’issues qui portent vos récits (par exemple Story, Récit, Évolution).' })
    jql = `project = "${key}" AND issuetype in (${types.map((t) => t.id).join(', ')}) ORDER BY key ASC`
  }
  const approx = await client.count(jql)
  progress(job, 'search', `Recherche JQL : ${jql}`, 0, approx)

  const raw = []
  for await (const page of client.search(jql, searchFields(map))) {
    raw.push(...page.issues)
    const total = page.total ?? approx
    progress(job, 'search', `${raw.length} issue(s) lue(s)${total ? ` sur ${total}` : ''}`, raw.length, total)
    if (raw.length >= MAX_STORIES) {
      progress(job, 'search', `Limite de ${MAX_STORIES} récits atteinte : affinez la requête JQL pour la suite.`, raw.length, raw.length)
      break
    }
  }
  const storiesRaw = raw.filter((i) => !isEpic(i))
  const epicKeys = new Set(raw.filter(isEpic).map((i) => i.key))
  if (map.epicLink?.id) for (const i of storiesRaw) if (typeof i.fields?.[map.epicLink.id] === 'string') epicKeys.add(i.fields[map.epicLink.id])
  for (const i of storiesRaw) if (i.fields?.parent && /^(epic|[ée]pop[ée]e)$/i.test(i.fields.parent.fields?.issuetype?.name || '')) epicKeys.add(i.fields.parent.key)

  progress(job, 'epics', `Lecture de ${epicKeys.size} épopée(s)…`, raw.length, raw.length)
  const epicInfo = epicKeys.size ? await fetchEpicSummaries(client, [...epicKeys]).catch(() => new Map()) : new Map()
  const epicSummaries = new Map([...epicInfo].map(([k, v]) => [k, v.summary]))
  const ctx = { baseUrl: client.baseUrl, map, epicSummaries, source: 'jira' }
  const stories = storiesRaw.map((i) => normalizeIssue(i, ctx))
  const epics = [...epicKeys].map((k) => ({ key: k, summary: epicInfo.get(k)?.summary || '', status: epicInfo.get(k)?.status || '' }))
  return { stories, epics, jql, projectKey: key || '', baseUrl: client.baseUrl, deployment: client.deployment, fields: map }
}

// ---------------------------------------------------------------- lancement

export function startScan({ mode = 'demo', projectKey, jql, user, fromUrl = null } = {}) {
  pruneJobs()
  const job = createJob(mode, user)
  const started = Date.now()
  ;(async () => {
    try {
      const result = mode === 'jira' ? await scanJira(job, { projectKey, jql, fromUrl }) : await scanDemo(job)
      progress(job, 'save', 'Extraction des critères d’acceptation et enregistrement…', result.stories.length, result.stories.length)
      const scan = saveScanResult({
        scan: {
          scannedAt: new Date().toISOString(),
          projectKey: result.projectKey,
          jql: result.jql,
          source: mode === 'jira' ? 'jira' : 'demo',
          baseUrl: result.baseUrl,
          deployment: result.deployment,
          fields: result.fields,
          durationMs: Date.now() - started,
          user: user || '',
          url: fromUrl?.url || '',
          urlKind: fromUrl?.kind || '',
        },
        stories: result.stories,
        epics: result.epics,
      })
      // Scan réussi depuis une URL : l'instance et le projet deviennent les réglages par défaut.
      if (mode === 'jira' && fromUrl && result.projectKey) {
        try {
          saveSettings({ baseUrl: result.baseUrl, projectKey: result.projectKey })
        } catch (e) {
          console.error('[jira] enregistrement du projet scanné :', e.message)
        }
      }
      job.status = 'done'
      job.emit('done', { scan, summary: summarize(result.stories, result.epics) })
    } catch (e) {
      job.status = 'error'
      const known = e instanceof JiraError
      if (!known) console.error('[jira] scan :', e)
      job.emit('error', { message: known ? e.message : `Erreur inattendue pendant le scan : ${e.message}`, hint: e.hint || '', code: e.code || '' })
    }
  })()
  return job
}

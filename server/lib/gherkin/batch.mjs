/**
 * Génération par lot, exécutée en tâche de fond et suivie en direct (SSE).
 *   startBatch({ keys, mode, provider, overwrite, user }) → job
 *   getBatch(id) → job | null ; job.subscribe(fn) rejoue les événements passés puis suit les nouveaux.
 * Événements : start { total, mode }, item { key, index, total, state: 'running'|'done'|'skipped'|'failed', … },
 *              done { summary }, error { message }.
 */
import crypto from 'crypto'
import { getStory } from '../jira/stories.mjs'
import { generateForStory, withGenerationLock } from './service.mjs'
import { readEntry } from './store.mjs'

const JOB_TTL_MS = 30 * 60 * 1000
const jobs = new Map()

function createJob(meta) {
  const listeners = new Set()
  const job = {
    id: crypto.randomUUID(),
    ...meta,
    status: 'running',
    startedAt: new Date().toISOString(),
    controller: new AbortController(),
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

function prune() {
  const limit = Date.now() - JOB_TTL_MS
  for (const [id, job] of jobs) {
    if (job.status !== 'running' && new Date(job.startedAt).getTime() < limit) jobs.delete(id)
  }
}

export const getBatch = (id) => jobs.get(id) || null
export const runningBatch = () => [...jobs.values()].find((j) => j.status === 'running') || null

export function cancelBatch(id) {
  const job = jobs.get(id)
  if (!job || job.status !== 'running') return false
  job.controller.abort()
  return true
}

async function processOne(job, key, index, total, counts) {
  const base = { key, index: index + 1, total }
  const story = getStory(key)
  if (!story) {
    counts.failed += 1
    return job.emit('item', { ...base, state: 'failed', message: 'Récit introuvable (relancez le scan).' })
  }
  const existing = readEntry(key)
  if (existing && (existing.status === 'validated' || !job.overwrite)) {
    counts.skipped += 1
    return job.emit('item', { ...base, state: 'skipped', message: existing.status === 'validated' ? 'Déjà validé : conservé.' : 'Brouillon existant : conservé.' })
  }
  job.emit('item', { ...base, state: 'running', summary: story.summary })
  let r
  try {
    r = await withGenerationLock(key, () => generateForStory(story, { mode: job.mode, provider: job.provider, user: job.user, signal: job.controller.signal }))
  } catch (e) {
    // Une erreur sur un récit (fichier verrouillé…) ne doit pas interrompre tout le lot.
    console.error(`[gherkin] génération par lot, ${key} :`, e)
    r = { ok: false, error: `Erreur inattendue : ${e.message || e}` }
  }
  if (!r) {
    counts.skipped += 1
    return job.emit('item', { ...base, state: 'skipped', message: 'Génération déjà en cours depuis la page : conservée.' })
  }
  if (!r.ok) {
    counts.failed += 1
    const message = r.aborted || job.controller.signal.aborted ? 'Annulé à la demande.'
      : r.manual ? `Aucun assistant IA disponible (${r.reason}).` : r.error
    return job.emit('item', { ...base, state: 'failed', message })
  }
  counts.done += 1
  if (r.usedMode === 'template') counts.template += 1
  else counts.llm += 1
  job.emit('item', {
    ...base,
    state: 'done',
    usedMode: r.usedMode,
    provider: r.provider,
    scenarios: r.analysis.scenarios,
    errors: r.analysis.counts.error,
    warnings: r.analysis.counts.warning,
    message: r.notice || '',
  })
}

async function run(job) {
  const counts = { done: 0, skipped: 0, failed: 0, llm: 0, template: 0 }
  const total = job.keys.length
  job.emit('start', { total, mode: job.mode })
  try {
    for (let i = 0; i < total; i++) {
      if (job.controller.signal.aborted) {
        job.status = 'cancelled'
        job.emit('done', { summary: { ...counts, total, cancelled: true, remaining: total - i } })
        return
      }
      await processOne(job, job.keys[i], i, total, counts)
    }
    job.status = 'done'
    job.emit('done', { summary: { ...counts, total, cancelled: false, remaining: 0 } })
  } catch (e) {
    job.status = 'failed'
    console.error('[gherkin] génération par lot :', e)
    job.emit('error', { message: e.message || String(e) })
  }
}

export function startBatch({ keys, mode, provider, overwrite = false, user }) {
  prune()
  const job = createJob({ keys, mode, provider, overwrite, user })
  setImmediate(() => run(job))
  return job
}

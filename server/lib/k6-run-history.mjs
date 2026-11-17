/**
 * Historique V2 des exécutions k6 : CONF_DIR/k6-history/runs.json (500 entrées max).
 * Les runs V3 (server/lib/perf) y sont aussi consignés avec leurs métriques mesurées
 * (summary.measured = true) pour que l'arbre des campagnes reste juste.
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { CONF_DIR, REPO_ROOT } from './paths.mjs'
import { writeJsonAtomic } from './perf/store.mjs'

const HISTORY_DIR = path.join(CONF_DIR, 'k6-history')
const RUNS_FILE = path.join(HISTORY_DIR, 'runs.json')
const MAX_RUNS = 500

/** Statuts qui correspondent à une exécution réelle (hors simple « configuré »). */
export const EXECUTED_STATUSES = new Set(['success', 'passed', 'failed', 'thresholds_failed', 'error', 'stopped'])

function writeRuns(data) {
  writeJsonAtomic(RUNS_FILE, data)
}

function readRuns() {
  if (!fs.existsSync(RUNS_FILE)) return { version: 1, runs: [] }
  try {
    const data = JSON.parse(fs.readFileSync(RUNS_FILE, 'utf8'))
    return { version: 1, ...data, runs: Array.isArray(data.runs) ? data.runs : [] }
  } catch {
    return { version: 1, runs: [] }
  }
}

export function listK6RunHistory({ limit = 100, profileId = null, executedOnly = false } = {}) {
  const { runs } = readRuns()
  let list = [...runs].sort((a, b) => String(b.runAt).localeCompare(String(a.runAt)))
  if (profileId) list = list.filter((r) => r.profileId === profileId)
  if (executedOnly) list = list.filter((r) => EXECUTED_STATUSES.has(r.status))
  return list.slice(0, limit)
}

function normalizeRun(entry) {
  return {
    id: entry.id || crypto.randomUUID(),
    profileId: entry.profileId || null,
    profileName: entry.profileName || '',
    campaignName: entry.campaignName || '',
    runAt: entry.runAt || new Date().toISOString(),
    status: entry.status || 'unknown',
    command: entry.command || '',
    environment: entry.environment || '',
    objective: entry.objective || '',
    summary: entry.summary || {},
    reportPath: entry.reportPath || '',
    notes: entry.notes || '',
    triggeredBy: entry.triggeredBy || 'wizard',
  }
}

/** Ajoute (ou remplace, à identifiant égal) une entrée d'historique. */
export function appendK6Run(entry = {}) {
  const data = readRuns()
  const run = normalizeRun(entry)
  const idx = data.runs.findIndex((r) => r.id === run.id)
  if (idx >= 0) data.runs[idx] = run
  else data.runs.push(run)
  if (data.runs.length > MAX_RUNS) data.runs = data.runs.slice(-MAX_RUNS)
  writeRuns(data)
  return run
}

export function deleteK6Run(id) {
  const data = readRuns()
  data.runs = data.runs.filter((r) => r.id !== id)
  writeRuns(data)
  return { ok: true }
}

export function exportK6History() {
  const data = readRuns()
  return {
    format: 'wizard-qa-k6-history',
    version: 1,
    exportedAt: new Date().toISOString(),
    runs: data.runs,
  }
}

/**
 * Import d'un historique exporté.
 * merge = true : les entrées déjà présentes (même id) sont conservées telles quelles.
 * merge = false : elles sont remplacées par celles du lot importé.
 */
export function importK6History(bundle, { merge = true } = {}) {
  if (!bundle || bundle.format !== 'wizard-qa-k6-history' || !Array.isArray(bundle.runs)) {
    throw new Error('Bundle invalide — format wizard-qa-k6-history attendu')
  }
  const data = readRuns()
  const byId = new Map(data.runs.map((r, i) => [r.id, i]))
  let added = 0
  let replaced = 0
  for (const raw of bundle.runs) {
    const run = normalizeRun(raw)
    if (byId.has(run.id)) {
      if (merge) continue
      data.runs[byId.get(run.id)] = run
      replaced += 1
      continue
    }
    byId.set(run.id, data.runs.length)
    data.runs.push(run)
    added += 1
  }
  if (data.runs.length > MAX_RUNS) data.runs = data.runs.slice(-MAX_RUNS)
  writeRuns(data)
  return { added, replaced, total: data.runs.length }
}

export function getHistoryDirRelative() {
  return path.relative(REPO_ROOT, HISTORY_DIR).replace(/\\/g, '/')
}

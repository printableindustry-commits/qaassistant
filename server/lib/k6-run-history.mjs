import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { CONF_DIR, REPO_ROOT } from './paths.mjs'

const HISTORY_DIR = path.join(CONF_DIR, 'k6-history')
const RUNS_FILE = path.join(HISTORY_DIR, 'runs.json')

function ensureHistoryDir() {
  fs.mkdirSync(HISTORY_DIR, { recursive: true })
  if (!fs.existsSync(RUNS_FILE)) {
    fs.writeFileSync(RUNS_FILE, `${JSON.stringify({ version: 1, runs: [] }, null, 2)}\n`, 'utf8')
  }
}

function readRuns() {
  ensureHistoryDir()
  try {
    return JSON.parse(fs.readFileSync(RUNS_FILE, 'utf8'))
  } catch {
    return { version: 1, runs: [] }
  }
}

function writeRuns(data) {
  ensureHistoryDir()
  fs.writeFileSync(RUNS_FILE, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

export function listK6RunHistory({ limit = 100, profileId = null } = {}) {
  const { runs } = readRuns()
  let list = [...runs].sort((a, b) => String(b.runAt).localeCompare(String(a.runAt)))
  if (profileId) list = list.filter((r) => r.profileId === profileId)
  return list.slice(0, limit)
}

export function appendK6Run(entry = {}) {
  ensureHistoryDir()
  const data = readRuns()
  const run = {
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
  data.runs = data.runs || []
  data.runs.push(run)
  if (data.runs.length > 500) {
    data.runs = data.runs.slice(-500)
  }
  writeRuns(data)
  return run
}

export function deleteK6Run(id) {
  const data = readRuns()
  data.runs = (data.runs || []).filter((r) => r.id !== id)
  writeRuns(data)
  return { ok: true }
}

export function exportK6History() {
  const data = readRuns()
  return {
    format: 'wizard-qa-k6-history',
    version: 1,
    exportedAt: new Date().toISOString(),
    runs: data.runs || [],
  }
}

export function importK6History(bundle, { merge = true } = {}) {
  if (!bundle || bundle.format !== 'wizard-qa-k6-history' || !Array.isArray(bundle.runs)) {
    throw new Error('Bundle invalide — format wizard-qa-k6-history attendu')
  }
  const data = readRuns()
  const existingIds = new Set((data.runs || []).map((r) => r.id))
  let added = 0
  for (const run of bundle.runs) {
    if (!merge && existingIds.has(run.id)) continue
    if (merge && existingIds.has(run.id)) continue
    data.runs.push(run)
    existingIds.add(run.id)
    added += 1
  }
  if (data.runs.length > 500) data.runs = data.runs.slice(-500)
  writeRuns(data)
  return { added, total: data.runs.length }
}

export function getHistoryDirRelative() {
  return path.relative(REPO_ROOT, HISTORY_DIR).replace(/\\/g, '/')
}

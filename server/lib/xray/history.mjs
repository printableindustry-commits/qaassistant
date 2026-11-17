/**
 * Historique des envois : <REPO_ROOT>/.wizard-qa/xray/pushed.json
 *   { version: 1, entries: [{ id, storyKey, sourceKind, sessionId, testKey, testId, testUrl, storyUrl, planKey,
 *                             linked, simulated, mode, testType, summary, pushedAt, updatedAt, by, pushCount }] }
 * Une entrée par récit + source + (réel | simulé) : un nouvel envoi met à jour l'entrée existante.
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { REPO_ROOT } from '../paths.mjs'
import { writeAtomic } from '../jira/stories.mjs'

export const XRAY_DATA_DIR = path.join(REPO_ROOT, '.wizard-qa', 'xray')
const FILE = path.join(XRAY_DATA_DIR, 'pushed.json')
const MAX_ENTRIES = 2000

function load() {
  try {
    const data = JSON.parse(fs.readFileSync(FILE, 'utf8'))
    return Array.isArray(data?.entries) ? data.entries : []
  } catch {
    return []
  }
}

function save(entries) {
  writeAtomic(FILE, { version: 1, entries: entries.slice(0, MAX_ENTRIES) })
}

/** Envois (les plus récents d'abord), filtrés par récit. */
export function listPushed({ storyKey, limit } = {}) {
  let list = load()
  if (storyKey) list = list.filter((e) => e.storyKey === String(storyKey).toUpperCase())
  list.sort((a, b) => String(b.updatedAt || b.pushedAt).localeCompare(String(a.updatedAt || a.pushedAt)))
  return limit ? list.slice(0, limit) : list
}

/** Dernier envoi pour ce récit et cette source (réel ou simulé). */
export function findPushed(storyKey, sourceKind, simulated) {
  return listPushed({ storyKey }).find((e) => e.sourceKind === sourceKind && Boolean(e.simulated) === Boolean(simulated)) || null
}

/** Prochain numéro de clé simulée « <PROJET>-T<n> ». */
export function nextSimulatedKey(projectKey) {
  const re = new RegExp(`^${projectKey}-T(\\d+)$`)
  const max = load().reduce((m, e) => {
    const n = Number(String(e.testKey || '').match(re)?.[1] || 0)
    return n > m ? n : m
  }, 0)
  return `${projectKey}-T${max + 1}`
}

/** Ajoute ou met à jour une entrée (même id si `replaceId`). */
export function recordPush(data, replaceId) {
  const entries = load()
  const now = new Date().toISOString()
  const idx = replaceId ? entries.findIndex((e) => e.id === replaceId) : -1
  if (idx >= 0) {
    const prev = entries[idx]
    entries[idx] = { ...prev, ...data, id: prev.id, pushedAt: prev.pushedAt, updatedAt: now, pushCount: (prev.pushCount || 1) + 1 }
    save(entries)
    return entries[idx]
  }
  const entry = { id: crypto.randomUUID(), ...data, pushedAt: now, updatedAt: now, pushCount: 1 }
  entries.unshift(entry)
  save(entries)
  return entry
}

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { CONF_DIR, REPO_ROOT } from './paths.mjs'
import { applyK6ProfileToProject } from './k6-perf-generator.mjs'
import { getK6OnboardingContext } from './k6-onboarding-context.mjs'

const PROFILES_DIR = path.join(CONF_DIR, 'k6-profiles')
const INDEX_FILE = path.join(PROFILES_DIR, 'index.json')

function ensureProfilesDir() {
  fs.mkdirSync(PROFILES_DIR, { recursive: true })
  if (!fs.existsSync(INDEX_FILE)) {
    fs.writeFileSync(INDEX_FILE, `${JSON.stringify({ version: 1, profiles: [] }, null, 2)}\n`, 'utf8')
  }
}

function readIndex() {
  ensureProfilesDir()
  try {
    return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'))
  } catch {
    return { version: 1, profiles: [] }
  }
}

function writeIndex(data) {
  ensureProfilesDir()
  fs.writeFileSync(INDEX_FILE, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

function profilePath(id) {
  return path.join(PROFILES_DIR, `${id}.profile.json`)
}

export function listK6Profiles() {
  const index = readIndex()
  const profiles = []
  for (const entry of index.profiles || []) {
    const file = profilePath(entry.id)
    if (!fs.existsSync(file)) continue
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'))
      profiles.push({
        id: data.id,
        name: data.name,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
        campaignObjective: data.answers?.campaignObjective || '',
        environment: data.answers?.environment || '',
        baseUrl: data.answers?.baseUrl || '',
      })
    } catch { /* skip corrupt */ }
  }
  return profiles.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
}

export function getK6Profile(id) {
  const file = profilePath(id)
  if (!fs.existsSync(file)) return null
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function buildProfileMeta(answers = {}, existingMeta = {}) {
  const ctx = getK6OnboardingContext()
  const folderPath = existingMeta.folderPath
    || answers.folderPath
    || ctx.gitRepository
    || REPO_ROOT
  const sourceType = existingMeta.sourceType
    || answers.sourceType
    || (fs.existsSync(path.join(folderPath, '.git')) ? 'GIT' : 'FOLDER')
  return {
    tribu: existingMeta.tribu || answers.tribu || ctx.tribu || '',
    productCode: existingMeta.productCode || answers.productCode || ctx.productCode || '',
    solutionCode: existingMeta.solutionCode || answers.solutionCode || ctx.solutionCode || '',
    applicationLabel: existingMeta.applicationLabel || answers.applicationLabel || ctx.applicationLabel || '',
    folderPath,
    relativePath: existingMeta.relativePath || answers.relativePath || folderPath,
    sourceType,
  }
}

export function saveK6Profile({ id, name, answers, notes = '', meta = null, incremental = false }) {
  ensureProfilesDir()
  const now = new Date().toISOString()
  const profileId = id || crypto.randomUUID()
  const existing = id ? getK6Profile(id) : null
  const mergedAnswers = incremental && existing
    ? { ...existing.answers, ...(answers || {}) }
    : { ...(existing?.answers || {}), ...(answers || {}) }
  const profileMeta = buildProfileMeta(mergedAnswers, { ...(existing?.meta || {}), ...(meta || {}) })
  const profile = {
    id: profileId,
    name: String(name || existing?.name || 'Profil k6').trim() || 'Profil k6',
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    answers: mergedAnswers,
    meta: profileMeta,
    notes: notes || existing?.notes || '',
    wizardVersion: 1,
  }
  fs.writeFileSync(profilePath(profileId), `${JSON.stringify(profile, null, 2)}\n`, 'utf8')
  const index = readIndex()
  const profiles = index.profiles || []
  const idx = profiles.findIndex((p) => p.id === profileId)
  const indexEntry = { id: profileId, name: profile.name, updatedAt: now }
  if (idx >= 0) profiles[idx] = indexEntry
  else profiles.push(indexEntry)
  writeIndex({ ...index, profiles })
  return profile
}

export function deleteK6Profile(id) {
  if (!id || typeof id !== 'string') throw new Error('Identifiant de profil requis')
  const file = profilePath(id)
  const hadFile = fs.existsSync(file)
  if (hadFile) fs.unlinkSync(file)
  const index = readIndex()
  const before = (index.profiles || []).length
  index.profiles = (index.profiles || []).filter((p) => p.id !== id)
  const removedFromIndex = before > index.profiles.length
  writeIndex(index)
  if (!hadFile && !removedFromIndex) throw new Error('Profil introuvable')
  return {
    ok: true,
    id,
    fileDeleted: hadFile,
    removedFromIndex,
    profileFile: path.relative(REPO_ROOT, file).replace(/\\/g, '/'),
  }
}

export function duplicateK6Profile(id, newName) {
  const src = getK6Profile(id)
  if (!src) throw new Error('Profil introuvable')
  return saveK6Profile({
    name: newName || `${src.name} (copie)`,
    answers: { ...src.answers },
    notes: src.notes,
  })
}

export function exportK6Profiles(profileIds = null) {
  const all = listK6Profiles()
  const ids = profileIds?.length ? profileIds : all.map((p) => p.id)
  const profiles = ids.map((id) => getK6Profile(id)).filter(Boolean)
  return {
    format: 'wizard-qa-k6-profiles',
    version: 1,
    exportedAt: new Date().toISOString(),
    profiles,
  }
}

export function importK6Profiles(bundle, { merge = true } = {}) {
  if (!bundle || bundle.format !== 'wizard-qa-k6-profiles' || !Array.isArray(bundle.profiles)) {
    throw new Error('Bundle invalide — format wizard-qa-k6-profiles attendu')
  }
  const imported = []
  for (const p of bundle.profiles) {
    if (!p.answers) continue
    const saved = saveK6Profile({
      id: merge ? undefined : p.id,
      name: p.name,
      answers: p.answers,
      notes: p.notes,
    })
    imported.push(saved.id)
  }
  return { imported, count: imported.length }
}

export function applyK6Profile(id) {
  const profile = getK6Profile(id)
  if (!profile) throw new Error('Profil introuvable')
  return applyK6ProfileToProject(profile)
}

export function getProfilesDirRelative() {
  return path.relative(REPO_ROOT, PROFILES_DIR).replace(/\\/g, '/')
}

/**
 * Informations projet des livrables (assistant pas à pas, contrat V3.2 §6.4).
 *
 *   getQuestionnaire()           → { version, steps: [{ id, title, help, fields: [...] }] }
 *   getProfile()                 → { values, updatedAt, updatedBy, demo, history }
 *   saveProfile(values, user)    → profil (fusion partielle ; null efface un champ ; HttpError 400 si invalide)
 *   applyDemoProfile(user)       → profil remplacé par le profil de démo IRMA
 *   prefillFromFacts(facts)      → { [champ]: valeur proposée } (champs avec `prefill`)
 *   profileHash(values?)         → sha256 stable des valeurs enregistrées
 *   completion(values?)          → { [étape]: pct } (champs requis renseignés, sinon tous les champs de l'étape)
 *   missingFields(docId, values?) → [{ field, label, step }] champs requis manquants pour un document
 *
 * Fichier : <REPO_ROOT>/.wizard-qa/livrables/profile.json
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { REPO_ROOT, SERVER_CONF_DIR } from '../paths.mjs'
import { writeAtomic } from '../jira/stories.mjs'
import { HttpError } from '../http/router.mjs'

const CONF = path.join(SERVER_CONF_DIR, 'livrables')
const FILE = path.join(REPO_ROOT, '.wizard-qa', 'livrables', 'profile.json')
const MAX_HISTORY = 20
const MAX_TEXT = { text: 300, textarea: 8000 }
const MAX_ITEMS = 100

let qCache = null

export function getQuestionnaire() {
  if (!qCache) qCache = JSON.parse(fs.readFileSync(path.join(CONF, 'questionnaire.json'), 'utf8'))
  return qCache
}

/** Champs à plat : [{ ...champ, step, stepTitle }] */
function allFields() {
  return getQuestionnaire().steps.flatMap((s) => s.fields.map((f) => ({ ...f, step: s.id, stepTitle: s.title })))
}

function emptyProfile() {
  return { version: 1, values: {}, updatedAt: null, updatedBy: '', demo: false, history: [] }
}

export function getProfile() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'))
    return { ...emptyProfile(), ...raw, values: raw?.values && typeof raw.values === 'object' ? raw.values : {} }
  } catch {
    return emptyProfile()
  }
}

// ------------------------------------------------------------------ validation

const cleanText = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max)

function cleanValue(f, v) {
  if (v === null || v === undefined || v === '') return null
  switch (f.type) {
    case 'text':
    case 'textarea':
      return cleanText(v, MAX_TEXT[f.type]) || null
    case 'number': {
      const n = Number(v)
      if (!Number.isFinite(n)) throw new HttpError(400, `« ${f.label} » : nombre attendu.`)
      return n
    }
    case 'select': {
      const s = cleanText(v, 200)
      if (f.options && !f.options.includes(s)) throw new HttpError(400, `« ${f.label} » : valeur « ${s} » non proposée.`)
      return s
    }
    case 'list': {
      const items = Array.isArray(v) ? v : String(v).split(/\r?\n/)
      const list = items.map((x) => cleanText(x, 500)).filter(Boolean).slice(0, MAX_ITEMS)
      return list.length ? list : null
    }
    case 'table': {
      if (!Array.isArray(v)) throw new HttpError(400, `« ${f.label} » : tableau de lignes attendu.`)
      const cols = (f.columns || []).map((c) => c.id)
      const rows = v.filter((r) => r && typeof r === 'object').slice(0, MAX_ITEMS)
        .map((r) => Object.fromEntries(cols.map((c) => [c, cleanText(r[c], 1000)])))
        .filter((r) => cols.some((c) => r[c]))
      return rows.length ? rows : null
    }
    default:
      return cleanText(v, 2000) || null
  }
}

const isFilled = (v) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)

function persist(profile) {
  writeAtomic(FILE, profile)
  return profile
}

/** Enregistre les valeurs fournies (fusion avec l'existant ; null ou vide efface le champ). */
export function saveProfile(values, user = '', { replace = false, demo = false } = {}) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new HttpError(400, 'Corps attendu : { values: { champ: valeur } }.')
  const fields = new Map(allFields().map((f) => [f.id, f]))
  const unknown = Object.keys(values).filter((k) => !fields.has(k))
  if (unknown.length) throw new HttpError(400, `Champ(s) inconnu(s) : ${unknown.join(', ')}.`)
  const current = getProfile()
  const next = replace ? {} : { ...current.values }
  const changed = []
  for (const [k, raw] of Object.entries(values)) {
    const v = cleanValue(fields.get(k), raw)
    if (JSON.stringify(v ?? null) !== JSON.stringify(next[k] ?? null)) changed.push(k)
    if (v === null) delete next[k]
    else next[k] = v
  }
  const at = new Date().toISOString()
  const by = String(user || '')
  const history = [{ at, by, fields: changed, demo: Boolean(demo) }, ...(current.history || [])].slice(0, MAX_HISTORY)
  return persist({ version: 1, values: next, updatedAt: at, updatedBy: by, demo: Boolean(demo) || (current.demo && !changed.length), history })
}

/** Remplit le profil avec les informations de démonstration IRMA (remplace les valeurs existantes). */
export function applyDemoProfile(user = '') {
  const demo = JSON.parse(fs.readFileSync(path.join(CONF, 'demo-profile.json'), 'utf8'))
  return saveProfile(demo.values || {}, user, { replace: true, demo: true })
}

// ------------------------------------------------------------------ préremplissage

function getPath(obj, p) {
  return String(p).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)
}

/** Vues dérivées des faits, utilisables par `prefill: 'facts.derived.<nom>'`. */
function derivedViews(facts) {
  const stories = facts.stories || []
  const level = { élevé: 0, moyen: 1, faible: 2 }
  const risky = stories.filter((s) => s.risk?.level === 'élevé' && s.triage !== 'skip')
    .sort((a, b) => level[a.risk.level] - level[b.risk.level] || b.risk.score - a.risk.score).slice(0, 15)
  const impactOf = (p) => (/critique|bloquant|highest|critical/i.test(p) ? 'Élevé' : /haute|high/i.test(p) ? 'Élevé' : /basse|low/i.test(p) ? 'Faible' : 'Moyen')
  const t = facts.tools || {}
  const nSpecs = facts.automation?.specs?.length || 0
  const nTests = (facts.automation?.specs || []).reduce((n, s) => n + (s.tests || 0), 0)
  return {
    inScope: (facts.epics || []).map((e) => `${e.key} — ${e.summary}`),
    outOfScope: stories.filter((s) => s.triage === 'skip').map((s) => `${s.key} — ${s.summary}${s.triageReason ? ` (${s.triageReason})` : ''}`),
    risks: risky.map((s) => ({
      risque: `Régression sur « ${s.summary} »`,
      source: `${s.key}${s.epicSummary ? ` — ${s.epicSummary}` : ''}`,
      probabilite: s.criteriaCount ? 'Moyenne' : 'Élevée',
      impact: impactOf(s.priority),
      niveau: s.risk.level,
      attenuation: s.gherkin.status === 'validated' ? 'Scénarios Gherkin validés, test automatisé à chaque campagne' : 'Scénarios à rédiger puis automatiser',
    })),
    environments: (facts.automation?.targets || []).map((x) => ({
      nom: x.name, url: x.baseUrl, navigateur: x.browser, comptes: `${x.accounts} compte(s) de test`, usage: 'Exploration et campagnes automatisées',
    })),
    tools: [
      'JIRA (récits)',
      t.xray?.configured ? 'Xray (gestion des tests)' : null,
      t.playwright ? `Playwright ${t.playwright.version}` : null,
      t.k6 ? `k6 ${t.k6.version}` : null,
      'Wizard QA',
    ].filter(Boolean),
    automationSummary: `Récits triés « À automatiser » : ${facts.triage?.todo || 0} ; scénarios Gherkin validés : ${facts.gherkin?.validated || 0} ; `
      + `${nSpecs} spec(s) Playwright (${nTests} test(s)) ; ${facts.automation?.sessions?.validated || 0} parcours explorés et validés. `
      + 'Les tests automatisés sont rejoués à chaque campagne d\'exécution.',
    perfSummary: facts.perf?.last
      ? `Performance : ${facts.perf.runs} run(s) k6, dernier profil « ${facts.perf.last.profile} » (p95 ${facts.perf.last.p95 ?? '?'} ms, verdict ${facts.perf.last.verdict}).`
      : '',
  }
}

/** Valeurs proposées depuis les faits pour les champs ayant un `prefill` (valeurs vides ignorées). */
export function prefillFromFacts(facts) {
  if (!facts) return {}
  const ctx = { facts: { ...facts, derived: derivedViews(facts) } }
  const out = {}
  for (const f of allFields()) {
    if (!f.prefill) continue
    let v
    try { v = getPath(ctx, f.prefill) } catch { v = undefined }
    if (f.type === 'list' && typeof v === 'string') v = [v]
    if (isFilled(v)) out[f.id] = v
  }
  return out
}

// ------------------------------------------------------------------ état

function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce((o, k) => { o[k] = stable(value[k]); return o }, {})
  return value
}

export function profileHash(values = getProfile().values) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(values || {}))).digest('hex')
}

export function completion(values = getProfile().values) {
  const out = {}
  for (const s of getQuestionnaire().steps) {
    const req = s.fields.filter((f) => f.required)
    const list = req.length ? req : s.fields
    out[s.id] = list.length ? Math.round((list.filter((f) => isFilled(values?.[f.id])).length / list.length) * 100) : 100
  }
  return out
}

export function missingFields(docId, values = getProfile().values) {
  return allFields()
    .filter((f) => f.required && (f.appliesTo || []).includes(docId) && !isFilled(values?.[f.id]))
    .map((f) => ({ field: f.id, label: f.label, step: f.stepTitle }))
}

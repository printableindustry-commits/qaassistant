/**
 * Cibles d'exploration (applications à tester) et comptes de démonstration (docs/V3-ARCHITECTURE.md §5.2).
 *
 *   listTargets()                   → cibles publiques (mots de passe masqués '••••••')
 *   getTarget(id, { withSecrets })  → cible (avec mots de passe en clair seulement si withSecrets)
 *   saveTargets(list) / upsertTarget(target) / deleteTarget(id)
 *   secretsFor(target, accountIds)  → { 'account:<id>:username': '…', 'account:<id>:password': '…' }
 *
 * Fichier : <CONF_DIR>/explore-targets.json (mode 0o600). Un mot de passe masqué renvoyé tel quel par
 * l'interface conserve la valeur enregistrée. La cible « Application de démo IRMA » est préinstallée :
 * son adresse est calculée à l'exécution (port courant du portail) et ses comptes sont ceux de /demo-app/.
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { CONF_DIR } from '../paths.mjs'
import { writeAtomic } from '../jira/stories.mjs'

export const TARGETS_FILE = path.join(CONF_DIR, 'explore-targets.json')
export const PASSWORD_MASK = '••••••'
export const DEMO_TARGET_ID = 'demo-irma'
const BROWSERS = ['msedge', 'chrome', 'chromium']
const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/
const MAX_TARGETS = 50
const MAX_ACCOUNTS = 20

let runtimePort = Number(process.env.PORTAIL_PORT) || 3920

/** Port réel du portail (connu à la première requête) : sert à l'adresse de l'application de démo. */
export function setRuntimePort(port) {
  const p = Number(port)
  if (Number.isInteger(p) && p > 0 && p < 65536) runtimePort = p
}

export function demoBaseUrl() {
  return `http://127.0.0.1:${runtimePort}/demo-app/`
}

// Comptes de l'application de démonstration (server/demo-app/app.js) : données publiques de démonstration.
const DEMO_ACCOUNTS = [
  { id: 'agent', label: 'Agent (profil Analyste)', username: 'agent', password: 'agent-demo-2026', notes: 'Consulte et déclare des risques ; ne peut pas valider une cotation.' },
  { id: 'gestionnaire', label: 'Gestionnaire (profil Valideur)', username: 'gestionnaire', password: 'gestion-demo-2026', notes: 'Valide les cotations, exporte la synthèse en PDF.' },
]

function demoTarget(stored) {
  return {
    id: DEMO_TARGET_ID,
    name: 'Application de démo IRMA',
    baseUrl: demoBaseUrl(),
    allowedOrigins: [],
    browser: stored && BROWSERS.includes(stored.browser) ? stored.browser : 'msedge',
    builtin: true,
    description: 'Application de démonstration servie par Wizard QA (analyse des risques métier) : connexion, tableau de bord, liste et déclaration de risques.',
    accounts: DEMO_ACCOUNTS.map((a) => ({ ...a })),
  }
}

// ---------- Lecture / écriture ----------
function readFile() {
  try {
    const data = JSON.parse(fs.readFileSync(TARGETS_FILE, 'utf8'))
    return data && Array.isArray(data.targets) ? data : { version: 1, targets: [] }
  } catch {
    return { version: 1, targets: [] }
  }
}

function writeFile(data) {
  writeAtomic(TARGETS_FILE, data, 0o600)
  try { fs.chmodSync(TARGETS_FILE, 0o600) } catch { /* sans effet sous Windows */ }
}

function allTargets() {
  const data = readFile()
  const storedDemo = data.targets.find((t) => t.id === DEMO_TARGET_ID)
  return [demoTarget(storedDemo), ...data.targets.filter((t) => t.id !== DEMO_TARGET_ID)]
}

function publicAccount(a) {
  return {
    id: a.id,
    label: a.label || a.id,
    username: a.username || '',
    password: a.password ? PASSWORD_MASK : '',
    passwordSet: Boolean(a.password),
    notes: a.notes || '',
  }
}

export function publicTarget(t) {
  if (!t) return null
  return {
    id: t.id,
    name: t.name,
    baseUrl: t.baseUrl,
    allowedOrigins: t.allowedOrigins || [],
    browser: t.browser || 'msedge',
    builtin: Boolean(t.builtin),
    description: t.description || '',
    accounts: (t.accounts || []).map(publicAccount),
    updatedAt: t.updatedAt || null,
  }
}

export function listTargets() {
  return allTargets().map(publicTarget)
}

export function getTarget(id, { withSecrets = false } = {}) {
  const t = allTargets().find((x) => x.id === String(id || ''))
  if (!t) return null
  return withSecrets ? JSON.parse(JSON.stringify(t)) : publicTarget(t)
}

// ---------- Validation ----------
function slug(text, fallback) {
  const s = String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '')
  return s || fallback
}

const clean = (v, max = 200) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max)

function cleanUrl(u, label) {
  const s = clean(u, 500)
  let url
  try { url = new URL(s) } catch { throw new Error(`${label} invalide : « ${s || 'vide'} » (exemple : https://recette.mon-appli.fr/).`) }
  if (!/^https?:$/.test(url.protocol)) throw new Error(`${label} : seules les adresses http(s) sont acceptées.`)
  return url.toString()
}

/** Normalise une cible saisie ; `previous` sert à conserver les mots de passe masqués. */
export function normalizeTarget(input, previous = null, taken = new Set()) {
  if (!input || typeof input !== 'object') throw new Error('Cible invalide.')
  const name = clean(input.name, 120)
  if (!name) throw new Error('Donnez un nom à l\'application à tester.')
  const baseUrl = cleanUrl(input.baseUrl, 'Adresse de l\'application')
  let id = clean(input.id, 40).toLowerCase()
  if (!id || !ID_RE.test(id)) {
    const base = slug(name, 'application')
    id = base
    for (let i = 2; taken.has(id); i++) id = `${base}-${i}`
  }
  const origins = (Array.isArray(input.allowedOrigins) ? input.allowedOrigins : String(input.allowedOrigins || '').split(/[\s,;]+/))
    .map((o) => clean(o, 300)).filter(Boolean).slice(0, 20)
    .map((o) => new URL(cleanUrl(o, 'Origine autorisée')).origin)
  // Origines nouvelles par rapport à la version enregistrée : un mot de passe masqué ne les suit pas
  // (sinon on pourrait rediriger la cible vers un autre serveur et y faire saisir le mot de passe enregistré).
  const originsOf = (t) => {
    const out = new Set()
    for (const u of [t?.baseUrl, ...(t?.allowedOrigins || [])]) { try { out.add(new URL(u).origin) } catch { /* ignorée */ } }
    return out
  }
  const prevOrigins = previous ? originsOf(previous) : null
  const movedTo = prevOrigins ? [...originsOf({ baseUrl, allowedOrigins: origins })].filter((o) => !prevOrigins.has(o)) : []
  const accounts = []
  const ids = new Set()
  for (const raw of (Array.isArray(input.accounts) ? input.accounts : []).slice(0, MAX_ACCOUNTS)) {
    if (!raw || typeof raw !== 'object') continue
    const label = clean(raw.label, 80)
    const username = clean(raw.username, 200)
    if (!label && !username) continue
    let aid = clean(raw.id, 30).toLowerCase()
    if (!aid || !ID_RE.test(aid)) aid = slug(label || username, 'compte').slice(0, 30)
    const baseId = aid
    for (let i = 2; ids.has(aid); i++) aid = `${baseId}-${i}`
    ids.add(aid)
    const prev = previous?.accounts?.find((a) => a.id === (raw.id || aid))
    let password = raw.password == null ? '' : String(raw.password)
    if (password === PASSWORD_MASK || (password.startsWith('••') && prev)) {
      if (prev?.password && movedTo.length) {
        throw new Error(`L'adresse de l'application a changé (${movedTo.join(', ')}) : ressaisissez le mot de passe du compte « ${label || username} ».`)
      }
      password = prev?.password || ''
    }
    if (password.length > 500) throw new Error(`Mot de passe trop long pour le compte « ${label || username} ».`)
    accounts.push({ id: aid, label: label || username, username, password, notes: clean(raw.notes, 300) })
  }
  return {
    id,
    name,
    baseUrl,
    allowedOrigins: [...new Set(origins)],
    browser: BROWSERS.includes(input.browser) ? input.browser : 'msedge',
    accounts,
    updatedAt: new Date().toISOString(),
  }
}

/** Remplace la liste des cibles personnalisées (la cible de démo ne garde que le choix du navigateur). */
export function saveTargets(list) {
  if (!Array.isArray(list)) throw new Error('Liste de cibles attendue.')
  if (list.length > MAX_TARGETS) throw new Error(`${MAX_TARGETS} cibles au maximum.`)
  const previous = readFile().targets
  const out = []
  const taken = new Set([DEMO_TARGET_ID])
  for (const t of list) {
    if (t && t.id === DEMO_TARGET_ID) {
      out.push({ id: DEMO_TARGET_ID, browser: BROWSERS.includes(t.browser) ? t.browser : 'msedge' })
      continue
    }
    const prev = previous.find((p) => p.id === t?.id) || null
    const n = normalizeTarget(t, prev, taken)
    taken.add(n.id)
    out.push(n)
  }
  writeFile({ version: 1, targets: out })
  return listTargets()
}

/** Crée ou met à jour une cible ; renvoie la cible publique. */
export function upsertTarget(input) {
  const data = readFile()
  if (input && input.id === DEMO_TARGET_ID) {
    const others = data.targets.filter((t) => t.id !== DEMO_TARGET_ID)
    writeFile({ version: 1, targets: [{ id: DEMO_TARGET_ID, browser: BROWSERS.includes(input.browser) ? input.browser : 'msedge' }, ...others] })
    return getTarget(DEMO_TARGET_ID)
  }
  if (data.targets.filter((t) => t.id !== DEMO_TARGET_ID).length >= MAX_TARGETS && !data.targets.some((t) => t.id === input?.id)) {
    throw new Error(`${MAX_TARGETS} cibles au maximum.`)
  }
  const prev = data.targets.find((t) => t.id === input?.id) || null
  const taken = new Set([DEMO_TARGET_ID, ...data.targets.filter((t) => t !== prev).map((t) => t.id)])
  const n = normalizeTarget(input, prev, taken)
  const targets = prev ? data.targets.map((t) => (t === prev ? n : t)) : [...data.targets, n]
  writeFile({ version: 1, targets })
  return getTarget(n.id)
}

export function deleteTarget(id) {
  if (id === DEMO_TARGET_ID) throw new Error('L\'application de démonstration ne peut pas être supprimée.')
  const data = readFile()
  const targets = data.targets.filter((t) => t.id !== id)
  if (targets.length === data.targets.length) return false
  writeFile({ version: 1, targets })
  return true
}

/** Secrets transmis au moteur navigateur (jamais à l'IA ni aux journaux). */
export function secretsFor(target, accountIds) {
  const out = {}
  const wanted = new Set(accountIds || [])
  for (const a of target?.accounts || []) {
    if (!wanted.has(a.id)) continue
    if (a.username) out[`account:${a.id}:username`] = a.username
    if (a.password) out[`account:${a.id}:password`] = a.password
  }
  return out
}

/** Empreinte courte (pour détecter un changement de comptes sans exposer les valeurs). */
export function accountsFingerprint(target) {
  return crypto.createHash('sha1').update(JSON.stringify((target?.accounts || []).map((a) => [a.id, a.username, a.password]))).digest('hex').slice(0, 12)
}

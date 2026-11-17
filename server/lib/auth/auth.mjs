/**
 * Authentification de l'application web.
 *
 * - Comptes : .wizard-qa/conf/users.json (mots de passe hachés scrypt + sel, jamais en clair).
 * - Au premier démarrage, un compte « demo / demo » (rôle admin) est créé pour la démonstration.
 *   L'écran Utilisateurs permet d'en créer d'autres et de supprimer le compte de démonstration.
 * - Sessions : jeton aléatoire dans un cookie HttpOnly SameSite=Lax, conservées dans
 *   .wizard-qa/conf/sessions.json (seule l'empreinte SHA-256 du jeton est écrite sur disque).
 * - Anti-force brute : 5 échecs par identifiant ou par adresse en 10 min → blocage 10 min.
 */
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { CONF_DIR } from '../paths.mjs'

export const SESSION_COOKIE = 'qa_sid'
const USERS_FILE = path.join(CONF_DIR, 'users.json')
const SESSIONS_FILE = path.join(CONF_DIR, 'sessions.json')
const SESSION_TTL_MS = 12 * 60 * 60 * 1000
const LOCK_WINDOW_MS = 10 * 60 * 1000
const MAX_FAILURES = 5
const ROLES = ['admin', 'user']

const failures = new Map()
let sessions = null

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 })
  fs.renameSync(tmp, file)
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex')
  return { salt, hash }
}

function verifyPassword(password, user) {
  const { hash } = hashPassword(password, user.salt)
  const a = Buffer.from(hash, 'hex')
  const b = Buffer.from(user.hash, 'hex')
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

const tokenDigest = (token) => crypto.createHash('sha256').update(String(token)).digest('hex')

function publicUser(u) {
  return {
    username: u.username,
    displayName: u.displayName || u.username,
    role: u.role,
    demo: Boolean(u.demo),
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt || null,
  }
}

function loadUsers() {
  const data = readJson(USERS_FILE, null)
  if (data && Array.isArray(data.users)) return data
  const seeded = {
    version: 1,
    users: [{
      username: 'demo',
      displayName: 'VERGER Rémy',
      role: 'admin',
      demo: true,
      createdAt: new Date().toISOString(),
      ...hashPassword('demo'),
    }],
  }
  writeJsonAtomic(USERS_FILE, seeded)
  return seeded
}

function saveUsers(data) {
  writeJsonAtomic(USERS_FILE, data)
}

function loadSessions() {
  if (sessions) return sessions
  const raw = readJson(SESSIONS_FILE, {})
  const now = Date.now()
  sessions = new Map(Object.entries(raw).filter(([, s]) => s && s.expiresAt > now))
  return sessions
}

function persistSessions() {
  writeJsonAtomic(SESSIONS_FILE, Object.fromEntries(loadSessions()))
}

function isLocked(key) {
  const f = failures.get(key)
  if (!f) return false
  if (Date.now() - f.first > LOCK_WINDOW_MS) {
    failures.delete(key)
    return false
  }
  return f.count >= MAX_FAILURES
}

function recordFailure(key) {
  const f = failures.get(key)
  if (!f || Date.now() - f.first > LOCK_WINDOW_MS) failures.set(key, { first: Date.now(), count: 1 })
  else f.count += 1
}

export function validateUsername(username) {
  const u = String(username || '').trim().toLowerCase()
  if (!/^[a-z0-9._-]{2,40}$/.test(u)) {
    throw new Error('Identifiant invalide (2 à 40 caractères : lettres, chiffres, point, tiret, souligné).')
  }
  return u
}

function validatePassword(password, { allowDemo = false } = {}) {
  const p = String(password || '')
  if (allowDemo && p === 'demo') return p
  if (p.length < 8) throw new Error('Le mot de passe doit contenir au moins 8 caractères.')
  return p
}

/** Ouvre une session. Renvoie { ok, token, user } ou { ok:false, error, status }. */
export function login(username, password, remoteAddress = '') {
  const u = String(username || '').trim().toLowerCase()
  const keys = [`u:${u}`, `ip:${remoteAddress}`]
  if (keys.some(isLocked)) {
    return { ok: false, status: 429, error: 'Trop de tentatives. Réessayez dans quelques minutes.' }
  }
  const data = loadUsers()
  const user = data.users.find((x) => x.username === u)
  // Toujours calculer un hachage pour ne pas révéler l'existence du compte par le temps de réponse.
  const valid = user ? verifyPassword(password, user) : (hashPassword(password), false)
  if (!valid) {
    keys.forEach(recordFailure)
    return { ok: false, status: 401, error: 'Identifiant ou mot de passe incorrect.' }
  }
  keys.forEach((k) => failures.delete(k))
  user.lastLoginAt = new Date().toISOString()
  saveUsers(data)

  const token = crypto.randomBytes(32).toString('base64url')
  loadSessions().set(tokenDigest(token), {
    username: user.username,
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS,
  })
  persistSessions()
  return { ok: true, token, user: publicUser(user) }
}

export function logout(token) {
  if (!token) return
  if (loadSessions().delete(tokenDigest(token))) persistSessions()
}

/** Utilisateur de la session (ou null). Prolonge la session à chaque usage. */
export function userFromToken(token) {
  if (!token) return null
  const all = loadSessions()
  const key = tokenDigest(token)
  const s = all.get(key)
  if (!s) return null
  if (s.expiresAt < Date.now()) {
    all.delete(key)
    persistSessions()
    return null
  }
  const user = loadUsers().users.find((x) => x.username === s.username)
  if (!user) {
    all.delete(key)
    persistSessions()
    return null
  }
  // Glissement : on ne réécrit le fichier que si l'échéance avance de plus d'une heure.
  const next = Date.now() + SESSION_TTL_MS
  if (next - s.expiresAt > 60 * 60 * 1000) {
    s.expiresAt = next
    persistSessions()
  }
  return publicUser(user)
}

export function parseCookies(header = '') {
  const out = {}
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}

export function sessionCookie(token, { secure = false } = {}) {
  const attrs = [`${SESSION_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${SESSION_TTL_MS / 1000}`]
  if (secure) attrs.push('Secure')
  return attrs.join('; ')
}

export function clearedSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
}

export function listUsers() {
  return loadUsers().users.map(publicUser)
}

export function createUser({ username, password, displayName, role = 'user' }) {
  const u = validateUsername(username)
  if (!ROLES.includes(role)) throw new Error('Rôle inconnu.')
  const data = loadUsers()
  if (data.users.some((x) => x.username === u)) throw new Error('Cet identifiant existe déjà.')
  data.users.push({
    username: u,
    displayName: String(displayName || '').trim() || u,
    role,
    createdAt: new Date().toISOString(),
    ...hashPassword(validatePassword(password)),
  })
  saveUsers(data)
  return publicUser(data.users.at(-1))
}

export function deleteUser(username, actingUser) {
  const u = String(username || '').toLowerCase()
  if (u === actingUser) throw new Error('Vous ne pouvez pas supprimer votre propre compte.')
  const data = loadUsers()
  const target = data.users.find((x) => x.username === u)
  if (!target) throw new Error('Utilisateur introuvable.')
  if (target.role === 'admin' && data.users.filter((x) => x.role === 'admin').length === 1) {
    throw new Error('Impossible de supprimer le dernier administrateur.')
  }
  data.users = data.users.filter((x) => x.username !== u)
  saveUsers(data)
  const all = loadSessions()
  for (const [k, s] of all) if (s.username === u) all.delete(k)
  persistSessions()
}

export function changePassword(username, currentPassword, newPassword) {
  const data = loadUsers()
  const user = data.users.find((x) => x.username === username)
  if (!user || !verifyPassword(currentPassword, user)) throw new Error('Mot de passe actuel incorrect.')
  Object.assign(user, hashPassword(validatePassword(newPassword)))
  delete user.demo
  saveUsers(data)
}

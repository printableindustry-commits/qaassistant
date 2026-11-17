/**
 * Pont HTTP vers l'extension VS Code (fournisseur « vscode-lm » = Copilot local).
 *
 * Le serveur ne peut pas joindre l'extension : c'est elle qui vient chercher le travail.
 *   1. POST /api/llm/bridge/hello       → présentation (version, modèles Copilot vus par VS Code)
 *   2. GET  /api/llm/bridge/next        → attente longue (25 s) d'une requête à traiter
 *   3. POST /api/llm/bridge/:id/result  → texte produit par Copilot, ou erreur explicite
 *   4. POST /api/llm/bridge/heartbeat   → signe de vie toutes les 10 s
 * Chaque appel porte le jeton d'appairage (en-tête Authorization: Bearer …).
 */
import crypto from 'crypto'
import { bridgeTokens } from './config.mjs'

export const HEARTBEAT_TTL_MS = 30000
const MAX_WAIT_MS = 25000
const MAX_PENDING = 20

const state = {
  client: null,          // { name, version, vscodeVersion, extensionVersion, host }
  copilot: null,         // { available, reason, models: [{ id, name, family, vendor, maxInputTokens }] }
  lastSeen: 0,
  connectedAt: 0,
  pollers: 0,
  served: 0,
  failed: 0,
}

const pending = []       // jobs en attente de prise en charge
const jobs = new Map()   // id → job (en attente ou en cours)
const waiters = []       // attentes longues ouvertes : { deliver(job) }

// ------------------------------------------------------------------ jeton

function safeEqual(a, b) {
  const x = Buffer.from(String(a))
  const y = Buffer.from(String(b))
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

export function tokenFromRequest(req) {
  const auth = String(req.headers.authorization || '')
  if (/^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim()
  return String(req.headers['x-wizard-bridge-token'] || '').trim()
}

export function isTokenValid(token) {
  if (!token) return false
  return bridgeTokens().some((t) => safeEqual(t, token))
}

// ------------------------------------------------------------------ état de la connexion

function touch() {
  const now = Date.now()
  if (!isConnected()) state.connectedAt = now
  state.lastSeen = now
}

export function isConnected() {
  return state.pollers > 0 || Date.now() - state.lastSeen < HEARTBEAT_TTL_MS
}

function sanitizeModels(list) {
  if (!Array.isArray(list)) return []
  return list.slice(0, 30).map((m) => ({
    id: String(m?.id || '').slice(0, 120),
    name: String(m?.name || m?.id || '').slice(0, 120),
    family: String(m?.family || '').slice(0, 80),
    vendor: String(m?.vendor || '').slice(0, 40),
    maxInputTokens: Number(m?.maxInputTokens) || null,
  })).filter((m) => m.id)
}

/** Met à jour ce que l'extension sait de Copilot (hello et heartbeat). */
export function report(body = {}, req) {
  touch()
  if (body.client) {
    state.client = {
      name: String(body.client.name || 'vscode').slice(0, 60),
      version: String(body.client.version || '').slice(0, 30),
      vscodeVersion: String(body.client.vscodeVersion || '').slice(0, 30),
      host: String(req?.socket?.remoteAddress || ''),
    }
  }
  if (body.copilot) {
    const models = sanitizeModels(body.copilot.models)
    state.copilot = {
      available: Boolean(body.copilot.available) && models.length > 0,
      reason: String(body.copilot.reason || '').slice(0, 300),
      models,
    }
  }
}

export function bridgeInfo() {
  return {
    connected: isConnected(),
    lastSeen: state.lastSeen ? new Date(state.lastSeen).toISOString() : null,
    connectedAt: state.connectedAt && isConnected() ? new Date(state.connectedAt).toISOString() : null,
    client: state.client,
    copilot: state.copilot,
    queue: { pending: pending.length, running: [...jobs.values()].filter((j) => j.state === 'running').length },
    served: state.served,
    failed: state.failed,
    heartbeatTtlMs: HEARTBEAT_TTL_MS,
  }
}

/** Disponibilité du fournisseur vscode-lm (synchrone). */
export function bridgeAvailability() {
  if (!isConnected()) {
    return state.lastSeen
      ? { available: false, reason: 'Extension VS Code déconnectée (aucun signal depuis plus de 30 s).' }
      : { available: false, reason: 'Aucune extension VS Code connectée : suivez la procédure « Brancher Copilot local ».' }
  }
  if (!state.copilot) return { available: false, reason: 'Extension connectée, détection de Copilot en cours…' }
  if (!state.copilot.available) return { available: false, reason: state.copilot.reason || 'Extension connectée, mais aucun modèle GitHub Copilot n\'est accessible.' }
  return { available: true, reason: `${state.copilot.models.length} modèle(s) Copilot accessible(s).`, model: state.copilot.models[0]?.name || '' }
}

// ------------------------------------------------------------------ file d'attente

function publicJob(job) {
  return {
    id: job.id,
    purpose: job.purpose,
    system: job.system,
    messages: job.messages,
    maxTokens: job.maxTokens,
    family: job.family,
    deadline: new Date(job.deadline).toISOString(),
  }
}

function dispatch() {
  while (pending.length && waiters.length) {
    const job = pending.shift()
    if (job.state !== 'pending') continue
    job.state = 'running'
    waiters.shift().deliver(job)
  }
}

function settle(job, outcome) {
  if (job.state === 'done') return
  job.state = 'done'
  clearTimeout(job.timer)
  jobs.delete(job.id)
  const i = pending.indexOf(job)
  if (i >= 0) pending.splice(i, 1)
  if (outcome.ok) state.served += 1
  else state.failed += 1
  job.resolve(outcome)
}

/**
 * Confie une requête à l'extension et attend sa réponse.
 * Résout { ok, text, model } ou { ok:false, error, code } ; ne lève pas d'exception.
 */
export function submit({ purpose, system, messages, maxTokens, family, timeoutMs, signal }) {
  return new Promise((resolve) => {
    if (pending.length >= MAX_PENDING) {
      resolve({ ok: false, code: 'busy', error: 'File d\'attente Copilot local saturée : réessayez dans un instant.' })
      return
    }
    const job = {
      id: crypto.randomUUID(),
      purpose, system, messages, maxTokens, family,
      deadline: Date.now() + timeoutMs,
      state: 'pending',
      resolve,
    }
    job.timer = setTimeout(() => settle(job, {
      ok: false,
      code: 'timeout',
      error: job.state === 'running'
        ? `Copilot local n'a pas répondu dans le délai (${Math.round(timeoutMs / 1000)} s).`
        : 'Aucune extension VS Code n\'a pris la requête en charge dans le délai.',
    }), timeoutMs)
    if (signal) {
      if (signal.aborted) return settle(job, { ok: false, code: 'aborted', error: 'Requête annulée.' })
      signal.addEventListener('abort', () => settle(job, { ok: false, code: 'aborted', error: 'Requête annulée.' }), { once: true })
    }
    jobs.set(job.id, job)
    pending.push(job)
    dispatch()
  })
}

/** Attente longue côté extension : renvoie une requête, ou null après `waitMs`. */
export function nextJob(res, waitMs = MAX_WAIT_MS) {
  touch()
  const wait = Math.min(Math.max(Number(waitMs) || MAX_WAIT_MS, 1000), MAX_WAIT_MS)
  return new Promise((resolve) => {
    let done = false
    state.pollers += 1
    const finish = (job) => {
      if (done) return
      done = true
      state.pollers -= 1
      clearTimeout(timer)
      const i = waiters.indexOf(waiter)
      if (i >= 0) waiters.splice(i, 1)
      touch()
      resolve(job ? publicJob(job) : null)
    }
    const waiter = { deliver: finish }
    const timer = setTimeout(() => finish(null), wait)
    // Connexion coupée avant livraison : on retire l'attente (la requête reste dans la file).
    res.on('close', () => {
      if (!done) finish(null)
    })
    waiters.push(waiter)
    dispatch()
  })
}

/** Résultat posté par l'extension. Renvoie false si la requête est inconnue ou expirée. */
export function completeJob(id, body = {}) {
  touch()
  const job = jobs.get(id)
  if (!job || job.state !== 'running') return false
  if (body.ok === false || typeof body.text !== 'string') {
    settle(job, {
      ok: false,
      code: String(body.code || 'error').slice(0, 40),
      error: String(body.error || 'Copilot local a renvoyé une réponse vide.').slice(0, 600),
    })
  } else {
    settle(job, { ok: true, text: body.text, model: String(body.model || '').slice(0, 120) })
  }
  return true
}

/** Remet en file une requête livrée à une attente dont la connexion s'est coupée avant l'envoi. */
export function requeue(id) {
  const job = jobs.get(id)
  if (!job || job.state !== 'running') return
  job.state = 'pending'
  pending.unshift(job)
  dispatch()
}

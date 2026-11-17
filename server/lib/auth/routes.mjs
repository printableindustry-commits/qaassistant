/**
 * Routes d'authentification et de gestion des utilisateurs.
 *   POST /api/auth/login {username, password}  → cookie de session
 *   POST /api/auth/logout
 *   GET  /api/auth/session                     → { authenticated, user }
 *   POST /api/auth/password {currentPassword, newPassword}
 *   GET/POST /api/auth/users, DELETE /api/auth/users/:username   (admin)
 */
import {
  changePassword, clearedSessionCookie, createUser, deleteUser, listUsers, login, logout, sessionCookie,
} from './auth.mjs'
import { sessionToken } from './guard.mjs'
import { HttpError } from '../http/router.mjs'

const isSecure = (req) => req.headers['x-forwarded-proto'] === 'https' || Boolean(req.socket?.encrypted)

export function register(router) {
  router.post('/api/auth/login', async (ctx) => {
    const { username, password } = await ctx.body()
    const result = login(username, password, ctx.req.socket?.remoteAddress || '')
    if (!result.ok) return ctx.json(result.status, { ok: false, error: result.error })
    ctx.res.setHeader('Set-Cookie', sessionCookie(result.token, { secure: isSecure(ctx.req) }))
    return { ok: true, user: result.user }
  })

  router.post('/api/auth/logout', (ctx) => {
    logout(sessionToken(ctx.req))
    ctx.res.setHeader('Set-Cookie', clearedSessionCookie())
    return { ok: true }
  })

  router.get('/api/auth/session', (ctx) => ({
    authenticated: Boolean(ctx.user),
    user: ctx.user,
    // Sert uniquement à afficher l'aide « demo / demo » sur l'écran de connexion.
    demoAvailable: listUsers().some((u) => u.demo),
  }))

  router.post('/api/auth/password', async (ctx) => {
    if (!ctx.user || ctx.user.embedded) throw new HttpError(400, 'Aucun compte à modifier.')
    const { currentPassword, newPassword } = await ctx.body()
    try {
      changePassword(ctx.user.username, currentPassword, newPassword)
    } catch (e) {
      throw new HttpError(400, e.message)
    }
    return { ok: true }
  })

  router.get('/api/auth/users', () => ({ ok: true, users: listUsers() }), { role: 'admin' })

  router.post('/api/auth/users', async (ctx) => {
    try {
      return { ok: true, user: createUser(await ctx.body()) }
    } catch (e) {
      throw new HttpError(400, e.message)
    }
  }, { role: 'admin' })

  router.delete('/api/auth/users/:username', (ctx) => {
    try {
      deleteUser(ctx.params.username, ctx.user.username)
    } catch (e) {
      throw new HttpError(400, e.message)
    }
    return { ok: true }
  }, { role: 'admin' })
}

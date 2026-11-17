import fs from 'fs'
import path from 'path'
import https from 'https'
import http from 'http'
import tls from 'tls'
import { loadHookConfig } from './hook-config.mjs'
import { getWizardLogsDir } from './wizard-logs.mjs'

const TYPE_RE = /^(story|r[ée]cit|test)$/i
const FIELDS = ['summary', 'issuetype', 'status', 'assignee', 'labels', 'updated']

function proxyFor(baseUrl, env) {
  const raw = env.HTTPS_PROXY || process.env.HTTPS_PROXY || process.env.https_proxy || ''
  if (!raw) return null
  const noProxy = (process.env.NO_PROXY || process.env.no_proxy || '').split(',').map(s => s.trim()).filter(Boolean)
  const host = new URL(baseUrl).hostname
  if (noProxy.some(n => host === n || host.endsWith(n.replace(/^\*?\./, '.')))) return null
  return new URL(raw)
}

function openTunnel(proxy, host) {
  return new Promise((resolve, reject) => {
    const headers = { Host: `${host}:443` }
    if (proxy.username) {
      const cred = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`
      headers['Proxy-Authorization'] = `Basic ${Buffer.from(cred).toString('base64')}`
    }
    const lib = proxy.protocol === 'https:' ? https : http
    const req = lib.request({
      host: proxy.hostname,
      port: proxy.port || (proxy.protocol === 'https:' ? 443 : 80),
      method: 'CONNECT',
      path: `${host}:443`,
      headers,
    })
    req.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy()
        reject(new Error(`Proxy CONNECT refusé (${res.statusCode})`))
        return
      }
      resolve(tls.connect({ socket, servername: host }))
    })
    req.on('error', reject)
    req.end()
  })
}

async function jiraGet(baseUrl, auth, env, pathAndQuery) {
  const url = new URL(pathAndQuery, baseUrl)
  const opts = {
    method: 'GET',
    headers: { Authorization: auth, Accept: 'application/json' },
  }
  const proxy = proxyFor(baseUrl, env)
  const tunnel = proxy && url.protocol === 'https:' ? await openTunnel(proxy, url.hostname) : null

  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http
    const req = lib.request(url, { ...opts, ...(tunnel ? { createConnection: () => tunnel, agent: false } : {}) }, (res) => {
      let data = ''
      res.on('data', (c) => { data += c })
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`JIRA ${res.statusCode} sur ${url.pathname} : ${data.slice(0, 300)}`))
          return
        }
        try { resolve(JSON.parse(data)) } catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
    req.end()
  })
}

/** Capture les tickets Récit (Story) et Test du projet JIRA et les enregistre en JSON local. */
export async function captureJiraTickets(hookDir) {
  const cfg = loadHookConfig(hookDir)
  const { JIRA_BASE_URL: baseUrl, JIRA_EMAIL: email, JIRA_TOKEN: token } = cfg.env
  if (!baseUrl || !email || !token) throw new Error('JIRA_BASE_URL, JIRA_EMAIL et JIRA_TOKEN requis dans le .env du Hook Git')
  const projectKey = cfg.defaults.project || 'P0326'
  const auth = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`
  const base = baseUrl.replace(/\/$/, '')

  const project = await jiraGet(base, auth, cfg.env, `/rest/api/3/project/${encodeURIComponent(projectKey)}`)
  const types = (project.issueTypes || []).filter(t => TYPE_RE.test(t.name))
  if (!types.length) throw new Error(`Aucun type Récit/Story/Test trouvé dans le projet ${projectKey}`)

  const jql = `project = "${projectKey}" AND issuetype in (${types.map(t => t.id).join(',')}) ORDER BY key ASC`
  const tickets = []
  let nextPageToken = ''
  do {
    const qs = new URLSearchParams({ jql, maxResults: '100', fields: FIELDS.join(',') })
    if (nextPageToken) qs.set('nextPageToken', nextPageToken)
    const page = await jiraGet(base, auth, cfg.env, `/rest/api/3/search/jql?${qs}`)
    for (const i of page.issues || []) {
      const f = i.fields || {}
      tickets.push({
        key: i.key,
        type: f.issuetype?.name || '',
        summary: f.summary || '',
        status: f.status?.name || '',
        assignee: f.assignee?.displayName || '',
        labels: f.labels || [],
        updated: f.updated || '',
        url: `${base}/browse/${i.key}`,
      })
    }
    nextPageToken = page.nextPageToken || ''
  } while (nextPageToken)

  const result = {
    project: projectKey,
    capturedAt: new Date().toISOString(),
    issueTypes: types.map(t => t.name),
    total: tickets.length,
    tickets,
  }
  const file = path.join(path.dirname(getWizardLogsDir()), 'jira-tickets.json')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(result, null, 2), 'utf8')
  return { ...result, file }
}

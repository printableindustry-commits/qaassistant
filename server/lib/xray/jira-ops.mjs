/**
 * Opérations JIRA REST (API v2, valable pour Cloud et Server/DC) utilisées par l'envoi vers Xray :
 * lecture / création / mise à jour de ticket, lien « tests » entre le Test et le récit, recherche de plans.
 *
 * Sens des liens (POST /rest/api/2/issueLink) : `inwardIssue` porte le libellé sortant du type.
 * Pour le type Xray « Test » (sortant « tests », entrant « is tested by ») :
 *   { inwardIssue: TEST, outwardIssue: RÉCIT }  →  « TEST tests RÉCIT », « RÉCIT is tested by TEST ».
 * Vu depuis le ticket Test (GET issue), ce lien apparaît comme { outwardIssue: RÉCIT }.
 */
import { JiraError } from '../jira/client.mjs'
import { XrayError } from './errors.mjs'

const enc = encodeURIComponent

export async function getIssue(client, key, fields = 'summary,issuetype,project,status,issuelinks,labels') {
  try {
    return await client.request(`/rest/api/2/issue/${enc(key)}?fields=${enc(fields)}`)
  } catch (e) {
    if (e instanceof JiraError && e.status === 404) return null
    throw e
  }
}

export async function createIssue(client, { projectKey, issueType, summary, description, labels, extraFields = {} }) {
  const fields = {
    project: { key: projectKey },
    issuetype: { name: issueType },
    summary,
    description: description || '',
    labels: labels || [],
    ...extraFields,
  }
  const created = await client.request('/rest/api/2/issue', { method: 'POST', body: { fields } })
  if (!created?.key) throw new XrayError('JIRA n’a pas renvoyé la clé du ticket créé.', { code: 'JIRA', step: 'test' })
  return { id: String(created.id || ''), key: created.key }
}

export async function updateIssue(client, key, fields) {
  await client.request(`/rest/api/2/issue/${enc(key)}`, { method: 'PUT', body: { fields } })
}

/** Types d'issues (hors sous-tâches) d'un projet, ou null si la lecture échoue. */
export async function projectIssueTypes(client, projectKey) {
  try {
    const p = await client.request(`/rest/api/2/project/${enc(projectKey)}`)
    return (p?.issueTypes || []).filter((t) => !t.subtask).map((t) => t.name)
  } catch {
    return null
  }
}

const norm = (s) => String(s || '').trim().toLowerCase()

/**
 * Résout le type de lien configuré (par nom, ou par libellé « tests » / « is tested by »).
 * reversed = true si le type est défini à l'envers (sortant « is tested by ») : on inverse alors le sens.
 */
export async function resolveLinkType(client, wanted = 'Test') {
  const data = await client.request('/rest/api/2/issueLinkType')
  const types = data?.issueLinkTypes || []
  const w = norm(wanted)
  let t = types.find((x) => norm(x.name) === w) || types.find((x) => norm(x.outward) === w || norm(x.inward) === w)
  let fallback = false
  if (!t) {
    t = types.find((x) => norm(x.outward) === 'tests' || norm(x.inward) === 'is tested by')
    fallback = Boolean(t)
  }
  if (!t) {
    const names = types.map((x) => x.name).filter(Boolean).slice(0, 12).join(', ')
    throw new XrayError(`Type de lien « ${wanted} » introuvable dans JIRA.`, {
      status: 400,
      code: 'LINK_TYPE',
      step: 'link',
      hint: `Types disponibles : ${names || 'aucun'}. Xray crée normalement le type « Test » (tests / is tested by) ; corrigez le nom dans Réglages › JIRA / Xray.`,
    })
  }
  const reversed = /tested by|testé par/i.test(t.outward || '') && !/tested by|testé par/i.test(t.inward || '')
  return { id: t.id, name: t.name, outward: t.outward, inward: t.inward, reversed, fallback }
}

/** Le ticket Test est-il déjà relié au récit par ce type de lien (dans un sens ou l'autre) ? */
export function findLink(testIssue, storyKey, linkType) {
  const links = testIssue?.fields?.issuelinks || []
  const k = String(storyKey).toUpperCase()
  for (const l of links) {
    if (norm(l.type?.name) !== norm(linkType.name)) continue
    const other = l.outwardIssue?.key || l.inwardIssue?.key
    if (String(other || '').toUpperCase() !== k) continue
    // Depuis le Test : outwardIssue = le Test porte le libellé sortant (« tests »).
    const testIsSource = Boolean(l.outwardIssue)
    return { id: l.id, correct: linkType.reversed ? !testIsSource : testIsSource }
  }
  return null
}

/** Crée le lien « le Test tests le récit » s'il n'existe pas déjà. */
export async function ensureLink(client, { testKey, storyKey, linkType }) {
  const testIssue = await getIssue(client, testKey, 'issuelinks')
  const existing = findLink(testIssue, storyKey, linkType)
  if (existing) return { linked: true, created: false, wrongDirection: !existing.correct }
  const source = linkType.reversed ? storyKey : testKey
  const target = linkType.reversed ? testKey : storyKey
  await client.request('/rest/api/2/issueLink', {
    method: 'POST',
    body: { type: { name: linkType.name }, inwardIssue: { key: source }, outwardIssue: { key: target } },
  })
  return { linked: true, created: true, wrongDirection: false }
}

const jqlString = (s) => `"${String(s).replace(/["\\]/g, ' ').trim()}"`

/** Plans de test du projet (JQL), filtrés par texte ou clé. */
export async function searchPlans(client, { projectKey, issueType = 'Test Plan', q = '', limit = 20 }) {
  const clauses = []
  if (projectKey) clauses.push(`project = ${jqlString(projectKey)}`)
  clauses.push(`issuetype = ${jqlString(issueType)}`)
  const text = String(q || '').trim()
  const asKey = text.toUpperCase()
  if (/^[A-Z][A-Z0-9_]*-\d+$/.test(asKey)) clauses.push(`key = ${asKey}`)
  else if (text) {
    const words = text.replace(/["\\*?~^+\-!(){}[\]:&|]/g, ' ').trim()
    if (words) clauses.push(`summary ~ ${jqlString(`${words}*`)}`)
  }
  const jql = `${clauses.join(' AND ')} ORDER BY updated DESC`
  const out = []
  for await (const page of client.search(jql, ['summary', 'status', 'updated'])) {
    for (const issue of page.issues) {
      out.push({ key: issue.key, id: String(issue.id || ''), summary: issue.fields?.summary || '', status: issue.fields?.status?.name || '' })
      if (out.length >= limit) return out
    }
    break
  }
  return out
}

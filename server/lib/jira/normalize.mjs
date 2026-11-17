/**
 * Normalisation d'une issue JIRA (API v2 ou v3) en récit (contrat Story, docs/V3-ARCHITECTURE.md §4.2).
 */
import { adfToText, wikiToText, fieldToText } from './text.mjs'
import { extractAcceptanceCriteria } from './criteria.mjs'

const EPIC_TYPE_RE = /^(epic|[ée]pop[ée]e)$/i

const names = (list) => (list || []).map((x) => (typeof x === 'string' ? x : x?.name)).filter(Boolean)
const person = (p) => (p ? p.displayName || p.name || p.emailAddress || '' : '')

function descriptionOf(value) {
  if (!value) return ''
  return typeof value === 'object' ? adfToText(value) : wikiToText(value)
}

export function isEpic(issue) {
  const t = issue?.fields?.issuetype
  return Boolean(t && (EPIC_TYPE_RE.test(t.name || '') || t.hierarchyLevel === 1))
}

function linksOf(issuelinks = []) {
  return issuelinks.map((l) => {
    const outward = Boolean(l.outwardIssue)
    const other = l.outwardIssue || l.inwardIssue || {}
    return {
      type: (outward ? l.type?.outward : l.type?.inward) || l.type?.name || 'lien',
      direction: outward ? 'outward' : 'inward',
      key: other.key || '',
      summary: other.fields?.summary || '',
    }
  }).filter((l) => l.key)
}

function epicOf(fields, map, epicSummaries) {
  const linkKey = map.epicLink?.id ? fields[map.epicLink.id] : null
  if (typeof linkKey === 'string' && linkKey) return { key: linkKey, summary: epicSummaries.get(linkKey) || '' }
  const parent = fields.parent
  if (parent && (EPIC_TYPE_RE.test(parent.fields?.issuetype?.name || '') || parent.fields?.issuetype?.hierarchyLevel === 1)) {
    return { key: parent.key, summary: parent.fields?.summary || epicSummaries.get(parent.key) || '' }
  }
  return null
}

/**
 * ctx : { baseUrl, map: { acceptance, epicLink, storyPoints }, epicSummaries: Map, source: 'jira'|'demo' }
 */
export function normalizeIssue(issue, ctx) {
  const f = issue.fields || {}
  const descriptionText = descriptionOf(f.description)
  const fieldText = ctx.map.acceptance?.id ? fieldToText(f[ctx.map.acceptance.id]) : ''
  const { criteria, source } = extractAcceptanceCriteria({ fieldText, descriptionText })
  const points = ctx.map.storyPoints?.id ? f[ctx.map.storyPoints.id] : null
  return {
    key: issue.key,
    id: String(issue.id || ''),
    url: `${ctx.baseUrl}/browse/${issue.key}`,
    issueType: f.issuetype?.name || '',
    summary: f.summary || '',
    status: f.status?.name || '',
    statusCategory: f.status?.statusCategory?.key || '',
    priority: f.priority?.name || '',
    labels: f.labels || [],
    components: names(f.components),
    epic: epicOf(f, ctx.map, ctx.epicSummaries),
    parent: f.parent ? { key: f.parent.key, summary: f.parent.fields?.summary || '' } : null,
    fixVersions: names(f.fixVersions),
    assignee: person(f.assignee),
    reporter: person(f.reporter),
    created: f.created || '',
    updated: f.updated || '',
    descriptionText,
    acceptanceCriteria: criteria,
    acceptanceCriteriaSource: source,
    links: linksOf(f.issuelinks),
    subtasks: (f.subtasks || []).map((s) => ({ key: s.key, summary: s.fields?.summary || '', status: s.fields?.status?.name || '' })),
    storyPoints: typeof points === 'number' ? points : null,
    source: ctx.source,
  }
}

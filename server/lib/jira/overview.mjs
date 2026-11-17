/**
 * Synthèse de la prise de connaissance : compteurs par statut et par épopée, couverture des critères,
 * récits « à clarifier » (avec raisons) et questions à poser au PO.
 */
import { listStories, getScanDetails, getScanHistory } from './stories.mjs'
import { reviewStory } from './review.mjs'
import { criteriaFormat } from './criteria.mjs'
import { getProjectProfile } from '../project-profile.mjs'

const CATEGORY_ORDER = { new: 0, indeterminate: 1, done: 2, '': 3 }

function pct(n, d) {
  return d ? Math.round((n / d) * 100) : 0
}

/** Résumé du profil projet, sans aucun secret. */
export function projectSummary() {
  try {
    const p = getProjectProfile()
    return {
      onboardingComplete: Boolean(p.onboardingComplete),
      applicationLabel: p.applicationLabel || '',
      productCode: p.productCode || '',
      solutionCode: p.solutionCode || '',
      tribu: p.tribu || '',
      squad: p.squad || '',
      poName: p.poName || '',
      baName: p.baName || '',
      qaName: p.qaName || '',
      scrumMasterName: p.scrumMasterName || '',
      recommendedStack: p.recommendedStackLabel || p.recommendedStack || '',
      testPlans: (p.testPlans || []).map((t) => ({ planKey: t.planKey || '', planName: t.planName || '' })),
    }
  } catch {
    return null
  }
}

function byStatus(stories) {
  const map = new Map()
  for (const s of stories) {
    const row = map.get(s.status) || { status: s.status || 'Sans statut', category: s.statusCategory || '', count: 0 }
    row.count += 1
    map.set(s.status, row)
  }
  return [...map.values()].sort((a, b) => (CATEGORY_ORDER[a.category] ?? 3) - (CATEGORY_ORDER[b.category] ?? 3) || b.count - a.count)
}

function byEpic(stories, reviews, epics) {
  const map = new Map()
  for (const e of epics) map.set(e.key, { key: e.key, summary: e.summary, total: 0, withCriteria: 0, toClarify: 0, points: 0 })
  for (const s of stories) {
    const id = s.epic?.key || ''
    const row = map.get(id) || { key: id || null, summary: s.epic?.summary || 'Sans épopée', total: 0, withCriteria: 0, toClarify: 0, points: 0 }
    if (!row.summary && s.epic?.summary) row.summary = s.epic.summary
    row.total += 1
    if (s.acceptanceCriteria.length) row.withCriteria += 1
    if (reviews.get(s.key).toClarify) row.toClarify += 1
    row.points += s.storyPoints || 0
    map.set(id, row)
  }
  return [...map.values()].filter((r) => r.total > 0).map((r) => ({ ...r, coverage: pct(r.withCriteria, r.total) }))
    .sort((a, b) => (a.key ? 0 : 1) - (b.key ? 0 : 1) || b.total - a.total)
}

export function buildOverview() {
  const details = getScanDetails()
  const project = projectSummary()
  if (!details?.scan) return { empty: true, scan: null, project, history: getScanHistory() }

  const stories = listStories({})
  const reviews = new Map(stories.map((s) => [s.key, reviewStory(s)]))
  const withCriteria = stories.filter((s) => s.acceptanceCriteria.length).length
  const toClarify = stories.filter((s) => reviews.get(s.key).toClarify).map((s) => ({
    key: s.key,
    summary: s.summary,
    status: s.status,
    epic: s.epic,
    url: s.url,
    reasons: reviews.get(s.key).flags,
    questions: reviews.get(s.key).questions,
  }))
  const questions = stories.flatMap((s) => reviews.get(s.key).questions.map((q) => ({ key: s.key, summary: s.summary, question: q })))
  const formats = { gherkin: 0, list: 0, none: 0 }
  for (const s of stories) formats[criteriaFormat(s.acceptanceCriteria)] += 1
  const perf = stories.flatMap((s) => reviews.get(s.key).flags.filter((f) => f.code === 'performance').map((f) => ({ key: s.key, summary: s.summary, requirement: f.detail })))

  return {
    empty: false,
    scan: details.scan,
    project,
    counts: {
      stories: stories.length,
      withCriteria,
      withoutCriteria: stories.length - withCriteria,
      toClarify: toClarify.length,
      epics: new Set(stories.map((s) => s.epic?.key).filter(Boolean)).size,
      subtasks: stories.reduce((n, s) => n + s.subtasks.length, 0),
      points: stories.reduce((n, s) => n + (s.storyPoints || 0), 0),
      questions: questions.length,
    },
    coverage: {
      percent: pct(withCriteria, stories.length),
      field: stories.filter((s) => s.acceptanceCriteriaSource === 'field').length,
      description: stories.filter((s) => s.acceptanceCriteriaSource === 'description').length,
      none: stories.filter((s) => s.acceptanceCriteriaSource === 'none').length,
      criteria: stories.reduce((n, s) => n + s.acceptanceCriteria.length, 0),
      formats,
    },
    byStatus: byStatus(stories),
    byEpic: byEpic(stories, reviews, details.epics || []),
    toClarify,
    questions,
    performance: perf,
    history: getScanHistory().slice(0, 10),
  }
}

import fs from 'fs'
import path from 'path'
import { CONF_DIR, REPO_ROOT } from './paths.mjs'
import { listK6Profiles, getK6Profile } from './k6-profiles.mjs'
import { listK6RunHistory } from './k6-run-history.mjs'
import { getK6OnboardingContext } from './k6-onboarding-context.mjs'

function normalizeSolutionCode(code) {
  const m = String(code || '').trim().toUpperCase().match(/^S\d{4}/)
  return m ? m[0] : ''
}

function detectSourceType(folderPath) {
  if (!folderPath) return 'FOLDER'
  const gitDir = path.join(folderPath, '.git')
  return fs.existsSync(gitDir) ? 'GIT' : 'FOLDER'
}

function profileSolutionCode(full, ctx) {
  const meta = full?.meta || {}
  const ans = full?.answers || {}
  return normalizeSolutionCode(meta.solutionCode || ans.solutionCode || ctx.solutionCode)
}

function buildSolutionSeed(code, ctx, profileMeta = {}) {
  const folderPath = profileMeta.folderPath || ctx.gitRepository || REPO_ROOT
  return {
    solutionCode: code,
    label: profileMeta.applicationLabel || ctx.applicationLabel || code,
    folderPath,
    relativePath: profileMeta.relativePath || folderPath,
    sourceType: profileMeta.sourceType || detectSourceType(folderPath),
    productCode: profileMeta.productCode || ctx.productCode || '',
  }
}

function collectSolutionSeeds(ctx, profiles) {
  const map = new Map()

  for (const p of profiles) {
    const full = getK6Profile(p.id)
    if (!full) continue
    const code = profileSolutionCode(full, ctx)
    if (!code) continue
    if (!map.has(code)) {
      map.set(code, buildSolutionSeed(code, ctx, full.meta || {}))
    }
  }

  return [...map.values()].sort((a, b) => a.solutionCode.localeCompare(b.solutionCode, 'fr'))
}

function aggregateRuns(runs, profileId) {
  const related = runs.filter((r) => r.profileId === profileId)
  if (!related.length) {
    return { runCount: 0, lastRunAt: null, avgDurationMs: null }
  }
  const durations = related
    .map((r) => Number(r.summary?.durationMs))
    .filter((n) => Number.isFinite(n) && n > 0)
  const avgDurationMs = durations.length
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : null
  return {
    runCount: related.length,
    lastRunAt: related[0]?.runAt || null,
    avgDurationMs,
  }
}

function formatDuration(ms) {
  if (!ms || !Number.isFinite(ms)) return '—'
  if (ms < 1000) return `${ms} ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`
  const m = Math.floor(ms / 60000)
  const s = Math.round((ms % 60000) / 1000)
  return `${m}m ${s}s`
}

function buildCampaignEntry(p, full, runs, ctx) {
  const ans = full?.answers || {}
  const meta = full?.meta || {}
  const stats = aggregateRuns(runs, p.id)
  const folderPath = meta.folderPath || ans.folderPath || ''
  return {
    id: p.id,
    name: p.name,
    campaignObjective: p.campaignObjective || ans.campaignObjective || '',
    environment: p.environment || ans.environment || '',
    baseUrl: p.baseUrl || ans.baseUrl || '',
    solutionCode: profileSolutionCode(full, ctx),
    folderPath,
    relativePath: meta.relativePath || folderPath,
    sourceType: meta.sourceType || detectSourceType(folderPath),
    updatedAt: p.updatedAt,
    ...stats,
    avgDurationLabel: formatDuration(stats.avgDurationMs),
  }
}

export function buildK6CampaignTree() {
  const ctx = getK6OnboardingContext()
  const tribuLabel = ctx.tribu ? ctx.tribu.toUpperCase() : 'TRIBU NON RENSEIGNÉE'
  const productCode = ctx.productCode || '—'
  const productLabel = ctx.applicationLabel || 'Application non renseignée'

  const profiles = listK6Profiles()
  const runs = listK6RunHistory({ limit: 500 })
  const solutions = collectSolutionSeeds(ctx, profiles)

  const campaignsBySolution = new Map()
  const orphanCampaigns = []

  for (const p of profiles) {
    const full = getK6Profile(p.id)
    if (!full) continue
    const code = profileSolutionCode(full, ctx)
    const entry = buildCampaignEntry(p, full, runs, ctx)
    if (!code) {
      orphanCampaigns.push(entry)
      continue
    }
    if (!campaignsBySolution.has(code)) campaignsBySolution.set(code, [])
    campaignsBySolution.get(code).push(entry)
  }

  for (const [code, list] of campaignsBySolution) {
    list.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    if (!solutions.find((s) => s.solutionCode === code)) {
      solutions.push(buildSolutionSeed(code, ctx, getK6Profile(list[0]?.id)?.meta || {}))
    }
  }
  solutions.sort((a, b) => a.solutionCode.localeCompare(b.solutionCode, 'fr'))

  const solutionNodes = solutions.map((sol) => {
    const campaigns = campaignsBySolution.get(sol.solutionCode) || []
    const solRuns = runs.filter((r) => {
      const prof = profiles.find((p) => p.id === r.profileId)
      if (!prof) return false
      const full = getK6Profile(prof.id)
      return profileSolutionCode(full, ctx) === sol.solutionCode
    })

    const lastRunAt = solRuns[0]?.runAt || null
    const durations = solRuns
      .map((r) => Number(r.summary?.durationMs))
      .filter((n) => Number.isFinite(n) && n > 0)

    return {
      ...sol,
      folderPath: sol.folderPath || sol.relativePath || '',
      relativePath: sol.relativePath || sol.folderPath || '',
      sourceType: sol.sourceType || detectSourceType(sol.folderPath),
      campaigns,
      runCount: solRuns.length,
      lastRunAt,
      avgDurationMs: durations.length
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : null,
      avgDurationLabel: formatDuration(
        durations.length
          ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
          : null,
      ),
    }
  }).filter((sol) => sol.campaigns.length > 0)

  const allCampaigns = [...campaignsBySolution.values()].flat()
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))

  const productNode = {
    productCode,
    label: productLabel,
    solutionCount: solutionNodes.length,
    campaignCount: allCampaigns.length,
    solutions: solutionNodes,
    campaigns: allCampaigns,
  }

  const tree = {
    tribu: {
      id: tribuLabel.replace(/\s+/g, '-').toLowerCase(),
      label: tribuLabel,
      products: allCampaigns.length ? [productNode] : [],
    },
    onboardingComplete: ctx.onboardingComplete,
    orphanCampaigns,
    profilesDir: '.wizard-qa/conf/k6-profiles/',
    historyPath: '.wizard-qa/conf/k6-history/runs.json',
  }

  if (orphanCampaigns.length) {
    productNode.campaigns = [...(productNode.campaigns || []), ...orphanCampaigns]
    productNode.solutions.push({
      solutionCode: '—',
      label: 'Sans code solution',
      folderPath: ctx.gitRepository || REPO_ROOT,
      relativePath: ctx.gitRepository || REPO_ROOT,
      sourceType: detectSourceType(ctx.gitRepository),
      productCode: ctx.productCode,
      campaigns: orphanCampaigns,
      runCount: 0,
      lastRunAt: null,
      avgDurationMs: null,
      avgDurationLabel: '—',
    })
    productNode.solutionCount = productNode.solutions.length
    productNode.campaignCount = productNode.campaigns.length
    if (!tree.tribu.products.length) {
      tree.tribu.products = [productNode]
    }
  }

  return tree
}

export function getK6CampaignTreeForApi() {
  const tree = buildK6CampaignTree()
  return { ok: true, tree, ...tree }
}

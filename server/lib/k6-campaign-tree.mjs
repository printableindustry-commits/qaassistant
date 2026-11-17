/**
 * Arborescence Tribu → Produit → Solution → Campagnes (écran V2 « Scénarios k6 »).
 * Chaque profil est lu une seule fois ; seules les exécutions réelles sont comptées
 * (les entrées « configured » postées après un apply sont ignorées).
 */
import fs from 'fs'
import path from 'path'
import { REPO_ROOT } from './paths.mjs'
import { listK6Profiles, getK6Profile } from './k6-profiles.mjs'
import { listK6RunHistory } from './k6-run-history.mjs'
import { getK6OnboardingContext } from './k6-onboarding-context.mjs'

function normalizeSolutionCode(code) {
  const m = String(code || '').trim().toUpperCase().match(/^S\d{4}/)
  return m ? m[0] : ''
}

function detectSourceType(folderPath) {
  if (!folderPath) return 'FOLDER'
  return fs.existsSync(path.join(folderPath, '.git')) ? 'GIT' : 'FOLDER'
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

function averageDuration(runs) {
  const durations = runs
    .map((r) => Number(r.summary?.durationMs))
    .filter((n) => Number.isFinite(n) && n > 0)
  return durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null
}

function aggregateRuns(runs) {
  if (!runs.length) return { runCount: 0, lastRunAt: null, avgDurationMs: null }
  return { runCount: runs.length, lastRunAt: runs[0]?.runAt || null, avgDurationMs: averageDuration(runs) }
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
  const stats = aggregateRuns(runs)
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
  const fullById = new Map(profiles.map((p) => [p.id, getK6Profile(p.id)]).filter(([, full]) => full))
  const runs = listK6RunHistory({ limit: 500, executedOnly: true })
  const runsByProfile = new Map()
  for (const r of runs) {
    if (!runsByProfile.has(r.profileId)) runsByProfile.set(r.profileId, [])
    runsByProfile.get(r.profileId).push(r)
  }

  const campaignsBySolution = new Map()
  const seeds = new Map()
  const orphanCampaigns = []
  for (const p of profiles) {
    const full = fullById.get(p.id)
    if (!full) continue
    const code = profileSolutionCode(full, ctx)
    const entry = buildCampaignEntry(p, full, runsByProfile.get(p.id) || [], ctx)
    if (!code) {
      orphanCampaigns.push(entry)
      continue
    }
    if (!seeds.has(code)) seeds.set(code, buildSolutionSeed(code, ctx, full.meta || {}))
    if (!campaignsBySolution.has(code)) campaignsBySolution.set(code, [])
    campaignsBySolution.get(code).push(entry)
  }

  const solutionNodes = [...seeds.values()]
    .sort((a, b) => a.solutionCode.localeCompare(b.solutionCode, 'fr'))
    .map((sol) => {
      const campaigns = (campaignsBySolution.get(sol.solutionCode) || [])
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      const solRuns = campaigns.flatMap((c) => runsByProfile.get(c.id) || [])
        .sort((a, b) => String(b.runAt).localeCompare(String(a.runAt)))
      const avg = averageDuration(solRuns)
      return {
        ...sol,
        campaigns,
        runCount: solRuns.length,
        lastRunAt: solRuns[0]?.runAt || null,
        avgDurationMs: avg,
        avgDurationLabel: formatDuration(avg),
      }
    })

  const allCampaigns = solutionNodes.flatMap((s) => s.campaigns)
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
    const orphanRuns = orphanCampaigns.flatMap((c) => runsByProfile.get(c.id) || [])
    const avg = averageDuration(orphanRuns)
    productNode.campaigns = [...productNode.campaigns, ...orphanCampaigns]
    productNode.solutions.push({
      solutionCode: '—',
      label: 'Sans code solution',
      folderPath: ctx.gitRepository || REPO_ROOT,
      relativePath: ctx.gitRepository || REPO_ROOT,
      sourceType: detectSourceType(ctx.gitRepository),
      productCode: ctx.productCode,
      campaigns: orphanCampaigns,
      runCount: orphanRuns.length,
      lastRunAt: orphanRuns.sort((a, b) => String(b.runAt).localeCompare(String(a.runAt)))[0]?.runAt || null,
      avgDurationMs: avg,
      avgDurationLabel: formatDuration(avg),
    })
    productNode.solutionCount = productNode.solutions.length
    productNode.campaignCount = productNode.campaigns.length
    if (!tree.tribu.products.length) tree.tribu.products = [productNode]
  }

  return tree
}

export function getK6CampaignTreeForApi() {
  const tree = buildK6CampaignTree()
  return { ok: true, tree, ...tree }
}

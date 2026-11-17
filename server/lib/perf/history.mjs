/**
 * Historique unifié des runs (V3 : reports/k6/<id>/meta.json ; V2 : k6-history/runs.json)
 * et comparaison de deux runs (écarts absolus et relatifs, verdict de régression).
 */
import { listK6RunHistory } from '../k6-run-history.mjs'
import { listMetas, getMeta, readRunJson, readRunText, getSettings } from './store.mjs'
import { liveState } from './run-manager.mjs'

const V2_STATUS = { success: 'passed', passed: 'passed', failed: 'failed', thresholds_failed: 'failed', error: 'error', stopped: 'stopped' }

function fromV2(r) {
  const measured = r.summary?.measured ? r.summary.metrics || null : null
  return {
    id: r.id,
    source: 'v2',
    profileId: r.profileId,
    profileName: r.profileName || r.campaignName || 'Campagne',
    status: V2_STATUS[r.status] || 'error',
    simulated: Boolean(r.summary?.simulated),
    startedAt: r.runAt,
    finishedAt: null,
    durationMs: Number(r.summary?.durationMs) || null,
    exitCode: r.summary?.exitCode ?? null,
    config: { vus: r.summary?.vus ?? null, duration: r.summary?.duration || '' },
    metrics: measured,
    thresholds: [],
    command: '',
    notes: r.notes || '',
  }
}

/** Ligne de liste : méta-données sans les seuils détaillés. */
function row(meta, baselines) {
  return {
    id: meta.id,
    source: meta.source || 'v3',
    profileId: meta.profileId,
    profileName: meta.profileName,
    status: meta.status,
    simulated: Boolean(meta.simulated),
    startedAt: meta.startedAt,
    finishedAt: meta.finishedAt,
    durationMs: meta.durationMs,
    vus: meta.config?.vus ?? null,
    duration: meta.config?.duration || '',
    metrics: meta.metrics || null,
    thresholdsFailed: (meta.thresholds || []).filter((t) => !t.ok).length,
    thresholdsTotal: (meta.thresholds || []).length,
    isBaseline: Boolean(meta.profileId && baselines[meta.profileId] === meta.id),
  }
}

/** Runs V3 et V2 fusionnés (sans doublon), du plus récent au plus ancien. */
export function listRuns({ profileId = null, status = null, limit = 200 } = {}) {
  const { baselines } = getSettings()
  const v3 = listMetas()
  const ids = new Set(v3.map((m) => m.id))
  const v2 = listK6RunHistory({ limit: 500, executedOnly: true })
    .filter((r) => !ids.has(r.id))
    .map(fromV2)
  let all = [...v3, ...v2].sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))
  if (profileId) all = all.filter((r) => r.profileId === profileId)
  if (status) all = all.filter((r) => r.status === status)
  return all.slice(0, limit).map((m) => row(m, baselines))
}

function findAny(id) {
  const meta = getMeta(id)
  if (meta) return meta
  const v2 = listK6RunHistory({ limit: 500 }).find((r) => r.id === id)
  return v2 ? fromV2(v2) : null
}

/** Détail complet : méta-données, série par seconde, console, comparaison à la référence. */
export function getRunDetail(id) {
  const live = liveState(id)
  const meta = live?.run || findAny(id)
  if (!meta) return null
  const series = live ? live.series : meta.source === 'v2' ? [] : readRunJson(id, 'series.json') || []
  const log = live ? live.log : meta.source === 'v2' ? [] : readRunText(id, 'console.log', 60000).split('\n').slice(-300)
  const { baselines, regressionPct } = getSettings()
  const baselineId = meta.profileId ? baselines[meta.profileId] : null
  let baseline = null
  if (baselineId && baselineId !== id && meta.status !== 'running') {
    const ref = findAny(baselineId)
    if (ref?.metrics && meta.metrics) baseline = compareMetas(ref, meta, regressionPct)
  }
  return {
    run: { ...meta, isBaseline: baselineId === id },
    series,
    log,
    live: live?.live || null,
    baseline,
  }
}

/** Indicateurs comparés : sens « meilleur », unité, et règle de régression. */
export const COMPARED = [
  { key: 'p95', label: 'Temps de réponse p95', unit: 'ms', better: 'lower' },
  { key: 'p99', label: 'Temps de réponse p99', unit: 'ms', better: 'lower' },
  { key: 'avg', label: 'Temps de réponse moyen', unit: 'ms', better: 'lower' },
  { key: 'med', label: 'Temps de réponse médian', unit: 'ms', better: 'lower' },
  { key: 'errorRate', label: 'Taux d’erreur HTTP', unit: '%', better: 'lower', rate: true },
  { key: 'rps', label: 'Débit', unit: 'req/s', better: 'higher' },
  { key: 'checksRate', label: 'Vérifications réussies', unit: '%', better: 'higher', rate: true },
  { key: 'requests', label: 'Requêtes', unit: '', better: null },
  { key: 'iterations', label: 'Itérations', unit: '', better: null },
  { key: 'vusMax', label: 'VUs max', unit: '', better: null },
]

function judge(def, a, b, pct) {
  if (a == null || b == null || !def.better) return 'info'
  const delta = b - a
  const worse = def.better === 'lower' ? delta > 0 : delta < 0
  const better = def.better === 'lower' ? delta < 0 : delta > 0
  let significant
  if (def.rate) {
    // Taux : écart d'au moins 1 point, ou relatif au-delà du seuil (s'il dépasse 0,1 point).
    const points = Math.abs(delta) * 100
    significant = points >= 1 || (a > 0 && Math.abs(delta / a) * 100 > pct && points >= 0.1)
  } else {
    significant = a === 0 ? Math.abs(delta) > 0 : Math.abs(delta / a) * 100 > pct
  }
  if (!significant) return 'stable'
  if (worse) return 'regression'
  return better ? 'improvement' : 'stable'
}

function compareMetas(a, b, pct) {
  const rows = COMPARED.map((def) => {
    const va = a.metrics?.[def.key] ?? null
    const vb = b.metrics?.[def.key] ?? null
    const delta = va != null && vb != null ? vb - va : null
    const deltaPct = delta != null && va ? (delta / va) * 100 : null
    return { ...def, a: va, b: vb, delta, deltaPct, verdict: judge(def, va, vb, pct) }
  })
  const thresholdChanges = []
  const ta = new Map((a.thresholds || []).map((t) => [`${t.metric} ${t.rule}`, t]))
  for (const t of b.thresholds || []) {
    const before = ta.get(`${t.metric} ${t.rule}`)
    if (before && before.ok !== t.ok) thresholdChanges.push({ metric: t.metric, rule: t.rule, before: before.ok, after: t.ok })
  }
  const regressions = rows.filter((r) => r.verdict === 'regression').length
  const improvements = rows.filter((r) => r.verdict === 'improvement').length
  const brokenThresholds = thresholdChanges.filter((t) => t.before && !t.after).length
  return {
    regressionPct: pct,
    verdict: regressions || brokenThresholds ? 'regression' : improvements ? 'improvement' : 'stable',
    regressions,
    improvements,
    rows,
    thresholdChanges,
  }
}

const brief = (m) => ({
  id: m.id,
  profileId: m.profileId,
  profileName: m.profileName,
  status: m.status,
  simulated: Boolean(m.simulated),
  startedAt: m.startedAt,
  durationMs: m.durationMs,
  vus: m.config?.vus ?? null,
})

/** Compare b (candidat) à a (référence). */
export function compareRuns(aId, bId, pct) {
  const a = findAny(aId)
  const b = findAny(bId)
  if (!a || !b) return null
  const threshold = Number.isFinite(pct) && pct > 0 ? pct : getSettings().regressionPct
  return {
    a: brief(a),
    b: brief(b),
    comparable: Boolean(a.metrics && b.metrics),
    sameProfile: a.profileId === b.profileId,
    ...compareMetas(a, b, threshold),
  }
}

export { findAny }

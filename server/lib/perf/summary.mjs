/**
 * Lecture du résumé de fin de test k6 et évaluation des seuils.
 *
 * Deux formats sont acceptés :
 *  - --summary-export (historique) : metrics.<nom> = { avg, 'p(95)', …, thresholds: { 'p(95)<500': <échoué ?> } }
 *  - handleSummary (récent)        : metrics.<nom> = { values: {…}, thresholds: { 'p(95)<500': { ok } } }
 */

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null)

function values(metric) {
  if (!metric) return {}
  return metric.values && typeof metric.values === 'object' ? metric.values : metric
}

/** Taux d'une métrique « rate » (http_req_failed, checks). */
function rateOf(metric) {
  const v = values(metric)
  if (num(v.rate) != null) return num(v.rate)
  if (num(v.value) != null) return num(v.value)
  const passes = num(v.passes) || 0
  const fails = num(v.fails) || 0
  return passes + fails ? passes / (passes + fails) : null
}

/** Métriques clés normalisées (durées en ms, taux entre 0 et 1). */
export function extractMetrics(summary) {
  const m = summary?.metrics || {}
  const dur = values(m.http_req_duration)
  const reqs = values(m.http_reqs)
  const iters = values(m.iterations)
  const vusMax = values(m.vus_max)
  const checks = values(m.checks)
  const checkPasses = num(checks.passes)
  const checkFails = num(checks.fails)
  return {
    p95: num(dur['p(95)']),
    p99: num(dur['p(99)']),
    p90: num(dur['p(90)']),
    avg: num(dur.avg),
    med: num(dur.med),
    min: num(dur.min),
    max: num(dur.max),
    errorRate: rateOf(m.http_req_failed),
    rps: num(reqs.rate),
    requests: num(reqs.count),
    iterations: num(iters.count),
    iterationsRate: num(iters.rate),
    vusMax: num(vusMax.max ?? vusMax.value),
    checksRate: rateOf(m.checks),
    checksPassed: checkPasses,
    checksFailed: checkFails,
    dataReceived: num(values(m.data_received).count),
    dataSent: num(values(m.data_sent).count),
  }
}

/** Résultat de chaque seuil : [{ metric, rule, ok, actual }]. */
export function extractThresholds(summary) {
  const out = []
  for (const [metric, def] of Object.entries(summary?.metrics || {})) {
    const th = def?.thresholds
    if (!th || typeof th !== 'object') continue
    for (const [rule, res] of Object.entries(th)) {
      const ok = typeof res === 'object' && res !== null ? Boolean(res.ok) : !res
      out.push({ metric, rule, ok, actual: actualFor(values(def), rule) })
    }
  }
  return out
}

const RULE_RE = /^\s*([a-z]+(?:\(\d+(?:\.\d+)?\))?)\s*(<=|>=|==|===|!=|<|>)\s*(-?\d+(?:\.\d+)?)\s*$/i

function statValue(vals, stat) {
  if (stat === 'rate') return rateOf({ values: vals })
  if (stat === 'value') return num(vals.value ?? vals.rate)
  return num(vals[stat])
}

function actualFor(vals, rule) {
  const m = String(rule).match(RULE_RE)
  return m ? statValue(vals, m[1]) : null
}

/** Évalue une règle k6 (« p(95)<500 », « rate<0.01 », « count>100 »). null si non évaluable. */
export function evaluateRule(vals, rule) {
  const m = String(rule).match(RULE_RE)
  if (!m) return null
  const actual = statValue(vals, m[1])
  if (actual == null) return null
  const target = Number(m[3])
  const ok = {
    '<': actual < target,
    '<=': actual <= target,
    '>': actual > target,
    '>=': actual >= target,
    '==': actual === target,
    '===': actual === target,
    '!=': actual !== target,
  }[m[2]]
  return { ok, actual }
}

/** Forme simple des seuils : { métrique: ['règle', { threshold: 'règle' }] } → [{ metric, rule }]. */
export function flattenThresholds(thresholds = {}) {
  const list = []
  for (const [metric, rules] of Object.entries(thresholds)) {
    for (const r of [].concat(rules)) {
      const rule = typeof r === 'string' ? r : r?.threshold
      if (rule) list.push({ metric, rule })
    }
  }
  return list
}

/** Verdict à partir des seuils et du code de sortie de k6 (99 = seuils non respectés). */
export function verdictOf({ thresholds = [], exitCode = null, stopped = false, error = null }) {
  if (stopped) return 'stopped'
  if (error) return 'error'
  if (exitCode === 99 || thresholds.some((t) => !t.ok)) return 'failed'
  if (exitCode != null && exitCode !== 0) return 'error'
  return 'passed'
}

/** Lecture tolérante d'un fichier summary.json. */
export function parseSummary(json) {
  return { metrics: extractMetrics(json), thresholds: extractThresholds(json) }
}

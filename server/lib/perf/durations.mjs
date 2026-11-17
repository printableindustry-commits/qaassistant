/** Durées au format k6 (« 30s », « 1m30s », « 2h », « 500ms »). */

const DURATION_RE = /^(?:\d+(?:\.\d+)?(?:ms|s|m|h))+$/

export function isValidDuration(text) {
  return DURATION_RE.test(String(text || '').trim())
}

export function parseDurationMs(text) {
  const t = String(text || '').trim()
  if (!isValidDuration(t)) return 0
  const units = { ms: 1, s: 1000, m: 60000, h: 3600000 }
  let total = 0
  for (const [, n, u] of t.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g)) total += Number(n) * units[u]
  return total
}

/** Durée totale prévue d'un scénario (montée + palier + descente pour ramping-vus). */
export function plannedDurationMs({ executor, duration, rampUp, rampDown }) {
  const main = parseDurationMs(duration)
  if (executor !== 'ramping-vus') return main
  return main + parseDurationMs(rampUp) + parseDurationMs(rampDown)
}

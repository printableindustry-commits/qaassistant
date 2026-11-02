/** Helpers partagés pour noms de fichiers logs Wizard / DEBUG. */

export function pad2(n) {
  return String(n).padStart(2, '0')
}

export function formatLogTimestamp(date = new Date()) {
  const y = date.getFullYear()
  const m = pad2(date.getMonth() + 1)
  const d = pad2(date.getDate())
  const h = pad2(date.getHours())
  const mi = pad2(date.getMinutes())
  const s = pad2(date.getSeconds())
  return { y, m, d, h, mi, s, date }
}

export function formatLogDisplayTime(date = new Date()) {
  const { y, m, d, h, mi, s } = formatLogTimestamp(date)
  return `${y}-${m}-${d} ${h}:${mi}:${s}`
}

export function formatLogFileName(label, date = new Date()) {
  const { y, m, d, h, mi, s } = formatLogTimestamp(date)
  const safe = String(label || 'Log').replace(/[^\w-]+/g, '_')
  return `${y}-${m}-${d}_${h}-${mi}-${s}_${safe}.md`
}

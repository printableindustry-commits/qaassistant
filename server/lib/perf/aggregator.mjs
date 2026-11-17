/**
 * Agrégation par seconde du flux NDJSON de k6 (--out json) et suivi continu du fichier.
 *
 * Ligne type : {"type":"Point","metric":"http_req_duration","data":{"time":"…","value":123.4,"tags":{…}}}
 * Série produite (une entrée par seconde écoulée) :
 *   { t, vus, rps, p95, errorRate, checksRate, iterations }
 * L'agrégat global (échantillon des durées, compteurs) permet de reconstituer un résumé si k6
 * n'a pas pu écrire summary.json (arrêt forcé).
 */
import fs from 'fs'
import { StringDecoder } from 'string_decoder'

const RESERVOIR_SIZE = 20000
const MAX_SERIES = 7200

export function percentile(sorted, p) {
  if (!sorted.length) return null
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[idx]
}

const round = (v, d = 1) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d)

export function createAggregator() {
  const buckets = new Map()
  let origin = null
  let lastVus = 0
  let emittedUpTo = -1
  const total = {
    durations: [], seen: 0, sum: 0, min: Infinity, max: 0,
    requests: 0, failed: 0, checksPass: 0, checksFail: 0, iterations: 0, vusMax: 0,
    dataReceived: 0, dataSent: 0,
  }

  function bucket(sec) {
    let b = buckets.get(sec)
    if (!b) {
      b = { durations: [], reqs: 0, failed: 0, failedN: 0, checksPass: 0, checksN: 0, iterations: 0, vus: null }
      buckets.set(sec, b)
    }
    return b
  }

  function keepDuration(v) {
    total.seen += 1
    total.sum += v
    if (v < total.min) total.min = v
    if (v > total.max) total.max = v
    if (total.durations.length < RESERVOIR_SIZE) total.durations.push(v)
    else {
      const j = Math.floor(Math.random() * total.seen)
      if (j < RESERVOIR_SIZE) total.durations[j] = v
    }
  }

  /** Ingère un point (objet déjà analysé). */
  function addPoint(point) {
    if (point?.type !== 'Point' || !point.data) return
    const ts = Date.parse(point.data.time)
    if (!Number.isFinite(ts)) return
    if (origin == null) origin = ts
    const sec = Math.max(0, Math.floor((ts - origin) / 1000))
    const v = Number(point.data.value) || 0
    const b = bucket(sec)
    switch (point.metric) {
      case 'http_req_duration':
        b.durations.push(v)
        keepDuration(v)
        break
      case 'http_reqs':
        b.reqs += v
        total.requests += v
        break
      case 'http_req_failed':
        b.failed += v
        b.failedN += 1
        total.failed += v
        break
      case 'checks':
        b.checksPass += v
        b.checksN += 1
        if (v) total.checksPass += 1
        else total.checksFail += 1
        break
      case 'iterations':
        b.iterations += v
        total.iterations += v
        break
      case 'vus':
        b.vus = v
        if (v > total.vusMax) total.vusMax = v
        break
      case 'vus_max':
        if (v > total.vusMax) total.vusMax = v
        break
      case 'data_received':
        total.dataReceived += v
        break
      case 'data_sent':
        total.dataSent += v
        break
      default:
    }
  }

  function addLine(line) {
    const t = line.trim()
    if (!t) return
    try {
      addPoint(JSON.parse(t))
    } catch { /* ligne partielle ou corrompue : ignorée */ }
  }

  function summarizeBucket(sec, b) {
    if (b.vus != null) lastVus = b.vus
    const sorted = b.durations.sort((x, y) => x - y)
    return {
      t: sec,
      vus: lastVus,
      rps: b.reqs,
      p95: round(percentile(sorted, 95)),
      errorRate: b.failedN ? round(b.failed / b.failedN, 4) : 0,
      checksRate: b.checksN ? round(b.checksPass / b.checksN, 4) : null,
      iterations: b.iterations,
    }
  }

  /** Renvoie les secondes complètes non encore émises (toutes si final = true). */
  function flush(final = false) {
    if (!buckets.size) return []
    const maxSec = Math.max(...buckets.keys())
    const upTo = final ? maxSec : maxSec - 1
    const out = []
    for (let s = emittedUpTo + 1; s <= upTo; s += 1) {
      out.push(summarizeBucket(s, buckets.get(s) || bucket(s)))
      buckets.delete(s)
    }
    if (upTo > emittedUpTo) emittedUpTo = upTo
    return out
  }

  /** Résumé au format --summary-export, reconstitué à partir du flux. */
  function toSummary(durationMs) {
    const sorted = [...total.durations].sort((x, y) => x - y)
    const secs = Math.max(1, (durationMs || 1000) / 1000)
    const failedRate = total.requests ? total.failed / total.requests : 0
    const checksN = total.checksPass + total.checksFail
    return {
      source: 'stream',
      metrics: {
        http_req_duration: {
          avg: total.seen ? total.sum / total.seen : 0,
          min: Number.isFinite(total.min) ? total.min : 0,
          med: percentile(sorted, 50) ?? 0,
          max: total.max,
          'p(90)': percentile(sorted, 90) ?? 0,
          'p(95)': percentile(sorted, 95) ?? 0,
          'p(99)': percentile(sorted, 99) ?? 0,
        },
        http_req_failed: { passes: total.failed, fails: total.requests - total.failed, value: failedRate },
        http_reqs: { count: total.requests, rate: total.requests / secs },
        iterations: { count: total.iterations, rate: total.iterations / secs },
        vus_max: { value: total.vusMax, min: 0, max: total.vusMax },
        checks: { passes: total.checksPass, fails: total.checksFail, value: checksN ? total.checksPass / checksN : 0 },
        data_received: { count: total.dataReceived, rate: total.dataReceived / secs },
        data_sent: { count: total.dataSent, rate: total.dataSent / secs },
      },
    }
  }

  return { addPoint, addLine, flush, toSummary, get pointsSeen() { return total.seen } }
}

/**
 * Suit un fichier NDJSON qui grossit : lit les octets ajoutés à intervalle régulier et
 * transmet les lignes complètes. Renvoie { poll(), stop() } ; poll() lit tout ce qui reste.
 */
export function tailFile(file, onLine, intervalMs = 1000) {
  let offset = 0
  let rest = ''
  let timer = null
  const decoder = new StringDecoder('utf8')
  function poll() {
    let fd
    try {
      fd = fs.openSync(file, 'r')
      const size = fs.fstatSync(fd).size
      while (offset < size) {
        const len = Math.min(size - offset, 1024 * 1024)
        const buf = Buffer.alloc(len)
        const read = fs.readSync(fd, buf, 0, len, offset)
        if (!read) break
        offset += read
        const text = rest + decoder.write(buf.subarray(0, read))
        const lines = text.split('\n')
        rest = lines.pop()
        for (const l of lines) onLine(l)
      }
    } catch { /* fichier pas encore créé */ } finally {
      if (fd !== undefined) fs.closeSync(fd)
    }
  }
  timer = setInterval(poll, intervalMs)
  return {
    poll,
    stop() {
      clearInterval(timer)
      poll()
      if (rest.trim()) onLine(rest)
      rest = ''
    },
  }
}

export const SERIES_LIMIT = MAX_SERIES

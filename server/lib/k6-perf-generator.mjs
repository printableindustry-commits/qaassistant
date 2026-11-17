/**
 * Génération des scripts k6 à partir des réponses du questionnaire (profil de campagne).
 *
 * Un script par profil : k6/scripts/<slug>.js. Le script lit VUS, DURATION et BASE_URL dans
 * __ENV, ce qui permet de surcharger la charge au lancement sans casser le modèle d'exécution
 * (contrairement à --vus/--duration qui remplacent les scénarios). Les parcours métier décrits
 * (« 70% consultation ») deviennent des parcours pondérés, chacun dans un group() étiqueté.
 * Une modification manuelle du script est détectée (empreinte) : on ne l'écrase jamais.
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { REPO_ROOT } from './paths.mjs'
import { runK6Scaffold, resolveK6Paths } from './k6-scaffold.mjs'
import { loadK6InitConfig } from './stack-install-config.mjs'
import { writeFileAtomic } from './perf/store.mjs'

const HASH_MARK = '// wizard-qa:empreinte='
const VUS_TOKEN = '"__VUS__"'
const DURATION_TOKEN = '"__DURATION__"'
const ITER_TOKEN = '"__VUS_X10__"'

function a(answers, key, fallback = '') {
  const v = answers?.[key]
  if (v == null || v === '') return fallback
  return v
}

/** Seuils k6 dérivés des réponses (forme simple : { métrique: ['p(95)<500', …] }). */
export function buildThresholdsFromAnswers(answers) {
  const p95 = Number(a(answers, 'p95Ms', 500)) || 500
  const p99 = Number(a(answers, 'p99Ms', 1000)) || 1000
  const errPct = Number(a(answers, 'maxErrorRate', 1)) || 1
  const thresholds = {
    http_req_duration: [`p(95)<${p95}`, `p(99)<${p99}`],
    http_req_failed: [`rate<${(errPct / 100).toFixed(4)}`],
    checks: ['rate>0.95'],
  }
  const minRps = Number(a(answers, 'minThroughputRps', 0))
  if (minRps > 0) thresholds.http_reqs = [`rate>=${minRps}`]
  return thresholds
}

/** Options k6 (scénario selon l'exécuteur, seuils, étiquettes). VUs et durée restent symboliques. */
export function buildK6OptionsFromAnswers(answers, { symbolic = false } = {}) {
  const executorType = a(answers, 'executorType', 'constant-vus')
  const vusValue = Number(a(answers, 'virtualUsers', 10)) || 10
  const vus = symbolic ? '__VUS__' : vusValue
  const duration = symbolic ? '__DURATION__' : a(answers, 'duration', '5m')
  const rampUp = a(answers, 'rampUpDuration', '1m')
  const rampDown = a(answers, 'rampDownDuration', '30s')
  const abortOnFail = a(answers, 'abortOnFail', 'yes') === 'yes'
  const maxDuration = a(answers, 'maxDurationCap', '2h')
  const arrivalRate = Number(a(answers, 'arrivalRate', 50)) || 50
  const thresholds = buildThresholdsFromAnswers(answers)

  const options = {
    thresholds: abortOnFail
      ? Object.fromEntries(Object.entries(thresholds).map(([metric, list]) => [
        metric,
        list.map((threshold) => ({ threshold, abortOnFail: true, delayAbortEval: '10s' })),
      ]))
      : thresholds,
    tags: {
      ...(a(answers, 'campaignObjective') ? { objective: String(a(answers, 'campaignObjective')) } : {}),
      ...(a(answers, 'environment') ? { env: String(a(answers, 'environment')) } : {}),
      ...parseTags(a(answers, 'reportTags', '')),
    },
    summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  }
  if (a(answers, 'tlsInsecure', 'no') === 'yes') options.insecureSkipTLSVerify = true

  const scenario = {
    'ramping-vus': () => ({
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: rampUp, target: vus },
        { duration, target: vus },
        { duration: rampDown, target: 0 },
      ],
      gracefulRampDown: rampDown,
    }),
    'constant-arrival-rate': () => ({
      executor: 'constant-arrival-rate',
      rate: arrivalRate,
      timeUnit: '1s',
      duration,
      preAllocatedVUs: vus,
      maxVUs: Number(a(answers, 'maxVUsCap', 500)) || 500,
    }),
    'shared-iterations': () => ({
      executor: 'shared-iterations',
      vus,
      iterations: symbolic ? '__VUS_X10__' : vusValue * 10,
      maxDuration,
    }),
    'per-vu-iterations': () => ({ executor: 'per-vu-iterations', vus, iterations: 10, maxDuration }),
  }[executorType]
  options.scenarios = {
    charge: scenario ? scenario() : { executor: 'constant-vus', vus, duration },
  }
  return options
}

function parseTags(text) {
  const tags = {}
  for (const line of String(text || '').split('\n')) {
    const t = line.trim()
    if (!t || !t.includes('=')) continue
    const [k, ...rest] = t.split('=')
    tags[k.trim()] = rest.join('=').trim()
  }
  return tags
}

/** En-têtes supplémentaires : une ligne « Nom: valeur » par en-tête. */
function parseHeaders(text) {
  const headers = {}
  for (const line of String(text || '').split('\n')) {
    const m = line.match(/^\s*([A-Za-z0-9-]+)\s*:\s*(.+?)\s*$/)
    if (m) headers[m[1]] = m[2]
  }
  return headers
}

/**
 * Parcours pondérés depuis « 70% consultation /produits » (une ligne par parcours).
 * Sans chemin explicite, les chemins d'entrée sont répartis entre les parcours.
 */
export function parseJourneys(answers) {
  const entryPaths = String(a(answers, 'entryPaths', '/'))
    .split('\n').map((p) => p.trim()).filter(Boolean)
  const lines = String(a(answers, 'scenarioDescription', '')).split('\n').map((l) => l.trim()).filter(Boolean)
  const journeys = []
  for (const line of lines) {
    const m = line.match(/^(\d+(?:[.,]\d+)?)\s*%\s*(.*)$/)
    if (!m) continue
    const rest = m[2]
    const pathMatch = rest.match(/(?:(GET|POST|PUT|PATCH|DELETE)\s+)?((?:https?:\/\/|\/)\S*)/i)
    const name = (pathMatch ? rest.replace(pathMatch[0], '') : rest).replace(/[:→-]+\s*$/, '').trim() || `parcours ${journeys.length + 1}`
    journeys.push({
      name,
      weight: Number(m[1].replace(',', '.')),
      method: (pathMatch?.[1] || 'GET').toUpperCase(),
      paths: pathMatch ? [pathMatch[2]] : [],
    })
  }
  if (!journeys.length) return [{ name: 'navigation', weight: 100, method: 'GET', paths: entryPaths }]
  const orphan = journeys.filter((j) => !j.paths.length)
  orphan.forEach((j, i) => {
    j.paths = entryPaths.filter((_, k) => k % orphan.length === i)
    if (!j.paths.length) j.paths = [entryPaths[i % entryPaths.length] || '/']
  })
  return journeys
}

// Littéral JS sûr (guillemets, barres obliques inverses, retours à la ligne, U+2028/U+2029).
const jsString = (v) => JSON.stringify(String(v)).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
// Texte tenant sur une seule ligne de commentaire (aucun terminateur de ligne JS).
const oneLine = (v) => String(v).replace(/[\r\n\u2028\u2029]+/g, ' ')

function authBlock(answers) {
  const authMode = a(answers, 'authMode', 'none')
  const tokenVar = String(a(answers, 'tokenEnvVar', 'AUTH_TOKEN')).replace(/[^A-Za-z0-9_]/g, '') || 'AUTH_TOKEN'
  const header = String(a(answers, 'authHeaderName', 'Authorization')).replace(/[^A-Za-z0-9-]/g, '') || 'Authorization'
  if (authMode === 'bearer' || authMode === 'oauth2') {
    return `  const token = __ENV.${tokenVar}
  if (token) headers['${header}'] = \`Bearer \${token}\``
  }
  if (authMode === 'basic') {
    return `  const user = __ENV.K6_BASIC_USER || ''
  if (user) headers.Authorization = 'Basic ' + encoding.b64encode(\`\${user}:\${__ENV.K6_BASIC_PASS || ''}\`)`
  }
  if (authMode === 'cookie') {
    return `  if (__ENV.SESSION_COOKIE) headers.Cookie = __ENV.SESSION_COOKIE`
  }
  return ''
}

/** Corps du script k6 (sans l'en-tête d'empreinte). */
export function buildScriptFromAnswers(answers, { profileName = '', baseUrl: fallbackUrl = '' } = {}) {
  const baseUrl = a(answers, 'baseUrl', fallbackUrl || 'https://quickpizza.grafana.com')
  const vus = Number(a(answers, 'virtualUsers', 10)) || 10
  const duration = a(answers, 'duration', '1m')
  const health = a(answers, 'healthCheckPath', '')
  const thinkMin = Number(a(answers, 'thinkTimeMin', 1)) || 0
  const thinkMax = Math.max(thinkMin, Number(a(answers, 'thinkTimeMax', 3)) || 0)
  const headers = {
    'User-Agent': a(answers, 'userAgent', 'WizardQA-k6/1.0'),
    Accept: 'application/json, text/html;q=0.9, */*;q=0.8',
    ...parseHeaders(a(answers, 'extraHeaders', '')),
  }
  const journeys = parseJourneys(answers)
  const options = JSON.stringify(buildK6OptionsFromAnswers(answers, { symbolic: true }), null, 2)
    .replaceAll(VUS_TOKEN, 'VUS')
    .replaceAll(DURATION_TOKEN, 'DURATION')
    .replaceAll(ITER_TOKEN, 'VUS * 10')
  const auth = authBlock(answers)

  return `// Script généré par Wizard QA pour le profil « ${oneLine(profileName)} ».
// Surcharges possibles : k6 run -e BASE_URL=… -e VUS=… -e DURATION=… <script>
import http from 'k6/http'
import { check, group, sleep } from 'k6'
${a(answers, 'authMode') === 'basic' ? "import encoding from 'k6/encoding'\n" : ''}
const BASE_URL = (__ENV.BASE_URL || ${jsString(baseUrl)}).replace(/\\/$/, '')
const VUS = Number(__ENV.VUS) || ${vus}
const DURATION = __ENV.DURATION || ${jsString(duration)}

export const options = ${options}

const HEADERS = ${JSON.stringify(headers, null, 2)}

// Parcours métier pondérés (poids = part du trafic).
const JOURNEYS = ${JSON.stringify(journeys, null, 2)}
const TOTAL_WEIGHT = JOURNEYS.reduce((sum, j) => sum + j.weight, 0)

function pickJourney() {
  let r = Math.random() * TOTAL_WEIGHT
  for (const j of JOURNEYS) {
    r -= j.weight
    if (r <= 0) return j
  }
  return JOURNEYS[JOURNEYS.length - 1]
}

function requestParams(journey) {
  const headers = Object.assign({}, HEADERS)
${auth}
  return { headers, tags: { parcours: journey.name } }
}

function think() {
  sleep(${thinkMin} + Math.random() * ${Math.max(0, thinkMax - thinkMin)})
}

export default function () {
  const journey = pickJourney()
  group(journey.name, () => {
    for (const p of journey.paths) {
      const url = p.startsWith('http') ? p : \`\${BASE_URL}\${p}\`
      const res = http.request(journey.method, url, null, requestParams(journey))
      check(res, {
        'statut 2xx/3xx': (r) => r.status >= 200 && r.status < 400,
        'corps non vide': (r) => r.body !== null && String(r.body).length > 0,
      })
    }
  })
  think()
}
${health ? `
export function setup() {
  const res = http.get(\`\${BASE_URL}${String(health).replace(/[`$\\]/g, '')}\`)
  if (res.status >= 400) console.warn(\`Vérification de santé en échec : \${res.status}\`)
  return { healthy: res.status < 400 }
}
` : ''}`
}

const sha = (text) => crypto.createHash('sha256').update(text).digest('hex').slice(0, 16)

export function slugify(name) {
  return String(name || 'profil')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'profil'
}

/**
 * Chemin relatif (à REPO_ROOT) du script d'un profil. Un profil enregistré reçoit un suffixe tiré
 * de son identifiant : deux profils de même nom (ou homonymes d'un profil intégré) ne partagent
 * jamais le même fichier.
 */
export function profileScriptRel(profile) {
  const k6Dir = resolveK6Paths(loadK6InitConfig()).k6Dir
  const idPart = String(profile.id || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toLowerCase()
  const suffix = !profile.builtin && idPart ? `-${idPart}` : ''
  return `${k6Dir}/scripts/${slugify(profile.name)}${suffix}.js`
}

/** Empreinte du corps d'un script, insensible aux fins de ligne (CRLF ajoutés par Git ou un éditeur). */
const bodyHash = (text) => sha(String(text).replace(/\r\n/g, '\n'))

/**
 * Écrit le script du profil. Si le fichier existant a été modifié à la main (empreinte qui ne
 * correspond plus), il est conservé et la version générée est écrite à côté (<slug>.generated.js).
 */
export function writeProfileScript(profile) {
  const body = buildScriptFromAnswers(profile.answers || {}, { profileName: profile.name })
  const content = `${HASH_MARK}${bodyHash(body)} (ne pas modifier cette ligne si vous éditez le script)\n${body}`
  const rel = profileScriptRel(profile)
  const abs = path.join(REPO_ROOT, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  if (fs.existsSync(abs)) {
    const current = fs.readFileSync(abs, 'utf8').replace(/^﻿/, '')
    const [first, ...rest] = current.split('\n')
    const stamped = first.startsWith(HASH_MARK) ? first.slice(HASH_MARK.length, HASH_MARK.length + 16) : null
    const edited = !stamped || stamped !== bodyHash(rest.join('\n'))
    if (edited) {
      const generatedRel = rel.replace(/\.js$/, '.generated.js')
      writeAtomic(path.join(REPO_ROOT, generatedRel), content)
      return { scriptPath: rel, generatedPath: generatedRel, manualEdits: true }
    }
    if (current === content) return { scriptPath: rel, manualEdits: false, unchanged: true }
  }
  writeAtomic(abs, content)
  return { scriptPath: rel, manualEdits: false }
}

function writeAtomic(file, content) {
  writeFileAtomic(file, content)
}

export function answersToInitPayload(answers) {
  return {
    projectName: a(answers, 'campaignName', 'Campagne-perf'),
    baseUrl: a(answers, 'baseUrl', 'https://app-recette.example.com'),
    defaultVus: Number(a(answers, 'virtualUsers', 10)) || 10,
    defaultDuration: a(answers, 'duration', '5m'),
    p95ThresholdMs: Number(a(answers, 'p95Ms', 500)) || 500,
  }
}

/**
 * Applique un profil : arborescence k6 (sans écraser la configuration globale), script du profil
 * et trace k6/profile.meta.json.
 */
export function applyK6ProfileToProject(profile) {
  const init = loadK6InitConfig()
  const scaffold = runK6Scaffold(init, REPO_ROOT)
  const written = writeProfileScript(profile)
  const answers = profile.answers || {}
  const k6Dir = resolveK6Paths(init).k6Dir
  const profileMetaPath = path.join(REPO_ROOT, k6Dir, 'profile.meta.json')
  writeAtomic(profileMetaPath, `${JSON.stringify({
    profileId: profile.id,
    profileName: profile.name,
    scriptPath: written.scriptPath,
    appliedAt: new Date().toISOString(),
    campaignObjective: answers.campaignObjective,
    environment: answers.environment,
  }, null, 2)}\n`)

  return {
    ok: true,
    scaffold,
    scriptPath: written.scriptPath,
    generatedPath: written.generatedPath || null,
    manualEdits: written.manualEdits,
    profileMetaPath: `${k6Dir}/profile.meta.json`,
    message: written.manualEdits
      ? `Profil « ${profile.name} » appliqué — ${written.scriptPath} modifié à la main est conservé ; nouvelle version dans ${written.generatedPath}.`
      : `Profil « ${profile.name} » appliqué — script ${written.scriptPath} généré.`,
  }
}

export function buildProfileSummary(answers) {
  return {
    campaignName: a(answers, 'campaignName'),
    objective: a(answers, 'campaignObjective'),
    environment: a(answers, 'environment'),
    baseUrl: a(answers, 'baseUrl'),
    vus: Number(a(answers, 'virtualUsers', 10)),
    duration: a(answers, 'duration'),
    p95Ms: Number(a(answers, 'p95Ms', 500)),
    executorType: a(answers, 'executorType'),
  }
}

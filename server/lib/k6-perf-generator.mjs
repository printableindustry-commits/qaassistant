import fs from 'fs'
import path from 'path'
import { REPO_ROOT } from './paths.mjs'
import { runK6Scaffold, resolveK6Paths } from './k6-scaffold.mjs'
import { saveK6InitConfig } from './k6-install-api.mjs'

function a(answers, key, fallback = '') {
  const v = answers?.[key]
  if (v == null || v === '') return fallback
  return v
}

function buildK6OptionsFromAnswers(answers) {
  const executorType = a(answers, 'executorType', 'constant-vus')
  const vus = Number(a(answers, 'virtualUsers', 10)) || 10
  const duration = a(answers, 'duration', '5m')
  const rampUp = a(answers, 'rampUpDuration', '1m')
  const rampDown = a(answers, 'rampDownDuration', '30s')
  const p95 = Number(a(answers, 'p95Ms', 500)) || 500
  const p99 = Number(a(answers, 'p99Ms', 1000)) || 1000
  const errPct = Number(a(answers, 'maxErrorRate', 1)) || 1
  const abortOnFail = a(answers, 'abortOnFail', 'yes') === 'yes'
  const maxDuration = a(answers, 'maxDurationCap', '2h')
  const arrivalRate = Number(a(answers, 'arrivalRate', 50)) || 50

  const thresholds = {
    http_req_duration: [`p(95)<${p95}`, `p(99)<${p99}`],
    http_req_failed: [`rate<${(errPct / 100).toFixed(4)}`],
  }
  const minRps = Number(a(answers, 'minThroughputRps', 0))
  if (minRps > 0) {
    thresholds.http_reqs = [`rate>=${minRps}`]
  }

  let scenarios = {}
  let options = {
    thresholds,
    tags: {
      ...(a(answers, 'campaignObjective') ? { objective: String(a(answers, 'campaignObjective')) } : {}),
      ...(a(answers, 'environment') ? { env: String(a(answers, 'environment')) } : {}),
      ...parseTags(a(answers, 'reportTags', '')),
    },
  }
  if (abortOnFail) {
    options.thresholds = Object.fromEntries(
      Object.entries(thresholds).map(([metric, list]) => [
        metric,
        list.map((threshold) => ({ threshold, abortOnFail: true, delayAbortEval: '10s' })),
      ]),
    )
  }
  if (a(answers, 'tlsInsecure', 'no') === 'yes') options.insecureSkipTLSVerify = true

  if (executorType === 'ramping-vus') {
    options.scenarios = {
      default: {
        executor: 'ramping-vus',
        startVUs: 0,
        stages: [
          { duration: rampUp, target: vus },
          { duration, target: vus },
          { duration: rampDown, target: 0 },
        ],
        gracefulRampDown: rampDown,
      },
    }
  } else if (executorType === 'constant-arrival-rate') {
    options.scenarios = {
      default: {
        executor: 'constant-arrival-rate',
        rate: arrivalRate,
        timeUnit: '1s',
        duration,
        preAllocatedVUs: Math.min(vus, 50),
        maxVUs: Number(a(answers, 'maxVUsCap', 500)) || 500,
      },
    }
  } else if (executorType === 'shared-iterations') {
    options.scenarios = {
      default: {
        executor: 'shared-iterations',
        vus,
        iterations: vus * 10,
        maxDuration,
      },
    }
  } else if (executorType === 'per-vu-iterations') {
    options.scenarios = {
      default: {
        executor: 'per-vu-iterations',
        vus,
        iterations: 10,
        maxDuration,
      },
    }
  } else {
    options.vus = vus
    options.duration = duration
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

function buildScriptFromAnswers(answers, paths) {
  const baseUrl = a(answers, 'baseUrl', paths.baseUrl).replace(/'/g, "\\'")
  const health = a(answers, 'healthCheckPath', '/health').replace(/'/g, "\\'")
  const pathsList = String(a(answers, 'entryPaths', '/\n/health'))
    .split('\n')
    .map((p) => p.trim())
    .filter(Boolean)
  const thinkMin = Number(a(answers, 'thinkTimeMin', 1)) || 1
  const thinkMax = Number(a(answers, 'thinkTimeMax', 3)) || 3
  const authMode = a(answers, 'authMode', 'none')
  const tokenVar = a(answers, 'tokenEnvVar', 'AUTH_TOKEN')
  const userAgent = a(answers, 'userAgent', 'WizardQA-k6/1.0').replace(/'/g, "\\'")
  const pathsJson = JSON.stringify(pathsList)

  const authHeader = String(a(answers, 'authHeaderName', 'Authorization')).replace(/[^A-Za-z0-9-]/g, '') || 'Authorization'
  const authBlock = authMode === 'bearer' ? `
  const token = __ENV.${tokenVar};
  if (token) params.headers['${authHeader}'] = \`Bearer \${token}\`;`
    : authMode === 'basic' ? `
  const user = __ENV.K6_BASIC_USER || '';
  const pass = __ENV.K6_BASIC_PASS || '';
  if (user) params.headers['Authorization'] = 'Basic ' + encoding.b64encode(\`\${user}:\${pass}\`);` : ''

  const options = buildK6OptionsFromAnswers(answers)
  const optionsJson = JSON.stringify(options, null, 2)

  return `import http from 'k6/http';
import { check, sleep } from 'k6';
${authMode === 'basic' ? "import encoding from 'k6/encoding';\n" : ''}
export const options = ${optionsJson};

const BASE_URL = __ENV.BASE_URL || '${baseUrl}';
const PATHS = ${pathsJson};
const HEALTH = '${health}';
const UA = '${userAgent}';

function think() {
  const min = ${thinkMin};
  const max = ${thinkMax};
  sleep(min + Math.random() * Math.max(0, max - min));
}

export default function () {
  const path = PATHS[Math.floor(Math.random() * PATHS.length)] || '/';
  const url = path.startsWith('http') ? path : \`\${BASE_URL}\${path}\`;
  const params = { headers: { 'User-Agent': UA, Accept: 'application/json, text/html' } };${authBlock}
  const res = http.get(url, params);
  check(res, {
    'status 2xx/3xx': (r) => r.status >= 200 && r.status < 400,
    'health ok': (r) => path.includes('health') ? r.status < 500 : true,
  });
  think();
}

export function setup() {
  const res = http.get(\`\${BASE_URL}\${HEALTH}\`);
  if (res.status >= 400) console.warn('Healthcheck failed:', res.status);
  return { ok: res.status < 400 };
}
`
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

export function applyK6ProfileToProject(profile) {
  const answers = profile.answers || {}
  saveK6InitConfig(answersToInitPayload(answers))

  const init = answersToInitPayload(answers)
  const paths = resolveK6Paths({
    projectName: init.projectName,
    baseUrl: init.baseUrl,
    defaultVus: init.defaultVus,
    defaultDuration: init.defaultDuration,
    p95ThresholdMs: init.p95ThresholdMs,
  })

  const scaffold = runK6Scaffold(init, REPO_ROOT)

  const scriptPath = path.join(REPO_ROOT, paths.smokeScript)
  const scriptContent = buildScriptFromAnswers(answers, paths)
  fs.mkdirSync(path.dirname(scriptPath), { recursive: true })
  fs.writeFileSync(scriptPath, scriptContent.endsWith('\n') ? scriptContent : `${scriptContent}\n`, 'utf8')

  const profileMetaPath = path.join(REPO_ROOT, paths.k6Dir, 'profile.meta.json')
  fs.mkdirSync(path.dirname(profileMetaPath), { recursive: true })
  fs.writeFileSync(profileMetaPath, `${JSON.stringify({
    profileId: profile.id,
    profileName: profile.name,
    appliedAt: new Date().toISOString(),
    campaignObjective: answers.campaignObjective,
    environment: answers.environment,
  }, null, 2)}\n`, 'utf8')

  return {
    ok: true,
    scaffold,
    scriptPath: paths.smokeScript,
    profileMetaPath: path.join(paths.k6Dir, 'profile.meta.json'),
    message: `Profil « ${profile.name} » appliqué — script ${paths.smokeScript} généré.`,
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

import fs from 'fs'
import path from 'path'

function slugName(name) {
  return String(name || 'MonProjet-perf')
    .trim()
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'MonProjet-perf'
}

export function resolveK6Paths(init = {}) {
  const projectName = slugName(init.projectName || 'MonProjet-perf')
  const k6Dir = String(init.k6Dir || 'k6').replace(/\\/g, '/')
  const baseUrl = String(init.baseUrl || 'https://app-recette.example.com').trim()
  const defaultVus = Number(init.defaultVus) || 5
  const defaultDuration = String(init.defaultDuration || '30s').trim() || '30s'
  const p95ThresholdMs = Number(init.p95ThresholdMs) || 500
  return {
    projectName,
    k6Dir,
    scriptsDir: `${k6Dir}/scripts`,
    libDir: `${k6Dir}/lib`,
    dataDir: `${k6Dir}/data`,
    reportsDir: 'reports/k6',
    smokeScript: `${k6Dir}/scripts/smoke.js`,
    optionsFile: `${k6Dir}/lib/options.js`,
    baseUrl,
    defaultVus,
    defaultDuration,
    p95ThresholdMs,
  }
}

export function buildK6OptionsModule(paths) {
  return `// Options partagées — importées par les scripts k6/
export const defaultOptions = {
  vus: ${paths.defaultVus},
  duration: ${JSON.stringify(paths.defaultDuration)},
  thresholds: {
    http_req_duration: ['p(95)<${paths.p95ThresholdMs}'],
    http_req_failed: ['rate<0.01'],
  },
};
`
}

export function buildK6SmokeScript(paths) {
  const baseUrl = JSON.stringify(paths.baseUrl)
  return `import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: ${paths.defaultVus},
  duration: ${JSON.stringify(paths.defaultDuration)},
  thresholds: {
    http_req_duration: ['p(95)<${paths.p95ThresholdMs}'],
    http_req_failed: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.BASE_URL || ${baseUrl};

export default function () {
  const res = http.get(\`\${BASE_URL}/\`);
  check(res, {
    'status 200': (r) => r.status === 200,
    'réponse < 1s': (r) => r.timings.duration < 1000,
  });
  sleep(1);
}
`
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true })
}

function writeFileIfMissing(filePath, content) {
  if (fs.existsSync(filePath)) {
    return { path: filePath, created: false }
  }
  ensureDir(path.dirname(filePath))
  fs.writeFileSync(filePath, content.endsWith('\n') ? content : `${content}\n`, 'utf8')
  return { path: filePath, created: true }
}

function appendGitignore(repoRoot, lines) {
  const gitignorePath = path.join(repoRoot, '.gitignore')
  const entries = lines.map((l) => l.trim()).filter(Boolean)
  let content = ''
  if (fs.existsSync(gitignorePath)) {
    content = fs.readFileSync(gitignorePath, 'utf8')
  }
  const missing = entries.filter((line) => !content.includes(line))
  if (!missing.length) return { updated: false, added: [] }
  const block = `${content.endsWith('\n') || !content ? '' : '\n'}# Wizard QA — k6 / performance\n${missing.join('\n')}\n`
  fs.writeFileSync(gitignorePath, content + block, 'utf8')
  return { updated: true, added: missing }
}

function mergePackageScripts(repoRoot, paths) {
  const pkgPath = path.join(repoRoot, 'package.json')
  if (!fs.existsSync(pkgPath)) return { updated: false, reason: 'package.json absent' }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  pkg.scripts = pkg.scripts || {}
  const script = paths.smokeScript.replace(/\\/g, '/')
  const baseUrl = paths.baseUrl
  const scripts = {
    'test:perf:smoke': `k6 run ${script} -e BASE_URL=${baseUrl}`,
    'test:perf:smoke:json': `k6 run ${script} -e BASE_URL=${baseUrl} --out json=${paths.reportsDir}/smoke.json`,
    'test:perf:reports:clean': `node -e "require('fs').rmSync('${paths.reportsDir}',{recursive:true,force:true}); require('fs').mkdirSync('${paths.reportsDir}',{recursive:true})"`,
  }
  let changed = false
  for (const [key, value] of Object.entries(scripts)) {
    if (!pkg.scripts[key]) {
      pkg.scripts[key] = value
      changed = true
    }
  }
  if (changed) {
    fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
  }
  return { updated: changed, scripts: Object.keys(scripts) }
}

export function runK6Scaffold(init, repoRoot) {
  const paths = resolveK6Paths(init)
  const abs = (rel) => path.resolve(repoRoot, rel)
  const created = []
  const skipped = []

  for (const dir of [paths.scriptsDir, paths.libDir, paths.dataDir, paths.reportsDir]) {
    ensureDir(abs(dir))
    if (!created.includes(dir)) created.push(dir)
  }

  const options = writeFileIfMissing(abs(paths.optionsFile), buildK6OptionsModule(paths))
  if (options.created) created.push(paths.optionsFile)
  else skipped.push(paths.optionsFile)

  const smoke = writeFileIfMissing(abs(paths.smokeScript), buildK6SmokeScript(paths))
  if (smoke.created) created.push(paths.smokeScript)
  else skipped.push(paths.smokeScript)

  const dataKeep = abs(path.join(paths.dataDir, '.gitkeep'))
  if (!fs.existsSync(dataKeep)) {
    fs.writeFileSync(dataKeep, '', 'utf8')
    created.push(path.join(paths.dataDir, '.gitkeep'))
  }

  const gitignore = appendGitignore(repoRoot, [
    'reports/k6/*.json',
    'reports/k6/*.html',
    'reports/k6/*.gz',
    'reports/k6/*/',
  ])

  const pkgScripts = mergePackageScripts(repoRoot, paths)

  return {
    ok: true,
    paths,
    created,
    skipped,
    gitignore,
    pkgScripts,
    message: skipped.length
      ? 'Arborescence k6 prête — certains fichiers existaient déjà (non écrasés).'
      : 'Arborescence k6 et script smoke créés.',
  }
}

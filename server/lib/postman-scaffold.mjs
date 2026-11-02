import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

function uuid() {
  return crypto.randomUUID()
}

function slugName(name) {
  return String(name || 'MonProjet-API')
    .trim()
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'MonProjet-API'
}

export function resolvePostmanPaths(init = {}) {
  const projectName = slugName(init.projectName || 'MonProjet-API')
  const envLabel = String(init.environmentLabel || 'recette').trim() || 'recette'
  const postmanDir = String(init.postmanDir || 'postman').replace(/\\/g, '/')
  const collectionsDir = `${postmanDir}/collections`
  const environmentsDir = `${postmanDir}/environments`
  const collectionFile = init.collectionFile
    || `${collectionsDir}/${projectName}.postman_collection.json`
  const environmentFile = init.environmentFile
    || `${environmentsDir}/${projectName}.${envLabel}.postman_environment.json`
  return {
    projectName,
    envLabel,
    postmanDir,
    collectionsDir,
    environmentsDir,
    dataDir: `${postmanDir}/data`,
    reportsDir: 'reports',
    collectionFile,
    environmentFile,
    baseUrl: String(init.baseUrl || 'https://api-recette.example.com').trim(),
  }
}

export function buildPostmanCollection({ projectName, baseUrl }) {
  const now = new Date().toISOString()
  return {
    info: {
      _postman_id: uuid(),
      name: `${projectName}`,
      description: `Collection API ${projectName} — générée par Wizard QA. Importez dans Postman Desktop, complétez les requêtes puis exportez vers Git.`,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item: [
      {
        name: 'Smoke',
        description: 'Campagne smoke — exécutable via Newman (--folder Smoke) ou Collection Runner Postman.',
        item: [
          {
            name: '01 — Healthcheck',
            request: {
              method: 'GET',
              header: [{ key: 'Accept', value: 'application/json' }],
              url: {
                raw: '{{baseUrl}}/health',
                host: ['{{baseUrl}}'],
                path: ['health'],
              },
              description: 'Vérification de disponibilité du service — adaptez le chemin à votre API.',
            },
            event: [
              {
                listen: 'test',
                script: {
                  type: 'text/javascript',
                  exec: [
                    "pm.test('Status 200 ou 204', function () {",
                    '  pm.expect(pm.response.code).to.be.oneOf([200, 204]);',
                    '});',
                  ],
                },
              },
            ],
          },
        ],
      },
    ],
    variable: [
      { key: 'baseUrl', value: baseUrl, type: 'string' },
    ],
    event: [],
    _postman_exported_at: now,
    _postman_exported_using: 'Wizard-QA-Assistant',
  }
}

export function buildPostmanEnvironment({ projectName, envLabel, baseUrl }) {
  const now = new Date().toISOString()
  return {
    id: uuid(),
    name: `${projectName} — ${envLabel}`,
    values: [
      { key: 'baseUrl', value: baseUrl, type: 'default', enabled: true },
      { key: 'authToken', value: '', type: 'default', enabled: true },
      { key: 'apiKey', value: 'REPLACE_ME', type: 'secret', enabled: true },
      { key: 'clientSecret', value: 'REPLACE_ME_IN_CI', type: 'secret', enabled: true },
    ],
    _postman_variable_scope: 'environment',
    _postman_exported_at: now,
    _postman_exported_using: 'Wizard-QA-Assistant',
  }
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true })
}

function writeJsonIfMissing(filePath, data) {
  if (fs.existsSync(filePath)) {
    return { path: filePath, created: false }
  }
  ensureDir(path.dirname(filePath))
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
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
  const block = `${content.endsWith('\n') || !content ? '' : '\n'}# Wizard QA — Postman / Newman\n${missing.join('\n')}\n`
  fs.writeFileSync(gitignorePath, content + block, 'utf8')
  return { updated: true, added: missing }
}

function mergePackageScripts(repoRoot, paths) {
  const pkgPath = path.join(repoRoot, 'package.json')
  if (!fs.existsSync(pkgPath)) return { updated: false, reason: 'package.json absent' }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  pkg.scripts = pkg.scripts || {}
  const coll = paths.collectionFile.replace(/\\/g, '/')
  const env = paths.environmentFile.replace(/\\/g, '/')
  const scripts = {
    'test:api:smoke': `newman run ${coll} -e ${env} --folder Smoke --reporters cli,htmlextra --reporter-htmlextra-export reports/smoke.html --bail true`,
    'test:api:reports:clean': 'node -e "require(\'fs\').rmSync(\'reports\',{recursive:true,force:true}); require(\'fs\').mkdirSync(\'reports\',{recursive:true})"',
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

export function runPostmanScaffold(init, repoRoot) {
  const paths = resolvePostmanPaths(init)
  const abs = (rel) => path.resolve(repoRoot, rel)
  const created = []
  const skipped = []

  for (const dir of [paths.collectionsDir, paths.environmentsDir, paths.dataDir, paths.reportsDir]) {
    ensureDir(abs(dir))
    created.push(dir)
  }

  const coll = writeJsonIfMissing(abs(paths.collectionFile), buildPostmanCollection(paths))
  if (coll.created) created.push(paths.collectionFile)
  else skipped.push(paths.collectionFile)

  const env = writeJsonIfMissing(abs(paths.environmentFile), buildPostmanEnvironment(paths))
  if (env.created) created.push(paths.environmentFile)
  else skipped.push(paths.environmentFile)

  const gitignore = appendGitignore(repoRoot, [
    'reports/*.html',
    'reports/*.xml',
    'reports/*.json',
    'postman/environments/*.local.postman_environment.json',
  ])

  const pkgScripts = mergePackageScripts(repoRoot, paths)

  const dataKeep = abs(path.join(paths.dataDir, '.gitkeep'))
  if (!fs.existsSync(dataKeep)) {
    ensureDir(path.dirname(dataKeep))
    fs.writeFileSync(dataKeep, '', 'utf8')
    created.push(path.join(paths.dataDir, '.gitkeep'))
  }

  return {
    ok: true,
    paths,
    created,
    skipped,
    gitignore,
    pkgScripts,
    message: skipped.length
      ? 'Arborescence prête — certains fichiers existaient déjà (non écrasés).'
      : 'Arborescence Postman et fichiers modèles créés.',
  }
}

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { extractJiraKey, detectGitRoot, repositoryPathFromUrl, normalizeRepositoryPath } from './wizard-core.mjs'
import { parseHooksConf, serializeHooksConf } from './hooks-conf-editor.mjs'
import { parseDefaultsFromConf } from './hook-config.mjs'

const LIB_DIR = path.dirname(fileURLToPath(import.meta.url))

function sanitizeNamePart(name) {
  return String(name || '')
    .trim()
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
}

function parseSuitesAndPlans(confContent) {
  const suites = []
  const plans = []
  let section = null
  let curSuite = null
  let curPlan = null

  for (const rawLine of confContent.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const sec = line.match(/^\[(.+)\]$/)
    if (sec) {
      section = sec[1]
      if (section === 'suite') curSuite = { suite_key: '', name: '' }
      if (section === 'plan') curPlan = { folder: '', plan_key: '', suite_key: '' }
      continue
    }
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    const val = line.slice(eq + 1).trim()
    if (section === 'suite' && curSuite) {
      if (key === 'suite_key') {
        if (curSuite.suite_key) {
          suites.push(curSuite)
          curSuite = { suite_key: val, name: '' }
        } else {
          curSuite.suite_key = val
        }
      } else if (key === 'name') {
        curSuite.name = val
      }
    } else if (section === 'plan' && curPlan) {
      if (key === 'folder') {
        if (curPlan.folder && curPlan.plan_key) {
          plans.push(curPlan)
          curPlan = { folder: val, plan_key: '', suite_key: '' }
        } else {
          curPlan.folder = val
        }
      } else {
        curPlan[key] = val
      }
    }
  }
  if (curSuite?.suite_key) suites.push(curSuite)
  if (curPlan?.folder && curPlan.plan_key) plans.push(curPlan)

  return { suites, plans }
}

function parsePlansFromConf(content) {
  const model = parseHooksConf(content)
  return model.sections
    .filter(s => s.type === 'plan')
    .map(sec => {
      const kv = Object.fromEntries(sec.lines.filter(l => l.type === 'kv').map(l => [l.key, l.value]))
      let testingBoardUrl = ''
      let repositoryPath = kv.repository_path || ''
      for (const l of sec.lines) {
        if (l.type !== 'comment') continue
        const raw = l.raw || ''
        const urlM = raw.match(/#\s*URL Testing Board\s*:\s*(.+)/i)
        if (urlM) testingBoardUrl = urlM[1].trim()
        const repoM = raw.match(/#\s*Plan\s+\S+\s*→\s*Testing Board\s*:\s*(.+)/i)
        if (repoM) repositoryPath = repoM[1].trim()
      }
      const folder = kv.folder || ''
      return {
        folder,
        plan_key: kv.plan_key || '',
        suite_key: kv.suite_key || '',
        repository_path: repositoryPath || (folder ? `/${folder}` : ''),
        testingBoardUrl,
      }
    })
    .filter(p => p.folder && p.plan_key)
}

function enrichPlanBoard(plan, jiraBaseUrl = '') {
  const folder = plan.folder?.trim()
  const plan_key = extractJiraKey(plan.plan_key || plan.planKey || '')
  const tbUrl = String(plan.testingBoardUrl || '').trim()
  let repositoryPath = repositoryPathFromUrl(tbUrl, folder)
  if (!repositoryPath) {
    repositoryPath = normalizeRepositoryPath(plan.repository_path || plan.repositoryPath || `/${folder}`, folder)
  }
  return { folder, plan_key, testingBoardUrl: tbUrl, repositoryPath }
}

export function savePlanBoards(hookDir, updates, jiraBaseUrl = '') {
  const confPath = path.join(hookDir, 'hooks.conf')
  if (!fs.existsSync(confPath)) throw new Error(`hooks.conf introuvable : ${confPath}`)

  const content = fs.readFileSync(confPath, 'utf8')
  const model = parseHooksConf(content)
  const byKey = new Map(
    (updates || []).map(u => [String(u.plan_key || u.planKey).toUpperCase(), enrichPlanBoard(u, jiraBaseUrl)]),
  )

  model.sections = model.sections.map(sec => {
    if (sec.type !== 'plan') return sec
    const kv = Object.fromEntries(sec.lines.filter(l => l.type === 'kv').map(l => [l.key, l.value]))
    const planKey = String(kv.plan_key || '').toUpperCase()
    const patch = byKey.get(planKey)
    if (!patch) return sec

    const commentLines = []
    if (patch.repositoryPath) {
      commentLines.push({ type: 'comment', raw: `# Plan ${planKey} → Testing Board : ${patch.repositoryPath}` })
    }
    if (patch.testingBoardUrl) {
      commentLines.push({ type: 'comment', raw: `# URL Testing Board : ${patch.testingBoardUrl}` })
    }

    const nonBoard = sec.lines.filter(l => {
      if (l.type === 'comment' && /testing board/i.test(l.raw || '')) return false
      if (l.type === 'kv' && l.key === 'repository_path') return false
      return true
    })
    const kvLines = nonBoard.filter(l => l.type === 'kv')
    const other = nonBoard.filter(l => l.type !== 'kv')
    if (patch.repositoryPath && patch.repositoryPath !== `/${kv.folder}`) {
      kvLines.push({ type: 'kv', key: 'repository_path', value: patch.repositoryPath })
    }

    return {
      ...sec,
      lines: [...commentLines, ...kvLines, ...other],
    }
  })

  fs.writeFileSync(confPath, serializeHooksConf(model), 'utf8')
  return { ok: true, updated: byKey.size }
}

export function getHookMeta(hookDir) {
  const confPath = path.join(hookDir, 'hooks.conf')
  if (!fs.existsSync(confPath)) {
    return { repoRoot: detectGitRoot(hookDir), suites: [], plans: [], confPath }
  }
  const content = fs.readFileSync(confPath, 'utf8')
  const { suites } = parseSuitesAndPlans(content)
  const plans = parsePlansFromConf(content)
  return {
    repoRoot: detectGitRoot(hookDir),
    confPath,
    suites: suites.filter(s => s.suite_key),
    plans: plans.filter(p => p.folder && p.plan_key),
  }
}

export function buildPlanFolderName(planKey, displayName) {
  const plan_key = extractJiraKey(planKey)
  if (!plan_key || !/^[A-Z][A-Z0-9]+-\d+$/i.test(plan_key)) {
    throw new Error('Clé JIRA invalide (ex. P0326-1234)')
  }
  const suffix = sanitizeNamePart(displayName)
  if (!suffix) throw new Error('Nom du plan requis')
  return { plan_key: plan_key.toUpperCase(), folder: `${plan_key.toUpperCase()}_${suffix}` }
}

export function createPlanFolder(hookDir, { planKey, name, suiteKey }) {
  const confPath = path.join(hookDir, 'hooks.conf')
  if (!fs.existsSync(confPath)) throw new Error(`hooks.conf introuvable : ${confPath}`)

  const meta = getHookMeta(hookDir)
  const { plan_key, folder } = buildPlanFolderName(planKey, name)

  if (meta.plans.some(p => p.plan_key === plan_key)) {
    throw new Error(`Le plan ${plan_key} est déjà dans hooks.conf`)
  }
  if (meta.plans.some(p => p.folder === folder)) {
    throw new Error(`Le dossier ${folder} est déjà déclaré dans hooks.conf`)
  }

  const folderPath = path.join(meta.repoRoot, folder)
  if (fs.existsSync(folderPath)) {
    throw new Error(`Le dossier existe déjà : ${folderPath}`)
  }

  let suite_key = suiteKey ? extractJiraKey(suiteKey) : ''
  if (!suite_key && meta.suites.length === 1) {
    suite_key = meta.suites[0].suite_key
  }
  if (!suite_key && meta.suites.length > 1) {
    throw new Error('Plusieurs suites — choisissez la suite parente')
  }
  if (suite_key && meta.suites.length && !meta.suites.some(s => s.suite_key === suite_key)) {
    throw new Error(`Suite ${suite_key} absente de hooks.conf`)
  }

  fs.mkdirSync(folderPath, { recursive: true })
  fs.writeFileSync(
    path.join(folderPath, 'README.md'),
    `# ${folder}\n\nPlan de test JIRA : **${plan_key}**\n\nPlacez vos fichiers \`.feature\` Cypress ici.\n`,
    'utf8',
  )

  const block = [
    '',
    `# Plan ${plan_key} — créé via portail (${new Date().toISOString().slice(0, 10)})`,
    '[plan]',
    `folder=${folder}`,
    `plan_key=${plan_key}`,
  ]
  if (suite_key) block.push(`suite_key=${suite_key}`)
  block.push('')

  const content = fs.readFileSync(confPath, 'utf8').trimEnd()
  fs.writeFileSync(confPath, `${content}\n${block.join('\n')}`, 'utf8')

  return {
    ok: true,
    plan_key,
    folder,
    folderPath,
    suite_key: suite_key || null,
    relativePath: folder,
  }
}

const PLAN_FOLDER_RE = /^[A-Z][A-Z0-9]+-\d+_/i

const SCAN_SKIP_DIRS = new Set([
  'node_modules', '.git', 'vendor', '.wizard-qa', '.github', '.vscode',
  '00_Scripts_Implementation', '2_Documentation', 'cypress', 'dist', 'build',
])

function readExcludeDirs(hookDir) {
  try {
    const confPath = path.join(hookDir, 'hooks.conf')
    if (!fs.existsSync(confPath)) return []
    const defaults = parseDefaultsFromConf(fs.readFileSync(confPath, 'utf8'))
    return String(defaults.exclude_dirs || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

export function scanLocalPlanFolders(hookDir) {
  const meta = getHookMeta(hookDir)
  const repoRoot = meta.repoRoot
  const hooked = new Set(meta.plans.map(p => p.folder))
  const hookDirName = path.basename(hookDir)
  const excludeDirs = new Set([...SCAN_SKIP_DIRS, hookDirName, ...readExcludeDirs(hookDir)])

  const folders = []
  if (!fs.existsSync(repoRoot)) {
    return { repoRoot, folders, plans: meta.plans, suites: meta.suites }
  }

  for (const entry of fs.readdirSync(repoRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const name = entry.name
    if (name.startsWith('.')) continue
    if (excludeDirs.has(name)) continue
    if (!PLAN_FOLDER_RE.test(name)) continue
    const plan_key = extractJiraKey(name)
    folders.push({
      folder: name,
      plan_key,
      inHook: hooked.has(name),
      exists: true,
    })
  }

  folders.sort((a, b) => a.folder.localeCompare(b.folder))
  return { repoRoot, folders, plans: meta.plans, suites: meta.suites }
}

export function removePlanFromConf(hookDir, folder) {
  const confPath = path.join(hookDir, 'hooks.conf')
  if (!fs.existsSync(confPath)) throw new Error(`hooks.conf introuvable : ${confPath}`)
  const model = parseHooksConf(fs.readFileSync(confPath, 'utf8'))
  const before = model.sections.filter(s => s.type === 'plan').length
  model.sections = model.sections.filter(sec => {
    if (sec.type !== 'plan') return true
    const kv = Object.fromEntries(sec.lines.filter(l => l.type === 'kv').map(l => [l.key, l.value]))
    return kv.folder !== folder
  })
  const after = model.sections.filter(s => s.type === 'plan').length
  if (before === after) throw new Error(`Plan « ${folder} » introuvable dans hooks.conf`)
  fs.writeFileSync(confPath, serializeHooksConf(model), 'utf8')
  return { ok: true, folder, removed: true }
}

export function registerPlanFolder(hookDir, { folder, suiteKey }) {
  const confPath = path.join(hookDir, 'hooks.conf')
  if (!fs.existsSync(confPath)) throw new Error(`hooks.conf introuvable : ${confPath}`)

  const meta = getHookMeta(hookDir)
  const folderPath = path.join(meta.repoRoot, folder)
  if (!fs.existsSync(folderPath)) throw new Error(`Dossier introuvable : ${folderPath}`)
  if (meta.plans.some(p => p.folder === folder)) {
    return { ok: true, folder, plan_key: meta.plans.find(p => p.folder === folder).plan_key, already: true }
  }

  const m = folder.match(/^([A-Z][A-Z0-9]+-\d+)/i)
  if (!m) throw new Error(`Nom de dossier invalide (attendu P0326-xxxx_…) : ${folder}`)
  const plan_key = m[1].toUpperCase()
  if (meta.plans.some(p => p.plan_key === plan_key)) {
    throw new Error(`Le plan ${plan_key} est déjà déclaré dans hooks.conf`)
  }

  let suite_key = suiteKey ? extractJiraKey(suiteKey) : ''
  if (!suite_key && meta.suites.length === 1) suite_key = meta.suites[0].suite_key
  if (!suite_key && meta.suites.length > 1) {
    throw new Error('Plusieurs suites — choisissez la suite parente')
  }

  const block = [
    '',
    `# Plan ${plan_key} — ajouté via Wizard QA (${new Date().toISOString().slice(0, 10)})`,
    '[plan]',
    `folder=${folder}`,
    `plan_key=${plan_key}`,
  ]
  if (suite_key) block.push(`suite_key=${suite_key}`)
  block.push('')

  const content = fs.readFileSync(confPath, 'utf8').trimEnd()
  fs.writeFileSync(confPath, `${content}\n${block.join('\n')}`, 'utf8')
  return { ok: true, plan_key, folder, folderPath, suite_key: suite_key || null }
}

export function listHookConfigFiles(hookDir) {
  const hookName = path.basename(hookDir)
  const rel = (p) => path.join(hookName, p).replace(/\\/g, '/')
  const abs = (p) => path.join(hookDir, p)

  const items = [
    {
      id: 'hooks.conf',
      label: 'hooks.conf',
      relativePath: rel('hooks.conf'),
      description: 'Configuration centrale du hook : [defaults] (projet, étiquette, terminal_mode), blocs [suite] et [plan] (dossiers VS Code, clés JIRA, Testing Board).',
      exists: fs.existsSync(abs('hooks.conf')),
    },
    {
      id: '.env',
      label: '.env',
      relativePath: rel('.env'),
      description: 'Credentials JIRA et Xray Cloud (URL, e-mail, tokens, proxy). Ne jamais commiter.',
      exists: fs.existsSync(abs('.env')),
    },
    {
      id: 'hook-debug.log',
      label: 'hook-debug.log',
      relativePath: rel('hook-debug.log'),
      description: 'Journal détaillé des exécutions du hook (mode silencieux ou traces complètes).',
      exists: fs.existsSync(abs('hook-debug.log')),
    },
    {
      id: 'hook-last-run.txt',
      label: 'hook-last-run.txt',
      relativePath: rel('hook-last-run.txt'),
      description: 'Résumé de la dernière synchronisation (modes A, C, D).',
      exists: fs.existsSync(abs('hook-last-run.txt')),
    },
    {
      id: 'hook-run.mjs',
      label: 'hook-run.mjs',
      relativePath: rel('hook-run.mjs'),
      description: 'Script principal lancé après commit : orchestration JIRA + Xray pour tous les plans.',
      exists: fs.existsSync(abs('hook-run.mjs')),
    },
    {
      id: 'install',
      label: 'install/',
      relativePath: rel('install/post-commit.template'),
      description: 'Modèles et scripts d\'installation du hook post-commit Git.',
      exists: fs.existsSync(abs('install/post-commit.template')),
    },
  ]
  return { hookDir, hookDirName: hookName, files: items }
}

export async function verifyPlansAgainstCloud(hookDir, runScript) {
  const meta = getHookMeta(hookDir)
  const results = []
  for (const plan of meta.plans) {
    const folderPath = path.join(meta.repoRoot, plan.folder)
    if (!fs.existsSync(folderPath)) {
      results.push({ folder: plan.folder, plan_key: plan.plan_key, ok: false, message: 'Dossier local absent' })
      continue
    }
    const jira = await runScript([
      'scripts/sync-jira.mjs',
      '--folder', plan.folder,
      '--plan-key', plan.plan_key,
      '--dry-run',
    ])
    const xray = await runScript([
      'scripts/xray-sync.mjs',
      '--folder', plan.folder,
      '--plan-key', plan.plan_key,
      '--dry-run',
    ])
    const ok = jira.code === 0 && xray.code === 0
    results.push({
      folder: plan.folder,
      plan_key: plan.plan_key,
      ok,
      message: ok ? 'OK' : 'KO',
      output: `${jira.output || ''}\n${xray.output || ''}`.trim(),
    })
  }
  const lines = results.map(r => `${r.folder} ${r.ok ? 'OK' : 'KO'}`)
  return { ok: results.every(r => r.ok), results, output: lines.join('\n') }
}

/** Catalogue des commandes exposées dans Sync JIRA (scripts du hook). */
export const HOOK_SYNC_COMMAND_DEFS = [
  {
    id: 'full-sync',
    group: 'global',
    label: 'Synchro complète',
    script: 'hook-run.mjs --force',
    description: 'Orchestration complète : tickets JIRA, Xray Cloud (Cucumber, Testing Board, plan) et rattachement des suites pour tous les plans hooks.conf.',
    danger: true,
    confirm: 'La synchronisation complète remplace le contenu JIRA/Xray par le local. Continuer ?',
  },
  {
    id: 'dry-run',
    group: 'global',
    label: 'Dry-run complet',
    script: 'hook-run.mjs --force --dry-run',
    description: 'Simulation de la synchro complète sans écriture (même enchaînement que le post-commit).',
  },
  {
    id: 'verify-cloud',
    group: 'global',
    label: 'Vérifier local ↔ Cloud',
    script: 'sync-jira.mjs + xray-sync.mjs (dry-run)',
    description: 'Compare chaque plan : dry-run sync-jira puis dry-run xray-sync.',
  },
  {
    id: 'sync-jira-all',
    group: 'global',
    label: 'Tickets JIRA (tous les plans)',
    script: 'scripts/sync-jira.mjs --delete-orphans',
    description: 'Réconciliation des tickets JIRA pour chaque plan déclaré dans hooks.conf.',
    danger: true,
    confirm: 'Réconcilier tous les tickets JIRA depuis le local ? Les orphelins seront supprimés.',
  },
  {
    id: 'xray-sync-all',
    group: 'global',
    label: 'Xray Cloud (tous les plans)',
    script: 'scripts/xray-sync.mjs',
    description: 'Cucumber, Gherkin, Testing Board et plan de test Xray pour chaque plan.',
    danger: true,
    confirm: 'Synchroniser tout le contenu Xray depuis le local pour tous les plans ?',
  },
  {
    id: 'sync-test-suite',
    group: 'global',
    label: 'Rattacher les suites',
    script: 'scripts/sync-test-suite.mjs',
    description: 'Rattache tous les plans de test à leurs suites JIRA déclarées dans hooks.conf.',
  },
  {
    id: 'hook-status',
    group: 'global',
    label: 'Statut dernière exécution',
    script: 'hook-status.mjs',
    description: 'Affiche le rapport hook-last-run (dernier commit ou synchro forcée).',
  },
  {
    id: 'sync-jira',
    group: 'plan',
    label: 'Tickets JIRA',
    script: 'scripts/sync-jira.mjs --delete-orphans',
    description: 'Création, mise à jour et suppression des tickets JIRA pour un plan.',
    danger: true,
  },
  {
    id: 'xray-sync',
    group: 'plan',
    label: 'Xray Cloud',
    script: 'scripts/xray-sync.mjs',
    description: 'Cucumber, Testing Board et plan de test Xray pour un plan.',
    danger: true,
  },
  {
    id: 'sync-test-suite-one',
    group: 'suite',
    label: 'Rattacher la suite',
    script: 'scripts/sync-test-suite.mjs --suite-key …',
    description: 'Rattache les plans d\'une suite JIRA à leur suite de test.',
  },
]

export function getHookCommandCatalog(hookDir) {
  const meta = getHookMeta(hookDir)
  return {
    commands: HOOK_SYNC_COMMAND_DEFS,
    plans: meta.plans,
    suites: meta.suites,
    hookDirName: path.basename(hookDir),
    repoRoot: meta.repoRoot,
  }
}

function findPlanInMeta(meta, planKey) {
  const key = String(planKey || '').trim().toUpperCase()
  const plan = meta.plans.find(p => String(p.plan_key || '').toUpperCase() === key)
  if (!plan) throw new Error(`Plan ${planKey} introuvable dans hooks.conf`)
  return plan
}

async function runAllPlansScript(meta, runScript, scriptRel, { dryRun, extraArgs = [] } = {}) {
  let output = ''
  let ok = true
  for (const plan of meta.plans) {
    const args = [scriptRel, '--folder', plan.folder, '--plan-key', plan.plan_key, ...extraArgs]
    if (dryRun) args.push('--dry-run')
    const r = await runScript(args)
    output += `\n── ${plan.plan_key} (${plan.folder}) ──\n${r.output || ''}`
    if (r.code !== 0) ok = false
  }
  return { code: ok ? 0 : 1, output: output.trim(), ok }
}

export async function executeHookCommand(hookDir, runScript, { commandId, planKey, suiteKey, dryRun = false } = {}) {
  const meta = getHookMeta(hookDir)
  const wrap = async (args) => {
    const r = await runScript(args)
    return { ...r, ok: r.code === 0 }
  }

  switch (commandId) {
    case 'full-sync':
      return wrap(['hook-run.mjs', '--force'])
    case 'dry-run':
      return wrap(['hook-run.mjs', '--force', '--dry-run'])
    case 'verify-cloud':
      return verifyPlansAgainstCloud(hookDir, runScript)
    case 'hook-status':
      return wrap(['hook-status.mjs'])
    case 'sync-test-suite': {
      const args = ['scripts/sync-test-suite.mjs']
      if (dryRun) args.push('--dry-run')
      return wrap(args)
    }
    case 'sync-test-suite-one': {
      const sk = String(suiteKey || '').trim().toUpperCase()
      if (!sk) throw new Error('suite_key requis')
      const args = ['scripts/sync-test-suite.mjs', '--suite-key', sk]
      if (dryRun) args.push('--dry-run')
      return wrap(args)
    }
    case 'sync-jira-all':
      return runAllPlansScript(meta, runScript, 'scripts/sync-jira.mjs', {
        dryRun,
        extraArgs: ['--delete-orphans'],
      })
    case 'xray-sync-all':
      return runAllPlansScript(meta, runScript, 'scripts/xray-sync.mjs', { dryRun })
    case 'sync-jira': {
      const plan = findPlanInMeta(meta, planKey)
      const args = ['scripts/sync-jira.mjs', '--folder', plan.folder, '--plan-key', plan.plan_key, '--delete-orphans']
      if (dryRun) args.push('--dry-run')
      return wrap(args)
    }
    case 'xray-sync': {
      const plan = findPlanInMeta(meta, planKey)
      const args = ['scripts/xray-sync.mjs', '--folder', plan.folder, '--plan-key', plan.plan_key]
      if (dryRun) args.push('--dry-run')
      return wrap(args)
    }
    default:
      throw new Error(`Commande inconnue : ${commandId}`)
  }
}

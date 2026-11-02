import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { CONF_DIR, HOOK_DIR, REPO_ROOT } from './paths.mjs'
import { loadWizardDefaults, saveWizardDefaults } from './wizard-defaults.mjs'
import { loadHookConfig } from './hook-config.mjs'
import { writePriseConnaissanceSnapshot, updatePriseConnaissanceSnapshot } from './onboarding-snapshot.mjs'
import { syncProfileCredentialsToHook } from './hook-credentials-sync.mjs'
import { getDemoFormDefaults } from './demo-defaults.mjs'

export { getDemoFormDefaults }

const META_FILE = 'project.meta.json'
const VARIABLES_FILE = 'project.variables.json'

function sanitizeSegment(value, fallback = 'Plan_de_Test') {
  return String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '') || fallback
}

function normalizeProductCode(code) {
  const v = String(code || '').trim().toUpperCase()
  if (!/^P\d{4}$/.test(v)) {
    throw new Error('Code produit invalide : P majuscule suivi de 4 chiffres (ex. P0326)')
  }
  return v
}

function normalizeSolutionCode(code) {
  const v = String(code || '').trim().toUpperCase()
  if (!/^S\d{4}$/.test(v)) {
    throw new Error('Code solution invalide : S majuscule suivi de 4 chiffres (ex. S0998)')
  }
  return v
}

export function normalizePlanKey(key, productCode = null) {
  const v = String(key || '').trim().toUpperCase()
  if (!/^[A-Z][A-Z0-9]+-\d+$/i.test(v)) {
    throw new Error('ID plan de test invalide (ex. P0326-10528)')
  }
  if (productCode) {
    const product = normalizeProductCode(productCode)
    if (!v.startsWith(`${product}-`)) {
      throw new Error(`ID plan doit commencer par ${product}-`)
    }
  }
  return v
}

/** Dossier VS Code : P0326-10528_Plan_de_Test */
export function buildPlanFolderName(planKey, planName, productCode = null) {
  const key = normalizePlanKey(planKey, productCode)
  const name = sanitizeSegment(planName, 'Plan_de_Test')
  return `${key}_${name}`
}

export function emptyProjectProfile() {
  return {
    onboardingComplete: false,
    tribu: 'IT pour CA-TS',
    squad: 'Risk pour CA-TS',
    baName: '',
    poName: '',
    scrumMasterName: '',
    qaName: '',
    productCode: '',
    solutionCode: '',
    applicationLabel: '',
    gitRepository: '',
    usesJiraPlans: null,
    jiraBaseUrl: 'https://jirasoftware-cats.atlassian.net',
    xrayClientId: getDemoFormDefaults().xrayClientId,
    xrayClientSecret: getDemoFormDefaults().xrayClientSecret,
    testPlans: [],
    variablesPath: '',
    arborescences: [],
    onboardingCompletedAt: null,
    recommendedStack: '',
    stackRecommendationComplete: false,
    stackRecommendationCompletedAt: null,
    onboardingSnapshotPath: '',
  }
}

/** Racine du dépôt Git où l'utilisateur travaille (workspace VS Code). */
export function resolveGitRepository(input, profile = null) {
  const fromInput = String(input?.gitRepository || input?.repoRoot || '').trim()
  if (fromInput) return fromInput
  const fromProfile = String(profile?.gitRepository || '').trim()
  if (fromProfile) return fromProfile
  return REPO_ROOT
}

export function getProjectProfile() {
  const wizard = loadWizardDefaults()
  return { ...emptyProjectProfile(), ...(wizard.project || {}) }
}

export function saveProjectProfile(patch) {
  const current = getProjectProfile()
  const merged = {
    ...current,
    ...patch,
    testPlans: patch.testPlans ?? current.testPlans,
    arborescences: patch.arborescences ?? current.arborescences,
  }
  return saveWizardDefaults({ project: merged }).project
}

export function getJiraSyncSettings() {
  const profile = getProjectProfile()
  let jiraBaseUrl = profile.jiraBaseUrl || ''
  let xrayClientId = profile.xrayClientId || ''
  let xrayClientSecret = profile.xrayClientSecret || ''

  if ((!xrayClientId || !xrayClientSecret || !jiraBaseUrl) && fs.existsSync(HOOK_DIR)) {
    try {
      const hook = loadHookConfig(HOOK_DIR)
      if (!jiraBaseUrl) jiraBaseUrl = hook.env.JIRA_BASE_URL || ''
      if (!xrayClientId) xrayClientId = hook.env.XRAY_CLIENT_ID || ''
      if (!xrayClientSecret) xrayClientSecret = hook.env.XRAY_CLIENT_SECRET || ''
    } catch { /* ignore */ }
  }

  return {
    jiraBaseUrl: jiraBaseUrl || 'https://jirasoftware-cats.atlassian.net',
    xrayClientId,
    xrayClientSecret,
  }
}

function profileAsVariableInput(profile) {
  const jira = getJiraSyncSettings()
  return {
    productCode: profile.productCode,
    solutionCode: profile.solutionCode,
    poName: profile.poName,
    baName: profile.baName,
    scrumMasterName: profile.scrumMasterName,
    qaName: profile.qaName,
    tribu: profile.tribu,
    squad: profile.squad,
    applicationLabel: profile.applicationLabel,
    gitRepository: resolveGitRepository(null, profile),
    usesJiraPlans: profile.usesJiraPlans,
    testPlans: profile.testPlans,
    jiraBaseUrl: profile.jiraBaseUrl || jira.jiraBaseUrl,
    xrayClientId: profile.xrayClientId || jira.xrayClientId,
    xrayClientSecret: profile.xrayClientSecret || jira.xrayClientSecret,
  }
}

export function buildProjectVariables(input) {
  return {
    $PRODUIT: input.productCode ? normalizeProductCode(input.productCode) : '',
    $SOLUTION: input.solutionCode ? normalizeSolutionCode(input.solutionCode) : '',
    $PRODUCTOWNER: String(input.poName || '').trim(),
    $BUSINESSANALYST: String(input.baName || '').trim(),
    $SCRUMMASTER: String(input.scrumMasterName || '').trim(),
    $QATESTER: String(input.qaName || '').trim(),
    $TRIBU: String(input.tribu || 'IT pour CA-TS').trim(),
    $SQUAD: String(input.squad || 'Risk pour CA-TS').trim(),
    $APPLICATION: String(input.applicationLabel || '').trim(),
    $GIT_REPOSITORY: String(input.gitRepository || REPO_ROOT).trim(),
    $USES_JIRA_PLANS: Boolean(input.usesJiraPlans),
    $JIRA_BASE_URL: String(input.jiraBaseUrl || '').trim(),
    $XRAY_CLIENT_ID: String(input.xrayClientId || '').trim(),
    $XRAY_CLIENT_SECRET: String(input.xrayClientSecret || '').trim(),
  }
}

export function writeProjectVariablesFile(input) {
  fs.mkdirSync(CONF_DIR, { recursive: true })
  const variables = buildProjectVariables(input)
  const productCode = input.productCode ? normalizeProductCode(input.productCode) : null
  const testPlans = input.usesJiraPlans
    ? (input.testPlans || []).map(p => ({
      planKey: p.planKey ? normalizePlanKey(p.planKey, productCode) : '',
      planName: String(p.planName || '').trim(),
      folderName: p.planKey && p.planName
        ? buildPlanFolderName(p.planKey, p.planName, productCode)
        : '',
      testingBoardUrl: String(p.testingBoardUrl || '').trim(),
    }))
    : []

  const gitRepository = String(input.gitRepository || REPO_ROOT).trim()

  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    variables,
    workspace: {
      gitRepository,
    },
    jiraSync: {
      jiraBaseUrl: String(input.jiraBaseUrl || '').trim(),
      xrayClientId: String(input.xrayClientId || '').trim(),
      xrayClientSecret: String(input.xrayClientSecret || '').trim(),
    },
    testPlans,
  }

  const absPath = path.join(CONF_DIR, VARIABLES_FILE)
  fs.writeFileSync(absPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  return {
    path: absPath,
    relativePath: path.relative(REPO_ROOT, absPath).replace(/\\/g, '/'),
    payload,
  }
}

function readMeta(folderPath) {
  const metaPath = path.join(folderPath, META_FILE)
  if (!fs.existsSync(metaPath)) return null
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf8'))
  } catch {
    return null
  }
}

function writeMeta(folderPath, meta) {
  fs.writeFileSync(
    path.join(folderPath, META_FILE),
    `${JSON.stringify(meta, null, 2)}\n`,
    'utf8',
  )
}

function isPlanFolderName(name) {
  return /^[A-Z][A-Z0-9]+-\d+_/i.test(name)
}

export function listArborescences() {
  const profile = getProjectProfile()
  const fromProfile = profile.arborescences || []
  const discovered = []

  if (fs.existsSync(REPO_ROOT)) {
    for (const entry of fs.readdirSync(REPO_ROOT, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      if (!isPlanFolderName(entry.name)) continue
      const full = path.join(REPO_ROOT, entry.name)
      const meta = readMeta(full)
      discovered.push({
        id: meta?.id || entry.name,
        folderName: entry.name,
        folderPath: full,
        relativePath: entry.name,
        existsOnDisk: true,
        meta: meta || null,
        planKey: meta?.planKey || entry.name.split('_')[0],
        planName: meta?.planName || '',
      })
    }
  }

  const merged = new Map()
  for (const item of fromProfile) {
    const full = path.join(REPO_ROOT, item.folderName)
    merged.set(item.folderName, {
      ...item,
      folderPath: full,
      relativePath: item.folderName,
      existsOnDisk: fs.existsSync(full),
    })
  }
  for (const item of discovered) {
    if (!merged.has(item.folderName)) merged.set(item.folderName, item)
  }
  return [...merged.values()].sort((a, b) => a.folderName.localeCompare(b.folderName, 'fr'))
}

export function createPlanFolder(input) {
  const productCode = normalizeProductCode(input.productCode)
  const solutionCode = normalizeSolutionCode(input.solutionCode)
  const planKey = normalizePlanKey(input.planKey || input.planId, productCode)
  const planName = String(input.planName || '').trim()
  if (!planName) throw new Error('Nom du plan de test requis')

  const folderName = buildPlanFolderName(planKey, planName, productCode)
  const folderPath = path.join(REPO_ROOT, folderName)

  if (fs.existsSync(folderPath)) {
    throw new Error(`Le dossier existe déjà : ${folderName}`)
  }

  fs.mkdirSync(folderPath, { recursive: true })

  const record = {
    id: randomUUID(),
    folderName,
    productCode,
    solutionCode,
    planKey,
    planName,
    baName: String(input.baName || '').trim(),
    poName: String(input.poName || '').trim(),
    scrumMasterName: String(input.scrumMasterName || '').trim(),
    qaName: String(input.qaName || '').trim(),
    tribu: input.tribu || 'IT pour CA-TS',
    squad: input.squad || 'Risk pour CA-TS',
    applicationLabel: String(input.applicationLabel || '').trim(),
    createdAt: new Date().toISOString(),
  }

  writeMeta(folderPath, record)

  fs.writeFileSync(
    path.join(folderPath, 'README.md'),
    `# ${folderName}\n\n` +
      `Plan JIRA : **${planKey}** — ${planName}\n\n` +
      `| Champ | Valeur |\n|-------|--------|\n` +
      `| TRIBU | ${record.tribu} |\n` +
      `| Squad | ${record.squad} |\n` +
      `| Product Owner | ${record.poName || '—'} |\n` +
      `| Business Analyst | ${record.baName || '—'} |\n` +
      `| Scrum Master | ${record.scrumMasterName || '—'} |\n` +
      `| QA / Tester | ${record.qaName || '—'} |\n` +
      `| Code produit | ${productCode} |\n` +
      `| Code solution | ${solutionCode} |\n\n` +
      `Placez vos fichiers \`.feature\` et scénarios de test dans ce dossier.\n`,
    'utf8',
  )

  return { record, folderPath, relativePath: folderName }
}

export function addPlanFolder(input) {
  const result = createPlanFolder(input)
  const profile = getProjectProfile()
  const testPlans = [
    ...(profile.testPlans || []),
    {
      planKey: result.record.planKey,
      planName: result.record.planName,
      folderName: result.record.folderName,
    },
  ]
  const project = saveProjectProfile({
    arborescences: [...(profile.arborescences || []), result.record],
    testPlans,
  })
  return { ...result, project }
}

/** @deprecated alias */
export function createArborescence(input) {
  return addPlanFolder(input)
}

export function completeOnboarding(input) {
  const productCode = normalizeProductCode(input.productCode)
  const solutionCode = normalizeSolutionCode(input.solutionCode)
  const poName = String(input.poName || '').trim()
  const baName = String(input.baName || '').trim()
  if (!poName) throw new Error('Product Owner requis')
  if (!baName) throw new Error('Business Analyst requis')

  const usesJiraPlans = Boolean(input.usesJiraPlans)
  const testPlans = usesJiraPlans ? (input.testPlans || []) : []

  if (usesJiraPlans) {
    if (!testPlans.length) throw new Error('Ajoutez au moins un plan de test JIRA')
    for (const p of testPlans) {
      if (!p.planKey?.trim() || !p.planName?.trim()) {
        throw new Error('Chaque plan doit avoir un ID JIRA et un nom')
      }
      normalizePlanKey(p.planKey, productCode)
    }
  }

  const gitRepository = resolveGitRepository(input, getProjectProfile())

  const vars = writeProjectVariablesFile({
    ...input,
    productCode,
    solutionCode,
    gitRepository,
    usesJiraPlans,
    testPlans,
    jiraBaseUrl: input.jiraBaseUrl || getJiraSyncSettings().jiraBaseUrl,
    xrayClientId: input.xrayClientId || '',
    xrayClientSecret: input.xrayClientSecret || '',
  })

  const createdFolders = []
  if (usesJiraPlans) {
    for (const plan of testPlans) {
      createdFolders.push(createPlanFolder({
        ...input,
        productCode,
        solutionCode,
        planKey: plan.planKey,
        planName: plan.planName,
      }))
    }
  }

  const arborescences = [
    ...(getProjectProfile().arborescences || []),
    ...createdFolders.map(f => f.record),
  ]

  const project = saveProjectProfile({
    onboardingComplete: true,
    onboardingCompletedAt: new Date().toISOString(),
    tribu: input.tribu || 'IT pour CA-TS',
    squad: input.squad || 'Risk pour CA-TS',
    baName,
    poName,
    scrumMasterName: String(input.scrumMasterName || '').trim(),
    qaName: String(input.qaName || '').trim(),
    productCode,
    solutionCode,
    applicationLabel: String(input.applicationLabel || '').trim(),
    gitRepository,
    usesJiraPlans,
    jiraBaseUrl: String(input.jiraBaseUrl || getJiraSyncSettings().jiraBaseUrl).trim(),
    xrayClientId: String(input.xrayClientId || '').trim(),
    xrayClientSecret: String(input.xrayClientSecret || '').trim(),
    testPlans: testPlans.map(p => ({
      planKey: normalizePlanKey(p.planKey, productCode),
      planName: String(p.planName).trim(),
      folderName: buildPlanFolderName(p.planKey, p.planName, productCode),
      testingBoardUrl: String(p.testingBoardUrl || '').trim(),
    })),
    variablesPath: vars.relativePath,
    arborescences,
    onboardingSnapshotPath: '',
  })

  const snapshot = writePriseConnaissanceSnapshot(
    {
      ...input,
      productCode,
      solutionCode,
      gitRepository,
      usesJiraPlans,
      testPlans: testPlans.map(p => ({
        planKey: normalizePlanKey(p.planKey, productCode),
        planName: String(p.planName).trim(),
        testingBoardUrl: String(p.testingBoardUrl || '').trim(),
      })),
    },
    {
      variablesPath: vars.relativePath,
      foldersCreated: createdFolders.map(f => ({
        folderName: f.record?.folderName || f.folderName,
        relativePath: f.record?.relativePath || f.relativePath,
      })),
    },
  )

  const projectWithSnapshot = saveProjectProfile({
    onboardingSnapshotPath: snapshot.relativePath,
  })

  const finalProject = { ...projectWithSnapshot, onboardingSnapshotPath: snapshot.relativePath }
  const hookSync = syncProfileCredentialsToHook(finalProject)

  return {
    project: finalProject,
    hookSync,
    variables: vars.payload,
    configPath: vars.relativePath,
    snapshotPath: snapshot.relativePath,
    snapshot: snapshot.payload,
    folders: createdFolders,
    arborescence: createdFolders[0]?.record || null,
  }
}

/** Mise à jour des paramètres projet — régénère project.variables.json sans créer de dossiers. */
export function updateProjectSettings(input) {
  const profile = getProjectProfile()
  if (!profile.onboardingComplete) {
    throw new Error('Configuration initiale non terminée — terminez d\'abord la prise de connaissance')
  }

  const productCode = normalizeProductCode(input.productCode)
  const solutionCode = normalizeSolutionCode(input.solutionCode)
  const poName = String(input.poName || '').trim()
  const baName = String(input.baName || '').trim()
  if (!poName) throw new Error('Product Owner requis')
  if (!baName) throw new Error('Business Analyst requis')

  const usesJiraPlans = Boolean(input.usesJiraPlans)
  let testPlans = usesJiraPlans ? (input.testPlans || []) : []

  if (usesJiraPlans) {
    if (!testPlans.length) throw new Error('Ajoutez au moins un plan de test JIRA')
    for (const p of testPlans) {
      if (!p.planKey?.trim() || !p.planName?.trim()) {
        throw new Error('Chaque plan doit avoir un ID JIRA et un nom')
      }
      normalizePlanKey(p.planKey, productCode)
    }
    testPlans = testPlans.map(p => ({
      planKey: normalizePlanKey(p.planKey, productCode),
      planName: String(p.planName).trim(),
      folderName: buildPlanFolderName(p.planKey, p.planName, productCode),
      testingBoardUrl: String(p.testingBoardUrl || '').trim(),
    }))
  }

  const gitRepository = resolveGitRepository(input, profile)

  const vars = writeProjectVariablesFile({
    ...input,
    productCode,
    solutionCode,
    gitRepository,
    usesJiraPlans,
    testPlans,
    jiraBaseUrl: input.jiraBaseUrl || getJiraSyncSettings().jiraBaseUrl,
    xrayClientId: input.xrayClientId || '',
    xrayClientSecret: input.xrayClientSecret || '',
  })

  const project = saveProjectProfile({
    tribu: input.tribu || 'IT pour CA-TS',
    squad: input.squad || 'Risk pour CA-TS',
    baName,
    poName,
    scrumMasterName: String(input.scrumMasterName || '').trim(),
    qaName: String(input.qaName || '').trim(),
    productCode,
    solutionCode,
    applicationLabel: String(input.applicationLabel || '').trim(),
    gitRepository,
    usesJiraPlans,
    jiraBaseUrl: String(input.jiraBaseUrl || getJiraSyncSettings().jiraBaseUrl).trim(),
    xrayClientId: String(input.xrayClientId || '').trim(),
    xrayClientSecret: String(input.xrayClientSecret || '').trim(),
    testPlans,
    variablesPath: vars.relativePath,
  })

  updatePriseConnaissanceSnapshot(
    {
      ...input,
      productCode,
      solutionCode,
      gitRepository,
      usesJiraPlans,
      testPlans,
    },
    { variablesPath: vars.relativePath },
  )

  return {
    project,
    variables: vars.payload,
    configPath: vars.relativePath,
    hookSync: syncProfileCredentialsToHook(project),
  }
}

/** Sauvegarde connexion JIRA/Xray + URLs Testing Board — régénère project.variables.json */
export function saveJiraSyncSettings(input) {
  const profile = getProjectProfile()
  if (!profile.onboardingComplete) {
    throw new Error('Terminez d\'abord la prise de connaissance')
  }

  const jiraBaseUrl = String(input.jiraBaseUrl || getJiraSyncSettings().jiraBaseUrl).trim()
  const xrayClientId = String(input.xrayClientId || '').trim()
  const xrayClientSecret = String(input.xrayClientSecret || '').trim()

  let testPlans = profile.testPlans || []
  if (Array.isArray(input.testPlans)) {
    const byKey = new Map(input.testPlans.map(p => [String(p.planKey || '').toUpperCase(), p]))
    testPlans = testPlans.map(p => {
      const patch = byKey.get(String(p.planKey || '').toUpperCase())
      return patch
        ? { ...p, testingBoardUrl: String(patch.testingBoardUrl || '').trim() }
        : p
    })
  }

  const merged = saveProjectProfile({
    jiraBaseUrl,
    xrayClientId,
    xrayClientSecret,
    testPlans,
  })

  const vars = writeProjectVariablesFile(profileAsVariableInput(merged))

  const project = { ...merged, variablesPath: vars.relativePath }
  return {
    project,
    variables: vars.payload,
    configPath: vars.relativePath,
    hookSync: syncProfileCredentialsToHook(project),
  }
}

export function saveStackRecommendationProfile(recommendation) {
  return saveProjectProfile({
    recommendedStack: recommendation.recommendedStack,
    stackRecommendationComplete: true,
    stackRecommendationCompletedAt: new Date().toISOString(),
  })
}

export function saveStackChoiceProfile(stackId, label) {
  return saveProjectProfile({
    recommendedStack: stackId,
    stackRecommendationComplete: true,
    stackRecommendationCompletedAt: new Date().toISOString(),
    recommendedStackLabel: label || '',
  })
}

export function getOnboardingState() {
  const project = getProjectProfile()
  const gitRepository = resolveGitRepository(null, project)
  return {
    needsOnboarding: !project.onboardingComplete,
    project: {
      ...project,
      gitRepository,
    },
    detectedGitRepository: REPO_ROOT,
    arborescences: listArborescences(),
  }
}

export function getProjectVariables() {
  const abs = path.join(CONF_DIR, VARIABLES_FILE)
  if (!fs.existsSync(abs)) return null
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf8'))
  } catch {
    return null
  }
}

import fs from 'fs'
import path from 'path'
import { CONF_DIR, REPO_ROOT } from './paths.mjs'
import {
  computeRecommendation,
  getQuestionnaire,
  getToolProfiles,
  validateQuestionnaireAnswers,
  STACK_IDS,
  STACK_LABELS,
} from './stack-recommendation.mjs'
import { getQuestionnaireConfigPath } from './stack-questionnaire-config.mjs'
import { loadWizardDefaults } from './wizard-defaults.mjs'

function readWizardProject() {
  const wizard = loadWizardDefaults()
  return {
    onboardingComplete: false,
    variablesPath: '',
    ...(wizard.project || {}),
  }
}

const SNAPSHOT_FILE = 'onboarding.snapshot.json'

function snapshotPath() {
  return path.join(CONF_DIR, SNAPSHOT_FILE)
}

function relativeSnapshotPath() {
  return path.relative(REPO_ROOT, snapshotPath()).replace(/\\/g, '/')
}

export function readOnboardingSnapshot() {
  const abs = snapshotPath()
  if (!fs.existsSync(abs)) return null
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf8'))
  } catch {
    return null
  }
}

function writeSnapshot(payload) {
  fs.mkdirSync(CONF_DIR, { recursive: true })
  const abs = snapshotPath()
  fs.writeFileSync(abs, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  return {
    path: abs,
    relativePath: relativeSnapshotPath(),
    payload,
  }
}

export function buildPriseConnaissanceRecord(input, extras = {}) {
  return {
    completedAt: extras.completedAt || new Date().toISOString(),
    tribu: input.tribu || '',
    squad: input.squad || '',
    poName: input.poName || '',
    baName: input.baName || '',
    scrumMasterName: input.scrumMasterName || '',
    qaName: input.qaName || '',
    productCode: input.productCode || '',
    solutionCode: input.solutionCode || '',
    applicationLabel: input.applicationLabel || '',
    gitRepository: input.gitRepository || REPO_ROOT,
    usesJiraPlans: Boolean(input.usesJiraPlans),
    jiraBaseUrl: input.jiraBaseUrl || '',
    xrayClientId: input.xrayClientId || '',
    xrayClientSecret: input.xrayClientSecret || '',
    testPlans: input.testPlans || [],
    variablesPath: extras.variablesPath || '',
    foldersCreated: extras.foldersCreated || [],
  }
}

export function writePriseConnaissanceSnapshot(input, extras = {}) {
  const existing = readOnboardingSnapshot()
  const priseConnaissance = buildPriseConnaissanceRecord(input, extras)
  const now = new Date().toISOString()

  const payload = {
    version: 1,
    generatedAt: existing?.generatedAt || now,
    lastUpdatedAt: now,
    snapshotPath: relativeSnapshotPath(),
    priseConnaissance,
    stackRecommendation: existing?.stackRecommendation || {
      completed: false,
      completedAt: null,
      answers: {},
      scores: { cypress: 0, robot: 0, playwright: 0, postman: 0 },
      ranking: [],
      recommendedStack: null,
      recommendedLabel: null,
      rationale: [],
      toolsComparison: getToolProfiles(),
    },
  }

  return writeSnapshot(payload)
}

export function updatePriseConnaissanceSnapshot(input, extras = {}) {
  const existing = readOnboardingSnapshot()
  if (!existing) {
    return writePriseConnaissanceSnapshot(input, extras)
  }
  const now = new Date().toISOString()
  const payload = {
    ...existing,
    lastUpdatedAt: now,
    priseConnaissance: buildPriseConnaissanceRecord(input, {
      ...extras,
      completedAt: existing.priseConnaissance?.completedAt || now,
    }),
  }
  return writeSnapshot(payload)
}

export function saveStackRecommendation(answers) {
  validateQuestionnaireAnswers(answers)
  const result = computeRecommendation(answers)
  let existing = readOnboardingSnapshot()
  if (!existing?.priseConnaissance) {
    const profile = readWizardProject()
    if (!profile.onboardingComplete) {
      throw new Error('Prise de connaissance non enregistrée — terminez d\'abord l\'assistant initial')
    }
    writePriseConnaissanceSnapshot(profile, { variablesPath: profile.variablesPath })
    existing = readOnboardingSnapshot()
  }

  const now = new Date().toISOString()
  const questionIds = getQuestionnaire().map((q) => q.id)
  const payload = {
    ...existing,
    lastUpdatedAt: now,
    stackRecommendation: {
      completed: true,
      completedAt: now,
      answers,
      questionIds,
      questionCount: questionIds.length,
      scores: result.scores,
      ranking: result.ranking,
      recommendedStack: result.recommendedStack,
      recommendedLabel: result.recommendedLabel,
      rationale: result.rationale,
      toolsComparison: result.toolsComparison,
    },
  }

  const written = writeSnapshot(payload)
  return {
    ...written,
    recommendation: result,
  }
}

export function saveStackChoice(stackId) {
  if (!STACK_IDS.includes(stackId)) {
    throw new Error(`Stack invalide : ${stackId}`)
  }
  const existing = readOnboardingSnapshot()
  if (!existing?.stackRecommendation?.completed) {
    throw new Error('Complétez d\'abord le questionnaire avant de choisir une stack')
  }

  const now = new Date().toISOString()
  const payload = {
    ...existing,
    lastUpdatedAt: now,
    stackRecommendation: {
      ...existing.stackRecommendation,
      recommendedStack: stackId,
      recommendedLabel: STACK_LABELS[stackId],
      userChosenAt: now,
    },
  }

  const written = writeSnapshot(payload)
  return {
    ...written,
    stackId,
    label: STACK_LABELS[stackId],
  }
}

export function getStackRecommendationState() {
  const snapshot = readOnboardingSnapshot()
  const toolsComparison = getToolProfiles()
  const stack = snapshot?.stackRecommendation || null

  return {
    snapshotPath: relativeSnapshotPath(),
    questionnaireConfigPath: getQuestionnaireConfigPath(),
    hasSnapshot: Boolean(snapshot),
    priseConnaissanceComplete: Boolean(snapshot?.priseConnaissance),
    stackRecommendationComplete: Boolean(stack?.completed),
    recommendedStack: stack?.recommendedStack || null,
    recommendedLabel: stack?.recommendedLabel || null,
    toolsComparison,
    snapshot,
    stackRecommendation: stack,
  }
}

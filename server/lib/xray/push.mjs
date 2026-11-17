/**
 * Envoi d'un test validé vers JIRA / Xray (docs/V3-ARCHITECTURE.md §5.3).
 *
 *   pushTest({ storyKey, source, summary, testPlanKey, testType, dryRun, forceNew, jiraOnly, user })
 *   → { ok, testKey, testUrl, linked, planKey, simulated, updated, mode, steps, warnings, entry }
 *   previewPush({ …mêmes paramètres, check }) → ce qui sera créé ou mis à jour, sans rien écrire.
 *
 * Étapes : 1) ticket Test (création, ou mise à jour s'il a déjà été envoyé pour ce récit et cette source),
 * 2) lien « tests » vers le récit (sans doublon), 3) ajout facultatif au plan de test.
 * Données de démonstration (story.source === 'demo') ou dryRun : rien n'est contacté, clé simulée « <PROJET>-T<n> ».
 */
import { HttpError } from '../http/router.mjs'
import { getStory } from '../jira/stories.mjs'
import { loadSettings as loadJiraSettings, isConfigured as jiraConfigured } from '../jira/settings.mjs'
import { createJiraClient, JiraError } from '../jira/client.mjs'
import { loadXraySettings, guessMode, hasCloudCredentials } from './settings.mjs'
import { createXrayCloudClient } from './client-cloud.mjs'
import { createXrayServerClient } from './client-server.mjs'
import { getIssue, createIssue, updateIssue, resolveLinkType, ensureLink, findLink, projectIssueTypes } from './jira-ops.mjs'
import { buildTestContent, normalizeSource, defaultSummary } from './content.mjs'
import { findPushed, nextSimulatedKey, recordPush } from './history.mjs'
import { XrayError, translateError } from './errors.mjs'

const ISSUE_KEY_RE = /^[A-Z][A-Z0-9_]*-\d+$/
const inFlight = new Set()

export const MODE_LABEL = {
  cloud: 'Xray Cloud',
  server: 'Xray Server / Data Center',
  'jira-only': 'JIRA seul (sans Xray)',
  simulation: 'Simulation',
}

function normalizePlanKey(value, fallback) {
  if (value === undefined) return fallback || ''
  const key = String(value || '').trim().toUpperCase()
  if (!key || key === 'AUCUN' || key === 'NONE') return ''
  if (!ISSUE_KEY_RE.test(key)) throw new HttpError(400, `Clé de plan de test invalide : « ${value} » (par exemple IRMA-120).`)
  return key
}

/** Prépare l'envoi : récit, contenu, mode, entrée existante. Aucun appel réseau. */
async function prepare(input = {}) {
  const storyKey = String(input.storyKey || '').trim().toUpperCase()
  if (!ISSUE_KEY_RE.test(storyKey)) throw new HttpError(400, 'Clé de récit manquante ou invalide.')
  const story = getStory(storyKey)
  if (!story) throw new HttpError(404, `Récit ${storyKey} introuvable dans le dernier scan.`, { hint: 'Relancez le scan JIRA dans Prise de connaissance.' })
  const source = normalizeSource(input.source)
  const { settings } = await loadXraySettings()
  const jira = loadJiraSettings().settings
  const content = await buildTestContent({ story, source, settings, summary: input.summary, testType: input.testType })
  const planKey = normalizePlanKey(input.testPlanKey, settings.defaultTestPlanKey)
  const demo = story.source === 'demo'
  const simulated = Boolean(input.dryRun) || demo
  const jiraOk = jiraConfigured(jira)
  const xrayMode = guessMode(settings, jira)
  const mode = simulated ? 'simulation' : input.jiraOnly ? 'jira-only' : xrayMode
  const xrayConfigured = xrayMode === 'cloud' ? hasCloudCredentials(settings) : jiraOk
  const existing = input.forceNew ? null : findPushed(storyKey, source.kind, simulated)
  const projectKey = storyKey.split('-')[0]
  return {
    storyKey, story, source, settings, jira, content, planKey, projectKey, simulated,
    simulationReason: !simulated ? '' : demo ? 'demo' : 'dryRun',
    mode, xrayMode, jiraOk, xrayConfigured, existing, forceNew: Boolean(input.forceNew), jiraOnly: Boolean(input.jiraOnly),
  }
}

function operations(p) {
  const testKey = p.existing?.testKey || (p.simulated ? nextSimulatedKey(p.projectKey) : null)
  const ops = [
    {
      id: 'test',
      action: p.existing ? 'update' : 'create',
      label: p.existing
        ? `Mettre à jour le ticket Test ${p.existing.testKey} (${p.content.testType})`
        : `Créer un ticket ${p.settings.testIssueType} « ${p.content.testType} » dans le projet ${p.projectKey}`,
      testKey,
    },
    {
      id: 'link',
      action: p.existing?.linked ? 'exists' : 'create',
      label: p.existing?.linked
        ? `Lien « ${p.settings.linkType} » déjà présent avec ${p.storyKey} (vérifié à l’envoi, sans doublon)`
        : `Relier le test au récit ${p.storyKey} (le Test « tests » le récit)`,
    },
    p.planKey
      ? p.mode === 'jira-only'
        ? { id: 'plan', action: 'skip', label: `Plan de test ${p.planKey} ignoré : l’ajout à un plan nécessite Xray` }
        : { id: 'plan', action: 'add', label: `Ajouter le test au plan de test ${p.planKey}` }
      : { id: 'plan', action: 'skip', label: 'Aucun plan de test' },
  ]
  return ops
}

function previewPayload(p) {
  const warnings = []
  if (p.simulated) {
    warnings.push(p.simulationReason === 'demo'
      ? 'Récit issu des données de démonstration : l’envoi est simulé, rien n’est créé dans JIRA.'
      : 'Mode essai : l’envoi est simulé, rien n’est créé dans JIRA.')
  } else {
    if (!p.jiraOk) warnings.push('Connexion JIRA non configurée : renseignez l’URL et le jeton dans Prise de connaissance.')
    else if (!p.xrayConfigured && p.mode !== 'jira-only') warnings.push('Xray Cloud n’est pas configuré : renseignez client_id et client_secret dans Réglages › JIRA / Xray, ou créez seulement le ticket Test dans JIRA.')
    for (const w of p.content.contentWarnings || []) if (p.mode !== 'jira-only') warnings.push(w)
    if (p.mode === 'jira-only') warnings.push('Sans Xray, le ticket Test ne porte pas de définition Xray : le code ou le Gherkin figure dans la description.')
  }
  return {
    ok: true,
    storyKey: p.storyKey,
    story: { key: p.story.key, summary: p.story.summary, url: p.story.url || '', source: p.story.source, status: p.story.status },
    source: p.source,
    simulated: p.simulated,
    simulationReason: p.simulationReason,
    mode: p.mode,
    modeLabel: MODE_LABEL[p.mode] || p.mode,
    xrayMode: p.xrayMode,
    jiraConfigured: p.jiraOk,
    xrayConfigured: p.xrayConfigured,
    canSend: p.simulated || (p.jiraOk && (p.xrayConfigured || p.mode === 'jira-only')),
    canJiraOnly: !p.simulated && p.jiraOk,
    defaultSummary: defaultSummary(p.story),
    summary: p.content.summary,
    testType: p.content.testType,
    testTypes: p.source.kind === 'playwright' ? [...new Set([p.settings.playwrightTestType, 'Generic'])] : [...new Set([p.settings.gherkinTestType, 'Cucumber', 'Generic'])],
    labels: p.content.labels,
    planKey: p.planKey,
    defaultTestPlanKey: p.settings.defaultTestPlanKey || '',
    issueType: p.settings.testIssueType,
    linkType: p.settings.linkType,
    existing: p.existing,
    action: p.existing ? 'update' : 'create',
    operations: operations(p),
    definition: {
      kind: p.content.gherkin != null ? 'gherkin' : 'unstructured',
      text: p.content.gherkin ?? p.content.unstructured ?? '',
      relPath: p.content.relPath || '',
      steps: p.content.stepsText || [],
    },
    origin: p.content.origin,
    warnings,
    checks: [],
  }
}

/** Vérifications en lecture seule auprès de JIRA (aperçu). Chaque échec devient un avertissement. */
async function networkChecks(p) {
  const checks = []
  const add = (label, ok, message = '') => checks.push({ label, ok, message })
  let client
  try {
    client = await createJiraClient(p.jira)
    add('Connexion JIRA', true, `${client.deployment === 'cloud' ? 'JIRA Cloud' : 'JIRA Server / Data Center'} joignable`)
  } catch (e) {
    const err = translateError(e, { settings: p.settings })
    add('Connexion JIRA', false, `${err.message}${err.hint ? ` — ${err.hint}` : ''}`)
    return checks
  }
  try {
    const story = await getIssue(client, p.storyKey, 'summary')
    add(`Récit ${p.storyKey}`, Boolean(story), story ? 'présent dans JIRA' : 'introuvable dans ce JIRA (le scan vient peut-être d’une autre instance)')
  } catch (e) {
    add(`Récit ${p.storyKey}`, false, translateError(e, { settings: p.settings }).message)
  }
  const types = await projectIssueTypes(client, p.projectKey)
  if (types) {
    const ok = types.some((t) => t.toLowerCase() === String(p.settings.testIssueType).toLowerCase())
    add(`Type d’issue « ${p.settings.testIssueType} »`, ok, ok ? `disponible dans ${p.projectKey}` : `absent du projet ${p.projectKey} (types : ${types.join(', ')}) — Xray est-il activé sur ce projet ?`)
  }
  try {
    const lt = await resolveLinkType(client, p.settings.linkType)
    add(`Type de lien « ${p.settings.linkType} »`, true, `${lt.name} : ${lt.reversed ? lt.inward : lt.outward}`)
    if (p.existing?.testKey) {
      const otherInstance = p.existing.testUrl && !String(p.existing.testUrl).startsWith(`${client.baseUrl}/browse/`)
      const test = otherInstance ? null : await getIssue(client, p.existing.testKey, 'summary,issuetype,issuelinks')
      const typeName = test?.fields?.issuetype?.name
      if (otherInstance) add(`Ticket ${p.existing.testKey}`, false, 'envoyé vers une autre instance JIRA : un nouveau ticket Test sera créé')
      else if (!test) add(`Ticket ${p.existing.testKey}`, false, 'supprimé de JIRA : un nouveau ticket Test sera créé')
      else if (typeName && typeName.toLowerCase() !== String(p.settings.testIssueType).toLowerCase()) add(`Ticket ${p.existing.testKey}`, false, `de type « ${typeName} » : il ne sera pas modifié, un nouveau ticket Test sera créé`)
      else add(`Lien ${p.existing.testKey} → ${p.storyKey}`, true, findLink(test, p.storyKey, lt) ? 'déjà présent (pas de doublon)' : 'sera créé')
    }
  } catch (e) {
    const err = translateError(e, { settings: p.settings })
    add(`Type de lien « ${p.settings.linkType} »`, false, `${err.message}${err.hint ? ` — ${err.hint}` : ''}`)
  }
  if (p.planKey && p.mode !== 'jira-only') {
    try {
      const plan = await getIssue(client, p.planKey, 'summary,issuetype')
      add(`Plan de test ${p.planKey}`, Boolean(plan), plan ? plan.fields?.summary || '' : 'introuvable')
    } catch (e) {
      add(`Plan de test ${p.planKey}`, false, translateError(e, { settings: p.settings }).message)
    }
  }
  return checks
}

export async function previewPush(input = {}) {
  const p = await prepare(input)
  const out = previewPayload(p)
  if (input.check && !p.simulated && p.jiraOk) out.checks = await networkChecks(p)
  return out
}

// ---------------------------------------------------------------- envoi réel

function step(id, label) {
  return { id, label, state: 'todo', message: '' }
}

async function runTestStep(ctx) {
  const { p, client } = ctx
  const c = p.content
  const fieldsUpdate = { summary: c.summary, labels: c.labels, description: c.description }
  let existing = p.existing
  if (existing?.testKey) {
    // Garde-fou : ne jamais écraser un ticket qui n'est plus le Test envoyé (autre instance JIRA, ticket supprimé
    // puis clé réattribuée, type changé). On crée alors un nouveau ticket Test.
    const otherInstance = existing.testUrl && !String(existing.testUrl).startsWith(`${client.baseUrl}/browse/`)
    const issue = otherInstance ? null : await getIssue(client, existing.testKey, 'summary,issuetype')
    const typeName = issue?.fields?.issuetype?.name
    const notATest = issue && typeName && typeName.toLowerCase() !== String(p.settings.testIssueType).toLowerCase()
    if (!issue || notATest) {
      ctx.warnings.push(otherInstance
        ? `Le ticket ${existing.testKey} a été envoyé vers une autre instance JIRA : un nouveau ticket Test est créé.`
        : notATest
          ? `Le ticket ${existing.testKey} n’est plus un ticket « ${p.settings.testIssueType} » (type « ${typeName} ») : il n’est pas modifié, un nouveau ticket Test est créé.`
          : `Le ticket ${existing.testKey} n’existe plus dans JIRA : un nouveau ticket Test est créé.`)
      existing = null
      ctx.replaceId = p.existing.id
    } else {
      existing = { ...existing, testId: existing.testId || String(issue.id || '') }
    }
  }

  if (ctx.mode === 'cloud') {
    const xray = createXrayCloudClient(p.settings)
    ctx.xray = xray
    if (existing) {
      await updateIssue(client, existing.testKey, fieldsUpdate)
      await xray.updateDefinition(existing.testId, { testType: c.testType, unstructured: c.unstructured, gherkin: c.gherkin })
      return { testKey: existing.testKey, testId: existing.testId, updated: true }
    }
    const created = await xray.createTest({ projectKey: p.projectKey, summary: c.summary, description: c.description, labels: c.labels, testType: c.testType, unstructured: c.unstructured, gherkin: c.gherkin })
    let key = created.key
    if (!key) key = (await client.request(`/rest/api/2/issue/${encodeURIComponent(created.issueId)}?fields=summary`))?.key
    for (const w of created.warnings || []) ctx.warnings.push(`Xray : ${w}`)
    return { testKey: key, testId: created.issueId, updated: false }
  }

  // Xray Server / Data Center, ou JIRA seul.
  let extra = {}
  let xs = null
  if (ctx.mode === 'server') {
    xs = createXrayServerClient(client, p.jira)
    ctx.xs = xs
    const fields = await xs.discoverFields()
    extra = xs.definitionFields(fields, { testType: c.testType, unstructured: c.unstructured, gherkin: c.gherkin, cucumberType: c.cucumberType })
    ctx.serverFields = fields
  }
  const withFallback = async (fn) => {
    try {
      return await fn(extra)
    } catch (e) {
      if (!(e instanceof JiraError) || e.status !== 400 || !Object.keys(extra).length) throw e
      ctx.warnings.push('Champs de définition Xray refusés par JIRA : la définition figure seulement dans la description.')
      return fn({})
    }
  }
  if (existing) {
    await withFallback((x) => updateIssue(client, existing.testKey, { ...fieldsUpdate, ...x }))
    return { testKey: existing.testKey, testId: existing.testId, updated: true }
  }
  // Gherkin sans champ « Cucumber Scenario » détecté : import Cucumber Xray (un Test par scénario).
  if (ctx.mode === 'server' && c.gherkin != null && !ctx.serverFields.cucumberScenario) {
    try {
      const tests = await xs.importFeature(p.projectKey, c.featureText || c.gherkin)
      if (tests.length) {
        // Les tickets existent déjà : un refus de mise à jour ne doit pas faire échouer l'envoi (sinon doublon au renvoi).
        try {
          await updateIssue(client, tests[0].key, fieldsUpdate)
        } catch (e) {
          ctx.warnings.push(`Résumé et étiquettes de ${tests[0].key} non mis à jour : ${translateError(e, { step: 'test', settings: p.settings }).message}`)
        }
        if (tests.length > 1) ctx.warnings.push(`L’import Cucumber a créé ${tests.length} tickets Test (un par scénario) : ${tests.map((t) => t.key).join(', ')}.`)
        ctx.extraTests = tests.slice(1).map((t) => t.key)
        return { testKey: tests[0].key, testId: tests[0].id, updated: false }
      }
    } catch (e) {
      ctx.warnings.push(`Import Cucumber Xray indisponible (${e.message}) : création du ticket Test par l’API JIRA.`)
    }
  }
  const created = await withFallback((x) => createIssue(client, { projectKey: p.projectKey, issueType: p.settings.testIssueType, summary: c.summary, description: c.description, labels: c.labels, extraFields: x }))
  if (ctx.mode === 'server' && !Object.keys(extra).length) ctx.warnings.push('Champs Xray (type et définition du test) introuvables : la définition figure dans la description du ticket.')
  return { testKey: created.key, testId: created.id, updated: false }
}

export async function pushTest(input = {}) {
  const p = await prepare(input)
  const lockKey = `${p.storyKey}|${p.source.kind}`
  if (inFlight.has(lockKey)) throw new HttpError(409, 'Un envoi est déjà en cours pour ce récit.')
  inFlight.add(lockKey)
  try {
    return await execute(p, input)
  } finally {
    inFlight.delete(lockKey)
  }
}

async function execute(p, input) {
  const by = input.user?.username || ''
  const steps = [step('test', 'Ticket Test'), step('link', 'Lien avec le récit'), step('plan', 'Plan de test')]
  const warnings = []
  if (p.mode !== 'jira-only') warnings.push(...(p.content.contentWarnings || []))
  const base = {
    storyKey: p.storyKey,
    sourceKind: p.source.kind,
    sessionId: p.source.sessionId || null,
    testType: p.content.testType,
    summary: p.content.summary,
    by,
  }

  // ---- Simulation : aucun appel réseau.
  if (p.simulated) {
    const testKey = p.existing?.testKey || nextSimulatedKey(p.projectKey)
    steps[0] = { ...steps[0], state: 'done', message: `${p.existing ? 'Mis à jour' : 'Créé'} (simulé) : ${testKey}` }
    steps[1] = { ...steps[1], state: 'done', message: `Lien simulé ${testKey} « tests » ${p.storyKey}` }
    steps[2] = p.planKey
      ? { ...steps[2], state: 'done', message: `Ajout simulé au plan ${p.planKey}` }
      : { ...steps[2], state: 'skipped', message: 'Aucun plan de test' }
    const entry = recordPush({ ...base, testKey, testId: null, testUrl: null, storyUrl: p.story.url || null, planKey: p.planKey || null, linked: true, simulated: true, mode: 'simulation' }, p.existing?.id)
    return {
      ok: true, testKey, testUrl: null, storyKey: p.storyKey, storyUrl: p.story.url || null, linked: true, planKey: p.planKey || null,
      simulated: true, simulationReason: p.simulationReason, updated: Boolean(p.existing), mode: 'simulation', steps,
      warnings: [p.simulationReason === 'demo' ? 'Données de démonstration : rien n’a été créé dans JIRA, la clé est fictive.' : 'Mode essai : rien n’a été créé dans JIRA, la clé est fictive.'],
      entry,
    }
  }

  if (!p.jiraOk) {
    throw new XrayError('Connexion JIRA non configurée.', { status: 400, code: 'JIRA_CONFIG', step: 'test', hint: 'Renseignez l’URL de JIRA et le jeton dans Prise de connaissance › Connexion JIRA.' })
  }

  const ctx = { p, client: null, mode: p.mode, warnings, replaceId: p.existing?.id || null, extraTests: [] }
  let result
  steps[0].state = 'running'
  try {
    ctx.client = await createJiraClient(p.jira)
    if (p.mode !== 'jira-only' && p.settings.mode === 'auto') ctx.mode = ctx.client.deployment === 'cloud' ? 'cloud' : 'server'
    if (ctx.mode === 'cloud' && !hasCloudCredentials(p.settings)) {
      throw new XrayError('Xray Cloud n’est pas configuré (client_id / client_secret).', { status: 400, code: 'XRAY_CONFIG', step: 'test', hint: 'Renseignez la clé d’API Xray dans Réglages › JIRA / Xray, ou cochez « Créer seulement le ticket Test dans JIRA ».' })
    }
    result = await runTestStep(ctx)
    steps[0] = { ...steps[0], state: 'done', message: `${result.updated ? 'Mis à jour' : 'Créé'} : ${result.testKey}` }
  } catch (e) {
    const err = translateError(e, { step: 'test', settings: p.settings, projectKey: p.projectKey })
    steps[0] = { ...steps[0], state: 'failed', message: err.message }
    err.steps = steps
    throw err
  }

  const client = ctx.client
  const testKey = result.testKey
  const testUrl = `${client.baseUrl}/browse/${testKey}`
  const storyUrl = `${client.baseUrl}/browse/${p.storyKey}`

  // ---- 2. Lien « tests » vers le récit (sans doublon).
  let linked = false
  steps[1].state = 'running'
  try {
    const lt = await resolveLinkType(client, p.settings.linkType)
    if (lt.fallback) warnings.push(`Type de lien « ${p.settings.linkType} » introuvable : le type Xray « ${lt.name} » a été utilisé. Corrigez le nom dans Réglages › JIRA / Xray.`)
    const r = await ensureLink(client, { testKey, storyKey: p.storyKey, linkType: lt })
    for (const k of ctx.extraTests) await ensureLink(client, { testKey: k, storyKey: p.storyKey, linkType: lt })
    linked = true
    steps[1] = { ...steps[1], state: 'done', message: r.created ? `${testKey} « ${lt.reversed ? lt.inward : lt.outward} » ${p.storyKey}` : `Lien déjà présent (${lt.name}), aucun doublon` }
    if (r.wrongDirection) warnings.push(`Le lien existant entre ${testKey} et ${p.storyKey} est dans le sens inverse : corrigez-le dans JIRA si nécessaire.`)
  } catch (e) {
    const err = translateError(e, { step: 'link', settings: p.settings, projectKey: p.projectKey })
    steps[1] = { ...steps[1], state: 'failed', message: err.message }
    warnings.push(`Lien non créé : ${err.message}${err.hint ? ` ${err.hint}` : ''}`)
  }

  // ---- 3. Plan de test (facultatif).
  let planAdded = null
  if (!p.planKey) {
    steps[2] = { ...steps[2], state: 'skipped', message: 'Aucun plan de test' }
  } else if (ctx.mode === 'jira-only') {
    steps[2] = { ...steps[2], state: 'skipped', message: `Plan ${p.planKey} ignoré : nécessite Xray` }
    warnings.push(`Le test n’a pas été ajouté au plan ${p.planKey} : l’ajout à un plan de test nécessite Xray.`)
  } else {
    steps[2].state = 'running'
    try {
      const tests = [testKey, ...ctx.extraTests]
      if (ctx.mode === 'cloud') {
        const plan = await getIssue(client, p.planKey, 'summary,issuetype')
        if (!plan) throw new XrayError(`Plan de test ${p.planKey} introuvable.`, { status: 404, code: 'PLAN_NOT_FOUND', step: 'plan', hint: 'Vérifiez la clé du plan ou choisissez-en un autre.' })
        const testId = result.testId || String((await getIssue(client, testKey, 'summary'))?.id || '')
        const r = await ctx.xray.addTestsToTestPlan(plan.id, [testId])
        if (!r.addedTests.length) ctx.planAlready = true
        else if (r.warning) warnings.push(`Xray : ${r.warning}`)
      } else {
        await ctx.xs.addTestsToPlan(p.planKey, tests)
      }
      planAdded = p.planKey
      steps[2] = { ...steps[2], state: 'done', message: ctx.planAlready ? `Déjà présent dans le plan ${p.planKey}` : `Ajouté au plan ${p.planKey}` }
    } catch (e) {
      const err = translateError(e, { step: 'plan', settings: p.settings, projectKey: p.projectKey })
      steps[2] = { ...steps[2], state: 'failed', message: err.message }
      warnings.push(`Ajout au plan non effectué : ${err.message}${err.hint ? ` ${err.hint}` : ''}`)
    }
  }

  const entry = recordPush({
    ...base, testKey, testId: result.testId || null, testUrl, storyUrl, planKey: planAdded || p.existing?.planKey || null,
    linked, simulated: false, mode: ctx.mode, extraTests: ctx.extraTests,
  }, ctx.replaceId)

  return {
    ok: true, testKey, testUrl, storyKey: p.storyKey, storyUrl, linked, planKey: planAdded, simulated: false,
    updated: result.updated, mode: ctx.mode, modeLabel: MODE_LABEL[ctx.mode], steps, warnings, extraTests: ctx.extraTests, entry,
  }
}

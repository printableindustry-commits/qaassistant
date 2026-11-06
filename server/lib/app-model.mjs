/**
 * Modèle de l'application : registre de navigation/parcours (app-registry.json) + statut calculé.
 * Pour câbler un nouveau menu : l'ajouter au registre et, s'il a un statut, déclarer son
 * fournisseur dans STATUS_PROVIDERS (clé = champ « status » du registre).
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { REPO_ROOT, DOC_REPORTS_DIR, PATH_CFG } from './paths.mjs'
import { readNpmrc } from './npmrc.mjs'
import { checkVoltaNodeLight } from './npm-runtime-api.mjs'
import { getOnboardingState } from './project-profile.mjs'
import { getHookGitReadiness } from './hook-git-readiness.mjs'
import { getK6InstallStateSync } from './k6-install-api.mjs'

const REGISTRY_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'app-registry.json')
const FACTS_TTL_MS = 8000

const done = (message = '') => ({ state: 'done', message })
const todo = (message = '') => ({ state: 'todo', message })
const info = (message = '') => ({ state: 'info', message })
const blocked = (message = '') => ({ state: 'blocked', message })

/** Fournisseurs de statut : reçoivent les faits du poste, renvoient { state, message }. */
const STATUS_PROVIDERS = {
  project: (f) => (f.onboardingComplete ? done('Projet décrit') : todo('À renseigner')),
  node: (f) => (f.nodeOk ? done(f.nodeVersion ? `Node ${f.nodeVersion}` : 'Installé') : todo('À installer')),
  npmrc: (f) => (f.npmrcOk ? done('Accès configuré') : todo('À configurer')),
  npmInstall: (f) => (f.npmInstallDone ? done('Outils téléchargés') : todo('À lancer')),
  playwright: (f) => (f.playwrightInstalled ? done('Playwright installé') : todo('À installer')),
  k6Install: (f) => (f.k6Installed ? done('k6 installé') : todo('À installer')),
  k6Wizard: (f) => (f.k6Installed ? info('Prêt à configurer') : blocked('Installez k6 d’abord')),
  hook: (f) => (f.jiraSyncReady ? done('Connexion vérifiée') : todo(f.hookMessage || 'À configurer')),
  jiraSync: (f) => (f.jiraSyncReady ? info('Prêt') : blocked('Connectez Git à JIRA d’abord')),
  docs: (f) => (f.docsGenerated ? done('Livrables générés') : todo('Non généré')),
}

let cachedRegistry = null
let cachedFacts = { at: 0, value: null }

function loadRegistry() {
  if (!cachedRegistry) cachedRegistry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'))
  return cachedRegistry
}

function collectFacts() {
  const now = Date.now()
  if (cachedFacts.value && now - cachedFacts.at < FACTS_TTL_MS) return cachedFacts.value

  const npmrc = readNpmrc()
  const node = checkVoltaNodeLight()
  const onboarding = getOnboardingState()
  const hook = getHookGitReadiness()
  const k6 = getK6InstallStateSync()

  const facts = {
    onboardingComplete: !onboarding.needsOnboarding,
    nodeOk: node.nodeInstalled,
    nodeVersion: node.nodeVersion,
    npmrcOk: Boolean(npmrc.exists && npmrc.fields.registry && npmrc.fields.authToken),
    npmInstallDone: fs.existsSync(path.join(REPO_ROOT, 'node_modules')),
    playwrightInstalled: fs.existsSync(path.join(REPO_ROOT, 'node_modules', '@playwright', 'test')),
    k6Installed: Boolean(k6.installed),
    jiraSyncReady: Boolean(hook.readyForJiraSync),
    hookMessage: hook.message || '',
    docsGenerated: fs.existsSync(path.join(DOC_REPORTS_DIR, PATH_CFG.docGapsFile))
      && fs.existsSync(path.join(DOC_REPORTS_DIR, PATH_CFG.docInventoryFile)),
    projectName: onboarding.project?.applicationLabel || '',
    tribu: onboarding.project?.tribu || '',
    squad: onboarding.project?.squad || '',
    needsOnboarding: onboarding.needsOnboarding,
  }
  cachedFacts = { at: now, value: facts }
  return facts
}

function resolvePageStatuses(pages, facts) {
  const statuses = {}
  for (const [id, page] of Object.entries(pages)) {
    const provider = page.status && STATUS_PROVIDERS[page.status]
    statuses[id] = provider ? provider(facts) : info('')
  }
  for (const [id, page] of Object.entries(pages)) {
    const unmet = (page.requires || []).find((req) => statuses[req]?.state !== 'done')
    if (unmet && statuses[id].state !== 'done') {
      statuses[id] = blocked(`Terminez d’abord : ${pages[unmet]?.label || unmet}`)
    }
  }
  return statuses
}

function buildJourneys(registry, statuses) {
  return registry.journeys.map((journey) => {
    const tracked = journey.steps.filter((id) => registry.pages[id]?.tracked)
    const doneCount = tracked.filter((id) => statuses[id]?.state === 'done').length
    const nextStep = journey.steps.find((id) => ['todo', 'blocked'].includes(statuses[id]?.state) && registry.pages[id]?.tracked)
      || journey.steps.find((id) => statuses[id]?.state === 'info')
      || null
    return { ...journey, doneCount, total: tracked.length, complete: tracked.length > 0 && doneCount === tracked.length, nextStep }
  })
}

export function getAppModel() {
  const registry = loadRegistry()
  const facts = collectFacts()
  const statuses = resolvePageStatuses(registry.pages, facts)
  return {
    version: registry.version,
    pages: registry.pages,
    nav: registry.nav,
    statuses,
    journeys: buildJourneys(registry, statuses),
    project: {
      needsOnboarding: facts.needsOnboarding,
      name: facts.projectName,
      tribu: facts.tribu,
      squad: facts.squad,
    },
  }
}

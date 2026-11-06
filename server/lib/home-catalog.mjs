import fs from 'fs'
import path from 'path'
import { getDashboard } from './status.mjs'
import { checkNpmRuntime } from './npm-runtime-api.mjs'
import { getOnboardingState } from './project-profile.mjs'
import { getHookGitReadiness } from './hook-git-readiness.mjs'
import { REPO_ROOT } from './paths.mjs'
import { readOnboardingSnapshot } from './onboarding-snapshot.mjs'
import { getDemoFormDefaults } from './demo-defaults.mjs'
import { getK6InstallStateSync } from './k6-install-api.mjs'

function tileStatus(stepMap, id, fallback = 'pending') {
  const step = stepMap.get(id)
  return step?.status || fallback
}

function stepMessage(stepMap, id, fallback = '') {
  return stepMap.get(id)?.message || fallback
}

export function getHomeCatalog() {
  const dashboard = getDashboard()
  const onboarding = getOnboardingState()
  const stepMap = new Map(dashboard.steps.map(s => [s.id, s]))
  const project = onboarding.project

  const statusFor = (id, fb = 'pending') => tileStatus(stepMap, id, fb)
  const hookReadiness = getHookGitReadiness()
  const jiraSyncReady = hookReadiness.readyForJiraSync
  const snapshot = readOnboardingSnapshot()
  const recommendedStack = project.recommendedStack
    || snapshot?.stackRecommendation?.recommendedStack
    || null

  const npmrcOk = statusFor('npmrc', 'ko') === 'ok'
  const runtime = checkNpmRuntime()
  const packageJsonOk = runtime.packageJsonExists
  const nodeRuntimeOk = runtime.nodePresent
    && (runtime.nodeInVoltaImage || runtime.nodeInVoltaInventory)
  const npmInstallDone = fs.existsSync(path.join(REPO_ROOT, 'node_modules'))

  const k6State = getK6InstallStateSync()

  const stackTileIds = ['playwright']

  const withStackHighlight = (tile) => {
    if (!stackTileIds.includes(tile.id)) return tile
    const isRecommended = recommendedStack === tile.id
    return {
      ...tile,
      recommended: isRecommended,
      tileClass: [tile.tileClass, isRecommended ? 'hub-tile--recommended' : ''].filter(Boolean).join(' '),
      message: isRecommended
        ? 'Solution adaptée à votre profil'
        : tile.message,
    }
  }

  return {
    needsOnboarding: onboarding.needsOnboarding,
    hookGit: hookReadiness,
    recommendedStack,
    stackRecommendationComplete: Boolean(project.stackRecommendationComplete || snapshot?.stackRecommendation?.completed),
    onboardingSnapshotPath: project.onboardingSnapshotPath || snapshot?.snapshotPath || '.wizard-qa/conf/onboarding.snapshot.json',
    npmPyramid: {
      nodeOk: nodeRuntimeOk,
      npmrcOk,
      packageJsonOk,
      npmInstallDone,
      nodeVersion: runtime.nodeVersion || '',
      npmVersion: runtime.npmVersion || '',
    },
    demoDefaults: getDemoFormDefaults(REPO_ROOT),
    project: {
      baName: project.baName,
      poName: project.poName,
      qaName: project.qaName,
      scrumMasterName: project.scrumMasterName,
      tribu: project.tribu,
      squad: project.squad,
      productCode: project.productCode,
      solutionCode: project.solutionCode,
      applicationLabel: project.applicationLabel,
      gitRepository: project.gitRepository || REPO_ROOT,
      onboardingComplete: project.onboardingComplete,
      recommendedStack: project.recommendedStack || recommendedStack || '',
      recommendedStackLabel: project.recommendedStackLabel || snapshot?.stackRecommendation?.recommendedLabel || '',
      stackRecommendationComplete: Boolean(project.stackRecommendationComplete || snapshot?.stackRecommendation?.completed),
      variablesPath: project.variablesPath || '.wizard-qa/conf/project.variables.json',
      defaultsPath: '.wizard-qa/conf/wizard.defaults.json',
    },
    progress: {
      done: dashboard.steps.filter(s => s.status === 'ok').length,
      total: dashboard.steps.length,
      percent: Math.round(
        (dashboard.steps.filter(s => s.status === 'ok').length / dashboard.steps.length) * 100,
      ),
    },
    arborescences: onboarding.arborescences,
    sections: [
      {
        id: 'config',
        title: 'Configuration & projet',
        sectionClass: 'hub-section--config',
        columns: 3,
        tiles: [
          {
            id: 'docQa',
            title: 'Documentation QA',
            logo: '/assets/logo-qa.png',
            logoAlt: 'QA',
            status: statusFor('doc', 'pending'),
            message: stepMessage(stepMap, 'doc'),
            href: '/doc-qa.html',
            actions: [
              { label: 'Générer les livrables', href: '/doc-qa.html' },
              { label: 'Modèle docx', href: '/doc-qa-guide.html' },
              { label: 'Guide visionneuse', href: '/doc-qa-guide.html' },
            ],
          },
          {
            id: 'wiki',
            title: 'Wiki',
            logo: '/assets/logo-wiki.png',
            logoAlt: 'Wiki',
            status: 'ok',
            description: 'Documentation interactive — parcours Wizard, stacks, Hook Git JIRA/Xray',
            message: 'Guide & dépannage',
            href: '/wiki.html',
            comingSoon: false,
            locked: false,
            tileClass: 'hub-tile--wiki',
            actions: [
              { label: 'Ouvrir le Wiki', href: '/wiki.html' },
              { label: 'Stacks de test', href: '/wiki.html#playwright' },
              { label: 'Hook Git', href: '/wiki.html#hook-install' },
            ],
          },
          {
            id: 'k6Perf',
            title: 'k6 — Performance',
            logo: '/assets/logo-k6.png',
            logoAlt: 'k6',
            status: k6State.installed ? 'ready' : 'warn',
            description: k6State.installed
              ? 'Wizard complet — profils de charge, seuils SLA, export/import & historique'
              : 'Installation k6 requise — scaffold, binaire Grafana k6',
            message: k6State.installed ? 'Tests de performance Grafana k6' : 'Commencer par l\'installation',
            href: k6State.wizardHref,
            comingSoon: false,
            tileClass: 'hub-tile--k6',
            actions: [
              { label: k6State.installed ? 'Wizard performance' : 'Installer k6', href: k6State.wizardHref },
              { label: 'Installation k6', href: '/k6-install.html' },
              { label: 'Wiki k6', href: '/wiki.html#k6' },
            ],
          },
          // Configuration tuile Hook Git — référence v1.19.1
          {
            id: 'hookGit',
            title: 'Hook Git',
            logo: '/assets/logo-git-hook.png',
            logoAlt: 'Git Hook',
            status: jiraSyncReady ? 'ok' : hookReadiness.configured ? 'warn' : statusFor('hook', 'ko'),
            description: 'Configuration .env, hooks.conf et installation post-commit',
            message: hookReadiness.message,
            href: '/hook-git.html',
            pairGroup: 'jira-chain',
            pairRole: 'source',
            tileClass: 'hub-tile--hook-git',
            actions: [
              { label: 'Assistant', href: '/hook-git.html' },
              { label: 'Dry-run', href: '/hook-git.html#dry-run' },
            ],
          },
          {
            id: 'project',
            title: 'Sync JIRA',
            logo: '/assets/logo-jira.png',
            logoAlt: 'JIRA',
            status: jiraSyncReady
              ? (onboarding.arborescences.length ? 'ok' : 'warn')
              : 'ko',
            description: 'Synchronisation des « Tickets Tests » avec le « Tableau de Tests » et « Plans de Tests » sur JIRA',
            message: jiraSyncReady
              ? (onboarding.arborescences.length
                ? `${onboarding.arborescences.length} dossier(s) campagne · JIRA / Xray Cloud`
                : 'Prêt — JIRA / Xray Cloud')
              : 'JIRA / Xray Cloud',
            href: '/project.html',
            locked: !jiraSyncReady,
            lockReason: 'Configurez le Hook Git pour débloquer la synchronisation JIRA',
            pairGroup: 'jira-chain',
            pairRole: 'target',
            tileClass: 'hub-tile--sync-jira',
            actions: [],
          },
        ],
      },
      {
        id: 'stacks',
        title: 'Stacks de test',
        subtitle: 'Parcours npm en pyramide — Playwright',
        sectionClass: 'hub-section--stacks',
        columns: 1,
        tiles: [
          {
            id: '__npmPyramid__',
            renderAs: 'npmPyramid',
          },
        ],
      },
    ],
  }
}

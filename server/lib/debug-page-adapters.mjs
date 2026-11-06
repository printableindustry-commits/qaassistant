import fs from 'fs'
import path from 'path'
import { REPO_ROOT, HOOK_DIR, CONF_DIR, getPathsForApi } from './paths.mjs'
import { getHookGitReadiness } from './hook-git-readiness.mjs'
import { getProjectProfile } from './project-profile.mjs'
import { getNpmrcPath } from './npmrc.mjs'
import { getNpmInstallConfigForApi } from './npm-install-api.mjs'
import { getRuntimeConfigForApi } from './npm-runtime-api.mjs'

function fileSnippet(abs, max = 4000) {
  if (!abs || !fs.existsSync(abs)) return '(absent)'
  try {
    const raw = fs.readFileSync(abs, 'utf8')
    return raw.length <= max ? raw : `…(tronqué)\n${raw.slice(-max)}`
  } catch (err) {
    return `(erreur : ${err.message})`
  }
}

const ADAPTERS = {
  'hook-git': () => {
    const readiness = getHookGitReadiness()
    const envPath = path.join(HOOK_DIR, '.env')
    const confPath = path.join(HOOK_DIR, 'hooks.conf')
    return {
      title: 'Hook Git — JIRA / Xray',
      keyFiles: {
        env: envPath,
        hooksConf: confPath,
        hookDebugLog: path.join(HOOK_DIR, 'hook-debug.log'),
      },
      readiness,
      snippets: {
        hooksConf: fileSnippet(confPath, 3000),
      },
      suggestedQuestions: [
        'Quelle est la cause racine de l\'échec du dry-run ?',
        'Quels fichiers modifier (.env, hooks.conf) ?',
      ],
    }
  },
  'sync-jira': () => {
    const readiness = getHookGitReadiness()
    const profile = getProjectProfile()
    return {
      title: 'Sync JIRA — Xray Cloud',
      keyFiles: {
        env: path.join(HOOK_DIR, '.env'),
        hooksConf: path.join(HOOK_DIR, 'hooks.conf'),
      },
      readiness,
      profilePlans: profile.testPlans || [],
      suggestedQuestions: [
        'Quels écarts JIRA / Xray par plan ?',
        'Quels tickets seront créés ou supprimés ?',
      ],
    }
  },
  'node-install': () => {
    const runtime = getRuntimeConfigForApi()
    return {
      title: 'Installation Node.js (Volta)',
      runtime,
      keyFiles: {
        npmInstallConf: path.join(CONF_DIR, 'npm-install.conf.json'),
      },
      suggestedQuestions: [
        'Volta ou Node est-il correctement installé ?',
        'Le proxy bloque-t-il le téléchargement ?',
      ],
    }
  },
  npmrc: () => {
    const npmrcPath = getNpmrcPath()
    return {
      title: 'Configuration .npmrc',
      keyFiles: { npmrc: npmrcPath },
      snippets: { npmrc: fileSnippet(npmrcPath, 2500) },
      suggestedQuestions: [
        'Le token Artifactory est-il valide ?',
        'Le proxy est-il correctement encodé dans .npmrc ?',
      ],
    }
  },
  'npm-install': () => {
    const cfg = getNpmInstallConfigForApi()
    return {
      title: 'Installer NPM',
      npmInstallConfig: cfg,
      suggestedQuestions: [
        'Quel paquet npm a échoué et pourquoi ?',
        'Le registry Artifactory est-il accessible ?',
      ],
    }
  },
  'playwright-install': () => ({
    title: 'Installation Playwright',
    keyFiles: {
      packageJson: path.join(REPO_ROOT, 'package.json'),
      playwrightConfig: path.join(REPO_ROOT, 'playwright.config.ts'),
      npmInstallConf: path.join(CONF_DIR, 'playwright-install.conf.json'),
    },
    suggestedQuestions: [
      'npm et npx sont-ils accessibles depuis le dossier du projet ?',
      'Le paquet @playwright/test et les navigateurs sont-ils install\u00e9s ?',
    ],
  }),
  'k6-install': () => ({
    title: 'Installation k6',
    keyFiles: {
      k6Script: path.join(REPO_ROOT, 'k6', 'scripts', 'smoke.js'),
      k6InstallConf: path.join(CONF_DIR, 'k6-install.conf.json'),
    },
    suggestedQuestions: [
      'Le binaire k6 est-il install\u00e9 et pr\u00e9sent dans le PATH ?',
      'winget ou choco sont-ils utilisables sur ce poste ?',
    ],
  }),
  'k6-wizard': () => ({
    title: 'Wizard k6 Performance',
    keyFiles: {
      k6Script: path.join(REPO_ROOT, 'k6', 'scripts', 'smoke.js'),
      k6Profiles: path.join(CONF_DIR, 'k6-profiles'),
    },
    suggestedQuestions: [
      'Le script k6 g\u00e9n\u00e9r\u00e9 est-il valide ?',
      'Le rapport est-il \u00e9crit au bon endroit ?',
    ],
  }),
  'doc-qa': () => {
    const paths = getPathsForApi()
    return {
      title: 'Documentation QA — Livrables',
      keyFiles: {
        scanConfig: path.join(REPO_ROOT, paths.docQaDir, 'doc-qa-scan.conf.json'),
        snapshotJson: path.join(REPO_ROOT, paths.docReportsDir, 'project-qa-snapshot.json'),
        promptMd: path.join(REPO_ROOT, paths.livrablesDir, 'PROMPT_MAJ_LIVRABLES_QA.md'),
      },
      suggestedQuestions: [
        'Le snapshot projet est-il à jour ?',
        'Quels livrables manquent ou sont obsolètes ?',
      ],
    }
  },
}

export function collectScopeAdapterBundle(scope) {
  const fn = ADAPTERS[scope]
  if (!fn) return { scope, title: scope, keyFiles: {} }
  try {
    return { scope, ...fn() }
  } catch (err) {
    return { scope, error: err.message }
  }
}

export function getAdapterSuggestedQuestions(scope) {
  return collectScopeAdapterBundle(scope).suggestedQuestions || []
}

export function detectWizardExtensionPaths() {
  const candidates = [
    path.join(REPO_ROOT, '00_Scripts_Implementation', '05_wizard-qa-vscode'),
    path.join(REPO_ROOT, '00_Scripts_Implementation', '05_wizard-qa-vscode', 'server'),
  ]
  const existing = candidates.filter((p) => fs.existsSync(p))
  if (!existing.length) return null
  return {
    extensionRoot: existing[0],
    serverDir: path.join(existing[0], 'server'),
    note: 'Le dépôt contient les sources de l\'extension Wizard — le bug peut concerner l\'application elle-même.',
  }
}

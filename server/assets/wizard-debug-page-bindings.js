/**
 * Enregistrement des adaptateurs DEBUG par page (logs console, opts prompt).
 */
;(function (global) {
  function textOf(id) {
    const el = global.document.getElementById(id)
    return el?.textContent?.trim() || ''
  }

  function preText(id) {
    const el = global.document.getElementById(id)
    if (!el) return ''
    return (el.textContent || el.innerText || '').trim()
  }

  function panelLog(...ids) {
    return ids.map((id) => preText(id) || textOf(id)).filter(Boolean).join('\n\n')
  }

  function registerAll() {
    if (!global.WizardDebugPage?.register) return

    global.WizardDebugPage.register('hook-git', {
      getPageLog: () => textOf('exitDryRunConsole'),
      getLastExecution: () => textOf('exitDryRunConsole'),
      buildPromptOpts: () => ({
        title: 'Debug dry-run Hook Git — JIRA / Xray',
        context: 'Échec ou analyse du dry-run Hook Git (hook-run.mjs --force --dry-run).',
        error: textOf('exitDryRunConsole').match(/ERREUR|échec|KO/i) ? 'Dry-run en échec' : '',
        scope: 'hook-git',
        stepsToReproduce: [
          'Renseigner .env et hooks.conf',
          'Installer post-commit',
          'Lancer dry-run depuis Hook Git',
        ],
      }),
    })

    global.WizardDebugPage.register('sync-jira', {
      getPageLog: () => [textOf('analyzeConsole'), textOf('syncLocalConsole')].filter(Boolean).join('\n\n'),
      getLastExecution: () => textOf('syncLocalConsole') || textOf('analyzeConsole'),
      buildPromptOpts: () => ({
        title: 'Debug Sync JIRA — analyse et synchronisation Local ↔ JIRA / Xray',
        context: 'Analyse dry-run par plan + synchronisation hook-run.mjs --force.',
        scope: 'sync-jira',
        stepsToReproduce: [
          'Vérifier Hook Git et dry-run OK',
          'Lancer l\'analyse des écarts',
          'Synchroniser vers JIRA si nécessaire',
        ],
      }),
    })

    global.WizardDebugPage.register('npmrc', {
      getPageLog: () => panelLog('diffBanner', 'status'),
      getLastExecution: () => textOf('status') || textOf('diffBanner'),
      buildPromptOpts: () => ({
        title: 'Debug configuration .npmrc',
        context: 'Assistant .npmrc — token Artifactory, proxy, dépôt utilisateur. Journal : bannière de diff, statut de génération et messages d\'erreur de la page.',
        scope: 'npmrc',
      }),
    })

    global.WizardDebugPage.register('node-install', {
      getPageLog: () => panelLog('nodeInstallLog', 'packageJsonLog', 'status'),
      getLastExecution: () => preText('nodeInstallLog') || preText('packageJsonLog') || textOf('status'),
      buildPromptOpts: () => ({
        title: 'Debug Installation Node.js (Volta)',
        context: 'Installation Node/npm via Volta sur poste CA-TS. Journal terminal : sorties Volta (nodeInstallLog), package.json (packageJsonLog) et statut de la page.',
        scope: 'node-install',
      }),
    })

    global.WizardDebugPage.register('npm-install', {
      getPageLog: () => {
        const installLog = preText('npmInstallLog')
        const panel = global.document.getElementById('npmInstallPanel')?.innerText?.trim() || ''
        const status = textOf('status')
        return [installLog, panel, status].filter(Boolean).join('\n\n')
      },
      getLastExecution: () => preText('npmInstallLog') || global.document.getElementById('npmInstallPanel')?.innerText?.trim() || textOf('status'),
      buildPromptOpts: () => ({
        title: 'Debug Installer NPM',
        context: 'Installation des paquets npm après configuration .npmrc. Journal terminal : sortie npm install (npmInstallLog) et étapes du panneau d\'installation.',
        scope: 'npm-install',
      }),
    })

    global.WizardDebugPage.register('playwright-install', {
      getPageLog: () => panelLog('playwrightInstallLog', 'playwrightVscodeHint', 'status'),
      getLastExecution: () => preText('playwrightInstallLog') || textOf('status'),
      buildPromptOpts: () => ({
        title: 'Debug Installation Playwright',
        context: 'Installation @playwright/test, navigateurs (npx playwright install) et extension VS Code. Journal terminal : playwrightInstallLog.',
        scope: 'playwright-install',
        stepsToReproduce: [
          'Configurer .npmrc et package.json',
          'npm install -D @playwright/test@latest',
          'npx playwright install',
          'Installer l’extension Playwright Test for VSCode',
        ],
      }),
    })

    global.WizardDebugPage.register('k6-install', {
      getPageLog: () => panelLog('k6InstallLog', 'status'),
      getLastExecution: () => preText('k6InstallLog') || textOf('status'),
      buildPromptOpts: () => ({
        title: 'Debug Initialisation k6',
        context: 'Scaffold k6/, @types/k6 et binaire Grafana k6. Journal : k6InstallLog.',
        scope: 'k6-install',
        stepsToReproduce: [
          'Configurer k6-init.conf.json (baseUrl, VUs, durée)',
          'Scaffold k6/scripts/smoke.js',
          'npm install -D @types/k6',
          'k6 version',
          'k6 run k6/scripts/smoke.js',
        ],
      }),
    })

    global.WizardDebugPage.register('k6-wizard', {
      getPageLog: () => textOf('status'),
      getLastExecution: () => textOf('status'),
      buildPromptOpts: () => ({
        title: 'Debug Wizard k6 Performance',
        context: 'Questionnaire charge, profils (.wizard-qa/conf/k6-profiles/) et historique (k6-history/runs.json). Journal : zone statut de la page.',
        scope: 'k6-wizard',
        stepsToReproduce: [
          'Répondre au questionnaire (10 sections)',
          'Enregistrer un profil de campagne',
          'Appliquer au projet (génération k6-init + script)',
          'k6 run k6/scripts/smoke.js',
          'Enregistrer l\'exécution dans l\'historique',
        ],
      }),
    })

  }

  function boot() {
    registerAll()
  }

  if (global.document?.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
  global.addEventListener('wizard:page-ready', boot)
})(typeof window !== 'undefined' ? window : globalThis)

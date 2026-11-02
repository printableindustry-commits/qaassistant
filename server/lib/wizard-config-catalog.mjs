import fs from 'fs'
import path from 'path'
import {
  CONF_DIR,
  HOOK_DIR,
  REPO_ROOT,
  PATH_CFG,
  REPAIR_DIR,
  SERVER_CONF_DIR,
} from './paths.mjs'
import { getProjectProfile } from './project-profile.mjs'
import { STACK_QUESTIONNAIRE_FILE, STACK_QUESTIONNAIRE_REFERENCE } from './stack-questionnaire-config.mjs'
import { UI_WORDING_FILE, UI_WORDING_REFERENCE } from './ui-wording-config.mjs'
import { UI_WORDING_PREFERENCES_FILE } from './ui-wording-preferences.mjs'
import { NPM_INSTALL_FILE, NPM_INSTALL_REFERENCE } from './npm-install-config.mjs'
import {
  CYPRESS_INSTALL_FILE,
  CYPRESS_INSTALL_REFERENCE,
  PLAYWRIGHT_INSTALL_FILE,
  PLAYWRIGHT_INSTALL_REFERENCE,
  ROBOT_INSTALL_FILE,
  ROBOT_INSTALL_REFERENCE,
  POSTMAN_INIT_FILE,
  POSTMAN_INIT_REFERENCE,
  POSTMAN_INSTALL_FILE,
  POSTMAN_INSTALL_REFERENCE,
  K6_INIT_FILE,
  K6_INIT_REFERENCE,
  K6_INSTALL_FILE,
  K6_INSTALL_REFERENCE,
} from './stack-install-config.mjs'
import {
  K6_PERF_QUESTIONNAIRE_FILE,
  K6_PERF_QUESTIONNAIRE_REFERENCE,
} from './k6-perf-questionnaire-config.mjs'

function rel(abs) {
  if (!abs) return ''
  try {
    return path.relative(REPO_ROOT, abs).replace(/\\/g, '/')
  } catch {
    return String(abs).replace(/\\/g, '/')
  }
}

function fileEntry({ id, title, relativePath, absPath, role, readBy, writtenBy, secrets = false, wikiPath = '' }) {
  const exists = absPath ? fs.existsSync(absPath) : false
  return {
    id,
    title,
    relativePath,
    exists,
    secrets,
    role,
    readBy,
    writtenBy,
    ...(wikiPath ? { wikiPath } : {}),
  }
}

export function getWizardConfigCatalog() {
  const profile = getProjectProfile()
  const paths = {
    wizardDefaults: path.join(CONF_DIR, 'wizard.defaults.json'),
    projectVariables: path.join(CONF_DIR, 'project.variables.json'),
    onboardingSnapshot: path.join(CONF_DIR, 'onboarding.snapshot.json'),
    wizardPaths: path.join(CONF_DIR, 'wizard.paths.json'),
    hookEnv: path.join(HOOK_DIR, '.env'),
    hooksConf: path.join(HOOK_DIR, PATH_CFG.hooksConfFile),
    repairConf: path.join(REPAIR_DIR, PATH_CFG.repairConfFile),
  }

  const files = [
    fileEntry({
      id: 'wizardDefaults',
      title: 'wizard.defaults.json',
      relativePath: rel(paths.wizardDefaults),
      absPath: paths.wizardDefaults,
      role: 'Profil projet central (prise de connaissance, plans JIRA, stack recommandée, chemins).',
      readBy: [
        'Accueil — catalogue et tuiles',
        'Prise de connaissance — reprise du profil',
        'Hook Git — repli credentials si .env vide',
        'Sync JIRA — profil et arborescences',
      ],
      writtenBy: [
        'Fin de la prise de connaissance (POST /api/project/onboarding/complete)',
        'Paramètres projet (POST /api/project/settings/update)',
        'Questionnaire stack (POST /api/project/stack-recommendation)',
        'Connexion JIRA (POST /api/project/jira-sync)',
      ],
    }),
    fileEntry({
      id: 'projectVariables',
      title: 'project.variables.json',
      relativePath: profile.variablesPath || rel(paths.projectVariables),
      absPath: paths.projectVariables,
      role: 'Variables métier ($PRODUIT, $SOLUTION, $GIT_REPOSITORY, credentials JIRA/Xray) pour la documentation QA et les livrables.',
      readBy: [
        'Documentation QA — génération des livrables',
        'Prompts Copilot — contexte debug',
        'Export / import configuration Wizard',
      ],
      writtenBy: [
        'Fin de la prise de connaissance',
        'Mise à jour des paramètres projet',
        'Sauvegarde connexion JIRA (POST /api/project/jira-sync)',
      ],
      secrets: true,
    }),
    fileEntry({
      id: 'onboardingSnapshot',
      title: 'onboarding.snapshot.json',
      relativePath: profile.onboardingSnapshotPath || rel(paths.onboardingSnapshot),
      absPath: paths.onboardingSnapshot,
      role: 'Archive complète de la prise de connaissance et du questionnaire d\'orientation stack (réponses, scores, recommandation).',
      readBy: [
        'Accueil — halo tuile recommandée',
        'Questionnaire stack — reprise des réponses',
      ],
      writtenBy: [
        'Fin de la prise de connaissance',
        'Questionnaire « Définir votre application de test automatisée »',
        'Choix manuel sur les camemberts de résultat',
      ],
      secrets: true,
    }),
    fileEntry({
      id: 'stackQuestionnaire',
      title: STACK_QUESTIONNAIRE_FILE,
      relativePath: rel(path.join(CONF_DIR, STACK_QUESTIONNAIRE_FILE)),
      absPath: path.join(CONF_DIR, STACK_QUESTIONNAIRE_FILE),
      role: 'Fichier actif du questionnaire stack. Chaque entrée du tableau questions = une page du wizard. Modifiez uniquement ce fichier pour ajouter, retirer ou adapter des questions.',
      readBy: [
        'Questionnaire stack (lecture directe du fichier à chaque lancement)',
        'GET /api/project/stack-questionnaire',
      ],
      writtenBy: [
        'Vous — édition manuelle du tableau questions',
        'Création initiale automatique si le fichier n\'existe pas encore (copie depuis la référence extension)',
      ],
      wikiPath: '/wiki.html#stack-questionnaire-guide',
    }),
    fileEntry({
      id: 'stackQuestionnaireReference',
      title: STACK_QUESTIONNAIRE_REFERENCE,
      relativePath: rel(path.join(SERVER_CONF_DIR, STACK_QUESTIONNAIRE_REFERENCE)),
      absPath: path.join(SERVER_CONF_DIR, STACK_QUESTIONNAIRE_REFERENCE),
      role: 'Référence versionnée livrée avec l\'extension. Copiée une seule fois vers .wizard-qa/conf/ si le fichier actif est absent. Consultez ce modèle pour la structure des questions ; éditez stack-questionnaire.conf.json pour personnaliser votre dépôt.',
      readBy: [
        'ensureStackQuestionnaireConfig — copie initiale vers .wizard-qa/conf/',
        'Documentation — exemple commenté des questions et pondérations',
      ],
      writtenBy: [
        'Mainteneurs de l\'extension Wizard QA (mise à jour lors des releases)',
      ],
      wikiPath: '/wiki.html#stack-questionnaire-guide',
    }),
    fileEntry({
      id: 'uiWording',
      title: UI_WORDING_FILE,
      relativePath: rel(path.join(CONF_DIR, UI_WORDING_FILE)),
      absPath: path.join(CONF_DIR, UI_WORDING_FILE),
      role: 'Textes des pop-ups disclaimer (template unique : logo loader, panneau, boutons). Chaque entrée de popups avec template "disclaimer" partage le même rendu visuel.',
      readBy: [
        'Accueil — disclaimer au lancement (GET /api/wizard/ui-wording)',
      ],
      writtenBy: [
        'Vous — édition manuelle des libellés et paragraphes',
        'Création initiale automatique si le fichier n\'existe pas encore (copie depuis la référence extension)',
      ],
    }),
    fileEntry({
      id: 'uiWordingReference',
      title: UI_WORDING_REFERENCE,
      relativePath: rel(path.join(SERVER_CONF_DIR, UI_WORDING_REFERENCE)),
      absPath: path.join(SERVER_CONF_DIR, UI_WORDING_REFERENCE),
      role: 'Référence versionnée des textes de pop-ups. Copiée une seule fois vers .wizard-qa/conf/ si le fichier actif est absent. Modèle commenté pour identifier chaque pop-up.',
      readBy: [
        'ensureUiWordingConfig — copie initiale vers .wizard-qa/conf/',
        'Documentation — structure des pop-ups',
      ],
      writtenBy: [
        'Mainteneurs de l\'extension Wizard QA (mise à jour lors des releases)',
      ],
    }),
    fileEntry({
      id: 'uiWordingPreferences',
      title: UI_WORDING_PREFERENCES_FILE,
      relativePath: rel(path.join(CONF_DIR, UI_WORDING_PREFERENCES_FILE)),
      absPath: path.join(CONF_DIR, UI_WORDING_PREFERENCES_FILE),
      role: 'Pop-ups masqués définitivement (« Ne plus afficher le pop-up »). Un identifiant par pop-up (launchDisclaimer, onboardingIntroPrompt, etc.).',
      readBy: [
        'GET /api/wizard/ui-wording — liste hiddenPopups',
        'Affichage des disclaimers (wizard-disclaimer.js)',
      ],
      writtenBy: [
        'POST /api/wizard/ui-wording/preferences/hide — clic « Ne plus afficher le pop-up »',
        'Création automatique du fichier au premier masquage',
      ],
    }),
    fileEntry({
      id: 'npmInstall',
      title: NPM_INSTALL_FILE,
      relativePath: rel(path.join(CONF_DIR, NPM_INSTALL_FILE)),
      absPath: path.join(CONF_DIR, NPM_INSTALL_FILE),
      role: 'Versions des dépendances npm installées après « Générer npmrc ». Liste des paquets, dossier projet et libellés des étapes d\'installation.',
      readBy: [
        'Page .npmrc — installation npm (GET /api/npm/install-config, POST /api/npm/install)',
      ],
      writtenBy: [
        'Vous — édition des versions et de la liste packages',
        'Création initiale automatique si le fichier n\'existe pas encore (copie depuis la référence extension)',
      ],
    }),
    fileEntry({
      id: 'npmInstallReference',
      title: NPM_INSTALL_REFERENCE,
      relativePath: rel(path.join(SERVER_CONF_DIR, NPM_INSTALL_REFERENCE)),
      absPath: path.join(SERVER_CONF_DIR, NPM_INSTALL_REFERENCE),
      role: 'Référence versionnée des dépendances npm. Modèle commenté copié une fois vers .wizard-qa/conf/npm-install.conf.json.',
      readBy: [
        'ensureNpmInstallConfig — copie initiale',
      ],
      writtenBy: [
        'Mainteneurs de l\'extension Wizard QA',
      ],
    }),
    fileEntry({
      id: 'cypressInstall',
      title: CYPRESS_INSTALL_FILE,
      relativePath: rel(path.join(CONF_DIR, CYPRESS_INSTALL_FILE)),
      absPath: path.join(CONF_DIR, CYPRESS_INSTALL_FILE),
      role: 'Commandes npm de l\'assistant Installer Cypress — modifiez label et args de chaque step.',
      readBy: [
        'loadCypressInstallConfig — exécution /api/cypress/install',
        'Page cypress-install.html — assistant visuel',
      ],
      writtenBy: [
        'Copie initiale depuis cypress-install.conf.reference.json',
        'Vous — personnalisation des commandes',
      ],
      wikiPath: '/wiki.html#config-files',
    }),
    fileEntry({
      id: 'cypressInstallReference',
      title: CYPRESS_INSTALL_REFERENCE,
      relativePath: rel(path.join(SERVER_CONF_DIR, CYPRESS_INSTALL_REFERENCE)),
      absPath: path.join(SERVER_CONF_DIR, CYPRESS_INSTALL_REFERENCE),
      role: 'Référence versionnée des commandes Cypress. Copiée une fois vers .wizard-qa/conf/cypress-install.conf.json.',
      readBy: ['ensureConfig — copie initiale'],
      writtenBy: ['Mainteneurs de l\'extension Wizard QA'],
    }),
    fileEntry({
      id: 'playwrightInstall',
      title: PLAYWRIGHT_INSTALL_FILE,
      relativePath: rel(path.join(CONF_DIR, PLAYWRIGHT_INSTALL_FILE)),
      absPath: path.join(CONF_DIR, PLAYWRIGHT_INSTALL_FILE),
      role: 'Commandes npm/npx de l\'assistant Installer Playwright — modifiez label, runner (npm|npx) et args.',
      readBy: [
        'loadPlaywrightInstallConfig — exécution /api/playwright/install',
        'Page playwright-install.html — assistant visuel',
      ],
      writtenBy: [
        'Copie initiale depuis playwright-install.conf.reference.json',
        'Vous — personnalisation des commandes',
      ],
      wikiPath: '/wiki.html#config-files',
    }),
    fileEntry({
      id: 'playwrightInstallReference',
      title: PLAYWRIGHT_INSTALL_REFERENCE,
      relativePath: rel(path.join(SERVER_CONF_DIR, PLAYWRIGHT_INSTALL_REFERENCE)),
      absPath: path.join(SERVER_CONF_DIR, PLAYWRIGHT_INSTALL_REFERENCE),
      role: 'Référence versionnée des commandes Playwright. Copiée une fois vers .wizard-qa/conf/playwright-install.conf.json.',
      readBy: ['ensureConfig — copie initiale'],
      writtenBy: ['Mainteneurs de l\'extension Wizard QA'],
    }),
    fileEntry({
      id: 'robotInstall',
      title: ROBOT_INSTALL_FILE,
      relativePath: rel(path.join(CONF_DIR, ROBOT_INSTALL_FILE)),
      absPath: path.join(CONF_DIR, ROBOT_INSTALL_FILE),
      role: 'Commandes pip/python/robot de l\'assistant Installer Robot Framework — modifiez label, runner (pip|python|robot) et args.',
      readBy: [
        'loadRobotInstallConfig — exécution /api/robot/install',
        'Page robot-install.html — assistant visuel',
      ],
      writtenBy: [
        'Copie initiale depuis robot-install.conf.reference.json',
        'Vous — personnalisation des commandes',
      ],
      wikiPath: '/wiki.html#config-files',
    }),
    fileEntry({
      id: 'robotInstallReference',
      title: ROBOT_INSTALL_REFERENCE,
      relativePath: rel(path.join(SERVER_CONF_DIR, ROBOT_INSTALL_REFERENCE)),
      absPath: path.join(SERVER_CONF_DIR, ROBOT_INSTALL_REFERENCE),
      role: 'Référence versionnée des commandes Robot Framework. Copiée une fois vers .wizard-qa/conf/robot-install.conf.json.',
      readBy: ['ensureConfig — copie initiale'],
      writtenBy: ['Mainteneurs de l\'extension Wizard QA'],
    }),
    fileEntry({
      id: 'postmanInit',
      title: POSTMAN_INIT_FILE,
      relativePath: rel(path.join(CONF_DIR, POSTMAN_INIT_FILE)),
      absPath: path.join(CONF_DIR, POSTMAN_INIT_FILE),
      role: 'Paramètres scaffold Postman (nom projet, baseUrl, environnement).',
      readBy: ['loadPostmanInitConfig — scaffold /api/postman/install'],
      writtenBy: ['Copie initiale depuis postman-init.conf.reference.json', 'Page postman-install.html'],
      wikiPath: '/wiki.html#config-files',
    }),
    fileEntry({
      id: 'postmanInitReference',
      title: POSTMAN_INIT_REFERENCE,
      relativePath: rel(path.join(SERVER_CONF_DIR, POSTMAN_INIT_REFERENCE)),
      absPath: path.join(SERVER_CONF_DIR, POSTMAN_INIT_REFERENCE),
      role: 'Référence des paramètres Postman scaffold.',
      readBy: ['ensureConfig — copie initiale'],
      writtenBy: ['Mainteneurs de l\'extension Wizard QA'],
    }),
    fileEntry({
      id: 'postmanInstall',
      title: POSTMAN_INSTALL_FILE,
      relativePath: rel(path.join(CONF_DIR, POSTMAN_INSTALL_FILE)),
      absPath: path.join(CONF_DIR, POSTMAN_INSTALL_FILE),
      role: 'Commandes scaffold / npm / npx de l\'assistant Postman — Newman et reporters.',
      readBy: ['loadPostmanInstallConfig — /api/postman/install'],
      writtenBy: ['Copie initiale depuis postman-install.conf.reference.json'],
      wikiPath: '/wiki.html#config-files',
    }),
    fileEntry({
      id: 'postmanInstallReference',
      title: POSTMAN_INSTALL_REFERENCE,
      relativePath: rel(path.join(SERVER_CONF_DIR, POSTMAN_INSTALL_REFERENCE)),
      absPath: path.join(SERVER_CONF_DIR, POSTMAN_INSTALL_REFERENCE),
      role: 'Référence versionnée Postman/Newman. Copiée vers .wizard-qa/conf/postman-install.conf.json.',
      readBy: ['ensureConfig — copie initiale'],
      writtenBy: ['Mainteneurs de l\'extension Wizard QA'],
    }),
    fileEntry({
      id: 'k6Init',
      title: K6_INIT_FILE,
      relativePath: rel(path.join(CONF_DIR, K6_INIT_FILE)),
      absPath: path.join(CONF_DIR, K6_INIT_FILE),
      role: 'Paramètres scaffold k6 (URL cible, VUs, durée, seuils p95).',
      readBy: ['loadK6InitConfig — scaffold /api/k6/install'],
      writtenBy: ['Copie initiale depuis k6-init.conf.reference.json', 'Page k6-install.html'],
      wikiPath: '/wiki.html#config-files',
    }),
    fileEntry({
      id: 'k6InitReference',
      title: K6_INIT_REFERENCE,
      relativePath: rel(path.join(SERVER_CONF_DIR, K6_INIT_REFERENCE)),
      absPath: path.join(SERVER_CONF_DIR, K6_INIT_REFERENCE),
      role: 'Référence des paramètres k6 scaffold.',
      readBy: ['ensureConfig — copie initiale'],
      writtenBy: ['Mainteneurs de l\'extension Wizard QA'],
    }),
    fileEntry({
      id: 'k6Install',
      title: K6_INSTALL_FILE,
      relativePath: rel(path.join(CONF_DIR, K6_INSTALL_FILE)),
      absPath: path.join(CONF_DIR, K6_INSTALL_FILE),
      role: 'Commandes scaffold / npm / k6 / shell de l\'assistant k6 — binaire Grafana k6.',
      readBy: ['loadK6InstallConfig — /api/k6/install'],
      writtenBy: ['Copie initiale depuis k6-install.conf.reference.json'],
      wikiPath: '/wiki.html#config-files',
    }),
    fileEntry({
      id: 'k6InstallReference',
      title: K6_INSTALL_REFERENCE,
      relativePath: rel(path.join(SERVER_CONF_DIR, K6_INSTALL_REFERENCE)),
      absPath: path.join(SERVER_CONF_DIR, K6_INSTALL_REFERENCE),
      role: 'Référence versionnée k6. Copiée vers .wizard-qa/conf/k6-install.conf.json.',
      readBy: ['ensureConfig — copie initiale'],
      writtenBy: ['Mainteneurs de l\'extension Wizard QA'],
    }),
    fileEntry({
      id: 'k6PerfQuestionnaire',
      title: K6_PERF_QUESTIONNAIRE_FILE,
      relativePath: rel(path.join(CONF_DIR, K6_PERF_QUESTIONNAIRE_FILE)),
      absPath: path.join(CONF_DIR, K6_PERF_QUESTIONNAIRE_FILE),
      role: 'Questions du wizard k6 performance (40+ étapes) — modifiable.',
      readBy: ['GET /api/k6/perf/questionnaire'],
      writtenBy: ['Copie initiale depuis k6-perf-questionnaire.conf.reference.json'],
      wikiPath: '/wiki.html#k6',
    }),
    fileEntry({
      id: 'wizardPaths',
      title: 'wizard.paths.json',
      relativePath: rel(paths.wizardPaths),
      absPath: paths.wizardPaths,
      role: 'Surcharge optionnelle des chemins (dossier hook, réparation, documentation).',
      readBy: ['Serveur Wizard — résolution des chemins (paths.mjs)'],
      writtenBy: ['Configuration manuelle avancée (fichier optionnel)'],
    }),
    fileEntry({
      id: 'hookEnv',
      title: '.env (Hook Git)',
      relativePath: rel(paths.hookEnv),
      absPath: paths.hookEnv,
      role: 'Credentials JIRA / Xray et proxy pour hook-run.mjs — même source que la prise de connaissance.',
      readBy: [
        'Hook Git — assistant et dry-run',
        'Sync JIRA — analyse et synchronisation',
        'Profil projet — repli si wizard.defaults incomplet',
      ],
      writtenBy: [
        'Prise de connaissance — synchronisation automatique des URL et tokens',
        'Assistant Hook Git — enregistrement étape JIRA / Xray',
        'POST /api/hook/config',
      ],
      secrets: true,
    }),
    fileEntry({
      id: 'hooksConf',
      title: 'hooks.conf',
      relativePath: rel(paths.hooksConf),
      absPath: paths.hooksConf,
      role: 'Plans de test, suites .feature, dossiers VS Code et Testing Board JIRA.',
      readBy: [
        'Hook Git — scan des dossiers et dry-run',
        'Sync JIRA — correspondance plans locaux / JIRA',
      ],
      writtenBy: [
        'Assistant Hook Git — étapes hooks.conf, plans et Testing Board',
        'POST /api/hook/config, /api/hook/plans/board',
      ],
    }),
    fileEntry({
      id: 'repairConf',
      title: 'repair.conf.json',
      relativePath: rel(paths.repairConf),
      absPath: paths.repairConf,
      role: 'Configuration de la préparation du poste (Node offline, Cypress, npm).',
      readBy: ['Page Pré-configuration poste — repair.html'],
      writtenBy: ['Assistant réparation / initialisation Cypress'],
    }),
  ]

  return {
    confDir: rel(CONF_DIR),
    hookDir: rel(HOOK_DIR),
    files,
    syncNote: 'Export accueil = bundle wizard.defaults.json + fichiers .wizard-qa/conf (assistants stack, questionnaire, pop-ups). Les URL JIRA et tokens Xray saisis lors de la prise de connaissance sont recopiés automatiquement dans le .env du Hook Git à chaque enregistrement.',
  }
}

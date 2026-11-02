import fs from 'fs'
import path from 'path'
import { CONF_DIR, REPO_ROOT, SERVER_CONF_DIR } from './paths.mjs'
import { parseStackQuestionnaireText } from './stack-questionnaire-jsonc.mjs'
import { enrichK6QuestionsWithGuides } from './k6-perf-questionnaire-guides.mjs'

export const K6_PERF_QUESTIONNAIRE_FILE = 'k6-perf-questionnaire.conf.json'
export const K6_PERF_QUESTIONNAIRE_REFERENCE = 'k6-perf-questionnaire.conf.reference.json'

function userPath() {
  return path.join(CONF_DIR, K6_PERF_QUESTIONNAIRE_FILE)
}

function referencePath() {
  return path.join(SERVER_CONF_DIR, K6_PERF_QUESTIONNAIRE_REFERENCE)
}

export function getBuiltinK6PerfQuestionnaire() {
  const builtin = {
    version: 1,
    description: 'Questionnaire wizard k6 — tests de performance CA-TS.',
    sections: [
      { id: 'contexte', title: 'Contexte & objectifs', order: 1 },
      { id: 'cible', title: 'Cible & périmètre', order: 2 },
      { id: 'charge', title: 'Profil de charge', order: 3 },
      { id: 'seuils', title: 'Seuils & SLA', order: 4 },
      { id: 'auth', title: 'Authentification', order: 5 },
      { id: 'donnees', title: 'Données & scénarios', order: 6 },
      { id: 'reseau', title: 'Réseau & sécurité', order: 7 },
      { id: 'reporting', title: 'Reporting & observabilité', order: 8 },
      { id: 'cicd', title: 'CI/CD & planification', order: 9 },
      { id: 'gouvernance', title: 'Gouvernance & risques', order: 10 },
    ],
    questions: [
      { id: 'campaignName', section: 'contexte', title: 'Nom de campagne', question: 'Quel nom donnez-vous à cette campagne de performance ?', hint: 'Ex. Smoke-recette-P0326, Charge-pic-fin-mois', type: 'text', required: true, default: 'Campagne-perf-recette' },
      { id: 'campaignObjective', section: 'contexte', title: 'Objectif principal', question: 'Quel type de test de performance souhaitez-vous réaliser ?', type: 'single', required: true, default: 'smoke', options: [
        { id: 'smoke', label: 'Smoke — disponibilité & latence minimale (faible charge)' },
        { id: 'load', label: 'Load — charge nominale attendue en production' },
        { id: 'stress', label: 'Stress — au-delà de la capacité nominale' },
        { id: 'spike', label: 'Spike — pic brutal de trafic' },
        { id: 'soak', label: 'Soak / endurance — charge stable sur longue durée' },
        { id: 'breakpoint', label: 'Breakpoint — trouver le point de rupture' },
      ] },
      { id: 'businessCriticality', section: 'contexte', title: 'Criticité métier', question: 'Quelle est la criticité de l\'application testée ?', type: 'single', default: 'medium', options: [
        { id: 'low', label: 'Faible — outil interne, impact limité' },
        { id: 'medium', label: 'Moyenne — usage métier significatif' },
        { id: 'high', label: 'Élevée — parcours client ou financier' },
        { id: 'critical', label: 'Critique — réglementaire ou temps réel' },
      ] },
      { id: 'releaseGate', section: 'contexte', title: 'Porte de release', question: 'Ce test bloque-t-il une mise en production ?', type: 'single', default: 'advisory', options: [
        { id: 'advisory', label: 'Non — indicateur, décision humaine' },
        { id: 'blocking', label: 'Oui — échec = pas de release' },
      ] },
      { id: 'stakeholders', section: 'contexte', title: 'Parties prenantes', question: 'Qui valide les résultats ? (PO, QA, ops, sécurité…)', type: 'lines', linePlaceholder: 'Prénom Nom — rôle (ex. Marie Dupont, PO)', linesAddLabel: '+ Ajouter une personne', default: '' },

      { id: 'targetType', section: 'cible', title: 'Type de cible', question: 'Que testez-vous principalement ?', type: 'single', required: true, default: 'web', options: [
        { id: 'web', label: 'Application web (pages HTML / SPA)' },
        { id: 'api', label: 'API REST / JSON' },
        { id: 'mixed', label: 'Mixte web + API' },
        { id: 'websocket', label: 'WebSocket / temps réel' },
        { id: 'grpc', label: 'gRPC / protocoles binaires' },
      ] },
      { id: 'baseUrl', section: 'cible', title: 'URL de base', question: 'URL racine de l\'environnement cible', hint: 'Recette ou préprod dédiée charge — jamais la production réelle sans accord.', type: 'url', required: true, default: 'https://app-recette.example.com' },
      { id: 'entryPaths', section: 'cible', title: 'Chemins à sonder', question: 'Quels chemins ou URLs inclure dans la campagne ?', type: 'lines', linePlaceholder: '/chemin relatif (ex. /api/orders)', linesAddLabel: '+ Ajouter un chemin', default: '/\n/health' },
      { id: 'healthCheckPath', section: 'cible', title: 'Healthcheck', question: 'Endpoint de disponibilité (smoke)', type: 'text', default: '/health' },
      { id: 'environment', section: 'cible', title: 'Environnement', question: 'Environnement d\'exécution', type: 'single', default: 'recette', options: [
        { id: 'recette', label: 'Recette / QA' },
        { id: 'integration', label: 'Intégration continue' },
        { id: 'preprod', label: 'Pré-production' },
        { id: 'prod-like', label: 'Prod-like (iso-prod, données masquées)' },
        { id: 'isolated-mock', label: 'Bac à sable / mocks' },
      ] },

      { id: 'executorType', section: 'charge', title: 'Modèle d\'exécuteur k6', question: 'Comment modéliser la montée en charge ?', type: 'single', default: 'constant-vus', options: [
        { id: 'constant-vus', label: 'VUs constants — charge stable' },
        { id: 'ramping-vus', label: 'Rampe — montée/descente progressive' },
        { id: 'constant-arrival-rate', label: 'Débit constant (req/s) — modèle ouvert' },
        { id: 'shared-iterations', label: 'Itérations partagées — nombre fixe de passages' },
        { id: 'per-vu-iterations', label: 'Itérations par VU' },
      ] },
      { id: 'virtualUsers', section: 'charge', title: 'Utilisateurs virtuels (VUs)', question: 'Nombre de VUs simultanés (pic)', type: 'number', default: 10, min: 1, max: 10000 },
      { id: 'duration', section: 'charge', title: 'Durée totale', question: 'Durée de la campagne (format k6)', hint: 'Ex. 30s, 5m, 1h30m', type: 'text', default: '5m' },
      { id: 'rampUpDuration', section: 'charge', title: 'Rampe montée', question: 'Durée de montée en charge', type: 'text', default: '1m' },
      { id: 'rampDownDuration', section: 'charge', title: 'Rampe descente', question: 'Durée de descente', type: 'text', default: '30s' },
      { id: 'thinkTimeMin', section: 'charge', title: 'Temps de réflexion min', question: 'Pause min entre requêtes (secondes)', type: 'number', default: 1, min: 0, max: 120 },
      { id: 'thinkTimeMax', section: 'charge', title: 'Temps de réflexion max', question: 'Pause max entre requêtes (secondes)', type: 'number', default: 3, min: 0, max: 300 },
      { id: 'arrivalRate', section: 'charge', title: 'Débit cible (req/s)', question: 'Pour modèle « débit constant » — requêtes par seconde', type: 'number', default: 50, min: 1, max: 50000 },
      { id: 'maxVUsCap', section: 'charge', title: 'Plafond VUs (sécurité)', question: 'Arrêt si dépassement de ce nombre de VUs', type: 'number', default: 500, min: 1, max: 100000 },

      { id: 'p95Ms', section: 'seuils', title: 'Seuil p95 (ms)', question: 'Latence p95 maximale acceptée (millisecondes)', type: 'number', default: 500, min: 50, max: 60000 },
      { id: 'p99Ms', section: 'seuils', title: 'Seuil p99 (ms)', question: 'Latence p99 maximale', type: 'number', default: 1000, min: 50, max: 120000 },
      { id: 'maxErrorRate', section: 'seuils', title: 'Taux d\'erreur max (%)', question: 'Pourcentage d\'échecs HTTP acceptables', type: 'number', default: 1, min: 0, max: 100 },
      { id: 'minThroughputRps', section: 'seuils', title: 'Débit minimum (req/s)', question: 'Débit minimal attendu (0 = non applicable)', type: 'number', default: 0, min: 0, max: 100000 },
      { id: 'abortOnFail', section: 'seuils', title: 'Arrêt sur échec seuil', question: 'k6 doit-il arrêter la campagne si un seuil est violé ?', type: 'single', default: 'yes', options: [
        { id: 'yes', label: 'Oui — fail fast' },
        { id: 'no', label: 'Non — aller au bout pour analyse' },
      ] },

      { id: 'authMode', section: 'auth', title: 'Mode d\'authentification', question: 'Comment s\'authentifient les VUs ?', type: 'single', default: 'none', options: [
        { id: 'none', label: 'Aucune — endpoints publics' },
        { id: 'basic', label: 'HTTP Basic' },
        { id: 'bearer', label: 'Bearer token (header Authorization)' },
        { id: 'cookie', label: 'Session cookie après login' },
        { id: 'oauth2', label: 'OAuth2 / OIDC (client credentials)' },
        { id: 'mutual-tls', label: 'mTLS / certificat client' },
      ] },
      { id: 'authHeaderName', section: 'auth', title: 'Nom du header auth', question: 'Si Bearer/custom — nom du header', type: 'text', default: 'Authorization' },
      { id: 'tokenEnvVar', section: 'auth', title: 'Variable d\'environnement token', question: 'Nom de la variable k6 (__ENV) pour le secret', type: 'text', default: 'AUTH_TOKEN' },
      { id: 'loginScriptNeeded', section: 'auth', title: 'Script de login', question: 'Faut-il un scénario setup (login une fois par VU) ?', type: 'single', default: 'no', options: [
        { id: 'no', label: 'Non' },
        { id: 'yes', label: 'Oui — setup() / scénario auth dédié' },
      ] },

      { id: 'dataDriven', section: 'donnees', title: 'Données paramétrées', question: 'Jeu de données pour les VUs', type: 'single', default: 'no', options: [
        { id: 'no', label: 'Non — même parcours pour tous' },
        { id: 'csv', label: 'CSV partagé (k6/data/)' },
        { id: 'json', label: 'JSON fixtures' },
        { id: 'shared-pool', label: 'Pool partagé en mémoire (setup)' },
      ] },
      { id: 'csvDataPath', section: 'donnees', title: 'Fichier CSV', question: 'Chemin relatif du CSV (si applicable)', type: 'text', default: 'k6/data/users.csv' },
      { id: 'scenarioDescription', section: 'donnees', title: 'Scénarios métier', question: 'Décrivez les parcours à simuler (étapes, % du trafic)', type: 'textarea', default: '70% consultation\n20% création\n10% recherche' },

      { id: 'useProxy', section: 'reseau', title: 'Proxy entreprise', question: 'Passage par un proxy CA-TS ?', type: 'single', default: 'corporate', options: [
        { id: 'no', label: 'Non — accès direct' },
        { id: 'corporate', label: 'Oui — proxy standard poste' },
        { id: 'custom', label: 'Proxy personnalisé (URL dédiée)' },
      ] },
      { id: 'proxyUrl', section: 'reseau', title: 'URL proxy', question: 'URL du proxy si custom', type: 'text', default: '' },
      { id: 'tlsInsecure', section: 'reseau', title: 'TLS insécure', question: 'Ignorer les erreurs certificat (recette uniquement) ?', type: 'single', default: 'no', options: [
        { id: 'no', label: 'Non — vérifier TLS' },
        { id: 'yes', label: 'Oui — K6_INSECURE_SKIP_TLS_VERIFY' },
      ] },
      { id: 'userAgent', section: 'reseau', title: 'User-Agent', question: 'Chaîne User-Agent des requêtes', type: 'text', default: 'WizardQA-k6/1.0' },

      { id: 'outputFormats', section: 'reporting', title: 'Formats de sortie', question: 'Exports souhaités (plusieurs choix)', type: 'multi', default: ['console', 'json'], options: [
        { id: 'console', label: 'Console (résumé terminal)' },
        { id: 'json', label: 'JSON (reports/k6/)' },
        { id: 'csv', label: 'CSV time-series' },
        { id: 'influx', label: 'InfluxDB' },
        { id: 'prometheus', label: 'Prometheus remote write' },
        { id: 'cloud', label: 'Grafana Cloud k6' },
      ] },
      { id: 'reportTags', section: 'reporting', title: 'Tags de campagne', question: 'Tags k6 (key=value, un par ligne)', type: 'textarea', default: 'projet=P0326\nenv=recette' },
      { id: 'grafanaCloudProject', section: 'reporting', title: 'Projet Grafana Cloud', question: 'ID ou nom projet (si Cloud)', type: 'text', default: '' },

      { id: 'runInCi', section: 'cicd', title: 'Exécution CI', question: 'Campagne prévue en pipeline CI ?', type: 'single', default: 'yes', options: [
        { id: 'yes', label: 'Oui — GitLab / Azure DevOps / Jenkins' },
        { id: 'no', label: 'Non — poste local uniquement' },
      ] },
      { id: 'ciParallelism', section: 'cicd', title: 'Parallélisme CI', question: 'Nombre d\'agents parallèles max', type: 'number', default: 1, min: 1, max: 32 },
      { id: 'scheduleCron', section: 'cicd', title: 'Planification', question: 'Cron de campagne récurrente (vide = manuel)', hint: '0 2 * * 1 = lundi 2h', type: 'text', default: '' },
      { id: 'notifyOnFail', section: 'cicd', title: 'Alertes échec', question: 'Notifications si seuils violés', type: 'multi', default: ['teams'], options: [
        { id: 'email', label: 'E-mail' },
        { id: 'teams', label: 'Microsoft Teams' },
        { id: 'jira', label: 'Ticket JIRA' },
      ] },

      { id: 'isolationConfirmed', section: 'gouvernance', title: 'Isolement environnement', question: 'Confirmez-vous que l\'environnement est dédié à la charge ?', type: 'single', required: true, default: 'yes', options: [
        { id: 'yes', label: 'Oui — pas de prod, pas de recette partagée critique' },
        { id: 'no', label: 'Non — à valider avec l\'équipe ops' },
      ] },
      { id: 'dataAnonymized', section: 'gouvernance', title: 'Données anonymisées', question: 'Les jeux de données sont-ils conformes RGPD ?', type: 'single', default: 'yes', options: [
        { id: 'yes', label: 'Oui — données fictives ou masquées' },
        { id: 'na', label: 'N/A — pas de données personnelles' },
        { id: 'no', label: 'Non — à traiter avant campagne' },
      ] },
      { id: 'rollbackPlan', section: 'gouvernance', title: 'Plan de rollback', question: 'Que faire en cas de saturation de l\'environnement ?', type: 'textarea', default: 'Arrêt immédiat k6, alerte ops, restauration snapshot DB si besoin.' },
      { id: 'maxDurationCap', section: 'gouvernance', title: 'Durée max absolue', question: 'Plafond durée (sécurité — ex. 2h)', type: 'text', default: '2h' },
    ],
  }
  return {
    ...builtin,
    questions: enrichK6QuestionsWithGuides(builtin.questions),
  }
}

function ensureUserFile() {
  const dest = userPath()
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(CONF_DIR, { recursive: true })
    const ref = referencePath()
    if (fs.existsSync(ref)) {
      fs.copyFileSync(ref, dest)
    } else {
      fs.writeFileSync(dest, `${JSON.stringify(getBuiltinK6PerfQuestionnaire(), null, 2)}\n`, 'utf8')
    }
  }
  return dest
}

export function loadK6PerfQuestionnaire() {
  const filePath = ensureUserFile()
  const relativePath = path.relative(REPO_ROOT, filePath).replace(/\\/g, '/')
  let raw = getBuiltinK6PerfQuestionnaire()
  try {
    raw = parseStackQuestionnaireText(fs.readFileSync(filePath, 'utf8'))
  } catch (err) {
    console.warn(`[wizard-qa] k6 perf questionnaire invalide : ${err.message}`)
  }
  const sections = Array.isArray(raw.sections) && raw.sections.length
    ? raw.sections
    : getBuiltinK6PerfQuestionnaire().sections
  const questions = enrichK6QuestionsWithGuides(
    Array.isArray(raw.questions) && raw.questions.length
      ? raw.questions
      : getBuiltinK6PerfQuestionnaire().questions,
  )
  return {
    version: raw.version || 1,
    description: raw.description || '',
    sections: sections.sort((a, b) => (a.order ?? 99) - (b.order ?? 99)),
    questions,
    path: filePath,
    relativePath,
    absolutePath: filePath,
  }
}

export function getK6PerfQuestionnaireForApi() {
  const cfg = loadK6PerfQuestionnaire()
  return {
    ok: true,
    version: cfg.version,
    description: cfg.description,
    sections: cfg.sections,
    questions: cfg.questions,
    questionCount: cfg.questions.length,
    questionnaireConfigPath: cfg.relativePath,
    questionnaireConfigAbsolutePath: cfg.absolutePath,
  }
}

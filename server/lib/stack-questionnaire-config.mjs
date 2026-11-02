import fs from 'fs'
import path from 'path'
import { CONF_DIR, REPO_ROOT, SERVER_CONF_DIR } from './paths.mjs'
import { parseStackQuestionnaireText } from './stack-questionnaire-jsonc.mjs'
import { formatQuestionnaireFile } from './stack-questionnaire-format.mjs'

export { parseStackQuestionnaireText, stripJsonComments } from './stack-questionnaire-jsonc.mjs'
export { formatQuestionnaireFile, MARKERS } from './stack-questionnaire-format.mjs'

/** Fichier unique lu et modifié par l'utilisateur — pas de copie, pas d'autre chemin. */
export const STACK_QUESTIONNAIRE_FILE = 'stack-questionnaire.conf.json'
/** Référence versionnée (extension) — copiée une seule fois si le fichier utilisateur n'existe pas. */
export const STACK_QUESTIONNAIRE_REFERENCE = 'stack-questionnaire.conf.reference.json'

const USER_CONFIG_PATH = () => path.join(CONF_DIR, STACK_QUESTIONNAIRE_FILE)
const REFERENCE_CONFIG_PATH = () => path.join(SERVER_CONF_DIR, STACK_QUESTIONNAIRE_REFERENCE)

const DEFAULT_TOOLS = {
  cypress: { label: 'Cypress', color: '#58D0A8', order: 1 },
  robot: { label: 'Robot Framework', color: '#00C0B5', order: 2 },
  playwright: { label: 'Playwright', color: '#62BB46', order: 3 },
  postman: { label: 'Postman', color: '#FF6C37', order: 4 },
  k6: { label: 'k6', color: '#7D64FF', order: 5 },
}

/** Contenu initial écrit une seule fois si le fichier utilisateur n'existe pas encore. */
export function getBuiltinQuestionnaire() {
  return [
    {
      id: 'mainGoal',
      title: 'Objectif principal',
      question: 'Quel est le principal objectif de vos tests automatisés ?',
      hint: 'Pensez à ce que vous devez vérifier au quotidien.',
      options: [
        { id: 'web', label: 'Vérifier un site ou une application web (écrans, formulaires, parcours)', weights: { cypress: 3, playwright: 3 } },
        { id: 'api', label: 'Tester des services ou API (sans interface graphique)', weights: { postman: 5 } },
        { id: 'process', label: 'Couvrir des processus métier complets (web, fichiers, intégrations…)', weights: { robot: 4, playwright: 2 } },
        { id: 'unsure', label: 'Je ne sais pas encore — j\'ai besoin d\'être guidé', weights: { cypress: 1, robot: 1, playwright: 1, postman: 1 } },
      ],
    },
    {
      id: 'authors',
      title: 'Qui écrit les tests ?',
      question: 'Qui rédigera et maintiendra les scénarios de test ?',
      hint: 'Il n\'y a pas de mauvaise réponse — cela aide à cibler le bon niveau de simplicité.',
      options: [
        { id: 'functional', label: 'Des testeurs métier / fonctionnels (peu à l\'aise avec le code)', weights: { robot: 4, postman: 2, cypress: 2 } },
        { id: 'qa', label: 'Des QA avec quelques bases techniques', weights: { cypress: 4, postman: 3, playwright: 2 } },
        { id: 'dev', label: 'Des développeurs ou profils très techniques', weights: { playwright: 4, cypress: 3 } },
      ],
    },
    {
      id: 'descriptionStyle',
      title: 'Style de description',
      question: 'Comment préférez-vous décrire vos tests ?',
      options: [
        { id: 'gherkin', label: 'En langage métier (ex. « étant donné / quand / alors »)', weights: { robot: 4, cypress: 2 } },
        { id: 'record', label: 'En enregistrant mes actions dans le navigateur', weights: { cypress: 5 } },
        { id: 'script', label: 'En écrivant des scripts plus techniques', weights: { playwright: 4, cypress: 2 } },
        { id: 'forms', label: 'Via des formulaires ou collections simples', weights: { postman: 4, robot: 2 } },
      ],
    },
    {
      id: 'browsers',
      title: 'Navigateurs',
      question: 'Sur quels navigateurs devez-vous tester ?',
      options: [
        { id: 'single', label: 'Un seul navigateur (Chrome ou Edge) suffit', weights: { cypress: 4 } },
        { id: 'multi', label: 'Plusieurs navigateurs (Chrome, Firefox, Safari…)', weights: { playwright: 5 } },
        { id: 'none', label: 'Pas de navigateur — uniquement des API', weights: { postman: 5 } },
      ],
    },
    {
      id: 'jiraLink',
      title: 'Lien JIRA / Xray',
      question: 'Vos tests doivent-ils être reliés aux tickets JIRA / Xray ?',
      options: [
        { id: 'required', label: 'Oui, c\'est indispensable pour notre squad', weights: { cypress: 5, robot: 3 } },
        { id: 'nice', label: 'C\'est un plus mais pas obligatoire', weights: { cypress: 2, robot: 2, playwright: 2 } },
        { id: 'no', label: 'Non, pas pour l\'instant', weights: { postman: 2 } },
      ],
    },
    {
      id: 'volume',
      title: 'Volume de tests',
      question: 'Quel volume de tests anticipez-vous ?',
      options: [
        { id: 'smoke', label: 'Quelques tests de fumée / contrôles rapides', weights: { postman: 3, cypress: 2 } },
        { id: 'medium', label: 'Une campagne moyenne (dizaines de scénarios)', weights: { cypress: 4, playwright: 2 } },
        { id: 'large', label: 'Un large référentiel de régression', weights: { playwright: 4, robot: 3, cypress: 2 } },
      ],
    },
    {
      id: 'cicd',
      title: 'Exécution automatique',
      question: 'Les tests seront-ils exécutés souvent en chaîne d\'intégration (CI/CD) ?',
      options: [
        { id: 'often', label: 'Oui, automatiquement à chaque livraison', weights: { playwright: 4, cypress: 2 } },
        { id: 'sometimes', label: 'Occasionnellement', weights: { cypress: 3, playwright: 2 } },
        { id: 'manual', label: 'Principalement à la demande / manuellement', weights: { postman: 2, robot: 2, cypress: 1 } },
      ],
    },
    {
      id: 'mobile',
      title: 'Mobile / tablette',
      question: 'Avez-vous besoin de tester sur mobile ou tablette ?',
      options: [
        { id: 'yes', label: 'Oui', weights: { playwright: 4, robot: 2 } },
        { id: 'no', label: 'Non', weights: { cypress: 2, playwright: 1 } },
        { id: 'na', label: 'Sans objet (tests API uniquement)', weights: { postman: 3 } },
      ],
    },
    {
      id: 'reporting',
      title: 'Rapports',
      question: 'Quel niveau de rapport attendez-vous pour les parties prenantes ?',
      options: [
        { id: 'visual', label: 'Rapports visuels avec captures d\'écran à chaque étape', weights: { cypress: 4, playwright: 3 } },
        { id: 'summary', label: 'Rapports synthétiques passé / échoué', weights: { robot: 3, postman: 2 } },
        { id: 'any', label: 'Peu importe', weights: {} },
      ],
    },
    {
      id: 'teamSkills',
      title: 'Compétences existantes',
      question: 'Votre équipe a-t-elle déjà une compétence particulière ?',
      options: [
        { id: 'python', label: 'Python', weights: { robot: 5 } },
        { id: 'js', label: 'JavaScript / TypeScript', weights: { cypress: 4, playwright: 4 } },
        { id: 'none', label: 'Aucune préférence — à définir ensemble', weights: { cypress: 1, postman: 1 } },
      ],
    },
    {
      id: 'apiMix',
      title: 'API et interface',
      question: 'Votre application combine-t-elle interface web et appels API ?',
      options: [
        { id: 'both', label: 'Oui, il faut tester l\'UI et les API', weights: { cypress: 3, playwright: 2, postman: 2 } },
        { id: 'ui', label: 'Non, surtout l\'interface utilisateur', weights: { cypress: 3, playwright: 3 } },
        { id: 'apiOnly', label: 'Uniquement des API / services backend', weights: { postman: 5 } },
      ],
    },
    {
      id: 'simplicity',
      title: 'Simplicité',
      question: 'Quelle priorité accordez-vous à la simplicité de prise en main ?',
      options: [
        { id: 'high', label: 'Très importante — je veux démarrer vite', weights: { cypress: 4, postman: 3 } },
        { id: 'medium', label: 'Moyenne — j\'accepte un effort initial', weights: { cypress: 2, robot: 2, playwright: 2 } },
        { id: 'low', label: 'Secondaire — la puissance prime', weights: { playwright: 3, robot: 3 } },
      ],
    },
    {
      id: 'legacyUi',
      title: 'Application existante',
      question: 'Votre application comporte-t-elle des écrans anciens ou plusieurs technologies (legacy, iframe…) ?',
      hint: 'Les interfaces complexes influencent le choix de l\'outil web.',
      options: [
        { id: 'modern', label: 'Application web moderne et homogène', weights: { cypress: 3, playwright: 2 } },
        { id: 'mixed', label: 'Mélange d\'écrans anciens et récents', weights: { playwright: 4, robot: 2 } },
        { id: 'na', label: 'Sans interface graphique', weights: { postman: 3 } },
      ],
    },
    {
      id: 'collaboration',
      title: 'Travail en équipe',
      question: 'Plusieurs testeurs doivent-ils maintenir les mêmes scénarios ?',
      options: [
        { id: 'yes', label: 'Oui, en équipe sur un référentiel commun', weights: { robot: 3, playwright: 2, cypress: 2 } },
        { id: 'solo', label: 'Non, surtout un référent QA principal', weights: { cypress: 3, postman: 2 } },
        { id: 'unsure', label: 'Pas encore défini', weights: {} },
      ],
    },
    {
      id: 'perfLoad',
      title: 'Performance',
      question: 'Avez-vous besoin de contrôles de performance ou de temps de réponse ?',
      hint: 'Oriente Postman (latence API), k6 (charge) ou les stacks UI.',
      options: [
        { id: 'no', label: 'Non, pas dans ce projet', weights: { cypress: 1, playwright: 1 } },
        { id: 'light', label: 'Quelques contrôles de temps de réponse API', weights: { postman: 4, playwright: 2, k6: 2 } },
        { id: 'yes', label: 'Oui, campagne performance importante', weights: { k6: 5, playwright: 2, robot: 1 } },
      ],
    },
  ]
}

function buildInitialUserConfig() {
  return {
    version: 1,
    description: 'Questionnaire stack — modifiez CE fichier : chaque entrée de "questions" = une étape du wizard.',
    tools: DEFAULT_TOOLS,
    questions: getBuiltinQuestionnaire(),
  }
}

/** Crée le fichier utilisateur une seule fois s'il est absent — jamais écrasé ensuite. */
export function ensureStackQuestionnaireConfig() {
  const userPath = USER_CONFIG_PATH()
  if (!fs.existsSync(userPath)) {
    fs.mkdirSync(CONF_DIR, { recursive: true })
    const referencePath = REFERENCE_CONFIG_PATH()
    if (fs.existsSync(referencePath)) {
      fs.copyFileSync(referencePath, userPath)
    } else {
      fs.writeFileSync(
        userPath,
        formatQuestionnaireFile(buildInitialUserConfig(), {
          relativePath: `.wizard-qa/conf/${STACK_QUESTIONNAIRE_FILE}`,
        }),
        'utf8'
      )
    }
  }
  return userPath
}

function resolveTools(raw = {}) {
  const merged = { ...DEFAULT_TOOLS, ...(raw.tools || {}) }
  const stackIds = Object.entries(merged)
    .filter(([, meta]) => meta && meta.enabled !== false)
    .sort((a, b) => (a[1].order ?? 99) - (b[1].order ?? 99))
    .map(([id]) => id)

  const stackLabels = {}
  const chartColors = {}
  for (const id of stackIds) {
    stackLabels[id] = merged[id].label || id
    chartColors[id] = merged[id].color || '#009597'
  }

  return { tools: merged, stackIds, stackLabels, chartColors }
}

function normalizeWeights(weights, stackIds) {
  const normalized = {}
  for (const id of stackIds) normalized[id] = Number(weights?.[id]) || 0
  for (const [k, v] of Object.entries(weights || {})) {
    if (!(k in normalized)) normalized[k] = Number(v) || 0
  }
  return normalized
}

function normalizeOption(opt, stackIds) {
  if (!opt?.id) throw new Error('Chaque option doit avoir un champ "id".')
  return {
    id: opt.id,
    label: opt.label || opt.id,
    weights: normalizeWeights(opt.weights || {}, stackIds),
  }
}

function normalizeQuestionFromFile(q, stackIds) {
  if (!q?.id) throw new Error('Chaque question doit avoir un champ "id" unique.')
  if (!Array.isArray(q.options) || !q.options.length) {
    throw new Error(`Question "${q.id}" : le tableau "options" est requis (réponses + pondérations weights).`)
  }
  return {
    id: q.id,
    title: q.title || q.id,
    question: q.question || q.title || q.id,
    hint: q.hint || '',
    enabled: q.enabled !== false,
    options: q.options.map((opt) => normalizeOption(opt, stackIds)),
  }
}

/** Lit uniquement le tableau questions du fichier utilisateur (ordre = étapes du wizard). */
function resolveQuestions(raw, stackIds) {
  const items = [...(raw.questions || [])]
  if (raw.extraQuestions?.length) {
    items.push(...raw.extraQuestions)
  }
  if (!items.length) {
    throw new Error(
      `Aucune question dans ${STACK_QUESTIONNAIRE_FILE}. Ajoutez des objets dans le tableau "questions".`
    )
  }
  const seen = new Set()
  const questions = []
  for (const q of items) {
    const normalized = normalizeQuestionFromFile(q, stackIds)
    if (seen.has(normalized.id)) {
      throw new Error(`Id de question en double : "${normalized.id}".`)
    }
    seen.add(normalized.id)
    if (normalized.enabled) questions.push(normalized)
  }
  if (!questions.length) {
    throw new Error('Toutes les questions sont désactivées (enabled: false).')
  }
  return questions
}

export function loadStackQuestionnaireConfig() {
  const userPath = ensureStackQuestionnaireConfig()
  const relativePath = path.relative(REPO_ROOT, userPath).replace(/\\/g, '/')

  let text
  try {
    text = fs.readFileSync(userPath, 'utf8')
  } catch (err) {
    throw new Error(`Impossible de lire ${relativePath} : ${err instanceof Error ? err.message : err}`)
  }

  let raw
  try {
    raw = parseStackQuestionnaireText(text)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(
      `Fichier ${relativePath} invalide (JSON/JSONC) : ${msg}. ` +
      'Vérifiez les virgules entre les questions et l\'absence de doublon d\'id.'
    )
  }

  const { tools, stackIds, stackLabels, chartColors } = resolveTools(raw)
  const questions = resolveQuestions(raw, stackIds)

  return {
    version: raw.version || 1,
    description: raw.description || '',
    path: userPath,
    absolutePath: userPath,
    relativePath,
    tools,
    stackIds,
    stackLabels,
    chartColors,
    questions,
    questionCount: questions.length,
    questionIds: questions.map((q) => q.id),
  }
}

export function getQuestionnaire() {
  return loadStackQuestionnaireConfig().questions
}

export function getStackToolMeta() {
  const cfg = loadStackQuestionnaireConfig()
  return {
    stackIds: cfg.stackIds,
    stackLabels: cfg.stackLabels,
    chartColors: cfg.chartColors,
  }
}

export function getQuestionnaireConfigPath() {
  return path.relative(REPO_ROOT, ensureStackQuestionnaireConfig()).replace(/\\/g, '/')
}

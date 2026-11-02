/** Questionnaire et scoring pour orienter le choix de stack de test automatisé. */

import { getQuestionnaire, getStackToolMeta } from './stack-questionnaire-config.mjs'

export { getQuestionnaire }

export const STACK_IDS = ['cypress', 'robot', 'playwright', 'postman', 'k6']

export const STACK_LABELS = {
  cypress: 'Cypress',
  robot: 'Robot Framework',
  playwright: 'Playwright',
  postman: 'Postman',
  k6: 'k6',
}

export const STACK_CHART_COLORS = {
  cypress: '#58D0A8',
  robot: '#00C0B5',
  playwright: '#62BB46',
  postman: '#FF6C37',
  k6: '#7D64FF',
}

function resolveStackIds() {
  const meta = getStackToolMeta()
  return meta.stackIds?.length ? meta.stackIds : STACK_IDS
}

function resolveStackLabels() {
  const meta = getStackToolMeta()
  return { ...STACK_LABELS, ...meta.stackLabels }
}

export function getToolProfiles() {
  return [
    {
      id: 'cypress',
      label: 'Cypress',
      purpose: 'Tests de bout en bout dans le navigateur — idéal pour valider des parcours utilisateur sur une application web.',
      pros: [
        { label: 'Prise en main rapide pour les QA', weight: 4 },
        { label: 'Interface visuelle et exécution en direct', weight: 3 },
        { label: 'Rapports avec captures d\'écran', weight: 4 },
        { label: 'Intégré à l\'écosystème Wizard QA (JIRA / hook)', weight: 5 },
      ],
      cons: [
        { label: 'Orienté navigateur (Chrome / Edge principalement)', weight: 4 },
        { label: 'Peu adapté aux tests API seuls', weight: 3 },
        { label: 'Moins pertinent pour le multi-navigateurs avancé', weight: 3 },
      ],
    },
    {
      id: 'robot',
      label: 'Robot Framework',
      purpose: 'Tests fonctionnels en langage naturel (mots-clés) — adapté aux équipes métier et aux processus variés.',
      pros: [
        { label: 'Scénarios lisibles par les profils fonctionnels', weight: 5 },
        { label: 'Syntaxe Gherkin (étant donné / quand / alors)', weight: 4 },
        { label: 'Couvre web, API, fichiers, bases…', weight: 4 },
        { label: 'Écosystème Python largement utilisé en QA', weight: 3 },
      ],
      cons: [
        { label: 'Moins visuel que Cypress au démarrage', weight: 3 },
        { label: 'Configuration initiale plus structurée', weight: 3 },
        { label: 'Rapports moins « grand public »', weight: 2 },
      ],
    },
    {
      id: 'playwright',
      label: 'Playwright',
      purpose: 'Tests web modernes multi-navigateurs — pour des campagnes robustes et parallèles en CI/CD.',
      pros: [
        { label: 'Chrome, Firefox, Safari, Edge', weight: 5 },
        { label: 'Exécution parallèle rapide en chaîne CI', weight: 5 },
        { label: 'Émulation mobile et tablette', weight: 4 },
        { label: 'Très fiable sur les interfaces dynamiques', weight: 4 },
      ],
      cons: [
        { label: 'Demande plus de compétences techniques', weight: 4 },
        { label: 'Mise en place initiale plus exigeante', weight: 3 },
        { label: 'Moins orienté « clic et enregistre »', weight: 3 },
      ],
    },
    {
      id: 'postman',
      label: 'Postman',
      purpose: 'Tests et documentation d\'API — pour valider des services sans interface graphique.',
      pros: [
        { label: 'Très simple pour tester des API REST', weight: 5 },
        { label: 'Collections partageables sans coder', weight: 4 },
        { label: 'Idéal pour fumée / contrôles rapides backend', weight: 4 },
        { label: 'Documentation API intégrée', weight: 3 },
      ],
      cons: [
        { label: 'Ne teste pas les parcours utilisateur web', weight: 5 },
        { label: 'Pas de scénarios bout-en-bout navigateur', weight: 4 },
        { label: 'Complémentaire plutôt que solution unique UI', weight: 3 },
      ],
    },
    {
      id: 'k6',
      label: 'k6',
      purpose: 'Tests de charge et performance — simuler des utilisateurs virtuels et mesurer la tenue en charge.',
      pros: [
        { label: 'Scripts JavaScript, métriques p95/p99 intégrées', weight: 5 },
        { label: 'Campagnes smoke → charge → stress', weight: 4 },
        { label: 'Intégration CI/CD (CLI, JSON, Grafana Cloud)', weight: 4 },
        { label: 'Complément idéal des tests fonctionnels', weight: 4 },
      ],
      cons: [
        { label: 'Binaire k6 à installer hors npm (winget/choco)', weight: 3 },
        { label: 'Ne remplace pas les tests UI fonctionnels', weight: 5 },
        { label: 'Environnement de charge à préparer (données, recette)', weight: 3 },
      ],
    },
  ]
}

function emptyScores(stackIds = STACK_IDS) {
  const scores = {}
  for (const id of stackIds) scores[id] = 0
  return scores
}

function addWeights(scores, weights = {}) {
  for (const id of Object.keys(scores)) {
    scores[id] += weights[id] || 0
  }
  for (const [k, v] of Object.entries(weights)) {
    if (!(k in scores)) scores[k] = Number(v) || 0
  }
}

function buildRationale(answers, recommendedStack, ranking) {
  const lines = []
  const top = ranking[0]
  const label = STACK_LABELS[recommendedStack]

  lines.push(`**${label}** ressort comme la solution la mieux adaptée à votre profil (score ${top.score} points).`)

  const goal = answers.mainGoal
  if (goal === 'web') lines.push('Vous ciblez principalement une application web : Cypress et Playwright sont les candidats naturels ; le questionnaire a pondéré vos autres critères.')
  if (goal === 'api') lines.push('Votre besoin est centré sur les API : Postman est le plus direct, sauf si d\'autres critères (JIRA, volume) orientent vers une stack web.')
  if (goal === 'process') lines.push('Vous devez couvrir des processus métier variés : Robot Framework excelle sur ce type de périmètre.')

  const authors = answers.authors
  if (authors === 'functional' && (recommendedStack === 'robot' || recommendedStack === 'cypress')) {
    lines.push('Vos testeurs sont plutôt fonctionnels : privilégiez des scénarios lisibles et une prise en main progressive.')
  }
  if (authors === 'dev' && recommendedStack === 'playwright') {
    lines.push('Votre équipe est technique : Playwright tire parti de cette maturité pour des campagnes robustes.')
  }

  const jira = answers.jiraLink
  if (jira === 'required' && recommendedStack === 'cypress') {
    lines.push('Le lien JIRA / Xray est indispensable : Cypress est déjà intégré à l\'écosystème Wizard QA de votre poste.')
  }

  const browsers = answers.browsers
  if (browsers === 'multi' && recommendedStack === 'playwright') {
    lines.push('Le multi-navigateurs est un critère fort : Playwright répond le mieux à ce besoin.')
  }

  lines.push('Ce choix est une **orientation** : vous pouvez toujours explorer les autres tuiles de l\'accueil.')

  return lines
}

export function computeRecommendation(answers) {
  const stackIds = resolveStackIds()
  const stackLabels = resolveStackLabels()
  const scores = emptyScores(stackIds)
  const questions = getQuestionnaire()
  const questionMap = new Map(questions.map(q => [q.id, q]))

  for (const [questionId, optionId] of Object.entries(answers || {})) {
    const question = questionMap.get(questionId)
    if (!question) continue
    const option = question.options.find(o => o.id === optionId)
    if (!option?.weights) continue
    addWeights(scores, option.weights)
  }

  const ranking = stackIds
    .map(id => ({ id, label: stackLabels[id] || STACK_LABELS[id] || id, score: scores[id] || 0 }))
    .sort((a, b) => b.score - a.score)

  const maxScore = ranking[0]?.score || 1
  const totalScore = stackIds.reduce((sum, id) => sum + (scores[id] || 0), 0) || 1
  const rankingWithPercent = ranking.map(r => ({
    ...r,
    percent: maxScore > 0 ? Math.round((r.score / maxScore) * 100) : 0,
    sharePercent: totalScore > 0 ? Math.round((r.score / totalScore) * 100) : 25,
  }))

  const recommendedStack = ranking[0]?.id || stackIds[0] || 'cypress'
  const rationale = buildRationale(answers, recommendedStack, rankingWithPercent)
  const toolsComparison = getToolProfiles()

  return {
    scores,
    ranking: rankingWithPercent,
    recommendedStack,
    recommendedLabel: stackLabels[recommendedStack] || STACK_LABELS[recommendedStack] || recommendedStack,
    rationale,
    toolsComparison,
  }
}

export function validateQuestionnaireAnswers(answers) {
  const questions = getQuestionnaire()
  const missing = questions.filter(q => !answers?.[q.id]).map(q => q.id)
  if (missing.length) {
    throw new Error(`Réponses manquantes : ${missing.length} question(s) sans réponse`)
  }
  return true
}

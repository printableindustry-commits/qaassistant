/**
 * Construction des prompts Documentation QA — consultant QA senior (niveau entreprise).
 */
export const PROMPT_TEMPLATE_VERSION = '2.0'

const BLOCK_START = '<!-- DOC_QA_BLOCK_START -->'
const BLOCK_END = '<!-- DOC_QA_BLOCK_END -->'

function kvTable(rows) {
  if (!rows?.length) return '_Aucune entrée_'
  const lines = ['| Champ | Valeur |', '|-------|--------|']
  for (const [k, v] of rows) {
    const val = String(v ?? '—').replace(/\|/g, '\\|').replace(/\n/g, ' ')
    lines.push(`| ${k} | ${val} |`)
  }
  return lines.join('\n')
}

function renderIdentification(prefill, catalogFields) {
  const fields = catalogFields?.length ? catalogFields : Object.entries(prefill || {}).map(([key]) => ({
    key,
    label: key,
  }))
  const rows = fields.map((f) => [f.label || f.key, prefill?.[f.key] || ''])
  return kvTable(rows)
}

function renderQuestionnaireAnswers(answersResolved, sections) {
  const lines = []
  for (const section of sections || []) {
    lines.push(`### ${section.title}`)
    lines.push('')
    for (const field of section.fields || []) {
      const val = answersResolved?.[field.id]
      const display = val && typeof val === 'object' && val.label != null ? val.label : (val ?? '—')
      lines.push(`- **${field.label}** : ${String(display).replace(/\n/g, ' ; ')}`)
    }
    lines.push('')
  }
  return lines.join('\n') || '_Aucune réponse utilisateur enregistrée._'
}

function inferChapterContentGuidance(chapter = {}) {
  const hay = `${chapter.id || ''} ${chapter.title || ''} ${chapter.focus || ''}`.toLowerCase()
  const hints = []
  if (/stratég|strategy|gouvernance|périmètre|perimetre/.test(hay)) {
    hints.push('Inclure : principes, objectifs, critères de couverture, risques, gouvernance si pertinent.')
  }
  if (/outil|stack|framework|techno/.test(hay)) {
    hints.push('Inclure : outils confirmés, rôle de chaque outil, prérequis, configuration, limites, liens uniquement si fournis.')
  }
  if (/automat|cypress|playwright|robot|pipeline/.test(hay)) {
    hints.push('Inclure : architecture, conventions, structure repository, règles d\'écriture, exemples, pipeline CI/CD uniquement si connu.')
  }
  if (/gherkin|bdd|cucumber|scénario|scenario|feature/.test(hay)) {
    hints.push('Inclure : règles de nommage, structure Feature/Scenario, bonnes pratiques, anti-patterns. Exemples Gherkin courts uniquement si la stack BDD est confirmée.')
  }
  if (/ci\/?cd|pipeline|intégration continue/.test(hay)) {
    hints.push('Inclure : étapes pipeline, déclencheurs, artefacts, rapports, critères de succès, stratégie d\'échec — sans inventer.')
  }
  if (/donnée|data|jeu de test|test data/.test(hay)) {
    hints.push('Inclure : typologie, origine, anonymisation si connue, responsabilité, cycle de vie.')
  }
  if (/anomal|defect|bug|incident/.test(hay)) {
    hints.push('Inclure : cycle de vie, sévérité, priorité, rattachement, preuves attendues.')
  }
  if (/report|métrique|metric|kpi|tableau de bord/.test(hay)) {
    hints.push('Inclure : métriques, fréquence, destinataires, supports, limites.')
  }
  if (!hints.length) {
    hints.push('Structurer le chapitre de façon lisible : objectif, contexte, périmètre, processus, acteurs, outils, exemples concrets, points d\'attention, limites, informations manquantes, checklist de validation si utile.')
  }
  return hints.join('\n')
}

function buildProjectContextBlock(onboarding = {}, prefill = {}) {
  return kvTable([
    ['Produit / application', onboarding.applicationLabel || prefill.application],
    ['Direction / tribu', onboarding.tribu],
    ['Squad', onboarding.squad],
    ['Pôle produit', onboarding.poleProduit || ''],
    ['Centre de compétence', onboarding.centreCompetence || ''],
    ['Product Owner', onboarding.poName],
    ['Scrum Master', onboarding.scrumMasterName],
    ['Business Analyst', onboarding.baName],
    ['Référent QA', onboarding.qaName],
    ['Code produit', onboarding.productCode],
    ['Code solution', onboarding.solutionCode],
    ['Stack de test', onboarding.recommendedStackLabel || onboarding.recommendedStack || prefill.stackTest],
    ['Environnement', prefill.environnement],
    ['Référence DDF / spec', prefill.referenceSpec],
    ['Version testée', prefill.versionTestee],
    ['Liens utiles', onboarding.usefulLinks || ''],
    ['Contraintes projet', onboarding.projectConstraints || ''],
  ])
}

export function buildChapterPromptTemplate({
  documentTitle = '',
  chapterTitle = '',
  chapterObjective = '',
  projectContext = '',
  userAnswers = '',
  availableSources = '',
  missingInformation = '',
  contentGuidance = '',
  userNotes = '',
  scanBlock = '',
  tableBlock = '',
  dataToProvide = '',
  expectedQuality = '',
  chapterPromptHint = '',
} = {}) {
  return `Tu es un consultant QA senior spécialisé en stratégie de test, automatisation, documentation projet et industrialisation qualité.

Tu dois produire le contenu du chapitre suivant pour une documentation QA d'entreprise.

## 1. Rôle attendu de l'IA

Tu agis comme rédacteur QA senior : contenu professionnel, structuré, contextualisé au projet, directement intégrable dans un document Word ou Markdown.

## 2. Mission

**DOCUMENT À PRODUIRE :** ${documentTitle}

**CHAPITRE À PRODUIRE :** ${chapterTitle}

**OBJECTIF DU CHAPITRE :**
${chapterObjective}

${dataToProvide ? `**DONNÉES ATTENDUES POUR CE CHAPITRE :**\n${dataToProvide}\n` : ''}
${expectedQuality ? `**QUALITÉ ATTENDUE :**\n${expectedQuality}\n` : ''}

## 3. Public cible

- QA fonctionnel
- automaticien
- PO
- BA
- Scrum Master
- développeur
- nouvel arrivant projet
- auditeur qualité

## 4. Sources disponibles

Utiliser **uniquement** les sources réellement fournies ci-dessous. Ne pas compléter par déduction non sourcée.

${availableSources}

## 5. Informations projet connues

${projectContext}

## 6. Réponses utilisateur disponibles

${userAnswers}

${userNotes ? `### Notes complémentaires utilisateur\n\n${userNotes}\n` : ''}
${scanBlock}

## 7. Informations manquantes

${missingInformation}

Règle obligatoire : pour toute information absente ou incertaine, écrire explicitement **[À COMPLÉTER]**.

## 8. Consignes de rédaction

- Clarté, précision, structure actionnable.
- Pas d'hallucination : ne jamais inventer URL, outil, nom d'équipe, règle de gestion, stratégie CI/CD, convention Gherkin ou environnement.
- Pas de remplissage générique sans valeur projet.
- Définir les termes techniques si nécessaire.
- Utiliser des tableaux lorsque cela améliore la lisibilité.
- Exemples Gherkin uniquement si le chapitre s'y prête **et** si la stack BDD/Gherkin est confirmée dans les sources.
- Terminer par une checklist de validation lorsque pertinent.
- Ne pas ajouter de commentaire hors du bloc documentaire demandé.

### Orientation de contenu pour ce chapitre

${contentGuidance}

${chapterPromptHint ? `### Consigne catalogue\n\n${chapterPromptHint}\n` : ''}
${tableBlock}

## 9. Format de réponse obligatoire

Répondre **uniquement** avec un bloc documentaire délimité ainsi (aucun texte avant ou après) :

${BLOCK_START}

(contenu documentaire ici — sections adaptées au sujet : objectif, contexte, périmètre, règles, processus, acteurs, données, outils, exemples, points d'attention, limites, informations manquantes, checklist)

${BLOCK_END}

## 10. Critères d'acceptation

La réponse est valide uniquement si :

- elle est directement insérable dans le document ;
- elle ne contient pas de commentaire hors bloc ;
- elle mentionne les informations manquantes avec [À COMPLÉTER] ;
- elle reste cohérente avec les sources ;
- elle n'invente rien ;
- elle est spécifique au projet (pas de phrases vagues type « les tests doivent être réalisés régulièrement »).`
}

export function buildCopilotChapterPrompt({
  doc = null,
  chapter = null,
  agentModel = 'Claude Sonnet 4.6',
  onboarding = {},
  prefill = {},
  catalog = null,
  userNotes = '',
  scanParams = null,
  livrablesDir = '2_Documentation/Livrables',
  projectSources = [],
  missingInformation = '',
  readiness = null,
  answersResolved = {},
  questionnaireSections = [],
} = {}) {
  if (!doc || !chapter) {
    throw new Error('Document ou chapitre introuvable')
  }

  const projectContext = buildProjectContextBlock(onboarding, prefill)
  const userAnswers = renderQuestionnaireAnswers(answersResolved, questionnaireSections)
  const availableSources = projectSources.length
    ? projectSources.map((s) => `- **${s.name}** (\`${s.relative}\`)`).join('\n')
    : '_Scan documentaire, inventaire projet et fichiers QA non détectés sur le disque — ne pas inventer de données._'

  const tableBlock = chapter.tableHeaders?.length
    ? `\n**Structure tableau attendue :** colonnes ${chapter.tableHeaders.join(' | ')} — remplir avec des lignes cohérentes aux sources.\n`
    : ''

  const scanBlock = scanParams
    ? `### Contexte scan document Word

- Dernière lecture : ${scanParams.scannedAt || '—'}
- Fichier : \`${scanParams.sourcePath || '—'}\`
- État du chapitre : ${scanParams.completion || '—'} — ${scanParams.scanSummary || ''}
${scanParams.existingContentExcerpt ? `\n**Contenu déjà présent :**\n${scanParams.existingContentExcerpt}\n` : ''}
${scanParams.placeholderExcerpt ? `\n**Zones encore à compléter :**\n${scanParams.placeholderExcerpt}\n` : ''}`
    : ''

  const prompt = buildChapterPromptTemplate({
    documentTitle: `${doc.id} — ${doc.coverTitle}`,
    chapterTitle: chapter.title,
    chapterObjective: chapter.focus || chapter.title,
    projectContext,
    userAnswers,
    availableSources,
    missingInformation: missingInformation || '_Aucune analyse de manques fournie — marquer [À COMPLÉTER] pour toute donnée absente._',
    contentGuidance: inferChapterContentGuidance(chapter),
    userNotes: String(userNotes || '').trim(),
    scanBlock,
    tableBlock,
    dataToProvide: chapter.dataToProvide || '',
    expectedQuality: chapter.expectedQuality || '',
    chapterPromptHint: scanParams?.enrichedPromptHint || chapter.promptHint || '',
  })

  return {
    title: `${doc.id} — ${chapter.title}`,
    prompt,
    docId: doc.id,
    chapterId: chapter.id,
    file: doc.file,
    templateVersion: PROMPT_TEMPLATE_VERSION,
    readiness,
    agentModel,
    livrablesDir,
  }
}

function renderCatalogDocuments(documents) {
  if (!documents?.length) return '_Catalogue indisponible._'
  const blocks = []
  for (const doc of documents) {
    blocks.push(`### ${doc.id} — ${doc.coverTitle}`)
    for (const ch of doc.chapters || []) {
      blocks.push(`- **${ch.title}** : ${ch.focus}`)
    }
    blocks.push('')
  }
  return blocks.join('\n')
}

export function buildCopilotDocPrompt({
  title = 'Documentation QA — pack livrables Word',
  agentModel = 'Claude Sonnet 4.6',
  onboarding = {},
  answersResolved = {},
  questionnaireSections = [],
  prefill = {},
  catalog = null,
  documents = [],
  userEnrichment = '',
  livrablesDir = '2_Documentation/Livrables',
  projectSources = [],
  missingInformation = '',
} = {}) {
  const enrichmentBlock = String(userEnrichment || '').trim()
    ? `\n## Enrichissement utilisateur\n${userEnrichment.trim()}\n`
    : ''

  const projectContext = buildProjectContextBlock(onboarding, prefill)
  const userAnswers = renderQuestionnaireAnswers(answersResolved, questionnaireSections)
  const availableSources = projectSources.length
    ? projectSources.map((s) => `- **${s.name}** (\`${s.relative}\`)`).join('\n')
    : '_Sources projet limitées — marquer [À COMPLÉTER] pour toute donnée absente._'

  const mission = `
# ${title}

## Rôle

Tu es un consultant QA senior spécialisé en stratégie de test, automatisation, documentation projet et industrialisation QA.

## Mission

Produire le contenu documentaire du pack Documentation QA, chapitre par chapitre, pour intégration dans les gabarits Word (\`${livrablesDir}/\`).

## Public cible

QA fonctionnel, automaticien, PO, BA, Scrum Master, développeur, nouvel arrivant, auditeur qualité.

## Sources disponibles

${availableSources}

## Informations projet connues

${projectContext}

## Réponses utilisateur

${userAnswers}
${enrichmentBlock}
## Informations manquantes

${missingInformation || '_Analyser les lacunes et utiliser [À COMPLÉTER]._'}

## Catalogue des livrables

${catalog?.purpose || 'Pack Documentation QA CA-TS.'}

${renderCatalogDocuments(documents)}

## Consignes absolues

- Ne jamais inventer URL, outil, équipe, règle ou stratégie CI/CD.
- [À COMPLÉTER] pour toute information absente.
- Contenu professionnel, structuré, spécifique au projet.
- Chaque chapitre dans un bloc ${BLOCK_START} … ${BLOCK_END}.

## Modèle agent cible

${agentModel}
`.trim()

  return {
    title,
    prompt: mission,
    documentCount: documents.length,
    chapterCount: documents.reduce((n, d) => n + (d.chapters?.length || 0), 0),
    templateVersion: PROMPT_TEMPLATE_VERSION,
  }
}

export { BLOCK_START, BLOCK_END }

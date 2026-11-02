import fs from 'fs'
import path from 'path'
import { loadAllOverridesForPrompt } from './doc-library.mjs'
import {
  DOC_QA_DIR,
  DOC_REPORTS_DIR,
  PATH_CFG,
  docReportRel,
  relPath,
} from './paths.mjs'

const CONF_PATH = path.join(DOC_QA_DIR, PATH_CFG.scanConfigFile)
const SNAPSHOT_JSON = path.join(DOC_REPORTS_DIR, PATH_CFG.snapshotJsonFile)

function pathExample(relPathValue) {
  return relPathValue.replace(/\\/g, '/')
}

export const PROMPT_VARIABLES = [
  { name: '$PROJECT_KEY', desc: 'Clé projet JIRA', example: 'P0326-XXXX' },
  { name: '$PROJECT_NAME', desc: 'Nom application', example: 'MonApplication' },
  { name: '$APPLICATION_LABEL', desc: 'Libellé complet application', example: 'Application métier CA-TS + CR' },
  { name: '$DATE_DU_JOUR', desc: 'Date de rédaction des livrables', example: '12/06/2026' },
  { name: '$SNAPSHOT_DATE', desc: 'Horodatage du scan VS Code (ISO)', example: '2026-06-12T10:30:00.000Z' },
  { name: '$FEATURE_COUNT', desc: 'Nombre de fichiers .feature', example: '156' },
  { name: '$SCENARIO_COUNT', desc: 'Nombre de scénarios Gherkin', example: '156' },
  { name: '$CAMPAIGN_COUNT', desc: 'Nombre de dossiers campagne', example: '9' },
  { name: '$SNAPSHOT_MD_PATH', desc: 'Fichier snapshot Markdown (pièce jointe)', example: pathExample(docReportRel(PATH_CFG.snapshotMdFile)) },
  { name: '$SNAPSHOT_JSON_PATH', desc: 'Fichier snapshot JSON (pièce jointe optionnelle)', example: pathExample(docReportRel(PATH_CFG.snapshotJsonFile)) },
  { name: '$TEMPLATE_DOCX_PATH', desc: 'Gabarit Word CA-TS (pièce jointe)', example: pathExample(relPath(PATH_CFG.templateDir, 'modele_livrable_CA-TS.docx')) },
  { name: '$LIVRABLES_DIR', desc: 'Dossier des livrables 00–12', example: `${pathExample(PATH_CFG.livrablesDir)}/` },
  { name: '$SCAN_SCRIPT_PATH', desc: 'Script de parcours du dépôt', example: pathExample(relPath(PATH_CFG.docQaDir, PATH_CFG.scanProjectScript)) },
  { name: '$SCAN_CONFIG_PATH', desc: 'Configuration du scan', example: pathExample(relPath(PATH_CFG.docQaDir, PATH_CFG.scanConfigFile)) },
  { name: '$VERSION_TESTEE', desc: 'Version applicative testée', example: '16.X (DDF en cours)' },
  { name: '$ENVIRONNEMENT', desc: 'Environnements de test', example: 'U3 (recette fonctionnelle) / R3 (recette métier)' },
  { name: '$REDACTION', desc: 'Auteur / équipe QA', example: 'équipe QA CA-TS — Rémy VERGER' },
  { name: '$STACK_TEST', desc: 'Stack automation', example: 'Cypress 14 + Cucumber + TypeScript + GitLab CI + Xray' },
  { name: '$REFERENCE_DDF', desc: 'Référence DDF', example: 'DDF_Application — Squad QA (PO/BA/QA)' },
  { name: '$MODEL_LLM', desc: 'Modèle IA cible', example: 'Claude Sonnet 4.6 ou GPT-5 mini' },
]

export const PROMPT_TEMPLATE = `Tu es un expert QA documentaire au Crédit Agricole Technologies & Services (CA-TS).
Modèle IA attendu : $MODEL_LLM

## Mission

Mettre à jour le pack livrables QA Word (documents 00 à 12) du projet $PROJECT_KEY — $PROJECT_NAME,
en respectant le gabarit CA-TS joint ($TEMPLATE_DOCX_PATH).

## Contexte scan VS Code (source de vérité)

- Snapshot généré le : $SNAPSHOT_DATE
- Inventaire : $FEATURE_COUNT fichiers .feature, $SCENARIO_COUNT scénarios, $CAMPAIGN_COUNT campagnes
- Fichiers à lire en priorité :
  1. $SNAPSHOT_MD_PATH
  2. $SNAPSHOT_JSON_PATH (détail scénarios / matrice)
  3. Livrables actuels dans $LIVRABLES_DIR
  4. Script : $SCAN_SCRIPT_PATH (méthode) + $SCAN_CONFIG_PATH (config)

## Identification projet (tableau sur chaque livrable)

| Champ | Valeur |
|-------|--------|
| Application | $APPLICATION_LABEL |
| Projet | $PROJECT_KEY |
| Version testée | $VERSION_TESTEE |
| Environnement | $ENVIRONNEMENT |
| Date | $DATE_DU_JOUR |
| Rédaction | $REDACTION |
| Stack de test | $STACK_TEST |
| Référence DDF | $REFERENCE_DDF |

## Règles impératives

- Ne jamais inventer de cas de test absents du snapshot.
- Conserver les test ID exacts (SMK_*, TNR_*, BN_*, A11Y_*, SMK_CR_*, etc.).
- Distinguer campagnes CA-TS et CR selon les dossiers du snapshot.
- Mise en forme : calquer le gabarit CA-TS (Titre1, Titre2, Listepuces).
- Langue : français professionnel. Manque d'info → « À compléter ».

## Livrables à produire (00 → 12)

Pour chaque document : Titre1 + sous-titre + tableau d'identification + corps structuré.
Priorité mise à jour données : 03 Matrice traçabilité, 05 Gherkin, 11 Couverture.

## Format de sortie

1. Synthèse exécutive (10 lignes max)
2. Tableau des écarts snapshot ↔ livrables actuels
3. Contenu document par document (00 à 12), prêt à coller dans Word
4. Annexe : test ID sans récit JIRA

Commence par la synthèse, puis le document 03 (matrice) ligne par ligne à partir du snapshot.`

function loadConf() {
  try {
    return JSON.parse(fs.readFileSync(CONF_PATH, 'utf8'))
  } catch {
    return {}
  }
}

function loadSnapshot() {
  try {
    return JSON.parse(fs.readFileSync(SNAPSHOT_JSON, 'utf8'))
  } catch {
    return null
  }
}

export function buildPromptContext() {
  const conf = loadConf()
  const snap = loadSnapshot()
  const today = new Date().toLocaleDateString('fr-FR')

  return {
    $PROJECT_KEY: snap?.project?.projectKey || conf.projectKey || 'P0326-XXXX',
    $PROJECT_NAME: snap?.project?.projectName || conf.projectName || 'MonApplication',
    $APPLICATION_LABEL: snap?.project?.applicationLabel || conf.applicationLabel || 'Application métier CA-TS + CR',
    $DATE_DU_JOUR: today,
    $SNAPSHOT_DATE: snap?.generatedAt || '(lancer npm run doc:snapshot)',
    $FEATURE_COUNT: String(snap?.summary?.featureCount ?? '—'),
    $SCENARIO_COUNT: String(snap?.summary?.scenarioCount ?? '—'),
    $CAMPAIGN_COUNT: String(snap?.campaigns?.length ?? '—'),
    $SNAPSHOT_MD_PATH: conf.outputDir
      ? `${conf.outputDir}/${conf.outputMarkdown || PATH_CFG.snapshotMdFile}`
      : docReportRel(PATH_CFG.snapshotMdFile),
    $SNAPSHOT_JSON_PATH: conf.outputDir
      ? `${conf.outputDir}/${conf.outputJson || PATH_CFG.snapshotJsonFile}`
      : docReportRel(PATH_CFG.snapshotJsonFile),
    $TEMPLATE_DOCX_PATH: conf.templateDocx || relPath(PATH_CFG.templateDir, 'modele_livrable_CA-TS.docx'),
    $LIVRABLES_DIR: conf.livrablesDir ? `${conf.livrablesDir}/` : `${PATH_CFG.livrablesDir}/`,
    $SCAN_SCRIPT_PATH: snap?.scannerScript || relPath(PATH_CFG.docQaDir, PATH_CFG.scanProjectScript),
    $SCAN_CONFIG_PATH: snap?.configFile || relPath(PATH_CFG.docQaDir, PATH_CFG.scanConfigFile),
    $VERSION_TESTEE: conf.versionTestee || '16.X (DDF en cours)',
    $ENVIRONNEMENT: 'U3 (recette fonctionnelle) / R3 (recette métier)',
    $REDACTION: 'équipe QA CA-TS — Rémy VERGER',
    $STACK_TEST: 'Cypress 14 + Cucumber + TypeScript + GitLab CI + Xray',
    $REFERENCE_DDF: conf.referenceDdf || 'DDF_Application — Squad QA (PO/BA/QA)',
    $MODEL_LLM: 'Claude Sonnet 4.6 ou GPT-5 mini',
  }
}

export function fillPromptTemplate(template = PROMPT_TEMPLATE, ctx = buildPromptContext()) {
  let out = template
  for (const [key, val] of Object.entries(ctx)) {
    out = out.split(key).join(String(val))
  }
  return out
}

export function getPromptPackage() {
  const context = buildPromptContext()
  const snapshotExists = fs.existsSync(SNAPSHOT_JSON)
  const overridesBlock = loadAllOverridesForPrompt()
  let filled = fillPromptTemplate(PROMPT_TEMPLATE, context)
  if (overridesBlock) filled = `${filled}\n\n${overridesBlock}`
  return {
    variables: PROMPT_VARIABLES,
    template: PROMPT_TEMPLATE,
    filled,
    context,
    snapshotExists,
    hasOverrides: Boolean(overridesBlock),
  }
}

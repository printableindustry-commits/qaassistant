import fs from 'fs'
import path from 'path'
import { CONF_DIR, DOC_QA_DIR, LIVRABLES_DIR, PATH_CFG, SERVER_CONF_DIR, relPath } from './paths.mjs'
import { getPageDefaults, savePageDefaults } from './wizard-defaults.mjs'

export const DOC_QA_LIVRABLES_TOUR_FILE = 'doc-qa-livrables-tour.conf.json'
export const DOC_QA_LIVRABLES_TOUR_REFERENCE = 'doc-qa-livrables-tour.conf.reference.json'
const TEMPLATES_CONF = 'doc-qa-templates.conf.json'

const USER_PATH = () => path.join(CONF_DIR, DOC_QA_LIVRABLES_TOUR_FILE)
const REF_PATH = () => path.join(SERVER_CONF_DIR, DOC_QA_LIVRABLES_TOUR_REFERENCE)

function ensureUserTourFile() {
  fs.mkdirSync(CONF_DIR, { recursive: true })
  if (!fs.existsSync(USER_PATH()) && fs.existsSync(REF_PATH())) {
    fs.copyFileSync(REF_PATH(), USER_PATH())
  }
}

function loadTemplatesCatalog() {
  const file = path.join(DOC_QA_DIR, TEMPLATES_CONF)
  if (!fs.existsSync(file)) return null
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    return data.wizardCatalog || null
  } catch {
    return null
  }
}

function buildStepFromDocument(doc) {
  const chapters = doc.chapters || []
  const chapterBullets = chapters.map((c) => `• **${c.title}** — ${c.focus}`)
  const dataHints = [...new Set(chapters.map((c) => c.dataToProvide).filter(Boolean))]
  const quality = chapters[0]?.expectedQuality
    || 'Rédaction factuelle, datée et traçable vers une source métier ou technique.'

  return {
    id: doc.id,
    file: doc.file,
    title: `${doc.id} — ${doc.coverTitle}`,
    paragraphs: [
      `**Fichier** : \`${doc.file}\``,
      `**Rôle** : ce livrable structure une partie de la chaîne de preuve QA. Chaque chapitre doit être renseigné avec des faits vérifiables (sources DDF, JIRA, campagne, CI).`,
      `**Chapitres à compléter** :\n${chapterBullets.join('\n')}`,
      `**Données à fournir** : ${dataHints.join(' · ')}`,
      `**Qualité attendue** : ${quality}`,
    ],
  }
}

function buildStepsFromCatalog(catalog) {
  const docs = catalog?.documents || []
  return docs
    .filter((d) => /^\d{2}$/.test(String(d.id)))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .map(buildStepFromDocument)
}

export function loadLivrablesTourConfig() {
  ensureUserTourFile()
  if (fs.existsSync(USER_PATH())) {
    try {
      return JSON.parse(fs.readFileSync(USER_PATH(), 'utf8'))
    } catch { /* fallback */ }
  }
  const catalog = loadTemplatesCatalog()
  return {
    version: '1.0.0',
    modalTitle: 'Livrables Documentation QA - Explication',
    nextButton: 'Suivant',
    closeButton: 'Fermer',
    neverShowButton: 'Ne plus afficher la pop-up',
    steps: buildStepsFromCatalog(catalog),
  }
}

export function getLivrablesTourPayload() {
  const config = loadLivrablesTourConfig()
  let steps = config.steps || []
  if (!steps.length) {
    steps = buildStepsFromCatalog(loadTemplatesCatalog())
  }
  const docQa = getPageDefaults('docQa') || {}
  return {
    ok: true,
    modalTitle: config.modalTitle || 'Livrables Documentation QA - Explication',
    nextButton: config.nextButton || 'Suivant',
    closeButton: config.closeButton || 'Fermer',
    neverShowButton: config.neverShowButton || 'Ne plus afficher la pop-up',
    steps,
    stepCount: steps.length,
    livrablesDir: relPath(PATH_CFG.livrablesDir),
    livrablesDirAbs: LIVRABLES_DIR,
    hidden: Boolean(docQa.livrablesTourHidden),
    configPath: relPath(PATH_CFG.localConfDir, DOC_QA_LIVRABLES_TOUR_FILE),
  }
}

export function dismissLivrablesTour() {
  const at = new Date().toISOString()
  savePageDefaults('docQa', { livrablesTourHidden: true, livrablesTourHiddenAt: at })
  return { ok: true, hidden: true, at }
}

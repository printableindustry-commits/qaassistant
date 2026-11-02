import fs from 'fs'
import path from 'path'
import { CONF_DIR, REPO_ROOT, SERVER_CONF_DIR } from './paths.mjs'
import { parseStackQuestionnaireText } from './stack-questionnaire-jsonc.mjs'

export const UI_WORDING_FILE = 'ui-wording.conf.json'
export const UI_WORDING_REFERENCE = 'ui-wording.conf.reference.json'

const USER_CONFIG_PATH = () => path.join(CONF_DIR, UI_WORDING_FILE)
const REFERENCE_CONFIG_PATH = () => path.join(SERVER_CONF_DIR, UI_WORDING_REFERENCE)

export function getBuiltinUiWording() {
  return {
    version: 1,
    description: 'Textes des pop-ups et messages affichés par le Wizard QA.',
    neverShowButton: 'Ne plus afficher le pop-up',
    popups: {
      launchDisclaimer: {
        enabled: true,
        template: 'disclaimer',
        showOn: 'pageLoad',
        pages: ['home'],
        order: 1,
        id: 'launchDisclaimer',
        title: 'Wizard QA Assistant',
        logo: '/assets/logo-qa.png',
        logoAlt: 'QA',
        paragraphs: [
          "Ceci est un assistant de configuration pour initier un environnement de test automatisé. Plusieurs Wizard seront proposés pour vous permettre d'installer votre logiciel de test automatisé, et synchroniser votre projet avec vos Board JIRA.",
          "Il vous permettra également d'initier une documentation de référence à partir d'un modèle. Vous pourrez compléter les documents et vous aider des fonctionnalités présentes dans ce Wizard pour maintenir vos documentations à jour en fonction des tests que vous publierez sur JIRA.",
          'Votre projet VS Code sera le projet de référence et conditionnera l\'ensemble des fonctions de l\'application pour synchroniser votre Local → Documentation → JIRA Xray.',
        ],
        closeButton: 'Fermer',
      },
      npmInstallPrompt: {
        enabled: true,
        template: 'disclaimer',
        showOn: 'manual',
        pages: ['npmrc'],
        order: 1,
        id: 'npmInstallPrompt',
        title: 'Voulez-vous installer NPM ?',
        logo: '/assets/logo-qa.png',
        logoAlt: 'QA',
        paragraphs: [
          'Le fichier .npmrc a été généré avec succès.',
          'Souhaitez-vous lancer npm install maintenant ? Les versions des paquets sont définies dans npm-install.conf.json.',
        ],
        closeButton: 'Plus tard',
        confirmButton: 'Installer NPM',
      },
      onboardingIntroPrompt: {
        enabled: true,
        template: 'disclaimer',
        showOn: 'manual',
        pages: ['home'],
        order: 2,
        id: 'onboardingIntroPrompt',
        title: 'Prise de connaissance du projet de votre environnement',
        logo: '/assets/logo-qa.png',
        logoAlt: 'QA',
        paragraphs: [
          'Dans cet assistant, vous allez définir les informations propres à votre projet :',
          'Product Owner, Business Analyst, Scrum Master, QA testeur, tribu / squad, codes produit et solution, URL JIRA, plans de test, etc.',
          'Ces variables seront nécessaires au conditionnement des actions réalisées par l\'outil.',
        ],
        closeButton: 'Annuler',
        confirmButton: 'Commencer la configuration du projet',
      },
    },
  }
}

function normalizePopup(popup, fallback) {
  const base = { ...fallback, ...(popup || {}) }
  const paragraphs = Array.isArray(base.paragraphs)
    ? base.paragraphs.map((p) => String(p).trim()).filter(Boolean)
    : fallback.paragraphs
  return {
    enabled: base.enabled !== false,
    template: base.template || fallback.template || 'disclaimer',
    showOn: base.showOn || fallback.showOn || 'pageLoad',
    pages: Array.isArray(base.pages) && base.pages.length
      ? base.pages
      : (Array.isArray(fallback.pages) ? fallback.pages : ['home']),
    order: Number.isFinite(Number(base.order)) ? Number(base.order) : (fallback.order ?? 99),
    id: base.id || fallback.id,
    title: base.title || fallback.title,
    logo: base.logo || fallback.logo,
    logoAlt: base.logoAlt || fallback.logoAlt,
    paragraphs: paragraphs.length ? paragraphs : fallback.paragraphs,
    closeButton: base.closeButton || fallback.closeButton,
    confirmButton: base.confirmButton || fallback.confirmButton || '',
    neverShowButton: String(base.neverShowButton || fallback.neverShowButton || '').trim(),
  }
}

export function ensureUiWordingConfig() {
  const userPath = USER_CONFIG_PATH()
  if (!fs.existsSync(userPath)) {
    fs.mkdirSync(CONF_DIR, { recursive: true })
    const referencePath = REFERENCE_CONFIG_PATH()
    if (fs.existsSync(referencePath)) {
      fs.copyFileSync(referencePath, userPath)
    } else {
      fs.writeFileSync(userPath, `${JSON.stringify(getBuiltinUiWording(), null, 2)}\n`, 'utf8')
    }
  }
  return userPath
}

export function loadUiWordingConfig() {
  const userPath = ensureUiWordingConfig()
  const relativePath = path.relative(REPO_ROOT, userPath).replace(/\\/g, '/')
  const builtin = getBuiltinUiWording()

  let raw = builtin
  try {
    const text = fs.readFileSync(userPath, 'utf8')
    raw = parseStackQuestionnaireText(text)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[wizard-qa] ${relativePath} invalide, textes intégrés utilisés : ${msg}`)
  }

  const globalNeverShow = raw.neverShowButton || builtin.neverShowButton || 'Ne plus afficher le pop-up'

  const popups = { ...(builtin.popups || {}) }
  for (const [key, fallback] of Object.entries(builtin.popups || {})) {
    popups[key] = normalizePopup(raw.popups?.[key], {
      ...fallback,
      neverShowButton: fallback.neverShowButton || globalNeverShow,
    })
  }
  for (const [key, popup] of Object.entries(raw.popups || {})) {
    if (popups[key]) continue
    popups[key] = normalizePopup(popup, {
      enabled: true,
      template: 'disclaimer',
      showOn: popup?.showOn || 'manual',
      pages: popup?.pages || ['*'],
      order: popup?.order ?? 99,
      id: key,
      title: popup?.title || key,
      logo: '/assets/logo-qa.png',
      logoAlt: 'QA',
      paragraphs: Array.isArray(popup?.paragraphs) ? popup.paragraphs : [],
      closeButton: popup?.closeButton || 'Fermer',
      confirmButton: popup?.confirmButton || '',
      neverShowButton: popup?.neverShowButton || globalNeverShow,
    })
  }

  return {
    version: raw.version || builtin.version,
    description: raw.description || builtin.description,
    neverShowButton: globalNeverShow,
    path: userPath,
    relativePath,
    popups,
  }
}

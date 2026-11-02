import { REPO_ROOT } from './paths.mjs'
import { getProjectProfile } from './project-profile.mjs'
import { readOnboardingSnapshot } from './onboarding-snapshot.mjs'
import { loadWizardDefaults } from './wizard-defaults.mjs'
import { DEMO_FORM } from './demo-defaults.mjs'

/**
 * Contexte projet k6 — profil wizard.defaults (Prise de connaissance / Paramètres projet),
 * complété par le snapshot si besoin. Aucune valeur démo injectée.
 */
export function getK6OnboardingContext() {
  const project = getProjectProfile()
  const prise = readOnboardingSnapshot()?.priseConnaissance || {}
  const wizardUpdated = loadWizardDefaults().updatedAt || ''
  const priseUpdated = prise.completedAt || readOnboardingSnapshot()?.lastUpdatedAt || ''

  // wizard.defaults est mis à jour à chaque sauvegarde onboarding / paramètres projet
  const useProjectFirst = Boolean(project.onboardingComplete)
    || (wizardUpdated && (!priseUpdated || wizardUpdated >= priseUpdated))

  const primary = useProjectFirst ? project : { ...prise, ...project }
  const fallback = useProjectFirst ? prise : project

  const tribu = String(primary.tribu || fallback.tribu || '').trim()
  const squad = String(primary.squad || fallback.squad || '').trim()
  const productCode = String(primary.productCode || fallback.productCode || '').trim()
  const solutionCode = String(primary.solutionCode || fallback.solutionCode || '').trim()
  const applicationLabel = String(primary.applicationLabel || fallback.applicationLabel || '').trim()
  const gitRepository = String(
    primary.gitRepository || fallback.gitRepository || REPO_ROOT,
  ).trim()
  const onboardingComplete = Boolean(
    project.onboardingComplete || prise.completedAt,
  )

  const isDemoLabel = applicationLabel.toLowerCase() === DEMO_FORM.applicationLabel.toLowerCase()
    || applicationLabel.toLowerCase() === 'portail assurance demo'

  return {
    tribu,
    squad,
    productCode,
    solutionCode,
    applicationLabel,
    gitRepository,
    onboardingComplete,
    isDemoLabel,
    source: useProjectFirst ? 'project' : 'prise-connaissance',
  }
}

export function getK6OnboardingContextForApi() {
  const context = getK6OnboardingContext()
  return { ok: true, context }
}

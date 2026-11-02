/**
 * Analyse des informations disponibles / manquantes avant génération de prompt.
 */
export function analyzeChapterReadiness({
  chapter = {},
  onboarding = {},
  prefill = {},
  scanParams = null,
  userNotes = '',
} = {}) {
  const required = []
  const recommended = []
  const optional = []

  const check = (id, label, value, level = 'recommended') => {
    const empty = value == null || String(value).trim() === ''
    const entry = { id, label }
    if (empty) {
      if (level === 'required') required.push(entry)
      else if (level === 'recommended') recommended.push(entry)
      else optional.push(entry)
    }
  }

  check('application', 'Application / solution', onboarding.applicationLabel || prefill.application, 'required')
  check('tribu', 'Tribu', onboarding.tribu, 'recommended')
  check('squad', 'Squad', onboarding.squad, 'recommended')
  check('qaName', 'Référent QA', onboarding.qaName, 'recommended')
  check('stack', 'Stack de test', onboarding.recommendedStackLabel || onboarding.recommendedStack || prefill.stackTest, 'recommended')
  check('referenceSpec', 'Référence DDF / spec', prefill.referenceSpec, 'recommended')
  check('chapterFocus', 'Objectif du chapitre', chapter.focus, 'required')

  if (!scanParams?.scannedAt) {
    optional.push({ id: 'wordScan', label: 'Scan du document Word (optionnel)' })
  }

  const missingFields = [...required, ...recommended].map((f) => f.label)
  const total = required.length + recommended.length + optional.length
  const missingCount = required.length + recommended.length
  const completionRatio = total ? Math.round(((total - missingCount) / total) * 100) : 100

  let readiness = 'yes'
  if (required.length > 0) readiness = 'no'
  else if (recommended.length > 0) readiness = 'partial'

  return {
    readiness,
    readinessLabel: readiness === 'yes' ? 'Informations suffisantes'
      : readiness === 'partial' ? 'Partiellement — des [À COMPLÉTER] seront ajoutés'
        : 'Informations minimales manquantes',
    required,
    recommended,
    optional,
    missingFields,
    completionRatio,
    canGenerate: required.length === 0,
    userNotes: String(userNotes || '').trim(),
  }
}

export function formatMissingForPrompt(readiness) {
  const lines = []
  for (const f of readiness.required || []) lines.push(`- ${f.label} (obligatoire)`)
  for (const f of readiness.recommended || []) lines.push(`- ${f.label} (recommandé)`)
  if (!lines.length) return '_Aucune information manquante identifiée — utiliser [À COMPLÉTER] si une donnée projet est absente des sources._'
  return lines.join('\n')
}

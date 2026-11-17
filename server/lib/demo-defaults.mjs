/** Valeurs factices pour tester l'assistant et la génération des livrables (organisme fictif « Banque Horizon »). */

export const DEMO_FORM = {
  tribu: 'Banque Horizon — Tribu Risques',
  squad: 'Squad Qualité Risques',
  poName: 'Claire FONTAINE',
  baName: 'Nadia PERRIN',
  scrumMasterName: 'Julien ROCHE',
  qaName: 'VERGER Rémy',
  productCode: 'P0326',
  solutionCode: 'S0998',
  applicationLabel: 'IRMA – Analyse des Risques Métier (démo)',
  gitRepository: '',
  usesJiraPlans: true,
  jiraBaseUrl: 'https://jira.demo.irma.local',
  xrayClientId: 'DEMO5E30639ECEDC4A4DA4B6AC1E2619DFFF',
  xrayClientSecret: 'demo-xray-secret-a-remplacer-en-production',
  testPlans: [{
    planKey: 'P0326-10528',
    planName: 'Plan_de_Test_Demo',
    testingBoardUrl: 'https://jira.demo.irma.local/projects/P0326/testing-board',
  }],
}

export function getDemoFormDefaults(gitRepository = '') {
  return {
    ...DEMO_FORM,
    gitRepository: gitRepository || DEMO_FORM.gitRepository,
    testPlans: DEMO_FORM.testPlans.map((p) => ({ ...p })),
  }
}

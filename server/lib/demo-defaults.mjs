/** Valeurs factices pour tester l'assistant et la génération des livrables. */

export const DEMO_FORM = {
  tribu: 'IT pour CA-TS',
  squad: 'Risk pour CA-TS',
  poName: 'Marie Dupont',
  baName: 'Jean Martin',
  scrumMasterName: 'Sophie Bernard',
  qaName: 'Lucas Petit',
  productCode: 'P0326',
  solutionCode: 'S0998',
  applicationLabel: 'Portail assurance démo',
  gitRepository: '',
  usesJiraPlans: true,
  jiraBaseUrl: 'https://jirasoftware-cats.atlassian.net',
  xrayClientId: 'DEMO5E30639ECEDC4A4DA4B6AC1E2619DFFF',
  xrayClientSecret: 'demo-xray-secret-a-remplacer-en-production',
  testPlans: [{
    planKey: 'P0326-10528',
    planName: 'Plan_de_Test_Demo',
    testingBoardUrl: 'https://jirasoftware-cats.atlassian.net/projects/P0326/testing-board',
  }],
}

export function getDemoFormDefaults(gitRepository = '') {
  return {
    ...DEMO_FORM,
    gitRepository: gitRepository || DEMO_FORM.gitRepository,
    testPlans: DEMO_FORM.testPlans.map((p) => ({ ...p })),
  }
}

/**
 * Client Xray Cloud (API v2) : authentification client_id / client_secret puis GraphQL.
 *
 *   const xray = createXrayCloudClient(settings)
 *   await xray.authenticate()
 *   await xray.createTest({ projectKey, summary, description, labels, testType, unstructured, gherkin })
 *   await xray.addTestsToTestPlan(planIssueId, [testIssueId])
 *
 * Le jeton (valable 24 h chez Xray) est mis en cache 23 h par adresse + identifiant client ;
 * un 401 sur GraphQL l'invalide et relance une fois. Le secret n'est jamais journalisé.
 */
import crypto from 'crypto'
import { XrayError, graphqlError } from './errors.mjs'

const TIMEOUT_MS = 30000
const TOKEN_TTL_MS = 23 * 3600 * 1000
const tokens = new Map() // empreinte (url + id + secret) → { token, expiresAt }

const cacheKey = (s) => crypto.createHash('sha256').update(`${s.cloudBaseUrl}\n${s.clientId}\n${s.clientSecret}`).digest('hex')

export function clearTokenCache() {
  tokens.clear()
}

async function post(url, body, headers = {}) {
  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'WizardQA/3', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (e) {
    const host = new URL(url).host
    const code = e?.cause?.code || e?.code || e?.name || ''
    if (code === 'TimeoutError' || code === 'ABORT_ERR') throw new XrayError(`Aucune réponse de Xray (${host}) en ${TIMEOUT_MS / 1000} s.`, { code: 'TIMEOUT', hint: 'Le réseau est peut-être filtré : vérifiez le proxy de l’entreprise (variable HTTPS_PROXY et NODE_USE_ENV_PROXY=1).' })
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') throw new XrayError(`Serveur Xray ${host} introuvable.`, { code: 'DNS', hint: 'Vérifiez la région Xray Cloud dans Réglages › JIRA / Xray, et votre connexion (VPN, proxy).' })
    if (code === 'ECONNREFUSED') throw new XrayError(`Connexion refusée par ${host}.`, { code: 'REFUSED', hint: 'Vérifiez l’adresse Xray Cloud.' })
    if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(code)) throw new XrayError(`Certificat HTTPS de ${host} non reconnu.`, { code: 'CERT', hint: 'Démarrez le portail avec NODE_EXTRA_CA_CERTS pointant vers le certificat de l’entreprise.' })
    throw new XrayError(`Erreur réseau vers Xray (${host}) : ${e?.message || e}`, { code: code || 'NETWORK' })
  }
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = null }
  return { status: res.status, data, text }
}

export function createXrayCloudClient(settings) {
  const base = String(settings.cloudBaseUrl || 'https://xray.cloud.getxray.app').replace(/\/+$/, '')
  if (!settings.clientId || !settings.clientSecret) {
    throw new XrayError('Identifiants Xray Cloud non renseignés.', { status: 400, code: 'XRAY_CONFIG', hint: 'Créez une clé d’API dans Xray (Paramètres globaux › API Keys) puis saisissez client_id et client_secret dans Réglages › JIRA / Xray.' })
  }

  async function authenticate({ force = false } = {}) {
    const key = cacheKey({ ...settings, cloudBaseUrl: base })
    const hit = tokens.get(key)
    if (!force && hit && hit.expiresAt > Date.now()) return hit.token
    const res = await post(`${base}/api/v2/authenticate`, { client_id: settings.clientId, client_secret: settings.clientSecret })
    if (res.status === 401 || res.status === 403 || res.status === 400) {
      tokens.delete(key)
      throw new XrayError(`Identifiants Xray Cloud refusés (${res.status}) : client_id ou client_secret invalide.`, { status: 401, code: 'XRAY_AUTH', hint: 'Vérifiez la clé d’API dans Xray (Paramètres globaux › API Keys) et la région choisie.' })
    }
    if (res.status < 200 || res.status >= 300) {
      throw new XrayError(`Xray Cloud indisponible (${res.status}) lors de l’authentification.`, { status: res.status, code: 'XRAY_SERVER', hint: 'Réessayez dans quelques minutes.' })
    }
    const token = typeof res.data === 'string' ? res.data : String(res.text || '').replace(/^"|"$/g, '')
    if (!token) throw new XrayError('Réponse d’authentification Xray illisible.', { code: 'XRAY_AUTH' })
    tokens.set(key, { token, expiresAt: Date.now() + TOKEN_TTL_MS })
    return token
  }

  async function graphql(query, variables, step = '') {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await authenticate({ force: attempt > 0 })
      const res = await post(`${base}/api/v2/graphql`, { query, variables }, { Authorization: `Bearer ${token}` })
      if (res.status === 401 && attempt === 0) continue
      if (res.status === 401) throw new XrayError('Jeton Xray invalide ou expiré (401).', { status: 401, code: 'XRAY_AUTH', step, hint: 'Vérifiez la clé d’API Xray ; elle a peut-être été révoquée.' })
      if (res.status === 429) throw new XrayError('Xray limite le nombre d’appels (429).', { status: 429, code: 'RATE_LIMIT', step, hint: 'Réessayez dans une minute.' })
      if (res.status < 200 || res.status >= 300) {
        if (res.data?.errors) throw graphqlError(res.data.errors, step, settings)
        throw new XrayError(`Réponse inattendue de Xray (${res.status}).`, { status: res.status, code: 'XRAY_HTTP', step })
      }
      if (res.data?.errors?.length) throw graphqlError(res.data.errors, step, settings)
      return res.data?.data || {}
    }
    return {}
  }

  async function createTest({ projectKey, summary, description, labels, testType, unstructured, gherkin }) {
    const jira = { fields: { summary, project: { key: projectKey }, labels: labels || [], description: description || '' } }
    if (settings.testIssueType && settings.testIssueType !== 'Test') jira.fields.issuetype = { name: settings.testIssueType }
    const data = await graphql(`mutation CreateTest($testType: UpdateTestTypeInput, $unstructured: String, $gherkin: String, $jira: JSON!) {
  createTest(testType: $testType, unstructured: $unstructured, gherkin: $gherkin, jira: $jira) {
    test { issueId testType { name kind } jira(fields: ["key"]) }
    warnings
  }
}`, { testType: { name: testType }, unstructured: unstructured ?? null, gherkin: gherkin ?? null, jira }, 'test')
    const test = data.createTest?.test
    if (!test?.issueId) throw new XrayError('Xray n’a pas renvoyé le ticket Test créé.', { code: 'GRAPHQL', step: 'test' })
    return { issueId: String(test.issueId), key: test.jira?.key || '', warnings: data.createTest?.warnings || [] }
  }

  async function updateDefinition(issueId, { testType, unstructured, gherkin }) {
    await graphql(`mutation UpdateTestType($issueId: String!, $testType: UpdateTestTypeInput!) {
  updateTestType(issueId: $issueId, testType: $testType) { issueId testType { name } }
}`, { issueId: String(issueId), testType: { name: testType } }, 'test')
    if (gherkin != null) {
      await graphql(`mutation UpdateGherkin($issueId: String!, $gherkin: String!) {
  updateGherkinTestDefinition(issueId: $issueId, gherkin: $gherkin) { issueId }
}`, { issueId: String(issueId), gherkin }, 'test')
    } else if (unstructured != null) {
      await graphql(`mutation UpdateUnstructured($issueId: String!, $unstructured: String!) {
  updateUnstructuredTestDefinition(issueId: $issueId, unstructured: $unstructured) { issueId }
}`, { issueId: String(issueId), unstructured }, 'test')
    }
  }

  async function addTestsToTestPlan(planIssueId, testIssueIds) {
    const data = await graphql(`mutation AddTestsToPlan($issueId: String!, $testIssueIds: [String]!) {
  addTestsToTestPlan(issueId: $issueId, testIssueIds: $testIssueIds) { addedTests warning }
}`, { issueId: String(planIssueId), testIssueIds: testIssueIds.map(String) }, 'plan')
    return { addedTests: data.addTestsToTestPlan?.addedTests || [], warning: data.addTestsToTestPlan?.warning || '' }
  }

  /** Vérification légère (test de connexion) : un plan de test au plus. */
  async function ping(projectKey) {
    const jql = projectKey ? `project = "${projectKey}"` : null
    const data = await graphql(`query Ping($jql: String) { getTestPlans(jql: $jql, limit: 1) { total } }`, { jql }, 'connexion')
    return { testPlans: data.getTestPlans?.total ?? null }
  }

  return { kind: 'cloud', baseUrl: base, authenticate, graphql, createTest, updateDefinition, addTestsToTestPlan, ping }
}

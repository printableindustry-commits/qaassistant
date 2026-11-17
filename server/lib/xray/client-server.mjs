/**
 * Xray Server / Data Center (module /rest/raven/1.0, identifiants JIRA) et mode « JIRA seul ».
 *
 *   const xs = createXrayServerClient(jiraClient, jiraSettings)
 *   await xs.discoverFields()                       → { testType, generic, cucumberType, cucumberScenario } (ids de champs)
 *   xs.definitionFields(fields, { testType, unstructured, gherkin, cucumberType }) → champs JIRA à envoyer
 *   await xs.addTestsToPlan('PROJ-9', ['PROJ-12'])
 *   await xs.importFeature(projectKey, text)        → [{ key, id }] (import Cucumber)
 *   await xs.ping()
 */
import { XrayError } from './errors.mjs'

const TIMEOUT_MS = 30000
const enc = encodeURIComponent

const FIELD_NAMES = {
  testType: ['test type', 'type de test'],
  generic: ['generic test definition', 'définition du test générique', 'definition du test generique'],
  cucumberType: ['cucumber test type', 'type de test cucumber'],
  cucumberScenario: ['cucumber scenario', 'scénario cucumber', 'scenario cucumber'],
}

/** En-tête d'authentification JIRA (même règle que le client JIRA : Basic sur Cloud, Bearer sinon). */
function authorization(settings, deployment) {
  const type = settings.authType && settings.authType !== 'auto' ? settings.authType : deployment === 'cloud' ? 'basic' : 'bearer'
  if (type === 'basic') return `Basic ${Buffer.from(`${settings.email}:${settings.token}`).toString('base64')}`
  return `Bearer ${settings.token}`
}

export function createXrayServerClient(client, jiraSettings) {
  let fieldsCache = null

  async function discoverFields() {
    if (fieldsCache) return fieldsCache
    const out = {}
    try {
      const list = await client.request('/rest/api/2/field')
      for (const f of list || []) {
        const name = String(f.name || '').trim().toLowerCase()
        for (const [k, names] of Object.entries(FIELD_NAMES)) {
          if (!out[k] && names.includes(name)) out[k] = f.id
        }
      }
    } catch { /* lecture des champs refusée : définition dans la description seulement */ }
    fieldsCache = out
    return out
  }

  /** Champs Xray Server à renseigner à la création (vide si les champs ne sont pas trouvés). */
  function definitionFields(fields, { testType, unstructured, gherkin, cucumberType }) {
    const out = {}
    if (fields.testType) out[fields.testType] = { value: testType }
    if (gherkin != null) {
      if (fields.cucumberType) out[fields.cucumberType] = { value: cucumberType === 'Scenario Outline' ? 'Scenario Outline' : 'Scenario' }
      if (fields.cucumberScenario) out[fields.cucumberScenario] = gherkin
    } else if (unstructured != null && fields.generic) {
      out[fields.generic] = unstructured
    }
    return out
  }

  async function addTestsToPlan(planKey, testKeys) {
    await client.request(`/rest/raven/1.0/api/testplan/${enc(planKey)}/test`, { method: 'POST', body: { add: testKeys } })
    return { addedTests: testKeys }
  }

  /** Import d'un fichier .feature (crée ou met à jour un Test Cucumber par scénario). */
  async function importFeature(projectKey, text) {
    const form = new FormData()
    form.append('file', new Blob([text], { type: 'text/plain' }), 'wizard-qa.feature')
    let res
    try {
      res = await fetch(`${client.baseUrl}/rest/raven/1.0/import/feature?projectKey=${enc(projectKey)}`, {
        method: 'POST',
        headers: { Authorization: authorization(jiraSettings, client.deployment), Accept: 'application/json', 'User-Agent': 'WizardQA/3' },
        body: form,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (e) {
      throw new XrayError(`Import Cucumber impossible : ${e?.message || e}`, { code: 'NETWORK', step: 'test' })
    }
    const body = await res.text()
    if (res.status === 404) throw new XrayError('API d’import Cucumber Xray introuvable (404).', { status: 404, code: 'XRAY_MISSING', step: 'test', hint: 'Le module Xray n’est pas installé sur ce JIRA, ou la version ne propose pas /rest/raven/1.0/import/feature.' })
    if (res.status === 401) throw new XrayError('Authentification JIRA refusée (401) lors de l’import Cucumber.', { status: 401, code: 'JIRA_AUTH', step: 'test' })
    if (res.status < 200 || res.status >= 300) throw new XrayError(`Import Cucumber refusé par Xray (${res.status}).`, { status: res.status, code: 'XRAY_IMPORT', step: 'test', hint: body.slice(0, 300) })
    let data = []
    try { data = JSON.parse(body) } catch { data = [] }
    const list = Array.isArray(data) ? data : data?.updatedOrCreatedTests || data?.testIssues?.success || []
    return list.filter((x) => x?.key).map((x) => ({ key: x.key, id: String(x.id || '') }))
  }

  async function ping() {
    await client.request('/rest/raven/1.0/api/settings/teststatuses')
    return { ok: true }
  }

  return { kind: 'server', discoverFields, definitionFields, addTestsToPlan, importFeature, ping }
}

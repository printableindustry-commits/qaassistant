/**
 * Erreurs de l'envoi vers JIRA / Xray, traduites en français avec une piste de résolution.
 *
 *   throw new XrayError('message', { status, code, hint, step })
 *   translateError(e, { step, settings, projectKey }) → XrayError
 */
import { JiraError } from '../jira/client.mjs'

export class XrayError extends Error {
  constructor(message, { status = 0, code = '', hint = '', step = '' } = {}) {
    super(message)
    this.status = status
    this.code = code
    this.hint = hint
    this.step = step
  }
}

const RIGHTS_HINT = 'Le compte JIRA utilisé doit avoir, dans le projet, les droits « Créer des tickets », « Modifier des tickets » et « Lier des tickets ».'

/** Convertit une erreur JIRA, Xray ou réseau en XrayError lisible. */
export function translateError(e, { step = '', settings = {}, projectKey = '' } = {}) {
  if (e instanceof XrayError) {
    if (!e.step) e.step = step
    return e
  }
  const message = String(e?.message || e)
  const testType = settings.testIssueType || 'Test'
  if (e instanceof JiraError) {
    const detail = message
    if (e.status === 401 || e.code === 'AUTH') {
      return new XrayError('Authentification JIRA refusée (401) : jeton invalide ou expiré.', { status: 401, code: 'JIRA_AUTH', step, hint: e.hint || 'Renouvelez le jeton dans Prise de connaissance › Connexion JIRA.' })
    }
    if (e.status === 403) {
      return new XrayError(`JIRA refuse l’opération (403) : droits insuffisants.${detail.includes('Détail') ? ` ${detail.slice(detail.indexOf('Détail'))}` : ''}`, { status: 403, code: 'FORBIDDEN', step, hint: RIGHTS_HINT })
    }
    if (e.status === 400 && /issue ?type|issuetype|type de ticket|type d.issue/i.test(detail)) {
      return new XrayError(`Le type d’issue « ${testType} » n’existe pas (ou n’est pas autorisé) dans le projet ${projectKey || 'cible'}.`, {
        status: 400,
        code: 'ISSUE_TYPE',
        step,
        hint: `Vérifiez qu’Xray est installé et que le schéma de types du projet contient « ${testType} » ; sinon corrigez le nom dans Réglages › JIRA / Xray.`,
      })
    }
    if (e.status === 400 && /link|lien/i.test(detail)) {
      return new XrayError(`JIRA refuse le lien entre le test et le récit.${detail.includes('Détail') ? ` ${detail.slice(detail.indexOf('Détail'))}` : ''}`, { status: 400, code: 'LINK', step, hint: `Vérifiez le type de lien « ${settings.linkType || 'Test'} » (Administration JIRA › Liens entre tickets) et que la liaison est activée.` })
    }
    if (e.status === 404 && step === 'plan') {
      return new XrayError('Plan de test introuvable (404).', { status: 404, code: 'PLAN_NOT_FOUND', step, hint: 'Vérifiez la clé du plan de test (ou choisissez « aucun »). Pour Xray Server, le module Xray doit être installé (API /rest/raven).' })
    }
    if (e.status === 404) {
      return new XrayError(`Élément introuvable dans JIRA (404).${detail.includes('Détail') ? ` ${detail.slice(detail.indexOf('Détail'))}` : ''}`, { status: 404, code: 'NOT_FOUND', step, hint: 'Le ticket a peut-être été supprimé, ou le compte n’a pas le droit de le voir. Pour Xray Server, vérifiez que le module Xray est installé (API /rest/raven).' })
    }
    return new XrayError(message, { status: e.status || 502, code: e.code || 'JIRA', step, hint: e.hint })
  }
  return new XrayError(message, { status: 502, code: e?.code || 'ERROR', step, hint: e?.hint || '' })
}

/** Messages GraphQL Xray → XrayError. */
export function graphqlError(errors, step, settings = {}) {
  const text = (errors || []).map((x) => x?.message || String(x)).filter(Boolean).join(' ; ') || 'erreur inconnue'
  if (/issue ?type|issuetype/i.test(text)) {
    return new XrayError(`Xray refuse la création : type d’issue « ${settings.testIssueType || 'Test'} » introuvable dans le projet. Détail Xray : ${text}`, { status: 400, code: 'ISSUE_TYPE', step, hint: 'Vérifiez que le projet est activé pour Xray (Paramètres du projet › Apps › Xray Settings).' })
  }
  if (/permission|not allowed|forbidden|unauthori[sz]ed/i.test(text)) {
    return new XrayError(`Xray refuse l’opération : droits insuffisants. Détail Xray : ${text}`, { status: 403, code: 'FORBIDDEN', step, hint: RIGHTS_HINT })
  }
  if (/test ?type/i.test(text)) {
    return new XrayError(`Type de test Xray inconnu. Détail Xray : ${text}`, { status: 400, code: 'TEST_TYPE', step, hint: 'Les types disponibles se règlent dans Xray (Paramètres globaux › Test Types) ; corrigez-les dans Réglages › JIRA / Xray.' })
  }
  return new XrayError(`Erreur Xray : ${text}`, { status: 502, code: 'GRAPHQL', step })
}

/** Réponse JSON d'erreur commune aux routes. */
export function errorPayload(e) {
  return { hint: e.hint || '', code: e.code || '', step: e.step || '', upstreamStatus: e.status || undefined }
}

/**
 * Contenu du ticket Test à partir de la source validée :
 *   { kind: 'playwright', sessionId } → artefact de la session d'exploration (getSessionArtifact)
 *   { kind: 'gherkin' }               → scénarios Gherkin validés du récit (readEntry)
 *
 *   buildTestContent({ story, source, settings, summary, testType })
 *   → { kind, summary, testType, labels, description, unstructured | gherkin, relPath, origin, stepsText }
 *
 * Les mots de passe ne figurent jamais dans le contenu : le code généré utilise des marqueurs / variables.
 */
import { HttpError } from '../http/router.mjs'
import { readEntry } from '../gherkin/store.mjs'

const MAX_SUMMARY = 255
const SECRET_MARKER = /\{\{account:[^}]+:password\}\}/g

/** Résumé JIRA sur une seule ligne : JIRA refuse les retours à la ligne et caractères de contrôle. */
export function oneLine(value) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim()
}

export function defaultSummary(story) {
  return oneLine(`[Auto] ${story.key} — ${story.summary || ''}`).slice(0, MAX_SUMMARY)
}

export function normalizeSource(input) {
  const kind = input?.kind === 'playwright' ? 'playwright' : input?.kind === 'gherkin' ? 'gherkin' : ''
  if (!kind) throw new HttpError(400, 'Source du test invalide : « playwright » (avec sessionId) ou « gherkin » attendu.')
  if (kind === 'playwright') {
    const sessionId = String(input.sessionId || '').trim()
    if (!sessionId || sessionId.length > 120 || !/^[\w.-]+$/.test(sessionId)) throw new HttpError(400, 'Identifiant de session Playwright manquant ou invalide.')
    return { kind, sessionId }
  }
  return { kind }
}

async function loadArtifact(sessionId) {
  let mod
  try {
    mod = await import('../explore/sessions.mjs')
  } catch {
    mod = null
  }
  if (!mod || typeof mod.getSessionArtifact !== 'function') {
    throw new HttpError(409, 'Validez d’abord le test : le module d’exploration Playwright n’est pas disponible.', { hint: 'Construisez et validez le test dans Automatisation avant de l’envoyer dans JIRA.' })
  }
  const artifact = await mod.getSessionArtifact(sessionId)
  return artifact || null
}

function selectorText(sel) {
  if (!sel) return ''
  return sel.code || (sel.strategy && sel.value ? `${sel.strategy}=${sel.value}` : String(sel.value || ''))
}

/** Étape lisible (français) à partir d'une étape du contrat §5.2. */
export function describeStep(step) {
  if (!step || typeof step !== 'object') return String(step || '')
  if (step.gherkin) return String(step.gherkin)
  const sel = selectorText(step.selector)
  const value = step.secret ? '(mot de passe du compte, non affiché)' : step.value != null ? `« ${String(step.value).replace(SECRET_MARKER, '••••')} »` : ''
  switch (step.action) {
    case 'goto': return `Ouvrir ${step.url || step.value || 'la page'}`
    case 'click': return `Cliquer sur ${sel}`
    case 'fill': return `Saisir ${value} dans ${sel}`
    case 'select': return `Choisir ${value} dans ${sel}`
    case 'check': return `Cocher ${sel}`
    case 'uncheck': return `Décocher ${sel}`
    case 'press': return `Appuyer sur ${step.value || 'une touche'}${sel ? ` dans ${sel}` : ''}`
    case 'hover': return `Survoler ${sel}`
    case 'expect': {
      const ex = step.expect || {}
      const what = { visible: 'est visible', hidden: 'est masqué', text: `contient le texte « ${ex.value ?? ''} »`, url: `l’adresse correspond à « ${ex.value ?? ''} »`, value: `a la valeur « ${ex.value ?? ''} »` }[ex.kind] || 'est conforme'
      return ex.kind === 'url' ? `Vérifier que ${what}` : `Vérifier que ${sel || 'l’élément'} ${what}`
    }
    default: return [step.action, sel, value].filter(Boolean).join(' ') || step.note || ''
  }
}

function stepsOf(artifact) {
  const scenarios = Array.isArray(artifact.scenarios) && artifact.scenarios.length
    ? artifact.scenarios
    : [{ name: '', steps: Array.isArray(artifact.steps) ? artifact.steps : [] }]
  const lines = []
  for (const sc of scenarios) {
    if (scenarios.length > 1 || sc.name) lines.push(`Scénario : ${sc.name || 'sans titre'}`)
    ;(sc.steps || []).forEach((s, i) => lines.push(`${i + 1}. ${describeStep(s)}`))
  }
  return lines
}

const SCENARIO_RE = /^\s*(Scénario|Scenario|Exemple|Example|Plan du sc[ée]nario|Scenario Outline|Scenario Template)\s*:/i
const OUTLINE_RE = /^\s*(Plan du sc[ée]nario|Scenario Outline|Scenario Template)\s*:/i
const BACKGROUND_RE = /^\s*(Contexte|Background)\s*:/i
const BLOCK_RE = /^\s*(Scénario|Scenario|Exemple|Example|Plan du sc[ée]nario|Scenario Outline|Scenario Template|Contexte|Background|Règle|Rule|Fonctionnalité|Feature)\s*:/i

function dedent(lines) {
  const indents = lines.filter((l) => l.trim()).map((l) => l.match(/^\s*/)[0].length)
  const min = indents.length ? Math.min(...indents) : 0
  return lines.map((l) => l.slice(Math.min(min, l.match(/^\s*/)[0].length)).replace(/\s+$/, ''))
}

/** Lignes du bloc qui suit l'en-tête `start` (jusqu'au prochain bloc ou aux étiquettes qui le précèdent). */
function blockBody(lines, start) {
  let end = start + 1
  while (end < lines.length && !BLOCK_RE.test(lines[end])) end++
  while (end > start + 1 && (/^\s*@/.test(lines[end - 1]) || !lines[end - 1].trim())) end--
  return lines.slice(start + 1, end)
}

/**
 * Définition Xray d'un test Cucumber à partir d'un fichier .feature : les ÉTAPES du premier scénario
 * (sans la ligne « Scénario : … », dont le titre est le résumé du ticket ; Xray la régénère à l'export),
 * précédées des étapes du Contexte et suivies des Exemples d'un plan de scénario.
 *   → { text, cucumberType: 'Scenario' | 'Scenario Outline', scenarioCount }
 */
export function cucumberDefinition(featureText) {
  const lines = String(featureText || '').replace(/\r\n?/g, '\n').split('\n')
  const lang = lines.find((l) => /^\s*#\s*language\s*:/i.test(l))
  const first = lines.findIndex((l) => SCENARIO_RE.test(l))
  const scenarioCount = lines.filter((l) => SCENARIO_RE.test(l)).length
  if (first < 0) return { text: String(featureText || '').trim(), cucumberType: 'Scenario', scenarioCount: 0 }
  const bg = lines.findIndex((l, i) => i < first && BACKGROUND_RE.test(l))
  const body = [...(bg >= 0 ? blockBody(lines, bg) : []), ...blockBody(lines, first)]
  const steps = dedent(body).join('\n').trim()
  return {
    text: lang ? `${lang.trim()}\n${steps}` : steps,
    cucumberType: OUTLINE_RE.test(lines[first]) ? 'Scenario Outline' : 'Scenario',
    scenarioCount,
  }
}

/** Compatibilité : texte de la définition seulement. */
export function gherkinDefinition(text) {
  return cucumberDefinition(text).text
}

function labelsFor(settings, kind) {
  const list = (settings.labels || []).map((l) => (kind === 'gherkin' && l === 'playwright' ? 'gherkin' : l))
  return [...new Set(list)].filter(Boolean)
}

function allowedTypes(settings, kind) {
  const base = kind === 'playwright' ? [settings.playwrightTestType || 'Generic', 'Generic'] : [settings.gherkinTestType || 'Cucumber', 'Cucumber', 'Generic']
  return [...new Set(base)]
}

export async function buildTestContent({ story, source, settings, summary, testType }) {
  const kind = source.kind
  const types = allowedTypes(settings, kind)
  const type = testType ? String(testType).trim() : types[0]
  if (!types.includes(type)) throw new HttpError(400, `Type de test « ${type} » non proposé pour cette source (choix : ${types.join(', ')}).`)
  const title = oneLine(summary).slice(0, MAX_SUMMARY).trim() || defaultSummary(story)
  const header = [`Test automatisé généré par Wizard QA pour le récit ${story.key} — ${story.summary || ''}.`]
  const isCucumber = /cucumber/i.test(type)

  if (kind === 'playwright') {
    const artifact = await loadArtifact(source.sessionId)
    if (!artifact) throw new HttpError(404, 'Session d’exploration introuvable.', { hint: 'Elle a peut-être été supprimée : relancez l’automatisation du récit.' })
    if (artifact.storyKey && String(artifact.storyKey).toUpperCase() !== story.key) {
      throw new HttpError(400, `Cette session concerne le récit ${artifact.storyKey}, pas ${story.key}.`)
    }
    if (artifact.status !== 'validated') {
      throw new HttpError(409, 'Validez d’abord le test : la session Playwright n’est pas encore validée par le testeur.', { hint: 'Rejouez puis validez le test dans Automatisation, puis renvoyez-le.' })
    }
    const code = String(artifact.code || '').replace(SECRET_MARKER, '••••')
    const steps = stepsOf(artifact)
    const relPath = artifact.relPath || ''
    const target = artifact.target ? `${artifact.target.name || ''}${artifact.target.baseUrl ? ` (${artifact.target.baseUrl})` : ''}`.trim() : ''
    const unstructured = [
      'Test Playwright (@playwright/test) généré et validé dans Wizard QA.',
      relPath ? `Fichier : ${relPath}` : '',
      target ? `Application testée : ${target}` : '',
      relPath ? `Exécution : npx playwright test ${relPath}` : '',
      '',
      'Étapes :',
      ...steps,
      '',
      'Code :',
      code,
    ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n')
    const description = [
      ...header,
      relPath ? `Fichier : {{${relPath}}}` : '',
      target ? `Application testée : ${target}` : '',
      '',
      'h3. Étapes',
      ...steps.map((s) => (/^\d+\./.test(s) ? `# ${s.replace(/^\d+\.\s*/, '')}` : `*${s}*`)),
      '',
      'h3. Code Playwright',
      '{code:javascript}',
      code,
      '{code}',
    ].join('\n')
    return {
      kind, summary: title, testType: type, labels: labelsFor(settings, kind), description, unstructured, gherkin: null,
      relPath, stepsText: steps, origin: { sessionId: source.sessionId, status: artifact.status, target: artifact.target || null },
    }
  }

  const entry = readEntry(story.key)
  if (!entry || typeof entry.text !== 'string' || !entry.text.trim()) {
    throw new HttpError(409, 'Aucun scénario Gherkin pour ce récit.', { hint: 'Générez puis validez les scénarios dans Récits et Gherkin.' })
  }
  if (entry.status !== 'validated') {
    throw new HttpError(409, 'Validez d’abord le Gherkin : les scénarios de ce récit sont encore au statut brouillon.', { hint: 'Relisez puis cliquez sur « Valider » dans Récits et Gherkin.' })
  }
  const text = entry.text.replace(/\r\n?/g, '\n')
  const relPath = entry.exportedPath || ''
  const description = [
    ...header,
    relPath ? `Fichier : {{${relPath}}}` : '',
    '',
    'h3. Scénarios Gherkin',
    '{code:gherkin}',
    text,
    '{code}',
  ].join('\n')
  const cucumber = isCucumber ? cucumberDefinition(text) : null
  const warnings = cucumber && cucumber.scenarioCount > 1
    ? [`La fonctionnalité contient ${cucumber.scenarioCount} scénarios : la définition Cucumber du ticket Test reprend le premier ; tous figurent dans la description. Choisissez le type Generic pour garder le fichier entier comme définition.`]
    : []
  return {
    kind,
    summary: title,
    testType: type,
    labels: labelsFor(settings, kind),
    description,
    unstructured: isCucumber ? null : text,
    gherkin: cucumber ? cucumber.text : null,
    cucumberType: cucumber ? cucumber.cucumberType : null,
    contentWarnings: warnings,
    featureText: text,
    relPath,
    stepsText: [],
    origin: { scenarios: entry.scenarios || 0, validatedAt: entry.validatedAt || null, validatedBy: entry.validatedBy || '' },
  }
}

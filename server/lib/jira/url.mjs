/**
 * Lecture d'une URL JIRA collée par le testeur (tableau, backlog, ticket, filtre, recherche JQL…).
 * Contrat (docs/V3-ARCHITECTURE.md §5.1) :
 *   parseJiraUrl(url) → { ok: true, baseUrl, projectKey, boardId, issueKey, jql, filterId, … }
 *                     | { ok: false, error: 'message lisible' }
 *
 * Formes reconnues (Cloud et Server / Data Center, avec ou sans chemin de contexte comme /jira) :
 *   /browse/KEY, /browse/KEY-12, /projects/KEY, /jira/software/(c/)projects/KEY/boards/12(/backlog),
 *   /jira/core/projects/KEY, /jira/servicedesk/projects/KEY, /secure/RapidBoard.jspa?rapidView=12&projectKey=KEY,
 *   /issues/?jql=…, /issues/?filter=…, ?selectedIssue=KEY-1, /issues/KEY-12
 * Champs complémentaires renvoyés : kind ('board'|'backlog'|'issue'|'project'|'filter'|'jql'), deployment
 * ('cloud'|'server', déduit de l'hôte), host, warnings[].
 */

const PROJECT_KEY_RE = /^[A-Z][A-Z0-9_]{1,19}$/
const ISSUE_KEY_RE = /^([A-Z][A-Z0-9_]{1,19})-(\d{1,9})$/
const ISSUE_KEY_ANY_RE = /\b([A-Z][A-Z0-9_]{1,19})-(\d{1,9})\b/
// Premiers segments de chemin propres aux écrans de JIRA : ce qui les précède est le chemin de contexte (Server).
const MARKERS = new Set(['browse', 'projects', 'secure', 'issues', 'plugins', 'rest', 'servicedesk', 'dashboards', 'login.jsp', 'issuenavigator'])
// « /jira/software/… », « /jira/core/… » : chemin propre à JIRA Cloud (ou à une instance qui l'imite).
// Sur un hôte non Atlassian, seuls ces préfixes distinguent un écran « Cloud » d'un contexte Server nommé /jira.
const CLOUD_APPS = new Set(['software', 'core', 'servicedesk', 'your-work', 'for-you'])
const MAX_JQL = 4000

const fail = (error, extra = {}) => ({ ok: false, error, ...extra })

function isCloudHost(host) {
  return /\.(atlassian\.net|jira\.com|jira-dev\.com)$/i.test(host)
}

/** Nettoie une saisie : espaces, guillemets ou chevrons autour de l'adresse (copier-coller depuis un courriel). */
function cleanInput(raw) {
  let s = String(raw ?? '').trim()
  s = s.replace(/^[<"'«\s]+|[>"'»\s]+$/g, '').trim()
  return s
}

function projectFromJql(jql) {
  const m = /\bproject\s*(?:=|in\s*\(|IN\s*\()\s*["']?([A-Za-z][A-Za-z0-9_]{1,19})["']?/i.exec(jql)
  if (!m) return null
  const key = m[1].toUpperCase()
  return PROJECT_KEY_RE.test(key) ? key : null
}

/** Découpe le chemin en « contexte » (Server : /jira…) et segments propres à JIRA. */
function splitPath(segments, cloud) {
  if (cloud) {
    // Sur Cloud, l'instance est toujours à la racine de l'hôte.
    return { context: [], rest: segments }
  }
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i].toLowerCase()
    if (MARKERS.has(seg) || /\.jspa$/i.test(seg)) return { context: segments.slice(0, i), rest: segments.slice(i) }
    // « /jira/software/projects/… » : écran Cloud servi depuis la racine (ou derrière un contexte plus profond).
    if (seg === 'jira' && CLOUD_APPS.has(String(segments[i + 1] || '').toLowerCase())) {
      return { context: segments.slice(0, i), rest: segments.slice(i) }
    }
  }
  // Aucun écran reconnu : l'adresse entière est l'instance (par exemple https://jira.entreprise.fr/jira).
  return { context: segments, rest: [] }
}

/**
 * Analyse une URL JIRA. Ne lève jamais d'exception.
 */
export function parseJiraUrl(raw) {
  const input = cleanInput(raw)
  if (!input) return fail('Collez l’adresse d’un écran de votre projet JIRA (tableau, backlog ou ticket).')
  if (input.length > 8000) return fail('Adresse trop longue (8 000 caractères au plus).')
  if (!/[/.:]/.test(input)) {
    const key = input.toUpperCase()
    if (ISSUE_KEY_RE.test(key) || PROJECT_KEY_RE.test(key)) {
      return fail(`« ${input} » ressemble à une clé JIRA, pas à une adresse : ouvrez le projet dans JIRA et copiez l’URL complète depuis la barre d’adresse (par exemple https://monentreprise.atlassian.net/browse/${key}).`)
    }
    return fail('Adresse JIRA invalide : copiez l’URL complète depuis la barre d’adresse du navigateur (elle commence par https://).')
  }
  let text = input
  if (/^\/\//.test(text)) text = `https:${text}`
  else if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) text = `https://${text}`
  let u
  try {
    u = new URL(text)
  } catch {
    return fail('Adresse JIRA invalide : copiez l’URL complète depuis la barre d’adresse du navigateur (elle commence par https://).')
  }
  if (!/^https?:$/.test(u.protocol)) return fail('L’adresse JIRA doit commencer par https:// (ou http:// pour un serveur interne).')
  if (!u.hostname || /[\s<>]/.test(u.hostname)) return fail('Adresse JIRA invalide : nom de serveur manquant.')

  const warnings = []
  if (u.username || u.password) warnings.push('Les identifiants présents dans l’adresse ont été ignorés : ils ne sont jamais conservés.')
  const host = u.hostname.toLowerCase()
  const cloud = isCloudHost(host)
  let segments
  try {
    segments = u.pathname.split('/').filter(Boolean).map((s) => decodeURIComponent(s))
  } catch {
    segments = u.pathname.split('/').filter(Boolean)
  }
  const { context, rest } = splitPath(segments, cloud)
  const port = u.port ? `:${u.port}` : ''
  const contextPath = context.length ? `/${context.map((s) => encodeURIComponent(s)).join('/')}` : ''
  const baseUrl = `${u.protocol}//${host}${port}${contextPath}`

  const q = u.searchParams
  const lower = rest.map((s) => s.toLowerCase())
  let projectKey = null
  let issueKey = null
  let boardId = null
  let jql = null
  let filterId = null
  let kind = null

  // Ticket : /browse/KEY-12, /issues/KEY-12, ?selectedIssue=KEY-12 (tableau ou backlog), ?issueKey=
  const browse = lower.indexOf('browse')
  if (browse >= 0 && rest[browse + 1]) {
    const target = rest[browse + 1].toUpperCase()
    if (ISSUE_KEY_RE.test(target)) issueKey = target
    else if (PROJECT_KEY_RE.test(target)) projectKey = target
  }
  const issuesIdx = lower.indexOf('issues')
  if (!issueKey && issuesIdx >= 0 && rest[issuesIdx + 1] && ISSUE_KEY_RE.test(rest[issuesIdx + 1].toUpperCase())) issueKey = rest[issuesIdx + 1].toUpperCase()
  for (const name of ['selectedIssue', 'issueKey']) {
    const v = String(q.get(name) || '').trim().toUpperCase()
    if (!issueKey && ISSUE_KEY_RE.test(v)) issueKey = v
  }

  // Projet : /projects/KEY (Cloud et Server), ?projectKey=KEY
  const projectsIdx = lower.indexOf('projects')
  if (projectsIdx >= 0 && rest[projectsIdx + 1]) {
    const target = rest[projectsIdx + 1].toUpperCase()
    if (PROJECT_KEY_RE.test(target)) projectKey = projectKey || target
  }
  const qProject = String(q.get('projectKey') || q.get('project') || '').trim().toUpperCase()
  if (!projectKey && PROJECT_KEY_RE.test(qProject)) projectKey = qProject

  // Tableau : /boards/12, ?rapidView=12
  const boardsIdx = lower.indexOf('boards')
  if (boardsIdx >= 0 && /^\d{1,9}$/.test(rest[boardsIdx + 1] || '')) boardId = rest[boardsIdx + 1]
  const rapid = String(q.get('rapidView') || '').trim()
  if (!boardId && /^\d{1,9}$/.test(rapid)) boardId = rapid

  // Recherche : ?jql=…, ?filter=12345 (les filtres système JIRA sont négatifs : -1, -4…)
  const qJql = String(q.get('jql') || '').trim()
  if (qJql) {
    if (qJql.length > MAX_JQL) return fail('Requête JQL trop longue dans l’adresse (4 000 caractères au plus).')
    jql = qJql
  }
  const qFilter = String(q.get('filter') || q.get('filterId') || '').trim()
  if (/^-?\d{1,12}$/.test(qFilter)) filterId = qFilter
  if (!jql && !filterId && lower.includes('filters')) {
    const fi = lower.indexOf('filters')
    if (/^\d{1,12}$/.test(rest[fi + 1] || '')) filterId = rest[fi + 1]
  }

  if (!projectKey && issueKey) projectKey = issueKey.replace(/-\d+$/, '')
  if (!projectKey && jql) projectKey = projectFromJql(jql)
  // Dernier recours : une clé de ticket quelque part dans le chemin (écran personnalisé).
  if (!projectKey && !boardId && !jql && !filterId) {
    const m = ISSUE_KEY_ANY_RE.exec(rest.join('/').toUpperCase())
    if (m) {
      issueKey = `${m[1]}-${m[2]}`
      projectKey = m[1]
    }
  }

  if (jql) kind = 'jql'
  else if (filterId) kind = 'filter'
  else if (boardId) kind = lower.includes('backlog') || q.get('view') === 'planning' || q.get('view') === 'planning.nodetail' ? 'backlog' : 'board'
  else if (issueKey) kind = 'issue'
  else if (projectKey) kind = 'project'

  if (!kind) {
    return fail(`Instance JIRA reconnue (${host}), mais l’adresse ne désigne aucun projet : ouvrez le tableau, le backlog ou un ticket de votre projet, puis copiez l’URL de la barre d’adresse.`, { baseUrl, host, deployment: cloud ? 'cloud' : 'server' })
  }
  return {
    ok: true,
    baseUrl,
    projectKey: projectKey || null,
    boardId: boardId || null,
    issueKey: issueKey || null,
    jql: jql || null,
    filterId: filterId || null,
    kind,
    host: `${host}${port}`,
    deployment: cloud ? 'cloud' : 'server',
    warnings,
  }
}

/**
 * Version de l'URL collée qu'on peut conserver et réafficher (historique du scan, bouton « Rescanner ») :
 * sans identifiants (https://utilisateur:motdepasse@…) ni fragment. Chaîne vide si l'adresse est illisible.
 */
export function storableJiraUrl(raw) {
  let text = cleanInput(raw)
  if (/^\/\//.test(text)) text = `https:${text}`
  else if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) text = `https://${text}`
  try {
    const u = new URL(text)
    if (!/^https?:$/.test(u.protocol)) return ''
    u.username = ''
    u.password = ''
    u.hash = ''
    return u.href.slice(0, 2000)
  } catch {
    return ''
  }
}

/** Libellé court en français de ce qu'une URL analysée désigne (« tableau 12 du projet IRMA »). */
export function describeParsedUrl(p) {
  if (!p?.ok) return ''
  const project = p.projectKey ? `projet ${p.projectKey}` : ''
  switch (p.kind) {
    case 'board': return `tableau ${p.boardId}${project ? ` du ${project}` : ''}`
    case 'backlog': return `backlog du tableau ${p.boardId}${project ? ` (${project})` : ''}`
    case 'issue': return `ticket ${p.issueKey} → ${project}`
    case 'filter': return `filtre ${p.filterId}`
    case 'jql': return `recherche JQL${project ? ` (${project})` : ''}`
    default: return project
  }
}

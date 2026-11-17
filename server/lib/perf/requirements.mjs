/**
 * Exigences de performance détectées dans les récits (description et critères d'acceptation).
 *
 * Règles (sans IA) :
 *  - temps de réponse : « en moins de 2 s », « inférieur à 800 ms », « sous 1,5 seconde » → seuil p95
 *  - concurrence      : « 200 utilisateurs simultanés » → VUs
 *  - débit            : « 50 requêtes par seconde » → taux d'arrivée
 *  - disponibilité    : « disponibilité de 99,9 % » → taux d'erreur toléré, test d'endurance
 *  - pic / endurance  : « pic », « soldes », « pendant 2 heures » → objectif spike / soak
 * Chaque récit porteur d'au moins une exigence donne une proposition de profil créable en un clic.
 */
import { HttpError } from '../http/router.mjs'
import { listK6Profiles, getK6Profile } from '../k6-profiles.mjs'
import { createProfile } from './profiles.mjs'

const RESPONSE_RE = /(?:en moins de|au[- ]del[àa] de|moins de|inf[ée]rieur(?:e|s)? (?:ou [ée]gal )?à|sous|ne d[ée]passe pas|n'exc[èe]de pas|maximum(?: de)?|max\.?|au plus|<=?|≤)\s*(\d+(?:[.,]\d+)?)\s*(ms|millisecondes?|s\b|sec(?:ondes?)?\b)/gi
const USERS_RE = /(\d[\d\s.]*\d|\d+)\s*(?:utilisateurs?|usagers?|clients?|agents?|sessions?|connexions?|personnes?)\s*(?:connect[ée]s\s*)?(?:simultan[ée]s?|concurrent(?:e|s|es)?|en (?:m[êe]me temps|parall[èe]le)|en simultan[ée])/gi
const THROUGHPUT_RE = /(\d[\d\s.]*\d|\d+)\s*(?:requ[êe]tes|appels|transactions|req|tps|commandes|demandes)\s*(?:\/|par)\s*(s\b|sec(?:onde)?|min(?:ute)?|h(?:eure)?)/gi
const AVAILABILITY_RE = /disponibilit[ée]\s*(?:de\s*|d'au moins\s*|minimale de\s*|≥\s*|>=\s*)?(\d{2}(?:[.,]\d+)?)\s*%/gi
const SPIKE_RE = /\b(pic|pics|soldes|black friday|afflux|rush|ouverture des inscriptions|mont[ée]e brutale)\b/i
const SOAK_RE = /\b(pendant|sur|durant)\s+(\d+)\s*(heures?|h)\b|\b(endurance|24\s*h|24\/7|en continu)\b/i
const PATH_RE = /(?:^|\s|«|"|`|\()((?:GET|POST|PUT|PATCH|DELETE)\s+)?(\/(?:api|v\d)[\w\-./{}:]*)/g

const toNumber = (s) => Number(String(s).replace(/[\s.](?=\d{3}\b)/g, '').replace(',', '.'))

function snippet(text, index, length) {
  const start = Math.max(0, index - 40)
  const end = Math.min(text.length, index + length + 40)
  return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`
}

/** Analyse un texte : renvoie la liste des exigences trouvées. */
export function detectRequirements(text) {
  const src = String(text || '')
  const found = []
  for (const m of src.matchAll(RESPONSE_RE)) {
    const unit = m[2].toLowerCase()
    const ms = toNumber(m[1]) * (unit.startsWith('ms') || unit.startsWith('milli') ? 1 : 1000)
    if (ms > 0 && ms <= 120000) found.push({ type: 'response', label: 'Temps de réponse', value: ms, display: `p95 < ${ms} ms`, excerpt: snippet(src, m.index, m[0].length) })
  }
  for (const m of src.matchAll(USERS_RE)) {
    const n = toNumber(m[1])
    if (n > 0 && n <= 100000) found.push({ type: 'concurrency', label: 'Utilisateurs simultanés', value: n, display: `${n} utilisateurs`, excerpt: snippet(src, m.index, m[0].length) })
  }
  for (const m of src.matchAll(THROUGHPUT_RE)) {
    const n = toNumber(m[1])
    const per = m[2].toLowerCase()
    const rps = per.startsWith('min') ? n / 60 : per.startsWith('h') ? n / 3600 : n
    if (rps > 0) found.push({ type: 'throughput', label: 'Débit', value: Math.round(rps * 100) / 100, display: `${Math.round(rps * 100) / 100} req/s`, excerpt: snippet(src, m.index, m[0].length) })
  }
  for (const m of src.matchAll(AVAILABILITY_RE)) {
    const pct = toNumber(m[1])
    if (pct >= 90 && pct < 100) found.push({ type: 'availability', label: 'Disponibilité', value: pct, display: `${pct} %`, excerpt: snippet(src, m.index, m[0].length) })
  }
  const spike = src.match(SPIKE_RE)
  if (spike) found.push({ type: 'spike', label: 'Pic de charge', value: null, display: spike[0], excerpt: snippet(src, spike.index, spike[0].length) })
  const soak = src.match(SOAK_RE)
  if (soak) {
    const hours = soak[2] ? Number(soak[2]) : null
    found.push({ type: 'soak', label: 'Endurance', value: hours, display: hours ? `${hours} h` : soak[0], excerpt: snippet(src, soak.index, soak[0].length) })
  }
  // Une même exigence citée deux fois (description et critère) n'est gardée qu'une fois.
  const seen = new Set()
  return found.filter((r) => {
    const id = `${r.type}:${r.value}`
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}

function extractPaths(text) {
  const paths = new Set()
  for (const m of String(text || '').matchAll(PATH_RE)) paths.add(m[2].replace(/[.,;:)]+$/, '').replace(/\{[^}]+\}/g, '1'))
  return [...paths].slice(0, 6)
}

/** Proposition de profil k6 à partir des exigences d'un récit. */
export function proposeProfile(story, reqs) {
  const pick = (type) => reqs.filter((r) => r.type === type)
  const response = pick('response').map((r) => r.value)
  const users = pick('concurrency').map((r) => r.value)
  const throughput = pick('throughput').map((r) => r.value)
  const availability = pick('availability').map((r) => r.value)
  const soak = pick('soak')[0]
  const spike = pick('spike').length > 0

  const objective = soak ? 'soak' : spike ? 'spike' : users.length || throughput.length ? 'load' : 'smoke'
  const vus = users.length ? Math.max(...users) : throughput.length ? Math.max(5, Math.ceil(Math.max(...throughput) * 1.5)) : 10
  const p95Ms = response.length ? Math.min(...response) : 800
  const maxErrorRate = availability.length ? Math.max(0.1, Math.round((100 - Math.max(...availability)) * 100) / 100) : 1
  const duration = soak ? `${Math.min(soak.value || 1, 4) * 60}m` : spike ? '2m' : objective === 'load' ? '5m' : '1m'
  const executorType = throughput.length && !users.length ? 'constant-arrival-rate' : objective === 'smoke' ? 'constant-vus' : 'ramping-vus'
  const text = `${story.descriptionText || ''}\n${(story.acceptanceCriteria || []).join('\n')}`
  const paths = extractPaths(text)

  return {
    name: `${story.key} — ${String(story.summary || '').slice(0, 60)}`,
    objective,
    executorType,
    vus,
    duration,
    p95Ms,
    p99Ms: p95Ms * 2,
    maxErrorRate,
    arrivalRate: throughput.length ? Math.ceil(Math.max(...throughput)) : null,
    rampUp: objective === 'spike' ? '10s' : '1m',
    rampDown: '30s',
    entryPaths: paths.length ? paths : ['/'],
    rationale: [
      response.length ? `Seuil p95 fixé au temps de réponse le plus exigeant (${p95Ms} ms).` : 'Aucun temps de réponse chiffré : seuil p95 par défaut (800 ms).',
      users.length ? `${vus} utilisateurs virtuels pour ${vus} utilisateurs simultanés.` : throughput.length ? `Débit visé ${Math.max(...throughput)} req/s (exécuteur à taux d’arrivée constant).` : 'Charge par défaut : 10 utilisateurs virtuels.',
      availability.length ? `Disponibilité ${Math.max(...availability)} % → erreurs tolérées < ${maxErrorRate} %.` : null,
      soak ? 'Exigence de durée : test d’endurance.' : spike ? 'Mention d’un pic : test de pic de trafic.' : null,
    ].filter(Boolean),
  }
}

/** Récits de démonstration (projet IRMA) utilisés si le module JIRA est absent ou vide. */
const DEMO_STORIES = [
  {
    key: 'IRMA-101', summary: 'Consulter la liste des dossiers clients', status: 'À faire', epic: { key: 'IRMA-1', summary: 'Espace conseiller' },
    descriptionText: 'En tant que conseiller, je veux consulter la liste de mes dossiers clients (GET /api/dossiers) afin de préparer mes rendez-vous.',
    acceptanceCriteria: ['La liste s’affiche en moins de 2 secondes pour 200 utilisateurs simultanés.', 'La pagination renvoie 50 dossiers par page.'],
  },
  {
    key: 'IRMA-114', summary: 'Recherche d’un client par nom', status: 'En cours', epic: { key: 'IRMA-1', summary: 'Espace conseiller' },
    descriptionText: 'La recherche (GET /api/clients/recherche) doit supporter 30 requêtes par seconde aux heures de pointe.',
    acceptanceCriteria: ['Les résultats apparaissent en moins de 800 ms.', 'Une recherche sans résultat affiche un message explicite.'],
  },
  {
    key: 'IRMA-128', summary: 'Ouverture des inscriptions annuelles', status: 'À faire', epic: { key: 'IRMA-2', summary: 'Campagnes' },
    descriptionText: 'Lors de l’ouverture des inscriptions, un pic de trafic est attendu sur POST /api/inscriptions.',
    acceptanceCriteria: ['Le service accepte 500 utilisateurs connectés simultanément.', 'Le temps de réponse reste inférieur à 3 s.', 'Disponibilité de 99,5 % pendant la campagne.'],
  },
  {
    key: 'IRMA-140', summary: 'Synchronisation nocturne des contrats', status: 'À faire', epic: { key: 'IRMA-3', summary: 'Back-office' },
    descriptionText: 'Le batch de synchronisation tourne pendant 2 heures et appelle /api/contrats/sync en continu.',
    acceptanceCriteria: ['Disponibilité de 99,9 % de l’API pendant le traitement.', 'Aucune dégradation des temps de réponse au-delà de 1 s.'],
  },
  {
    key: 'IRMA-152', summary: 'Modifier l’adresse d’un client', status: 'Terminé', epic: { key: 'IRMA-1', summary: 'Espace conseiller' },
    descriptionText: 'En tant que conseiller, je veux mettre à jour l’adresse postale d’un client.',
    acceptanceCriteria: ['Le code postal est contrôlé.', 'Un historique de modification est conservé.'],
  },
]

async function loadStories({ demo = false } = {}) {
  const mod = demo ? null : await import('../jira/stories.mjs').catch(() => null)
  if (mod?.listStories) {
    try {
      const stories = await mod.listStories({})
      const scan = mod.getScanInfo ? await mod.getScanInfo() : null
      if (Array.isArray(stories) && stories.length) {
        return { stories, source: scan?.source || stories[0]?.source || 'jira', scan }
      }
    } catch { /* repli sur la démonstration */ }
  }
  return { stories: DEMO_STORIES.map((s) => ({ ...s, source: 'demo' })), source: 'demo', scan: null }
}

function profilesByStory() {
  const map = new Map()
  for (const p of listK6Profiles()) {
    const full = getK6Profile(p.id)
    for (const key of full?.meta?.storyKeys || []) map.set(key, { id: p.id, name: p.name })
  }
  return map
}

/** Récits analysés : exigences détectées et proposition de profil. */
/** demo = true : analyse les récits de démonstration même si des récits JIRA existent. */
export async function listRequirements({ demo = false } = {}) {
  const { stories, source, scan } = await loadStories({ demo })
  const linked = profilesByStory()
  const items = []
  for (const s of stories) {
    const text = `${s.summary || ''}\n${s.descriptionText || ''}\n${(s.acceptanceCriteria || []).join('\n')}`
    const reqs = detectRequirements(text)
    if (!reqs.length) continue
    items.push({
      key: s.key,
      summary: s.summary,
      status: s.status,
      url: s.url || null,
      epic: s.epic || null,
      source: s.source || source,
      requirements: reqs,
      proposal: proposeProfile(s, reqs),
      profile: linked.get(s.key) || null,
    })
  }
  return { source, scannedAt: scan?.scannedAt || null, analyzed: stories.length, items, demoAvailable: !demo }
}

/** Crée le profil proposé pour un récit (surcharges facultatives : vus, duration, p95Ms, baseUrl). */
export async function createProfileFromStory(key, overrides) {
  overrides = overrides && typeof overrides === 'object' ? overrides : {}
  const real = await listRequirements()
  let item = real.items.find((i) => i.key === key)
  // Récits d'exemple (?demo=1) : proposés à l'écran, ils doivent aussi pouvoir être créés.
  if (!item) item = (await listRequirements({ demo: true })).items.find((i) => i.key === key)
  if (!item) throw new HttpError(404, 'Aucune exigence de performance détectée pour ce récit.')
  if (item.profile) throw new HttpError(409, `Un profil existe déjà pour ${key} : « ${item.profile.name} ».`)
  const p = { ...item.proposal, ...pickOverrides(overrides) }
  const baseUrl = checkBaseUrl(overrides.baseUrl)
  const profile = createProfile({
    name: p.name,
    answers: {
      campaignName: p.name,
      campaignObjective: p.objective,
      executorType: p.executorType,
      virtualUsers: p.vus,
      duration: p.duration,
      rampUpDuration: p.rampUp,
      rampDownDuration: p.rampDown,
      arrivalRate: p.arrivalRate || undefined,
      p95Ms: p.p95Ms,
      p99Ms: p.p99Ms,
      maxErrorRate: p.maxErrorRate,
      entryPaths: p.entryPaths.join('\n'),
      scenarioDescription: p.entryPaths.map((path) => `${Math.floor(100 / p.entryPaths.length)}% ${path}`).join('\n'),
      ...(baseUrl ? { baseUrl } : {}),
      thinkTimeMin: 1,
      thinkTimeMax: 3,
      abortOnFail: 'no',
    },
    meta: { storyKeys: [key], origin: 'requirements' },
  })
  return { profile: { id: profile.id, name: profile.name }, story: key }
}

/** URL cible facultative : http(s) uniquement, sans identifiants (ils finiraient dans le script). */
function checkBaseUrl(raw) {
  const text = String(raw || '').trim()
  if (!text) return ''
  let url
  try {
    url = new URL(text)
  } catch {
    throw new HttpError(400, 'URL cible invalide : saisissez une adresse complète (https://…).')
  }
  if (!/^https?:$/.test(url.protocol)) throw new HttpError(400, 'L’URL cible doit commencer par http:// ou https://.')
  if (url.username || url.password) throw new HttpError(400, 'Ne mettez pas d’identifiants dans l’URL cible.')
  return url.toString().replace(/\/$/, '')
}

function pickOverrides(o = {}) {
  const out = {}
  if (Number.isInteger(Number(o.vus)) && Number(o.vus) > 0) out.vus = Number(o.vus)
  if (typeof o.duration === 'string' && /^(?:\d+(?:ms|s|m|h))+$/.test(o.duration.trim())) out.duration = o.duration.trim()
  if (Number(o.p95Ms) > 0) out.p95Ms = Number(o.p95Ms)
  return out
}

/**
 * Profils exécutables : profils de campagne (écran « Scénarios k6 ») et profils prêts à
 * l'emploi intégrés (fumée, charge, pic, endurance), utilisables sans aucune configuration.
 */
import fs from 'fs'
import path from 'path'
import { REPO_ROOT } from '../paths.mjs'
import { listK6Profiles, getK6Profile, saveK6Profile } from '../k6-profiles.mjs'
import { writeProfileScript, profileScriptRel, buildThresholdsFromAnswers, parseJourneys } from '../k6-perf-generator.mjs'
import { loadK6InitConfig } from '../stack-install-config.mjs'
import { resolveK6Paths } from '../k6-scaffold.mjs'
import { getSettings } from './store.mjs'

const DEMO_URL = 'https://quickpizza.grafana.com'

function defaultBaseUrl() {
  const url = String(loadK6InitConfig().baseUrl || '').trim()
  return !url || /example\.(com|org)/i.test(url) ? DEMO_URL : url
}

const PRESETS = [
  {
    id: 'preset-smoke',
    name: 'Fumée (smoke)',
    description: 'Quelques utilisateurs pendant 30 s : vérifie que le script et la cible répondent.',
    answers: { campaignObjective: 'smoke', executorType: 'constant-vus', virtualUsers: 2, duration: '30s', p95Ms: 800, p99Ms: 1500, maxErrorRate: 1 },
  },
  {
    id: 'preset-load',
    name: 'Charge nominale',
    description: 'Montée progressive jusqu’à la charge attendue en production, puis palier.',
    answers: { campaignObjective: 'load', executorType: 'ramping-vus', virtualUsers: 20, duration: '3m', rampUpDuration: '1m', rampDownDuration: '30s', p95Ms: 500, p99Ms: 1000, maxErrorRate: 1 },
  },
  {
    id: 'preset-spike',
    name: 'Pic de trafic',
    description: 'Montée brutale à forte charge : résistance et retour à la normale.',
    answers: { campaignObjective: 'spike', executorType: 'ramping-vus', virtualUsers: 100, duration: '1m', rampUpDuration: '10s', rampDownDuration: '20s', p95Ms: 1200, p99Ms: 2500, maxErrorRate: 5 },
  },
  {
    id: 'preset-soak',
    name: 'Endurance',
    description: 'Charge modérée sur une longue durée : fuites mémoire, dérive des temps de réponse.',
    answers: { campaignObjective: 'soak', executorType: 'constant-vus', virtualUsers: 15, duration: '30m', p95Ms: 600, p99Ms: 1200, maxErrorRate: 0.5 },
  },
]

function presetProfile(preset) {
  return {
    id: preset.id,
    name: preset.name,
    builtin: true,
    description: preset.description,
    answers: {
      campaignName: preset.name,
      baseUrl: defaultBaseUrl(),
      entryPaths: '/',
      scenarioDescription: '100% accueil /',
      thinkTimeMin: 1,
      thinkTimeMax: 2,
      abortOnFail: 'no',
      ...preset.answers,
    },
    meta: {},
  }
}

export const isPresetId = (id) => PRESETS.some((p) => p.id === id)

/** Profil exécutable (intégré ou enregistré), ou null. */
export function getRunnableProfile(id) {
  const preset = PRESETS.find((p) => p.id === id)
  if (preset) return presetProfile(preset)
  const p = getK6Profile(id)
  return p ? { ...p, builtin: false } : null
}

function card(profile, baselines) {
  const a = profile.answers || {}
  const scriptRel = profileScriptRel(profile)
  return {
    id: profile.id,
    name: profile.name,
    builtin: Boolean(profile.builtin),
    description: profile.description || profile.notes || '',
    objective: a.campaignObjective || '',
    environment: a.environment || '',
    executor: a.executorType || 'constant-vus',
    baseUrl: a.baseUrl || '',
    vus: Number(a.virtualUsers) || 10,
    duration: a.duration || '1m',
    rampUp: a.rampUpDuration || '',
    rampDown: a.rampDownDuration || '',
    p95Ms: Number(a.p95Ms) || 500,
    maxErrorRate: Number(a.maxErrorRate) || 1,
    arrivalRate: Number(a.arrivalRate) || null,
    journeys: parseJourneys(a).map((j) => ({ name: j.name, weight: j.weight })),
    thresholds: buildThresholdsFromAnswers(a),
    scriptPath: scriptRel,
    scriptExists: fs.existsSync(path.join(REPO_ROOT, scriptRel)),
    storyKeys: profile.meta?.storyKeys || [],
    baselineRunId: baselines[profile.id] || null,
    updatedAt: profile.updatedAt || null,
  }
}

/** Profils enregistrés puis profils intégrés, sous forme de cartes. */
export function listRunnableProfiles() {
  const { baselines } = getSettings()
  const saved = listK6Profiles().map((p) => getK6Profile(p.id)).filter(Boolean)
  return [
    ...saved.map((p) => card(p, baselines)),
    ...PRESETS.map((p) => card(presetProfile(p), baselines)),
  ]
}

/** Écrit (ou réutilise) le script du profil ; renvoie le chemin relatif à exécuter. */
export function ensureProfileScript(profile) {
  return writeProfileScript(profile)
}

/** Scripts k6 présents dans le projet (k6/scripts/*.js). */
export function listScripts() {
  const k6Dir = resolveK6Paths(loadK6InitConfig()).k6Dir
  const dir = path.join(REPO_ROOT, k6Dir, 'scripts')
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => `${k6Dir}/scripts/${f}`)
    .sort()
}

/** Valide un chemin de script fourni par l'utilisateur : uniquement sous <REPO_ROOT>/<k6Dir>. */
export function resolveScriptPath(rel) {
  const k6Dir = resolveK6Paths(loadK6InitConfig()).k6Dir
  const root = path.resolve(REPO_ROOT, k6Dir)
  const abs = path.resolve(REPO_ROOT, String(rel || ''))
  if (!abs.startsWith(root + path.sep) || !abs.endsWith('.js') || !fs.existsSync(abs)) return null
  return path.relative(REPO_ROOT, abs).replace(/\\/g, '/')
}

/** Crée un profil enregistré (utilisé par les exigences issues des récits). */
export function createProfile({ name, answers, meta }) {
  return saveK6Profile({ name, answers, meta })
}

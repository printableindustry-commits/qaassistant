/**
 * Plan d'installation déclaratif.
 * Référence : server/conf/install-plan.reference.json (livrée avec l'application).
 * Copie locale : <CONF_DIR>/install-plan.conf.json — fusionnée avec la référence à chaque lecture
 * (les nouvelles clés sont ajoutées, les valeurs de l'utilisateur sont conservées).
 */
import fs from 'fs'
import path from 'path'
import { CONF_DIR, SERVER_CONF_DIR } from '../paths.mjs'

const REFERENCE_PATH = path.join(SERVER_CONF_DIR, 'install-plan.reference.json')
export const PLAN_PATH = path.join(CONF_DIR, 'install-plan.conf.json')
export const MASK = '••••'

const BROWSERS = ['chromium', 'firefox', 'webkit']
const VERSION_RE = /^(latest|[~^]?\d+(\.\d+){0,2}([-+][\w.]+)?)$/
const URL_RE = /^https?:\/\/[^\s"'<>]+$/i
const EXTENSION_RE = /^[A-Za-z0-9][\w-]*\.[A-Za-z0-9][\w.-]*$/
// Node et k6 portables : la version sert à construire l'URL et le dossier d'installation.
const EXACT_VERSION_RE = /^\d+\.\d+\.\d+$/
const EXACT_VERSION_KEYS = new Set(['node', 'k6'])
// Commande VS Code (ou éditeur compatible) : jamais un exécutable quelconque.
const EDITOR_CLI_RE = /^(code|code-insiders|codium|cursor)(\.cmd|\.exe)?$/i

/** Clé propre à l'objet (exclut __proto__, constructor, toString…). */
export function has(obj, key) {
  return Boolean(obj) && typeof key === 'string' && Object.prototype.hasOwnProperty.call(obj, key)
}

function isObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v)
}

/** Fusion profonde : la base fournit les clés manquantes, l'override garde ses valeurs. */
export function deepMerge(base, override) {
  if (!isObject(base) || !isObject(override)) return override === undefined ? base : override
  const out = { ...base }
  for (const [k, v] of Object.entries(override)) {
    out[k] = isObject(v) && isObject(base[k]) ? deepMerge(base[k], v) : v
  }
  return out
}

/** Lit un JSON (BOM UTF-8 toléré, fréquent avec les éditeurs Windows) ; null si absent ou invalide. */
export function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
  } catch {
    return null
  }
}

export function writeJsonAtomic(file, data, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, mode ? { encoding: 'utf8', mode } : 'utf8')
  fs.renameSync(tmp, file)
}

export function loadReference() {
  const ref = readJson(REFERENCE_PATH)
  if (!ref) throw new Error(`Plan de référence illisible : ${REFERENCE_PATH}`)
  return ref
}

/**
 * Plan effectif. La copie locale est créée si absente, et réécrite quand la référence apporte
 * de nouvelles clés (migration). Les définitions de composants viennent toujours de la référence
 * (structure applicative) ; seuls libellés et caractère requis/optionnel restent personnalisables.
 */
export function loadPlan() {
  const ref = loadReference()
  const local = readJson(PLAN_PATH)
  if (!local) {
    // Copie locale illisible (édition manuelle ratée) : on ne l'écrase pas, on travaille sur la référence.
    if (!fs.existsSync(PLAN_PATH)) {
      try { writeJsonAtomic(PLAN_PATH, ref, 0o600) } catch { /* lecture seule : on garde la référence */ }
    }
    return ref
  }
  const merged = deepMerge(ref, local)
  merged.version = ref.version
  merged.base = ref.base
  merged.stacks = deepMerge(ref.stacks, pick(local.stacks, Object.keys(ref.stacks)))
  for (const id of Object.keys(ref.stacks)) merged.stacks[id].components = ref.stacks[id].components
  for (const id of Object.keys(merged.components)) {
    if (!ref.components[id]) delete merged.components[id]
    else {
      merged.components[id].dependsOn = ref.components[id].dependsOn
      if (ref.components[id].packages) merged.components[id].packages = ref.components[id].packages
    }
  }
  if (JSON.stringify(merged) !== JSON.stringify(local)) {
    try { writeJsonAtomic(PLAN_PATH, merged, 0o600) } catch { /* ignoré */ }
  }
  return merged
}

function pick(obj, keys) {
  const out = {}
  for (const k of keys) if (obj && obj[k] !== undefined) out[k] = obj[k]
  return out
}

/** Masque le mot de passe d'une URL de proxy : http://user:••••@hôte:port */
export function maskUrl(value) {
  const s = String(value || '')
  return s.replace(/(\/\/[^:/@\s]+:)[^@\s]+@/, `$1${MASK}@`)
}

/** Plan renvoyé aux routes GET : secrets masqués (proxy et miroirs avec identifiants). */
export function publicPlan(plan = loadPlan()) {
  const out = JSON.parse(JSON.stringify(plan))
  out.proxy.http = maskUrl(out.proxy.http)
  out.proxy.https = maskUrl(out.proxy.https)
  for (const k of Object.keys(out.mirrors || {})) out.mirrors[k] = maskUrl(out.mirrors[k])
  return out
}

/** Remplace « {clé} » par plan.versions[clé]. */
export function resolveVersion(plan, spec) {
  return String(spec || '').replace(/\{(\w+)\}/g, (_, k) => String(plan.versions?.[k] ?? ''))
}

/** Composants à traiter pour un ensemble de stacks (socle + composants des stacks), sans doublon. */
export function componentsForStacks(plan, stacks) {
  const ids = [...plan.base]
  for (const s of stacks) {
    if (!has(plan.stacks, s)) continue
    for (const c of plan.stacks[s].components || []) if (!ids.includes(c)) ids.push(c)
  }
  return ids
}

export function normalizeStacks(plan, stacks) {
  const known = (list) => [...new Set((Array.isArray(list) ? list : []).filter((s) => has(plan.stacks, s)))]
  const wanted = known(stacks)
  return wanted.length ? wanted : known(plan.selectedStacks)
}

/** Identifiants de composants connus du plan (les autres valeurs sont ignorées). */
export function knownComponents(plan, ids) {
  return Array.isArray(ids) ? [...new Set(ids.filter((id) => has(plan.components, id)))] : []
}

/**
 * Valeur renvoyée par le formulaire : si elle contient le masque (ou un caractère abîmé par l'encodage),
 * on réinjecte le mot de passe enregistré, ce qui permet de changer l'hôte ou le port sans le ressaisir.
 */
function keepSecret(next, current) {
  if (typeof next !== 'string') return current
  const value = next.trim()
  if (!/•|\uFFFD/.test(value)) return value
  const secret = String(current || '').match(/\/\/[^:/@\s]+:([^@\s]+)@/)?.[1]
  if (!secret) return current
  return value.replace(/(\/\/[^:/@\s]+:)[^@\s]*@/, (_, user) => `${user}${secret}@`)
}

function check(cond, message, errors) {
  if (!cond) errors.push(message)
}

/** Valide et applique une mise à jour partielle des paramètres. Renvoie le plan enregistré. */
export function savePlanSettings(body = {}) {
  if (!isObject(body)) throw Object.assign(new Error('Paramètres invalides : objet JSON attendu.'), { status: 400 })
  const plan = loadPlan()
  const errors = []

  if (body.selectedStacks !== undefined) {
    const list = Array.isArray(body.selectedStacks) ? body.selectedStacks : []
    const stacks = [...new Set(list.filter((s) => has(plan.stacks, s)))]
    check(stacks.length > 0, 'Choisissez au moins une stack.', errors)
    plan.selectedStacks = stacks
  }
  for (const [k, v] of Object.entries(isObject(body.versions) ? body.versions : {})) {
    if (!has(plan.versions, k)) continue
    if (k === 'nodeMinMajor') {
      const n = Number(v)
      check(Number.isInteger(n) && n >= 18 && n <= 40, 'Version majeure minimale de Node invalide.', errors)
      plan.versions[k] = n
    } else if (EXACT_VERSION_KEYS.has(k)) {
      check(EXACT_VERSION_RE.test(String(v).trim()), `Version exacte attendue pour « ${k} » (ex. 22.20.0) : ${v}`, errors)
      plan.versions[k] = String(v).trim()
    } else {
      check(VERSION_RE.test(String(v).trim()), `Version invalide pour « ${k} » : ${v}`, errors)
      plan.versions[k] = String(v).trim()
    }
  }
  for (const [k, v] of Object.entries(isObject(body.mirrors) ? body.mirrors : {})) {
    if (!has(plan.mirrors, k)) continue
    const s = String(keepSecret(String(v ?? ''), plan.mirrors[k]) || '').replace(/\/+$/, '')
    check(!s || URL_RE.test(s), `Adresse de miroir invalide (${k}) : doit commencer par http(s)://`, errors)
    plan.mirrors[k] = s
  }
  if (isObject(body.proxy)) {
    const p = body.proxy
    const http = keepSecret(p.http, plan.proxy.http)
    const https = keepSecret(p.https, plan.proxy.https)
    check(!http || URL_RE.test(http), 'Proxy HTTP invalide : http://hôte:port attendu.', errors)
    check(!https || URL_RE.test(https), 'Proxy HTTPS invalide : http://hôte:port attendu.', errors)
    plan.proxy.http = http
    plan.proxy.https = https
    if (p.noProxy !== undefined) plan.proxy.noProxy = String(p.noProxy).replace(/[^\w.,*\-:]/g, '')
    if (p.strictSsl !== undefined) plan.proxy.strictSsl = Boolean(p.strictSsl)
    if (p.caFile !== undefined) {
      const ca = String(p.caFile || '').trim()
      check(!ca || fs.existsSync(ca), `Certificat introuvable : ${ca}`, errors)
      plan.proxy.caFile = ca
    }
  }
  const o = isObject(body.options) ? body.options : {}
  if (o.browsers !== undefined) {
    const list = (Array.isArray(o.browsers) ? o.browsers : []).filter((b) => BROWSERS.includes(b))
    check(list.length > 0, 'Choisissez au moins un navigateur.', errors)
    plan.options.browsers = list
  }
  if (o.addToUserPath !== undefined) plan.options.addToUserPath = Boolean(o.addToUserPath)
  if (o.useWinget !== undefined) plan.options.useWinget = Boolean(o.useWinget)
  if (o.vscodeCli !== undefined) {
    const cli = String(o.vscodeCli || '').trim()
    check(!cli || EDITOR_CLI_RE.test(path.basename(cli)), 'Commande VS Code invalide : chemin complet de code, code.cmd, codium ou cursor attendu.', errors)
    check(!cli || fs.existsSync(cli), `Commande VS Code introuvable : ${cli}`, errors)
    plan.options.vscodeCli = cli
  }
  if (o.vscodeExtensions && isObject(o.vscodeExtensions)) {
    for (const [stack, list] of Object.entries(o.vscodeExtensions)) {
      if (!has(plan.stacks, stack)) continue
      const ids = (Array.isArray(list) ? list : String(list).split(/[\s,]+/)).map((s) => String(s).trim()).filter(Boolean)
      const bad = ids.filter((id) => !EXTENSION_RE.test(id))
      check(!bad.length, `Identifiant d'extension invalide : ${bad.join(', ')}`, errors)
      plan.options.vscodeExtensions[stack] = ids
    }
  }
  for (const [id, c] of Object.entries(isObject(body.components) ? body.components : {})) {
    if (!has(plan.components, id) || !isObject(c)) continue
    if (c.required !== undefined) plan.components[id].required = Boolean(c.required)
  }

  if (errors.length) {
    const err = new Error(errors.join(' '))
    err.status = 400
    throw err
  }
  writeJsonAtomic(PLAN_PATH, plan, 0o600)
  return plan
}

/** Remet la copie locale à la valeur de référence. */
export function resetPlan() {
  const ref = loadReference()
  writeJsonAtomic(PLAN_PATH, ref, 0o600)
  return ref
}

export { EXTENSION_RE, EDITOR_CLI_RE }

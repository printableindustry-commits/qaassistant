/**
 * Orchestration des livrables : faits + profil + modèle → document (contrat V3.2 §6.5).
 *
 *   listDocuments()                 état de tous les documents (statut, à actualiser, manquants, relecture) + KPI
 *   getDocument(id)                 dernière version (ou aperçu non enregistré) + HTML + sources
 *   generateDocument(id, user)      nouvelle version générée
 *   editDocument(id, markdown, user), reviewDocumentById(id, user, opts), approveDocument(id, user)
 *   exportDocument(id, format)      { filename, type, body }      exportPack() → { filename, body }
 *
 * Les chiffres et listes viennent uniquement des faits (facts.mjs) ; le profil (profile.mjs, assistant
 * « Informations projet ») fournit ce qui ne se déduit pas des données. Les modules facts / profile sont
 * chargés dynamiquement : s'ils sont en panne, le document reste générable avec des marqueurs explicites.
 */
import fs from 'fs'
import path from 'path'
import { SERVER_DIR } from '../paths.mjs'
import { HttpError } from '../http/router.mjs'
import { renderTemplate } from './template.mjs'
import { markdownToHtml, printableHtml } from './render.mjs'
import { markdownToDocx } from './docx.mjs'
import { coverInfo, markdownToModelDocx } from './docx-model.mjs'
import { loadModel } from './word-model.mjs'
import { zipStore } from './zip.mjs'
import { reviewDocument } from './review.mjs'
import {
  loadCatalog, catalogEntry, loadTemplate, loadDoc, latestVersion, addVersion, setReview, setApproval, sha256, LIVRABLES_DIR,
} from './store.mjs'

export const STATUS_LABEL = {
  none: 'Non généré',
  generated: 'Généré',
  edited: 'Modifié',
  reviewed: 'Relu par l’agent',
  approved: 'Approuvé',
}

const RESULT_LABEL = { passed: 'Réussi', failed: 'Échec', skipped: 'Ignoré', flaky: 'Instable', 'not-run': 'Non exécuté' }
const GHERKIN_LABEL = { none: 'Aucun', draft: 'Brouillon', validated: 'Validé' }
const TRIAGE_LABEL = { todo: 'À automatiser', later: 'Plus tard', skip: 'Non retenu' }

// --- sources de données (modules de l'autre piste, chargés à la demande) ----

async function tryImport(name) {
  try {
    return await import(`./${name}.mjs`)
  } catch (e) {
    if (e.code !== 'ERR_MODULE_NOT_FOUND') console.error(`[livrables] ${name}.mjs :`, e.message)
    return null
  }
}

function emptyFacts(reason) {
  const facts = {
    generatedAt: new Date().toISOString(), demo: false, project: {}, tools: {}, stories: [], epics: [],
    triage: {}, gherkin: {}, automation: { specs: [], sessions: {}, targets: [] }, campaigns: [], lastCampaign: null,
    defects: [], perf: { runs: 0, last: null }, xray: { pushed: 0, simulated: 0, plans: [] }, coverage: {},
    gaps: [{ kind: 'facts', message: reason }], sources: {},
  }
  facts.hash = sha256({ ...facts, generatedAt: null })
  return facts
}

let factsCache = null
export async function getFacts({ fresh = false } = {}) {
  if (!fresh && factsCache && Date.now() - factsCache.t < 2000) return factsCache.facts
  const mod = await tryImport('facts')
  let facts
  try {
    facts = mod?.collectFacts ? await mod.collectFacts() : emptyFacts('Module de collecte des faits indisponible.')
  } catch (e) {
    facts = emptyFacts(`Collecte des faits en échec : ${e.message}`)
  }
  factsCache = { t: Date.now(), facts }
  return facts
}

export function invalidateFacts() {
  factsCache = null
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/** Valeurs du profil projet ({ champ: valeur }). */
export async function getProfileValues() {
  const mod = await tryImport('profile')
  try {
    const p = mod?.loadProfile ? await mod.loadProfile() : readJson(path.join(LIVRABLES_DIR, 'profile.json'))
    return (p && typeof p.values === 'object' ? p.values : p) || {}
  } catch {
    return {}
  }
}

/** Libellé et étape de chaque champ du questionnaire (pour les marqueurs « À compléter »). */
export function questionnaireFields() {
  const q = readJson(path.join(SERVER_DIR, 'conf', 'livrables', 'questionnaire.json'))
  const fields = {}
  for (const step of q?.steps || []) {
    for (const f of step.fields || []) fields[f.id] = { label: f.label || f.id, step: step.title || step.label || step.id }
  }
  return fields
}

// --- contexte des modèles --------------------------------------------------

function pct(n, d) {
  return d ? Math.round((n / d) * 100) : 0
}

function passRate(c) {
  if (!c) return null
  const executed = (c.total || 0) - (c.skipped || 0)
  return executed ? pct(c.passed || 0, executed) : null
}

/** Valeurs dérivées des faits (filtrages et agrégats que les modèles ne savent pas calculer). */
export function computeCalc(facts, profile, docsState = []) {
  const stories = facts.stories || []
  const last = facts.lastCampaign
  const defects = facts.defects || []
  const open = defects.filter((d) => d.status === 'ouverte')
  const count = (sev) => open.filter((d) => d.severity === sev).length
  const rate = passRate(last)

  const traceRows = stories.map((s) => ({
    key: s.key,
    summary: s.summary,
    epic: s.epicKey ? `${s.epicKey}${s.epicSummary ? ' ' + s.epicSummary : ''}` : '—',
    risk: s.risk?.level || '—',
    triage: TRIAGE_LABEL[s.triage] || 'Non trié',
    criteria: s.criteriaCount ?? 0,
    gherkin: s.gherkin && s.gherkin.status !== 'none' ? `${GHERKIN_LABEL[s.gherkin.status]} (${s.gherkin.scenarios || 0} sc.)` : 'Aucun',
    specs: (s.automation || []).map((a) => a.relPath).filter(Boolean).join(', ') || '—',
    xray: (s.xray || []).map((x) => `${x.testKey}${x.simulated ? ' (simulé)' : ''}`).join(', ') || '—',
    result: RESULT_LABEL[s.lastResult] || 'Non exécuté',
    priority: s.priority || '',
    automated: (s.automation || []).length > 0,
  }))
  const withLabel = (s) => ({ ...s, triageLabel: TRIAGE_LABEL[s.triage] || 'Non trié' })

  const seuil = Number(profile.seuilReussite)
  const maxBloq = Number(profile.maxAnomaliesBloquantes ?? 0)
  const maxMaj = profile.maxAnomaliesMajeures == null ? NaN : Number(profile.maxAnomaliesMajeures)
  const seuilCouv = profile.couvertureMin == null ? NaN : Number(profile.couvertureMin)
  const cov = facts.coverage || {}
  const exit = []
  if (Number.isFinite(seuil)) exit.push({ critere: 'Taux de réussite des tests exécutés', cible: `≥ ${seuil} %`, mesure: rate == null ? 'non mesuré' : `${rate} %`, atteint: rate != null && rate >= seuil })
  exit.push({ critere: 'Anomalies bloquantes ouvertes', cible: `≤ ${Number.isFinite(maxBloq) ? maxBloq : 0}`, mesure: String(count('bloquante')), atteint: count('bloquante') <= (Number.isFinite(maxBloq) ? maxBloq : 0) })
  if (Number.isFinite(maxMaj)) exit.push({ critere: 'Anomalies majeures ouvertes', cible: `≤ ${maxMaj}`, mesure: String(count('majeure')), atteint: count('majeure') <= maxMaj })
  if (Number.isFinite(seuilCouv)) exit.push({ critere: 'Récits « À automatiser » couverts par un test automatisé', cible: `≥ ${seuilCouv} %`, mesure: `${cov.pctAutomated ?? 0} %`, atteint: (cov.pctAutomated ?? 0) >= seuilCouv })
  exit.forEach((e) => { e.statut = e.atteint ? 'Atteint' : 'Non atteint' })
  const exitMet = exit.every((e) => e.atteint) && last != null

  return {
    passRate: rate,
    storiesTodo: stories.filter((s) => s.triage === 'todo').map(withLabel),
    storiesHighRisk: stories.filter((s) => s.risk?.level === 'élevé').map(withLabel),
    automationRows: stories.flatMap((s) => (s.automation || []).map((a) => ({ storyKey: s.key, ...a }))),
    storiesUncovered: traceRows.filter((r) => r.triage === 'À automatiser' && (!r.automated || r.gherkin === 'Aucun')),
    storiesWithGherkin: stories.filter((s) => s.gherkin && s.gherkin.status !== 'none'),
    traceRows,
    defectsOpen: open,
    defectsClosed: defects.filter((d) => d.status !== 'ouverte'),
    defectsCount: { bloquante: count('bloquante'), majeure: count('majeure'), mineure: count('mineure'), ouvertes: open.length, total: defects.length },
    lastTests: (last?.tests || []).map((t) => ({ ...t, resultLabel: RESULT_LABEL[t.status] || t.status, storyKey: t.storyKey || '—' })),
    failedTests: (last?.tests || []).filter((t) => t.status === 'failed'),
    campaignsReal: (facts.campaigns || []).filter((c) => !c.simulated).length,
    exit,
    exitMet,
    exitLabel: last == null ? 'Non évaluable (aucune campagne exécutée)' : exitMet ? 'Atteints' : 'Non atteints',
    recommendation: last == null
      ? 'Aucune campagne d’exécution enregistrée : la recommandation ne peut pas être formulée.'
      : exitMet
        ? 'Les critères de sortie sont atteints : la mise en production est recommandée, sous réserve des anomalies résiduelles listées.'
        : 'Les critères de sortie ne sont pas atteints (voir l’évaluation ci-dessous) : la mise en production n’est pas recommandée en l’état, sauf dérogation formelle du valideur.',
    tools: [
      facts.tools?.playwright ? `Playwright ${facts.tools.playwright.version || ''}`.trim() : null,
      facts.tools?.k6 ? `k6 ${facts.tools.k6.version || ''}`.trim() : null,
      facts.tools?.xray ? `Xray (${facts.tools.xray.mode || 'non configuré'}${facts.tools.xray.configured ? '' : ', non configuré'})` : null,
      facts.tools?.llm ? `Assistant IA (${facts.tools.llm.provider})` : null,
      'Wizard QA',
    ].filter(Boolean),
    docs: docsState,
  }
}

function sourceLine(facts) {
  const p = facts.project || {}
  const parts = []
  if (p.scanAt) parts.push(`JIRA ${p.key || ''} ${facts.demo ? '(jeu de démonstration)' : ''} du ${new Date(p.scanAt).toLocaleDateString('fr-FR')}`.replace(/\s+/g, ' '))
  if (facts.lastCampaign) parts.push(`campagne ${facts.lastCampaign.id}${facts.lastCampaign.simulated ? ' (simulée)' : ''}`)
  if (facts.gherkin?.total) parts.push(`${facts.gherkin.total} Gherkin`)
  if (facts.xray?.pushed) parts.push(`${facts.xray.pushed} envoi(s) Xray`)
  return parts.join(', ') || 'aucune donnée collectée'
}

function userName(user) {
  return user?.displayName || user?.username || 'wizard-qa'
}

function docMeta(entry, doc, facts, user, nextN) {
  const history = doc.versions.map((v) => ({ n: v.n, date: v.at, by: v.by, kind: v.kind === 'edited' ? 'Modification manuelle' : 'Génération à partir des données' }))
  if (nextN) history.push({ n: nextN, date: new Date().toISOString(), by: userName(user), kind: 'Génération à partir des données' })
  return {
    ...entry,
    version: nextN || latestVersion(doc)?.n || 0,
    date: new Date().toISOString(),
    status: nextN ? 'Brouillon généré' : STATUS_LABEL[doc.status],
    author: userName(user),
    reviewedBy: doc.review && !doc.review.blocking ? 'Agent QA (relecture automatique)' : '',
    approvedBy: doc.approval ? `${doc.approval.by} le ${new Date(doc.approval.at).toLocaleDateString('fr-FR')}` : '',
    dataDate: facts.generatedAt,
    dataSource: sourceLine(facts),
    demo: Boolean(facts.demo),
    history: history.reverse(),
  }
}

function docsState() {
  return loadCatalog().documents.map((e) => {
    const d = loadDoc(e.id)
    const last = latestVersion(d)
    return { id: e.id, title: e.title, ref: e.ref, status: STATUS_LABEL[d.status], version: last ? `v${last.n}` : '—' }
  })
}

async function state() {
  const facts = await getFacts()
  const profile = await getProfileValues()
  return { facts, profile, profileHash: sha256(profile).slice(0, 16), fields: questionnaireFields(), docs: docsState() }
}

function render(id, st, user, nextN) {
  const entry = catalogEntry(id)
  if (!entry) throw new HttpError(404, `Document inconnu : ${id}`)
  const tpl = loadTemplate(id)
  const doc = loadDoc(id)
  const context = {
    facts: st.facts,
    profile: st.profile,
    doc: docMeta(entry, doc, st.facts, user, nextN),
    calc: computeCalc(st.facts, st.profile, st.docs),
    now: new Date().toISOString(),
  }
  let out
  try {
    out = renderTemplate(tpl.source, context, { fields: st.fields })
  } catch (e) {
    throw new HttpError(422, `Modèle « ${id} » invalide : ${e.message}`)
  }
  return { entry, doc, tpl, ...out }
}

/** Met à jour le cartouche (statut, relu par, approuvé par) d'une version enregistrée. */
function liveCartouche(markdown, doc) {
  const set = (label, value) => {
    markdown = markdown.replace(new RegExp(`^(\\|\\s*${label}\\s*\\|)[^\\n]*$`, 'm'), `$1 ${value} |`)
  }
  set('Statut', STATUS_LABEL[doc.status])
  if (doc.review && !doc.review.blocking) set('Relu par', `Agent QA (relecture automatique, score ${doc.review.score}/100)`)
  if (doc.approval) set('Approuvé par', `${doc.approval.by} le ${new Date(doc.approval.at).toLocaleDateString('fr-FR')} (version ${doc.approval.version})`)
  return markdown
}

function stale(version, facts, profileHash, tpl) {
  if (!version) return false
  return version.factsHash !== facts.hash || version.profileHash !== profileHash || version.templateHash !== tpl.hash
}

// --- opérations ------------------------------------------------------------

export async function listDocuments() {
  const st = await state()
  const documents = loadCatalog().documents.map((entry) => {
    const doc = loadDoc(entry.id)
    const last = latestVersion(doc)
    const tpl = loadTemplate(entry.id)
    let missing = []
    try {
      missing = render(entry.id, st, null, null).missing
    } catch { /* modèle invalide : signalé à l'ouverture */ }
    return {
      id: entry.id,
      title: entry.title,
      phase: entry.phase,
      ref: entry.ref,
      purpose: entry.purpose,
      status: doc.status,
      statusLabel: STATUS_LABEL[doc.status],
      stale: stale(last, st.facts, st.profileHash, tpl),
      missing,
      version: last?.n || 0,
      updatedAt: last?.at || null,
      review: doc.review ? { verdict: doc.review.verdict, score: doc.review.score, at: doc.review.at } : null,
      approval: doc.approval,
    }
  })
  const generated = documents.filter((d) => d.status !== 'none')
  const kpis = {
    total: documents.length,
    generated: generated.length,
    upToDate: generated.filter((d) => !d.stale).length,
    stale: generated.filter((d) => d.stale).length,
    reviewed: documents.filter((d) => d.status === 'reviewed' || (d.status === 'approved' && d.review)).length,
    approved: documents.filter((d) => d.status === 'approved').length,
    missingFields: new Set(documents.flatMap((d) => d.missing.map((m) => m.field))).size,
  }
  const f = st.facts
  return {
    ok: true,
    documents,
    phases: loadCatalog().phases,
    kpis,
    facts: { coverage: f.coverage, lastCampaign: f.lastCampaign ? { ...f.lastCampaign, tests: undefined } : null, demo: Boolean(f.demo), project: f.project, generatedAt: f.generatedAt },
  }
}

/** Faits utilisés par le modèle et leur provenance. */
function usedSources(tplSource, facts) {
  const paths = new Set()
  for (const m of tplSource.matchAll(/\{\{\s*(?:#(?:each|if|unless)\s+)?((?:facts|profile|calc)\.[\w.@]+)/g)) paths.add(m[1])
  const sources = facts.sources || {}
  return [...paths].sort().map((p) => {
    const key = p.replace(/^facts\./, '')
    const src = Object.entries(sources).find(([k]) => key === k || key.startsWith(k + '.') || k.startsWith(key + '.'))
    return { path: p, source: p.startsWith('profile.') ? 'Informations projet' : p.startsWith('calc.') ? 'calcul à partir des faits' : src?.[1] || 'faits collectés' }
  })
}

export async function getDocument(id, user) {
  const st = await state()
  const r = render(id, st, user, null)
  const last = latestVersion(r.doc)
  const markdown = last ? liveCartouche(last.markdown, r.doc) : r.markdown
  return {
    ok: true,
    doc: {
      id,
      title: r.entry.title,
      phase: r.entry.phase,
      ref: r.entry.ref,
      purpose: r.entry.purpose,
      audience: r.entry.audience,
      sections: r.entry.sections,
      status: r.doc.status,
      statusLabel: STATUS_LABEL[r.doc.status],
      version: last?.n || 0,
      updatedAt: last?.at || null,
      updatedBy: last?.by || null,
      kind: last?.kind || null,
      stale: stale(last, st.facts, st.profileHash, r.tpl),
      preview: !last,
      missing: last ? (last.missing || []) : r.missing,
      currentMissing: r.missing,
      review: r.doc.review,
      approval: r.doc.approval,
      templateOverridden: r.tpl.overridden,
    },
    markdown,
    html: markdownToHtml(markdown),
    sources: usedSources(r.tpl.source, st.facts),
  }
}

export async function generateDocument(id, user) {
  invalidateFacts()
  const st = await state()
  const current = loadDoc(id)
  const r = render(id, st, user, (latestVersion(current)?.n || 0) + 1)
  addVersion(id, {
    kind: 'generated',
    markdown: r.markdown,
    by: userName(user),
    factsHash: st.facts.hash,
    profileHash: st.profileHash,
    templateHash: r.tpl.hash,
    missing: r.missing,
  })
  return getDocument(id, user)
}

export async function generateAll(user) {
  const results = []
  for (const e of loadCatalog().documents) {
    try {
      const r = await generateDocument(e.id, user)
      results.push({ id: e.id, ok: true, version: r.doc.version, missing: r.doc.missing.length })
    } catch (err) {
      results.push({ id: e.id, ok: false, error: err.message })
    }
  }
  return { ok: true, results }
}

export async function editDocument(id, markdown, user) {
  if (!catalogEntry(id)) throw new HttpError(404, `Document inconnu : ${id}`)
  if (typeof markdown !== 'string' || !markdown.trim()) throw new HttpError(400, 'Contenu Markdown attendu.')
  if (markdown.length > 1_000_000) throw new HttpError(413, 'Document trop volumineux.')
  const last = latestVersion(loadDoc(id))
  if (!last) throw new HttpError(409, 'Générez le document avant de le modifier.')
  const missing = [...new Set([...markdown.matchAll(/\[À compléter : ([^\]—]+)/g)].map((m) => m[1].trim()))].map((label) => ({ field: '', label, step: '' }))
  addVersion(id, {
    kind: 'edited',
    markdown: markdown.replace(/\r\n/g, '\n'),
    by: userName(user),
    factsHash: last.factsHash,
    profileHash: last.profileHash,
    templateHash: last.templateHash,
    missing,
  })
  return getDocument(id, user)
}

export async function reviewDocumentById(id, user, { useAi = true } = {}) {
  const entry = catalogEntry(id)
  if (!entry) throw new HttpError(404, `Document inconnu : ${id}`)
  const doc = loadDoc(id)
  const version = latestVersion(doc)
  if (!version) throw new HttpError(409, 'Générez le document avant de le faire relire.')
  invalidateFacts()
  const st = await state()
  const review = await reviewDocument({
    entry,
    version,
    markdown: version.markdown,
    facts: st.facts,
    profile: st.profile,
    hashes: { profileHash: st.profileHash, templateHash: loadTemplate(id).hash },
    related: { plan: loadDoc('plan'), politique: loadDoc('politique') },
  }, { useAi, by: userName(user) })
  setReview(id, review)
  return { ok: true, review, status: loadDoc(id).status }
}

export async function approveDocument(id, user) {
  if (!catalogEntry(id)) throw new HttpError(404, `Document inconnu : ${id}`)
  const doc = setApproval(id, userName(user))
  if (!doc) throw new HttpError(409, 'Aucune version à approuver : générez le document.')
  return { ok: true, status: doc.status, approval: doc.approval }
}

export function listVersions(id) {
  if (!catalogEntry(id)) throw new HttpError(404, `Document inconnu : ${id}`)
  const doc = loadDoc(id)
  return {
    ok: true,
    approval: doc.approval,
    versions: doc.versions.map((v) => ({ n: v.n, at: v.at, by: v.by, kind: v.kind, factsHash: v.factsHash, missing: (v.missing || []).length, markdown: v.markdown })).reverse(),
  }
}

// --- exports ---------------------------------------------------------------

function fileBase(id, facts, n) {
  const key = String(facts.project?.key || 'projet').replace(/[^\w-]+/g, '')
  return `${key}-${id}${n ? `-v${n}` : ''}`
}

async function exportable(id, user) {
  const d = await getDocument(id, user)
  return { title: d.doc.title, markdown: d.markdown, version: d.doc.version, preview: d.doc.preview, updatedAt: d.doc.updatedAt }
}

/** .docx du livrable : au format du modèle Word de l'entreprise s'il a été déposé, sinon format standard. */
async function docxOf(entry, d, user, facts) {
  let model = null
  try {
    model = loadModel()
  } catch (e) {
    throw new HttpError(422, `Modèle Word de l'entreprise illisible : ${e.message}. Remplacez-le ou retirez-le (page Livrables).`)
  }
  if (!model) return markdownToDocx(d.markdown, { title: d.title, author: userName(user) })
  const cover = coverInfo({ entry, profile: await getProfileValues(), facts, version: d.version, date: d.updatedAt })
  try {
    return markdownToModelDocx(d.markdown, model, cover, { author: userName(user) })
  } catch (e) {
    throw new HttpError(422, `Export au format du modèle Word impossible : ${e.message}`)
  }
}

export async function exportDocument(id, format = 'docx', user) {
  const facts = await getFacts()
  const d = await exportable(id, user)
  const base = fileBase(id, facts, d.version)
  const footer = `${d.title} — ${facts.project?.name || facts.project?.key || ''} — généré par Wizard QA le ${new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}`
  if (format === 'md') return { filename: `${base}.md`, type: 'text/markdown; charset=utf-8', body: d.markdown }
  if (format === 'html') return { filename: `${base}.html`, type: 'text/html; charset=utf-8', body: printableHtml(d.markdown, { title: d.title, footer }) }
  if (format === 'docx') {
    return {
      filename: `${base}.docx`,
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      body: await docxOf(catalogEntry(id), d, user, facts),
    }
  }
  throw new HttpError(400, 'Format attendu : md, html ou docx.')
}

export async function exportPack(user) {
  const facts = await getFacts()
  const files = []
  const lines = ['Livrables de test — pack généré par Wizard QA', `Projet : ${facts.project?.name || facts.project?.key || '—'}`, `Date : ${new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}`, '']
  let k = 1
  for (const e of loadCatalog().documents) {
    const d = await exportable(e.id, user)
    const name = `${String(k++).padStart(2, '0')}-${e.id}`
    files.push({ name: `${name}.docx`, data: await docxOf(e, d, user, facts) })
    files.push({ name: `${name}.md`, data: d.markdown })
    files.push({ name: `${name}.html`, data: printableHtml(d.markdown, { title: e.title }) })
    lines.push(`${name} : ${e.title} — ${d.preview ? 'aperçu non enregistré (document jamais généré)' : `version ${d.version}`} (${STATUS_LABEL[loadDoc(e.id).status]})`)
  }
  files.unshift({ name: 'LISEZMOI.txt', data: lines.join('\r\n') + '\r\n' })
  return { filename: `${fileBase('livrables', facts)}.zip`, body: zipStore(files) }
}

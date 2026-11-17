/**
 * Pilotage : agrège l'état de chaque module pour l'accueil et le bandeau du shell.
 *   GET /api/dashboard/summary → indicateurs, parcours QA, couverture par épopée, actions prioritaires
 *   GET /api/dashboard/strip   → éléments du bandeau de statut
 * Chaque module est importé dynamiquement : un module absent ou en erreur ne casse pas l'accueil.
 */
import { getOnboardingState } from '../project-profile.mjs'

async function load(rel, fn, ...args) {
  try {
    const mod = await import(rel)
    return typeof mod[fn] === 'function' ? await mod[fn](...args) : null
  } catch {
    return null
  }
}

function pct(n, d) {
  return d ? Math.round((n / d) * 100) : 0
}

async function collect() {
  const [install, scan, stories, gherkin, perf, llm] = await Promise.all([
    load('../install/index.mjs', 'getInstallSummary'),
    load('../jira/stories.mjs', 'getScanInfo'),
    load('../jira/stories.mjs', 'listStories', {}),
    load('../gherkin/store.mjs', 'getGherkinIndex'),
    load('../perf/index.mjs', 'getPerfSummary'),
    load('../llm/index.mjs', 'getLlmStatus'),
  ])
  let onboarding = null
  try {
    onboarding = getOnboardingState()
  } catch {
    onboarding = null
  }
  return { install, scan, stories: Array.isArray(stories) ? stories : [], gherkin: gherkin || {}, perf, llm, onboarding }
}

function installFigures(install) {
  const comps = install?.components || []
  const required = comps.filter((c) => c.required)
  const ok = required.filter((c) => c.state === 'ok').length
  const missing = required.filter((c) => c.state !== 'ok')
  return { known: comps.length > 0, total: required.length, ok, missing, ready: Boolean(install?.ready), lastRun: install?.lastRun || null }
}

function storyFigures(stories, gherkin) {
  const withAc = stories.filter((s) => (s.acceptanceCriteria || []).length > 0).length
  const validated = stories.filter((s) => gherkin[s.key]?.status === 'validated').length
  const drafts = stories.filter((s) => gherkin[s.key]?.status === 'draft').length
  const byEpic = new Map()
  for (const s of stories) {
    const id = s.epic?.key || '—'
    const row = byEpic.get(id) || { key: s.epic?.key || null, label: s.epic?.summary || 'Sans épopée', total: 0, validated: 0, drafts: 0 }
    row.total += 1
    if (gherkin[s.key]?.status === 'validated') row.validated += 1
    if (gherkin[s.key]?.status === 'draft') row.drafts += 1
    byEpic.set(id, row)
  }
  return {
    total: stories.length,
    withAc,
    withoutAc: stories.length - withAc,
    validated,
    drafts,
    uncovered: stories.length - validated - drafts,
    coverage: pct(validated, stories.length),
    epics: [...byEpic.values()].sort((a, b) => b.total - a.total),
  }
}

function journey(f) {
  const step = (id, label, state, sub, href, cta) => ({ id, label, state, sub, href, cta })
  const st = []
  st.push(f.install.ready
    ? step('install', 'Poste prêt', 'done', `${f.install.ok}/${f.install.total} composants`, '/installation.html', 'Revoir')
    : step('install', 'Installer le poste', 'current', f.install.known ? `${f.install.missing.length} à installer` : 'À vérifier', '/installation.html?run=1', 'Tout installer'))
  st.push(f.scan
    ? step('knowledge', 'Prise de connaissance', 'done', `${f.stories.total} récits ${f.scan.source === 'demo' ? '(démo)' : ''}`.trim(), '/connaissance.html', 'Revoir')
    : step('knowledge', 'Prise de connaissance', 'todo', 'Scanner JIRA', '/connaissance.html#scan', 'Scanner'))
  const g = f.stories
  st.push(!g.total
    ? step('gherkin', 'Scénarios Gherkin', 'todo', 'Après le scan', '/recits.html', 'Ouvrir')
    : g.validated === g.total
      ? step('gherkin', 'Scénarios Gherkin', 'done', `${g.validated}/${g.total} validés`, '/recits.html', 'Revoir')
      : step('gherkin', 'Scénarios Gherkin', 'todo', `${g.validated}/${g.total} validés`, '/recits.html', 'Générer'))
  st.push(f.perf?.lastRun
    ? step('perf', 'Performance', f.perf.lastRun.status === 'failed' ? 'failed' : 'done', `Dernier run : ${f.perf.lastRun.status === 'failed' ? 'échec' : 'réussi'}`, '/perf.html', 'Ouvrir')
    : step('perf', 'Performance', 'todo', 'Aucun run', '/perf.html', 'Lancer'))
  st.push(step('xray', 'JIRA / Xray', 'todo', 'Relier les tests', '/hook-git.html', 'Configurer'))
  // Une seule étape « en cours » : la première non terminée.
  let current = false
  for (const s of st) {
    if (s.state === 'done') continue
    if (!current && s.state !== 'failed') {
      s.state = 'current'
      current = true
    } else if (s.state === 'current') {
      s.state = 'todo'
    }
  }
  return st
}

function actions(f) {
  const out = []
  if (!f.install.ready) {
    out.push({ tone: 'amber', icon: 'download', title: f.install.known ? `${f.install.missing.length} composant(s) requis à installer` : 'Vérifier le poste', detail: f.install.missing.slice(0, 4).map((c) => c.label).join(', ') || 'Lancez une vérification complète.', href: '/installation.html?run=1', cta: 'Installer' })
  }
  if (!f.scan) {
    out.push({ tone: 'blue', icon: 'compass', title: 'Aucun récit scanné', detail: 'Connectez JIRA ou utilisez les données de démonstration.', href: '/connaissance.html#scan', cta: 'Scanner' })
  }
  if (f.stories.withoutAc > 0) {
    out.push({ tone: 'amber', icon: 'alert', title: `${f.stories.withoutAc} récit(s) sans critère d'acceptation`, detail: 'À clarifier avec le Product Owner avant d’écrire les tests.', href: '/connaissance.html', cta: 'Voir' })
  }
  if (f.stories.drafts > 0) {
    out.push({ tone: 'purple', icon: 'edit', title: `${f.stories.drafts} scénario(s) Gherkin à relire`, detail: 'Relisez puis validez pour pouvoir les exporter.', href: '/recits.html', cta: 'Relire' })
  }
  if (f.stories.uncovered > 0 && f.scan) {
    out.push({ tone: 'mint', icon: 'wand', title: `${f.stories.uncovered} récit(s) sans scénario`, detail: 'Générez-les en lot avec l’assistant IA ou le modèle intégré.', href: '/recits.html', cta: 'Générer' })
  }
  if (f.perf?.lastRun?.status === 'failed') {
    out.push({ tone: 'red', icon: 'activity', title: 'Dernier test de charge en échec', detail: `${f.perf.lastRun.profileName || 'Profil'} — seuils non respectés.`, href: '/perf.html', cta: 'Analyser' })
  }
  if (!f.llm?.active) {
    out.push({ tone: 'grey', icon: 'sparkles', title: 'Aucun assistant IA branché', detail: 'Mode copier-coller actif. Branchez Copilot local pour générer directement.', href: '/ia.html', cta: 'Brancher' })
  }
  return out
}

async function summary() {
  const raw = await collect()
  const f = {
    install: installFigures(raw.install),
    stories: storyFigures(raw.stories, raw.gherkin),
    scan: raw.scan,
    perf: raw.perf,
    llm: raw.llm,
  }
  const project = raw.onboarding?.project || {}
  return {
    ok: true,
    project: {
      name: project.applicationLabel || raw.scan?.projectKey || '',
      tribu: project.tribu || '',
      squad: project.squad || '',
      needsOnboarding: Boolean(raw.onboarding?.needsOnboarding),
    },
    install: { ...f.install, missing: f.install.missing.map((c) => ({ id: c.id, label: c.label, state: c.state })) },
    stories: f.stories,
    scan: raw.scan,
    perf: raw.perf || null,
    llm: raw.llm ? { active: raw.llm.active || null, available: (raw.llm.providers || []).filter((p) => p.available && p.id !== 'manual').length } : null,
    journey: journey(f),
    actions: actions(f),
  }
}

export function register(router) {
  router.get('/api/dashboard/summary', () => summary())

  router.get('/api/dashboard/strip', async () => {
    const s = await summary()
    const items = []
    items.push(s.install.known
      ? { label: s.install.ready ? 'Poste prêt' : `Poste : ${s.install.missing.length} à installer`, tone: s.install.ready ? 'mint' : 'amber', href: '/installation.html', icon: 'download' }
      : { label: 'Poste : à vérifier', tone: 'amber', href: '/installation.html', icon: 'download' })
    items.push(s.scan
      ? { label: `${s.stories.total} récits${s.scan.source === 'demo' ? ' ◇ démo' : ''}`, tone: '', href: '/connaissance.html', icon: 'compass', title: `Scan du ${new Date(s.scan.scannedAt).toLocaleString('fr-FR')}` }
      : { label: 'JIRA non scanné', tone: 'amber', href: '/connaissance.html#scan', icon: 'compass' })
    if (s.stories.withoutAc) items.push({ label: `${s.stories.withoutAc} à clarifier`, tone: 'amber', href: '/connaissance.html', icon: 'alert' })
    if (s.stories.total) items.push({ label: `Gherkin ${s.stories.validated}/${s.stories.total}`, tone: s.stories.validated === s.stories.total ? 'mint' : '', href: '/recits.html', icon: 'listChecks' })
    if (s.perf?.lastRun) {
      const p95 = s.perf.lastRun.p95 != null ? ` · p95 ${Math.round(s.perf.lastRun.p95)} ms` : ''
      items.push({ label: `k6 ${s.perf.lastRun.status === 'failed' ? 'en échec' : 'réussi'}${p95}`, tone: s.perf.lastRun.status === 'failed' ? 'red' : 'mint', href: '/perf.html', icon: 'activity' })
    }
    if (s.perf?.running) items.push({ label: `${s.perf.running} run(s) en cours`, tone: 'mint', href: '/perf.html', icon: 'play' })
    items.push(s.llm?.active
      ? { label: `IA : ${s.llm.active.label}`, tone: 'mint', href: '/ia.html', icon: 'sparkles' }
      : { label: 'IA : copier-coller', tone: '', href: '/ia.html', icon: 'sparkles' })
    return { ok: true, items }
  })
}

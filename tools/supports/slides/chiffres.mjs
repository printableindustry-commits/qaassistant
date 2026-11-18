// Relève les chiffres du jeu de démonstration via l'API (serveur lancé, démo chargée ou --demo)
// et les écrit dans tools/supports/slides/chiffres-demo.json, lu par build_slides.py.
// Usage : SUPPORTS_BASE=http://127.0.0.1:4003 node tools/supports/slides/chiffres.mjs [--demo]
import fs from 'node:fs'
import path from 'node:path'
import { RACINE, BASE, connexion, chargerDemo } from '../commun.mjs'

const sid = await connexion()
if (process.argv.includes('--demo')) await chargerDemo(sid)
const api = async (route) => {
  const r = await fetch(BASE + route, { headers: { cookie: 'qa_sid=' + sid } })
  if (!r.ok) throw new Error(route + ' : ' + r.status)
  return r.json()
}
const statut = await api('/api/demo/status')
const vue = await api('/api/jira/overview')
const { facts } = await api('/api/livrables/facts')
const { runs } = await api('/api/perf/runs')

const camp = [...facts.campaigns].sort((a, b) => a.at.localeCompare(b.at))
const chiffres = {
  releve: new Date().toISOString(),
  source: 'API ' + ['/api/demo/status', '/api/jira/overview', '/api/livrables/facts', '/api/perf/runs'].join(', '),
  projet: { cle: facts.project.key, nom: facts.project.name, organisme: vue.project?.tribu || '' },
  recits: { total: vue.counts.stories, epopees: vue.counts.epics, avecCriteres: vue.counts.withCriteria, sansCriteres: vue.counts.withoutCriteria, aClarifier: vue.counts.toClarify, questions: vue.counts.questions },
  tri: facts.triage,
  gherkin: facts.gherkin,
  automatisation: { sessions: facts.automation.sessions.total, validees: facts.automation.sessions.validated, etapes: (facts.stories.find(s => s.automation?.[0]?.validated)?.automation[0].steps) || null },
  xray: { simules: facts.xray.simulated, plans: facts.xray.plans },
  campagnes: { nombre: camp.length, total: camp.at(-1)?.total, reussis: camp.map(c => c.passed) },
  anomalies: { total: facts.defects.length, corrigees: facts.defects.filter(d => /corrig/.test(d.status)).length },
  livrables: { total: statut.counts.livrables, relus: statut.counts.livrablesReviewed, approuves: statut.counts.livrablesApproved },
  perf: { runs: runs.length, seuilsFranchis: runs.filter(r => r.status === 'failed' || r.detailedStatus === 'threshold').length, dernierP95: facts.perf.last?.p95 ?? null },
  compteurs: statut.counts
}
const cible = path.join(RACINE, 'tools', 'supports', 'slides', 'chiffres-demo.json')
fs.writeFileSync(cible, JSON.stringify(chiffres, null, 2) + '\n')
console.log(JSON.stringify(chiffres, null, 2))

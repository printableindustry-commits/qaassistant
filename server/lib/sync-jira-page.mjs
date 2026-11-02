import fs from 'fs'
import path from 'path'
import { getHookMeta } from './hook-plan-api.mjs'

function extractGaps(output) {
  const gaps = []
  for (const line of String(output || '').split('\n')) {
    const t = line.trim()
    if (!t) continue
    if (
      /ERREUR|WARN|orphelin|écart|doublon|création|serait supprimé|retrait|absent du scan/i.test(t)
      || /^\+\s*Création/i.test(t)
      || /^-\s+P\d/i.test(t)
    ) {
      gaps.push(t)
    }
  }
  return [...new Set(gaps)].slice(0, 40)
}

function parseDryRunPreview(output, meta) {
  const ticketsCreate = []
  const ticketsDelete = []
  const seenCreate = new Set()
  const seenDelete = new Set()

  for (const line of String(output || '').split('\n')) {
    const create = line.match(/^\s*\+ Création \[([^\]]+)\] : (.+)/)
    if (create) {
      const key = `${create[1]}|${create[2]}`
      if (!seenCreate.has(key)) {
        seenCreate.add(key)
        ticketsCreate.push({ testId: create[1], summary: create[2].trim() })
      }
    }
    const orphan = line.match(/^\s*- (P[\w-]+) \[([^\]]+)\] : "(.*)"/)
    if (orphan) {
      const key = orphan[1]
      if (!seenDelete.has(key)) {
        seenDelete.add(key)
        ticketsDelete.push({ key: orphan[1], testId: orphan[2], summary: orphan[3], reason: 'orphelin' })
      }
    }
    const dupe = line.match(/^\s*- Doublon \[([^\]]+)\] : (P[\w-]+)/)
    if (dupe) {
      const key = dupe[2]
      if (!seenDelete.has(key)) {
        seenDelete.add(key)
        ticketsDelete.push({ key: dupe[2], testId: dupe[1], reason: 'doublon' })
      }
    }
  }

  const folders = meta.plans.map(p => p.folder)
  const testPlans = meta.plans.map(p => ({ plan_key: p.plan_key, folder: p.folder }))
  return { folders, ticketsDelete, ticketsCreate, testPlans }
}

function formatAnalyzeTerminalOutput(plans) {
  const lines = [
    '=== Étape 1 — Analyse des écarts (Local ↔ JIRA / Xray) ===',
    '',
  ]
  for (const p of plans) {
    lines.push(`── ${p.plan_key} (${p.folder}) ──`)
    lines.push(`Global : ${String(p.status || 'ko').toUpperCase()} | JIRA : ${String(p.jira?.status || 'ko').toUpperCase()} | Xray : ${String(p.xray?.status || 'ko').toUpperCase()}`)
    if (p.gaps?.length) {
      lines.push('Écarts détectés :')
      for (const g of p.gaps) lines.push(`  • ${g}`)
    }
    if (p.output) {
      lines.push('', '--- Sortie scripts ---', p.output)
    }
    lines.push('')
  }
  return lines.join('\n').trimEnd()
}

/** Analyse JIRA / Xray (dry-run) — statut OK, KO ou Absent par plan. */
export async function analyzeJiraXrayPlans(hookDir, runScript) {
  const meta = getHookMeta(hookDir)
  const plans = []

  for (const plan of meta.plans) {
    const folderPath = path.join(meta.repoRoot, plan.folder)
    if (!fs.existsSync(folderPath)) {
      plans.push({
        folder: plan.folder,
        plan_key: plan.plan_key,
        status: 'absent',
        jira: { status: 'absent', ok: false, code: 1 },
        xray: { status: 'absent', ok: false, code: 1 },
        gaps: [`Dossier local absent : ${plan.folder}`],
        output: '',
      })
      continue
    }

    const jira = await runScript([
      'scripts/sync-jira.mjs',
      '--folder', plan.folder,
      '--plan-key', plan.plan_key,
      '--dry-run',
    ])
    const xray = await runScript([
      'scripts/xray-sync.mjs',
      '--folder', plan.folder,
      '--plan-key', plan.plan_key,
      '--dry-run',
    ])

    const jiraGaps = extractGaps(jira.output)
    const xrayGaps = extractGaps(xray.output)
    const jiraOk = jira.code === 0 && !jiraGaps.some(g => /ERREUR/i.test(g))
    const xrayOk = xray.code === 0 && !xrayGaps.some(g => /ERREUR/i.test(g))
    const jiraStatus = jiraOk ? 'ok' : 'ko'
    const xrayStatus = xrayOk ? 'ok' : 'ko'
    const status = jiraOk && xrayOk ? 'ok' : 'ko'

    plans.push({
      folder: plan.folder,
      plan_key: plan.plan_key,
      status,
      jira: { status: jiraStatus, ok: jiraOk, code: jira.code },
      xray: { status: xrayStatus, ok: xrayOk, code: xray.code },
      gaps: [...jiraGaps, ...xrayGaps],
      output: `${jira.output || ''}\n${xray.output || ''}`.trim(),
    })
  }

  const ok = plans.length > 0 && plans.every(p => p.status === 'ok')
  const output = formatAnalyzeTerminalOutput(plans)
  return { ok, plans, output }
}

/** Aperçu dry-run complet pour la confirmation avant écriture. */
export async function previewLocalSync(hookDir, runScript) {
  const meta = getHookMeta(hookDir)
  const result = await runScript(['hook-run.mjs', '--force', '--dry-run'])
  const preview = parseDryRunPreview(result.output || '', meta)
  return {
    ok: result.code === 0,
    code: result.code,
    output: result.output || '',
    ...preview,
  }
}

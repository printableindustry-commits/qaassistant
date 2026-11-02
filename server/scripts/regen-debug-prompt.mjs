#!/usr/bin/env node
/**
 * Régénère un prompt DEBUG à partir d'une session ou du dernier cas d'un scope.
 *
 *   node server/scripts/regen-debug-prompt.mjs --session <id>
 *   node server/scripts/regen-debug-prompt.mjs --scope hook-git --last
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { buildFullDebugPrompt } from '../lib/debug-prompt-api.mjs'
import { loadSessionManifest } from '../lib/debug-session.mjs'
import { DEBUG_MEMORY_REL } from '../lib/debug-agent-memory.mjs'
import { REPO_ROOT } from '../lib/paths.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function parseArgs(argv) {
  const out = { session: '', scope: '', last: false, write: false }
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--session') out.session = argv[++i]
    else if (argv[i] === '--scope') out.scope = argv[++i]
    else if (argv[i] === '--last') out.last = true
    else if (argv[i] === '--write') out.write = true
  }
  return out
}

function findLastSessionIdForScope(scope) {
  const root = path.join(REPO_ROOT, '.wizard-qa/conf/debug-sessions')
  if (!fs.existsSync(root)) return null
  const dirs = fs.readdirSync(root).filter((d) => {
    const manifest = path.join(root, d, 'manifest.json')
    if (!fs.existsSync(manifest)) return false
    try {
      return JSON.parse(fs.readFileSync(manifest, 'utf8')).scope === scope
    } catch {
      return false
    }
  })
  if (!dirs.length) return null
  dirs.sort((a, b) => {
    const ma = JSON.parse(fs.readFileSync(path.join(root, a, 'manifest.json'), 'utf8'))
    const mb = JSON.parse(fs.readFileSync(path.join(root, b, 'manifest.json'), 'utf8'))
    return String(mb.updatedAt || mb.startedAt).localeCompare(String(ma.updatedAt || ma.startedAt))
  })
  return dirs[0]
}

const args = parseArgs(process.argv)
let sessionId = args.session
if (!sessionId && args.scope && args.last) {
  sessionId = findLastSessionIdForScope(args.scope)
}

if (!sessionId) {
  console.error('Usage: --session <id>  OR  --scope <scope> --last')
  process.exit(1)
}

const manifest = loadSessionManifest(sessionId)
if (!manifest) {
  console.error(`Session introuvable : ${sessionId}`)
  process.exit(1)
}

const enrichments = (manifest.enrichments || []).map((e) => e.text).join('\n')
const built = buildFullDebugPrompt({
  scope: manifest.scope,
  userEnrichment: enrichments,
  title: `Regénération DEBUG — ${manifest.scope} (session ${sessionId})`,
})

const outPath = path.join(REPO_ROOT, '.wizard-qa/conf/debug-sessions', sessionId, 'prompt-regen.md')
if (args.write) {
  fs.writeFileSync(outPath, built.prompt, 'utf8')
  console.log(`Écrit : ${outPath}`)
} else {
  console.log(built.prompt)
}

console.error(`\n--- tokens ~${built.tokenEstimate} | scope ${manifest.scope} | mémoire ${path.join(DEBUG_MEMORY_REL, manifest.scope + '.jsonl')} ---`)

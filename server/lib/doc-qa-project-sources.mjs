import fs from 'fs'
import path from 'path'
import {
  DOC_REPORTS_DIR,
  CONF_DIR,
  HOOK_DIR,
  PATH_CFG,
  REPO_ROOT,
} from './paths.mjs'

const MAX_SNIPPET = 5000

function readSnippet(abs, max = MAX_SNIPPET) {
  if (!abs || !fs.existsSync(abs)) return null
  try {
    const raw = fs.readFileSync(abs, 'utf8')
    const content = raw.length <= max ? raw : `…(tronqué)\n${raw.slice(-max)}`
    return {
      relative: path.relative(REPO_ROOT, abs).replace(/\\/g, '/'),
      content,
    }
  } catch {
    return null
  }
}

export function loadProjectSourcesForDocPrompt() {
  const entries = [
    { key: 'Snapshot projet (MD)', abs: path.join(DOC_REPORTS_DIR, PATH_CFG.snapshotMdFile) },
    { key: 'Snapshot projet (JSON)', abs: path.join(DOC_REPORTS_DIR, PATH_CFG.snapshotJsonFile) },
    { key: 'Écarts documentation', abs: path.join(DOC_REPORTS_DIR, PATH_CFG.docGapsFile) },
    { key: 'Inventaire documentation', abs: path.join(DOC_REPORTS_DIR, PATH_CFG.docInventoryFile) },
    { key: 'Questionnaire stack', abs: path.join(CONF_DIR, 'stack-questionnaire.conf.json') },
    { key: 'Configuration Cypress', abs: path.join(CONF_DIR, 'cypress-install.conf.json') },
    { key: 'Configuration Playwright', abs: path.join(CONF_DIR, 'playwright-install.conf.json') },
    { key: 'Configuration hooks JIRA', abs: path.join(HOOK_DIR, PATH_CFG.hooksConfFile || 'hooks.conf') },
  ]
  return entries
    .map((e) => {
      const snip = readSnippet(e.abs)
      return snip ? { name: e.key, ...snip } : null
    })
    .filter(Boolean)
}

export function formatSourcesBlock(sources = []) {
  if (!sources.length) {
    return '_Aucune source projet détectée sur le disque — ne pas inventer de données._'
  }
  return sources.map((s) => `### ${s.name}\n\`${s.relative}\`\n\n\`\`\`\n${s.content}\n\`\`\``).join('\n\n')
}

export function listAvailableSourceNames(sources = []) {
  return sources.map((s) => s.name)
}

import fs from 'fs'
import path from 'path'
import { getPathsForApi } from './paths.mjs'
import { pathToFileURL } from 'url'
import { buildTerminalModeCommentBlock } from './terminal-modes.mjs'

const SECTION_RE = /^\[[^[\]]+\]$/

function parseLine(raw) {
  const t = raw.trim()
  if (!t) return { type: 'empty' }
  if (t.startsWith('#')) return { type: 'comment', raw }
  const eq = t.indexOf('=')
  if (eq > 0) {
    return { type: 'kv', key: t.slice(0, eq).trim(), value: t.slice(eq + 1).trim() }
  }
  return { type: 'comment', raw }
}

/** Déplace les commentaires de fin (exemple) hors du dernier [plan] vers le pied de fichier */
function extractTrailingFooter(sections) {
  if (!sections.length) return []
  const last = sections[sections.length - 1]
  let lastKvIdx = -1
  for (let i = last.lines.length - 1; i >= 0; i--) {
    if (last.lines[i].type === 'kv') {
      lastKvIdx = i
      break
    }
  }
  if (lastKvIdx < 0 || lastKvIdx >= last.lines.length - 1) return []
  const trailing = last.lines.slice(lastKvIdx + 1)
  if (!trailing.every(l => l.type === 'comment' || l.type === 'empty')) return []
  if (trailing.filter(l => l.type === 'comment').length < 3) return []

  last.lines = last.lines.slice(0, lastKvIdx + 1)
  return trailing.map(l => (l.type === 'comment' ? l.raw : ''))
}

export function parseHooksConf(content) {
  const lines = content.split(/\r?\n/)
  const headerComments = []
  const sections = []
  let i = 0

  while (i < lines.length) {
    if (SECTION_RE.test(lines[i].trim())) break
    headerComments.push(lines[i])
    i++
  }

  while (i < lines.length) {
    const trimmed = lines[i].trim()
    if (!SECTION_RE.test(trimmed)) {
      i++
      continue
    }

    const section = { header: trimmed, type: trimmed.slice(1, -1), lines: [] }
    i++
    while (i < lines.length) {
      if (SECTION_RE.test(lines[i].trim())) break
      section.lines.push(parseLine(lines[i]))
      i++
    }
    sections.push(section)
  }

  const footerComments = extractTrailingFooter(sections)
  return { headerComments, sections, footerComments }
}

export function serializeHooksConf(model) {
  const out = [...model.headerComments]
  if (out.length && model.sections.length) out.push('')

  model.sections.forEach((sec, si) => {
    if (si > 0) out.push('')
    out.push(sec.header)
    for (const line of sec.lines) {
      if (line.type === 'empty') out.push('')
      else if (line.type === 'comment') out.push(line.raw ?? '')
      else if (line.type === 'kv') out.push(`${line.key}=${line.value}`)
    }
  })

  if (model.footerComments?.length) {
    if (out.length) out.push('')
    out.push(...model.footerComments)
  }

  const text = out.join('\n')
  return text.endsWith('\n') ? text : `${text}\n`
}

function defaultsKvLines(defaultsSec) {
  if (!defaultsSec) return []
  return defaultsSec.lines.filter(l => l.type === 'kv')
}

export function buildEmptyHooksConfModel(sourceParsed) {
  const defaultsSec = sourceParsed?.sections?.find(s => s.type === 'defaults')
  const kvLines = defaultsKvLines(defaultsSec)
  const terminalMode = kvLines.find(l => l.key === 'terminal_mode')?.value || 'B'

  const headerComments = [
    '# hooks.conf — Paramétrage du hook Git JIRA / Xray',
    '# Fichier minimal généré par Wizard QA Assistant (sans [suite] ni [plan])',
    '# ─────────────────────────────────────────────────────────────────────────────',
    '# Ajoutez des blocs [suite] et [plan] ou utilisez « Créer dossier VS Code ».',
    '',
  ]

  const defaultsLines = [
    ...kvLines.filter(l => l.key !== 'terminal_mode'),
    { type: 'empty' },
    ...buildTerminalModeCommentBlock().map(raw => ({ type: 'comment', raw })),
    { type: 'kv', key: 'terminal_mode', value: terminalMode },
  ]

  return {
    headerComments,
    sections: [{ header: '[defaults]', type: 'defaults', lines: defaultsLines }],
    footerComments: [],
  }
}

export function readEmptyHooksConfTemplate(hookDir) {
  let sourceParsed = { headerComments: [], sections: [], footerComments: [] }
  const confPath = path.join(hookDir, 'hooks.conf')
  if (fs.existsSync(confPath)) {
    sourceParsed = parseHooksConf(fs.readFileSync(confPath, 'utf8'))
  } else {
    sourceParsed.sections.push({
      header: '[defaults]',
      type: 'defaults',
      lines: [
        { type: 'kv', key: 'project', value: 'P0326' },
        { type: 'kv', key: 'label', value: 'TR_Cypress' },
        { type: 'kv', key: 'exclude_dirs', value: '_legacy' },
        { type: 'kv', key: 'jira_indexation_delay_sec', value: '9' },
        { type: 'kv', key: 'suite_link_type', value: 'Relates' },
        { type: 'kv', key: 'terminal_mode', value: 'B' },
      ],
    })
  }
  const parsed = buildEmptyHooksConfModel(sourceParsed)
  const content = serializeHooksConf(parsed)
  return { parsed, content, bare: true }
}

export async function writeEmptyHooksConf(hookDir) {
  const { parsed, content } = readEmptyHooksConfTemplate(hookDir)
  return saveHooksConf(hookDir, { parsed, content, allowCreate: true })
}

export function validateHooksConfModel(model) {
  const defaults = model.sections.find(s => s.type === 'defaults')
  if (!defaults) throw new Error('Section [defaults] obligatoire')

  for (const plan of model.sections.filter(s => s.type === 'plan')) {
    const kv = Object.fromEntries(
      plan.lines.filter(l => l.type === 'kv').map(l => [l.key, l.value]),
    )
    if (!kv.folder || !kv.plan_key) {
      throw new Error('[plan] incomplet : folder et plan_key requis')
    }
  }

  for (const suite of model.sections.filter(s => s.type === 'suite')) {
    const kv = Object.fromEntries(
      suite.lines.filter(l => l.type === 'kv').map(l => [l.key, l.value]),
    )
    if (!kv.suite_key) throw new Error('[suite] : suite_key requis')
  }

  return true
}

export function readHooksConf(hookDir) {
  const confPath = path.join(hookDir, 'hooks.conf')
  if (!fs.existsSync(confPath)) {
    throw new Error(`hooks.conf introuvable : ${confPath}`)
  }
  const content = fs.readFileSync(confPath, 'utf8')
  const parsed = parseHooksConf(content)
  const lineCount = content.split(/\r?\n/).length
  return {
    path: confPath,
    displayPath: getPathsForApi().hooksConfPath,
    content,
    parsed,
    stats: {
      lines: lineCount,
      sections: parsed.sections.length,
      plans: parsed.sections.filter(s => s.type === 'plan').length,
      suites: parsed.sections.filter(s => s.type === 'suite').length,
      defaultsKeys: parsed.sections.find(s => s.type === 'defaults')
        ?.lines.filter(l => l.type === 'kv').length ?? 0,
    },
  }
}

export async function saveHooksConf(hookDir, { content, parsed, allowCreate = false } = {}) {
  const confPath = path.join(hookDir, 'hooks.conf')
  const exists = fs.existsSync(confPath)
  if (!exists && !allowCreate) throw new Error(`hooks.conf introuvable : ${confPath}`)

  const nextContent = content ?? serializeHooksConf(parsed)
  const model = parsed ?? parseHooksConf(nextContent)
  validateHooksConfModel(model)

  const backupPath = `${confPath}.bak`
  const previous = exists ? fs.readFileSync(confPath, 'utf8') : ''
  if (exists) fs.writeFileSync(backupPath, previous, 'utf8')

  try {
    fs.writeFileSync(confPath, nextContent, 'utf8')
    const configModule = path.join(hookDir, 'lib', 'config.mjs')
    const { loadHookConfig } = await import(pathToFileURL(configModule).href)
    loadHookConfig(confPath)
  } catch (e) {
    if (exists) {
      fs.writeFileSync(confPath, previous, 'utf8')
      throw new Error(`hooks.conf invalide — backup restauré : ${e.message}`)
    }
    if (fs.existsSync(confPath)) fs.unlinkSync(confPath)
    throw new Error(`hooks.conf invalide — fichier non créé : ${e.message}`)
  }

  return {
    ok: true,
    path: confPath,
    backupPath,
    content: nextContent,
    parsed: parseHooksConf(nextContent),
  }
}

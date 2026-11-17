/**
 * Conversion des descriptions JIRA en texte brut lisible, en gardant titres et listes :
 *   adfToText(doc)    — Atlassian Document Format (JIRA Cloud, API v3)
 *   wikiToText(text)  — wiki markup (JIRA Server / Data Center, API v2)
 *   fieldToText(v)    — valeur de champ quelconque (ADF, chaîne, tableau, objet option)
 * Conventions de sortie : titres « # Titre », puces « - », listes numérotées « 1. », tableaux « a | b ».
 */

// ---------------------------------------------------------------- ADF

function inlineText(nodes = []) {
  return nodes.map((n) => {
    switch (n.type) {
      case 'text': return n.text || ''
      case 'hardBreak': return '\n'
      case 'mention': return n.attrs?.text || ''
      case 'emoji': return n.attrs?.text || n.attrs?.shortName || ''
      case 'date': return n.attrs?.timestamp ? new Date(Number(n.attrs.timestamp)).toISOString().slice(0, 10) : ''
      case 'status': return n.attrs?.text ? `[${n.attrs.text}]` : ''
      case 'inlineCard': return n.attrs?.url || ''
      default: return n.content ? inlineText(n.content) : ''
    }
  }).join('')
}

function listLines(node, depth, ordered) {
  const lines = []
  const indent = '  '.repeat(depth)
  ;(node.content || []).forEach((item, i) => {
    const marker = ordered ? `${(node.attrs?.order || 1) + i}.` : '-'
    let first = true
    for (const child of item.content || []) {
      if (child.type === 'bulletList' || child.type === 'orderedList') {
        lines.push(...listLines(child, depth + 1, child.type === 'orderedList'))
        continue
      }
      for (const line of blockLines(child, depth + 1)) {
        lines.push(first ? `${indent}${marker} ${line}` : `${indent}  ${line}`)
        first = false
      }
    }
  })
  return lines
}

function blockLines(node, depth = 0) {
  switch (node.type) {
    case 'paragraph': return inlineText(node.content).split('\n')
    case 'heading': return [`${'#'.repeat(node.attrs?.level || 2)} ${inlineText(node.content)}`]
    case 'bulletList': return listLines(node, depth, false)
    case 'orderedList': return listLines(node, depth, true)
    case 'codeBlock': return inlineText(node.content).split('\n')
    case 'blockquote': return (node.content || []).flatMap((c) => blockLines(c, depth)).map((l) => `> ${l}`)
    case 'rule': return ['']
    case 'table':
      return (node.content || []).map((row) => (row.content || [])
        .map((cell) => (cell.content || []).flatMap((c) => blockLines(c, depth)).join(' ').trim())
        .join(' | '))
    case 'mediaSingle':
    case 'mediaGroup':
      return []
    default:
      if (node.content) return node.content.flatMap((c) => blockLines(c, depth))
      return node.text ? [node.text] : []
  }
}

export function adfToText(doc) {
  if (!doc || typeof doc !== 'object') return ''
  const blocks = (doc.content || []).map((b) => blockLines(b).join('\n'))
  return tidy(blocks.join('\n\n'))
}

// ---------------------------------------------------------------- wiki markup

function wikiInline(line) {
  return line
    .replace(/\{color(?::[^}]*)?\}/g, '')
    .replace(/\[([^|\]]+)\|([^\]]+)\]/g, '$1')
    .replace(/\[(https?:[^\]]+)\]/g, '$1')
    .replace(/\[~([^\]]+)\]/g, '@$1')
    .replace(/!([^!\s|]+)(\|[^!]*)?!/g, '')
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1$2')
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,;:!?]|$)/g, '$1$2')
    .replace(/(^|[\s(])\+([^+\n]+)\+(?=[\s).,;:!?]|$)/g, '$1$2')
    .replace(/\{\{([^}]+)\}\}/g, '$1')
    .replace(/\\\\/g, '\n')
}

export function wikiToText(text) {
  if (!text) return ''
  const out = []
  const counters = []
  let inCode = false
  for (const raw of String(text).replace(/\r\n?/g, '\n').split('\n')) {
    const fence = raw.match(/^\s*\{(code|noformat|quote|panel)(?::([^}]*))?\}\s*$/)
    if (fence) {
      if (fence[1] === 'code' || fence[1] === 'noformat') inCode = !inCode
      const title = fence[2]?.match(/title=([^|]+)/)
      if (title) out.push(`## ${title[1].trim()}`)
      continue
    }
    if (inCode) { out.push(raw); continue }
    const heading = raw.match(/^\s*h([1-6])\.\s+(.*)$/)
    if (heading) { out.push(`${'#'.repeat(Number(heading[1]))} ${wikiInline(heading[2])}`); counters.length = 0; continue }
    const list = raw.match(/^\s*([*#-]+)\s+(.*)$/)
    if (list && !/^-{4,}$/.test(raw.trim())) {
      const depth = list[1].length - 1
      const ordered = list[1].endsWith('#')
      counters.length = depth + 1
      counters[depth] = ordered ? (counters[depth] || 0) + 1 : 0
      const marker = ordered ? `${counters[depth]}.` : '-'
      out.push(`${'  '.repeat(depth)}${marker} ${wikiInline(list[2])}`)
      continue
    }
    counters.length = 0
    if (/^\s*-{4,}\s*$/.test(raw)) { out.push(''); continue }
    if (/^\s*\|\|/.test(raw)) { out.push(raw.trim().replace(/^\|\||\|\|$/g, '').split('||').map((c) => wikiInline(c.trim())).join(' | ')); continue }
    if (/^\s*\|/.test(raw)) { out.push(raw.trim().replace(/^\||\|$/g, '').split('|').map((c) => wikiInline(c.trim())).join(' | ')); continue }
    out.push(wikiInline(raw.replace(/^\s*bq\.\s+/, '> ')))
  }
  return tidy(out.join('\n'))
}

// ---------------------------------------------------------------- champ quelconque

export function fieldToText(value) {
  if (value == null) return ''
  if (typeof value === 'string') return wikiToText(value)
  if (Array.isArray(value)) return value.map((v) => `- ${fieldToText(v)}`).join('\n')
  if (typeof value === 'object') {
    if (value.type === 'doc') return adfToText(value)
    return String(value.value ?? value.name ?? value.displayName ?? '')
  }
  return String(value)
}

function tidy(text) {
  return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

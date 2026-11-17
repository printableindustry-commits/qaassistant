/**
 * Rendu des livrables : Markdown → blocs → HTML (fragment ou page imprimable A4).
 * Sous-ensemble pris en charge : titres, paragraphes, listes (puces / numérotées, imbrication par indentation),
 * tableaux GFM, citations, blocs de code, séparateurs, gras, italique, code en ligne, liens.
 * Tout le texte est échappé ; les liens n'acceptent que http(s), mailto, ancres et chemins relatifs.
 * Les blocs (parseMarkdown) servent aussi à la génération DOCX (docx.mjs).
 */

// --- analyse en ligne ------------------------------------------------------

/** Texte en ligne → segments [{ text, b, i, code, href }]. */
export function parseInline(src, style = {}) {
  const runs = []
  let buf = ''
  const flush = () => {
    if (buf) runs.push({ text: buf, ...style })
    buf = ''
  }
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    const rest = src.slice(i)
    if (ch === '\\' && i + 1 < src.length && /[\\`*_[\]()#|!>-]/.test(src[i + 1])) {
      buf += src[i + 1]
      i += 2
      continue
    }
    if (ch === '`') {
      const end = src.indexOf('`', i + 1)
      if (end > i) {
        flush()
        runs.push({ text: src.slice(i + 1, end), ...style, code: true })
        i = end + 1
        continue
      }
    }
    let m
    if ((m = rest.match(/^\*\*(.+?)\*\*/)) || (m = rest.match(/^__(.+?)__/))) {
      flush()
      runs.push(...parseInline(m[1], { ...style, b: true }))
      i += m[0].length
      continue
    }
    if ((m = rest.match(/^\*(?!\s)(.+?)\*/)) || (/[\s(]|^$/.test(src[i - 1] || '') && (m = rest.match(/^_(?!\s)(.+?)_(?![\w])/)))) {
      flush()
      runs.push(...parseInline(m[1], { ...style, i: true }))
      i += m[0].length
      continue
    }
    if ((m = rest.match(/^\[([^\]]+)\]\(([^)\s]+)\)/))) {
      flush()
      const href = safeHref(m[2])
      runs.push(...parseInline(m[1], href ? { ...style, href } : style))
      i += m[0].length
      continue
    }
    buf += ch
    i++
  }
  flush()
  return runs
}

function safeHref(url) {
  return /^(https?:\/\/|mailto:|#|\.{0,2}\/)/i.test(url) || /^[\w./-]+$/.test(url) ? url : null
}

// --- analyse des blocs -----------------------------------------------------

const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/

function splitRow(line) {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  const cells = []
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') {
      cur += '\\|'
      i++
    } else if (s[i] === '|') {
      cells.push(cur.trim())
      cur = ''
    } else cur += s[i]
  }
  cells.push(cur.trim())
  return cells
}

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/

/** Markdown → [{ type: heading|paragraph|list|table|quote|code|hr, … }]. */
export function parseMarkdown(md) {
  const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n')
  const blocks = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }
    let m
    if ((m = line.match(/^```(.*)$/))) {
      const buf = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i++])
      i++
      blocks.push({ type: 'code', text: buf.join('\n') })
      continue
    }
    if ((m = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/))) {
      blocks.push({ type: 'heading', level: m[1].length, text: m[2], inlines: parseInline(m[2]) })
      i++
      continue
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ type: 'hr' })
      i++
      continue
    }
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      const header = splitRow(line)
      const align = splitRow(lines[i + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : 'left'))
      i += 2
      const rows = []
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(splitRow(lines[i++]))
      blocks.push({
        type: 'table',
        align,
        header: header.map((c) => parseInline(c)),
        rows: rows.map((r) => header.map((_, k) => parseInline(r[k] || ''))),
      })
      continue
    }
    if (line.startsWith('>')) {
      const buf = []
      while (i < lines.length && lines[i].startsWith('>')) buf.push(lines[i++].replace(/^>\s?/, ''))
      blocks.push({ type: 'quote', blocks: parseMarkdown(buf.join('\n')) })
      continue
    }
    if (LIST_ITEM.test(line)) {
      const items = []
      const ordered = /\d/.test(line.match(LIST_ITEM)[2])
      while (i < lines.length && (m = lines[i].match(LIST_ITEM))) {
        const level = Math.min(Math.floor(m[1].replace(/\t/g, '  ').length / 2), 3)
        let text = m[3]
        i++
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !LIST_ITEM.test(lines[i])) text += ' ' + lines[i++].trim()
        items.push({ level, ordered: /\d/.test(m[2]), inlines: parseInline(text) })
      }
      blocks.push({ type: 'list', ordered, items })
      continue
    }
    const buf = [line.trim()]
    i++
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|>)/.test(lines[i]) && !LIST_ITEM.test(lines[i]) &&
      !(lines[i].includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]))) {
      buf.push(lines[i++].trim())
    }
    blocks.push({ type: 'paragraph', inlines: parseInline(buf.join(' ')) })
  }
  return blocks
}

// --- HTML ------------------------------------------------------------------

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

function inlineHtml(runs) {
  return runs.map((r) => {
    let h = escapeHtml(r.text)
    if (r.code) h = `<code>${h}</code>`
    if (r.i) h = `<em>${h}</em>`
    if (r.b) h = `<strong>${h}</strong>`
    if (/^\[À compléter/.test(r.text)) h = `<mark class="a-completer">${h}</mark>`
    if (r.href) h = `<a href="${escapeHtml(r.href)}"${/^https?:/i.test(r.href) ? ' target="_blank" rel="noopener"' : ''}>${h}</a>`
    return h
  }).join('')
}

function slug(text) {
  return String(text).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function listHtml(items) {
  let html = ''
  const stack = []
  for (const it of items) {
    while (stack.length > it.level + 1) html += `</li></${stack.pop()}>`
    if (stack.length === it.level + 1) html += '</li>'
    while (stack.length < it.level + 1) {
      const tag = it.ordered ? 'ol' : 'ul'
      html += `<${tag}>`
      stack.push(tag)
    }
    html += `<li>${inlineHtml(it.inlines)}`
  }
  while (stack.length) html += `</li></${stack.pop()}>`
  return html
}

export function blocksToHtml(blocks) {
  return blocks.map((b) => {
    switch (b.type) {
      case 'heading': return `<h${b.level} id="${slug(b.text)}">${inlineHtml(b.inlines)}</h${b.level}>`
      case 'paragraph': return `<p>${inlineHtml(b.inlines)}</p>`
      case 'list': return listHtml(b.items)
      case 'code': return `<pre><code>${escapeHtml(b.text)}</code></pre>`
      case 'hr': return '<hr>'
      case 'quote': return `<blockquote>${blocksToHtml(b.blocks)}</blockquote>`
      case 'table': {
        const th = b.header.map((c, k) => `<th style="text-align:${b.align[k] || 'left'}">${inlineHtml(c)}</th>`).join('')
        const rows = b.rows.map((r) => `<tr>${r.map((c, k) => `<td style="text-align:${b.align[k] || 'left'}">${inlineHtml(c)}</td>`).join('')}</tr>`).join('')
        return `<div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${rows}</tbody></table></div>`
      }
      default: return ''
    }
  }).join('\n')
}

export function markdownToHtml(md) {
  return blocksToHtml(parseMarkdown(md))
}

const PRINT_CSS = `
@page { size: A4; margin: 18mm 16mm 20mm; }
* { box-sizing: border-box; }
body { font-family: 'Segoe UI', Calibri, Arial, sans-serif; font-size: 10.5pt; line-height: 1.45; color: #1d2433; margin: 0 auto; max-width: 190mm; padding: 12mm 0; background: #fff; }
h1 { font-size: 20pt; color: #1f3a68; border-bottom: 2px solid #1f3a68; padding-bottom: 4pt; margin: 0 0 10pt; }
h2 { font-size: 14pt; color: #1f3a68; margin: 18pt 0 6pt; page-break-after: avoid; }
h3 { font-size: 12pt; color: #2b4c80; margin: 12pt 0 4pt; page-break-after: avoid; }
h4, h5, h6 { font-size: 10.5pt; margin: 10pt 0 4pt; }
p { margin: 0 0 6pt; }
table { border-collapse: collapse; width: 100%; margin: 4pt 0 10pt; font-size: 9pt; page-break-inside: auto; }
tr { page-break-inside: avoid; }
th, td { border: 1px solid #b8c2d3; padding: 3pt 5pt; vertical-align: top; }
th { background: #e8edf5; font-weight: 600; }
code { font-family: Consolas, 'Courier New', monospace; font-size: 9pt; background: #f2f4f8; padding: 0 2pt; }
pre { background: #f2f4f8; padding: 6pt; white-space: pre-wrap; }
blockquote { border-left: 3px solid #b8c2d3; margin: 6pt 0; padding: 2pt 10pt; color: #4a5568; }
mark.a-completer { background: #fff3c4; color: #7a4b00; }
hr { border: 0; border-top: 1px solid #b8c2d3; margin: 12pt 0; }
a { color: #1f5fbf; }
.pied { margin-top: 24pt; font-size: 8pt; color: #6b7588; border-top: 1px solid #d5dbe5; padding-top: 4pt; }
@media screen { body { padding: 16px; } }
`

/** Page HTML autonome prête à imprimer (ou « Enregistrer en PDF »). */
export function printableHtml(md, { title = 'Livrable', footer = '' } = {}) {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${PRINT_CSS}</style>
</head>
<body>
${markdownToHtml(md)}
${footer ? `<div class="pied">${escapeHtml(footer)}</div>` : ''}
</body>
</html>
`
}

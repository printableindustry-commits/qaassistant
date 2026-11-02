/** Parse JSON avec commentaires // et blocs (JSONC). */

export function stripJsonComments(text) {
  let out = ''
  let i = 0
  let inString = false
  let stringQuote = ''

  while (i < text.length) {
    const ch = text[i]
    if (inString) {
      out += ch
      if (ch === stringQuote && text[i - 1] !== '\\') inString = false
      i++
      continue
    }
    if (ch === '"' || ch === "'") {
      inString = true
      stringQuote = ch
      out += ch
      i++
      continue
    }
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      continue
    }
    if (ch === '/' && text[i + 1] === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++
      i += 2
      continue
    }
    out += ch
    i++
  }
  return out.replace(/,\s*([}\]])/g, '$1')
}

export function parseStackQuestionnaireText(text) {
  return JSON.parse(stripJsonComments(text))
}

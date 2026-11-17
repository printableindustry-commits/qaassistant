/**
 * Export Word au format du modèle de l'entreprise (fichier .docx déposé par l'administrateur).
 *
 *   openModel(buffer)                        → modèle analysé (zip, styles, numérotation, page de garde)
 *   coverInfo({ entry, profile, facts, version, date }) → informations de la page de garde
 *   markdownToModelDocx(md, model, cover)    → Buffer (.docx)
 *
 * Le document produit reprend STRICTEMENT la page de garde du modèle (paragraphes, zones de texte,
 * styles, sauts de page/section) jusqu'au champ Sommaire inclus ; seuls les textes changent :
 *   titre de la page de garde → « <équipe> – » puis code court du livrable, sur-titre → titre du
 *   livrable, « Version … » → version du document, avertissement → objet, destinataires et état,
 *   tableau des rôles → personnes du profil (même mise en forme de lignes et de cellules).
 * Les entrées en cache du sommaire sont vidées (le champ reste ; Word le met à jour à l'ouverture).
 * Le contenu métier du modèle est supprimé ; le corps du livrable est converti depuis le Markdown
 * avec les styles du modèle (heading 1 à 4 numérotés, Normal, List Paragraph et puces du modèle,
 * style de tableau du modèle, lien hypertexte). Le sectPr final (marges, pied de page) est conservé.
 *
 * Parties conservées : styles, numérotation, thème, paramètres (+ updateFields), table des polices,
 * en-têtes et pieds de page (et leurs médias), séparateurs de notes. Supprimées : commentaires,
 * personnes, customXml, webSettings, propriétés personnalisées, médias non référencés, données
 * d'aperçu VML (o:gfxdata, qui contiennent une copie du texte d'origine).
 */
import path from 'path'
import { parseMarkdown } from './render.mjs'
import { readZip, zipStore } from './zip.mjs'
import { xml } from './docx.mjs'

const RELS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const OFFICE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const KEEP_TYPES = new Set(['styles', 'stylesWithEffects', 'numbering', 'settings', 'fontTable', 'theme', 'footer', 'header', 'footnotes', 'endnotes'])
const DROP_TYPES = new Set(['comments', 'commentsExtended', 'commentsIds', 'commentsExtensible', 'people', 'customXml', 'webSettings', 'glossaryDocument', 'attachedTemplate', 'custom-properties'])
const MAX_MODEL_PART = 40 * 1024 * 1024

// ------------------------------------------------------------------ XML outillage

/** Balise ouvrante, fermante ou auto-fermante (valeurs d'attributs entre guillemets prises en compte). */
const TAG = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<(\/?)([A-Za-z_][\w:.-]*)((?:\s(?:[^>"']|"[^"]*"|'[^']*')*)?)>/g

/** Éléments enfants directs de str[from, to) : [{ name, start, end, xml }]. */
export function children(str, from = 0, to = str.length) {
  const out = []
  const re = new RegExp(TAG.source, 'g')
  re.lastIndex = from
  let depth = 0
  let cur = null
  let m
  while ((m = re.exec(str)) && m.index < to) {
    if (!m[2]) continue
    const closing = m[1] === '/'
    const selfClosing = !closing && /\/\s*$/.test(m[3] || '')
    if (closing) {
      depth--
      if (depth === 0 && cur) {
        cur.end = re.lastIndex
        cur.xml = str.slice(cur.start, cur.end)
        out.push(cur)
        cur = null
      }
      if (depth < 0) break
    } else if (selfClosing) {
      if (depth === 0) out.push({ name: m[2], start: m.index, end: re.lastIndex, xml: m[0] })
    } else {
      if (depth === 0) cur = { name: m[2], start: m.index }
      depth++
    }
  }
  return out
}

/** Contenu intérieur d'un élément (« <w:p …>contenu</w:p> » → contenu) ; '' si auto-fermant. */
function inner(el) {
  const open = el.match(/^<[^>]*>/)[0]
  if (/\/>$/.test(open)) return { open: open.replace(/\s*\/>$/, '>'), body: '', close: `</${el.match(/^<([\w:.-]+)/)[1]}>` }
  const name = el.match(/^<([\w:.-]+)/)[1]
  const close = `</${name}>`
  return { open, body: el.slice(open.length, el.length - close.length), close }
}

const attr = (s, name) => (s.match(new RegExp(`\\b${name}="([^"]*)"`)) || [])[1]
const unxml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

/** Texte visible d'un fragment (w:t uniquement). */
function textOf(frag) {
  let t = ''
  for (const m of frag.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:t\s*\/>/g)) t += unxml(m[1] || '')
  return t
}

function pStyleOf(p) {
  const pPr = p.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)
  return pPr ? attr(pPr[0].match(/<w:pStyle [^>]*>/)?.[0] || '', 'w:val') || '' : ''
}

function parseRels(relsXml) {
  return [...String(relsXml || '').matchAll(/<Relationship\b[^>]*>/g)].map((m) => ({
    id: attr(m[0], 'Id'),
    type: attr(m[0], 'Type') || '',
    target: unxml(attr(m[0], 'Target') || ''),
    external: attr(m[0], 'TargetMode') === 'External',
    raw: m[0].replace(/\s*\/?>$/, '/>'),
  }))
}

const relKind = (type) => type.split('/').pop()

function relsPathOf(part) {
  const dir = path.posix.dirname(part)
  return `${dir === '.' ? '' : dir + '/'}_rels/${path.posix.basename(part)}.rels`
}

function resolveTarget(part, target) {
  if (target.startsWith('/')) return target.slice(1)
  return path.posix.normalize(path.posix.join(path.posix.dirname(part), target))
}

// ------------------------------------------------------------------ analyse du modèle

function parseStyles(stylesXml) {
  const byName = new Map()
  const byId = new Map()
  let defaultParagraph = null
  for (const m of String(stylesXml || '').matchAll(/<w:style\b[^>]*>[\s\S]*?<\/w:style>/g)) {
    const open = m[0].match(/^<w:style\b[^>]*>/)[0]
    const id = attr(open, 'w:styleId')
    const type = attr(open, 'w:type')
    const name = (attr(m[0].match(/<w:name [^>]*>/)?.[0] || '', 'w:val') || id || '').toLowerCase()
    if (!id) continue
    const s = { id, type, name, xml: m[0] }
    byId.set(id, s)
    if (!byName.has(`${type}:${name}`)) byName.set(`${type}:${name}`, s)
    if (type === 'paragraph' && attr(open, 'w:default') === '1') defaultParagraph = s
  }
  const find = (type, ...names) => {
    for (const n of names) {
      const s = byName.get(`${type}:${n.toLowerCase()}`)
      if (s) return s.id
    }
    return null
  }
  return { byId, byName, find, defaultParagraph }
}

function parseNumbering(numXml) {
  const abstracts = new Map()
  for (const m of String(numXml || '').matchAll(/<w:abstractNum\b[^>]*>[\s\S]*?<\/w:abstractNum>/g)) {
    const id = attr(m[0].match(/^<w:abstractNum\b[^>]*>/)[0], 'w:abstractNumId')
    const lvl0 = m[0].match(/<w:lvl w:ilvl="0"[^>]*>[\s\S]*?<\/w:lvl>/)?.[0] || ''
    abstracts.set(id, {
      id,
      fmt: attr(lvl0.match(/<w:numFmt [^>]*>/)?.[0] || '', 'w:val') || '',
      text: attr(lvl0.match(/<w:lvlText [^>]*>/)?.[0] || '', 'w:val') ?? '',
      font: attr(lvl0.match(/<w:rFonts [^>]*>/)?.[0] || '', 'w:ascii') || '',
      left: Number(attr(lvl0.match(/<w:ind [^>]*>/)?.[0] || '', 'w:left') ?? attr(lvl0.match(/<w:ind [^>]*>/)?.[0] || '', 'w:start') ?? 0),
      styled: /<w:pStyle /.test(lvl0),
    })
  }
  const nums = new Map()
  for (const m of String(numXml || '').matchAll(/<w:num\b[^>]*>[\s\S]*?<\/w:num>/g)) {
    const id = attr(m[0].match(/^<w:num\b[^>]*>/)[0], 'w:numId')
    nums.set(id, { id, abstract: attr(m[0].match(/<w:abstractNumId [^>]*>/)?.[0] || '', 'w:val'), override: /<w:lvlOverride/.test(m[0]) })
  }
  return { abstracts, nums }
}

/**
 * Instance de numérotation représentative des listes de premier niveau du document pour un format donné :
 * les instances sont regroupées par apparence (format, symbole, police, retrait) — un modèle Word contient
 * souvent des dizaines d'instances pour la même puce — et l'on retient l'apparence la plus fréquente,
 * puis son instance la plus utilisée.
 */
function pickNum(docXml, numbering, listStyleId, wantBullet) {
  const usage = new Map()
  for (const m of docXml.matchAll(/<w:pPr>([\s\S]*?)<\/w:pPr>/g)) {
    const numId = m[1].match(/<w:numId w:val="(\d+)"/)?.[1]
    if (!numId || numId === '0') continue
    if ((m[1].match(/<w:ilvl w:val="(\d+)"/)?.[1] || '0') !== '0') continue
    const style = m[1].match(/<w:pStyle w:val="([^"]+)"/)?.[1] || ''
    usage.set(numId, (usage.get(numId) || 0) + (style === listStyleId ? 2 : 1))
  }
  const groups = new Map()
  for (const [numId, n] of usage) {
    const num = numbering.nums.get(numId)
    const abs = num && numbering.abstracts.get(num.abstract)
    if (!abs || abs.styled || num.override) continue
    const ok = wantBullet ? abs.fmt === 'bullet' && abs.left > 0 && abs.left <= 1080 : abs.fmt === 'decimal' && /^%1[.)]$/.test(abs.text)
    if (!ok) continue
    const key = `${abs.fmt}|${abs.text}|${abs.font}|${abs.left}`
    const g = groups.get(key) || { n: 0, best: null }
    g.n += n
    if (!g.best || n > g.best.n) g.best = { numId, abstract: num.abstract, n }
    groups.set(key, g)
  }
  let best = null
  let top = 0
  for (const g of groups.values()) if (g.n > top) { top = g.n; best = g.best }
  if (!best && !wantBullet) {
    for (const abs of numbering.abstracts.values()) {
      if (!abs.styled && abs.fmt === 'decimal' && /^%1[.)]$/.test(abs.text)) return { numId: null, abstract: abs.id }
    }
  }
  return best
}

/** Découpe document.xml : en-tête jusqu'à <w:body>, éléments du corps, sectPr final. */
function splitBody(docXml) {
  const open = docXml.match(/<w:body(?:\s[^>]*)?>/)
  const close = docXml.lastIndexOf('</w:body>')
  if (!open || close < 0) throw new Error('word/document.xml ne contient pas de corps (w:body).')
  const startBody = open.index + open[0].length
  const elements = children(docXml, startBody, close)
  let sectPr = ''
  if (elements.length && elements[elements.length - 1].name === 'w:sectPr') sectPr = elements.pop().xml
  return { head: docXml.slice(0, startBody), elements, sectPr, tail: docXml.slice(close) }
}

const TOC_INSTR = /<w:instrText(?:\s[^>]*)?>\s*TOC\b/

/** Index du dernier élément de la page de garde (sommaire inclus, sauts de page vides suivants). */
function findCoverEnd(elements, styles) {
  let toc = elements.findIndex((e) => (e.name === 'w:sdt' && /<w:docPartGallery w:val="Table of Contents"/.test(e.xml)) || (e.name === 'w:sdt' && TOC_INSTR.test(e.xml)))
  if (toc < 0) {
    const begin = elements.findIndex((e) => e.name === 'w:p' && TOC_INSTR.test(e.xml))
    if (begin >= 0) {
      // champ TOC en paragraphes de premier niveau : on suit l'imbrication des champs jusqu'à sa fin
      let depth = 0
      toc = begin
      for (let k = begin; k < elements.length; k++) {
        for (const m of elements[k].xml.matchAll(/w:fldCharType="(begin|end)"/g)) depth += m[1] === 'begin' ? 1 : -1
        toc = k
        if (depth <= 0) break
      }
    }
  }
  if (toc < 0) {
    const headingIds = new Set([...styles.byId.values()].filter((s) => /^heading \d$/.test(s.name)).map((s) => s.id))
    const first = elements.findIndex((e) => e.name === 'w:p' && headingIds.has(pStyleOf(e.xml)))
    return first - 1
  }
  let end = toc
  while (end + 1 < elements.length) {
    const next = elements[end + 1]
    if (next.name !== 'w:p' || textOf(next.xml).trim() || /<w:drawing|<w:pict|<w:object/.test(next.xml)) break
    end++
  }
  return end
}

export function openModel(buffer) {
  const zip = readZip(buffer)
  for (const [name, e] of zip) if (e.size > MAX_MODEL_PART) throw new Error(`Partie trop volumineuse dans le modèle : ${name}`)
  const text = (name) => (zip.has(name) ? zip.get(name).read().toString('utf8') : null)
  if (!zip.has('[Content_Types].xml')) throw new Error('Ce fichier n\'est pas un document Word (.docx) : [Content_Types].xml absent.')
  const docXml = text('word/document.xml')
  if (!docXml) throw new Error('Ce fichier n\'est pas un document Word (.docx) : word/document.xml absent.')
  if (!/<w:document\b/.test(docXml)) throw new Error('word/document.xml n\'est pas un document WordprocessingML.')
  const styles = parseStyles(text('word/styles.xml'))
  const numberingXml = text('word/numbering.xml')
  const numbering = parseNumbering(numberingXml)
  const body = splitBody(docXml)
  const coverEnd = findCoverEnd(body.elements, styles)
  const listStyle = styles.find('paragraph', 'List Paragraph', 'Paragraphe de liste')
  const coverXml = body.elements.slice(0, coverEnd + 1).map((e) => e.xml).join('')
  const coverTable = body.elements.slice(0, coverEnd + 1).find((e) => e.name === 'w:tbl')
  const tableStyle = (coverTable && coverTable.xml.match(/<w:tblStyle w:val="([^"]+)"/)?.[1]) ||
    mostUsed(docXml, /<w:tblStyle w:val="([^"]+)"/g) || styles.find('table', 'Table Grid')
  return {
    zip,
    text,
    docXml,
    styles,
    numberingXml,
    numbering,
    body,
    coverEnd,
    coverXml,
    hasToc: TOC_INSTR.test(coverXml),
    contentTypes: text('[Content_Types].xml'),
    rels: parseRels(text('word/_rels/document.xml.rels')),
    ids: {
      headings: [1, 2, 3, 4].map((n) => styles.find('paragraph', `heading ${n}`, `titre ${n}`)),
      normal: styles.defaultParagraph?.id || styles.find('paragraph', 'Normal'),
      list: listStyle,
      hyperlink: styles.find('character', 'Hyperlink', 'Lien hypertexte'),
      quote: styles.find('paragraph', 'Quote', 'Citation', 'Intense Quote', 'Citation intense'),
      title: styles.find('paragraph', 'Titre Document', 'Title', 'Titre'),
      subtitle: styles.find('paragraph', 'Sur-titre document', 'Subtitle', 'Sous-titre'),
      table: tableStyle && styles.byId.get(tableStyle)?.type === 'table' ? tableStyle : null,
    },
    bullet: pickNum(docXml, numbering, listStyle, true),
    decimal: pickNum(docXml, numbering, listStyle, false),
    tableHeaderColor: headerColor(coverTable?.xml),
    tableCellMar: coverTable?.xml.match(/<w:tblPr>[\s\S]*?<\/w:tblPr>/)?.[0].match(/<w:tblCellMar>[\s\S]*?<\/w:tblCellMar>/)?.[0] || '',
  }
}

/** Couleur du texte de la ligne d'en-tête du tableau de la page de garde (posée en direct dans le modèle). */
function headerColor(tbl) {
  const tr = tbl && tbl.match(/<w:tr\b[\s\S]*?<\/w:tr>/)?.[0]
  const run = tr && [...tr.matchAll(/<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g)].find((m) => /<w:t[\s>]/.test(m[1]))
  return run?.[1].match(/<w:rPr>[\s\S]*?<\/w:rPr>/)?.[0].match(/<w:color\b[^>]*\/>/)?.[0] || ''
}

function mostUsed(str, re) {
  const count = new Map()
  for (const m of str.matchAll(re)) count.set(m[1], (count.get(m[1]) || 0) + 1)
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0] || null
}

/** Résumé lisible du modèle (affiché après dépôt). */
export function describeModel(model) {
  const coverText = textOf(model.coverXml)
  return {
    cover: model.coverEnd >= 0,
    toc: model.hasToc,
    headings: model.ids.headings.filter(Boolean).length,
    tableStyle: model.ids.table ? model.styles.byId.get(model.ids.table)?.name || model.ids.table : null,
    bullets: Boolean(model.bullet),
    rolesTable: /<w:tbl\b/.test(model.coverXml),
    footer: /<w:footerReference/.test(model.body.sectPr),
    coverChars: coverText.length,
  }
}

// ------------------------------------------------------------------ page de garde

const fr = (iso) => {
  const d = iso ? new Date(iso) : new Date()
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })
}

const str = (v) => (v == null ? '' : String(v).trim())

/** Informations de page de garde à partir du catalogue, du profil et des faits. */
export function coverInfo({ entry, profile = {}, facts = {}, version = 0, date = null }) {
  // à défaut d'équipe : nom court du produit (« IRMA — Analyse… » → « IRMA »), puis projet JIRA
  const shortName = (v) => str(v).split(/\s+[—–]\s+/)[0]
  const team = str(profile.equipe) || shortName(profile.produit) || shortName(facts.project?.name) || str(facts.project?.key) || 'Projet'
  const when = fr(date)
  const roles = []
  const seen = new Set()
  const add = (group, role, person, d = '') => {
    const p = str(person)
    if (!p) return
    const key = `${role.toLowerCase()}|${p.toLowerCase()}`
    if (seen.has(key)) return
    seen.add(key)
    roles.push({ group, role, person: p, date: d })
  }
  add('Pilotage des tests', 'Responsable des tests', profile.responsableTest, when)
  add('Validation', 'Valideur', profile.valideur)
  for (const t of Array.isArray(profile.testeurs) ? profile.testeurs : str(profile.testeurs) ? [profile.testeurs] : []) add('Équipe de test', 'Testeur', t)
  const known = new Set(roles.map((r) => r.person.toLowerCase()))
  for (const pp of Array.isArray(profile.partiesPrenantes) ? profile.partiesPrenantes : []) {
    const person = str(pp?.nom)
    // rôles déjà portés par les lignes ci-dessus (responsable, valideur, testeurs)
    if (!person || known.has(person.toLowerCase()) || /^(responsable des tests|testeurs?|valideur)$/i.test(str(pp.role))) continue
    add('Parties prenantes', str(pp.role) || 'Partie prenante', person)
  }
  if (roles.length && !roles.some((r) => r.date)) roles[0].date = when
  return {
    team,
    short: str(entry?.short) || str(entry?.id).slice(0, 3).toUpperCase(),
    title: str(entry?.title),
    version: version ? String(version) : 'brouillon',
    date: when,
    purpose: str(entry?.purpose),
    audience: str(entry?.audience),
    ref: str(entry?.ref),
    roles,
  }
}

function textRuns(text) {
  return String(text).split('\n').map((line, k) => `${k ? '<w:br/>' : ''}<w:t xml:space="preserve">${xml(line)}</w:t>`).join('')
}

/** Remplace le texte d'un paragraphe en gardant ses propriétés et la mise en forme de son premier segment. */
function setParaText(p, text) {
  const { open } = inner(p)
  const pPr = p.match(/<w:pPr>[\s\S]*?<\/w:pPr>|<w:pPr\s*\/>/)?.[0] || ''
  const after = pPr ? p.slice(p.indexOf(pPr) + pPr.length) : p.slice(open.length)
  const run = after.match(/<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/)
  let rPr = run?.[1].match(/^<w:rPr>[\s\S]*?<\/w:rPr>/)?.[0] || ''
  if (!rPr) {
    const mark = pPr.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/)
    rPr = mark ? `<w:rPr>${mark[1].replace(/<w:(?:ins|del|moveFrom|moveTo)\b[^>]*\/>/g, '')}</w:rPr>` : ''
  }
  return `${open}${pPr}${text ? `<w:r>${rPr}${textRuns(text)}</w:r>` : ''}</w:p>`
}

/** Nettoie un fragment conservé : aperçus VML, commentaires, signets orphelins, identifiants de paragraphe. */
function scrub(frag) {
  return frag
    .replace(/\s+o:gfxdata="[^"]*"/g, '')
    .replace(/<w:commentRangeStart\b[^>]*\/>|<w:commentRangeEnd\b[^>]*\/>/g, '')
    .replace(/<w:r(?:\s[^>]*)?>(?:<w:rPr>(?:(?!<\/w:rPr>)[\s\S])*<\/w:rPr>)?<w:commentReference\b[^>]*\/><\/w:r>/g, '')
    .replace(/<w:bookmarkStart\b[^>]*\/>|<w:bookmarkEnd\b[^>]*\/>/g, '')
    .replace(/\s+w14:(?:paraId|textId)="[^"]*"/g, '')
}

/** Zone de texte de la page de garde : titres, sur-titres et avertissement. */
function rewriteTextBox(content, model, cover, notice) {
  const kids = children(content)
  const { title, subtitle } = model.ids
  const titleIdx = kids.map((k, i) => (k.name === 'w:p' && pStyleOf(k.xml) === title && textOf(k.xml).trim() ? i : -1)).filter((i) => i >= 0)
  const out = kids.map((k) => k.xml)
  titleIdx.forEach((i, n) => {
    const text = titleIdx.length === 1 ? `${cover.team} – ${cover.short}` : n === 0 ? `${cover.team} – ` : n === 1 ? cover.short : ''
    out[i] = setParaText(kids[i].xml, text)
  })
  kids.forEach((k, i) => {
    if (k.name !== 'w:p' || pStyleOf(k.xml) !== subtitle || !subtitle) return
    const t = textOf(k.xml).trim()
    if (!t) return
    out[i] = setParaText(k.xml, /^version\b/i.test(t) ? `Version ${cover.version}` : cover.title)
  })
  // Avertissement : paragraphes non vides, hors titres, d'une zone qui contient le titre (ou sans style de page de garde).
  const coverStyles = new Set([title, subtitle].filter(Boolean))
  const hasCoverStyle = kids.some((k) => k.name === 'w:p' && coverStyles.has(pStyleOf(k.xml)))
  if (titleIdx.length || !hasCoverStyle) {
    const slots = kids.map((k, i) => ({ k, i })).filter(({ k }) => k.name === 'w:p' && !coverStyles.has(pStyleOf(k.xml)) && textOf(k.xml).trim())
    const plain = slots.filter(({ k }) => !/<w:numPr>/.test(k.xml))
    const bullets = slots.filter(({ k }) => /<w:numPr>/.test(k.xml))
    fill(out, plain, notice.plain)
    fill(out, bullets.length ? bullets : plain, bullets.length ? notice.bullets : [])
    if (!bullets.length && notice.bullets.length && plain.length) {
      const last = plain[plain.length - 1]
      out[last.i] += notice.bullets.map((b) => setParaText(last.k.xml, `• ${b}`)).join('')
    }
  }
  return out.join('')
}

/** Répartit des textes sur des emplacements de paragraphe : surplus cloné après le dernier, manque supprimé. */
function fill(out, slots, texts) {
  if (!slots.length) return
  slots.forEach(({ k, i }, n) => {
    out[i] = n < texts.length ? setParaText(k.xml, texts[n]) : ''
  })
  if (texts.length > slots.length) {
    const last = slots[slots.length - 1]
    out[last.i] += texts.slice(slots.length).map((t) => setParaText(last.k.xml, t)).join('')
  }
}

/** Tableau des rôles : ligne d'en-tête du modèle conservée, lignes de données recréées sur le modèle des siennes. */
function rewriteRolesTable(tbl, cover) {
  const { open, body, close } = inner(tbl)
  const kids = children(body)
  const rows = kids.filter((k) => k.name === 'w:tr')
  if (rows.length < 2) return tbl
  const header = rows[0]
  const data = rows.slice(1)
  const templateFor = (n, total) => (n === 0 ? data[0] : n === total - 1 ? data[data.length - 1] : data[Math.min(1, data.length - 1)])
  const roles = cover.roles.length ? cover.roles : [{ group: '', role: 'Responsable des tests', person: '[À compléter : Informations projet]', date: cover.date }]
  const built = roles.map((r, n) => fillRow(templateFor(n, roles.length).xml, r))
  const before = body.slice(0, header.end)
  const after = body.slice(rows[rows.length - 1].end)
  return `${open}${before}${built.join('')}${after}${close}`
}

function fillRow(tr, r) {
  const { open, body, close } = inner(tr)
  const kids = children(body)
  const cells = kids.filter((k) => k.name === 'w:tc')
  const all = [r.group, r.role, r.person, r.date]
  const values = cells.length >= 4 ? all.concat(Array(cells.length - 4).fill('')) : cells.length === 3 ? all.slice(1) : cells.length === 2 ? [r.role, r.person] : [r.person]
  let out = ''
  let pos = 0
  cells.forEach((c, n) => {
    out += body.slice(pos, c.start) + fillCell(c.xml, values[n] || '')
    pos = c.end
  })
  return `${open}${out}${body.slice(pos)}${close}`
}

function fillCell(tc, value) {
  const { open, body, close } = inner(tc)
  const kids = children(body)
  const paras = kids.filter((k) => k.name === 'w:p')
  if (!paras.length) return tc
  let out = ''
  let pos = 0
  paras.forEach((p, n) => {
    out += body.slice(pos, p.start) + (n === 0 ? setParaText(p.xml, value) : '')
    pos = p.end
  })
  return `${open}${out}${body.slice(pos)}${close}`
}

/** Champ Sommaire : propriétés et instruction conservées, entrées en cache supprimées. */
function emptyTocParagraphs(paras) {
  const begin = paras.findIndex((p) => TOC_INSTR.test(p))
  if (begin < 0) return paras
  const p = paras[begin]
  const sep = p.search(/w:fldCharType="separate"/)
  let head
  if (sep >= 0) head = p.slice(0, p.indexOf('</w:r>', sep) + 6)
  else head = p.slice(0, p.lastIndexOf('</w:p>'))
  // referme un hyperlien resté ouvert avant le séparateur
  const openLinks = (head.match(/<w:hyperlink\b/g) || []).length - (head.match(/<\/w:hyperlink>/g) || []).length
  if (openLinks > 0) head += '</w:hyperlink>'.repeat(openLinks)
  const sepRun = sep >= 0 ? '' : '<w:r><w:fldChar w:fldCharType="separate"/></w:r>'
  const collapsed = `${head}${sepRun}<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`
  // fin du champ : premier paragraphe où l'imbrication revient à zéro
  let depth = 0
  let end = begin
  for (let k = begin; k < paras.length; k++) {
    for (const m of paras[k].matchAll(/w:fldCharType="(begin|end)"/g)) depth += m[1] === 'begin' ? 1 : -1
    end = k
    if (depth <= 0) break
  }
  return [...paras.slice(0, begin), collapsed, ...paras.slice(end + 1)]
}

function rewriteToc(el) {
  if (el.name === 'w:sdt') {
    const m = el.xml.match(/^([\s\S]*?<w:sdtContent>)([\s\S]*)(<\/w:sdtContent>[\s\S]*)$/)
    if (!m) return el.xml
    const kids = children(m[2]).map((k) => k.xml)
    return m[1] + emptyTocParagraphs(kids).join('') + m[3]
  }
  return el.xml
}

function buildCover(model, cover, cartouche) {
  const elements = model.body.elements.slice(0, model.coverEnd + 1)
  const notice = {
    plain: [cover.purpose, cover.audience ? `Destinataires : ${cover.audience}` : '', cover.ref ? `Référence : ${cover.ref}` : ''].filter(Boolean),
    bullets: ['Statut', 'Relu par', 'Approuvé par', 'Confidentialité', 'Diffusion']
      .map((k) => (cartouche[k] && !/^\s*$/.test(cartouche[k]) ? `${k} : ${cartouche[k]}` : ''))
      .filter(Boolean),
  }
  let tableDone = false
  const parts = []
  let k = 0
  while (k < elements.length) {
    const el = elements[k]
    if (!el.name.startsWith('w:')) { k++; continue }
    if (el.name === 'w:tbl' && !tableDone) {
      parts.push(rewriteRolesTable(el.xml, cover))
      tableDone = true
    } else if (el.name === 'w:sdt' && TOC_INSTR.test(el.xml)) {
      parts.push(rewriteToc(el))
    } else if (el.name === 'w:p' && TOC_INSTR.test(el.xml)) {
      // sommaire en paragraphes de premier niveau
      const rest = elements.slice(k).map((e) => e.xml)
      const collapsed = emptyTocParagraphs(rest)
      const consumed = rest.length - (collapsed.length - 1)
      parts.push(collapsed[0])
      k += consumed
      continue
    } else {
      parts.push(el.xml)
    }
    k++
  }
  let out = scrub(parts.join(''))
  out = out.replace(/(<w:txbxContent>)([\s\S]*?)(<\/w:txbxContent>)/g, (_, a, content, b) => a + rewriteTextBox(content, model, cover, notice) + b)
  return out
}

// ------------------------------------------------------------------ corps du livrable

function createContext(model) {
  const sect = model.body.sectPr
  const pgW = Number(attr(sect.match(/<w:pgSz [^>]*>/)?.[0] || '', 'w:w') || 11906)
  const mar = sect.match(/<w:pgMar [^>]*>/)?.[0] || ''
  const usable = Math.max(4000, pgW - Number(attr(mar, 'w:left') || 1134) - Number(attr(mar, 'w:right') || 1134))
  const maxNum = Math.max(0, ...[...model.numbering.nums.keys()].map(Number))
  const maxAbs = Math.max(-1, ...[...model.numbering.abstracts.keys()].map(Number))
  return { model, usable, links: [], newNums: [], newAbstracts: [], nextNum: maxNum + 1, nextAbs: maxAbs + 1, bulletNumId: null }
}

const ownAbstract = (id, kind) => `<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="hybridMultilevel"/>${[0, 1, 2, 3].map((i) => (kind === 'bullet'
  ? `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="${['•', 'o', '▪', '•'][i]}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 + i * 720}" w:hanging="360"/></w:pPr></w:lvl>`
  : `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${['decimal', 'lowerLetter', 'lowerRoman', 'decimal'][i]}"/><w:lvlText w:val="%${i + 1}."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 + i * 720}" w:hanging="360"/></w:pPr></w:lvl>`)).join('')}</w:abstractNum>`

function bulletNum(ctx) {
  if (ctx.bulletNumId) return ctx.bulletNumId
  if (ctx.model.bullet?.numId) ctx.bulletNumId = ctx.model.bullet.numId
  else {
    const abs = ctx.nextAbs++
    ctx.newAbstracts.push(ownAbstract(abs, 'bullet'))
    ctx.bulletNumId = String(ctx.nextNum++)
    ctx.newNums.push(`<w:num w:numId="${ctx.bulletNumId}"><w:abstractNumId w:val="${abs}"/></w:num>`)
  }
  return ctx.bulletNumId
}

/** Nouvelle instance numérotée (repart à 1) sur la liste numérotée du modèle. */
function decimalNum(ctx) {
  let abs = ctx.model.decimal?.abstract
  if (abs == null) {
    if (ctx.ownDecimal == null) {
      ctx.ownDecimal = ctx.nextAbs++
      ctx.newAbstracts.push(ownAbstract(ctx.ownDecimal, 'decimal'))
    }
    abs = ctx.ownDecimal
  }
  const id = String(ctx.nextNum++)
  ctx.newNums.push(`<w:num w:numId="${id}"><w:abstractNumId w:val="${abs}"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`)
  return id
}

function runXml(r, ctx, { bold = false, link = false, color = '' } = {}) {
  const p = []
  if (link && ctx.model.ids.hyperlink) p.push(`<w:rStyle w:val="${ctx.model.ids.hyperlink}"/>`)
  if (r.code) p.push('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>')
  if (r.b || bold) p.push('<w:b/><w:bCs/>')
  if (r.i) p.push('<w:i/><w:iCs/>')
  if (color && !link) p.push(color)
  if (/^\[À compléter/.test(r.text)) p.push('<w:highlight w:val="yellow"/>')
  if (r.code) p.push('<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>')
  return `<w:r>${p.length ? `<w:rPr>${p.join('')}</w:rPr>` : ''}${textRuns(r.text)}</w:r>`
}

function inlines(runs, ctx, opts = {}) {
  return runs.map((r) => {
    if (r.href && /^(https?:|mailto:)/i.test(r.href)) {
      const id = `rIdWq${ctx.links.length + 1}`
      ctx.links.push({ id, url: r.href })
      return `<w:hyperlink r:id="${id}" w:history="1">${runXml(r, ctx, { ...opts, link: true })}</w:hyperlink>`
    }
    return runXml(r, ctx, opts)
  }).join('')
}

function para(content, pPr = '') {
  return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${content}</w:p>`
}

const runsText = (runs) => runs.map((r) => r.text).join('')

function tableXml(t, ctx) {
  const weight = t.header.map((h, k) => {
    const lens = [runsText(h).length, ...t.rows.map((r) => runsText(r[k] || []).length)]
    return Math.min(60, Math.max(6, Math.max(...lens)))
  })
  const total = weight.reduce((a, b) => a + b, 0) || 1
  const widths = weight.map((w) => Math.max(600, Math.floor((ctx.usable * w) / total)))
  const style = ctx.model.ids.table ? `<w:tblStyle w:val="${ctx.model.ids.table}"/>` : ''
  const borders = ctx.model.ids.table ? '' : '<w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders>'
  const cell = (runs, k, header) => {
    const jc = t.align[k] === 'right' ? 'right' : t.align[k] === 'center' ? 'center' : 'left'
    return `<w:tc><w:tcPr><w:tcW w:w="${widths[k]}" w:type="dxa"/></w:tcPr>${para(inlines(runs, ctx, header ? { bold: true, color: ctx.model.tableHeaderColor } : {}), `<w:spacing w:before="0" w:after="0"/><w:jc w:val="${jc}"/>`)}</w:tc>`
  }
  const head = `<w:tr><w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>${t.header.map((c, k) => cell(c, k, true)).join('')}</w:tr>`
  const rows = t.rows.map((r) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${r.map((c, k) => cell(c, k, false)).join('')}</w:tr>`).join('')
  return `<w:tbl><w:tblPr>${style}<w:tblW w:w="5000" w:type="pct"/>${borders}${ctx.model.tableCellMar}<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>` +
    `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${head}${rows}</w:tbl>` + para('')
}

function blocksXml(blocks, ctx, shift, quoted = false) {
  const ids = ctx.model.ids
  const q = quoted && ids.quote ? `<w:pStyle w:val="${ids.quote}"/>` : ''
  return blocks.map((blk) => {
    switch (blk.type) {
      case 'heading': {
        const level = Math.min(Math.max(1, blk.level - shift), 4)
        const style = ids.headings[level - 1] || ids.headings.filter(Boolean).pop()
        return para(inlines(blk.inlines, ctx), style ? `<w:pStyle w:val="${style}"/>` : '<w:keepNext/>')
      }
      case 'paragraph': return para(inlines(blk.inlines, ctx), q || (quoted ? '<w:ind w:left="360"/>' : ''))
      case 'hr': return para('', '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr>')
      case 'code': return blk.text.split('\n').map((l) => para(runXml({ text: l, code: true }, ctx), '<w:spacing w:before="0" w:after="0"/>')).join('') + para('')
      case 'quote': return blocksXml(blk.blocks, ctx, shift, true)
      case 'table': return tableXml(blk, ctx)
      case 'list': {
        let decimal = null
        return blk.items.map((it) => {
          const numId = it.ordered ? (decimal ||= decimalNum(ctx)) : bulletNum(ctx)
          const style = ids.list ? `<w:pStyle w:val="${ids.list}"/>` : ''
          return para(inlines(it.inlines, ctx), `${style}<w:numPr><w:ilvl w:val="${Math.min(it.level, 3)}"/><w:numId w:val="${numId}"/></w:numPr>`)
        }).join('')
      }
      default: return ''
    }
  }).join('')
}

/**
 * Retire du Markdown ce que la page de garde représente déjà : titre « # » et cartouche initial
 * (tableau Rubrique | Valeur). Renvoie aussi le cartouche lu ({ libellé: valeur }).
 */
export function stripCartouche(blocks) {
  const rest = [...blocks]
  const cartouche = {}
  if (rest[0]?.type === 'heading' && rest[0].level === 1) rest.shift()
  const t = rest[0]
  if (t?.type === 'table' && t.header.length === 2 && /^(rubrique|champ|propriété|information)$/i.test(runsText(t.header[0]).trim())) {
    for (const r of t.rows) cartouche[runsText(r[0]).trim()] = runsText(r[1]).trim()
    rest.shift()
  }
  return { blocks: rest, cartouche }
}

// ------------------------------------------------------------------ paquet

function contentTypesXml(original, parts) {
  const defaults = [...String(original || '').matchAll(/<Default\b[^>]*>/g)].map((m) => m[0].replace(/\s*\/?>$/, '/>'))
  if (!defaults.some((d) => /Extension="rels"/i.test(d))) defaults.push('<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>')
  if (!defaults.some((d) => /Extension="xml"/i.test(d))) defaults.push('<Default Extension="xml" ContentType="application/xml"/>')
  const overrides = [...String(original || '').matchAll(/<Override\b[^>]*>/g)]
    .map((m) => ({ part: attr(m[0], 'PartName').replace(/^\//, ''), raw: m[0].replace(/\s*\/?>$/, '/>') }))
    .filter((o) => parts.has(o.part))
  const have = new Set(overrides.map((o) => o.part))
  const extra = [
    ['word/document.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'],
    ['docProps/core.xml', 'application/vnd.openxmlformats-package.core-properties+xml'],
    ['docProps/app.xml', 'application/vnd.openxmlformats-officedocument.extended-properties+xml'],
  ].filter(([p]) => !have.has(p)).map(([p, t]) => `<Override PartName="/${p}" ContentType="${t}"/>`)
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${defaults.join('')}${overrides.map((o) => o.raw).join('')}${extra.join('')}</Types>`
}

function relsXml(list) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${RELS_NS}">${list.join('')}</Relationships>`
}

function settingsXml(s) {
  let out = s
    .replace(/<w:rsids>[\s\S]*?<\/w:rsids>/g, '')
    .replace(/<w:attachedTemplate\b[^>]*\/>/g, '')
    .replace(/<w:docVars>[\s\S]*?<\/w:docVars>/g, '')
    .replace(/<w:mailMerge>[\s\S]*?<\/w:mailMerge>/g, '')
    .replace(/<w:updateFields\b[^>]*\/>/g, '')
  // ordre du schéma CT_Settings : updateFields précède hdrShapeDefaults, footnotePr, endnotePr, compat…
  const anchors = ['<w:hdrShapeDefaults', '<w:footnotePr', '<w:endnotePr', '<w:compat', '<w:docVars', '<w:rsids', '<m:mathPr', '<w:attachedSchema', '<w:themeFontLang', '<w:clrSchemeMapping', '<w:doNotIncludeSubdocsInStats', '<w:doNotAutoCompressPictures', '<w:forceUpgrade', '<w:captions', '<w:readModeInkLockDown', '<w:smartTagType', '<sl:schemaLibrary', '<w:shapeDefaults', '<w:doNotEmbedSmartTags', '<w:decimalSymbol', '<w:listSeparator', '</w:settings>']
  for (const a of anchors) {
    const i = out.indexOf(a)
    if (i >= 0) return out.slice(0, i) + '<w:updateFields w:val="true"/>' + out.slice(i)
  }
  return out
}

/** Notes de bas de page / de fin : seuls les séparateurs (w:type) sont gardés, le contenu du modèle part. */
function notesXml(s, tag) {
  return s.replace(new RegExp(`<w:${tag}\\b[^>]*>[\\s\\S]*?<\\/w:${tag}>`, 'g'), (m) => (/^<[^>]*\bw:type="/.test(m) ? m : ''))
}

function coreXml({ title, author }) {
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${xml(title)}</dc:title><dc:creator>${xml(author)}</dc:creator><cp:lastModifiedBy>${xml(author)}</cp:lastModifiedBy><dc:language>fr-FR</dc:language>
<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`
}

const APP_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Wizard QA</Application></Properties>'

const REF_ATTR = /\br:(?:id|embed|link|pict|dm|lo|qs|cs|href)="([^"]+)"/g

/** Construit le .docx du livrable au format du modèle. */
export function markdownToModelDocx(md, model, cover, { author = 'Wizard QA' } = {}) {
  const parsed = stripCartouche(parseMarkdown(md))
  const ctx = createContext(model)
  const shift = parsed.blocks.some((b) => b.type === 'heading' && b.level === 1) ? 0 : 1
  const coverXml = model.coverEnd >= 0 ? buildCover(model, cover, parsed.cartouche) : ''
  const body = blocksXml(parsed.blocks, ctx, shift)
  const sectPr = model.body.sectPr || '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>'
  const docXml = `${model.body.head}${coverXml}${body || para('')}${sectPr}${model.body.tail}`

  // parties conservées
  const parts = new Map()
  const relFiles = new Map()
  const keepPart = (name, seen = new Set()) => {
    if (seen.has(name) || parts.has(name) || !model.zip.has(name)) return
    seen.add(name)
    let data = model.zip.get(name).read()
    const base = path.posix.basename(name)
    if (/^word\/settings\.xml$/.test(name)) data = settingsXml(data.toString('utf8'))
    else if (/^word\/footnotes\.xml$/.test(name)) data = notesXml(data.toString('utf8'), 'footnote')
    else if (/^word\/endnotes\.xml$/.test(name)) data = notesXml(data.toString('utf8'), 'endnote')
    else if (/\.xml$/.test(base) && /^word\/(header|footer)\d*\.xml$/.test(name)) data = scrub(data.toString('utf8'))
    parts.set(name, data)
    if (/^word\/settings\.xml$/.test(name)) return // modèle attaché, sources de publipostage : non repris
    const relsName = relsPathOf(name)
    if (!model.zip.has(relsName)) return
    const rels = parseRels(model.zip.get(relsName).read().toString('utf8')).filter((r) => !DROP_TYPES.has(relKind(r.type)))
    relFiles.set(relsName, relsXml(rels.map((r) => r.raw)))
    for (const r of rels) if (!r.external) keepPart(resolveTarget(name, r.target), seen)
  }

  const used = new Set([...coverXml.matchAll(REF_ATTR), ...sectPr.matchAll(REF_ATTR)].map((m) => m[1]))
  const docRels = []
  for (const r of model.rels) {
    const kind = relKind(r.type)
    if (DROP_TYPES.has(kind)) continue
    if (KEEP_TYPES.has(kind) || used.has(r.id)) {
      docRels.push(r.raw)
      if (!r.external) keepPart(resolveTarget('word/document.xml', r.target))
    }
  }
  for (const l of ctx.links) docRels.push(`<Relationship Id="${l.id}" Type="${OFFICE_REL}/hyperlink" Target="${xml(l.url)}" TargetMode="External"/>`)

  // numérotation : instances ajoutées pour les listes numérotées du livrable
  if (parts.has('word/numbering.xml') && (ctx.newNums.length || ctx.newAbstracts.length)) {
    let n = parts.get('word/numbering.xml').toString('utf8')
    if (ctx.newAbstracts.length) {
      const firstNum = n.search(/<w:num\b/)
      const at = firstNum >= 0 ? firstNum : n.search(/<w:numIdMacAtCleanup\b|<\/w:numbering>/)
      n = n.slice(0, at) + ctx.newAbstracts.join('') + n.slice(at)
    }
    const at = n.search(/<w:numIdMacAtCleanup\b|<\/w:numbering>/)
    n = n.slice(0, at) + ctx.newNums.join('') + n.slice(at)
    parts.set('word/numbering.xml', n)
  } else if (!parts.has('word/numbering.xml') && (ctx.newNums.length || ctx.newAbstracts.length)) {
    parts.set('word/numbering.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${ctx.newAbstracts.join('')}${ctx.newNums.join('')}</w:numbering>`)
    docRels.push(`<Relationship Id="rIdWqNumbering" Type="${OFFICE_REL}/numbering" Target="numbering.xml"/>`)
  }

  parts.set('word/document.xml', docXml)
  parts.set('docProps/core.xml', coreXml({ title: `${cover.short} – ${cover.title}`, author }))
  parts.set('docProps/app.xml', APP_XML)
  const files = [
    { name: '[Content_Types].xml', data: contentTypesXml(model.contentTypes, parts) },
    {
      name: '_rels/.rels',
      data: relsXml([
        `<Relationship Id="rId1" Type="${OFFICE_REL}/officeDocument" Target="word/document.xml"/>`,
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>',
        `<Relationship Id="rId3" Type="${OFFICE_REL}/extended-properties" Target="docProps/app.xml"/>`,
      ]),
    },
    { name: 'word/_rels/document.xml.rels', data: relsXml(docRels) },
    ...[...relFiles].map(([name, data]) => ({ name, data })),
    ...[...parts].map(([name, data]) => ({ name, data })),
  ]
  return zipStore(files, new Date(), { deflate: true })
}

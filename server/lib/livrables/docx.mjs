/**
 * Document Word (.docx) minimal, sans dépendance, à partir du Markdown d'un livrable.
 *   markdownToDocx(md, { title, author }) → Buffer
 * Contenu : titres (styles Titre 1 à 3 de Word), paragraphes, listes à puces et numérotées, tableaux
 * avec ligne d'en-tête répétée, citations, code, liens externes. Format A4, marges 2 cm.
 */
import { parseMarkdown } from './render.mjs'
import { zipStore } from './zip.mjs'

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'

function xml(s) {
  return String(s ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}

function createBuilder() {
  const rels = []
  const lists = [] // instances de numérotation : 'bullet' | 'decimal'
  return {
    rels,
    lists,
    link(url) {
      const id = `rIdL${rels.length + 1}`
      rels.push({ id, url })
      return id
    },
    newList(kind) {
      lists.push(kind)
      return lists.length
    },
  }
}

function runXml(r, extra = '') {
  const props = []
  if (r.b) props.push('<w:b/>')
  if (r.i) props.push('<w:i/>')
  if (r.code) props.push('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:shd w:val="clear" w:color="auto" w:fill="F2F4F8"/>')
  if (/^\[À compléter/.test(r.text)) props.push('<w:highlight w:val="yellow"/>')
  const rPr = props.length || extra ? `<w:rPr>${extra}${props.join('')}</w:rPr>` : ''
  return `<w:r>${rPr}<w:t xml:space="preserve">${xml(r.text)}</w:t></w:r>`
}

function inlinesXml(runs, b, extraRun = '') {
  return runs.map((r) => {
    if (r.href && /^(https?:|mailto:)/i.test(r.href)) {
      return `<w:hyperlink r:id="${b.link(r.href)}" w:history="1">${runXml(r, '<w:rStyle w:val="Hyperlink"/>' + extraRun)}</w:hyperlink>`
    }
    return runXml(r, extraRun)
  }).join('')
}

function para(content, pPr = '') {
  return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${content}</w:p>`
}

function tableXml(t, b) {
  const cols = t.header.length || 1
  const width = 9638 // largeur utile A4 avec marges 2 cm (twips)
  const colW = Math.floor(width / cols)
  const cell = (runs, k, header) => {
    const jc = t.align[k] === 'right' ? 'right' : t.align[k] === 'center' ? 'center' : 'left'
    const shd = header ? '<w:shd w:val="clear" w:color="auto" w:fill="E8EDF5"/>' : ''
    return `<w:tc><w:tcPr><w:tcW w:w="${colW}" w:type="dxa"/>${shd}</w:tcPr>${para(inlinesXml(runs, b, header ? '<w:b/>' : ''), `<w:pStyle w:val="Tableau"/><w:jc w:val="${jc}"/>`)}</w:tc>`
  }
  const head = `<w:tr><w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>${t.header.map((c, k) => cell(c, k, true)).join('')}</w:tr>`
  const rows = t.rows.map((r) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${r.map((c, k) => cell(c, k, false)).join('')}</w:tr>`).join('')
  return `<w:tbl><w:tblPr><w:tblStyle w:val="GrilleTableau"/><w:tblW w:w="5000" w:type="pct"/><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>` +
    `<w:tblGrid>${Array.from({ length: cols }, () => `<w:gridCol w:w="${colW}"/>`).join('')}</w:tblGrid>${head}${rows}</w:tbl>` +
    para('', '<w:spacing w:after="0"/>')
}

function blocksXml(blocks, b, quoted = false) {
  const q = quoted ? '<w:pStyle w:val="Citation"/>' : ''
  return blocks.map((blk) => {
    switch (blk.type) {
      case 'heading': {
        const level = Math.min(blk.level, 3)
        return para(inlinesXml(blk.inlines, b), `<w:pStyle w:val="Titre${level}"/>`)
      }
      case 'paragraph': return para(inlinesXml(blk.inlines, b), q)
      case 'hr': return para('', '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="B8C2D3"/></w:pBdr>')
      case 'code': return blk.text.split('\n').map((l) => para(runXml({ text: l, code: true }), '<w:pStyle w:val="Code"/>')).join('')
      case 'quote': return blocksXml(blk.blocks, b, true)
      case 'table': return tableXml(blk, b)
      case 'list': {
        const numBullet = b.newList('bullet')
        const numDecimal = b.newList('decimal')
        return blk.items.map((it) => para(inlinesXml(it.inlines, b),
          `<w:pStyle w:val="Liste"/><w:numPr><w:ilvl w:val="${it.level}"/><w:numId w:val="${it.ordered ? numDecimal : numBullet}"/></w:numPr>`)).join('')
      }
      default: return ''
    }
  }).join('')
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${NS}>
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="21"/><w:szCs w:val="21"/><w:lang w:val="fr-FR"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="100" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Titre1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="160"/><w:pBdr><w:bottom w:val="single" w:sz="12" w:space="4" w:color="1F3A68"/></w:pBdr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="1F3A68"/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Titre2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="320" w:after="120"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="1F3A68"/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Titre3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:color w:val="2B4C80"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Liste"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="40"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Tableau"><w:name w:val="Texte de tableau"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Citation"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="360"/><w:pBdr><w:left w:val="single" w:sz="12" w:space="8" w:color="B8C2D3"/></w:pBdr></w:pPr><w:rPr><w:color w:val="4A5568"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="18"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="1F5FBF"/><w:u w:val="single"/></w:rPr></w:style>
<w:style w:type="table" w:styleId="GrilleTableau"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="B8C2D3"/><w:left w:val="single" w:sz="4" w:space="0" w:color="B8C2D3"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="B8C2D3"/><w:right w:val="single" w:sz="4" w:space="0" w:color="B8C2D3"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="B8C2D3"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="B8C2D3"/></w:tblBorders><w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
</w:styles>`

function numberingXml(lists) {
  const lvl = (kind, i) => kind === 'bullet'
    ? `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="${['•', '◦', '▪', '•'][i]}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${360 + i * 360}" w:hanging="360"/></w:pPr></w:lvl>`
    : `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${['decimal', 'lowerLetter', 'lowerRoman', 'decimal'][i]}"/><w:lvlText w:val="%${i + 1}."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${360 + i * 360}" w:hanging="360"/></w:pPr></w:lvl>`
  const abstract = (id, kind) => `<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="hybridMultilevel"/>${[0, 1, 2, 3].map((i) => lvl(kind, i)).join('')}</w:abstractNum>`
  // Une instance par liste : la numérotation repart à 1 pour chaque liste numérotée.
  const nums = lists.map((kind, k) => `<w:num w:numId="${k + 1}"><w:abstractNumId w:val="${kind === 'bullet' ? 0 : 1}"/>${kind === 'decimal' ? '<w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride>' : ''}</w:num>`).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:numbering ${NS}>${abstract(0, 'bullet')}${abstract(1, 'decimal')}${nums}</w:numbering>`
}

export function markdownToDocx(md, { title = 'Livrable', author = 'Wizard QA' } = {}) {
  const b = createBuilder()
  const body = blocksXml(parseMarkdown(md), b)
  const sect = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>'
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${NS}><w:body>${body || para('')}${sect}</w:body></w:document>`
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rIdNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
${b.rels.map((r) => `<Relationship Id="${r.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xml(r.url)}" TargetMode="External"/>`).join('\n')}
</Relationships>`
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${xml(title)}</dc:title><dc:creator>${xml(author)}</dc:creator><dc:language>fr-FR</dc:language>
<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`
  return zipStore([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rootRels },
    { name: 'docProps/core.xml', data: core },
    { name: 'word/document.xml', data: document },
    { name: 'word/styles.xml', data: STYLES },
    { name: 'word/numbering.xml', data: numberingXml(b.lists) },
    { name: 'word/_rels/document.xml.rels', data: docRels },
  ])
}

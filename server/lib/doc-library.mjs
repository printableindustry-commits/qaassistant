import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import {
  PATH_CFG,
  REPO_ROOT,
  docReportRel,
  relPath,
} from './paths.mjs'
import { extractDocxText } from './docx-text-extract.mjs'
import { syncDocxPlainText } from './docx-text-sync.mjs'

const LIB_DIR = path.dirname(fileURLToPath(import.meta.url))
const OVERRIDES_DIR = PATH_CFG.livrablesOverridesDir

const LIVRABLE_LABELS = {
  '00': 'Index pack livrables QA',
  '01': 'Plan de test / stratégie QA Cypress',
  '02': 'Référentiel exigences testables',
  '03': 'Matrice de traçabilité QA',
  '04': 'Cas de test fonctionnels',
  '05': 'Scénarios E2E Gherkin',
  '06': 'Campagne de test RC',
  '07': 'Rapports anomalies',
  '08': 'Jeux de données de test',
  '09': 'PV recette / bilan QA',
  '10': 'Checklist non-régression',
  '11': 'Rapport couverture tests',
  '12': 'Documentation automation Cypress',
}

function absFromRepo(rel) {
  const normalized = rel.replace(/\\/g, '/')
  const full = path.resolve(REPO_ROOT, normalized)
  const root = path.resolve(REPO_ROOT)
  if (!full.toLowerCase().startsWith(root.toLowerCase())) throw new Error('Chemin hors dépôt')
  return full
}

function fileKind(name) {
  const ext = path.extname(name).toLowerCase()
  if (ext === '.docx') return 'docx'
  if (ext === '.md') return 'markdown'
  if (ext === '.json') return 'json'
  if (ext === '.csv') return 'csv'
  return 'text'
}

function editModeForKind(kind) {
  if (kind === 'docx') return 'docx'
  if (kind === 'text' || kind === 'markdown' || kind === 'json' || kind === 'csv') return 'text'
  return 'readonly'
}

function slugId(name) {
  return name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()
}

function overridePath(docId) {
  return path.join(REPO_ROOT, OVERRIDES_DIR, `${docId}.instructions.md`)
}

function statDoc(rel, meta) {
  const full = absFromRepo(rel)
  const exists = fs.existsSync(full)
  const st = exists ? fs.statSync(full) : null
  const ov = fs.existsSync(overridePath(meta.id))
  return {
    ...meta,
    path: rel.replace(/\\/g, '/'),
    exists,
    size: st?.size ?? 0,
    modifiedAt: st?.mtime?.toISOString() ?? null,
    hasOverride: ov,
  }
}

/** Fichiers à la racine du dossier Livrables (comme l’explorateur VS Code) */
function listLivrablesRootFiles() {
  const relDir = PATH_CFG.livrablesDir
  const dir = absFromRepo(relDir)
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter(f => {
      const full = path.join(dir, f)
      try {
        return fs.statSync(full).isFile() && /\.(docx|csv|md)$/i.test(f)
      } catch {
        return false
      }
    })
    .sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }))
    .map(file => {
      const num = file.match(/^(\d{2})_/)?.[1]
      const kind = fileKind(file)
      const id = num ? `livrable-${num}` : `livrable-${slugId(file)}`
      return statDoc(`${relDir}/${file}`, {
        id,
        file,
        title: num ? (LIVRABLE_LABELS[num] || file) : file,
        category: 'livrables-dir',
        kind,
        editMode: editModeForKind(kind),
        description: num
          ? `Livrable Word ${num}`
          : 'Fichier à la racine du dossier Livrables',
      })
    })
}

function listModeleFiles() {
  const relDir = PATH_CFG.templateDir
  const dir = absFromRepo(relDir)
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter(f => fs.statSync(path.join(dir, f)).isFile() && /\.(docx|md)$/i.test(f))
    .sort()
    .map(file => {
      const kind = fileKind(file)
      const baseId = file === 'modele_livrable_CA-TS.docx' ? 'template-cats'
        : file === 'PROMPT_MAJ_LIVRABLES_QA.md' ? 'prompt-guide'
          : file === 'README.md' ? 'template-readme'
            : `modele-${slugId(file)}`
      const titles = {
        'modele_livrable_CA-TS.docx': 'Gabarit Word CA-TS',
        'PROMPT_MAJ_LIVRABLES_QA.md': 'Guide prompt IA',
        'README.md': 'README gabarit CA-TS',
      }
      return statDoc(`${relDir}/${file}`, {
        id: baseId,
        file,
        title: titles[file] || file,
        category: 'modele',
        kind,
        editMode: editModeForKind(kind),
        description: 'Sous-dossier modele_livrable_CA-TS',
      })
    })
}

export function listDocumentCatalog() {
  const livrablesRoot = listLivrablesRootFiles()
  const modeleDocs = listModeleFiles()

  const staticDocs = [
    statDoc(relPath(PATH_CFG.docQaDir, PATH_CFG.scanConfigFile), {
      id: 'scan-config',
      file: PATH_CFG.scanConfigFile,
      title: 'Configuration scan projet',
      category: 'config',
      kind: 'json',
      editMode: 'text',
      description: 'Paramètres du parcours VS Code (générique multi-projets)',
    }),
    statDoc(relPath(PATH_CFG.docQaDir, PATH_CFG.scanProjectScript), {
      id: 'scan-script',
      file: PATH_CFG.scanProjectScript,
      title: 'Script scan-project.mjs',
      category: 'config',
      kind: 'text',
      editMode: 'readonly',
      description: 'Script de génération du snapshot (lecture seule)',
    }),
    statDoc(docReportRel(PATH_CFG.snapshotMdFile), {
      id: 'snapshot-md',
      file: PATH_CFG.snapshotMdFile,
      title: 'Snapshot projet (Markdown)',
      category: 'generated',
      kind: 'markdown',
      editMode: 'readonly',
      description: 'Généré par « Snapshot projet » — source de vérité pour l’IA',
    }),
    statDoc(docReportRel(PATH_CFG.snapshotJsonFile), {
      id: 'snapshot-json',
      file: PATH_CFG.snapshotJsonFile,
      title: 'Snapshot projet (JSON)',
      category: 'generated',
      kind: 'json',
      editMode: 'readonly',
      description: 'Inventaire machine complet des .feature',
    }),
    statDoc(docReportRel(PATH_CFG.docGapsFile), {
      id: 'gaps-md',
      file: PATH_CFG.docGapsFile,
      title: 'Rapport d’écarts documentation',
      category: 'generated',
      kind: 'markdown',
      editMode: 'readonly',
      description: 'Écarts hook / Cypress / JIRA',
    }),
  ]

  const generatedDocs = staticDocs.filter(d => d.category === 'generated')
  const configDocs = staticDocs.filter(d => d.category === 'config')
  const allDocs = [...livrablesRoot, ...modeleDocs, ...configDocs, ...generatedDocs]

  const categories = [
    {
      id: 'livrables-dir',
      label: PATH_CFG.livrablesDir,
      hint: `${livrablesRoot.length} fichier(s) à la racine (00–12 + CSV…)`,
    },
    {
      id: 'modele',
      label: `${PATH_CFG.livrablesDir}/${path.basename(PATH_CFG.templateDir)}`,
      hint: 'Gabarit Word + prompt',
    },
    { id: 'config', label: 'Configuration & scripts', hint: '' },
    { id: 'generated', label: 'Fichiers générés (doc-reports)', hint: '' },
  ].map(c => ({
    ...c,
    documents: allDocs.filter(d => d.category === c.id),
  }))

  return {
    overridesDir: OVERRIDES_DIR,
    livrablesDir: PATH_CFG.livrablesDir,
    livrablesRootCount: livrablesRoot.length,
    categories,
    documents: allDocs,
    livrablesRoot,
  }
}

function findDocument(docId) {
  const doc = listDocumentCatalog().documents.find(d => d.id === docId)
  if (!doc) throw new Error(`Document inconnu : ${docId}`)
  return doc
}

export function readDocument(docId) {
  const doc = findDocument(docId)
  const full = absFromRepo(doc.path)
  if (!doc.exists) {
    return {
      ...doc,
      content: '',
      preview: '(fichier absent)',
      override: readOverride(docId),
      downloadable: false,
    }
  }

  let content = null
  let preview = null

  if (doc.kind === 'docx') {
    preview = extractDocxText(full)
    if (!preview) {
      preview = '(aperçu indisponible — redémarrez le serveur Wizard QA après mise à jour de l’extension, ou ouvrez le fichier dans Word)'
    }
    content = preview.startsWith('(') ? '' : preview
  } else {
    content = fs.readFileSync(full, 'utf8')
    preview = content
  }

  return {
    ...doc,
    content,
    preview,
    override: readOverride(docId),
    downloadable: true,
  }
}

export function readOverride(docId) {
  findDocument(docId)
  const p = overridePath(docId)
  if (!fs.existsSync(p)) return ''
  return fs.readFileSync(p, 'utf8')
}

export function saveOverride(docId, text) {
  findDocument(docId)
  const dir = path.join(REPO_ROOT, OVERRIDES_DIR)
  fs.mkdirSync(dir, { recursive: true })
  const p = overridePath(docId)
  fs.writeFileSync(p, text ?? '', 'utf8')
  return { ok: true, path: path.join(OVERRIDES_DIR, `${docId}.instructions.md`) }
}

export function saveDocumentText(docId, content) {
  const doc = findDocument(docId)
  if (doc.editMode !== 'text') throw new Error('Ce document n’est pas éditable en texte intégral')
  const full = absFromRepo(doc.path)
  const backup = `${full}.bak-wizard`
  if (fs.existsSync(full) && !fs.existsSync(backup)) {
    fs.copyFileSync(full, backup)
  }
  fs.writeFileSync(full, content, 'utf8')
  return { ok: true, path: doc.path, backup: fs.existsSync(backup) ? `${doc.path}.bak-wizard` : null }
}

export function saveDocumentDocxText(docId, content) {
  const doc = findDocument(docId)
  if (doc.kind !== 'docx') throw new Error('Synchronisation Word réservée aux fichiers .docx')
  const full = absFromRepo(doc.path)
  if (!doc.exists) throw new Error('Fichier Word absent')
  const result = syncDocxPlainText(full, content ?? '')
  return {
    ok: true,
    path: doc.path,
    backup: result.backupPath ? path.relative(REPO_ROOT, result.backupPath).replace(/\\/g, '/') : null,
    stats: {
      paragraphsUpdated: result.paragraphsUpdated,
      paragraphsAdded: result.paragraphsAdded,
      paragraphsCleared: result.paragraphsCleared,
    },
  }
}

export function uploadDocumentBinary(docId, buffer) {
  const doc = findDocument(docId)
  if (doc.kind !== 'docx') throw new Error('Upload réservé aux fichiers Word (.docx)')
  const full = absFromRepo(doc.path)
  const backup = `${full}.bak-wizard`
  if (fs.existsSync(full)) fs.copyFileSync(full, backup)
  fs.writeFileSync(full, buffer)
  return { ok: true, path: doc.path, backup: `${doc.path}.bak-wizard`, size: buffer.length }
}

export function getDocumentDownloadPath(docId) {
  const doc = findDocument(docId)
  if (!doc.exists) throw new Error('Fichier absent')
  return { abs: absFromRepo(doc.path), ...doc }
}

export function loadAllOverridesForPrompt() {
  const dir = path.join(REPO_ROOT, OVERRIDES_DIR)
  if (!fs.existsSync(dir)) return ''
  const catalog = listDocumentCatalog()
  const parts = []
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.instructions.md'))) {
    const docId = f.replace(/\.instructions\.md$/, '')
    const doc = catalog.documents.find(d => d.id === docId)
    const title = doc?.title || docId
    const body = fs.readFileSync(path.join(dir, f), 'utf8').trim()
    if (body) parts.push(`### ${title} (\`${doc?.file || docId}\`)\n\n${body}`)
  }
  if (!parts.length) return ''
  return `## Instructions permanentes — éditeur wizard (prioritaires sur le contenu par défaut)\n\n${parts.join('\n\n')}`
}

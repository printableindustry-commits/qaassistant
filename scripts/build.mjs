#!/usr/bin/env node
/**
 * Build Wizard QA : l'appli web ET l'extension VS Code, à partir du même code (server/).
 *
 *   node scripts/build.mjs         vérification + web + extension (npm run build, hook pre-commit)
 *   node scripts/build.mjs check   node --check de server/ et scripts/
 *   node scripts/build.mjs web     vérification + dist/web/wizard-qa-web-<version>.zip
 *   node scripts/build.mjs ext     vérification + vsix/wizard-qa-<version>.vsix
 *
 * Aucune dépendance hors devDependencies (typescript, @vscode/vsce).
 */
import { spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import zlib from 'zlib'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SERVER_DIR = path.join(ROOT, 'server')
const MEDIA_DIR = path.join(ROOT, 'media')
const EXT_DIR = path.join(ROOT, 'vscode-extension')
const VSIX_DIR = path.join(ROOT, 'vsix')
const WEB_DIST = path.join(ROOT, 'dist', 'web')
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version

// Jamais de données ni de dépendances dans les livrables
const EXCLUDED_NAMES = new Set(['node_modules', 'workspace', '.wizard-qa', '.git', '.DS_Store', 'Thumbs.db'])
const excluded = (name) => EXCLUDED_NAMES.has(name) || name.endsWith('.log')

// Fins de ligne : le contenu des livrables ne doit pas dépendre de core.autocrlf (Windows / Linux / clone).
const TEXT_EXT = new Set(['.mjs', '.js', '.cjs', '.ts', '.json', '.jsonc', '.html', '.css', '.md', '.txt', '.svg', '.yml', '.yaml', '.template', '.sh', '.feature', '.csv', '.xml'])

/** Contenu d'un fichier source, fins de ligne CRLF ramenées à LF pour les fichiers texte. */
function readSource(file) {
  const data = fs.readFileSync(file)
  if (!TEXT_EXT.has(path.extname(file).toLowerCase()) || data.includes(0)) return data
  return Buffer.from(data.toString('utf8').replace(/\r\n/g, '\n'), 'utf8')
}

/** Copie un dossier (sans les exclusions) en normalisant les fins de ligne. */
function copySources(src, dest) {
  for (const f of walk(src)) {
    const target = path.join(dest, f)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, readSource(path.join(src, f)))
  }
}

function log(msg) {
  console.log(`[build] ${msg}`)
}

/** Fichiers d'un dossier (chemins relatifs « / »), sans les exclusions. */
function walk(dir, rel = '', out = []) {
  for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    if (excluded(entry.name)) continue
    const child = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.isDirectory()) walk(dir, child, out)
    else if (entry.isFile()) out.push(child)
  }
  return out
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, ...opts })
    let output = ''
    child.stdout.on('data', (d) => { output += d })
    child.stderr.on('data', (d) => { output += d })
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve(output) : reject(new Error(`${path.basename(cmd)} ${path.basename(args[0] || '')} a échoué (code ${code})\n${output.trim()}`))))
  })
}

// --------------------------------------------------------------------------- vérification

async function check() {
  const files = [
    ...walk(SERVER_DIR).map((f) => path.join(SERVER_DIR, f)),
    ...walk(path.join(ROOT, 'scripts')).map((f) => path.join(ROOT, 'scripts', f)),
  ].filter((f) => /\.(mjs|js)$/.test(f))
  const errors = []
  let next = 0
  const worker = async () => {
    while (next < files.length) {
      const file = files[next++]
      try {
        await run(process.execPath, ['--check', file])
      } catch (err) {
        errors.push(`${path.relative(ROOT, file)} :\n${err.message}`)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(8, os.cpus().length || 2) }, worker))
  if (errors.length) throw new Error(`Erreurs de syntaxe :\n${errors.join('\n\n')}`)
  log(`node --check : ${files.length} fichiers OK`)
}

// --------------------------------------------------------------------------- appli web

const START_CMD = '@echo off\r\ncd /d "%~dp0"\r\nnode server\\portail.mjs\r\n'
const START_SH = '#!/bin/sh\ncd "$(dirname "$0")" && exec node server/portail.mjs\n'
const WEB_README = `# Wizard QA ${VERSION} — appli web

Prérequis : Node.js 22 ou plus (aucune dépendance npm).

- Windows : double-cliquez sur start.cmd
- Linux / macOS : ./start.sh
- ou : node server/portail.mjs

Ouvrez ensuite http://127.0.0.1:3920/ (compte de démonstration demo / demo, à changer dans Réglages).
Les données sont écrites dans ./workspace (créé au premier lancement).
Variables utiles : PORTAIL_PORT, PORTAIL_HOST, PORTAIL_ALLOWED_HOSTS, PORTAIL_NO_BROWSER=1, WIZARD_REPO_ROOT.
`

async function buildWeb() {
  const top = `wizard-qa-web-${VERSION}`
  const entries = walk(SERVER_DIR).map((f) => ({ name: `${top}/server/${f}`, data: readSource(path.join(SERVER_DIR, f)) }))
  const manifest = { name: 'wizard-qa-web', version: VERSION, private: true, scripts: { start: 'node server/portail.mjs' } }
  entries.push(
    { name: `${top}/package.json`, data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`) },
    { name: `${top}/README.md`, data: Buffer.from(WEB_README) },
    { name: `${top}/start.cmd`, data: Buffer.from(START_CMD) },
    { name: `${top}/start.sh`, data: Buffer.from(START_SH), mode: 0o755 }
  )
  fs.mkdirSync(WEB_DIST, { recursive: true })
  for (const old of fs.readdirSync(WEB_DIST)) {
    if (old.endsWith('.zip')) fs.rmSync(path.join(WEB_DIST, old))
  }
  const target = path.join(WEB_DIST, `${top}.zip`)
  fs.writeFileSync(target, zip(entries))
  log(`web : ${path.relative(ROOT, target)} (${entries.length} fichiers, ${kb(fs.statSync(target).size)})`)
}

// --------------------------------------------------------------------------- extension VS Code

async function buildExt() {
  // Une seule version : celle du package.json racine
  const extPkgPath = path.join(EXT_DIR, 'package.json')
  const extPkg = JSON.parse(fs.readFileSync(extPkgPath, 'utf8'))
  if (extPkg.version !== VERSION) {
    extPkg.version = VERSION
    fs.writeFileSync(extPkgPath, `${JSON.stringify(extPkg, null, 2)}\n`)
    log(`vscode-extension/package.json : version ${VERSION}`)
  }

  for (const dir of ['out', 'server', 'media']) fs.rmSync(path.join(EXT_DIR, dir), { recursive: true, force: true })
  await run(process.execPath, [path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', EXT_DIR])
  log('extension : TypeScript compilé')

  copySources(SERVER_DIR, path.join(EXT_DIR, 'server'))
  copySources(MEDIA_DIR, path.join(EXT_DIR, 'media'))
  const extReadme = path.join(EXT_DIR, 'README.md')
  fs.writeFileSync(extReadme, readSource(extReadme))

  fs.mkdirSync(VSIX_DIR, { recursive: true })
  const target = path.join(VSIX_DIR, `wizard-qa-${VERSION}.vsix`)
  const previous = fs.existsSync(target) ? fs.readFileSync(target) : null
  await run(process.execPath, [
    path.join(ROOT, 'node_modules', '@vscode', 'vsce', 'vsce'),
    'package', '--no-dependencies', '--allow-missing-repository', '--skip-license', '--out', target,
  ], { cwd: EXT_DIR })

  // Contenu inchangé (seules les dates diffèrent) : on garde l'ancien fichier pour ne pas grossir l'historique Git.
  let note = ''
  if (previous && zipFingerprint(previous) === zipFingerprint(fs.readFileSync(target))) {
    fs.writeFileSync(target, previous)
    note = ', contenu inchangé'
  }
  for (const old of fs.readdirSync(VSIX_DIR)) {
    if (old.endsWith('.vsix') && path.join(VSIX_DIR, old) !== target) {
      fs.rmSync(path.join(VSIX_DIR, old))
      log(`ancien paquet supprimé : vsix/${old}`)
    }
  }
  log(`extension : ${path.relative(ROOT, target)} (${kb(fs.statSync(target).size)}${note})`)
}

// --------------------------------------------------------------------------- zip (sans dépendance)

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** Archive zip déterministe (date fixe : même contenu → même fichier). */
function zip(entries) {
  const DOS_TIME = 0
  const DOS_DATE = ((2024 - 1980) << 9) | (1 << 5) | 1
  const locals = []
  const centrals = []
  let offset = 0
  for (const { name, data, mode = 0o644 } of entries) {
    const nameBuf = Buffer.from(name, 'utf8')
    const deflated = zlib.deflateRawSync(data, { level: 9 })
    const stored = deflated.length >= data.length
    const body = stored ? data : deflated
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6) // noms en UTF-8
    local.writeUInt16LE(stored ? 0 : 8, 8)
    local.writeUInt16LE(DOS_TIME, 10)
    local.writeUInt16LE(DOS_DATE, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    locals.push(local, nameBuf, body)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE((3 << 8) | 20, 4) // créé « Unix » : conserve le mode (start.sh exécutable)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(stored ? 0 : 8, 10)
    central.writeUInt16LE(DOS_TIME, 12)
    central.writeUInt16LE(DOS_DATE, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE(((0o100000 | mode) << 16) >>> 0, 38)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, nameBuf)
    offset += local.length + nameBuf.length + body.length
  }
  const cd = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, end])
}

/** Empreinte d'un zip hors dates : noms, CRC et tailles du répertoire central. */
function zipFingerprint(buf) {
  let eocd = buf.length - 22
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--
  if (eocd < 0) return ''
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  const items = []
  for (let i = 0; i < count && buf.readUInt32LE(p) === 0x02014b50; i++) {
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    items.push(`${name}:${buf.readUInt32LE(p + 16)}:${buf.readUInt32LE(p + 24)}`)
    p += 46 + nameLen + extraLen + commentLen
  }
  return items.sort().join('\n')
}

function kb(bytes) {
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} Mo` : `${Math.round(bytes / 1024)} Ko`
}

// --------------------------------------------------------------------------- point d'entrée

const target = process.argv[2] || 'all'
const started = Date.now()
try {
  if (!['all', 'check', 'web', 'ext'].includes(target)) throw new Error(`Cible inconnue : ${target} (all, check, web, ext)`)
  await check()
  if (target === 'all' || target === 'web') await buildWeb()
  if (target === 'all' || target === 'ext') await buildExt()
  log(`terminé en ${((Date.now() - started) / 1000).toFixed(1)} s`)
} catch (err) {
  console.error(`[build] ÉCHEC : ${err.message}`)
  process.exit(1)
}

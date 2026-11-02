import { createWriteStream } from 'fs'
import fs from 'fs'
import http from 'http'
import https from 'https'
import path from 'path'
import { spawnSync } from 'child_process'
import { pipeline } from 'stream/promises'
import { fileURLToPath } from 'url'
import { REPAIR_DIR } from './paths.mjs'

const LIB_DIR = path.dirname(fileURLToPath(import.meta.url))
const VENDOR = path.join(REPAIR_DIR, 'vendor')

export function getVendorUrls(versions = {}) {
  const node = versions.node || '22.13.0'
  const npm = versions.npm || '10.9.0'
  const cypress = versions.cypress || '14.0.3'
  const nodeZip = `node-v${node}-win-x64.zip`
  const cypressZip = `cypress-${cypress}-win32-x64.zip`
  return {
    node: {
      url: `https://nodejs.org/dist/v${node}/${nodeZip}`,
      format: `ZIP Windows x64 — ${nodeZip}`,
      destZip: path.join(VENDOR, nodeZip),
      destDir: path.join(VENDOR, 'node'),
      check: path.join(VENDOR, 'node', 'node.exe'),
    },
    npm: {
      url: `https://nodejs.org/dist/v${node}/${nodeZip}`,
      format: `Inclus dans le ZIP Node (npm.cmd + npm ${npm} embarqué) — pas de fichier séparé`,
      destDir: path.join(VENDOR, 'node'),
      check: path.join(VENDOR, 'node', 'npm.cmd'),
      note: `Version cible npm ${npm} — vérifiée après extraction Node`,
    },
    cypress: {
      url: `https://download.cypress.io/desktop/${cypress}?platform=win32&arch=x64`,
      format: `ZIP Windows x64 — ${cypressZip}`,
      destZip: path.join(VENDOR, 'cypress', cypressZip),
      marker: path.join(VENDOR, 'cypress', `${cypressZip}.ok`),
      check: path.join(VENDOR, 'cypress', cypressZip),
    },
    nodeModules: {
      url: '(poste connecté) npm ci à la racine du dépôt puis archiver',
      format: 'vendor/node_modules.tgz — archive tar.gz des dépendances projet',
      dest: path.join(VENDOR, 'node_modules.tgz'),
      check: path.join(VENDOR, 'node_modules.tgz'),
    },
  }
}

export function getVendorStatus(versions = {}) {
  const urls = getVendorUrls(versions)
  let npmVersion = null
  let npmOk = fs.existsSync(urls.npm.check)
  if (npmOk) {
    const npmCheck = spawnSync(urls.npm.check, ['-v'], {
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
      cwd: path.dirname(urls.npm.check),
    })
    npmVersion = npmCheck.stdout?.trim() || null
    npmOk = npmCheck.status === 0 || !!npmVersion
  }
  return {
    node: {
      ok: fs.existsSync(urls.node.check),
      path: urls.node.check,
      zipPresent: fs.existsSync(urls.node.destZip),
      ...urls.node,
    },
    npm: {
      ok: npmOk,
      version: npmVersion,
      path: urls.npm.check,
      ...urls.npm,
    },
    cypress: {
      ok: fs.existsSync(urls.cypress.check) || fs.existsSync(urls.cypress.marker),
      path: urls.cypress.check,
      marker: urls.cypress.marker,
      ...urls.cypress,
    },
    nodeModules: {
      ok: fs.existsSync(urls.nodeModules.check),
      sizeMb: fs.existsSync(urls.nodeModules.check)
        ? Math.round(fs.statSync(urls.nodeModules.check).size / 1024 / 1024)
        : 0,
      ...urls.nodeModules,
    },
  }
}

export function checkProjectPackage(projectRoot) {
  const root = path.resolve(projectRoot || path.join(REPAIR_DIR, '../..'))
  const pkgPath = path.join(root, 'package.json')
  const lockPath = path.join(root, 'package-lock.json')
  const result = {
    projectRoot: root,
    packageJson: { exists: false, path: pkgPath, voltaNode: null, valid: false, error: null },
    packageLock: { exists: false, path: lockPath },
  }
  result.packageLock.exists = fs.existsSync(lockPath)
  if (!fs.existsSync(pkgPath)) {
    result.packageJson.error = 'package.json absent à la racine du projet'
    return result
  }
  result.packageJson.exists = true
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
    result.packageJson.valid = true
    result.packageJson.voltaNode = pkg.volta?.node ?? null
    result.packageJson.name = pkg.name ?? null
    result.packageJson.hasDevDeps = !!(pkg.devDependencies?.cypress || pkg.dependencies?.cypress)
  } catch (e) {
    result.packageJson.error = `package.json invalide : ${e.message}`
  }
  return result
}

export function ensurePackageJson(projectRoot, nodeVersion) {
  const check = checkProjectPackage(projectRoot)
  if (check.packageJson.exists && check.packageJson.valid) {
    return { ok: true, created: false, path: check.packageJson.path, check }
  }
  const pkgPath = check.packageJson.path
  const minimal = {
    name: path.basename(path.resolve(projectRoot)) || 'cypress-project',
    private: true,
    version: '1.0.0',
    scripts: { start: 'cypress open', 'cypress-run': 'cypress run --headless' },
    devDependencies: { cypress: '^14.0.3' },
    volta: { node: nodeVersion || '22.13.0' },
  }
  fs.writeFileSync(pkgPath, `${JSON.stringify(minimal, null, '\t')}\n`, 'utf8')
  return { ok: true, created: true, path: pkgPath, check: checkProjectPackage(projectRoot) }
}

export function removePackageLock(projectRoot) {
  const lockPath = path.join(path.resolve(projectRoot), 'package-lock.json')
  if (!fs.existsSync(lockPath)) return { ok: true, removed: false, path: lockPath }
  fs.unlinkSync(lockPath)
  return { ok: true, removed: true, path: lockPath }
}

function extractZip(zipPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true })
  if (process.platform === 'win32') {
    const ps = `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`
    const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' })
    if (r.status !== 0) throw new Error(r.stderr || r.stdout || 'Expand-Archive échoué')
    return
  }
  const r = spawnSync('unzip', ['-o', zipPath, '-d', destDir], { encoding: 'utf8' })
  if (r.status !== 0) {
    const t = spawnSync('tar', ['-xf', zipPath, '-C', destDir], { encoding: 'utf8' })
    if (t.status !== 0) throw new Error('Extraction zip échouée')
  }
}

function flattenNodeExtract(extractDir, version) {
  const folder = path.join(extractDir, `node-v${version}-win-x64`)
  const target = path.join(VENDOR, 'node')
  if (fs.existsSync(path.join(target, 'node.exe'))) {
    fs.rmSync(target, { recursive: true, force: true })
  }
  fs.mkdirSync(path.dirname(target), { recursive: true })
  if (fs.existsSync(folder)) {
    fs.renameSync(folder, target)
  } else {
    const entries = fs.readdirSync(extractDir).filter(e => e.startsWith('node-v'))
    if (!entries.length) throw new Error('Dossier node extrait introuvable dans le ZIP')
    fs.renameSync(path.join(extractDir, entries[0]), target)
  }
}

export async function importNodeZip(sourcePath, version) {
  const v = version || '22.13.0'
  const zipName = `node-v${v}-win-x64.zip`
  const destZip = path.join(VENDOR, zipName)
  fs.mkdirSync(VENDOR, { recursive: true })
  fs.copyFileSync(sourcePath, destZip)
  const extractDir = path.join(VENDOR, '_extract-node-upload')
  if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true, force: true })
  extractZip(destZip, extractDir)
  flattenNodeExtract(extractDir, v)
  fs.rmSync(extractDir, { recursive: true, force: true })
  const nodeExe = path.join(VENDOR, 'node', 'node.exe')
  if (!fs.existsSync(nodeExe)) throw new Error('node.exe introuvable après extraction')
  const ver = spawnSync(nodeExe, ['-v'], { encoding: 'utf8' })
  return { ok: true, path: nodeExe, version: ver.stdout?.trim(), zip: destZip }
}

export async function importCypressZip(sourcePath, version) {
  const v = version || '14.0.3'
  const zipName = `cypress-${v}-win32-x64.zip`
  const destDir = path.join(VENDOR, 'cypress')
  const destZip = path.join(destDir, zipName)
  fs.mkdirSync(destDir, { recursive: true })
  fs.copyFileSync(sourcePath, destZip)
  fs.writeFileSync(path.join(destDir, `${zipName}.ok`), new Date().toISOString(), 'utf8')
  return { ok: true, path: destZip, sizeMb: Math.round(fs.statSync(destZip).size / 1024 / 1024) }
}

export async function importNodeModulesTgz(sourcePath) {
  const dest = path.join(VENDOR, 'node_modules.tgz')
  fs.mkdirSync(VENDOR, { recursive: true })
  fs.copyFileSync(sourcePath, dest)
  return { ok: true, path: dest, sizeMb: Math.round(fs.statSync(dest).size / 1024 / 1024) }
}

export async function saveUploadToTemp(file) {
  const tmpDir = path.join(REPAIR_DIR, '_upload-tmp')
  fs.mkdirSync(tmpDir, { recursive: true })
  const safe = (file.filename || 'upload.bin').replace(/[^\w.\-]+/g, '_')
  const dest = path.join(tmpDir, `${Date.now()}-${safe}`)
  await pipeline(file.stream, createWriteStream(dest))
  return dest
}

export function readBodyBuffer(req, limitMb = 512) {
  const limit = limitMb * 1024 * 1024
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > limit) {
        reject(new Error(`Fichier trop volumineux (max ${limitMb} Mo)`))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

export async function parseMultipart(req) {
  const ct = req.headers['content-type'] || ''
  if (!ct.includes('multipart/form-data')) throw new Error('Content-Type multipart/form-data requis')
  const m = ct.match(/boundary=(?:"([^"]+)"|([^;\s]+))/i)
  const boundary = m?.[1] || m?.[2]
  if (!boundary) throw new Error('Boundary multipart introuvable')

  const body = await readBodyBuffer(req)
  const delim = Buffer.from(`--${boundary}`)
  const fields = {}
  const files = {}

  let pos = 0
  while (pos < body.length) {
    const start = body.indexOf(delim, pos)
    if (start < 0) break
    const after = start + delim.length
    if (body[after] === 45 && body[after + 1] === 45) break
    const lineEnd = body.indexOf('\r\n', after)
    if (lineEnd < 0) break
    const headersRaw = body.slice(after + 2, lineEnd).toString('utf8')
    const dataStart = lineEnd + 4
    const next = body.indexOf(delim, dataStart)
    const partEnd = next > 0 ? next - 2 : body.length
    const data = body.slice(dataStart, partEnd)

    const nameM = headersRaw.match(/name="([^"]+)"/)
    const fileM = headersRaw.match(/filename="([^"]*)"/)
    const name = nameM?.[1]
    if (!name) { pos = next > 0 ? next : body.length; continue }

    if (fileM) {
      files[name] = { filename: fileM[1], data }
    } else {
      fields[name] = data.toString('utf8').replace(/\r\n$/, '')
    }
    pos = next > 0 ? next : body.length
  }
  return { fields, files }
}

export async function handleVendorUpload(req, versions) {
  const { fields, files } = await parseMultipart(req)
  const kind = fields.kind || 'node'
  const version = fields.version || versions?.node

  let tmpPath
  const file = files.file
  if (!file?.data?.length) throw new Error('Fichier manquant')

  const tmpDir = path.join(REPAIR_DIR, '_upload-tmp')
  fs.mkdirSync(tmpDir, { recursive: true })
  tmpPath = path.join(tmpDir, file.filename || `${kind}.bin`)
  fs.writeFileSync(tmpPath, file.data)

  try {
    if (kind === 'node') return await importNodeZip(tmpPath, fields.version || versions?.node)
    if (kind === 'cypress') return await importCypressZip(tmpPath, fields.version || versions?.cypress)
    if (kind === 'nodeModules') return await importNodeModulesTgz(tmpPath)
    throw new Error(`Type inconnu : ${kind}`)
  } finally {
    try { fs.unlinkSync(tmpPath) } catch { /* ignore */ }
  }
}

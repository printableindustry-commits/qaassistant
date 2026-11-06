import fs from 'fs'
import os from 'os'
import path from 'path'
import https from 'https'
import { spawnSync } from 'child_process'
import { createWriteStream } from 'fs'
import { pipeline } from 'stream/promises'
import { REPO_ROOT, SERVER_CONF_DIR } from './paths.mjs'
import { loadNpmInstallConfig } from './npm-install-config.mjs'

function expandEnvPath(p) {
  let s = String(p || '')
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
  s = s.replace(/%LOCALAPPDATA%/gi, local)
  s = s.replace(/%USERPROFILE%/gi, process.env.USERPROFILE || os.homedir())
  s = s.replace(/%HOMEDRIVE%%HOMEPATH%/gi, process.env.USERPROFILE || os.homedir())
  return path.resolve(s)
}

function getRuntimeConfig() {
  const config = loadNpmInstallConfig()
  const rt = config.runtime || {}
  return {
    targetNodeVersion: String(rt.targetNodeVersion || '22.12.0').replace(/^v/i, ''),
    targetNpmVersion: String(rt.targetNpmVersion || '10.9.0').replace(/^v/i, ''),
    nodeMajorMin: Number(rt.nodeMajorMin) || 20,
    nodeMajorMax: Number(rt.nodeMajorMax) || 26,
    voltaHome: expandEnvPath(rt.voltaHome || '%LOCALAPPDATA%\\Volta'),
    voltaNodeInventoryRel: rt.voltaNodeInventoryRel || 'tools/inventory/node',
    voltaNodeImageRel: rt.voltaNodeImageRel || 'tools/image/node',
    nodeDistBaseUrl: (rt.nodeDistBaseUrl || 'https://nodejs.org/dist').replace(/\/$/, ''),
    packageJsonTemplateFile: rt.packageJsonTemplateFile || 'package.json.cypress.template.json',
    voltaInstallShell: rt.voltaInstallShell
      || 'volta install node@{nodeVersion} & setx VOLTA_NODE_VERSION {nodeVersion} & volta install npm@bundle',
    projectPath: config.projectPath,
    projectDir: config.projectDir,
  }
}

function voltaNodeInventoryDir(rt, version = '') {
  const base = path.join(rt.voltaHome, rt.voltaNodeInventoryRel.replace(/\\/g, '/'))
  return version ? path.join(base, version.replace(/^v/i, '')) : base
}

function voltaNodeImageDir(rt, version = '') {
  const base = path.join(rt.voltaHome, rt.voltaNodeImageRel.replace(/\\/g, '/'))
  return version ? path.join(base, version.replace(/^v/i, '')) : base
}

function nodeExeInDir(dir) {
  for (const base of [dir, path.join(dir, 'bin')]) {
    const exe = path.join(base, 'node.exe')
    if (fs.existsSync(exe)) return exe
  }
  return null
}

function listVersionDirs(root) {
  if (!fs.existsSync(root)) return []
  try {
    return fs.readdirSync(root).filter((name) => {
      const p = path.join(root, name)
      return fs.statSync(p).isDirectory() && nodeExeInDir(p)
    })
  } catch {
    return []
  }
}

function runCmd(cmd, args, options = {}) {
  const { cwd = REPO_ROOT, env = process.env, shell = false } = options
  let output = `\n$ ${shell ? cmd : `${cmd} ${args.join(' ')}`}\n`
  try {
    const r = shell
      ? spawnSync(cmd, { cwd, env, encoding: 'utf8', shell: true, windowsHide: true })
      : spawnSync(cmd, args, { cwd, env, encoding: 'utf8', shell: false, windowsHide: true })
    output += `${r.stdout || ''}${r.stderr || ''}`
    return { code: r.status ?? 1, output }
  } catch (err) {
    output += `\n[ERR] ${err.message}\n`
    return { code: 1, output }
  }
}

function parseSemverOutput(text) {
  const m = String(text || '').match(/v?(\d+\.\d+\.\d+)/)
  return m ? m[1] : null
}

export function getPackageJsonPath() {
  const rt = getRuntimeConfig()
  return path.join(rt.projectPath, 'package.json')
}

export function readPackageJsonState() {
  const pkgPath = getPackageJsonPath()
  const templatePath = path.join(SERVER_CONF_DIR, getRuntimeConfig().packageJsonTemplateFile)
  let template = '{}'
  if (fs.existsSync(templatePath)) {
    template = fs.readFileSync(templatePath, 'utf8')
  } else if (fs.existsSync(pkgPath)) {
    template = fs.readFileSync(pkgPath, 'utf8')
  }
  if (fs.existsSync(pkgPath)) {
    return {
      exists: true,
      path: pkgPath,
      content: fs.readFileSync(pkgPath, 'utf8'),
      template,
    }
  }
  return { exists: false, path: pkgPath, content: template, template }
}

export function savePackageJson(content) {
  const pkgPath = getPackageJsonPath()
  let parsed
  try {
    parsed = JSON.parse(content)
  } catch (err) {
    throw new Error(`JSON invalide : ${err.message}`)
  }
  fs.mkdirSync(path.dirname(pkgPath), { recursive: true })
  const normalized = `${JSON.stringify(parsed, null, '\t')}\n`
  fs.writeFileSync(pkgPath, normalized, 'utf8')
  return { ok: true, path: pkgPath, relativePath: path.relative(REPO_ROOT, pkgPath).replace(/\\/g, '/') }
}

function findVoltaExe(voltaHome) {
  const candidates = [
    path.join(voltaHome, 'bin', 'volta.exe'),
    path.join(voltaHome, 'Bin', 'volta.exe'),
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  return null
}

/** État Node/Volta lu sur disque (aucun processus lancé) — pour les tableaux de bord fréquents. */
export function checkVoltaNodeLight() {
  const rt = getRuntimeConfig()
  const imageVersions = listVersionDirs(voltaNodeImageDir(rt))
  const inventoryVersions = listVersionDirs(voltaNodeInventoryDir(rt))
  const versions = imageVersions.length ? imageVersions : inventoryVersions
  return {
    nodeInstalled: versions.length > 0,
    nodeVersion: versions[versions.length - 1] || '',
    packageJsonExists: fs.existsSync(getPackageJsonPath()),
  }
}

export function checkNpmRuntime({ withNpm = true } = {}) {
  const rt = getRuntimeConfig()
  const inventoryRoot = voltaNodeInventoryDir(rt)
  const imageRoot = voltaNodeImageDir(rt)
  const inventoryVersions = listVersionDirs(inventoryRoot)
  const imageVersions = listVersionDirs(imageRoot)

  const nodeRun = runCmd(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'node -v'], { shell: false })
  const npmRun = withNpm
    ? runCmd(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm -v'], { shell: false })
    : { output: '' }
  const nodeVersion = parseSemverOutput(nodeRun.output)
  const npmVersion = parseSemverOutput(npmRun.output)

  const targetNode = rt.targetNodeVersion.replace(/^v/i, '')
  const targetNpm = rt.targetNpmVersion.replace(/^v/i, '')

  const nodeInInventory = inventoryVersions.includes(targetNode)
    || inventoryVersions.some((v) => v.startsWith(`${targetNode.split('.')[0]}.`))
  const nodeInImage = imageVersions.includes(targetNode)

  return {
    ok: true,
    voltaHome: rt.voltaHome,
    inventoryPath: inventoryRoot,
    imagePath: imageRoot,
    inventoryVersions,
    imageVersions,
    nodePresent: Boolean(nodeVersion),
    nodeVersion,
    npmPresent: Boolean(npmVersion),
    npmVersion,
    targetNodeVersion: targetNode,
    targetNpmVersion: targetNpm,
    nodeInVoltaInventory: nodeInInventory || inventoryVersions.length > 0,
    nodeInVoltaImage: nodeInImage || imageVersions.length > 0,
    nodeNeedsUpdate: nodeVersion ? nodeVersion !== targetNode : true,
    npmNeedsUpdate: npmVersion ? npmVersion !== targetNpm : true,
    packageJsonExists: fs.existsSync(getPackageJsonPath()),
    voltaExe: findVoltaExe(rt.voltaHome),
  }
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'wizard-qa-assistant' } }, (res) => {
      let data = ''
      res.on('data', (c) => { data += c })
      res.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch (e) {
          reject(e)
        }
      })
    }).on('error', reject)
  })
}

export async function listNodeDistVersions() {
  const rt = getRuntimeConfig()
  const index = await fetchJson(`${rt.nodeDistBaseUrl}/index.json`)
  const versions = []
  for (const entry of index) {
    const ver = String(entry.version || '').replace(/^v/, '')
    const major = Number(ver.split('.')[0])
    if (!Number.isFinite(major) || major < rt.nodeMajorMin || major > rt.nodeMajorMax) continue
    const zip = `node-v${ver}-win-x64.zip`
    versions.push({
      version: ver,
      lts: Boolean(entry.lts),
      zip,
      url: `${rt.nodeDistBaseUrl}/v${ver}/${zip}`,
    })
  }
  versions.sort((a, b) => {
    const pa = a.version.split('.').map(Number)
    const pb = b.version.split('.').map(Number)
    for (let i = 0; i < 3; i++) {
      if ((pb[i] || 0) !== (pa[i] || 0)) return (pb[i] || 0) - (pa[i] || 0)
    }
    return 0
  })
  return { ok: true, versions, nodeMajorMin: rt.nodeMajorMin, nodeMajorMax: rt.nodeMajorMax }
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest)
    https.get(url, { headers: { 'User-Agent': 'wizard-qa-assistant' } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close()
        fs.unlink(dest, () => {})
        return resolve(downloadFile(res.headers.location, dest))
      }
      if (res.statusCode !== 200) {
        file.close()
        return reject(new Error(`HTTP ${res.statusCode} pour ${url}`))
      }
      pipeline(res, file).then(() => resolve(dest)).catch(reject)
    }).on('error', reject)
  })
}

function extractZipWin(zipPath, destDir) {
  const ps = `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`
  const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(r.stderr || r.stdout || 'Expand-Archive échoué')
}

export async function installNodeToVoltaInventory(version) {
  const rt = getRuntimeConfig()
  const ver = String(version || rt.targetNodeVersion).replace(/^v/i, '')
  const zipName = `node-v${ver}-win-x64.zip`
  const url = `${rt.nodeDistBaseUrl}/v${ver}/${zipName}`
  const tempDir = path.join(os.tmpdir(), 'wizard-qa-node-dl')
  const zipPath = path.join(tempDir, zipName)
  const extractDir = path.join(tempDir, 'extract')
  const destDir = voltaNodeInventoryDir(rt, ver)

  fs.mkdirSync(tempDir, { recursive: true })
  if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true, force: true })

  let output = `Téléchargement ${url}\n`
  await downloadFile(url, zipPath)
  output += `Archive : ${zipPath}\n`
  extractZipWin(zipPath, extractDir)

  const extractedFolder = path.join(extractDir, `node-v${ver}-win-x64`)
  if (!fs.existsSync(extractedFolder)) {
    const entries = fs.readdirSync(extractDir).filter((e) => e.startsWith('node-v'))
    if (!entries.length) throw new Error('Contenu zip Node introuvable')
    fs.mkdirSync(destDir, { recursive: true })
    fs.cpSync(path.join(extractDir, entries[0]), destDir, { recursive: true })
  } else {
    fs.mkdirSync(path.dirname(destDir), { recursive: true })
    if (fs.existsSync(destDir)) fs.rmSync(destDir, { recursive: true, force: true })
    fs.cpSync(extractedFolder, destDir, { recursive: true })
  }

  const nodeExe = nodeExeInDir(destDir)
  if (!nodeExe) throw new Error(`node.exe introuvable après extraction dans ${destDir}`)

  output += `Node déposé dans ${destDir}\n`
  try {
    fs.rmSync(tempDir, { recursive: true, force: true })
  } catch { /* ignore */ }

  return { ok: true, version: ver, destDir, nodeExe, output }
}

export function runVoltaInstall(nodeVersion) {
  const rt = getRuntimeConfig()
  const ver = String(nodeVersion || rt.targetNodeVersion).replace(/^v/i, '')
  const shellCmd = rt.voltaInstallShell
    .replace(/\{nodeVersion\}/g, ver)
    .replace(/\{npmVersion\}/g, rt.targetNpmVersion)

  const env = {
    ...process.env,
    VOLTA_HOME: rt.voltaHome,
    PATH: `${path.join(rt.voltaHome, 'bin')}${path.delimiter}${process.env.PATH || ''}`,
  }

  const run = runCmd(shellCmd, [], { env, shell: true, cwd: rt.projectPath })
  const nodeAfter = runCmd(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'node -v'], { env, shell: false })
  const npmAfter = runCmd(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm -v'], { env, shell: false })

  return {
    ok: run.code === 0,
    command: shellCmd,
    output: `${run.output}\n${nodeAfter.output}\n${npmAfter.output}`,
    nodeVersion: parseSemverOutput(nodeAfter.output),
    npmVersion: parseSemverOutput(npmAfter.output),
  }
}

export function getRuntimeConfigForApi() {
  const rt = getRuntimeConfig()
  return {
    targetNodeVersion: rt.targetNodeVersion,
    targetNpmVersion: rt.targetNpmVersion,
    nodeMajorMin: rt.nodeMajorMin,
    nodeMajorMax: rt.nodeMajorMax,
    voltaHome: rt.voltaHome,
    voltaNodeInventoryRel: rt.voltaNodeInventoryRel,
    voltaInstallShell: rt.voltaInstallShell,
  }
}

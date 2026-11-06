import path from 'path'
import { spawn } from 'child_process'

/** Dossier utilisateur (aucun droit administrateur requis). */
export function getK6PortableDir(env = process.env) {
  const base = env.LOCALAPPDATA || path.join(env.USERPROFILE || env.HOME || '.', 'AppData', 'Local')
  return path.join(base, 'wizard-qa', 'bin')
}

function buildScript(destDir, arch) {
  const zipArch = arch === 'arm64' ? 'arm64' : 'amd64'
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`
  return `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
try { [Net.WebRequest]::DefaultWebProxy.Credentials = [Net.CredentialCache]::DefaultNetworkCredentials } catch {}
$dest = ${q(destDir)}
New-Item -ItemType Directory -Force -Path $dest | Out-Null
$url = $null
try {
  $rel = Invoke-RestMethod -UseBasicParsing -Headers @{ 'User-Agent' = 'wizard-qa' } -Uri 'https://api.github.com/repos/grafana/k6/releases/latest'
  $asset = $rel.assets | Where-Object { $_.name -match 'windows-${zipArch}\\.zip$' } | Select-Object -First 1
  if ($asset) { $url = $asset.browser_download_url }
} catch { Write-Output ('API GitHub indisponible : ' + $_.Exception.Message) }
if (-not $url) {
  $resp = $null
  try { Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/grafana/k6/releases/latest' -MaximumRedirection 0 -ErrorAction Stop | Out-Null } catch { $resp = $_.Exception.Response }
  $loc = if ($resp) { [string]$resp.Headers['Location'] } else { '' }
  if ($loc -match '/tag/(v[\\d\\.]+)') { $tag = $Matches[1]; $url = "https://github.com/grafana/k6/releases/download/$tag/k6-$tag-windows-${zipArch}.zip" }
}
if (-not $url) { throw 'Impossible de determiner la derniere version de k6 (acces a github.com bloque ?)' }
Write-Output ('Telechargement : ' + $url)
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('k6-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$zip = Join-Path $tmp 'k6.zip'
Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $zip
Expand-Archive -Force -Path $zip -DestinationPath $tmp
$exe = Get-ChildItem -Path $tmp -Recurse -Filter 'k6.exe' | Select-Object -First 1
if (-not $exe) { throw 'k6.exe introuvable dans l archive' }
Copy-Item -Force $exe.FullName (Join-Path $dest 'k6.exe')
Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$entries = @(); if ($userPath) { $entries = $userPath.Split(';') | Where-Object { $_ } }
if (-not ($entries | Where-Object { $_.TrimEnd('\\') -ieq $dest.TrimEnd('\\') })) {
  [Environment]::SetEnvironmentVariable('Path', (($entries + $dest) -join ';'), 'User')
  Write-Output ('PATH utilisateur mis a jour : ' + $dest + ' (nouveaux terminaux uniquement)')
}
Write-Output ('k6 installe dans ' + $dest)
`
}

/** Télécharge k6.exe (zip officiel GitHub) dans un dossier utilisateur — sans droits admin. */
export function installK6Portable(env = process.env) {
  return new Promise((resolve) => {
    const dest = getK6PortableDir(env)
    let output = `\n$ téléchargement k6 portable → ${dest}\n`
    if (process.platform !== 'win32') {
      resolve({ ok: false, output: `${output}Installation portable disponible sous Windows uniquement.\n`, command: 'k6 portable', code: 1 })
      return
    }
    const encoded = Buffer.from(buildScript(dest, process.arch), 'utf16le').toString('base64')
    let child
    try {
      child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
        env,
        shell: false,
        windowsHide: true,
      })
    } catch (err) {
      resolve({ ok: false, output: `${output}[ERR] ${err.message}\n`, command: 'k6 portable', code: 1 })
      return
    }
    child.stdout?.on('data', (d) => { output += d.toString() })
    child.stderr?.on('data', (d) => { output += d.toString() })
    child.on('error', (err) => resolve({ ok: false, output: `${output}[ERR] ${err.message}\n`, command: 'k6 portable', code: 1 }))
    child.on('close', (code) => resolve({ ok: code === 0, output, command: 'k6 portable (GitHub releases)', code: code ?? 1 }))
  })
}

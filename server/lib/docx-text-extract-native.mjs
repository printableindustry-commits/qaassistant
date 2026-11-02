import { spawnSync } from 'child_process'
import { platform } from 'os'

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

function extractFromXml(xml) {
  const lines = []
  const paraRe = /<w:p[\s>][\s\S]*?<\/w:p>/g
  const textRe = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g
  let paraMatch
  while ((paraMatch = paraRe.exec(xml)) !== null) {
    const para = paraMatch[0]
    let line = ''
    let textMatch
    while ((textMatch = textRe.exec(para)) !== null) {
      line += textMatch[1]
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
    }
    lines.push(line)
  }
  return lines.join('\n')
}

/** Extraction .docx sans Python — PowerShell (Windows) ou unzip+parse minimal. */
export function extractDocxTextNative(absPath) {
  if (platform() === 'win32') {
    const escaped = absPath.replace(/'/g, "''")
    const ps = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead('${escaped}')
try {
  $entry = $zip.GetEntry('word/document.xml')
  if (-not $entry) { exit 2 }
  $reader = New-Object System.IO.StreamReader($entry.Open())
  try { $xml = $reader.ReadToEnd() } finally { $reader.Close() }
} finally { $zip.Dispose() }
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::Out.Write($xml)
`
    const r = spawnSync(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps],
      { encoding: 'utf8', maxBuffer: 30 * 1024 * 1024, windowsHide: true },
    )
    if (r.status === 0 && r.stdout) {
      const text = extractFromXml(r.stdout).trim()
      if (text) return text
    }
  }

  // Linux/macOS : python3 zipfile inline si dispo (léger)
  const py = `
import zipfile, sys
from xml.etree import ElementTree as ET
W = '{${W_NS}}'
with zipfile.ZipFile(sys.argv[1]) as z:
    root = ET.fromstring(z.read('word/document.xml'))
lines = []
for p in root.iter(W + 'p'):
    lines.append(''.join(t.text or '' for t in p.iter(W + 't')))
sys.stdout.buffer.write(chr(10).join(lines).encode('utf-8'))
`
  const r = spawnSync('python3', ['-c', py, absPath], {
    encoding: 'utf8',
    maxBuffer: 30 * 1024 * 1024,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  })
  if (r.status === 0 && r.stdout?.trim()) return r.stdout.trim()
  return null
}

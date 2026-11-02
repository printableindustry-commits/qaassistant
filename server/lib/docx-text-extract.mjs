import { extractDocxPlainTextViaScript } from './docx-text-sync.mjs'
import { extractDocxTextNative } from './docx-text-extract-native.mjs'
import { spawnPython } from './python-runner.mjs'

/** Extrait le texte brut d'un .docx (natif Windows, python-docx, ou zipfile). */
export function extractDocxText(absPath) {
  const viaNative = extractDocxTextNative(absPath)
  if (viaNative != null && viaNative.trim()) return viaNative.trim()

  const viaScript = extractDocxPlainTextViaScript(absPath)
  if (viaScript != null && viaScript.trim()) return viaScript.trim()

  const py = `
import sys
import zipfile
from xml.etree import ElementTree as ET
try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
with zipfile.ZipFile(sys.argv[1]) as z:
    root = ET.fromstring(z.read('word/document.xml'))
lines = []
for p in root.iter(W + 'p'):
    line = ''.join(t.text or '' for t in p.iter(W + 't'))
    lines.append(line)
sys.stdout.buffer.write(chr(10).join(lines).encode('utf-8'))
`
  const r = spawnPython(['-c', py, absPath])
  if (r.status === 0 && r.stdout?.trim()) return r.stdout.trim()
  return null
}

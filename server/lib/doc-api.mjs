import path from 'path'
import { spawn } from 'child_process'
import {
  DOC_QA_DIR,
  PATH_CFG,
  REPO_ROOT,
  docReportRel,
  promptMdAbsPath,
  relPath,
} from './paths.mjs'

const DOC_DIR = DOC_QA_DIR

const OUTPUTS = {
  scan: docReportRel(PATH_CFG.docInventoryFile),
  diff: docReportRel(PATH_CFG.docGapsFile),
  snapshot: docReportRel(PATH_CFG.snapshotJsonFile),
  snapshotMd: docReportRel(PATH_CFG.snapshotMdFile),
  prompt: relPath(PATH_CFG.templateDir, PATH_CFG.promptMdFile),
}

export function getDocOutputPaths() {
  return { ...OUTPUTS, promptAbs: promptMdAbsPath() }
}

function runScript(script) {
  return new Promise((resolve) => {
    const full = path.join(DOC_DIR, script)
    let out = `\n$ node ${script}\n`
    const child = spawn(process.execPath, [full], {
      cwd: REPO_ROOT,
      env: process.env,
      shell: false,
      windowsHide: true,
    })
    child.stdout?.on('data', (d) => { out += d.toString() })
    child.stderr?.on('data', (d) => { out += d.toString() })
    child.on('close', (code) => resolve({ code: code ?? 1, output: out }))
  })
}

export async function runDocAction(action) {
  const outputs = []
  let full = ''

  if (action === 'snapshot' || action === 'report-full') {
    const r = await runScript('scan-project.mjs')
    full += r.output
    outputs.push(OUTPUTS.snapshot, OUTPUTS.snapshotMd)
    if (r.code !== 0) return { ok: false, output: full, code: r.code, outputs }
  }

  if (action === 'scan' || action === 'report' || action === 'report-full') {
    const r = await runScript('scan-features.mjs')
    full += r.output
    outputs.push(OUTPUTS.scan)
    if (r.code !== 0) return { ok: false, output: full, code: r.code, outputs }
  }

  if (action === 'diff' || action === 'report' || action === 'report-full') {
    const r = await runScript('doc-diff.mjs')
    full += r.output
    outputs.push(OUTPUTS.diff)
    if (r.code !== 0) return { ok: false, output: full, code: r.code, outputs }
  }

  return { ok: true, output: full, code: 0, outputs }
}

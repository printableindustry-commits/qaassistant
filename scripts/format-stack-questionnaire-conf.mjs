#!/usr/bin/env node
/**
 * Reformate stack-questionnaire.conf.json en conservant les balises @wizard-qa.
 * Usage : node scripts/format-stack-questionnaire-conf.mjs [chemin-vers-conf.json]
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { parseStackQuestionnaireText } from '../server/lib/stack-questionnaire-jsonc.mjs'
import { formatQuestionnaireFile } from '../server/lib/stack-questionnaire-format.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  const target = process.argv[2]
    || process.env.WIZARD_CONF_PATH
    || path.join(__dirname, '..', '..', '..', '.wizard-qa', 'conf', 'stack-questionnaire.conf.json')

  const abs = path.resolve(target)
  if (!fs.existsSync(abs)) {
    console.error('Fichier introuvable :', abs)
    process.exit(1)
  }

  const text = fs.readFileSync(abs, 'utf8')
  const raw = parseStackQuestionnaireText(text)
  const rel = path.basename(path.dirname(abs)) === 'conf'
    ? `.wizard-qa/conf/${path.basename(abs)}`
    : path.basename(abs)

  fs.writeFileSync(abs, formatQuestionnaireFile(raw, { relativePath: rel }), 'utf8')
  console.log(`Formaté : ${abs} (${(raw.questions || []).length} question(s), balises @wizard-qa conservées)`)
}

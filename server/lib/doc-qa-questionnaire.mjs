import fs from 'fs'
import path from 'path'
import { CONF_DIR, SERVER_CONF_DIR } from './paths.mjs'

export const DOC_QA_QUESTIONNAIRE_FILE = 'doc-qa-questionnaire.conf.json'
export const DOC_QA_QUESTIONNAIRE_REFERENCE = 'doc-qa-questionnaire.conf.reference.json'

const USER_PATH = () => path.join(CONF_DIR, DOC_QA_QUESTIONNAIRE_FILE)
const REF_PATH = () => path.join(SERVER_CONF_DIR, DOC_QA_QUESTIONNAIRE_REFERENCE)

function ensureUserFile() {
  fs.mkdirSync(CONF_DIR, { recursive: true })
  if (!fs.existsSync(USER_PATH()) && fs.existsSync(REF_PATH())) {
    fs.copyFileSync(REF_PATH(), USER_PATH())
  }
}

export function loadDocQaQuestionnaire() {
  ensureUserFile()
  const source = fs.existsSync(USER_PATH()) ? USER_PATH() : REF_PATH()
  if (!fs.existsSync(source)) {
    return { version: '1.0.0', sections: [] }
  }
  return JSON.parse(fs.readFileSync(source, 'utf8'))
}

export function listQuestionnaireFields(config = loadDocQaQuestionnaire()) {
  const fields = []
  for (const section of config.sections || []) {
    for (const field of section.fields || []) {
      fields.push({ ...field, sectionId: section.id, sectionTitle: section.title })
    }
  }
  return fields
}

export function validateAnswers(answers = {}, config = loadDocQaQuestionnaire()) {
  const missing = []
  for (const field of listQuestionnaireFields(config)) {
    if (!field.required) continue
    const val = answers[field.id]
    if (val == null || String(val).trim() === '') {
      missing.push(field.label || field.id)
    }
  }
  return { ok: missing.length === 0, missing }
}

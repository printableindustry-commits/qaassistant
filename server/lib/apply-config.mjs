import { writeNpmrc } from './npmrc.mjs'
import { saveRepairConfig } from './repair-api.mjs'
import { saveHookSimple } from './hook-config.mjs'
import { HOOK_DIR } from './paths.mjs'

export function applyWizardToSystem(wizard, { npmrc = true, repair = true, hook = true } = {}) {
  const applied = []
  const errors = []
  const skipped = []

  if (npmrc && wizard.npmrc) {
    try {
      writeNpmrc(wizard.npmrc)
      applied.push('%USERPROFILE%\\.npmrc')
    } catch (e) { errors.push(`.npmrc : ${e.message}`) }
  } else if (npmrc && !wizard.npmrc) skipped.push('.npmrc (rien en mémoire)')

  if (repair && wizard.repair?.config) {
    try {
      saveRepairConfig(wizard.repair.config)
      applied.push('repair.conf.json')
    } catch (e) { errors.push(`repair : ${e.message}`) }
  } else if (repair && !wizard.repair?.config) skipped.push('repair (rien en mémoire)')

  if (hook && wizard.hook?.simple) {
    try {
      saveHookSimple(HOOK_DIR, wizard.hook.simple)
      applied.push('hook .env + hooks.conf [defaults]')
    } catch (e) { errors.push(`hook : ${e.message}`) }
  } else if (hook && !wizard.hook?.simple) skipped.push('hook simple (rien en mémoire)')

  return { ok: errors.length === 0, applied, errors, skipped }
}

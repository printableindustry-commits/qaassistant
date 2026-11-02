/** Mise en forme commentée de stack-questionnaire.conf.json (balises @wizard-qa). */

export const MARKERS = {
  configBegin: '@wizard-qa:configuration-debut',
  configEnd: '@wizard-qa:configuration-fin',
  toolsBegin: '@wizard-qa:tools-debut',
  toolsEnd: '@wizard-qa:tools-fin',
  questionsBegin: '@wizard-qa:questions-debut',
  questionsEnd: '@wizard-qa:questions-fin',
}

export function formatQuestionnaireFile(raw, { relativePath = '.wizard-qa/conf/stack-questionnaire.conf.json' } = {}) {
  const lines = []
  lines.push('{')
  lines.push('  // ===========================================================================')
  lines.push('  // QUESTIONNAIRE STACK — fichier lu directement par le Wizard QA')
  lines.push(`  // Chemin : ${relativePath}`)
  lines.push('  // Chaque bloc « Page de question » = une étape du parcours.')
  lines.push('  // Les commentaires // et balises @wizard-qa sont ignorés au chargement.')
  lines.push('  // ===========================================================================')
  lines.push('')
  lines.push(`  // ${MARKERS.configBegin} — métadonnées (ne pas supprimer)`)
  lines.push(`  "version": ${raw.version ?? 1},`)
  lines.push(`  "description": ${JSON.stringify(raw.description || '')},`)
  lines.push(`  // ${MARKERS.configEnd}`)
  lines.push('')

  if (raw.tools && Object.keys(raw.tools).length) {
    lines.push(`  // ${MARKERS.toolsBegin} — outils et couleurs des camemberts`)
    const toolsBlock = JSON.stringify(raw.tools, null, 2)
      .split('\n')
      .map((l, i) => (i === 0 ? l : `  ${l}`))
      .join('\n')
    lines.push(`  "tools": ${toolsBlock},`)
    lines.push(`  // ${MARKERS.toolsEnd}`)
    lines.push('')
  }

  const qs = raw.questions || []
  lines.push(`  // ${MARKERS.questionsBegin} — pages du wizard (ordre = ordre d'affichage)`)
  lines.push('  "questions": [')

  qs.forEach((q, i) => {
    const n = i + 1
    const title = q.title || q.id
    lines.push('')
    lines.push(`    // ========== Page de question N° ${n} — ${title} (id: ${q.id}) ==========`)
    const block = JSON.stringify(q, null, 2)
      .split('\n')
      .map((l) => `    ${l}`)
      .join('\n')
    lines.push(block + (i < qs.length - 1 ? ',' : ''))
  })

  lines.push('')
  lines.push(`    // ========== Fin du bloc questions — ${qs.length} page(s) au total ==========`)
  lines.push('  ]')
  lines.push(`  // ${MARKERS.questionsEnd}`)
  lines.push('}')
  lines.push('')
  return lines.join('\n')
}

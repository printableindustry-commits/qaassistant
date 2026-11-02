/** Modes terminal_mode (hooks.conf) — libellés et exemples d'affichage */
export const TERMINAL_MODES = [
  {
    id: '0',
    label: 'Silencieux',
    summary: 'Synchro en arrière-plan — détails uniquement dans hook-debug.log',
    example: '(aucune sortie dans le terminal Git)',
  },
  {
    id: 'A',
    label: 'Résumé fichier',
    summary: '1 ligne au démarrage, résumé OK/KO dans hook-last-run.txt',
    example: `[JIRA/Xray] Synchro démarrée (10 plans) — résumé : hook-last-run.txt
[JIRA/Xray] Terminé — 4 OK, 1 KO — 102s`,
  },
  {
    id: 'B',
    label: 'Verbose (défaut)',
    summary: 'Tout s\'affiche dans le terminal — commit bloqué le temps de la sync',
    example: `[JIRA/Xray] Synchro complète (10 plans) — mode verbose…
================================================================
  ÉTAPE 1 — Scan poste (P0326-9235)
================================================================
  + Création [SMK_001.01] : …
[JIRA/Xray] ✓ Terminé — 10/10 plans OK — 98s`,
  },
  {
    id: 'C',
    label: 'Compact',
    summary: '1 ligne par plan dans hook-last-run.txt + ligne finale terminal',
    example: `[JIRA/Xray] Synchro démarrée (10 plans) — suivi compact : hook-last-run.txt
[JIRA/Xray] Terminé — 4 OK, 1 KO — 102s — voir hook-last-run.txt`,
  },
  {
    id: 'D',
    label: 'Notification Windows',
    summary: 'Toast Windows en fin de sync + hook-last-run.txt',
    example: `[JIRA/Xray] Synchro démarrée (10 plans) — notification à la fin
[JIRA/Xray] Terminé — 4 OK, 1 KO — 102s

+ toast Windows : « Hook JIRA/Xray — Terminé — 9/10 plans OK »`,
  },
  {
    id: 'E',
    label: 'Statut JSON',
    summary: 'Pour : node hook-status.mjs [--watch]',
    example: `[JIRA/Xray] Synchro démarrée (10 plans) — statut : node hook-status.mjs

$ node hook-status.mjs
Dernière exécution : il y a 12s — TERMINÉ
Plan          JIRA    Xray    Actions
P0326-9235    OK      OK      +2 ~1`,
  },
]

export function getTerminalMode(id) {
  const key = String(id ?? 'B').trim().toUpperCase()
  return TERMINAL_MODES.find(m => m.id === key) ?? TERMINAL_MODES.find(m => m.id === 'B')
}

export function buildTerminalModeCommentBlock() {
  const lines = [
    '# ── Affichage terminal après git commit ─────────────────────────────────────',
    '# terminal_mode = mode actif (une seule valeur)',
    '#',
  ]
  for (const m of TERMINAL_MODES) {
    lines.push(`#   ${m.id} = ${m.label} — ${m.summary}`)
    lines.push('#       Exemple terminal :')
    for (const row of m.example.split('\n')) {
      lines.push(`#         ${row}`)
    }
    lines.push('#')
  }
  return lines
}

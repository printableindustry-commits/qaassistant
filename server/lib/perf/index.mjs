/**
 * Point d'entrée du module performance (contrat §4.5).
 *   getPerfSummary() → { lastRun: { id, profileName, status, p95, errorRate, finishedAt } | null, running }
 * Synchrone et rapide : lit l'index en mémoire des runs.
 * Statut : 'passed' | 'failed' (seuils non respectés ou erreur) | 'stopped'.
 */
import { listMetas } from './store.mjs'
import { runningCount } from './run-manager.mjs'

export function getPerfSummary() {
  const last = listMetas().find((m) => m.status !== 'running') || null
  return {
    lastRun: last
      ? {
        id: last.id,
        profileName: last.profileName,
        status: last.status === 'error' ? 'failed' : last.status,
        detailedStatus: last.status,
        simulated: Boolean(last.simulated),
        p95: last.metrics?.p95 ?? null,
        errorRate: last.metrics?.errorRate ?? null,
        finishedAt: last.finishedAt,
      }
      : null,
    running: runningCount(),
  }
}

export { startRun, stopRun } from './run-manager.mjs'
export { listRuns, getRunDetail, compareRuns } from './history.mjs'

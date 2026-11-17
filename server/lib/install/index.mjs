/**
 * Module Installation — point d'entrée pour les autres modules (tableau de bord, bandeau).
 *
 *   getInstallSummary() → { components: [{ id, label, state, version, required }], lastRun, ready }
 *   (synchrone, dernier état connu, sans réseau ni processus)
 */
import { currentView, getState, getActiveRun } from './orchestrator.mjs'

const CONTRACT_STATES = new Set(['ok', 'missing', 'outdated', 'error'])

export function getInstallSummary() {
  try {
    const view = currentView()
    const st = getState()
    const active = getActiveRun()
    return {
      components: view.components.map((c) => ({
        id: c.id,
        label: c.label,
        state: CONTRACT_STATES.has(c.state) ? c.state : 'unknown',
        version: c.version || '',
        required: c.required,
      })),
      lastRun: active
        ? { id: active.id, status: 'running', finishedAt: null }
        : st.lastRun ? { id: st.lastRun.id, status: st.lastRun.status, finishedAt: st.lastRun.finishedAt } : null,
      ready: view.ready,
    }
  } catch {
    return { components: [], lastRun: null, ready: false }
  }
}

export { detectComponents, startRun, getRun, listRuns, cancelRun } from './orchestrator.mjs'

import type { SyncProgressState } from './schema'

/**
 * Dedicated sync state store with throttled updates (max 4 per second)
 * to prevent whole-screen re-rendering. UI header subscribes directly to this store.
 */
export type { SyncProgressState }

type Listener = (state: SyncProgressState) => void

const INITIAL_STATE: SyncProgressState = {
  status: 'idle',
  percent: 100,
  totalToProcess: 0,
  processedCount: 0,
  outboxPendingCount: 0,
  lastSuccessAt: null,
  currentTask: null,
  priorityPhase: 1,
  phaseLabel: 'Готов к работе',
  lastError: null,
  isStale: false,
  scopeShopId: null,
}

let currentState: SyncProgressState = { ...INITIAL_STATE }

const listeners = new Set<Listener>()
let pendingUpdate: SyncProgressState | null = null
let throttleTimer: any = null
const THROTTLE_MS = 250 // max 4 times per second

/** Data older than this without a successful cloud check is presented as stale. */
export const STALE_AFTER_MS = 10 * 60 * 1000

export function getSyncState(): SyncProgressState {
  return currentState
}

function emit(state: SyncProgressState) {
  for (const listener of listeners) {
    try {
      listener(state)
    } catch (e) {
      console.error('Error in sync state listener:', e)
    }
  }
}

export function updateSyncState(patch: Partial<SyncProgressState>): void {
  currentState = { ...currentState, ...patch }

  if (!throttleTimer) {
    emit(currentState)
    throttleTimer = setTimeout(() => {
      throttleTimer = null
      if (pendingUpdate) {
        const next = pendingUpdate
        pendingUpdate = null
        emit(next)
      }
    }, THROTTLE_MS)
  } else {
    pendingUpdate = currentState
  }
}

/**
 * Full reset of the sync UI state. Used on logout and on shop switch so that
 * no progress / timestamps from a previous session or shop remain visible.
 */
export function resetSyncState(patch: Partial<SyncProgressState> = {}): void {
  currentState = { ...INITIAL_STATE, ...patch }
  pendingUpdate = null
  if (throttleTimer) {
    clearTimeout(throttleTimer)
    throttleTimer = null
  }
  emit(currentState)
}

/** Recomputes the staleness flag from the last successful cloud check. */
export function recomputeStaleness(): void {
  const last = currentState.lastSuccessAt ? new Date(currentState.lastSuccessAt).getTime() : 0
  const stale = !last || Date.now() - last > STALE_AFTER_MS
  if (stale !== currentState.isStale) {
    updateSyncState({ isStale: stale })
  }
}

export function subscribeSyncState(listener: Listener): () => void {
  listeners.add(listener)
  listener(currentState)
  return () => {
    listeners.delete(listener)
  }
}

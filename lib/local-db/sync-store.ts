import type { SyncProgressState } from './schema'

/**
 * Dedicated sync state store with throttled updates (max 4 per second)
 * to prevent whole-screen re-rendering. UI header subscribes directly to this store.
 */
export type { SyncProgressState }

type Listener = (state: SyncProgressState) => void

let currentState: SyncProgressState = {
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
}

const listeners = new Set<Listener>()
let pendingUpdate: SyncProgressState | null = null
let throttleTimer: any = null
const THROTTLE_MS = 250 // max 4 times per second

export function getSyncState(): SyncProgressState {
  return currentState
}

export function updateSyncState(patch: Partial<SyncProgressState>): void {
  currentState = { ...currentState, ...patch }

  if (!throttleTimer) {
    for (const listener of listeners) {
      try {
        listener(currentState)
      } catch (e) {
        console.error('Error in sync state listener:', e)
      }
    }
    throttleTimer = setTimeout(() => {
      throttleTimer = null
      if (pendingUpdate) {
        const next = pendingUpdate
        pendingUpdate = null
        for (const listener of listeners) {
          try {
            listener(next)
          } catch (e) {
            console.error('Error in sync state listener:', e)
          }
        }
      }
    }, THROTTLE_MS)
  } else {
    pendingUpdate = currentState
  }
}

export function subscribeSyncState(listener: Listener): () => void {
  listeners.add(listener)
  listener(currentState)
  return () => {
    listeners.delete(listener)
  }
}

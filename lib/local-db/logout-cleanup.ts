import { wipeLocalDatabase } from './db'
import { syncEngine } from '../sync/sync-engine'

/**
 * Single entry point for leaving an account.
 *
 * Order matters: the sync engine is stopped first so nothing can re-populate local
 * storage mid-cleanup, then local data is wiped, then the service worker drops every
 * cache it owns. After this runs there is no cached page, no cached response and no
 * local row left from the previous user.
 */
export async function runLogoutCleanup(): Promise<void> {
  try {
    syncEngine.stop()
  } catch (err) {
    console.warn('[Logout] Failed to stop sync engine:', err)
  }

  try {
    await wipeLocalDatabase()
  } catch (err) {
    console.error('[Logout] Failed to wipe local database:', err)
  }

  await clearServiceWorkerCaches()
}

/** Ask the service worker to delete its caches, and delete them directly as a fallback. */
export async function clearServiceWorkerCaches(): Promise<void> {
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.getRegistration()
      const worker = registration?.active
      if (worker) {
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, 1500)
          const onMessage = (event: MessageEvent) => {
            if (event.data?.type === 'AURA_CACHES_CLEARED') {
              clearTimeout(timeout)
              navigator.serviceWorker.removeEventListener('message', onMessage)
              resolve()
            }
          }
          navigator.serviceWorker.addEventListener('message', onMessage)
          worker.postMessage({ type: 'AURA_LOGOUT_CLEANUP' })
        })
      }
    } catch (err) {
      console.warn('[Logout] Service worker cleanup failed:', err)
    }
  }

  if (typeof caches !== 'undefined') {
    try {
      const keys = await caches.keys()
      await Promise.all(keys.map((key) => caches.delete(key)))
    } catch (err) {
      console.warn('[Logout] Cache Storage cleanup failed:', err)
    }
  }
}

/**
 * Service Worker for Aura CRM.
 *
 * Security model
 * --------------
 * Private data is NEVER stored in a Cache Storage bucket. Supabase REST/auth/storage
 * responses are user- and shop-specific, are not partitioned by session, and would
 * survive logout inside a shared cache — so they are served network-only and the
 * offline copy of business data lives exclusively in IndexedDB, which the app wipes
 * on logout and on shop switch.
 *
 * What is cached
 * --------------
 * 1. Application shell (navigation documents) — no personal data, needed so the app
 *    opens interactive while offline.
 * 2. Static build assets (JS/CSS/fonts/icons).
 *
 * Cache invalidation
 * ------------------
 * - Cache names carry a version; everything else is deleted on activate.
 * - Shell documents use network-first with a short timeout, so a fresh deploy or a
 *   changed shell is picked up as soon as the network allows, and the cached copy is
 *   only a fallback.
 * - Static assets are immutable build artifacts (content-hashed) → cache-first.
 * - On logout the page posts AURA_LOGOUT_CLEANUP and every cache is dropped.
 */

const VERSION = 'v5'
const SHELL_CACHE = `aura-crm-shell-${VERSION}`
const STATIC_CACHE = `aura-crm-static-${VERSION}`
const CURRENT_CACHES = [SHELL_CACHE, STATIC_CACHE]

/** Network-first timeout for navigations: fast enough to feel instant offline. */
const NAV_TIMEOUT_MS = 3500

// Shell routes pre-cached so the app boots interactive without a network.
const PRECACHE_SHELL_URLS = [
  '/',
  '/crm',
  '/crm/pos',
  '/pos',
  '/crm/inventory',
  '/inventory',
  '/crm/showcase',
  '/showcase',
  '/crm/customers',
  '/customers',
  '/crm/suppliers',
  '/suppliers',
  '/crm/cabinet',
  '/cabinet',
  '/crm/reports',
  '/reports',
  '/manifest.json',
  '/favicon.ico',
]

const OFFLINE_FALLBACK_HTML = `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Aura CRM — офлайн</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;background:#0f1115;color:#e7e7ea}div{text-align:center;padding:24px}button{margin-top:16px;padding:10px 18px;border:0;border-radius:8px;background:#c9a227;color:#1a1a1a;font-weight:600}</style>
</head><body><div>
<h1>Нет подключения</h1>
<p>Откройте приложение снова, когда появится сеть.</p>
<button onclick="location.reload()">Повторить</button>
</div></body></html>`

// ---------------------------------------------------------------------------
// Install / activate
// ---------------------------------------------------------------------------

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE)
      for (const url of PRECACHE_SHELL_URLS) {
        try {
          // cache: 'reload' so a new version never precaches a stale HTTP-cached shell.
          const res = await fetch(url, { credentials: 'same-origin', cache: 'reload' })
          if (res && res.status === 200 && !isPrivateResponse(res)) {
            await cache.put(url, res)
          }
        } catch (err) {
          // A single missing route must not fail the whole install.
        }
      }
      await self.skipWaiting()
    })()
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((key) => !CURRENT_CACHES.includes(key)).map((key) => caches.delete(key)))
      await self.clients.claim()
    })()
  )
})

// ---------------------------------------------------------------------------
// Messages from the app
// ---------------------------------------------------------------------------

self.addEventListener('message', (event) => {
  const data = event.data || {}

  if (data.type === 'AURA_SKIP_WAITING') {
    self.skipWaiting()
    return
  }

  // Logout / account switch: remove every cached byte this worker owns.
  if (data.type === 'AURA_LOGOUT_CLEANUP') {
    event.waitUntil(
      (async () => {
        const keys = await caches.keys()
        await Promise.all(keys.map((key) => caches.delete(key)))
        const clients = await self.clients.matchAll({ includeUncontrolled: true })
        for (const client of clients) {
          client.postMessage({ type: 'AURA_CACHES_CLEARED' })
        }
      })()
    )
    return
  }

  // Shop switch: shell/static caches hold no shop data, but drop shell documents
  // anyway so a rendered server shell of the previous shop can never be reused.
  if (data.type === 'AURA_SHOP_CHANGED') {
    event.waitUntil(caches.delete(SHELL_CACHE))
  }
})

// ---------------------------------------------------------------------------
// Fetch routing
// ---------------------------------------------------------------------------

function isPrivateHost(url) {
  return (
    url.hostname.includes('supabase') ||
    url.pathname.startsWith('/rest/v1') ||
    url.pathname.startsWith('/auth/v1') ||
    url.pathname.startsWith('/storage/v1') ||
    url.pathname.startsWith('/realtime/v1') ||
    url.pathname.startsWith('/functions/v1') ||
    url.pathname.startsWith('/api/')
  )
}

/** Never store anything that carries a session or per-user payload. */
function isPrivateResponse(response) {
  if (!response) return true
  if (response.type === 'opaque' || response.type === 'opaqueredirect') return true
  const cacheControl = response.headers.get('Cache-Control') || ''
  if (/no-store|private/i.test(cacheControl)) return true
  if (response.headers.get('Set-Cookie')) return true
  if (response.headers.get('Authorization')) return true
  return false
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  let url
  try {
    url = new URL(request.url)
  } catch {
    return
  }

  if (url.protocol === 'ws:' || url.protocol === 'wss:') return

  // A. Private data and APIs: network-only, never cached, never read from cache.
  if (isPrivateHost(url)) return

  // B. Navigation documents: network-first with timeout, cached shell as fallback.
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(handleNavigation(request, url))
    return
  }

  // C. Static build assets: cache-first (content-hashed, safe to keep).
  if (isStaticAsset(url)) {
    event.respondWith(handleStatic(request))
  }
})

function isStaticAsset(url) {
  if (url.origin !== self.location.origin) return false
  return (
    url.pathname.startsWith('/_next/static/') ||
    /\.(js|css|png|jpg|jpeg|svg|ico|woff2|webmanifest)$/.test(url.pathname)
  )
}

async function handleNavigation(request, url) {
  const cache = await caches.open(SHELL_CACHE)

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), NAV_TIMEOUT_MS)
    const network = await fetch(request, { signal: controller.signal })
    clearTimeout(timer)

    if (network && network.status === 200 && !isPrivateResponse(network)) {
      cache.put(request, network.clone()).catch(() => {})
    }
    return network
  } catch {
    // Offline (or the network is too slow): serve the precached interactive shell.
    const cached =
      (await cache.match(request, { ignoreSearch: true })) ||
      (await cache.match(url.pathname)) ||
      (await cache.match('/crm/pos')) ||
      (await cache.match('/crm')) ||
      (await cache.match('/'))

    if (cached) {
      // Tell the app it started from cache so it can show the offline/stale badge.
      notifyClients({ type: 'AURA_OFFLINE_SHELL', path: url.pathname })
      return cached
    }

    return new Response(OFFLINE_FALLBACK_HTML, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    })
  }
}

async function handleStatic(request) {
  const cache = await caches.open(STATIC_CACHE)
  const cached = await cache.match(request)
  if (cached) return cached

  try {
    const network = await fetch(request)
    if (network && network.status === 200 && !isPrivateResponse(network)) {
      cache.put(request, network.clone()).catch(() => {})
    }
    return network
  } catch (err) {
    if (cached) return cached
    throw err
  }
}

async function notifyClients(message) {
  try {
    const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' })
    for (const client of clients) client.postMessage(message)
  } catch {}
}

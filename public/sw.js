/**
 * Service Worker for Aura CRM.
 *
 * What is cached
 * --------------
 * 1. Same-origin HTML shells for the CRM routes. Next.js can return a server error
 *    when its Supabase auth check cannot reach the cloud; these shells let the
 *    already-installed CRM boot from its IndexedDB copy instead.
 * 2. Static build assets (JS/CSS/fonts/icons), including chunks referenced by the
 *    pre-cached HTML. That makes a hard refresh work after the first online visit.
 *
 * Privacy / scope
 * ---------------
 * CRM HTML can contain the initial server-rendered account data. It is cached only
 *    on this browser profile, and the application clears its caches on logout and
 *    drops route shells when the active shop changes. Supabase API responses are
 *    still network-only. The editable offline business data and pending writes live
 *    in IndexedDB, which is also wiped on logout and isolated by shop.
 *
 * Cache invalidation
 * ------------------
 * - Cache names carry a version; one previous version is retained as an update
 *   fallback in case the new worker installs while the server is unreachable.
 * - Shell documents use network-first with a short timeout, so a fresh deploy or a
 *   changed shell is picked up as soon as the network allows, and the cached copy is
 *   only a fallback.
 * - Static assets are immutable build artifacts (content-hashed) → cache-first.
 * - On logout the page posts AURA_LOGOUT_CLEANUP and every cache is dropped.
 */

const VERSION = 'v6'
const SHELL_CACHE = `aura-crm-shell-${VERSION}`
const STATIC_CACHE = `aura-crm-static-${VERSION}`
const STATE_CACHE = `aura-crm-state-${VERSION}`
const CURRENT_CACHES = [SHELL_CACHE, STATIC_CACHE]
const CLOUD_FAILURE_KEY = new URL('/__aura_cloud_unreachable__', self.location.origin).href

/** Network-first timeout for navigations: fast enough to feel instant offline. */
const NAV_TIMEOUT_MS = 3500
const PRECACHE_TIMEOUT_MS = 5000

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
  '/crm/stores',
  '/stores',
  '/crm/notifications',
  '/notifications',
  '/crm/suppliers',
  '/suppliers',
  '/crm/cabinet',
  '/cabinet',
  '/crm/reports',
  '/reports',
  '/manifest.json',
  '/manifest.webmanifest',
  '/site.webmanifest',
  '/favicon.ico',
  '/favicon-32x32.png',
  '/favicon-16x16.png',
  '/icon.svg',
  '/apple-icon.png',
  '/apple-touch-icon.png',
  '/android-chrome-192x192.png',
  '/android-chrome-512x512.png',
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

function shellCacheKey(pathname) {
  return new Request(new URL(pathname, self.location.origin).href, {
    method: 'GET',
    credentials: 'same-origin',
  })
}

async function fetchWithTimeout(input, options = {}, timeoutMs = PRECACHE_TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

function isCacheableShell(response, url) {
  if (!response || response.status !== 200 || response.type === 'opaque') return false
  if (url.origin !== self.location.origin) return false
  const finalUrl = new URL(response.url || url.href)
  // A protected route may redirect to the login screen when the server-side auth
  // lookup cannot reach Supabase. Never save that login page over the CRM shell.
  if (finalUrl.pathname.startsWith('/auth/')) return false
  return (response.headers.get('Content-Type') || '').toLowerCase().includes('text/html')
}

async function cacheBuildAssetsFromHtml(response, staticCache) {
  try {
    const html = await response.text()
    const references = new Set()
    const pattern = /(?:src|href)=["']([^"']*\/_next\/static\/[^"']+)["']/g
    for (const match of html.matchAll(pattern)) {
      try {
        const assetUrl = new URL(match[1].replace(/&amp;/g, '&'), self.location.origin)
        if (assetUrl.origin === self.location.origin && assetUrl.pathname.startsWith('/_next/static/')) {
          references.add(assetUrl.href)
        }
      } catch {}
    }

    await Promise.all(
      [...references].map(async (assetUrl) => {
        try {
          if (await staticCache.match(assetUrl)) return
          const asset = await fetchWithTimeout(assetUrl, { credentials: 'same-origin', cache: 'reload' })
          if (asset?.status === 200 && !isPrivateResponse(asset)) {
            await staticCache.put(assetUrl, asset)
          }
        } catch {}
      })
    )
  } catch {}
}

async function cacheShellDocument(cache, staticCache, pathname, response) {
  await cache.put(shellCacheKey(pathname), response.clone())
  // The clone is consumed separately so the HTML response can still be returned.
  await cacheBuildAssetsFromHtml(response.clone(), staticCache)
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE)
      const staticCache = await caches.open(STATIC_CACHE)
      for (const url of PRECACHE_SHELL_URLS) {
        try {
          // cache: 'reload' so a new version never precaches a stale HTTP-cached shell.
          const res = await fetchWithTimeout(url, { credentials: 'same-origin', cache: 'reload' })
          const parsedUrl = new URL(url, self.location.origin)
          if (isCacheableShell(res, parsedUrl)) {
            await cacheShellDocument(cache, staticCache, parsedUrl.pathname, res)
          } else if (res?.status === 200 && isStaticAsset(parsedUrl) && !isPrivateResponse(res)) {
            await staticCache.put(parsedUrl.href, res)
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
      const previousShell = newestPreviousCache(keys, 'aura-crm-shell-')
      const previousStatic = newestPreviousCache(keys, 'aura-crm-static-')
      const previousState = newestPreviousCache(keys, 'aura-crm-state-')
      const keep = new Set([...CURRENT_CACHES, previousShell, previousStatic, previousState].filter(Boolean))
      const obsoleteAuraCaches = keys.filter(
        (key) => key.startsWith('aura-crm-') && !keep.has(key),
      )
      await Promise.all(obsoleteAuraCaches.map((key) => caches.delete(key)))
      await self.clients.claim()
    })()
  )
})

function newestPreviousCache(keys, prefix) {
  return keys
    .filter((key) => key.startsWith(prefix) && !CURRENT_CACHES.includes(key))
    .sort((a, b) => cacheVersion(b, prefix) - cacheVersion(a, prefix))[0] || null
}

function cacheVersion(name, prefix) {
  return Number(name.slice(prefix.length).replace(/\D/g, '')) || 0
}

// ---------------------------------------------------------------------------
// Messages from the app
// ---------------------------------------------------------------------------

self.addEventListener('message', (event) => {
  const data = event.data || {}

  if (data.type === 'AURA_SKIP_WAITING') {
    self.skipWaiting()
    return
  }

  if (data.type === 'AURA_CLOUD_UNREACHABLE' || data.type === 'AURA_CLOUD_REACHABLE') {
    event.waitUntil(updateCloudReachability(data.type === 'AURA_CLOUD_UNREACHABLE'))
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

  // Shop switch: cached server-rendered shells may contain shop-specific props.
  if (data.type === 'AURA_SHOP_CHANGED') {
    event.waitUntil(
      (async () => {
        const keys = await caches.keys()
        await Promise.all(
          keys.filter((key) => key.startsWith('aura-crm-shell-')).map((key) => caches.delete(key)),
        )
      })(),
    )
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

/** Static files are safe to cache only when they are ordinary public responses. */
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

async function updateCloudReachability(unreachable) {
  if (unreachable) {
    const cache = await caches.open(STATE_CACHE)
    await cache.put(
      CLOUD_FAILURE_KEY,
      new Response(String(Date.now()), {
        headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' },
      }),
    )
  } else {
    const keys = await caches.keys()
    await Promise.all(
      keys
        .filter((key) => key.startsWith('aura-crm-state-'))
        .map(async (key) => (await caches.open(key)).delete(CLOUD_FAILURE_KEY)),
    )
  }
}

async function cloudWasRecentlyUnreachable() {
  try {
    const keys = await caches.keys()
    const stateCaches = keys
      .filter((key) => key.startsWith('aura-crm-state-'))
      .sort((a, b) => cacheVersion(b, 'aura-crm-state-') - cacheVersion(a, 'aura-crm-state-'))
    for (const cacheName of stateCaches) {
      const response = await (await caches.open(cacheName)).match(CLOUD_FAILURE_KEY)
      if (!response) continue
      const failedAt = Number(await response.text())
      // Keep offline fallback enabled briefly even when the browser's own online flag
      // remains true (for example, Wi-Fi is connected but DNS/Supabase is not).
      if (!Number.isFinite(failedAt) || Date.now() - failedAt > 5 * 60 * 1000) {
        await updateCloudReachability(false)
        return false
      }
      return true
    }
    return false
  } catch {
    return false
  }
}

function isStaticAsset(url) {
  if (url.origin !== self.location.origin) return false
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname === '/manifest.json' ||
    /\.(js|css|png|jpg|jpeg|svg|ico|woff2|webmanifest)$/.test(url.pathname)
  )
}

async function handleNavigation(request, url) {
  const cache = await caches.open(SHELL_CACHE)
  const staticCache = await caches.open(STATIC_CACHE)

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), NAV_TIMEOUT_MS)
    let network
    try {
      network = await fetch(request, { signal: controller.signal })
    } finally {
      clearTimeout(timer)
    }

    if (isCacheableShell(network, url)) {
      cacheShellDocument(cache, staticCache, url.pathname, network).catch(() => {})
      return network
    }

    // Some auth SDK versions turn an unreachable auth lookup into a redirect rather
    // than a 5xx. In a browser-known offline state, use the already-cached CRM shell.
    const finalPath = network?.url ? new URL(network.url).pathname : ''
    const authLookupFailed = finalPath.startsWith('/auth/login') && url.pathname.startsWith('/crm/')
    if (authLookupFailed && (!navigator.onLine || await cloudWasRecentlyUnreachable())) {
      const cached = await findCachedShell(cache, url.pathname)
      if (cached) {
        notifyClients({ type: 'AURA_OFFLINE_SHELL', path: url.pathname })
        return cached
      }
    }

    // When Next's server-side auth/data checks fail because Supabase is unreachable,
    // prefer the last good document over an error page. Do not mask auth redirects or
    // ordinary 4xx responses (for example, a genuinely missing page).
    if (network && (network.status >= 500 || network.status === 408 || network.status === 429)) {
      const cached = await findCachedShell(cache, url.pathname)
      if (cached) {
        notifyClients({ type: 'AURA_OFFLINE_SHELL', path: url.pathname })
        return cached
      }
    }
    return network
  } catch {
    // Offline (or the network is too slow): serve the precached interactive shell.
    const cached = await findCachedShell(cache, url.pathname)

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

async function findCachedShell(cache, pathname) {
  const keys = await caches.keys()
  const shellCaches = keys
    .filter((key) => key.startsWith('aura-crm-shell-'))
    .sort((a, b) => cacheVersion(b, 'aura-crm-shell-') - cacheVersion(a, 'aura-crm-shell-'))
  const legacyCrmRoutes = new Set([
    '/pos',
    '/showcase',
    '/inventory',
    '/customers',
    '/stores',
    '/notifications',
    '/suppliers',
    '/cabinet',
    '/reports',
  ])
  const isCrmRoute = pathname === '/crm' || pathname.startsWith('/crm/') || legacyCrmRoutes.has(pathname)
  const lookupPaths = [pathname]
  if (isCrmRoute) lookupPaths.push('/crm/pos', '/crm')

  // Prefer the exact route from any retained version before falling back to the
  // POS shell. A new cache may be only partially populated during an offline update.
  for (const path of lookupPaths) {
    for (const cacheName of shellCaches) {
      const candidateCache = cacheName === SHELL_CACHE ? cache : await caches.open(cacheName)
      const match = await candidateCache.match(shellCacheKey(path), {
        ignoreSearch: true,
        ignoreVary: true,
      })
      if (match) return match
    }
  }
  return null
}

async function handleStatic(request) {
  const cache = await caches.open(STATIC_CACHE)
  const cached = await cache.match(request)
  if (cached) return cached
  const cacheNames = await caches.keys()
  const previousCaches = cacheNames
    .filter((key) => key.startsWith('aura-crm-static-') && key !== STATIC_CACHE)
    .sort((a, b) => cacheVersion(b, 'aura-crm-static-') - cacheVersion(a, 'aura-crm-static-'))
  for (const cacheName of previousCaches) {
    const previous = await (await caches.open(cacheName)).match(request)
    if (previous) return previous
  }

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

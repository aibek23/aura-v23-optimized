/**
 * Upgraded Service Worker for Aura CRM.
 * Implements:
 * 1. Cache-First (with background network update) for CRM HTML pages and shells.
 * 2. Caching of Supabase REST API GET responses in a dedicated API cache.
 * 3. Cache-First for static assets (JS, CSS, images, SQLite WASM, fonts).
 * 4. Automatic cleanup of old caches upon SW update.
 */

const SHELL_CACHE = 'aura-crm-shell-v3'
const STATIC_CACHE = 'aura-crm-static-v3'
const API_CACHE = 'aura-crm-api-v3'

const CURRENT_CACHES = [SHELL_CACHE, STATIC_CACHE, API_CACHE]

// Pre-cached core CRM sections and essential assets
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
  '/sqlite3/sqlite3.wasm',
]

// 1. Install & Precache
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(async (cache) => {
      // Pre-cache individual items without failing entire install on 404
      for (const url of PRECACHE_SHELL_URLS) {
        try {
          const res = await fetch(url, { credentials: 'same-origin' })
          if (res && res.status === 200) {
            await cache.put(url, res)
          }
        } catch (err) {
          // Ignore individual fetch errors during build/dev
        }
      }
    })
  )
  self.skipWaiting()
})

// 2. Activate & Clean Old Caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => !CURRENT_CACHES.includes(key))
          .map((key) => {
            console.log('[SW] Cleaning old cache:', key)
            return caches.delete(key)
          })
      )
    })
  )
  self.clients.claim()
})

// 3. Fetch Router
self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Skip non-GET requests (POST, PUT, DELETE, etc.)
  if (request.method !== 'GET') {
    return
  }

  // WebSocket or Auth Token Refresh bypass
  if (url.protocol === 'ws:' || url.protocol === 'wss:' || url.pathname.includes('/auth/v1/token')) {
    return
  }

  // A. Supabase REST API GET responses caching
  if (url.hostname.includes('supabase') || url.pathname.startsWith('/rest/v1')) {
    event.respondWith(
      caches.open(API_CACHE).then(async (cache) => {
        const cachedResponse = await cache.match(request)

        // Try network in background or immediately
        const networkFetch = fetch(request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              cache.put(request, networkResponse.clone())
            }
            return networkResponse
          })
          .catch(() => {
            // Return cached response if network fails
            return cachedResponse
          })

        // Stale-while-revalidate: return cached if available, else await network
        return cachedResponse || networkFetch
      })
    )
    return
  }

  // B. CRM Navigation / HTML Pages: Cache-First strategy with background revalidation
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(
      caches.open(SHELL_CACHE).then(async (cache) => {
        // Look for exact match or generic CRM shell match
        const cached =
          (await cache.match(request)) ||
          (await cache.match(url.pathname)) ||
          (await cache.match('/crm/pos')) ||
          (await cache.match('/crm')) ||
          (await cache.match('/'))

        // Background revalidation
        const networkFetch = fetch(request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              cache.put(request, networkResponse.clone())
            }
            return networkResponse
          })
          .catch(() => {
            // Fallback response if both network and cache fail
            return (
              cached ||
              new Response(
                '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Aura CRM - Офлайн</title></head><body><div id="__next">Офлайн-режим Aura CRM</div></body></html>',
                { headers: { 'Content-Type': 'text/html' } }
              )
            )
          })

        // Cache-First: return instantly from cache if available, don't wait for network!
        return cached || networkFetch
      })
    )
    return
  }

  // C. Static assets (JS, CSS, images, SQLite WASM, fonts): Cache-First
  const isStatic =
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/sqlite3/') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.wasm') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.ico') ||
    url.pathname.endsWith('.woff2')

  if (isStatic) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const cachedResponse = await cache.match(request)
        if (cachedResponse) {
          // Revalidate in background without blocking UI
          fetch(request)
            .then((res) => {
              if (res && res.status === 200) cache.put(request, res)
            })
            .catch(() => {})
          return cachedResponse
        }

        return fetch(request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              cache.put(request, networkResponse.clone())
            }
            return networkResponse
          })
          .catch(() => cachedResponse)
      })
    )
    return
  }
})

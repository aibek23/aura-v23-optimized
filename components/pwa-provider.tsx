"use client"

import { useEffect } from "react"
import type { Profile } from "@/lib/types"
import { saveUserSessionSqlite } from "@/lib/local-db/sqlite-opfs"

export function PwaProvider({ profile }: { profile?: Profile | null }) {
  useEffect(() => {
    // 1. Service Worker registration strictly in production; unregister & clear caches in dev
    if (typeof window !== "undefined") {
      const isDev = process.env.NODE_ENV !== "production"

      if (isDev) {
        // In development mode: completely unregister all service workers and clean Cache Storage
        // to prevent Turbopack/Next.js dev server from breaking on stale chunks.
        if ("serviceWorker" in navigator) {
          navigator.serviceWorker
            .getRegistrations()
            .then((registrations) => {
              for (const registration of registrations) {
                registration.unregister().catch(() => {})
              }
            })
            .catch(() => {})
        }

        if ("caches" in window) {
          caches
            .keys()
            .then((keys) => {
              for (const key of keys) {
                caches.delete(key).catch(() => {})
              }
            })
            .catch(() => {})
        }
      } else {
        // Register /sw.js strictly only in production
        if ("serviceWorker" in navigator) {
          navigator.serviceWorker
            .register("/sw.js")
            .then((reg) => {
              // Check for SW updates
              if (reg && reg.update) {
                reg.update().catch(() => {})
              }
            })
            .catch((err) => {
              console.warn("ServiceWorker registration failed:", err)
            })
        }
      }
    }

    // 2. Persist local offline session and profile to SQLite WASM with OPFS & localStorage
    if (profile) {
      if (typeof localStorage !== "undefined") {
        try {
          localStorage.setItem(
            "aura_offline_session",
            JSON.stringify({
              profile,
              shop_id: profile.shop_id,
              role: profile.role,
              timestamp: new Date().toISOString(),
            })
          )
        } catch (e) {
          console.error("Failed to persist offline session:", e)
        }
      }

      saveUserSessionSqlite({
        userId: profile.id,
        email: profile.email || undefined,
        profile,
        shopId: profile.shop_id || undefined,
      }).catch((err) => {
        console.warn("Failed to persist session to SQLite WASM:", err)
      })
    }
  }, [profile])

  return null
}

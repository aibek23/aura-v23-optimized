"use client"

import { useEffect } from "react"
import type { Profile } from "@/lib/types"
import { saveUserSession } from "@/lib/local-db/db"
import { updateSyncState } from "@/lib/local-db/sync-store"

export function PwaProvider({ profile }: { profile?: Profile | null }) {
  useEffect(() => {
    if (typeof window === "undefined") return

    const isDev = process.env.NODE_ENV !== "production"

    if (isDev) {
      // В разработке service worker не регистрируется и полностью удаляется вместе
      // с кэшами, иначе dev-сервер отдаёт устаревшие чанки.
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
            for (const key of keys) caches.delete(key).catch(() => {})
          })
          .catch(() => {})
      }
    } else if ("serviceWorker" in navigator) {
      // updateViaCache: 'none' — сам файл sw.js никогда не берётся из HTTP-кэша,
      // поэтому новая версия приложения подхватывается сразу.
      navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .then((reg) => {
          reg.update().catch(() => {})

          // Новая версия готова — активируем её без ожидания закрытия всех вкладок.
          reg.addEventListener("updatefound", () => {
            const installing = reg.installing
            if (!installing) return
            installing.addEventListener("statechange", () => {
              if (installing.state === "installed" && navigator.serviceWorker.controller) {
                reg.waiting?.postMessage({ type: "AURA_SKIP_WAITING" })
              }
            })
          })
        })
        .catch((err) => {
          console.warn("ServiceWorker registration failed:", err)
        })
    }

    // Приложение могло открыться из офлайн-кэша: показываем, что данные локальные.
    const onSwMessage = (event: MessageEvent) => {
      if (event.data?.type === "AURA_OFFLINE_SHELL") {
        updateSyncState({
          status: "offline",
          isStale: true,
          phaseLabel: "Офлайн-режим (локальные данные)",
        })
      }
    }

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("message", onSwMessage)
    }

    if (!navigator.onLine) {
      updateSyncState({ status: "offline", isStale: true, phaseLabel: "Офлайн" })
    }

    return () => {
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.removeEventListener("message", onSwMessage)
      }
    }
  }, [])

  useEffect(() => {
    if (!profile) return

    // Локальная сессия для офлайн-запуска хранится в той же базе IndexedDB.
    saveUserSession({
      userId: profile.id,
      email: profile.email || undefined,
      profile,
      shopId: profile.shop_id || undefined,
    }).catch((err) => {
      console.warn("Failed to persist offline session to IndexedDB:", err)
    })
  }, [profile])

  return null
}

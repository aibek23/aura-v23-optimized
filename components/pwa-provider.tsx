"use client"

import { useEffect } from "react"
import type { Profile } from "@/lib/types"
import { getSavedUserSession, saveUserSession } from "@/lib/local-db/db"
import { updateSyncState } from "@/lib/local-db/sync-store"
import { toast } from "sonner"
import { createClient } from "@/lib/supabase/client"

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

          // Автоматическая проверка каждые 5 минут отключена — версия проверяется
          // только при открытии приложения.

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

    // Новая версия взяла управление — перезагружаем страницу один раз.
    let reloading = false
    const hadController = "serviceWorker" in navigator && !!navigator.serviceWorker.controller
    const onControllerChange = () => {
      if (reloading || !hadController) return
      reloading = true
      // Без автоматической перезагрузки: пользователь сам решает, когда обновить.
      toast.info("Доступна новая версия Aura CRM", {
        duration: Infinity,
        action: { label: "Обновить", onClick: () => window.location.reload() },
      })
    }
    if (!isDev && "serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("controllerchange", onControllerChange)
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
        navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange)
      }
    }
  }, [])

  // Держим сохранённые токены свежими, чтобы вход по локальной сессии работал и онлайн.
  useEffect(() => {
    let unsub: (() => void) | undefined
    try {
      const supabase = createClient()
      const { data } = supabase.auth.onAuthStateChange((event, session) => {
        if (!session?.user) return
        if (event !== "SIGNED_IN" && event !== "TOKEN_REFRESHED" && event !== "INITIAL_SESSION") return
        getSavedUserSession()
          .then((saved) => {
            if (!saved || saved.userId !== session.user.id) return
            return saveUserSession({
              userId: saved.userId,
              email: saved.email,
              profile: saved.profile,
              shopId: saved.shopId,
              session,
            })
          })
          .catch(() => {})
      })
      unsub = () => data.subscription.unsubscribe()
    } catch {}
    return () => unsub?.()
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

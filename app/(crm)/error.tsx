"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { AuraMark } from "@/components/brand/aura-mark"
import { AlertTriangle, RefreshCw, LogIn } from "lucide-react"

export default function CrmError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const router = useRouter()

  // Если ошибка аутентификации — сразу редиректим на логин.
  useEffect(() => {
    const msg = error.message ?? ""
    if (msg.includes("Требуется вход") || msg.includes("Сессия истекла") || msg.includes("Войдите")) {
      router.push("/auth/login")
    }
  }, [error, router])

  const isAuthError =
    error.message?.includes("подтверждён") ||
    error.message?.includes("Аккаунт") ||
    error.message?.includes("Требуется вход")

  return (
    <div className="flex min-h-svh w-full items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        {/* Логотип */}
        <div className="mb-6 flex justify-center">
          <AuraMark className="h-10 w-10 opacity-80" />
        </div>

        {/* Иконка ошибки */}
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertTriangle className="h-7 w-7" />
        </div>

        <h1 className="text-xl font-semibold text-foreground">
          {isAuthError ? "Доступ ограничен" : "Что-то пошло не так"}
        </h1>

        <p className="mt-2 text-sm text-muted-foreground text-pretty">
          {isAuthError
            ? error.message
            : "Произошла непредвиденная ошибка при загрузке данных. Попробуйте обновить страницу."}
        </p>

        {error.digest && (
          <p className="mt-1 font-mono text-[10px] text-muted-foreground/60">
            код: {error.digest}
          </p>
        )}

        <div className="mt-6 flex flex-col gap-2">
          {isAuthError ? (
            <Button className="w-full gap-2" onClick={() => router.push("/auth/login")}>
              <LogIn className="h-4 w-4" />
              Войти заново
            </Button>
          ) : (
            <>
              <Button className="w-full gap-2" onClick={reset}>
                <RefreshCw className="h-4 w-4" />
                Обновить страницу
              </Button>
              <Button variant="outline" className="w-full bg-transparent" onClick={() => router.push("/auth/login")}>
                Выйти и войти заново
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

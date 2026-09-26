"use client"

import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { AuthShell } from "@/components/auth/auth-shell"
import { InlineLoader } from "@/components/ui/page-loader"
import { getSavedUserSession, saveUserSession, type SavedUserSession } from "@/lib/local-db/db"
import { WifiOff, UserCheck } from "lucide-react"

function loginErrorMessage(error: unknown): string {
  const { code, status } = (error ?? {}) as { code?: string; status?: number }
  if (code === "email_not_confirmed") return "Подтвердите email — проверьте почту и перейдите по ссылке."
  if (code === "over_request_rate_limit" || status === 429) return "Слишком много попыток. Подождите немного."
  if (code === "invalid_credentials") return "Неверный email или пароль."
  return "Что-то пошло не так. Попробуйте ещё раз."
}

export default function LoginPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [savedSession, setSavedSession] = useState<SavedUserSession | null>(null)
  const [isOffline, setIsOffline] = useState(false)
  const router = useRouter()

  useEffect(() => {
    setIsOffline(!navigator.onLine)
    const handleOnline = () => setIsOffline(false)
    const handleOffline = () => setIsOffline(true)
    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)

    // Check if an offline profile exists in IndexedDB.
    getSavedUserSession().then((session) => {
      if (session && session.profile) {
        setSavedSession(session)
      }
    })

    return () => {
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
    }
  }, [])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    const supabase = createClient()
    setIsLoading(true)
    setError(null)
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error

      // Persist auth session & profile in IndexedDB for offline access.
      if (data?.user) {
        try {
          const { data: profile } = await supabase.from("profiles").select("*").eq("id", data.user.id).single()
          if (profile) {
            await saveUserSession({
              userId: data.user.id,
              email: data.user.email,
              profile,
              session: data.session,
              shopId: profile.shop_id,
            })
          }
        } catch (persistErr) {
          console.warn("Session persist warning:", persistErr)
        }
      }

      router.push("/crm")
    } catch (error: unknown) {
      console.error("[v0] Login error:", error)
      // If offline or network error, check if we can restore offline session
      if (!navigator.onLine && savedSession) {
        router.push("/crm/pos")
        return
      }
      setError(loginErrorMessage(error))
    } finally {
      setIsLoading(false)
    }
  }

  const handleContinueOffline = () => {
    router.push("/crm/pos")
  }

  return (
    <AuthShell title="Вход в систему" subtitle="Введите данные, чтобы войти в личный кабинет Aura">
      {savedSession && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50/90 p-4 text-sm dark:border-amber-800/80 dark:bg-amber-950/40 shadow-xs">
          <div className="flex items-center gap-2 font-medium text-amber-900 dark:text-amber-200">
            {isOffline ? <WifiOff className="w-4 h-4 text-amber-600" /> : <UserCheck className="w-4 h-4 text-amber-600" />}
            <span>{isOffline ? "Офлайн-режим активен" : "Сохранённая локальная сессия"}</span>
          </div>
          <p className="mt-1.5 text-xs text-amber-800/90 dark:text-amber-300/80 leading-relaxed">
            Сотрудник: <strong className="font-semibold">{savedSession.profile?.full_name || savedSession.email}</strong>{" "}
            ({savedSession.profile?.role === "admin" ? "Администратор" : savedSession.profile?.role === "super_admin" ? "Суперадмин" : "Продавец"})
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleContinueOffline}
            className="mt-3 w-full border-amber-400 bg-amber-100/70 text-amber-950 hover:bg-amber-200/80 dark:border-amber-700 dark:bg-amber-900/50 dark:text-amber-100 font-medium"
          >
            Войти в CRM без сети
          </Button>
        </div>
      )}

      <form onSubmit={handleLogin} className="flex flex-col gap-5">
        <div className="grid gap-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            placeholder="mail@aura.gold.kg"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="password">Пароль</Label>
          <Input
            id="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={isLoading}>
          {isLoading ? (
            <span className="flex items-center gap-2">
              <InlineLoader />
              Вход...
            </span>
          ) : (
            "Войти"
          )}
        </Button>
        <p className="text-center text-sm text-muted-foreground">
          Нет аккаунта?{" "}
          <Link href="/auth/sign-up" className="text-primary underline-offset-4 hover:underline">
            Зарегистрироваться
          </Link>
        </p>
      </form>
    </AuthShell>
  )
}

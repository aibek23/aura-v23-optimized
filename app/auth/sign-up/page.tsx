"use client"

import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { AuthShell } from "@/components/auth/auth-shell"
import { InlineLoader } from "@/components/ui/page-loader"

function signUpErrorMessage(error: unknown): string {
  const { code, status } = (error ?? {}) as { code?: string; status?: number }
  if (code === "weak_password") return "Выберите более надёжный пароль (минимум 6 символов)."
  if (code === "email_address_invalid") return "Укажите реальный email — тестовые домены не поддерживаются."
  if (code === "email_address_not_authorized") return "Не удаётся отправить письмо на этот адрес. Используйте другой."
  if (code === "user_already_exists") return "Пользователь с таким email уже существует."
  if (code === "over_email_send_rate_limit" || status === 429) return "Слишком много попыток. Подождите немного."
  return "Не удалось завершить регистрацию. Попробуйте ещё раз."
}

export default function SignUpPage() {
  const [fullName, setFullName] = useState("")
  const [shopName, setShopName] = useState("")
  const [phone, setPhone] = useState("")
  const [requestedRole, setRequestedRole] = useState("seller")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [repeatPassword, setRepeatPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (password !== repeatPassword) {
      setError("Пароли не совпадают")
      return
    }
    const supabase = createClient()
    setIsLoading(true)
    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo:
            process.env.NEXT_PUBLIC_SITE_URL
              ? `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`
              : `${window.location.origin}/auth/callback`,
          data: {
            full_name: fullName,
            shop_name: shopName,
            phone,
            requested_role: requestedRole,
          },
        },
      })
      if (error) throw error
      router.push("/auth/sign-up-success")
    } catch (error: unknown) {
      console.error("[v0] Sign-up error:", error)
      setError(signUpErrorMessage(error))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <AuthShell title="Регистрация" subtitle="Создайте аккаунт. Доступ активирует администратор магазина.">
      <form onSubmit={handleSignUp} className="flex flex-col gap-4">
        <div className="grid gap-2">
          <Label htmlFor="fullName">Ваше имя</Label>
          <Input id="fullName" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="shopName">Название магазина</Label>
          <Input
            id="shopName"
            placeholder="Например: Aura Bishkek"
            required
            value={shopName}
            onChange={(e) => setShopName(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-2">
            <Label htmlFor="phone">Телефон</Label>
            <Input id="phone" placeholder="+996" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="role">Роль</Label>
            <Select value={requestedRole} onValueChange={(v) => setRequestedRole(v ?? "")}>
              <SelectTrigger id="role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="seller">Продавец</SelectItem>
                <SelectItem value="admin">Администратор</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
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
          <div className="grid gap-2">
            <Label htmlFor="repeat">Повтор</Label>
            <Input
              id="repeat"
              type="password"
              required
              value={repeatPassword}
              onChange={(e) => setRepeatPassword(e.target.value)}
            />
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={isLoading}>
          {isLoading ? (
            <span className="flex items-center gap-2">
              <InlineLoader />
              Создание...
            </span>
          ) : (
            "Зарегистрироваться"
          )}
        </Button>
        <p className="text-center text-sm text-muted-foreground">
          Уже есть аккаунт?{" "}
          <Link href="/auth/login" className="text-primary underline-offset-4 hover:underline">
            Войти
          </Link>
        </p>
      </form>
    </AuthShell>
  )
}

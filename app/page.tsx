import Link from "next/link"
import type { Metadata } from "next"
import { getPublicShops } from "@/app/actions/shops"
import { AuraMark } from "@/components/brand/aura-mark"
import { Button } from "@/components/ui/button"
import { ArrowRight, Gem, ShieldCheck, Store } from "lucide-react"

export const revalidate = 300

export const metadata: Metadata = {
  title: "Aura — маркетплейс ювелирных магазинов и CRM",
  description:
    "Aura объединяет витрины ювелирных магазинов и CRM для учёта: склад, касса, этикетки и бонусы продавцов.",
  openGraph: {
    title: "Aura — маркетплейс ювелирных магазинов и CRM",
    description: "Витрины ювелирных магазинов и CRM для учёта: склад, касса, этикетки, бонусы.",
    type: "website",
  },
  twitter: { card: "summary_large_image" },
}

export default async function LandingPage() {
  const shops = await getPublicShops()

  return (
    <main className="min-h-screen bg-background">
      <header className="flex items-center justify-between border-b border-border px-5 py-4">
        <div className="flex items-center gap-2">
          <AuraMark className="h-7 w-7" />
          <span className="font-serif text-lg">Aura</span>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href="/auth/login">Вход</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/auth/sign-up">Регистрация</Link>
          </Button>
        </div>
      </header>

      <section className="mx-auto max-w-4xl px-5 py-16 text-center">
        <h1 className="font-serif text-4xl leading-tight sm:text-5xl">
          Ювелирные магазины и учёт в одном месте
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-sm text-muted-foreground sm:text-base">
          App — публичные витрины изделий для покупателей. CRM — склад, касса, этикетки и бонусы
          для команды магазина.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button asChild size="lg" className="gap-2">
            <Link href="/auth/sign-up">
              Регистрация
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="bg-transparent">
            <Link href="/crm">Войти в CRM</Link>
          </Button>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-5 pb-16">
        <div className="grid gap-4 sm:grid-cols-3">
          <Feature icon={<Store className="h-5 w-5 text-primary" />} title="App — витрины">
            Каталог магазинов, карточки изделий по QR-коду с этикетки.
          </Feature>
          <Feature icon={<Gem className="h-5 w-5 text-primary" />} title="CRM — учёт">
            Склад, касса, отчёты, печать этикеток Niimbot и артикулы.
          </Feature>
          <Feature icon={<ShieldCheck className="h-5 w-5 text-primary" />} title="Роли и бонусы">
            Супер админ, админ и продавцы с бонусами от прибыли.
          </Feature>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-5 pb-20">
        <h2 className="font-serif text-2xl">Магазины</h2>
        <p className="mt-1 text-sm text-muted-foreground">Публичные витрины участников Aura</p>

        {shops.length === 0 ? (
          <p className="mt-8 rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Пока нет открытых витрин. Зарегистрируйте магазин — и он появится здесь.
          </p>
        ) : (
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {shops.map((s) => (
              <Link
                key={s.shop_id}
                href={`/store/${s.shop_id}`}
                className="group rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <Store className="h-5 w-5 text-primary" />
                </div>
                <div className="mt-3 font-medium">{s.shop_name ?? "Ювелирный магазин"}</div>
                <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                  Смотреть витрину
                  <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <footer className="border-t border-border px-5 py-6 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} Aura · app + crm
      </footer>
    </main>
  )
}

function Feature({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">{icon}</div>
      <div className="mt-3 font-medium">{title}</div>
      <p className="mt-1 text-sm text-muted-foreground">{children}</p>
    </div>
  )
}
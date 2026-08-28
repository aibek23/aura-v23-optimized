import Link from "next/link"
import type { Metadata } from "next"
import { getPublicShopProducts } from "@/app/actions/store"
import { formatSom, formatWeight } from "@/lib/format"
import { AuraMark } from "@/components/brand/aura-mark"

type Params = { store_id: string }

export const revalidate = 300

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { store_id } = await params
  const products = await getPublicShopProducts(store_id, 1)
  const shop = products[0]?.shop_name ?? "Ювелирный магазин"
  const title = `${shop} — витрина на Aura`
  const description = `Изделия магазина ${shop}: золото, серебро, вес, проба и цены.`
  return {
    title,
    description,
    openGraph: { title, description, type: "website" },
    twitter: { card: "summary", title, description },
  }
}

export default async function StorePage({ params }: { params: Promise<Params> }) {
  const { store_id } = await params
  const products = await getPublicShopProducts(store_id, 24)
  const shop = products[0]?.shop_name ?? "Ювелирный магазин"

  return (
    <main className="min-h-screen bg-background">
      <header className="flex items-center justify-between border-b border-border px-5 py-4">
        <Link href="/" className="flex items-center gap-2">
          <AuraMark className="h-7 w-7" />
          <span className="font-serif text-lg">Aura</span>
        </Link>
        <span className="text-sm text-muted-foreground">{shop}</span>
      </header>

      <section className="mx-auto max-w-5xl px-5 py-10">
        <h1 className="font-serif text-3xl">{shop}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Изделия в наличии</p>

        {products.length === 0 ? (
          <p className="mt-8 rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            В этой витрине пока нет изделий.
          </p>
        ) : (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((p) => {
              const cover = p.images?.[0] ?? p.image_url
              return (
                <Link
                  key={p.id}
                  href={`/store/${store_id}/product/${encodeURIComponent(p.sku ?? "")}`}
                  className="overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-primary"
                >
                  <div className="aspect-square bg-muted">
                    {cover && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={cover} alt={p.name} className="h-full w-full object-cover" />
                    )}
                  </div>
                  <div className="p-4">
                    <div className="line-clamp-1 text-sm font-medium">{p.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {p.metal ?? "—"} · {formatWeight(p.weight)}
                    </div>
                    <div className="mt-1 font-mono text-sm font-semibold text-primary">
                      {formatSom(p.sale_price)}
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </section>
    </main>
  )
}
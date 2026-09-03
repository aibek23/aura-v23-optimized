import Link from "next/link"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getPublicProduct } from "@/app/actions/store"
import { formatSom, formatWeight } from "@/lib/format"
import { purityFromMetal } from "@/lib/purity"
import { AuraMark } from "@/components/brand/aura-mark"

type Params = { store_id: string; article: string }

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { store_id, article } = await params
  const product = await getPublicProduct(store_id, article)
  return {
    title: product ? `${product.name} — Aura` : "Изделие — Aura",
    description: product?.description ?? "Карточка ювелирного изделия",
  }
}

export default async function ProductPage({ params }: { params: Promise<Params> }) {
  const { store_id, article } = await params
  const product = await getPublicProduct(store_id, article)
  if (!product) notFound()

  const cover = product.images?.[0] ?? product.image_url

  return (
    <main className="min-h-screen bg-background">
      <header className="flex items-center justify-between border-b border-border px-5 py-4">
        <Link href={`/store/${store_id}`} className="flex items-center gap-2">
          <AuraMark className="h-7 w-7" />
          <span className="font-serif text-lg">Aura</span>
        </Link>
        <Link href={`/store/${store_id}`} className="text-sm text-muted-foreground hover:text-foreground">
          Назад к витрине
        </Link>
      </header>
      <section className="mx-auto grid max-w-5xl gap-8 px-5 py-10 md:grid-cols-2">
        <div className="aspect-square overflow-hidden rounded-2xl bg-muted">
          {cover && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cover} alt={product.name} className="h-full w-full object-cover" />
          )}
        </div>
        <div className="flex flex-col justify-center gap-5">
          <div>
            <p className="text-sm text-muted-foreground">{product.shop_name ?? "Ювелирный магазин"}</p>
            <h1 className="mt-2 font-serif text-3xl text-balance">{product.name}</h1>
          </div>
          <p className="font-mono text-2xl font-semibold text-primary">{formatSom(product.sale_price)}</p>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-muted-foreground">Металл</dt><dd>{product.metal ?? "—"}</dd></div>
            <div><dt className="text-muted-foreground">Проба</dt><dd>{purityFromMetal(product.metal) || "—"}</dd></div>
            <div><dt className="text-muted-foreground">Вес</dt><dd>{formatWeight(product.weight)}</dd></div>
            <div><dt className="text-muted-foreground">Размер</dt><dd>{product.size ?? "—"}</dd></div>
          </dl>
          {product.description && <p className="leading-6 text-muted-foreground">{product.description}</p>}
        </div>
      </section>
    </main>
  )
}

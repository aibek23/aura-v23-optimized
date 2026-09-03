import Link from "next/link"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getPublicProductBySeqId } from "@/app/actions/store"
import { formatSom, formatWeight } from "@/lib/format"
import { purityFromMetal } from "@/lib/purity"
import { AuraMark } from "@/components/brand/aura-mark"

/**
 * /q/[shopId]/[sku] — короткий маршрут для QR-кодов на этикетках.
 *
 * shopId — числовой seq_id магазина (или UUID для обратной совместимости).
 * sku    — латинский артикул, например RY00042.
 *
 * Маршрут намеренно плоский (/q/…), без /product/ в пути, что сокращает
 * длину URL и делает QR-код компактным и легко читаемым сканерами.
 */

type Params = { shopId: string; sku: string }

export const revalidate = 300

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { shopId, sku } = await params
  const product = await getPublicProductBySeqId(shopId, sku)
  return {
    title: product ? `${product.name} — Aura` : "Изделие — Aura",
    description: product?.description ?? "Карточка ювелирного изделия",
    openGraph: {
      title: product ? `${product.name} — Aura` : "Изделие — Aura",
      description: product?.description ?? "Карточка ювелирного изделия",
      type: "website",
      images: product?.images?.[0] ?? product?.image_url ?? undefined,
    },
  }
}

export default async function QrProductPage({ params }: { params: Promise<Params> }) {
  const { shopId, sku } = await params
  const product = await getPublicProductBySeqId(shopId, sku)
  if (!product) notFound()

  const cover = product.images?.[0] ?? product.image_url
  // Для ссылки «Назад к витрине» используем UUID магазина (он есть всегда)
  const storeHref = `/store/${product.shop_id}`

  return (
    <main className="min-h-screen bg-background">
      <header className="flex items-center justify-between border-b border-border px-5 py-4">
        <Link href={storeHref} className="flex items-center gap-2">
          <AuraMark className="h-7 w-7" />
          <span className="font-serif text-lg">Aura</span>
        </Link>
        <Link
          href={storeHref}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Назад к витрине
        </Link>
      </header>

      <section className="mx-auto grid max-w-5xl gap-8 px-5 py-10 md:grid-cols-2">
        {/* Фото */}
        <div className="aspect-square overflow-hidden rounded-2xl bg-muted">
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cover} alt={product.name} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground text-sm">
              Нет фото
            </div>
          )}
        </div>

        {/* Информация */}
        <div className="flex flex-col justify-center gap-5">
          <div>
            <p className="text-sm text-muted-foreground">
              {product.shop_name ?? "Ювелирный магазин"}
            </p>
            <h1 className="mt-2 font-serif text-3xl text-balance">{product.name}</h1>
          </div>

          <p className="font-mono text-2xl font-semibold text-primary">
            {formatSom(product.sale_price)}
          </p>

          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-muted-foreground">Металл</dt>
              <dd>{product.metal ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Проба</dt>
              <dd>{purityFromMetal(product.metal) || "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Вес</dt>
              <dd>{formatWeight(product.weight)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Размер</dt>
              <dd>{product.size ?? "—"}</dd>
            </div>
            {product.stones && (
              <div className="col-span-2">
                <dt className="text-muted-foreground">Камни</dt>
                <dd>{product.stones}</dd>
              </div>
            )}
            <div>
              <dt className="text-muted-foreground">Артикул</dt>
              <dd className="font-mono text-xs">{product.sku ?? "—"}</dd>
            </div>
          </dl>

          {product.description && (
            <p className="leading-6 text-muted-foreground">{product.description}</p>
          )}
        </div>
      </section>
    </main>
  )
}

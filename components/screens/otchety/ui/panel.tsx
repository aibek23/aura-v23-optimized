// ─── Panel — обёртка секции карточки ─────────────────────────────────────────

import type { LucideIcon } from "lucide-react"

interface PanelProps {
  title: string
  subtitle?: string
  icon: LucideIcon
  children: React.ReactNode
}

/**
 * Карточка-секция с заголовком, иконкой и опциональным подзаголовком.
 */
export function Panel({ title, subtitle, icon: Icon, children }: PanelProps) {
  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="mb-4 flex min-w-0 items-center gap-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{title}</h2>
          {subtitle && (
            <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
      </div>
      {children}
    </section>
  )
}

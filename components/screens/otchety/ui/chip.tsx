// ─── Chip — переключатель периодов / категорий ──────────────────────────────

import { cn } from "@/lib/utils"

interface ChipProps {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}

/**
 * Pill-кнопка для выбора периода, категории или сортировки.
 */
export function Chip({ active, onClick, children }: ChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  )
}

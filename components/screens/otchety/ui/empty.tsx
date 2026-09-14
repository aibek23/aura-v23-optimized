// ─── Empty — заглушка при отсутствии данных ──────────────────────────────────

interface EmptyProps {
  children: React.ReactNode
}

/**
 * Пустое состояние секции с пунктирной рамкой.
 */
export function Empty({ children }: EmptyProps) {
  return (
    <div className="rounded-xl border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}

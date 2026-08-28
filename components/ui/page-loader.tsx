"use client"

import { cn } from "@/lib/utils"

/**
 * PageLoader — полноэкранный лоадер с backdrop-blur.
 * Стилистика повторяет модальные окна проекта (bg-background/80, backdrop-blur-sm).
 */
export function PageLoader({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center",
        "bg-background/80 backdrop-blur-sm",
        className,
      )}
    >
      <AuraSpinner />
    </div>
  )
}

/**
 * SectionLoader — лоадер для секции внутри страницы (не фиксированный).
 * Минимальная высота задаётся через className (напр. "min-h-[200px]").
 */
export function SectionLoader({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-2xl",
        "bg-card/80 backdrop-blur-sm border border-border/60",
        "min-h-[160px]",
        className,
      )}
    >
      <AuraSpinner size="sm" />
    </div>
  )
}

/**
 * InlineLoader — маленький лоадер для кнопок и строчных мест.
 */
export function InlineLoader({ className }: { className?: string }) {
  return <AuraSpinner size="xs" className={className} />
}

/* ------------------------------------------------------------------ */

type SpinnerSize = "xs" | "sm" | "md" | "lg"

function AuraSpinner({
  size = "md",
  className,
}: {
  size?: SpinnerSize
  className?: string
}) {
  const ring = {
    xs: "h-4 w-4 border-2",
    sm: "h-7 w-7 border-2",
    md: "h-11 w-11 border-[3px]",
    lg: "h-16 w-16 border-4",
  }[size]

  const gem = {
    xs: "h-1.5 w-1.5",
    sm: "h-2.5 w-2.5",
    md: "h-4 w-4",
    lg: "h-5 w-5",
  }[size]

  return (
    <div className={cn("relative flex items-center justify-center", className)}>
      {/* Внешнее вращающееся кольцо */}
      <span
        className={cn(
          "absolute rounded-full border-primary/30 border-t-primary animate-spin",
          ring,
        )}
      />
      {/* Внутренний ромб — отсылка к ювелирной теме */}
      <span
        className={cn(
          "rotate-45 rounded-sm bg-primary/20 border border-primary/40",
          gem,
        )}
      />
    </div>
  )
}

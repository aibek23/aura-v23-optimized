import type { ReactNode } from "react"
import { AuraMark } from "@/components/brand/aura-mark"

export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle: string
  children: ReactNode
}) {
  return (
    <div className="relative flex min-h-svh w-full items-center justify-center overflow-hidden p-6">
      {/* subtle radial glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 0%, oklch(0.78 0.13 78 / 0.12), transparent 70%)",
        }}
      />
      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <AuraMark className="h-12 w-12" />
          <div>
            <h1 className="font-serif text-3xl tracking-tight">Aura</h1>
            <p className="text-xs uppercase tracking-[0.3em] text-primary">gold.kg</p>
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-card/80 p-6 shadow-xl backdrop-blur">
          <div className="mb-6 space-y-1">
            <h2 className="text-lg font-semibold">{title}</h2>
            <p className="text-sm text-muted-foreground text-pretty">{subtitle}</p>
          </div>
          {children}
        </div>
      </div>
    </div>
  )
}

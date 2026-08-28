"use client"

import { useEffect, useState } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { Plus, X } from "lucide-react"
import {
  DEFAULT_PURITIES,
  METAL_BASES,
  METAL_CONDITIONS,
  addPurity,
  composeMetal,
  readPurities,
  removePurity,
  type MetalCondition,
} from "@/lib/metal"

/**
 * Двухуровневый выбор металла: «Новое» / «Вторичное» + базовый металл + проба.
 * Проба берётся из справочника (популярные + пользовательские) или вводится вручную.
 */
export function MetalPicker({
  condition,
  base,
  purity,
  onChange,
}: {
  condition: MetalCondition
  base: string
  purity: string
  onChange: (next: { condition: MetalCondition; base: string; purity: string; metal: string }) => void
}) {
  const [purities, setPurities] = useState<string[]>([...DEFAULT_PURITIES])
  const [manual, setManual] = useState("")

  useEffect(() => setPurities(readPurities()), [])

  const emit = (next: Partial<{ condition: MetalCondition; base: string; purity: string }>) => {
    const c = next.condition ?? condition
    const b = next.base ?? base
    const p = next.purity ?? purity
    onChange({ condition: c, base: b, purity: p, metal: composeMetal(c, b, p) })
  }

  const saveManual = () => {
    const clean = manual.trim()
    if (!clean) return
    setPurities(addPurity(clean))
    setManual("")
    emit({ purity: clean })
  }

  return (
    <div className="grid gap-3 rounded-xl border border-border bg-muted/30 p-3">
      <div className="grid gap-2">
        <Label>Состояние изделия</Label>
        <div className="grid grid-cols-2 gap-1.5">
          {METAL_CONDITIONS.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => emit({ condition: c.value })}
              className={cn(
                "rounded-lg border px-3 py-2 text-xs font-medium transition-colors",
                condition === c.value
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-muted-foreground hover:text-foreground",
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label>Металл</Label>
          <Select value={base} onValueChange={(v) => emit({ base: v ?? base })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {METAL_BASES.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-2">
          <Label>Проба</Label>
          <Select value={purity || "—"} onValueChange={(v) => emit({ purity: v === "—" ? "" : (v ?? "") })}>
            <SelectTrigger>
              <SelectValue placeholder="Проба" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="—">Без пробы</SelectItem>
              {purities.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label className="text-xs text-muted-foreground">Своя проба (сохраняется в справочник)</Label>
        <div className="flex gap-2">
          <Input
            value={manual}
            placeholder="например 916"
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                saveManual()
              }
            }}
          />
          <Button type="button" variant="outline" size="icon" onClick={saveManual} aria-label="Добавить пробу">
            <Plus className="size-4" />
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {purities
            .filter((p) => !(DEFAULT_PURITIES as readonly string[]).includes(p))
            .map((p) => (
              <span
                key={p}
                className="inline-flex items-center gap-1 rounded-full border border-border py-0.5 pl-2.5 pr-1 text-[11px]"
              >
                {p}
                <button
                  type="button"
                  aria-label={`Удалить пробу ${p}`}
                  onClick={() => {
                    const next = removePurity(p)
                    setPurities(next)
                    if (purity === p) emit({ purity: "" })
                  }}
                  className="rounded-full p-0.5 text-muted-foreground/70 hover:bg-destructive/10 hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Итоговый металл: <span className="font-medium text-foreground">{composeMetal(condition, base, purity)}</span>
      </p>
    </div>
  )
}

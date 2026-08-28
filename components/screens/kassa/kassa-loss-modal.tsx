"use client"

import { Button } from "@/components/ui/button"
import { AlertTriangle } from "lucide-react"
import { formatSom } from "@/lib/format"

interface KassaLossModalProps {
  isOpen: boolean
  lossAmount: number
  onClose: () => void
  onConfirm: () => void
}

export function KassaLossModal({ isOpen, lossAmount, onClose, onConfirm }: KassaLossModalProps) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-4">
        <div className="flex items-center gap-2.5 text-destructive">
          <div className="p-2 rounded-full bg-destructive/10">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <h3 className="font-bold text-sm">Продажа ниже закупочной цены</h3>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Вы уверены, что хотите продать этот товар ниже закупочной цены? Убыток составит{" "}
          <span className="font-mono font-bold text-destructive">−{formatSom(lossAmount)}</span>.
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <Button size="sm" variant="outline" className="text-xs rounded-xl" onClick={onClose}>
            Отмена
          </Button>
          <Button size="sm" variant="destructive" className="text-xs font-semibold rounded-xl" onClick={onConfirm}>
            Да, продать
          </Button>
        </div>
      </div>
    </div>
  )
}
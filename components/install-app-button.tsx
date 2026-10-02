"use client"

import { useEffect, useState } from "react"
import { Download } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"

type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }

// Кнопка «Установить приложение». Скрыта, если приложение уже установлено.
export function InstallAppButton({ className }: { className?: string }) {
  const [deferred, setDeferred] = useState<BIPEvent | null>(null)
  const [installed, setInstalled] = useState(false)
  const [isIos, setIsIos] = useState(false)

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true
    setInstalled(standalone)
    setIsIos(/iphone|ipad|ipod/i.test(navigator.userAgent))

    const onPrompt = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BIPEvent)
    }
    const onInstalled = () => {
      setInstalled(true)
      setDeferred(null)
    }
    window.addEventListener("beforeinstallprompt", onPrompt)
    window.addEventListener("appinstalled", onInstalled)
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt)
      window.removeEventListener("appinstalled", onInstalled)
    }
  }, [])

  if (installed || (!deferred && !isIos)) return null

  const onClick = async () => {
    if (deferred) {
      await deferred.prompt()
      await deferred.userChoice.catch(() => null)
      setDeferred(null)
    } else {
      toast.info("Нажмите «Поделиться» → «На экран Домой», чтобы установить приложение")
    }
  }

  return (
    <Button variant="outline" className={className} onClick={onClick}>
      <Download className="h-4 w-4" />
      Установить
    </Button>
  )
}

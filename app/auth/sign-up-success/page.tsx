import Link from "next/link"
import { Button } from "@/components/ui/button"
import { AuthShell } from "@/components/auth/auth-shell"
import { MailCheck } from "lucide-react"

export default function SignUpSuccessPage() {
  return (
    <AuthShell title="Почти готово" subtitle="Осталось подтвердить email и дождаться одобрения.">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/15 text-primary">
          <MailCheck className="h-7 w-7" />
        </div>
        <p className="text-sm text-muted-foreground text-pretty">
          Мы отправили письмо для подтверждения. После подтверждения администратор магазина активирует ваш доступ, и вы
          сможете войти в систему.
        </p>
        
        <Button asChild className="w-full">
          <Link href="/auth/login">Перейти ко входу</Link>
        </Button>
      </div>
    </AuthShell>
  )
}
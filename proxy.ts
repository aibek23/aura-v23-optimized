import { updateSession } from "@/lib/supabase/proxy"
import { type NextRequest } from "next/server"

// Экспортируем как default (самый надежный вариант для Next.js)
export default async function proxy(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    // Публичные витрины /store/... не проходят через проверку сессии.
    "/((?!store|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
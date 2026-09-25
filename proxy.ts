import { updateSession } from "@/lib/supabase/proxy"
import { type NextRequest } from "next/server"

// Экспортируем как default (самый надежный вариант для Next.js)
export default async function proxy(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    // Исключаем системные маршруты, статику, PWA манифест, Service Worker и файлы SQLite WASM
    "/((?!store|_next/static|_next/image|favicon.ico|manifest\\.json|manifest\\.webmanifest|site\\.webmanifest|sw\\.js|sync-worker\\.js|sqlite3|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|wasm|mjs|js|css|json|webmanifest|woff|woff2|ttf|eot)$).*)",
  ],
}
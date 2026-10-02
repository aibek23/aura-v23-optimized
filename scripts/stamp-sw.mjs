// Ставит уникальную версию в public/sw.js перед каждой сборкой (Vercel и локально).
// Браузер видит изменённый sw.js → ставит новую версию → приложение обновляется само.
import { readFileSync, writeFileSync } from "node:fs"

const file = new URL("../public/sw.js", import.meta.url)
const sha = (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 8)
const version = `${sha || "local"}-${Date.now().toString(36)}`
const src = readFileSync(file, "utf8")
const next = src.replace(/const VERSION = ['"][^'"]*['"]/, `const VERSION = '${version}'`)
if (next === src) {
  console.warn("[stamp-sw] VERSION не найден в public/sw.js")
} else {
  writeFileSync(file, next)
  console.log(`[stamp-sw] sw.js VERSION = ${version}`)
}

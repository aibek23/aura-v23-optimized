import { spawn } from "node:child_process"
import { resolve } from "node:path"

const command = process.argv[2]
if (command !== "dev" && command !== "start") {
  console.error("Usage: node scripts/run-next.mjs <dev|start>")
  process.exit(1)
}

const requestedPort = process.env.PORT
const port = /^\d+$/.test(requestedPort ?? "") && Number(requestedPort) > 0 && Number(requestedPort) <= 65535
  ? requestedPort
  : "8080"

if (requestedPort && requestedPort !== port) {
  console.warn(`Ignoring invalid PORT="${requestedPort}"; using ${port}.`)
}

const nextCli = resolve("node_modules/next/dist/bin/next")
const child = spawn(process.execPath, [nextCli, command, "-H", "0.0.0.0", "-p", port], {
  stdio: "inherit",
  env: { ...process.env, PORT: port },
})

child.on("error", (error) => {
  console.error("Could not start Next.js:", error.message)
  process.exitCode = 1
})
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0)
})
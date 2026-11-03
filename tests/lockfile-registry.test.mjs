import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"))
const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))

test("lockfile tarball URLs are portable to external builders such as Vercel", () => {
  const invalid = []
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!entry.resolved) continue
    if (entry.resolved === "file:vendor/xlsx-0.20.3.tgz") continue
    try {
      const url = new URL(entry.resolved)
      if (url.protocol !== "https:" || url.hostname !== "registry.npmjs.org") {
        invalid.push(path)
      }
    } catch {
      invalid.push(path)
    }
  }
  assert.deepEqual(invalid, [], `Non-public package sources: ${invalid.join(", ")}`)
})

test("lockfile root matches the declared runtime and development dependencies", () => {
  assert.deepEqual(lock.packages[""].dependencies, manifest.dependencies)
  assert.deepEqual(lock.packages[""].devDependencies, manifest.devDependencies)
})

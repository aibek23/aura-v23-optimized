import { createLocalId } from "@/lib/local-db/id"

/** The same logical operation must keep its UUID after a lost response. */
export type ClientOperationAttempt = {
  clientOpId: string
  fingerprint: string
}

export function resolveClientOperationId(id?: string): string {
  if (id === undefined) return createLocalId()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error("Некорректный идентификатор операции")
  }
  return id.toLowerCase()
}

export function getClientOperationAttempt(
  previous: ClientOperationAttempt | null,
  payload: unknown,
): ClientOperationAttempt {
  const fingerprint = JSON.stringify(payload)
  if (previous?.fingerprint === fingerprint) return previous
  return { clientOpId: resolveClientOperationId(), fingerprint }
}
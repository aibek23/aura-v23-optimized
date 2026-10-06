/**
 * Shared identity key for supplier records.
 *
 * Names are matched without regard to letter case; phone numbers remain part
 * of the identity so two suppliers with the same name but different phones
 * are not accidentally combined.
 */
export function supplierIdentityKey(name: string, phone: string | null): string {
  return `${name.trim().toLowerCase()}\u0000${phone?.trim() ?? ""}`
}

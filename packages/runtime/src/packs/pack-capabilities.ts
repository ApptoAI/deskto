import { packReceiptSchema, mySkillsPackName } from "@deskto/protocol"

import type { PackRow } from "../storage/records.js"

/** Only the app-created personal Pack is writable through the MVP editor. */
export function canEditManagedSkills(pack: PackRow): boolean {
  if (
    pack.kind !== "managed" ||
    pack.name !== mySkillsPackName ||
    !pack.receipt_json
  ) {
    return false
  }
  try {
    const receipt = packReceiptSchema.safeParse(JSON.parse(pack.receipt_json))
    return receipt.success && receipt.data.source.kind === "created"
  } catch {
    return false
  }
}

/** App-created managed Packs may receive template snapshots through Deskto. */
export function canEditManagedTemplates(pack: PackRow): boolean {
  if (pack.kind !== "managed" || !pack.receipt_json) return false
  try {
    const receipt = packReceiptSchema.safeParse(JSON.parse(pack.receipt_json))
    return receipt.success && receipt.data.source.kind === "created"
  } catch {
    return false
  }
}

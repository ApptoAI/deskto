import { createHash } from "node:crypto"

function identifier(prefix: string, parts: string[]): string {
  const digest = createHash("sha256")
    .update(parts.join("\0"))
    .digest("hex")
    .slice(0, 24)
  return `${prefix}-${digest}`
}

export function skillSourceId(parts: string[]): string {
  return identifier("source", parts)
}

export function skillOccurrenceId(
  sourceId: string,
  directoryName: string
): string {
  return identifier("skill", [sourceId, directoryName])
}

export function isSkillRecoveryFileName(name: string): boolean {
  return /^\.deskto-skill-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.recovery$/.test(
    name
  )
}

import type { HarnessDescriptor } from "@openappto/protocol"

import type { QueryState } from "../runtime/use-runtime-query.js"

export function isHarnessAvailable(harness: HarnessDescriptor): boolean {
  return harness.availability.status === "available"
}

export function harnessUnavailableReason(
  harness: HarnessDescriptor
): string | null {
  return harness.availability.status === "unavailable"
    ? harness.availability.reason
    : null
}

export function findHarness(
  harnesses: HarnessDescriptor[],
  harnessId: string
): HarnessDescriptor | null {
  return harnesses.find((harness) => harness.id === harnessId) ?? null
}

export function harnessLabel(
  harnesses: HarnessDescriptor[],
  harnessId: string
): string {
  return findHarness(harnesses, harnessId)?.name ?? harnessId
}

/**
 * Why the composer cannot send right now, or `undefined` when it can. Every
 * branch names the real cause instead of silently disabling the field.
 */
export function describeHarnessBlock(
  harnesses: QueryState<HarnessDescriptor[]>,
  harnessId: string | null
): string | undefined {
  if (harnesses.status === "loading" || harnesses.status === "idle") {
    return "Checking which agents are installed…"
  }
  if (harnesses.status === "error") {
    return `Appto cannot read the list of agents. ${harnesses.message}`
  }
  if (!harnessId) {
    return "No agent is available. Appto works with Claude Code and Codex installed on this computer."
  }

  const harness = findHarness(harnesses.data, harnessId)
  if (!harness)
    return `This task uses ${harnessId}, which this computer does not offer.`

  const reason = harnessUnavailableReason(harness)
  return reason ? `${harness.name} is not available. ${reason}` : undefined
}

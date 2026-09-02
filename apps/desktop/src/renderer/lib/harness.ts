import type { Harness } from "@deskto/protocol"

import type { QueryState } from "../runtime/use-runtime-query.js"

type HarnessHealth = {
  dotClassName: string
  detail: string
}

export function isHarnessAvailable(harness: Harness): boolean {
  return harness.enabled && harness.availability.status === "available"
}

export function harnessUnavailableReason(harness: Harness): string | null {
  if (!harness.enabled) return "Turned off in settings."
  return harness.availability.status === "unavailable"
    ? harness.availability.reason
    : null
}

/** Status dot and one-line detail shared by every place harness health shows. */
export function describeHarnessHealth(harness: Harness): HarnessHealth {
  if (!harness.enabled) {
    return {
      dotClassName: "bg-muted-foreground/40",
      detail: "Turned off in settings.",
    }
  }
  if (harness.availability.status === "available") {
    const version = harness.availability.version
    return {
      dotClassName: "bg-foreground",
      detail: version ? `Ready · version ${version}` : "Ready",
    }
  }
  return {
    dotClassName: "bg-destructive",
    detail: harness.availability.reason,
  }
}

export function findHarness(
  harnesses: Harness[],
  harnessId: string
): Harness | null {
  return harnesses.find((harness) => harness.id === harnessId) ?? null
}

export function harnessLabel(harnesses: Harness[], harnessId: string): string {
  return findHarness(harnesses, harnessId)?.name ?? knownHarnessLabel(harnessId)
}

export function knownHarnessLabel(harnessId: string): string {
  if (harnessId === "codex") return "Codex"
  if (harnessId === "claude") return "Claude Code"
  if (harnessId === "pi") return "Pi"
  return harnessId
}

/** The same names where a column has room for one word, not two. */
export function shortHarnessLabel(harnessId: string): string {
  return harnessId === "claude" ? "Claude" : knownHarnessLabel(harnessId)
}

/**
 * Why the composer cannot send right now, or `undefined` when it can. Every
 * branch names the real cause instead of silently disabling the field.
 */
export function describeHarnessBlock(
  harnesses: QueryState<Harness[]>,
  harnessId: string | null
): string | undefined {
  if (harnesses.status === "loading" || harnesses.status === "idle") {
    return "Checking which agents are installed…"
  }
  if (harnesses.status === "error") {
    return `Deskto cannot read the list of agents. ${harnesses.message}`
  }
  if (!harnessId) {
    return "No agent is available. Deskto works with Claude Code, Codex, or Pi installed on this computer."
  }

  const harness = findHarness(harnesses.data, harnessId)
  if (!harness)
    return `This task uses ${harnessId}, which this computer does not offer.`

  const reason = harnessUnavailableReason(harness)
  return reason ? `${harness.name} is not available. ${reason}` : undefined
}

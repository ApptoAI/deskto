/** Values below this (2020-01-01) are relative durations or zero, not epochs. */
const earliestPlausibleEpochMs = 1_577_836_800_000

/**
 * Converts a provider-reported epoch, in seconds or milliseconds, into an ISO
 * timestamp. Zero, negatives, and relative durations ("3600 seconds from
 * now") return undefined rather than a 1970 date the UI would present as a
 * real reset time.
 */
export function isoFromEpoch(value: number): string | undefined {
  if (!Number.isFinite(value) || value <= 0) return undefined
  const milliseconds = value > 10_000_000_000 ? value : value * 1000
  if (milliseconds < earliestPlausibleEpochMs) return undefined
  const date = new Date(milliseconds)
  return Number.isNaN(date.valueOf()) ? undefined : date.toISOString()
}

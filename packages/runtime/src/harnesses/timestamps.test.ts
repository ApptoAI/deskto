import { describe, expect, it } from "vitest"

import { isoFromEpoch } from "./timestamps.js"

describe("isoFromEpoch", () => {
  it("reads unix seconds and milliseconds", () => {
    expect(isoFromEpoch(1_754_000_000)).toBe(
      new Date(1_754_000_000 * 1000).toISOString()
    )
    expect(isoFromEpoch(1_754_000_000_000)).toBe(
      new Date(1_754_000_000_000).toISOString()
    )
  })

  it("rejects zero, negatives, and relative durations", () => {
    expect(isoFromEpoch(0)).toBeUndefined()
    expect(isoFromEpoch(-5)).toBeUndefined()
    // "3600 seconds from now" is a duration, not an epoch; without this
    // guard it would render as a reset time in January 1970.
    expect(isoFromEpoch(3600)).toBeUndefined()
    expect(isoFromEpoch(Number.NaN)).toBeUndefined()
  })
})

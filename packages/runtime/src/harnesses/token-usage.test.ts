import { describe, expect, it } from "vitest"

import { positiveTokens } from "./token-usage.js"

describe("positiveTokens", () => {
  it("keeps positive fractional readings positive after rounding", () => {
    expect(positiveTokens(0.1)).toBe(1)
    expect(positiveTokens(1.6)).toBe(2)
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, "1", null])(
    "rejects %s",
    (value) => {
      expect(positiveTokens(value)).toBeUndefined()
    }
  )
})

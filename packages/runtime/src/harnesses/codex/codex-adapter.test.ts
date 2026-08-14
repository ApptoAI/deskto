import { describe, expect, it } from "vitest"

import { codexLimitResetAt } from "./codex-adapter.js"

describe("codexLimitResetAt", () => {
  it("reads the app-server camel-case payload and chooses the most-used limit", () => {
    const primaryReset = 1_754_000_000
    const secondaryReset = 1_755_000_000

    expect(
      codexLimitResetAt({
        rateLimits: {
          primary: { usedPercent: 95, resetsAt: primaryReset },
          secondary: { usedPercent: 40, resetsAt: secondaryReset },
        },
      })
    ).toBe(new Date(primaryReset * 1000).toISOString())
  })

  it("reads snake-case transcript data with millisecond timestamps", () => {
    const reset = 1_754_000_000_000

    expect(
      codexLimitResetAt({
        primary: { used_percent: 100, resets_at: reset },
      })
    ).toBe(new Date(reset).toISOString())
  })

  it("ignores malformed rate-limit data", () => {
    expect(codexLimitResetAt({ rateLimits: { primary: {} } })).toBeUndefined()
    expect(codexLimitResetAt(null)).toBeUndefined()
  })
})

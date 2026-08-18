import { describe, expect, it } from "vitest"

import {
  progressSilenceLabel,
  progressStatusText,
} from "./working-indicator.js"

describe("progressSilenceLabel", () => {
  it("reports provider silence after ten seconds", () => {
    const since = "2026-08-18T10:00:00.000Z"
    const lastSignalAt = "2026-08-18T10:00:03.000Z"

    expect(progressSilenceLabel(12_900, since, lastSignalAt)).toBeUndefined()
    expect(progressSilenceLabel(13_000, since, lastSignalAt)).toBe("10s")
    expect(progressSilenceLabel(75_000, since, lastSignalAt)).toBe("1m 12s")
  })

  it("keeps the screen-reader silence announcement stable", () => {
    expect(progressStatusText("Thinking", false)).toBe("Thinking…")
    expect(progressStatusText("Thinking", true)).toBe(
      "Thinking… No recent update."
    )
  })
})

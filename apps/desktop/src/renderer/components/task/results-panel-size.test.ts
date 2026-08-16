import { describe, expect, it } from "vitest"

import {
  clampResultsPanelWidth,
  maximumResultsPanelWidth,
  maximumResultsPanelWidthForContainer,
  minimumResultsPanelWidth,
} from "./results-panel-size.js"

describe("clampResultsPanelWidth", () => {
  it("keeps the panel and conversation usable", () => {
    expect(clampResultsPanelWidth(100, 1_200)).toBe(minimumResultsPanelWidth)
    expect(clampResultsPanelWidth(620, 1_200)).toBe(620)
    expect(clampResultsPanelWidth(1_100, 900)).toBe(612)
    expect(clampResultsPanelWidth(2_000, 2_000)).toBe(maximumResultsPanelWidth)
  })

  it("reports the maximum width available in the current container", () => {
    expect(maximumResultsPanelWidthForContainer(900)).toBe(612)
    expect(maximumResultsPanelWidthForContainer(2_000)).toBe(
      maximumResultsPanelWidth
    )
    expect(maximumResultsPanelWidthForContainer(400)).toBe(
      minimumResultsPanelWidth
    )
  })
})

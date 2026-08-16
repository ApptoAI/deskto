import { describe, expect, it } from "vitest"

import {
  clampTaskPanelWidth,
  maximumTaskPanelWidth,
  maximumTaskPanelWidthForContainer,
  minimumConversationWidth,
  minimumTaskPanelWidth,
} from "./task-panel-size.js"

describe("clampTaskPanelWidth", () => {
  it("keeps the panel and conversation usable", () => {
    expect(clampTaskPanelWidth(100, 1_200)).toBe(minimumTaskPanelWidth)
    expect(clampTaskPanelWidth(620, 1_200)).toBe(620)
    expect(clampTaskPanelWidth(1_100, 900)).toBe(900 - minimumConversationWidth)
    expect(clampTaskPanelWidth(2_000, 2_000)).toBe(maximumTaskPanelWidth)
  })

  it("reports the maximum width available in the current container", () => {
    expect(maximumTaskPanelWidthForContainer(900)).toBe(
      900 - minimumConversationWidth
    )
    expect(maximumTaskPanelWidthForContainer(2_000)).toBe(maximumTaskPanelWidth)
    expect(maximumTaskPanelWidthForContainer(400)).toBe(minimumTaskPanelWidth)
  })
})

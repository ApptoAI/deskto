import { describe, expect, it } from "vitest"

import { activityDisplayName } from "./activity-rows.js"

describe("activityDisplayName", () => {
  it("hides provider MCP transport identifiers", () => {
    expect(
      activityDisplayName("select:mcp__deskto_browser__browser_select_element")
    ).toBe("browser select element")
    expect(activityDisplayName("mcp__linear__create_issue")).toBe(
      "create issue"
    )
  })

  it("keeps human-readable activity names unchanged", () => {
    expect(activityDisplayName("Search files")).toBe("Search files")
  })
})

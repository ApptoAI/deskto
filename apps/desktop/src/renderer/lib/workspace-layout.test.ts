import { describe, expect, it } from "vitest"

import { parseRememberedWorkspaceLayout } from "./workspace-layout.js"

describe("parseRememberedWorkspaceLayout", () => {
  it("keeps supported layouts", () => {
    expect(parseRememberedWorkspaceLayout("workspace")).toBe("workspace")
    expect(parseRememberedWorkspaceLayout("slack")).toBe("slack")
  })

  it("uses the default for missing or outdated values", () => {
    expect(parseRememberedWorkspaceLayout("columns")).toBe("workspace")
    expect(parseRememberedWorkspaceLayout(null)).toBe("workspace")
  })
})

import { describe, expect, it } from "vitest"

import {
  browserProfilePartition,
  hasBrowserProfileData,
  isBrowserProfilePartition,
  workspaceIdFromBrowserProfilePartition,
} from "./browser-profile.js"

describe("browser profile partitions", () => {
  it("names one persistent partition per Workspace", () => {
    expect(browserProfilePartition("personal")).toBe(
      "persist:workspace-personal"
    )
    expect(browserProfilePartition("ws-1")).not.toBe(
      browserProfilePartition("ws-2")
    )
  })

  it("recognises its own partitions and recovers the Workspace id", () => {
    expect(isBrowserProfilePartition("persist:workspace-personal")).toBe(true)
    expect(isBrowserProfilePartition("persist:workspace-")).toBe(false)
    expect(isBrowserProfilePartition("persist:deskto-browser")).toBe(false)
    expect(
      workspaceIdFromBrowserProfilePartition(browserProfilePartition("abc"))
    ).toBe("abc")
    expect(
      workspaceIdFromBrowserProfilePartition("persist:deskto-browser")
    ).toBeUndefined()
  })

  it("treats an empty profile as having nothing to clear", () => {
    const profile = {
      workspaceId: "personal",
      workspaceName: "Personal",
      sizeBytes: 0,
      lastUsedAt: null,
    }
    expect(hasBrowserProfileData(profile)).toBe(false)
    expect(hasBrowserProfileData({ ...profile, sizeBytes: 12 })).toBe(true)
  })
})

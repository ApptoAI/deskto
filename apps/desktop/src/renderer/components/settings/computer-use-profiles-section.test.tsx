import { describe, expect, it } from "vitest"

import { formatBytes } from "./computer-use-profiles-section.js"
import { computerUseSections } from "./computer-use-sections.js"

describe("Browser profiles section", () => {
  it("sits on the Computer use page after the browser block", () => {
    expect(computerUseSections.map((section) => section.id)).toEqual([
      "browser",
      "profiles",
    ])
  })

  it("formats profile sizes in the nearest unit", () => {
    expect(formatBytes(0)).toBe("0 B")
    expect(formatBytes(512)).toBe("512 B")
    expect(formatBytes(1536)).toBe("1.5 KB")
    expect(formatBytes(120 * 1024 * 1024)).toBe("120 MB")
  })
})

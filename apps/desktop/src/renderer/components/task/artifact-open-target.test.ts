import { describe, expect, it } from "vitest"

import { defaultArtifactOpenSurface } from "./artifact-open-target.js"

describe("default Artifact open surface", () => {
  it.each(["html", "pdf"] as const)("opens %s in Browser", (kind) => {
    expect(defaultArtifactOpenSurface(kind)).toBe("browser")
  })

  it.each([
    "text",
    "markdown",
    "csv",
    "image",
    "spreadsheet",
    "document",
    "unsupported",
  ] as const)("keeps %s in Files", (kind) => {
    expect(defaultArtifactOpenSurface(kind)).toBe("files")
  })
})

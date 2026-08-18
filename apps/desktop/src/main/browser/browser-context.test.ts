import { describe, expect, it } from "vitest"

import {
  sanitizeBrowserContextTitle,
  sanitizeBrowserContextUrl,
} from "./browser-context.js"

describe("Browser Element Context metadata", () => {
  it("removes URL fields commonly used for credentials and private state", () => {
    expect(
      sanitizeBrowserContextUrl(
        "https://person:secret@example.com/settings?token=private#account"
      )
    ).toBe("https://example.com/settings")
  })

  it("rejects non-web URLs and titles that resemble private data", () => {
    expect(sanitizeBrowserContextUrl("file:///tmp/private")).toBe("")
    expect(sanitizeBrowserContextTitle("person@example.com settings")).toBe("")
    expect(sanitizeBrowserContextTitle("  Public\nsettings  ")).toBe(
      "Public settings"
    )
  })

  it("keeps the private Artifact URL available to element context", () => {
    const url =
      "deskto-artifact://preview/thread-1/artifact-1/dashboard.html?token=private#section"

    expect(sanitizeBrowserContextUrl(url)).toBe(
      "deskto-artifact://preview/thread-1/artifact-1/dashboard.html"
    )
  })
})

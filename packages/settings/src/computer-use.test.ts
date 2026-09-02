import { describe, expect, it } from "vitest"

import {
  browserHostAllowed,
  browserHostRuleSchema,
  computerUseSettings,
  isBrowserDownloadFolder,
  isBrowserHomeUrl,
  parseBrowserHostRules,
} from "./computer-use.js"
import { resolveSettings } from "./resolve.js"

describe("browser host rules", () => {
  it("accepts hosts and wildcard subdomains only", () => {
    expect(browserHostRuleSchema.safeParse("example.com").success).toBe(true)
    expect(browserHostRuleSchema.safeParse("*.example.com").success).toBe(true)
    expect(browserHostRuleSchema.safeParse("localhost").success).toBe(true)
    expect(browserHostRuleSchema.safeParse("https://example.com").success).toBe(
      false
    )
    expect(browserHostRuleSchema.safeParse("example.com/path").success).toBe(
      false
    )
    expect(browserHostRuleSchema.safeParse("").success).toBe(false)
  })

  it("lets deny win and treats an empty allow list as open", () => {
    expect(browserHostAllowed("example.com", { allow: [], deny: [] })).toBe(
      true
    )
    expect(
      browserHostAllowed("example.com", { allow: [], deny: ["example.com"] })
    ).toBe(false)
    expect(
      browserHostAllowed("app.example.com", {
        allow: ["*.example.com"],
        deny: [],
      })
    ).toBe(true)
    expect(
      browserHostAllowed("example.com", { allow: ["*.example.com"], deny: [] })
    ).toBe(true)
    expect(
      browserHostAllowed("other.com", { allow: ["example.com"], deny: [] })
    ).toBe(false)
    expect(
      browserHostAllowed("app.example.com", {
        allow: ["*.example.com"],
        deny: ["app.example.com"],
      })
    ).toBe(false)
    expect(
      browserHostAllowed("notexample.com", {
        allow: [],
        deny: ["*.example.com"],
      })
    ).toBe(true)
    expect(
      browserHostAllowed("EXAMPLE.com.", { allow: [], deny: ["example.com"] })
    ).toBe(false)
  })

  it("parses one rule per line and ignores blanks", () => {
    expect(parseBrowserHostRules(" a.com \n\n*.b.com\r\n")).toEqual([
      "a.com",
      "*.b.com",
    ])
  })
})

describe("browser download folder", () => {
  it("stays inside the project", () => {
    expect(isBrowserDownloadFolder("")).toBe(true)
    expect(isBrowserDownloadFolder("downloads")).toBe(true)
    expect(isBrowserDownloadFolder("files/web")).toBe(true)
    expect(isBrowserDownloadFolder("../outside")).toBe(false)
    expect(isBrowserDownloadFolder("a/../b")).toBe(false)
    expect(isBrowserDownloadFolder("/tmp")).toBe(false)
    expect(isBrowserDownloadFolder("C:\\tmp")).toBe(false)
    expect(isBrowserDownloadFolder("a//b")).toBe(false)
  })
})

describe("browser home URL", () => {
  it("accepts empty or a web address", () => {
    expect(isBrowserHomeUrl("")).toBe(true)
    expect(isBrowserHomeUrl("https://example.com")).toBe(true)
    expect(isBrowserHomeUrl("http://localhost:3000")).toBe(true)
    expect(isBrowserHomeUrl("example.com")).toBe(false)
    expect(isBrowserHomeUrl("file:///etc/passwd")).toBe(false)
  })
})

describe("computer use settings", () => {
  it("live under the computerUse namespace and resolve with defaults", () => {
    for (const definition of Object.values(computerUseSettings)) {
      expect(definition.key.startsWith("computerUse.")).toBe(true)
    }
    const snapshot = resolveSettings({
      "computerUse.browser.viewport": { width: 100, height: 100 },
      "computerUse.browser.blocked-hosts": ["*.example.com"],
    })
    expect(snapshot.values["computerUse.browser.viewport"]).toEqual({
      width: 1280,
      height: 800,
    })
    expect(snapshot.values["computerUse.browser.blocked-hosts"]).toEqual([
      "*.example.com",
    ])
  })
})

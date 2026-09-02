import { describe, expect, it } from "vitest"

import {
  isBrowserHostPermitted,
  isBrowserWebUrl,
  normalizeBrowserUrl,
} from "./browser-url.js"

describe("browser host permission", () => {
  it("applies the person's host rules to web pages only", () => {
    const rules = { allow: ["*.example.com"], deny: ["ads.example.com"] }
    expect(isBrowserHostPermitted("https://app.example.com/x", rules)).toBe(
      true
    )
    expect(isBrowserHostPermitted("https://ads.example.com/", rules)).toBe(
      false
    )
    expect(isBrowserHostPermitted("https://other.com/", rules)).toBe(false)
    expect(isBrowserHostPermitted("about:blank", rules)).toBe(true)
    expect(
      isBrowserHostPermitted("deskto-artifact://thread/artifact", rules)
    ).toBe(true)
    expect(isBrowserHostPermitted("not a url", rules)).toBe(false)
  })

  it("permits everything when no rules are set", () => {
    expect(
      isBrowserHostPermitted("https://example.com", { allow: [], deny: [] })
    ).toBe(true)
  })

  it("rechecks an existing history target after host rules change", () => {
    const target = "https://signed-in.example/account"
    expect(isBrowserHostPermitted(target, { allow: [], deny: [] })).toBe(true)
    expect(
      isBrowserHostPermitted(target, {
        allow: [],
        deny: ["signed-in.example"],
      })
    ).toBe(false)
  })
})

describe("browser URL policy", () => {
  it("opens domains with HTTPS and local servers with HTTP", () => {
    expect(normalizeBrowserUrl("example.com")).toBe("https://example.com/")
    expect(normalizeBrowserUrl("localhost:3000/app")).toBe(
      "http://localhost:3000/app"
    )
    expect(normalizeBrowserUrl("example.com:8080/app")).toBe(
      "https://example.com:8080/app"
    )
    expect(normalizeBrowserUrl("192.168.1.5:8080/app")).toBe(
      "https://192.168.1.5:8080/app"
    )
  })

  it("turns text into a search without allowing active URL schemes", () => {
    expect(normalizeBrowserUrl("deskto browser tools")).toBe(
      "https://www.google.com/search?q=deskto%20browser%20tools"
    )
    expect(() => normalizeBrowserUrl("javascript:alert(1)")).toThrow(
      "Only HTTP and HTTPS"
    )
    expect(() => normalizeBrowserUrl("file:///etc/passwd")).toThrow(
      "Only HTTP and HTTPS"
    )
  })

  it("allows only web navigation and the internal blank page", () => {
    expect(isBrowserWebUrl("about:blank")).toBe(true)
    expect(isBrowserWebUrl("https://example.com")).toBe(true)
    expect(isBrowserWebUrl("data:text/html,hello")).toBe(false)
  })

  it("rejects URLs above the navigation limit", () => {
    expect(() =>
      normalizeBrowserUrl(`https://example.com/${"a".repeat(8_200)}`)
    ).toThrow("too long")
  })
})

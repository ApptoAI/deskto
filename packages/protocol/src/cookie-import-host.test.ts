import { describe, expect, it } from "vitest"

import {
  cookieImportHostSchema,
  isCookieImportHost,
  normalizeCookieImportHost,
} from "./cookie-import-host.js"

describe("cookie import hosts", () => {
  it("accepts registrable domains and hosts below them", () => {
    for (const host of [
      "example.com",
      "app.example.com",
      "example.co.uk",
      "login.example.co.uk",
      "www.example.com",
      "my-site.github.io",
      "foo.github.io",
      "example.id.au",
      "school.qld.edu.au",
      "example.uk.com",
      "Example.COM",
      " .example.com ",
      "xn--bcher-kva.example",
    ]) {
      expect(isCookieImportHost(host), host).toBe(true)
    }
  })

  it("rejects public suffixes", () => {
    for (const host of [
      "com",
      ".com",
      "uk",
      "co.uk",
      "uk.com",
      "id.au",
      "qld.edu.au",
      "github.io",
      "herokuapp.com",
      "s3.amazonaws.com",
      "localhost",
    ]) {
      expect(isCookieImportHost(host), host).toBe(false)
    }
  })

  it("rejects anything that is not a bare hostname", () => {
    for (const host of [
      "",
      "   ",
      "https://example.com",
      "user:pass@example.com",
      "example.com:8443",
      "example.com/login",
      "*.example.com",
      "-example.com",
      "exa mple.com",
      "example..com",
      "127.0.0.1",
      "[::1]",
      `${"a".repeat(64)}.com`,
      `${"a.".repeat(130)}com`,
    ]) {
      expect(isCookieImportHost(host), host).toBe(false)
    }
  })

  it("rejects a trailing dot: browsers store the host without one", () => {
    expect(isCookieImportHost("example.com.")).toBe(false)
    expect(isCookieImportHost(".example.com.")).toBe(false)
  })

  it("rejects Unicode labels: Surfaces hand over the punycode form", () => {
    // The rule is the shape browsers store, which is ASCII. A Surface that
    // accepts typed input reduces it through the URL parser first, and that
    // is what turns "bücher.example" into "xn--bcher-kva.example".
    expect(isCookieImportHost("bücher.example")).toBe(false)
    expect(isCookieImportHost(new URL("https://bücher.example").hostname)).toBe(
      true
    )
  })

  it("normalizes the way browsers store host keys", () => {
    expect(normalizeCookieImportHost(" .App.Example.com ")).toBe(
      "app.example.com"
    )
  })

  it("exposes the same rule as a schema", () => {
    expect(cookieImportHostSchema.safeParse("example.com").success).toBe(true)
    expect(cookieImportHostSchema.safeParse("co.uk").success).toBe(false)
  })
})

import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { SettingsSidebar } from "./settings-sidebar.js"
import { computerUseSections } from "./computer-use-sections.js"
import {
  CookieImportSection,
  parseHosts,
} from "./computer-use-cookie-section.js"

describe("Computer use settings", () => {
  it("lists the page in the settings sidebar", () => {
    const html = renderToStaticMarkup(
      createElement(SettingsSidebar, {
        page: "computer-use",
        workspaceLayout: "workspace",
        onSelectPage: vi.fn(),
        onGoBack: vi.fn(),
      })
    )
    expect(html).toContain("Computer use")
    expect(html).toContain('aria-current="page"')
  })

  it("starts with the built-in browser section and keeps ids unique", () => {
    expect(computerUseSections[0]?.id).toBe("browser")
    const ids = computerUseSections.map((section) => section.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("offers a cookie import section that renders while it discovers", () => {
    expect(
      computerUseSections.some((section) => section.id === "cookie-import")
    ).toBe(true)
    const html = renderToStaticMarkup(createElement(CookieImportSection))
    expect(html).toContain("Import cookies")
    expect(html).toContain("Websites")
  })

  it("extracts and validates hostnames from website input", () => {
    expect(
      parseHosts(
        "https://example.com:8443/login, user:pass@secure.example.com/path?next=1 invalid_host https://www.example.com?q=1"
      )
    ).toEqual(["example.com", "secure.example.com"])
  })
})

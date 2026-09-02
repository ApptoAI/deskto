import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { SettingsSidebar } from "./settings-sidebar.js"
import { computerUseSections } from "./computer-use-sections.js"

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
})

import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { SettingsSidebar } from "./settings-sidebar.js"

describe("SettingsSidebar", () => {
  it.each([
    ["workspace", "w-[236px]"],
    ["slack", "w-[308px]"],
  ] as const)("uses the %s layout width", (workspaceLayout, widthClass) => {
    const html = renderToStaticMarkup(
      createElement(SettingsSidebar, {
        page: "appearance",
        workspaceLayout,
        onSelectPage: vi.fn(),
        onGoBack: vi.fn(),
      })
    )

    expect(html).toContain(widthClass)
    expect(html).toContain("Close settings")
    expect(html).not.toContain(">Go back<")
  })
})

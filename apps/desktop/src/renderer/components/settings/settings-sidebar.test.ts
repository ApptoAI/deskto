import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { SettingsSidebar } from "./settings-sidebar.js"

describe("SettingsSidebar", () => {
  it.each([
    ["workspace", "w-72 xl:w-80"],
    ["slack", "w-82"],
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
  })
})

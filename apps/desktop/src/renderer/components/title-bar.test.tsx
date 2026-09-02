// @vitest-environment jsdom

import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { WindowNav } from "./title-bar.js"

Object.assign(window, { deskto: { platform: "linux" } })

function renderNav(overrides: Partial<Parameters<typeof WindowNav>[0]>) {
  return renderToStaticMarkup(
    createElement(WindowNav, {
      sidebarOpen: true,
      canToggleSidebar: true,
      onToggleSidebar: vi.fn(),
      canGoBack: false,
      canGoForward: false,
      onBack: vi.fn(),
      onForward: vi.fn(),
      canNewTask: true,
      onNewTask: vi.fn(),
      ...overrides,
    })
  )
}

function buttonLabelled(html: string, label: string): string {
  const buttons = html.match(/<button[^>]*>/g) ?? []
  const button = buttons.find((entry) =>
    entry.includes(`aria-label="${label}"`)
  )
  if (!button) throw new Error(`No button labelled ${label}`)
  return button
}

describe("WindowNav", () => {
  it("marks the sidebar toggle so focus can follow it between the column and the pane header", () => {
    const html = renderNav({})
    expect(buttonLabelled(html, "Hide the task list")).toContain(
      "data-sidebar-toggle"
    )
    expect(buttonLabelled(html, "Hide the task list")).not.toContain(
      'disabled=""'
    )
  })

  it("disables the toggle and New task while their commands stand down", () => {
    const html = renderNav({ canToggleSidebar: false, canNewTask: false })
    expect(buttonLabelled(html, "Hide the task list")).toContain('disabled=""')
    expect(buttonLabelled(html, "New task")).toContain('disabled=""')
  })
})

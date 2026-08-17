import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { WorkspaceRail } from "./workspace-rail.js"

describe("WorkspaceRail", () => {
  it("exposes every workspace and marks the active one", () => {
    const html = renderToStaticMarkup(
      createElement(WorkspaceRail, {
        workspaces: [
          {
            id: "personal",
            name: "Personal",
            color: "violet",
            icon: "home",
            sortOrder: 0,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
          {
            id: "studio",
            name: "Studio",
            color: "blue",
            icon: "briefcase",
            sortOrder: 1,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        activeWorkspaceId: "studio",
        onSelect: vi.fn(),
        onCreate: vi.fn(),
      })
    )

    expect(html).toContain('aria-label="Workspaces"')
    expect(html).toContain('aria-label="Personal"')
    expect(html).toContain('aria-label="Studio" aria-current="page"')
    expect(html).toContain('aria-label="New workspace"')
  })
})

// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import type { Project } from "@deskto/protocol"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SaveTemplateDialog } from "./save-template-dialog.js"

afterEach(cleanup)

describe("SaveTemplateDialog", () => {
  it("reports a failed file scan and prevents an incomplete template save", () => {
    render(
      <SaveTemplateDialog
        open
        onOpenChange={vi.fn()}
        project={project()}
        files={[]}
        loading={false}
        loadError="Project files could not be scanned."
        actionError={null}
        onRetry={vi.fn()}
        onSubmit={vi.fn()}
      />
    )

    expect(screen.getByRole("alert").textContent).toContain(
      "Project files could not be scanned."
    )
    expect(
      screen
        .getByRole("button", { name: "Save template" })
        .hasAttribute("disabled")
    ).toBe(true)
  })
})

function project(): Project {
  return {
    id: "project-1",
    workspaceId: "personal",
    name: "Client North",
    path: "/projects/project-1",
    locationKind: "managed",
    pinnedAt: null,
    createdAt: "2026-08-19T10:00:00.000Z",
    updatedAt: "2026-08-19T10:00:00.000Z",
  }
}

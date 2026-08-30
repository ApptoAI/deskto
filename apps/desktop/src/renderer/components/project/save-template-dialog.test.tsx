// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { projectNameMaxLength, type Project } from "@deskto/protocol"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SaveTemplateDialog } from "./save-template-dialog.js"

afterEach(cleanup)

describe("SaveTemplateDialog", () => {
  it("reports a failed file scan and prevents an incomplete template save", () => {
    render(
      <SaveTemplateDialog
        open
        onOpenChange={vi.fn()}
        onOpenChangeComplete={vi.fn()}
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

  it("submits every file after selecting all", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(
      <SaveTemplateDialog
        open
        onOpenChange={vi.fn()}
        onOpenChangeComplete={vi.fn()}
        project={project()}
        files={[
          { path: "README.md", sizeBytes: 8 },
          { path: "src/index.ts", sizeBytes: 20 },
        ]}
        loading={false}
        loadError={null}
        actionError={null}
        onRetry={vi.fn()}
        onSubmit={onSubmit}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: "Select all" }))
    fireEvent.click(screen.getByRole("button", { name: "Save template" }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        name: "Client North template",
        description: "",
        includeInstructions: true,
        paths: ["README.md", "src/index.ts"],
      })
    )
  })

  it("keeps the suggested name within the Runtime limit", () => {
    render(
      <SaveTemplateDialog
        open
        onOpenChange={vi.fn()}
        onOpenChangeComplete={vi.fn()}
        project={project("x".repeat(projectNameMaxLength))}
        files={[]}
        loading={false}
        loadError={null}
        actionError={null}
        onRetry={vi.fn()}
        onSubmit={vi.fn()}
      />
    )

    const input = screen.getByLabelText<HTMLInputElement>("Name")
    expect(input.value).toHaveLength(projectNameMaxLength)
  })
})

function project(name = "Client North"): Project {
  return {
    id: "project-1",
    workspaceId: "personal",
    name,
    description: "",
    path: "/projects/project-1",
    locationKind: "managed",
    pinnedAt: null,
    createdAt: "2026-08-19T10:00:00.000Z",
    updatedAt: "2026-08-19T10:00:00.000Z",
  }
}

// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { ProjectTemplate } from "@deskto/protocol"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ProjectDialog } from "./project-dialog.js"

afterEach(cleanup)

describe("ProjectDialog", () => {
  it("omits the template picker after successfully loading no templates", () => {
    renderDialog([])

    fireEvent.click(screen.getByRole("button", { name: "Advanced" }))

    expect(screen.queryByText("Template")).toBeNull()
    expect(screen.queryByText("Blank project")).toBeNull()
    expect(
      screen.getByRole("radiogroup", { name: "Project location" })
    ).toBeTruthy()
  })

  it("offers Blank project when real templates are available", () => {
    renderDialog([
      {
        id: "brief",
        packId: "pack-1",
        packName: "Sales",
        directoryName: "brief",
        name: "Client brief",
        description: "Start from a client brief.",
      },
    ])

    fireEvent.click(screen.getByRole("button", { name: "Advanced" }))

    expect(screen.getByText("Template")).toBeTruthy()
    expect(screen.getByText("Blank project")).toBeTruthy()
  })
})

function renderDialog(templates: ProjectTemplate[]) {
  render(
    <ProjectDialog
      open
      onOpenChange={vi.fn()}
      templates={templates}
      templatesLoading={false}
      loadError={null}
      actionError={null}
      onRetry={vi.fn()}
      onChooseFolder={vi.fn().mockResolvedValue(undefined)}
      onSubmit={vi.fn().mockResolvedValue(undefined)}
    />
  )
}

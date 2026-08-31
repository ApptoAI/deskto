// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
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

  it("does not submit a template removed by a refresh", async () => {
    const template = {
      id: "brief",
      packId: "pack-1",
      packName: "Sales",
      directoryName: "brief",
      name: "Client brief",
      description: "Start from a client brief.",
    }
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const { rerender } = render(projectDialog([template], onSubmit))

    fireEvent.change(screen.getByLabelText("What are you working on?"), {
      target: { value: "Renewal" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Advanced" }))
    fireEvent.click(screen.getByRole("button", { name: "Template" }))
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Client brief/ }))

    rerender(projectDialog([], onSubmit))
    fireEvent.click(screen.getByRole("button", { name: "Create project" }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty("templateId")
  })
})

function renderDialog(templates: ProjectTemplate[]) {
  render(projectDialog(templates, vi.fn().mockResolvedValue(undefined)))
}

function projectDialog(
  templates: ProjectTemplate[],
  onSubmit: (draft: Parameters<ProjectDialogProps["onSubmit"]>[0]) => Promise<void>
) {
  return (
    <ProjectDialog
      open
      onOpenChange={vi.fn()}
      templates={templates}
      templatesLoading={false}
      loadError={null}
      actionError={null}
      onRetry={vi.fn()}
      onChooseFolder={vi.fn().mockResolvedValue(undefined)}
      onSubmit={onSubmit}
    />
  )
}

type ProjectDialogProps = Parameters<typeof ProjectDialog>[0]

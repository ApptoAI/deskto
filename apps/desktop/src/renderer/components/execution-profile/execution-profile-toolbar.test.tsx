// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { Harness } from "@deskto/protocol"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ExecutionProfileToolbar } from "./execution-profile-toolbar.js"

afterEach(cleanup)

describe("ExecutionProfileToolbar", () => {
  it("uses a compact automatic-effort treatment without endpoint descriptions", () => {
    const { container } = renderToolbar(
      model("opus", ["low", "medium", "high", "max"])
    )

    fireEvent.click(screen.getByRole("button", { name: "Thinking: Default" }))

    expect(screen.getByText("Model decides.")).toBeTruthy()
    expect(screen.queryByText(/quick pass/i)).toBeNull()
    expect(screen.queryByText(/most reasoning/i)).toBeNull()
    expect(container.querySelector("[data-automatic-thinking]")).toBeTruthy()
    expect(container.querySelector(".lucide-sparkles")).toBeNull()
  })

  it("reserves the Thinking slot when the selected model does not support it", () => {
    const { container, rerender } = renderToolbar(model("opus", ["low"]))
    const supportedSlot = container.querySelector(
      '[data-slot="thinking-profile"]'
    )

    rerender(toolbar(model("haiku", [])))

    const unsupportedSlot = container.querySelector(
      '[data-slot="thinking-profile"]'
    )
    expect(unsupportedSlot?.className).toBe(supportedSlot?.className)
    expect(unsupportedSlot?.querySelector("button")).toBeNull()
  })
})

function renderToolbar(selectedModel: Harness["models"][number]) {
  return render(toolbar(selectedModel))
}

function toolbar(selectedModel: Harness["models"][number]) {
  const models = [model("opus", ["low"]), model("haiku", [])]
  return (
    <ExecutionProfileToolbar
      models={models}
      profile={{
        modelId: selectedModel.id,
        effort: null,
        permissionMode: "approval-required",
      }}
      onChange={vi.fn()}
    />
  )
}

function model(
  id: string,
  supportedEfforts: string[]
): Harness["models"][number] {
  const harnessModel: Harness["models"][number] = {
    id,
    name: id,
    supportedEfforts,
    isDefault: id === "opus",
    supportedPermissionModes: ["approval-required"],
  }
  if (supportedEfforts[0]) harnessModel.defaultEffort = supportedEfforts[0]
  return harnessModel
}

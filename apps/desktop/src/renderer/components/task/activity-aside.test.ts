// @vitest-environment jsdom

import { createElement } from "react"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { Activity } from "@deskto/protocol"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ActivityAside } from "./activity-aside.js"

afterEach(cleanup)

describe("ActivityAside", () => {
  it("opens the overview from its header and the selected preview from its agent row", () => {
    const onOpen = vi.fn()
    const onOpenAgent = vi.fn()
    const agent: Activity = {
      id: "agent-1",
      threadId: "thread-1",
      turnId: "turn-1",
      name: "Research agent",
      status: "completed",
      payload: { kind: "subagent" },
      createdAt: "2026-08-16T10:00:00.000Z",
      finishedAt: "2026-08-16T10:00:03.000Z",
    }

    render(
      createElement(ActivityAside, {
        activities: [agent],
        onOpen,
        onOpenAgent,
      })
    )

    fireEvent.click(screen.getByRole("button", { name: "Open activity panel" }))
    fireEvent.click(
      screen.getByRole("button", {
        name: "Open activity for Research agent",
      })
    )
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpenAgent).toHaveBeenCalledWith("agent-1")
  })
})

// @vitest-environment jsdom

import { useState } from "react"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { Activity } from "@deskto/protocol"
import { afterEach, describe, expect, it } from "vitest"

import { ActivityAside } from "./activity-aside.js"
import { ActivityPanel } from "./activity-panel.js"
import { summarizeActivities } from "./activity-tree.js"

const agent: Activity = {
  id: "agent",
  threadId: "thread",
  turnId: "turn",
  name: "Research agent",
  status: "running",
  payload: { kind: "subagent" },
  detail: "Compare the available approaches.",
  createdAt: "2026-09-05T10:00:00.000Z",
}

function Panel({
  activities,
  compact = false,
}: {
  activities: Activity[]
  compact?: boolean
}) {
  const [open, setOpen] = useState(!compact)
  const [selectedAgentId, select] = useState<string>()
  if (!open)
    return (
      <ActivityAside
        activities={activities}
        onOpen={() => setOpen(true)}
        onOpenAgent={(id) => {
          select(id)
          setOpen(true)
        }}
      />
    )
  return (
    <ActivityPanel
      summary={summarizeActivities(activities)}
      selectedAgentId={selectedAgentId}
      onSelectAgent={select}
      onBack={() => select(undefined)}
      childThreads={[]}
      onOpenThread={() => undefined}
      onOpenFiles={() => undefined}
    />
  )
}

afterEach(cleanup)

describe("agent preview", () => {
  it.each([false, true])(
    "moves focus into preview and restores the agent row (compact: %s)",
    (compact) => {
      render(<Panel activities={[agent]} compact={compact} />)
      const entry = screen.getByRole("button", {
        name: compact
          ? "Open activity for Research agent"
          : "Preview Research agent",
      })
      entry.focus()
      fireEvent.click(entry, { detail: 0 })
      const back = screen.getByRole("button", { name: "Back to activities" })
      expect(document.activeElement).toBe(back)
      fireEvent.click(back, { detail: 0 })
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Preview Research agent" })
      )
    }
  )

  it("restores focus to the outer agent after leaving a nested preview", () => {
    render(
      <Panel
        activities={[
          agent,
          {
            ...agent,
            id: "nested",
            name: "Check sources",
            parentActivityId: agent.id,
          },
        ]}
      />
    )
    fireEvent.click(
      screen.getByRole("button", { name: "Preview Research agent" })
    )
    const nested = screen.getByRole("button", { name: "Preview Check sources" })
    nested.focus()
    fireEvent.click(nested, { detail: 0 })
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Back to activities" })
    )
    fireEvent.click(
      screen.getByRole("button", { name: "Back to activities" }),
      { detail: 0 }
    )
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Preview Research agent" })
    )
  })

  it("opens read-only work, stays current, and returns to the list", () => {
    const view = render(<Panel activities={[agent]} />)
    fireEvent.click(
      screen.getByRole("button", { name: "Preview Research agent" })
    )
    expect(screen.getByRole("region", { name: "Agent preview" })).toBeTruthy()
    expect(screen.getByText("Read only")).toBeTruthy()
    expect(screen.queryByRole("textbox")).toBeNull()
    expect(
      screen.getByText("Waiting for this agent to share its work.")
    ).toBeTruthy()

    view.rerender(
      <Panel
        activities={[
          {
            ...agent,
            status: "completed",
            finishedAt: "2026-09-05T10:00:03.000Z",
          },
          {
            ...agent,
            id: "tool",
            name: "Search sources",
            detail: "Found three approaches",
            status: "completed",
            parentActivityId: agent.id,
            payload: { kind: "tool", tool: "search" },
          },
        ]}
      />
    )
    expect(screen.getByRole("status").textContent).toBe("Finished")
    expect(screen.getByText("Search sources")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Back to activities" }))
    expect(screen.queryByRole("region", { name: "Agent preview" })).toBeNull()
    expect(
      screen.getByRole("button", { name: "Preview Research agent" })
    ).toBeTruthy()
  })

  it("opens nested agents and recovers when the selected activity disappears", () => {
    const nested = {
      ...agent,
      id: "nested",
      name: "Check sources",
      parentActivityId: agent.id,
    }
    const view = render(<Panel activities={[agent, nested]} />)
    fireEvent.click(
      screen.getByRole("button", { name: "Preview Research agent" })
    )
    fireEvent.click(
      screen.getByRole("button", { name: "Preview Check sources" })
    )
    expect(screen.getByRole("heading", { name: "Check sources" })).toBeTruthy()
    view.rerender(<Panel activities={[agent]} />)
    expect(screen.queryByRole("region", { name: "Agent preview" })).toBeNull()
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Preview Research agent" })
    )
  })
})

// @vitest-environment jsdom

import { createElement } from "react"
import type { Thread } from "@deskto/protocol"
import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { TaskList, type InboxActions } from "./task-list.js"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

const now = "2026-08-17T10:00:00.000Z"

const doneThread: Thread = {
  id: "t1",
  projectId: "project-1",
  parentThreadId: null,
  title: "Finished task",
  harnessId: "codex",
  status: "idle",
  executionProfile: {
    modelId: "gpt-5",
    effort: "high",
    permissionMode: "auto",
  },
  lastUserMessageAt: now,
  lastTurnCompletedAt: now,
  failedAt: null,
  lastVisitedAt: now,
  pinnedAt: null,
  snoozedUntil: null,
  snoozedAt: null,
  doneOverride: "done",
  doneAt: now,
  createdAt: now,
  updatedAt: now,
}

const actions: InboxActions = {
  onSetDone: vi.fn(),
  onSnooze: vi.fn(),
  onWake: vi.fn(),
  onSetPinned: vi.fn(),
  onDelete: vi.fn(),
}

describe("TaskList", () => {
  it("gives the row id to the ghost row, not the copy hidden in a collapsed shelf", () => {
    const { container } = render(
      createElement(TaskList, {
        state: { status: "ready", data: [doneThread] },
        openThreadId: doneThread.id,
        onOpenThread: vi.fn(),
        onRetry: vi.fn(),
        actions,
      })
    )

    // The Done shelf is collapsed by default, so the open task renders twice:
    // once inert behind the shelf, once as the visible ghost row.
    const copies = container.querySelectorAll('[aria-current="true"]')
    expect(copies).toHaveLength(2)

    const withId = container.querySelectorAll("#task-row-t1")
    expect(withId).toHaveLength(1)
    expect(withId[0]?.closest("[inert]")).toBeNull()
  })
})

import { describe, expect, it } from "vitest"
import type { Thread } from "@deskto/protocol"

import {
  matchesTaskFilter,
  taskTableCounts,
  taskTableRows,
  taskUpdatedAt,
  type TaskTableOptions,
} from "./task-table.js"

const now = "2026-08-30T12:00:00.000Z"
const options: TaskTableOptions = { now, autoDoneAfterDays: 3 }

function thread(overrides: Partial<Thread> & { id: string }): Thread {
  return {
    projectId: "project-1",
    parentThreadId: null,
    title: overrides.id,
    harnessId: "claude",
    status: "idle",
    executionProfile: {
      modelId: "default",
      effort: null,
      permissionMode: "approval-required",
    },
    lastUserMessageAt: null,
    lastTurnCompletedAt: null,
    failedAt: null,
    lastVisitedAt: null,
    pinnedAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    doneOverride: null,
    doneAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe("matchesTaskFilter", () => {
  it("keeps everything under All", () => {
    const failed = thread({ id: "a", status: "failed" })
    expect(matchesTaskFilter(failed, "all", options)).toBe(true)
  })

  it("separates running from waiting on an answer", () => {
    const running = thread({ id: "a", status: "running" })
    const waiting = thread({ id: "b", status: "waiting-approval" })

    expect(matchesTaskFilter(running, "running", options)).toBe(true)
    expect(matchesTaskFilter(running, "needs-review", options)).toBe(false)
    expect(matchesTaskFilter(waiting, "needs-review", options)).toBe(true)
    expect(matchesTaskFilter(waiting, "running", options)).toBe(false)
  })

  it("reads Done through the shared predicate, not the status alone", () => {
    const marked = thread({ id: "a", doneOverride: "done" })
    const quiet = thread({
      id: "b",
      lastTurnCompletedAt: "2026-08-20T12:00:00.000Z",
    })
    const busy = thread({ id: "c", status: "running", doneOverride: "done" })

    expect(matchesTaskFilter(marked, "done", options)).toBe(true)
    expect(matchesTaskFilter(quiet, "done", options)).toBe(true)
    // Work in flight can never be filed away, however it was marked.
    expect(matchesTaskFilter(busy, "done", options)).toBe(false)
  })

  it("holds a failed task out of Done so it stays visible", () => {
    const failed = thread({
      id: "a",
      status: "failed",
      lastTurnCompletedAt: "2026-08-20T12:00:00.000Z",
    })
    expect(matchesTaskFilter(failed, "done", options)).toBe(false)
  })
})

describe("taskTableRows", () => {
  it("orders by creation, newest first, whatever the agents are doing", () => {
    const rows = taskTableRows(
      [
        thread({ id: "old", createdAt: "2026-08-01T12:00:00.000Z" }),
        thread({
          id: "new",
          createdAt: "2026-08-29T12:00:00.000Z",
          status: "running",
        }),
        thread({ id: "middle", createdAt: "2026-08-10T12:00:00.000Z" }),
      ],
      "all",
      options
    )

    expect(rows.map((row) => row.id)).toEqual(["new", "middle", "old"])
  })

  it("ties break on id so a row never swaps places with itself", () => {
    const rows = taskTableRows(
      [thread({ id: "b" }), thread({ id: "a" })],
      "all",
      options
    )
    expect(rows.map((row) => row.id)).toEqual(["a", "b"])
  })
})

describe("taskTableCounts", () => {
  it("counts the total and what is running now", () => {
    expect(
      taskTableCounts([
        thread({ id: "a", status: "running" }),
        thread({ id: "b", status: "waiting-approval" }),
        thread({ id: "c" }),
      ])
    ).toEqual({ total: 3, running: 1 })
  })
})

describe("taskUpdatedAt", () => {
  it("prefers real activity and falls back to when the task began", () => {
    const active = thread({
      id: "a",
      createdAt: "2026-08-01T12:00:00.000Z",
      lastTurnCompletedAt: "2026-08-29T12:00:00.000Z",
    })
    const fresh = thread({ id: "b", createdAt: "2026-08-01T12:00:00.000Z" })

    expect(taskUpdatedAt(active)).toBe("2026-08-29T12:00:00.000Z")
    expect(taskUpdatedAt(fresh)).toBe("2026-08-01T12:00:00.000Z")
  })
})

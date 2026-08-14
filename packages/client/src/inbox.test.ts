import { describe, expect, it } from "vitest"

import type { Thread } from "@openappto/protocol"

import {
  effectiveDone,
  effectiveSnoozed,
  hasUnreadCompletion,
  partitionInbox,
  resolveSnoozePresets,
  snoozeWakeLabel,
  threadCameBack,
  threadWokeAt,
} from "./inbox.js"

const now = "2026-08-14T12:00:00.000Z"

function thread(overrides: Partial<Thread> & { id?: string } = {}): Thread {
  return {
    id: "thread-1",
    projectId: "project-1",
    title: "Task",
    harnessId: "claude",
    status: "idle",
    executionProfile: {
      modelId: null,
      effort: null,
      permissionMode: "approval-required",
    },
    lastUserMessageAt: null,
    lastTurnCompletedAt: null,
    lastVisitedAt: null,
    failedAt: null,
    pinnedAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    doneOverride: null,
    doneAt: null,
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T10:00:00.000Z",
    ...overrides,
  }
}

const daysAgo = (days: number) =>
  new Date(Date.parse(now) - days * 24 * 60 * 60 * 1_000).toISOString()

describe("effectiveDone", () => {
  const options = { now, autoDoneAfterDays: 3 }

  it("never closes a task the agent is working on or waiting on", () => {
    for (const status of ["running", "waiting-approval"] as const) {
      expect(
        effectiveDone(thread({ status, doneOverride: "done" }), options)
      ).toBe(false)
    }
  })

  it("lets the explicit override win in both directions", () => {
    expect(effectiveDone(thread({ doneOverride: "done" }), options)).toBe(true)
    expect(
      effectiveDone(
        thread({ doneOverride: "active", lastUserMessageAt: daysAgo(30) }),
        options
      )
    ).toBe(false)
  })

  it("closes a quiet task after the window, and only after", () => {
    expect(
      effectiveDone(thread({ lastUserMessageAt: daysAgo(4) }), options)
    ).toBe(true)
    expect(
      effectiveDone(thread({ lastUserMessageAt: daysAgo(2) }), options)
    ).toBe(false)
  })

  it("uses the newest activity, not just the message time", () => {
    expect(
      effectiveDone(
        thread({
          lastUserMessageAt: daysAgo(10),
          lastTurnCompletedAt: daysAgo(1),
        }),
        options
      )
    ).toBe(false)
  })

  it("keeps a failed task visible unless the user closed it", () => {
    expect(
      effectiveDone(
        thread({ status: "failed", lastUserMessageAt: daysAgo(30) }),
        options
      )
    ).toBe(false)
    expect(
      effectiveDone(thread({ status: "failed", doneOverride: "done" }), options)
    ).toBe(true)
  })

  it("restarts the quiet window at an elapsed wake time", () => {
    // Snoozed for a week on an already-quiet task: the wake must return the
    // task to the inbox, not drop it straight into the Done shelf.
    const base = { lastUserMessageAt: daysAgo(10) }
    expect(
      effectiveDone(
        thread({ ...base, snoozedUntil: daysAgo(1), snoozedAt: daysAgo(8) }),
        options
      )
    ).toBe(false)
    expect(
      effectiveDone(
        thread({ ...base, snoozedUntil: daysAgo(4), snoozedAt: daysAgo(8) }),
        options
      )
    ).toBe(true)
  })

  it("never auto-closes with the rule turned off or without activity", () => {
    expect(
      effectiveDone(thread({ lastUserMessageAt: daysAgo(30) }), {
        now,
        autoDoneAfterDays: null,
      })
    ).toBe(false)
    expect(effectiveDone(thread(), options)).toBe(false)
  })
})

describe("effectiveSnoozed", () => {
  it("hides until the wake time and not a moment longer", () => {
    const shell = thread({
      snoozedUntil: "2026-08-14T13:00:00.000Z",
      snoozedAt: "2026-08-14T11:00:00.000Z",
    })
    expect(effectiveSnoozed(shell, { now })).toBe(true)
    expect(
      effectiveSnoozed(shell, { now: "2026-08-14T13:00:00.000Z" })
    ).toBe(false)
  })

  it("wakes early when the agent is blocked on the user", () => {
    expect(
      effectiveSnoozed(
        thread({
          status: "waiting-approval",
          snoozedUntil: "2026-08-20T09:00:00.000Z",
          snoozedAt: "2026-08-14T11:00:00.000Z",
        }),
        { now }
      )
    ).toBe(false)
  })

  it("wakes on a failure newer than the snooze, but not an older one", () => {
    const base = {
      status: "failed" as const,
      snoozedUntil: "2026-08-20T09:00:00.000Z",
      snoozedAt: "2026-08-14T11:00:00.000Z",
    }
    expect(
      effectiveSnoozed(
        thread({ ...base, failedAt: "2026-08-14T11:30:00.000Z" }),
        { now }
      )
    ).toBe(false)
    expect(
      effectiveSnoozed(
        thread({ ...base, failedAt: "2026-08-14T10:00:00.000Z" }),
        { now }
      )
    ).toBe(true)
  })

  it("ignores updatedAt entirely: a profile change cannot void a snooze", () => {
    expect(
      effectiveSnoozed(
        thread({
          status: "failed",
          snoozedUntil: "2026-08-20T09:00:00.000Z",
          snoozedAt: "2026-08-14T11:00:00.000Z",
          failedAt: "2026-08-14T10:00:00.000Z",
          updatedAt: "2026-08-14T11:45:00.000Z",
        }),
        { now }
      )
    ).toBe(true)
  })

  it("wakes on a completion after the snooze was set", () => {
    expect(
      effectiveSnoozed(
        thread({
          snoozedUntil: "2026-08-20T09:00:00.000Z",
          snoozedAt: "2026-08-14T11:00:00.000Z",
          lastTurnCompletedAt: "2026-08-14T11:30:00.000Z",
        }),
        { now }
      )
    ).toBe(false)
  })

  it("never hides a task on malformed data", () => {
    expect(
      effectiveSnoozed(thread({ snoozedUntil: "not-a-date" }), { now })
    ).toBe(false)
  })
})

describe("threadWokeAt", () => {
  it("reports the wake time after a timer wake, null while hidden", () => {
    const shell = thread({
      snoozedUntil: "2026-08-14T11:00:00.000Z",
      snoozedAt: "2026-08-13T11:00:00.000Z",
    })
    expect(threadWokeAt(shell, { now })).toBe("2026-08-14T11:00:00.000Z")
    expect(
      threadWokeAt(
        thread({
          snoozedUntil: "2026-08-20T09:00:00.000Z",
          snoozedAt: "2026-08-13T11:00:00.000Z",
        }),
        { now }
      )
    ).toBe(null)
  })

  it("reports the event time for an early wake", () => {
    expect(
      threadWokeAt(
        thread({
          snoozedUntil: "2026-08-20T09:00:00.000Z",
          snoozedAt: "2026-08-14T11:00:00.000Z",
          lastTurnCompletedAt: "2026-08-14T11:30:00.000Z",
        }),
        { now }
      )
    ).toBe("2026-08-14T11:30:00.000Z")
  })
})

describe("threadCameBack", () => {
  it("stays visible until the task is visited after its timer wake", () => {
    const shell = {
      snoozedUntil: "2026-08-14T11:00:00.000Z",
      snoozedAt: "2026-08-13T11:00:00.000Z",
    }
    expect(
      threadCameBack(
        thread({ ...shell, lastVisitedAt: "2026-08-14T10:00:00.000Z" }),
        { now }
      )
    ).toBe(true)
    expect(
      threadCameBack(
        thread({ ...shell, lastVisitedAt: "2026-08-14T11:30:00.000Z" }),
        { now }
      )
    ).toBe(false)
  })

  it("uses the failure time for an early wake", () => {
    const shell = thread({
      status: "failed",
      snoozedUntil: "2026-08-20T09:00:00.000Z",
      snoozedAt: "2026-08-14T10:00:00.000Z",
      failedAt: "2026-08-14T11:00:00.000Z",
      lastVisitedAt: "2026-08-14T10:30:00.000Z",
    })
    expect(threadWokeAt(shell, { now })).toBe("2026-08-14T11:00:00.000Z")
    expect(threadCameBack(shell, { now })).toBe(true)
  })
})

describe("hasUnreadCompletion", () => {
  it("marks a completion the user has not seen", () => {
    expect(
      hasUnreadCompletion(
        thread({ lastTurnCompletedAt: "2026-08-14T11:00:00.000Z" })
      )
    ).toBe(true)
    expect(
      hasUnreadCompletion(
        thread({
          lastTurnCompletedAt: "2026-08-14T11:00:00.000Z",
          lastVisitedAt: "2026-08-14T11:30:00.000Z",
        })
      )
    ).toBe(false)
  })
})

describe("partitionInbox", () => {
  const options = { now, autoDoneAfterDays: 3 }

  it("classifies with snooze above pin above done above active", () => {
    const snoozedPinned = thread({
      id: "a",
      pinnedAt: "2026-08-10T10:00:00.000Z",
      snoozedUntil: "2026-08-20T09:00:00.000Z",
      snoozedAt: "2026-08-14T11:00:00.000Z",
    })
    const pinnedQuiet = thread({
      id: "b",
      pinnedAt: "2026-08-10T10:00:00.000Z",
      lastUserMessageAt: daysAgo(30),
    })
    const closed = thread({ id: "c", doneOverride: "done" })
    const open = thread({ id: "d" })
    const partition = partitionInbox(
      [snoozedPinned, pinnedQuiet, closed, open],
      options
    )
    expect(partition.later.map((entry) => entry.id)).toEqual(["a"])
    expect(partition.pinned.map((entry) => entry.id)).toEqual(["b"])
    expect(partition.done.map((entry) => entry.id)).toEqual(["c"])
    expect(partition.active.map((entry) => entry.id)).toEqual(["d"])
  })

  it("keeps the active sort static: creation order, newest first", () => {
    const older = thread({
      id: "old",
      createdAt: "2026-08-01T10:00:00.000Z",
      lastTurnCompletedAt: "2026-08-14T11:59:00.000Z",
    })
    const newer = thread({ id: "new", createdAt: "2026-08-10T10:00:00.000Z" })
    const partition = partitionInbox([older, newer], options)
    expect(partition.active.map((entry) => entry.id)).toEqual(["new", "old"])
  })

  it("sorts Later by soonest wake and Done by when work ended", () => {
    const wakesLater = thread({
      id: "later",
      snoozedUntil: "2026-08-21T09:00:00.000Z",
      snoozedAt: now,
    })
    const wakesSoon = thread({
      id: "soon",
      snoozedUntil: "2026-08-15T09:00:00.000Z",
      snoozedAt: now,
    })
    const doneOld = thread({
      id: "done-old",
      doneOverride: "done",
      doneAt: "2026-08-10T10:00:00.000Z",
    })
    const doneNew = thread({
      id: "done-new",
      doneOverride: "done",
      doneAt: "2026-08-13T10:00:00.000Z",
    })
    const partition = partitionInbox(
      [wakesLater, wakesSoon, doneOld, doneNew],
      options
    )
    expect(partition.later.map((entry) => entry.id)).toEqual(["soon", "later"])
    expect(partition.done.map((entry) => entry.id)).toEqual([
      "done-new",
      "done-old",
    ])
  })
})

describe("resolveSnoozePresets", () => {
  it("offers the evening only while it is meaningfully ahead", () => {
    const morning = resolveSnoozePresets(new Date("2026-08-14T09:00:00"))
    expect(morning.map((preset) => preset.id)).toContain("evening")
    const evening = resolveSnoozePresets(new Date("2026-08-14T17:30:00"))
    expect(evening.map((preset) => preset.id)).not.toContain("evening")
  })

  it("lands next week on a Monday morning", () => {
    // 2026-08-14 is a Friday.
    const presets = resolveSnoozePresets(new Date("2026-08-14T09:00:00"))
    const nextWeek = presets.find((preset) => preset.id === "next-week")!
    const wake = new Date(nextWeek.until)
    expect(wake.getDay()).toBe(1)
    expect(wake.getHours()).toBe(9)
  })
})

describe("snoozeWakeLabel", () => {
  it("rounds up and never reads 0m while hidden", () => {
    expect(snoozeWakeLabel("2026-08-14T12:00:30.000Z", { now })).toBe("1m")
    expect(snoozeWakeLabel("2026-08-14T15:30:00.000Z", { now })).toBe("4h")
    expect(snoozeWakeLabel("2026-08-16T18:00:00.000Z", { now })).toBe("3d")
    expect(snoozeWakeLabel("2026-08-14T11:00:00.000Z", { now })).toBe("now")
  })
})

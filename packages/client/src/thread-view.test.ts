import { describe, expect, it } from "vitest"
import type { Activity, Message, ThreadView } from "@openappto/protocol"

import { applyThreadDelta, type ThreadDeltaEvent } from "./thread-view.js"

const baseMessage: Message = {
  id: "m1",
  threadId: "t1",
  turnId: "turn1",
  role: "assistant",
  content: "Hello",
  state: "streaming",
  ordinal: 1,
  createdAt: "2026-08-14T10:00:00.000Z",
}

const baseActivity: Activity = {
  id: "a1",
  threadId: "t1",
  turnId: "turn1",
  name: "Run command",
  status: "running",
  payload: { kind: "tool", tool: "command" },
  ordinal: 2,
  createdAt: "2026-08-14T10:00:01.000Z",
}

function view(overrides: Partial<ThreadView> = {}): ThreadView {
  return {
    thread: {
      id: "t1",
      projectId: "p1",
      title: "Task",
      harnessId: "scripted",
      status: "running",
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
      createdAt: "2026-08-14T10:00:00.000Z",
      updatedAt: "2026-08-14T10:00:00.000Z",
    },
    messages: [baseMessage],
    activities: [baseActivity],
    seq: 5,
    ...overrides,
  }
}

function delta(
  seq: number,
  change: ThreadDeltaEvent["change"],
  threadId = "t1"
): ThreadDeltaEvent {
  return { type: "thread.delta", threadId, seq, change }
}

describe("applyThreadDelta", () => {
  it("appends streamed text to the right message", () => {
    const result = applyThreadDelta(
      view(),
      delta(6, { type: "message.appended", messageId: "m1", text: " world" })
    )
    expect(result.outcome).toBe("applied")
    if (result.outcome !== "applied") return
    expect(result.view.messages[0]?.content).toBe("Hello world")
    expect(result.view.seq).toBe(6)
  })

  it("drops deltas the view already contains", () => {
    const result = applyThreadDelta(
      view(),
      delta(5, { type: "message.appended", messageId: "m1", text: "again" })
    )
    expect(result.outcome).toBe("stale")
  })

  it("asks for a reload on a sequence gap", () => {
    const result = applyThreadDelta(
      view(),
      delta(8, { type: "message.appended", messageId: "m1", text: "late" })
    )
    expect(result.outcome).toBe("gap")
  })

  it("asks for a reload when appending to an unknown message", () => {
    const result = applyThreadDelta(
      view(),
      delta(6, { type: "message.appended", messageId: "missing", text: "x" })
    )
    expect(result.outcome).toBe("gap")
  })

  it("ignores deltas for another thread", () => {
    const result = applyThreadDelta(
      view(),
      delta(6, { type: "message.appended", messageId: "m1", text: "x" }, "t2")
    )
    expect(result.outcome).toBe("stale")
  })

  it("inserts a new message segment and updates it in place later", () => {
    const segment: Message = {
      ...baseMessage,
      id: "m2",
      content: "",
      ordinal: 3,
    }
    const inserted = applyThreadDelta(
      view(),
      delta(6, { type: "message.upserted", message: segment })
    )
    expect(inserted.outcome).toBe("applied")
    if (inserted.outcome !== "applied") return
    expect(inserted.view.messages.map((message) => message.id)).toEqual([
      "m1",
      "m2",
    ])

    const settled = applyThreadDelta(
      inserted.view,
      delta(7, {
        type: "message.upserted",
        message: { ...segment, state: "complete" },
      })
    )
    expect(settled.outcome).toBe("applied")
    if (settled.outcome !== "applied") return
    expect(settled.view.messages).toHaveLength(2)
    expect(settled.view.messages[1]?.state).toBe("complete")
  })

  it("upserts activities by id", () => {
    const updated = applyThreadDelta(
      view(),
      delta(6, {
        type: "activity.upserted",
        activity: { ...baseActivity, status: "completed" },
      })
    )
    expect(updated.outcome).toBe("applied")
    if (updated.outcome !== "applied") return
    expect(updated.view.activities).toHaveLength(1)
    expect(updated.view.activities[0]?.status).toBe("completed")
  })

  it("adds a pending approval and clears it on resolution", () => {
    const approval = {
      id: "ap1",
      threadId: "t1",
      kind: "command" as const,
      title: "Allow this command?",
      status: "pending" as const,
      createdAt: "2026-08-14T10:00:02.000Z",
    }
    const requested = applyThreadDelta(
      view(),
      delta(6, { type: "approval.requested", approval })
    )
    expect(requested.outcome).toBe("applied")
    if (requested.outcome !== "applied") return
    expect(requested.view.pendingApproval).toEqual(approval)

    const resolved = applyThreadDelta(
      requested.view,
      delta(7, { type: "approval.resolved", approvalId: "ap1" })
    )
    expect(resolved.outcome).toBe("applied")
    if (resolved.outcome !== "applied") return
    expect(resolved.view.pendingApproval).toBeUndefined()
    expect(resolved.view.seq).toBe(7)
  })

  it("keeps an unrelated pending approval on resolution", () => {
    const approval = {
      id: "ap1",
      threadId: "t1",
      kind: "command" as const,
      title: "Allow this command?",
      status: "pending" as const,
      createdAt: "2026-08-14T10:00:02.000Z",
    }
    const result = applyThreadDelta(
      view({ pendingApproval: approval, seq: 5 }),
      delta(6, { type: "approval.resolved", approvalId: "other" })
    )
    expect(result.outcome).toBe("applied")
    if (result.outcome !== "applied") return
    expect(result.view.pendingApproval).toEqual(approval)
  })

  it("replaces the thread record", () => {
    const current = view()
    const result = applyThreadDelta(
      current,
      delta(6, {
        type: "thread.updated",
        thread: {
          ...current.thread,
          contextUsage: { usedTokens: 1200, maxTokens: 200000 },
        },
      })
    )
    expect(result.outcome).toBe("applied")
    if (result.outcome !== "applied") return
    expect(result.view.thread.contextUsage?.usedTokens).toBe(1200)
  })
})

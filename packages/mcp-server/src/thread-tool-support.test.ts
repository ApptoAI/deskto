import type {
  RuntimeEvent,
  RuntimeTransport,
  ThreadView,
} from "@deskto/protocol"
import { describe, expect, it, vi } from "vitest"

import { RuntimeClient } from "./runtime-client.js"
import { finalAnswer, waitForThreads } from "./thread-tool-support.js"

const now = "2026-08-17T10:00:00.000Z"

function view(
  status: ThreadView["thread"]["status"],
  lastUserMessageAt: string | null
): ThreadView {
  return {
    thread: {
      id: "child-1",
      projectId: "project-1",
      parentThreadId: "parent-1",
      title: "Background task",
      harnessId: "codex",
      status,
      executionProfile: {
        modelId: "gpt-5",
        effort: "high",
        permissionMode: "auto",
      },
      lastUserMessageAt,
      lastTurnCompletedAt: status === "idle" ? now : null,
      failedAt: status === "failed" ? now : null,
      lastVisitedAt: null,
      pinnedAt: null,
      snoozedUntil: null,
      snoozedAt: null,
      doneOverride: null,
      doneAt: null,
      createdAt: now,
      updatedAt: now,
    },
    childThreads: [],
    messages: [],
    activities: [],
    seq: 0,
  }
}

function clientFor(options: {
  request: () => Promise<ThreadView>
  subscribe?: RuntimeTransport["subscribe"]
}) {
  // SAFETY: this test transport only receives thread.get, and the callback
  // returns exactly that method's ThreadView response.
  const request = vi.fn(async () => ({
    ok: true as const,
    data: await options.request(),
  })) as RuntimeTransport["request"]
  return new RuntimeClient({
    request,
    subscribe: options.subscribe ?? (() => () => undefined),
  })
}

describe("thread tool support", () => {
  it("does not complete a wait for a thread that has never started", async () => {
    const result = await waitForThreads(
      clientFor({ request: () => Promise.resolve(view("idle", null)) }),
      ["child-1"],
      0
    )

    expect(result.completed).toBe(false)
  })

  it("rechecks when a thread settles during the initial read", async () => {
    let listener: ((event: RuntimeEvent) => void) | undefined
    let reads = 0
    const client = clientFor({
      request: async () => {
        reads += 1
        if (reads > 1) return view("idle", now)
        listener?.({ type: "thread.changed", threadId: "child-1" })
        await Promise.resolve()
        return view("running", now)
      },
      subscribe: (next) => {
        listener = next
        return () => {
          listener = undefined
        }
      },
    })

    const result = await waitForThreads(client, ["child-1"], 1)

    expect(result.completed).toBe(true)
    expect(reads).toBe(2)
  })

  it("does not reuse an answer from before the latest user message", () => {
    const task = view("idle", "2026-08-17T10:02:00.000Z")
    task.messages = [
      {
        id: "user-1",
        threadId: "child-1",
        role: "user",
        content: "First task",
        state: "complete",
        createdAt: "2026-08-17T10:00:00.000Z",
      },
      {
        id: "assistant-1",
        threadId: "child-1",
        role: "assistant",
        content: "First answer",
        state: "complete",
        createdAt: "2026-08-17T10:01:00.000Z",
      },
      {
        id: "user-2",
        threadId: "child-1",
        role: "user",
        content: "Follow-up",
        state: "complete",
        createdAt: "2026-08-17T10:02:00.000Z",
      },
    ]

    expect(finalAnswer(task)).toBeNull()
  })
})

import { describe, expect, it } from "vitest"

import { childThreadView } from "../test-fixtures.js"
import { finalAnswer } from "./format.js"

describe("finalAnswer", () => {
  it("does not reuse an answer from before the latest user message", () => {
    const task = childThreadView("idle", "2026-08-17T10:02:00.000Z")
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

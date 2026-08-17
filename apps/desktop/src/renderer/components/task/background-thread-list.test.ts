import type { Thread } from "@deskto/protocol"
import { describe, expect, it } from "vitest"

import { backgroundState } from "./background-thread-list.js"

const now = "2026-08-17T10:00:00.000Z"
const thread: Thread = {
  id: "child-1",
  projectId: "project-1",
  parentThreadId: "parent-1",
  title: "Background task",
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
  lastVisitedAt: null,
  pinnedAt: null,
  snoozedUntil: null,
  snoozedAt: null,
  doneOverride: null,
  doneAt: null,
  createdAt: now,
  updatedAt: now,
}

describe("background task status", () => {
  it("shows a cancelled follow-up as stopped instead of reusing an old completion", () => {
    expect(
      backgroundState({
        ...thread,
        lastTurnCompletedAt: "2026-08-17T10:01:00.000Z",
        lastUserMessageAt: "2026-08-17T10:02:00.000Z",
      })
    ).toBe("stopped")
  })
})

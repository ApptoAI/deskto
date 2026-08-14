import type { HarnessEvent } from "@openappto/harness-sdk"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { clientState } = vi.hoisted(() => ({
  clientState: {
    notification: undefined as
      | ((notification: {
          method: string
          params?: Record<string, unknown>
        }) => void)
      | undefined,
  },
}))

vi.mock("./jsonl-client.js", () => ({
  JsonlClient: class {
    request<T>(method: string): Promise<T> {
      const response =
        method === "thread/start"
          ? { thread: { id: "thread-1" } }
          : method === "turn/start"
            ? { turn: { id: "turn-1" } }
            : {}
      return Promise.resolve(response as T)
    }

    notify() {}
    respond() {}
    respondMethodNotFound() {}
    close() {}

    onNotification(listener: NonNullable<typeof clientState.notification>) {
      clientState.notification = listener
      return () => {}
    }

    onRequest() {
      return () => {}
    }

    onFailure() {
      return () => {}
    }
  },
}))

import {
  CodexAdapter,
  codexActivity,
  codexLimitResetAt,
  codexPlanSteps,
} from "./codex-adapter.js"

beforeEach(() => {
  clientState.notification = undefined
})

describe("codexActivity", () => {
  it("classifies app-server items into provider-neutral payloads", () => {
    expect(
      codexActivity({ id: "i1", type: "commandExecution", command: "ls" })
    ).toEqual({
      id: "i1",
      name: "Run command",
      detail: "ls",
      payload: { kind: "tool", tool: "command" },
    })
    expect(
      codexActivity({
        id: "i2",
        type: "fileChange",
        changes: [
          { path: "a.md", additions: 3, deletions: 1 },
          { path: "b.md" },
        ],
      })
    ).toEqual({
      id: "i2",
      name: "Change files",
      detail: "a.md, b.md",
      payload: {
        kind: "file-change",
        files: [{ path: "a.md", additions: 3, deletions: 1 }, { path: "b.md" }],
      },
    })
  })

  it("summarizes remaining files and classifies empty known items", () => {
    expect(
      codexActivity({
        id: "many",
        type: "fileChange",
        changes: ["a.md", "b.md", "c.md", "d.md"].map((path) => ({ path })),
      })
    ).toMatchObject({ detail: "a.md, b.md, c.md +1 more" })
    expect(codexActivity({ id: "empty-files", type: "fileChange" })).toEqual({
      id: "empty-files",
      name: "Change files",
      payload: { kind: "tool", tool: "other" },
    })
    expect(
      codexActivity({ id: "empty-plan", type: "plan", text: "Planning" })
    ).toEqual({
      id: "empty-plan",
      name: "Plan",
      detail: "Planning",
      payload: { kind: "tool", tool: "other" },
    })
  })

  it("keeps plan items instead of dropping them", () => {
    expect(
      codexActivity({
        id: "p1",
        type: "plan",
        plan: [
          { step: "Research", status: "completed" },
          { step: "Write", status: "inProgress" },
        ],
      })
    ).toEqual({
      id: "p1",
      name: "Plan",
      payload: {
        kind: "plan",
        steps: [
          { text: "Research", status: "done" },
          { text: "Write", status: "active" },
        ],
      },
    })
  })

  it("still ignores message and reasoning items", () => {
    expect(codexActivity({ id: "r1", type: "reasoning" })).toBeUndefined()
    expect(codexActivity({ id: "m1", type: "agentMessage" })).toBeUndefined()
  })
})

describe("codexPlanSteps", () => {
  it("accepts the step-list shapes seen in the wild", () => {
    expect(
      codexPlanSteps({ steps: [{ text: "One", status: "in_progress" }] })
    ).toEqual([{ text: "One", status: "active" }])
    expect(codexPlanSteps({ items: ["Bare step"] })).toEqual([
      { text: "Bare step", status: "pending" },
    ])
    expect(
      codexPlanSteps({
        steps: [
          { text: "Two", status: "In Progress" },
          { text: "Three", status: "COMPLETED" },
        ],
      })
    ).toEqual([
      { text: "Two", status: "active" },
      { text: "Three", status: "done" },
    ])
    expect(codexPlanSteps({})).toEqual([])
  })
})

describe("CodexAdapter activity notifications", () => {
  it("suppresses identical updates and completes a statusless plan", async () => {
    const session = await new CodexAdapter().start(
      {
        threadId: "thread-1",
        turnId: "turn-1",
        projectPath: "/tmp/project",
        prompt: "Continue",
        executionProfile: {
          modelId: null,
          effort: null,
          permissionMode: "approval-required",
        },
        customization: { skillRoots: [] },
      },
      new AbortController().signal
    )
    const notify = clientState.notification!
    notify({
      method: "item/started",
      params: {
        item: {
          id: "plan-1",
          type: "plan",
          steps: [{ text: "Research", status: "pending" }],
        },
      },
    })
    const updated = {
      method: "item/updated",
      params: {
        item: {
          id: "plan-1",
          type: "plan",
          steps: [{ text: "Research", status: "in_progress" }],
        },
      },
    }
    notify(updated)
    notify(updated)
    notify({
      method: "item/completed",
      params: {
        item: {
          id: "plan-1",
          type: "plan",
          steps: [{ text: "Research", status: "completed" }],
        },
      },
    })
    notify({
      method: "turn/completed",
      params: { turn: { status: "completed" } },
    })

    const events: HarnessEvent[] = []
    for await (const event of session.events) events.push(event)
    expect(events).toEqual([
      { type: "session.started", providerSessionId: "thread-1" },
      {
        type: "activity.started",
        activity: {
          id: "plan-1",
          name: "Plan",
          payload: {
            kind: "plan",
            steps: [{ text: "Research", status: "pending" }],
          },
        },
      },
      {
        type: "activity.updated",
        update: {
          id: "plan-1",
          name: "Plan",
          payload: {
            kind: "plan",
            steps: [{ text: "Research", status: "active" }],
          },
        },
      },
      {
        type: "activity.completed",
        id: "plan-1",
        outcome: "completed",
      },
      { type: "turn.completed" },
    ])
  })
})

describe("codexLimitResetAt", () => {
  it("reads the app-server camel-case payload and chooses the most-used limit", () => {
    const primaryReset = 1_754_000_000
    const secondaryReset = 1_755_000_000

    expect(
      codexLimitResetAt({
        rateLimits: {
          primary: { usedPercent: 95, resetsAt: primaryReset },
          secondary: { usedPercent: 40, resetsAt: secondaryReset },
        },
      })
    ).toBe(new Date(primaryReset * 1000).toISOString())
  })

  it("reads snake-case transcript data with millisecond timestamps", () => {
    const reset = 1_754_000_000_000

    expect(
      codexLimitResetAt({
        primary: { used_percent: 100, resets_at: reset },
      })
    ).toBe(new Date(reset).toISOString())
  })

  it("ignores malformed rate-limit data", () => {
    expect(codexLimitResetAt({ rateLimits: { primary: {} } })).toBeUndefined()
    expect(codexLimitResetAt(null)).toBeUndefined()
  })
})

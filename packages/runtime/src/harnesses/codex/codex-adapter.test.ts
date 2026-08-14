import { describe, expect, it } from "vitest"

import {
  codexActivity,
  codexLimitResetAt,
  codexPlanSteps,
} from "./codex-adapter.js"

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
        changes: [{ path: "a.md" }, { path: "b.md" }],
      })
    ).toEqual({
      id: "i2",
      name: "Change files",
      detail: "a.md, b.md",
      payload: {
        kind: "file-change",
        files: [{ path: "a.md" }, { path: "b.md" }],
      },
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
    expect(codexPlanSteps({})).toEqual([])
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

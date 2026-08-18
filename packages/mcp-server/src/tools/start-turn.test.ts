import { describe, expect, it } from "vitest"

import { RuntimeClient } from "../runtime-client.js"
import { fakeRuntime, testBinding } from "../test-fixtures.js"
import { startTurnTool } from "./start-turn.js"
import type { ToolContext } from "./definition.js"

function contextFor(failTurnStart = false): ToolContext {
  return {
    client: new RuntimeClient(fakeRuntime({ failTurnStart })),
    binding: testBinding,
  }
}

describe("deskto_start_turn", () => {
  it("returns the failure message when the Runtime reports a failed start", async () => {
    const result = await startTurnTool.handler(
      { threadId: "child-1", prompt: "Check startup" },
      contextFor(true)
    )

    expect(result.structuredContent).toMatchObject({
      thread: { id: "child-1", status: "failed" },
      startError: "Harness executable is unavailable",
    })
  })

  it("returns no start error for a running turn", async () => {
    const result = await startTurnTool.handler(
      { threadId: "child-1", prompt: "Continue" },
      contextFor()
    )

    expect(result.structuredContent).toMatchObject({
      thread: { id: "child-1", status: "running" },
      startError: null,
    })
  })
})

import { describe, expect, it } from "vitest"

import { RuntimeClient } from "../runtime-client.js"
import { fakeRuntime, testBinding } from "../test-fixtures.js"
import { createThreadsTool } from "./create-threads.js"
import type { ToolContext } from "./definition.js"

function contextFor(runtime = fakeRuntime()): ToolContext {
  return { client: new RuntimeClient(runtime), binding: testBinding }
}

describe("deskto_create_threads", () => {
  it("reports a Runtime startup failure without losing the child id", async () => {
    const context = contextFor(fakeRuntime({ failTurnStart: true }))

    const result = await createThreadsTool.handler(
      { tasks: [{ prompt: "Check startup" }] },
      context
    )

    expect(result.structuredContent.threads).toMatchObject([
      { id: "child-1", status: "failed" },
    ])
    expect(result.structuredContent.errors).toMatchObject([
      {
        threadId: "child-1",
        stage: "start",
        message: "Harness executable is unavailable",
      },
    ])
  })

  it("keeps successful thread creations when another harness is unavailable", async () => {
    const result = await createThreadsTool.handler(
      {
        tasks: [
          { prompt: "Use Codex", harnessId: "codex" },
          { prompt: "Use Claude", harnessId: "claude" },
        ],
      },
      contextFor()
    )

    expect(result.structuredContent.threads).toMatchObject([
      { id: "child-1", status: "running" },
    ])
    expect(result.structuredContent.errors).toMatchObject([
      {
        threadId: null,
        stage: "create",
        message: "Harness claude is not installed or available",
      },
    ])
  })
})

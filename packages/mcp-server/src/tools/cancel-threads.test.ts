import { describe, expect, it } from "vitest"

import { RuntimeClient } from "../runtime-client.js"
import { fakeRuntime, testBinding } from "../test-fixtures.js"
import { cancelThreadsTool } from "./cancel-threads.js"
import type { ToolContext } from "./definition.js"

describe("deskto_cancel_threads", () => {
  it("returns successful cancellations together with per-thread errors", async () => {
    const context: ToolContext = {
      client: new RuntimeClient(fakeRuntime({ failCancelThreadId: "child-2" })),
      binding: testBinding,
    }

    const result = await cancelThreadsTool.handler(
      { threadIds: ["child-1", "child-2"] },
      context
    )

    expect(result.structuredContent.threads).toMatchObject([
      { id: "child-1", status: "idle" },
    ])
    expect(result.structuredContent.errors).toEqual([
      {
        threadId: "child-2",
        code: "turn-not-active",
        message: "Task is not running",
      },
    ])
  })
})

import type {
  RuntimeEvent,
  RuntimeTransport,
  ThreadView,
} from "@deskto/protocol"
import { describe, expect, it, vi } from "vitest"

import { RuntimeClient } from "../runtime-client.js"
import { childThreadView } from "../test-fixtures.js"
import { waitForThreads } from "./wait.js"

const now = "2026-08-17T10:00:00.000Z"

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

describe("waitForThreads", () => {
  it("does not complete a wait for a thread that has never started", async () => {
    const result = await waitForThreads(
      clientFor({
        request: () => Promise.resolve(childThreadView("idle", null)),
      }),
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
        if (reads > 1) return childThreadView("idle", now)
        listener?.({ type: "thread.changed", threadId: "child-1" })
        await Promise.resolve()
        return childThreadView("running", now)
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
})

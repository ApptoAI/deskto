import type { RuntimeTransport } from "@deskto/protocol"
import { describe, expect, it, vi } from "vitest"

import { RuntimeClient, RuntimeRequestError } from "./runtime-client.js"

describe("RuntimeClient", () => {
  it("preserves Runtime error codes", async () => {
    // SAFETY: this transport always returns a valid Runtime error response.
    const request = vi.fn(async () => ({
      ok: false as const,
      error: { code: "turn-active", message: "Task is already running" },
    })) as RuntimeTransport["request"]
    const client = new RuntimeClient({
      request,
      subscribe: () => () => undefined,
    })

    await expect(
      client.request({ method: "thread.get", params: { threadId: "child-1" } })
    ).rejects.toEqual(
      expect.objectContaining<Partial<RuntimeRequestError>>({
        name: "RuntimeRequestError",
        code: "turn-active",
        message: "Task is already running",
      })
    )
  })
})

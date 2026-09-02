import { describe, expect, it, vi } from "vitest"
import type { RuntimeOptions } from "@deskto/runtime"

import { withForcedUnavailability } from "./dev-harness-stubs.js"

type HarnessFactory = RuntimeOptions["harnesses"][number]

function fakeFactory(extras: Partial<HarnessFactory> = {}): HarnessFactory {
  return {
    descriptor: {
      id: "claude",
      name: "Claude Code",
      followUps: { queue: false, steer: false },
    },
    checkAvailability: vi.fn(() =>
      Promise.resolve({ status: "available" as const })
    ),
    listModels: vi.fn(() => Promise.resolve([])),
    start: vi.fn(() => Promise.reject(new Error("not under test"))),
    ...extras,
  }
}

describe("withForcedUnavailability", () => {
  it("answers unavailable with the given reason", async () => {
    const stub = withForcedUnavailability(fakeFactory(), "Forced off")
    await expect(stub.checkAvailability()).resolves.toEqual({
      status: "unavailable",
      reason: "Forced off",
    })
  })

  it("keeps the wrapped descriptor and delegates the rest", async () => {
    const factory = fakeFactory()
    const stub = withForcedUnavailability(factory, "Forced off")
    expect(stub.descriptor).toBe(factory.descriptor)
    await stub.listModels()
    expect(factory.listModels).toHaveBeenCalled()
    // SAFETY: the fake's start never reads its arguments, so the test only
    // checks that the call reaches the wrapped factory.
    await stub.start(null as never, null as never).catch(() => {})
    expect(factory.start).toHaveBeenCalled()
  })

  it("only exposes optional methods the wrapped factory has", () => {
    const bare = withForcedUnavailability(fakeFactory(), "Forced off")
    expect(bare.generateText).toBeUndefined()
    expect(bare.discoverSkillRoots).toBeUndefined()

    const generateText = vi.fn(() => Promise.resolve("text"))
    const discoverSkillRoots = vi.fn(() => Promise.resolve([]))
    const full = withForcedUnavailability(
      fakeFactory({ generateText, discoverSkillRoots }),
      "Forced off"
    )
    expect(full.generateText).toBeDefined()
    expect(full.discoverSkillRoots).toBeDefined()
  })
})

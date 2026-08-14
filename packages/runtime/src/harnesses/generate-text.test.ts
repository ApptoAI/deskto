import type { HarnessSession } from "@openappto/harness-sdk"
import { ScriptedHarness } from "@openappto/harness-sdk/testing"
import { describe, expect, it } from "vitest"

import { generateTextWithSession } from "./generate-text.js"

const input = {
  projectPath: "/project",
  prompt: "Name this task",
  executionProfile: {
    modelId: "test-model",
    effort: null,
    permissionMode: "approval-required" as const,
  },
}

describe("generateTextWithSession", () => {
  it("collects text without exposing the disposable session", async () => {
    const harness = new ScriptedHarness()
    const generated = generateTextWithSession(
      (run, signal) => harness.start(run, signal),
      input,
      new AbortController().signal
    )
    await waitForRun(harness.runs)
    harness.runs[0]!.emit({ type: "message.delta", text: "Short " })
    harness.runs[0]!.emit({ type: "message.delta", text: "title" })
    harness.runs[0]!.emit({ type: "turn.completed" })
    harness.runs[0]!.finish()

    await expect(generated).resolves.toBe("Short title")
    expect(harness.runs[0]!.input.providerSessionId).toBeUndefined()
  })

  it("cancels a session when the request is aborted", async () => {
    const harness = new ScriptedHarness()
    const controller = new AbortController()
    const generated = generateTextWithSession(
      (run, signal) => harness.start(run, signal),
      input,
      controller.signal
    )
    await waitForRun(harness.runs)
    controller.abort()

    await expect(generated).rejects.toThrow("cancelled")
    expect(harness.runs[0]!.cancelled).toBe(true)
  })

  it("cancels a session when event consumption fails", async () => {
    let cancelled = false
    const session: HarnessSession = {
      events: {
        [Symbol.asyncIterator]() {
          return {
            next: () => Promise.reject(new Error("Broken stream")),
          }
        },
      },
      cancel: () => {
        cancelled = true
        return Promise.resolve()
      },
      respondToApproval: () => Promise.resolve(),
    }
    const start = () => Promise.resolve(session)

    await expect(
      generateTextWithSession(start, input, new AbortController().signal)
    ).rejects.toThrow("Broken stream")
    expect(cancelled).toBe(true)
  })
})

async function waitForRun(runs: readonly unknown[]): Promise<void> {
  for (let attempts = 0; attempts < 20; attempts += 1) {
    if (runs.length > 0) return
    await Promise.resolve()
  }
  throw new Error("Harness did not start")
}

import { randomUUID } from "node:crypto"

import type {
  HarnessRunInput,
  HarnessSession,
  TextGenerationInput,
} from "@openappto/harness-sdk"

/**
 * Reuses a Harness session without exposing that disposable provider session
 * to the Runtime's Thread. Provider adapters opt in to this helper explicitly.
 */
export async function generateTextWithSession(
  start: (
    input: HarnessRunInput,
    signal: AbortSignal
  ) => Promise<HarnessSession>,
  input: TextGenerationInput,
  signal: AbortSignal
): Promise<string> {
  const session = await start(
    {
      threadId: randomUUID(),
      turnId: randomUUID(),
      projectPath: input.projectPath,
      prompt: input.prompt,
      executionProfile: input.executionProfile,
      customization: { skillRoots: [] },
    },
    signal
  )
  let cancellation: Promise<void> | undefined
  const cancel = () => {
    cancellation ??= session.cancel().catch(() => undefined)
    return cancellation
  }
  const abort = () => void cancel()
  signal.addEventListener("abort", abort, { once: true })
  if (signal.aborted) {
    await cancel()
    throw new Error("Text generation was cancelled")
  }
  let output = ""
  let completed = false
  try {
    for await (const event of session.events) {
      if (signal.aborted) throw new Error("Text generation was cancelled")
      switch (event.type) {
        case "message.delta":
          output += event.text
          break
        case "approval.requested":
          await session.respondToApproval(event.request.id, "deny")
          break
        case "turn.failed":
          throw new Error(event.failure.message)
        case "turn.completed":
          completed = true
          return output
      }
    }
    if (signal.aborted) throw new Error("Text generation was cancelled")
    throw new Error("Harness ended without generating text")
  } finally {
    signal.removeEventListener("abort", abort)
    if (!completed) await cancel()
  }
}

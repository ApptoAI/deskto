import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk"
import { describe, expect, it } from "vitest"

import { claudeAssistantFailure } from "./claude-adapter.js"

describe("claudeAssistantFailure", () => {
  it("maps the rate-limit assistant frame even when Claude later reports success", () => {
    const message = {
      type: "assistant",
      error: "rate_limit",
      message: {
        content: [
          {
            type: "text",
            text: "You've hit your session limit · resets 6:30pm (Europe/Warsaw)",
          },
        ],
      },
    } as unknown as SDKMessage

    expect(claudeAssistantFailure(message)).toEqual({
      kind: "usage-limit",
      message: "You've hit your session limit · resets 6:30pm (Europe/Warsaw)",
    })
  })

  it("ignores ordinary assistant messages", () => {
    const message = {
      type: "assistant",
      message: { content: [{ type: "text", text: "Done" }] },
    } as unknown as SDKMessage

    expect(claudeAssistantFailure(message)).toBeUndefined()
  })
})

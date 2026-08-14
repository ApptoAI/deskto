import type { Query, SDKMessage } from "@anthropic-ai/claude-agent-sdk"
import type { HarnessEvent } from "@openappto/harness-sdk"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }))

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ query: queryMock }))

import { ClaudeAdapter, claudeAssistantFailure } from "./claude-adapter.js"

beforeEach(() => queryMock.mockReset())

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

describe("ClaudeAdapter", () => {
  it("emits only the usage-limit failure when Claude later reports success", async () => {
    queryMock.mockReturnValue(
      fakeQuery([
        {
          type: "assistant",
          error: "rate_limit",
          message: {
            content: [
              {
                type: "text",
                text: "You've hit your session limit",
              },
            ],
          },
        } as unknown as SDKMessage,
        {
          type: "result",
          subtype: "success",
          modelUsage: {},
        } as unknown as SDKMessage,
      ])
    )

    const session = await new ClaudeAdapter().start(
      {
        threadId: "thread-1",
        turnId: "turn-1",
        projectPath: "/tmp/project",
        prompt: "Continue",
        executionProfile: {
          modelId: null,
          effort: null,
          permissionMode: "approval-required",
        },
        customization: { skillRoots: [] },
      },
      new AbortController().signal
    )
    const events: HarnessEvent[] = []
    for await (const event of session.events) events.push(event)

    expect(events).toEqual([
      {
        type: "turn.failed",
        failure: {
          kind: "usage-limit",
          message: "You've hit your session limit",
        },
      },
    ])
  })
})

function fakeQuery(messages: SDKMessage[]): Query {
  return {
    async *[Symbol.asyncIterator]() {
      yield* messages
    },
    close: vi.fn(),
  } as unknown as Query
}

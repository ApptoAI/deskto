import type { Query, SDKMessage } from "@anthropic-ai/claude-agent-sdk"
import type { HarnessEvent } from "@openappto/harness-sdk"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }))

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ query: queryMock }))

import {
  ClaudeAdapter,
  claudeActivity,
  claudeAssistantFailure,
  planStepsFromTodos,
} from "./claude-adapter.js"

beforeEach(() => queryMock.mockReset())

describe("claudeActivity", () => {
  it("classifies built-in tools into provider-neutral payloads", () => {
    expect(
      claudeActivity("t1", "Bash", { command: "ls -la" }, undefined)
    ).toEqual({
      id: "t1",
      name: "Run command",
      detail: "ls -la",
      payload: { kind: "tool", tool: "command" },
    })
    expect(
      claudeActivity("t2", "Edit", { file_path: "notes.md" }, undefined)
    ).toEqual({
      id: "t2",
      name: "Edit file",
      detail: "notes.md",
      payload: { kind: "file-change", files: [{ path: "notes.md" }] },
    })
    expect(
      claudeActivity("t3", "WebSearch", { query: "news" }, undefined)
    ).toEqual({
      id: "t3",
      name: "Search web",
      detail: "news",
      payload: { kind: "tool", tool: "web" },
    })
  })

  it("turns the Task tool into a subagent and links children to it", () => {
    expect(
      claudeActivity(
        "task-1",
        "Task",
        { description: "Research the repo", subagent_type: "Explore" },
        undefined
      )
    ).toEqual({
      id: "task-1",
      name: "Research the repo",
      detail: "Explore",
      payload: { kind: "subagent", agentType: "Explore" },
    })
    expect(
      claudeActivity("t4", "Bash", { command: "rg sources" }, "task-1")
    ).toMatchObject({ id: "t4", parentId: "task-1" })
  })

  it("splits MCP tool ids into a tool name and server", () => {
    expect(
      claudeActivity("t5", "mcp__linear__create_issue", {}, undefined)
    ).toEqual({
      id: "t5",
      name: "create issue",
      detail: "linear",
      payload: { kind: "tool", tool: "mcp" },
    })
  })
})

describe("planStepsFromTodos", () => {
  it("maps TodoWrite input to plan steps", () => {
    expect(
      planStepsFromTodos({
        todos: [
          { content: "Research", status: "completed", activeForm: "..." },
          { content: "Write", status: "in_progress", activeForm: "..." },
          { content: "Review", status: "pending", activeForm: "..." },
        ],
      })
    ).toEqual([
      { text: "Research", status: "done" },
      { text: "Write", status: "active" },
      { text: "Review", status: "pending" },
    ])
  })

  it("ignores malformed input", () => {
    expect(planStepsFromTodos({ todos: "no" })).toEqual([])
    expect(planStepsFromTodos(null)).toEqual([])
  })
})

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

  it("keeps one plan activity per turn and settles it on completion", async () => {
    queryMock.mockReturnValue(
      fakeQuery([
        {
          type: "assistant",
          parent_tool_use_id: null,
          message: {
            content: [
              {
                type: "tool_use",
                id: "todo-1",
                name: "TodoWrite",
                input: { todos: [{ content: "Research", status: "pending" }] },
              },
            ],
          },
        } as unknown as SDKMessage,
        {
          type: "assistant",
          parent_tool_use_id: null,
          message: {
            content: [
              {
                type: "tool_use",
                id: "todo-2",
                name: "TodoWrite",
                input: {
                  todos: [{ content: "Research", status: "completed" }],
                },
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
        type: "activity.started",
        activity: {
          id: "claude-plan",
          name: "Plan",
          payload: {
            kind: "plan",
            steps: [{ text: "Research", status: "pending" }],
          },
        },
      },
      {
        type: "activity.updated",
        update: {
          id: "claude-plan",
          payload: {
            kind: "plan",
            steps: [{ text: "Research", status: "done" }],
          },
        },
      },
      // No synthetic completion: the runtime settles still-running
      // activities by the turn's outcome.
      { type: "turn.completed" },
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

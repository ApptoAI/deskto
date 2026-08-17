import type { SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk"
import type { HarnessEvent } from "@deskto/harness-sdk"
import type { JsonValue } from "@deskto/protocol"
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  ClaudeAdapter,
  claudeActivity,
  claudeAssistantFailure,
  claudePrompt,
  planStepsFromTodos,
  type ClaudeQuery,
  type ClaudeQueryFactory,
} from "./claude-adapter.js"

const queryMock = vi.fn<ClaudeQueryFactory>()
const emptyAssistantUsage = {
  input_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  output_tokens: 0,
}

beforeEach(() => queryMock.mockReset())

describe("claudePrompt", () => {
  it("translates selected skills to Claude plugin commands", () => {
    expect(
      claudePrompt({
        threadId: "thread-1",
        turnId: "turn-1",
        projectPath: "/repo",
        prompt: "Use $review on @src/a.ts",
        references: [
          {
            kind: "skill",
            name: "review",
            path: "/packs/review/SKILL.md",
          },
          {
            kind: "project-entry",
            name: "a.ts",
            path: "/repo/src/a.ts",
            entryKind: "file",
          },
        ],
        executionProfile: {
          modelId: null,
          effort: null,
          permissionMode: "approval-required",
        },
        customization: {
          skillRoots: [{ name: "Reviews", path: "/packs" }],
        },
      })
    ).toMatch(/^Use \/reviews-[a-f0-9]{8}:review on @src\/a\.ts$/)
  })

  it("does not translate a selected skill inside a longer token", () => {
    expect(
      claudePrompt({
        threadId: "thread-1",
        turnId: "turn-1",
        projectPath: "/repo",
        prompt: "Use $review-long, then $review, please",
        references: [
          {
            kind: "skill",
            name: "review",
            path: "/packs/review/SKILL.md",
          },
        ],
        executionProfile: {
          modelId: null,
          effort: null,
          permissionMode: "approval-required",
        },
        customization: {
          skillRoots: [{ name: "Reviews", path: "/packs" }],
        },
      })
    ).toMatch(/^Use \$review-long, then \/reviews-[a-f0-9]{8}:review, please$/)
  })

  it("qualifies same-named skills with their selected Pack plugin", () => {
    const promptFor = (packName: string, packPath: string) =>
      claudePrompt({
        threadId: "thread-1",
        turnId: "turn-1",
        projectPath: "/repo",
        prompt: "Use $review",
        references: [
          {
            kind: "skill",
            name: "review",
            path: `${packPath}/skills/review/SKILL.md`,
          },
        ],
        executionProfile: {
          modelId: null,
          effort: null,
          permissionMode: "approval-required",
        },
        customization: {
          skillRoots: [{ name: packName, path: `${packPath}/skills` }],
        },
      })

    const editorial = promptFor("Editorial", "/packs/editorial")
    const engineering = promptFor("Engineering", "/packs/engineering")
    expect(editorial).toMatch(/^Use \/editorial-[a-f0-9]{8}:review$/)
    expect(engineering).toMatch(/^Use \/engineering-[a-f0-9]{8}:review$/)
    expect(editorial).not.toBe(engineering)
  })

  it("does not fall back to an unqualified skill command", () => {
    expect(() =>
      claudePrompt({
        threadId: "thread-1",
        turnId: "turn-1",
        projectPath: "/repo",
        prompt: "Use $review",
        references: [
          {
            kind: "skill",
            name: "review",
            path: "/detached/review/SKILL.md",
          },
        ],
        executionProfile: {
          modelId: null,
          effort: null,
          permissionMode: "approval-required",
        },
        customization: {
          skillRoots: [{ name: "Reviews", path: "/packs" }],
        },
      })
    ).toThrow("outside the active Pack roots")
  })

  it("uses the most specific Pack root for nested imports", () => {
    expect(
      claudePrompt({
        threadId: "thread-1",
        turnId: "turn-1",
        projectPath: "/repo",
        prompt: "Use $review",
        references: [
          {
            kind: "skill",
            name: "review",
            path: "/packs/nested/skills/review/SKILL.md",
          },
        ],
        executionProfile: {
          modelId: null,
          effort: null,
          permissionMode: "approval-required",
        },
        customization: {
          skillRoots: [
            { name: "Outer", path: "/packs" },
            { name: "Nested", path: "/packs/nested/skills" },
          ],
        },
      })
    ).toMatch(/^Use \/nested-[a-f0-9]{8}:review$/)
  })
})

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
    expect(
      claudeActivity(
        "t4",
        "NotebookEdit",
        { notebook_path: "analysis.ipynb" },
        undefined
      )
    ).toEqual({
      id: "t4",
      name: "Edit notebook",
      detail: "analysis.ipynb",
      payload: {
        kind: "file-change",
        files: [{ path: "analysis.ipynb" }],
      },
    })
  })

  it.each(["Agent", "Task"])(
    "turns the %s tool into a subagent and links children to it",
    (toolName) => {
      expect(
        claudeActivity(
          "task-1",
          toolName,
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
    }
  )

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
    const message = sdkMessage({
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
    })

    expect(claudeAssistantFailure(message)).toEqual({
      kind: "usage-limit",
      message: "You've hit your session limit · resets 6:30pm (Europe/Warsaw)",
    })
  })

  it("ignores ordinary assistant messages", () => {
    const message = sdkMessage({
      type: "assistant",
      message: { content: [{ type: "text", text: "Done" }] },
    })

    expect(claudeAssistantFailure(message)).toBeUndefined()
  })
})

describe("ClaudeAdapter", () => {
  it("sends text and images as Claude user content", async () => {
    queryMock.mockReturnValue(fakeQuery([]))
    const session = await new ClaudeAdapter({ queryFactory: queryMock }).start(
      {
        threadId: "thread-1",
        turnId: "turn-1",
        projectPath: "/tmp/project",
        prompt: "What is shown?",
        references: [],
        attachments: [
          {
            type: "image",
            name: "screen.png",
            mimeType: "image/png",
            dataUrl: "data:image/png;base64,cG5n",
          },
        ],
        executionProfile: {
          modelId: null,
          effort: null,
          permissionMode: "approval-required",
        },
        customization: { skillRoots: [] },
      },
      new AbortController().signal
    )

    const prompt = queryMock.mock.calls[0]?.[0].prompt
    expect(prompt).not.toBeTypeOf("string")
    const messages = []
    // SAFETY: the assertion above proves image inputs select the SDK's async
    // user-message prompt form rather than its string form.
    const asyncPrompt = prompt as AsyncIterable<SDKUserMessage>
    for await (const message of asyncPrompt) messages.push(message)
    expect(messages[0]?.message.content).toEqual([
      { type: "text", text: "What is shown?" },
      {
        type: "image",
        source: { type: "base64", media_type: "image/png", data: "cG5n" },
      },
    ])
    await session.cancel()
  })

  it("emits only the usage-limit failure when Claude later reports success", async () => {
    queryMock.mockReturnValue(
      fakeQuery([
        sdkMessage({
          type: "assistant",
          error: "rate_limit",
          message: {
            model: "claude-test",
            usage: emptyAssistantUsage,
            content: [
              {
                type: "text",
                text: "You've hit your session limit",
              },
            ],
          },
        }),
        sdkMessage({
          type: "result",
          subtype: "success",
          modelUsage: {},
        }),
      ])
    )

    const session = await new ClaudeAdapter({ queryFactory: queryMock }).start(
      {
        threadId: "thread-1",
        turnId: "turn-1",
        projectPath: "/tmp/project",
        prompt: "Continue",
        references: [],
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
        sdkMessage({
          type: "assistant",
          parent_tool_use_id: null,
          message: {
            model: "claude-test",
            usage: emptyAssistantUsage,
            content: [
              {
                type: "tool_use",
                id: "todo-1",
                name: "TodoWrite",
                input: { todos: [{ content: "Research", status: "pending" }] },
              },
            ],
          },
        }),
        sdkMessage({
          type: "assistant",
          parent_tool_use_id: null,
          message: {
            model: "claude-test",
            usage: emptyAssistantUsage,
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
        }),
        sdkMessage({
          type: "result",
          subtype: "success",
          modelUsage: {},
        }),
      ])
    )

    const session = await new ClaudeAdapter({ queryFactory: queryMock }).start(
      {
        threadId: "thread-1",
        turnId: "turn-1",
        projectPath: "/tmp/project",
        prompt: "Continue",
        references: [],
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

  it("registers the TaskCreated hook the task plan needs to bind ids", async () => {
    queryMock.mockReturnValue(
      fakeQuery([
        sdkMessage({
          type: "result",
          subtype: "success",
          modelUsage: {},
        }),
      ])
    )

    const session = await new ClaudeAdapter({ queryFactory: queryMock }).start(
      {
        threadId: "thread-1",
        turnId: "turn-1",
        projectPath: "/tmp/project",
        prompt: "Continue",
        references: [],
        executionProfile: {
          modelId: null,
          effort: null,
          permissionMode: "approval-required",
        },
        customization: { skillRoots: [] },
      },
      new AbortController().signal
    )
    for await (const _event of session.events) void _event

    const hook =
      queryMock.mock.calls[0]?.[0].options?.hooks?.TaskCreated?.[0]?.hooks?.[0]
    expect(hook).toBeTypeOf("function")
    // The CLI runs this for every created task; it must never stall the turn.
    await expect(
      hook?.(
        {
          hook_event_name: "TaskCreated",
          task_id: "5",
          task_subject: "Read the code",
          session_id: "session-1",
          transcript_path: "/tmp/transcript",
          cwd: "/tmp/project",
          permission_mode: "default",
        },
        "call-1",
        { signal: new AbortController().signal }
      )
    ).resolves.toEqual({ continue: true })
  })

  it("builds and clears the task-tool plan without tool rows", async () => {
    queryMock.mockReturnValue(
      fakeQuery([
        sdkMessage({
          type: "assistant",
          parent_tool_use_id: null,
          message: {
            model: "claude-test",
            usage: emptyAssistantUsage,
            content: [
              {
                type: "tool_use",
                id: "call-1",
                name: "TaskCreate",
                input: { subject: "Read the code", description: "Look" },
              },
            ],
          },
        }),
        sdkMessage({
          type: "user",
          message: {
            content: [
              {
                type: "tool_result",
                tool_use_id: "call-1",
                content: "Task #task-1 created successfully: Read the code",
              },
            ],
          },
        }),
        sdkMessage({
          type: "assistant",
          parent_tool_use_id: null,
          message: {
            model: "claude-test",
            usage: emptyAssistantUsage,
            content: [
              {
                type: "tool_use",
                id: "call-2",
                name: "TaskUpdate",
                input: { taskId: "task-1", status: "in_progress" },
              },
            ],
          },
        }),
        sdkMessage({
          type: "user",
          message: {
            content: [
              {
                type: "tool_result",
                tool_use_id: "call-2",
                content: JSON.stringify({ success: true, taskId: "task-1" }),
              },
            ],
          },
        }),
        sdkMessage({
          type: "assistant",
          parent_tool_use_id: null,
          message: {
            model: "claude-test",
            usage: emptyAssistantUsage,
            content: [
              {
                type: "tool_use",
                id: "call-3",
                name: "TaskUpdate",
                input: { taskId: "task-1", status: "deleted" },
              },
            ],
          },
        }),
        sdkMessage({
          type: "user",
          message: {
            content: [
              {
                type: "tool_result",
                tool_use_id: "call-3",
                content: JSON.stringify({ success: true, taskId: "task-1" }),
              },
            ],
          },
        }),
        sdkMessage({
          type: "result",
          subtype: "success",
          modelUsage: {},
        }),
      ])
    )

    const session = await new ClaudeAdapter({ queryFactory: queryMock }).start(
      {
        threadId: "thread-1",
        turnId: "turn-1",
        projectPath: "/tmp/project",
        prompt: "Continue",
        references: [],
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
            steps: [{ text: "Read the code", status: "pending" }],
          },
        },
      },
      {
        type: "activity.updated",
        update: {
          id: "claude-plan",
          payload: {
            kind: "plan",
            steps: [{ text: "Read the code", status: "active" }],
          },
        },
      },
      {
        type: "activity.updated",
        update: {
          id: "claude-plan",
          payload: { kind: "plan", steps: [] },
        },
      },
      { type: "turn.completed" },
    ])
  })

  it("keeps a subagent TodoWrite as an ordinary nested activity", async () => {
    queryMock.mockReturnValue(
      fakeQuery([
        sdkMessage({
          type: "assistant",
          parent_tool_use_id: "task-1",
          message: {
            model: "claude-test",
            usage: emptyAssistantUsage,
            content: [
              {
                type: "tool_use",
                id: "todo-child",
                name: "TodoWrite",
                input: { todos: [{ content: "Research", status: "pending" }] },
              },
            ],
          },
        }),
        sdkMessage({
          type: "result",
          subtype: "success",
          modelUsage: {},
        }),
      ])
    )

    const session = await new ClaudeAdapter({ queryFactory: queryMock }).start(
      {
        threadId: "thread-1",
        turnId: "turn-1",
        projectPath: "/tmp/project",
        prompt: "Continue",
        references: [],
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
          id: "todo-child",
          parentId: "task-1",
          name: "TodoWrite",
          payload: { kind: "tool", tool: "other" },
        },
      },
      { type: "turn.completed" },
    ])
  })

  it("keeps a Turn open when its first result precedes the background notification", async () => {
    queryMock.mockReturnValue(
      fakeQuery([
        sdkMessage({
          type: "assistant",
          parent_tool_use_id: null,
          message: {
            model: "claude-test",
            usage: emptyAssistantUsage,
            content: [
              {
                type: "tool_use",
                id: "agent-1",
                name: "Agent",
                input: {
                  description: "Research the repo",
                  subagent_type: "Explore",
                },
              },
            ],
          },
        }),
        sdkMessage({
          type: "system",
          subtype: "task_started",
          task_id: "task-1",
          tool_use_id: "agent-1",
          description: "Research the repo",
          subagent_type: "Explore",
        }),
        sdkMessage({
          type: "system",
          subtype: "background_tasks_changed",
          tasks: [
            {
              task_id: "task-1",
              task_type: "agent",
              description: "Research the repo",
            },
          ],
        }),
        sdkMessage({
          type: "user",
          parent_tool_use_id: null,
          message: {
            content: [
              {
                type: "tool_result",
                tool_use_id: "agent-1",
                content: "Agent launched in the background",
              },
            ],
          },
        }),
        // Claude reports the main response boundary while the agent is still
        // running. This must not become the Harness terminal event.
        sdkMessage({
          type: "result",
          subtype: "success",
          modelUsage: {},
        }),
        sdkMessage({
          type: "assistant",
          parent_tool_use_id: "agent-1",
          message: {
            content: [
              {
                type: "tool_use",
                id: "child-tool",
                name: "Bash",
                input: { command: "rg sources" },
              },
            ],
          },
        }),
        sdkMessage({
          type: "user",
          parent_tool_use_id: "agent-1",
          message: {
            content: [
              {
                type: "tool_result",
                tool_use_id: "child-tool",
                content: "Done",
              },
            ],
          },
        }),
        sdkMessage({
          type: "system",
          subtype: "task_notification",
          task_id: "task-1",
          tool_use_id: "agent-1",
          status: "completed",
          summary: "Research complete",
        }),
        sdkMessage({
          type: "system",
          subtype: "background_tasks_changed",
          tasks: [],
        }),
        // A completed background task can cause Claude to produce a final
        // response. Only this result closes the product Turn.
        sdkMessage({
          type: "result",
          subtype: "success",
          modelUsage: {},
        }),
      ])
    )

    const session = await new ClaudeAdapter({ queryFactory: queryMock }).start(
      {
        threadId: "thread-1",
        turnId: "turn-1",
        projectPath: "/tmp/project",
        prompt: "Continue",
        references: [],
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
          id: "agent-1",
          name: "Research the repo",
          detail: "Explore",
          payload: { kind: "subagent", agentType: "Explore" },
        },
      },
      {
        type: "activity.started",
        activity: {
          id: "child-tool",
          parentId: "agent-1",
          name: "Run command",
          detail: "rg sources",
          payload: { kind: "tool", tool: "command" },
        },
      },
      {
        type: "activity.completed",
        id: "child-tool",
        outcome: "completed",
      },
      {
        type: "activity.completed",
        id: "agent-1",
        outcome: "completed",
      },
      { type: "turn.completed" },
    ])
  })

  it("uses the background task level when the start edge is missing", async () => {
    queryMock.mockReturnValue(
      fakeQuery([
        sdkMessage({
          type: "system",
          subtype: "background_tasks_changed",
          tasks: [
            {
              task_id: "task-1",
              task_type: "agent",
              description: "Write the report",
            },
          ],
        }),
        sdkMessage({
          type: "result",
          subtype: "success",
          modelUsage: {},
        }),
        sdkMessage({
          type: "assistant",
          parent_tool_use_id: null,
          message: {
            model: "claude-test",
            usage: emptyAssistantUsage,
            content: [
              {
                type: "tool_use",
                id: "verify-1",
                name: "Bash",
                input: { command: "test -f report.pdf" },
              },
            ],
          },
        }),
        sdkMessage({
          type: "user",
          parent_tool_use_id: null,
          message: {
            content: [
              {
                type: "tool_result",
                tool_use_id: "verify-1",
                content: "Report exists",
              },
            ],
          },
        }),
        sdkMessage({
          type: "system",
          subtype: "background_tasks_changed",
          tasks: [],
        }),
        sdkMessage({
          type: "result",
          subtype: "success",
          modelUsage: {},
        }),
      ])
    )

    const session = await new ClaudeAdapter({ queryFactory: queryMock }).start(
      {
        threadId: "thread-1",
        turnId: "turn-1",
        projectPath: "/tmp/project",
        prompt: "Continue",
        references: [],
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
          id: "verify-1",
          name: "Run command",
          detail: "test -f report.pdf",
          payload: { kind: "tool", tool: "command" },
        },
      },
      {
        type: "activity.completed",
        id: "verify-1",
        outcome: "completed",
      },
      { type: "turn.completed" },
    ])
  })

  it("uses an empty background task level when the notification is missing", async () => {
    queryMock.mockReturnValue(
      fakeQuery([
        sdkMessage({
          type: "assistant",
          parent_tool_use_id: null,
          message: {
            model: "claude-test",
            usage: emptyAssistantUsage,
            content: [
              {
                type: "tool_use",
                id: "agent-1",
                name: "Agent",
                input: { description: "Write the report" },
              },
            ],
          },
        }),
        sdkMessage({
          type: "system",
          subtype: "task_started",
          task_id: "task-1",
          tool_use_id: "agent-1",
          description: "Write the report",
        }),
        sdkMessage({
          type: "system",
          subtype: "background_tasks_changed",
          tasks: [
            {
              task_id: "task-1",
              task_type: "agent",
              description: "Write the report",
            },
          ],
        }),
        sdkMessage({
          type: "result",
          subtype: "success",
          modelUsage: {},
        }),
        sdkMessage({
          type: "system",
          subtype: "background_tasks_changed",
          tasks: [],
        }),
      ])
    )

    const session = await new ClaudeAdapter({ queryFactory: queryMock }).start(
      {
        threadId: "thread-1",
        turnId: "turn-1",
        projectPath: "/tmp/project",
        prompt: "Continue",
        references: [],
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
          id: "agent-1",
          name: "Write the report",
          payload: { kind: "subagent" },
        },
      },
      { type: "turn.completed" },
    ])
  })

  it("ends with a terminal event when the last background task level is stale", async () => {
    queryMock.mockReturnValue(
      fakeQuery([
        sdkMessage({
          type: "system",
          subtype: "background_tasks_changed",
          tasks: [
            {
              task_id: "task-1",
              task_type: "agent",
              description: "Write the report",
            },
          ],
        }),
        sdkMessage({
          type: "result",
          subtype: "success",
          modelUsage: {},
        }),
      ])
    )

    const session = await new ClaudeAdapter({ queryFactory: queryMock }).start(
      {
        threadId: "thread-1",
        turnId: "turn-1",
        projectPath: "/tmp/project",
        prompt: "Continue",
        references: [],
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

    expect(events.at(-1)).toEqual({ type: "turn.completed" })
  })

  it("does not let an ambient background task hold the Turn open", async () => {
    queryMock.mockReturnValue(
      fakeQuery([
        sdkMessage({
          type: "system",
          subtype: "background_tasks_changed",
          tasks: [
            {
              task_id: "ambient-1",
              task_type: "housekeeping",
              description: "Refresh project metadata",
            },
          ],
        }),
        sdkMessage({
          type: "system",
          subtype: "task_started",
          task_id: "ambient-1",
          description: "Refresh project metadata",
          skip_transcript: true,
        }),
        sdkMessage({
          type: "result",
          subtype: "success",
          modelUsage: {},
        }),
      ])
    )

    const session = await new ClaudeAdapter({ queryFactory: queryMock }).start(
      {
        threadId: "thread-1",
        turnId: "turn-1",
        projectPath: "/tmp/project",
        prompt: "Continue",
        references: [],
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

    expect(events).toEqual([{ type: "turn.completed" }])
  })

  it("holds success when a start edge follows an earlier empty level", async () => {
    queryMock.mockReturnValue(
      fakeQuery([
        sdkMessage({
          type: "system",
          subtype: "background_tasks_changed",
          tasks: [],
        }),
        sdkMessage({
          type: "assistant",
          parent_tool_use_id: null,
          message: {
            model: "claude-test",
            usage: emptyAssistantUsage,
            content: [
              {
                type: "tool_use",
                id: "agent-1",
                name: "Agent",
                input: { description: "Write the report" },
              },
            ],
          },
        }),
        sdkMessage({
          type: "system",
          subtype: "task_started",
          task_id: "task-1",
          tool_use_id: "agent-1",
          description: "Write the report",
        }),
        sdkMessage({
          type: "result",
          subtype: "success",
          modelUsage: {},
        }),
        sdkMessage({
          type: "system",
          subtype: "background_tasks_changed",
          tasks: [
            {
              task_id: "task-1",
              task_type: "agent",
              description: "Write the report",
            },
          ],
        }),
        sdkMessage({
          type: "system",
          subtype: "task_notification",
          task_id: "task-1",
          tool_use_id: "agent-1",
          status: "completed",
          summary: "Report written",
        }),
        sdkMessage({
          type: "system",
          subtype: "background_tasks_changed",
          tasks: [],
        }),
        sdkMessage({
          type: "result",
          subtype: "success",
          modelUsage: {},
        }),
      ])
    )

    const session = await new ClaudeAdapter({ queryFactory: queryMock }).start(
      {
        threadId: "thread-1",
        turnId: "turn-1",
        projectPath: "/tmp/project",
        prompt: "Continue",
        references: [],
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
          id: "agent-1",
          name: "Write the report",
          payload: { kind: "subagent" },
        },
      },
      {
        type: "activity.completed",
        id: "agent-1",
        outcome: "completed",
      },
      { type: "turn.completed" },
    ])
  })

  it("releases a pending success when the query ends after the notification", async () => {
    queryMock.mockReturnValue(
      fakeQuery([
        sdkMessage({
          type: "assistant",
          parent_tool_use_id: null,
          message: {
            model: "claude-test",
            usage: emptyAssistantUsage,
            content: [
              {
                type: "tool_use",
                id: "agent-1",
                name: "Agent",
                input: { description: "Write the report" },
              },
            ],
          },
        }),
        sdkMessage({
          type: "system",
          subtype: "task_started",
          task_id: "task-1",
          tool_use_id: "agent-1",
          description: "Write the report",
        }),
        sdkMessage({
          type: "result",
          subtype: "success",
          modelUsage: {},
        }),
        sdkMessage({
          type: "system",
          subtype: "task_notification",
          task_id: "task-1",
          tool_use_id: "agent-1",
          status: "completed",
          summary: "Report written",
        }),
      ])
    )

    const session = await new ClaudeAdapter({ queryFactory: queryMock }).start(
      {
        threadId: "thread-1",
        turnId: "turn-1",
        projectPath: "/tmp/project",
        prompt: "Continue",
        references: [],
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
          id: "agent-1",
          name: "Write the report",
          payload: { kind: "subagent" },
        },
      },
      {
        type: "activity.completed",
        id: "agent-1",
        outcome: "completed",
      },
      { type: "turn.completed" },
    ])
  })

  it("uses task notifications as the terminal edge for background tools", async () => {
    queryMock.mockReturnValue(
      fakeQuery([
        sdkMessage({
          type: "assistant",
          parent_tool_use_id: null,
          message: {
            model: "claude-test",
            usage: emptyAssistantUsage,
            content: [
              {
                type: "tool_use",
                id: "bash-1",
                name: "Bash",
                input: { command: "pnpm test" },
              },
            ],
          },
        }),
        sdkMessage({
          type: "system",
          subtype: "task_started",
          task_id: "task-1",
          tool_use_id: "bash-1",
          description: "Run tests",
          task_type: "shell",
        }),
        sdkMessage({
          type: "user",
          parent_tool_use_id: null,
          message: {
            content: [
              {
                type: "tool_result",
                tool_use_id: "bash-1",
                content: "Command running in the background",
              },
            ],
          },
        }),
        sdkMessage({
          type: "system",
          subtype: "task_notification",
          task_id: "task-1",
          tool_use_id: "bash-1",
          status: "failed",
          summary: "Tests failed",
        }),
        sdkMessage({
          type: "result",
          subtype: "success",
          modelUsage: {},
        }),
      ])
    )

    const session = await new ClaudeAdapter({ queryFactory: queryMock }).start(
      {
        threadId: "thread-1",
        turnId: "turn-1",
        projectPath: "/tmp/project",
        prompt: "Continue",
        references: [],
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
          id: "bash-1",
          name: "Run command",
          detail: "pnpm test",
          payload: { kind: "tool", tool: "command" },
        },
      },
      {
        type: "activity.completed",
        id: "bash-1",
        outcome: "failed",
      },
      { type: "turn.completed" },
    ])
  })
})

function sdkMessage(
  message: { type: SDKMessage["type"] } & Record<string, JsonValue>
): SDKMessage {
  // SAFETY: These fixtures include every field read by the adapter for their
  // discriminant and are consumed only by the in-process fake query.
  return message as SDKMessage
}

function fakeQuery(messages: SDKMessage[]): ClaudeQuery {
  return {
    async *[Symbol.asyncIterator]() {
      yield* messages
    },
    close: vi.fn(),
    interrupt: vi.fn(() => Promise.resolve(undefined)),
    supportedModels: vi.fn(() => Promise.resolve([])),
    getContextUsage: vi.fn(() => Promise.reject(new Error("Not available"))),
  }
}

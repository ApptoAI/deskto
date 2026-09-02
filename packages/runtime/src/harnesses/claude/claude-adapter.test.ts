import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type {
  AccountInfo,
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk"
import { AsyncQueue, type HarnessEvent } from "@deskto/harness-sdk"
import type { JsonValue } from "@deskto/protocol"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { threadTitlePrompt } from "../../thread-title-generator.js"
import {
  ClaudeAdapter,
  claudeAccountSignedIn,
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

describe("Claude session forks", () => {
  it("forks rather than mutating the resumed session", async () => {
    queryMock.mockReturnValue(fakeQuery([]))
    await new ClaudeAdapter({ queryFactory: queryMock }).start(
      {
        threadId: "side-1",
        turnId: "turn-1",
        projectPath: "/tmp/project",
        prompt: "Side question",
        references: [],
        executionProfile: {
          modelId: null,
          effort: null,
          permissionMode: "approval-required",
        },
        customization: { skillRoots: [] },
        providerSessionId: "session-main",
        forkProviderSession: true,
      },
      new AbortController().signal
    )

    expect(queryMock.mock.calls[0]?.[0]?.options).toMatchObject({
      resume: "session-main",
      forkSession: true,
    })
  })
})

describe("Claude MCP provisioning", () => {
  it("passes a turn-scoped HTTP server directly to the SDK", async () => {
    queryMock.mockReturnValue(fakeQuery([]))
    await new ClaudeAdapter({ queryFactory: queryMock }).start(
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
        customization: {
          skillRoots: [],
          mcpServers: [
            {
              id: "deskto",
              url: "http://127.0.0.1:4321/mcp",
              authorization: { type: "bearer", token: "secret-token" },
            },
          ],
        },
      },
      new AbortController().signal
    )

    expect(queryMock.mock.calls[0]?.[0]?.options?.mcpServers).toEqual({
      deskto: {
        type: "http",
        url: "http://127.0.0.1:4321/mcp",
        headers: { Authorization: "Bearer secret-token" },
      },
    })
  })

  it("loads host artifact skills alongside the dependency loader", async () => {
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "deskto-claude-artifacts-")
    )
    try {
      queryMock.mockReturnValue(fakeQuery([]))
      await new ClaudeAdapter({
        queryFactory: queryMock,
        packShimsPath: join(temporaryRoot, "shims"),
        hostSkillRoots: [
          {
            id: "artifact-runtime-spreadsheets",
            name: "Artifact runtime spreadsheets",
            path: join(temporaryRoot, "runtime", "spreadsheets", "skills"),
          },
        ],
      }).start(
        {
          threadId: "thread-1",
          turnId: "turn-1",
          projectPath: "/tmp/project",
          prompt: "Create a spreadsheet",
          references: [],
          executionProfile: {
            modelId: null,
            effort: null,
            permissionMode: "approval-required",
          },
          customization: {
            skillRoots: [],
            mcpServers: [
              {
                id: "deskto",
                url: "http://127.0.0.1:4321/mcp",
                authorization: { type: "bearer", token: "secret-token" },
              },
            ],
          },
        },
        new AbortController().signal
      )

      expect(queryMock.mock.calls[0]?.[0]?.options?.plugins).toHaveLength(1)
      expect(queryMock.mock.calls[0]?.[0]?.options?.mcpServers).toHaveProperty(
        "deskto"
      )
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true })
    }
  })
})

describe("Claude Project instructions", () => {
  it("appends shared instructions to the Claude Code system prompt", async () => {
    queryMock.mockReturnValue(fakeQuery([]))
    await new ClaudeAdapter({ queryFactory: queryMock }).start(
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
        customization: {
          skillRoots: [],
          instructions: "Use the approved client terminology.",
        },
      },
      new AbortController().signal
    )

    expect(queryMock.mock.calls[0]?.[0]?.options?.systemPrompt).toEqual({
      type: "preset",
      preset: "claude_code",
      append: "Use the approved client terminology.",
    })
  })
})

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
            origin: "pack",
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

  it("keeps a skill from Claude's own folder as its plain command", () => {
    expect(
      claudePrompt({
        threadId: "thread-1",
        turnId: "turn-1",
        projectPath: "/repo",
        prompt: "Use $animate here",
        references: [
          {
            kind: "skill",
            origin: "native",
            name: "animate",
            path: "/home/user/.claude/skills/animate/SKILL.md",
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
    ).toBe("Use /animate here")
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
            origin: "pack",
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
            origin: "pack",
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
            origin: "pack",
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
            origin: "pack",
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

describe("Claude MCP configuration", () => {
  it("passes Runtime-provided HTTP tools to the Agent SDK", async () => {
    queryMock.mockReturnValue(fakeQuery([]))
    await new ClaudeAdapter({ queryFactory: queryMock }).start(
      {
        threadId: "thread-1",
        turnId: "turn-1",
        projectPath: "/repo",
        prompt: "Check the app",
        references: [],
        executionProfile: {
          modelId: null,
          effort: null,
          permissionMode: "approval-required",
        },
        customization: {
          skillRoots: [],
          mcpServers: [
            {
              id: "deskto_browser",
              url: "http://127.0.0.1:4312/mcp",
              authorization: { type: "bearer", token: "secret-token" },
            },
          ],
        },
      },
      new AbortController().signal
    )

    expect(queryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          mcpServers: {
            deskto_browser: {
              type: "http",
              url: "http://127.0.0.1:4312/mcp",
              headers: { Authorization: "Bearer secret-token" },
            },
          },
        }),
      })
    )
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
  it("generates a title from the complete title prompt", async () => {
    const prompt = threadTitlePrompt("Review the renewal pipeline")
    queryMock.mockReturnValue(
      fakeQuery([
        sdkMessage({
          type: "stream_event",
          parent_tool_use_id: null,
          event: {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: "Renewal pipeline review" },
          },
        }),
        sdkMessage({
          type: "result",
          subtype: "success",
          modelUsage: {},
        }),
      ])
    )

    await expect(
      new ClaudeAdapter({ queryFactory: queryMock }).generateText(
        {
          projectPath: "/tmp/project",
          prompt,
          executionProfile: {
            modelId: null,
            effort: null,
            permissionMode: "approval-required",
          },
        },
        new AbortController().signal
      )
    ).resolves.toBe("Renewal pipeline review")
    const input = queryMock.mock.calls[0]?.[0].prompt
    expect(input).not.toBeTypeOf("string")
    // SAFETY: the assertion above proves sessions use the SDK's async
    // user-message prompt form.
    const iterator = (input as AsyncIterable<SDKUserMessage>)[
      Symbol.asyncIterator
    ]()
    await expect(iterator.next()).resolves.toMatchObject({
      value: { message: { content: [{ type: "text", text: prompt }] } },
    })
  })

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

  it("queues and steers through Claude's live input stream", async () => {
    const output = new AsyncQueue<SDKMessage>()
    const query = fakeQuery([])
    query[Symbol.asyncIterator] = () => output[Symbol.asyncIterator]()
    queryMock.mockReturnValue(query)
    const adapter = new ClaudeAdapter({ queryFactory: queryMock })

    expect(adapter.descriptor.followUps).toEqual({ queue: true, steer: true })
    const session = await adapter.start(
      {
        threadId: "thread-1",
        turnId: "3bca8cf5-1d29-4ce2-bd31-dfa05c4c5038",
        projectPath: "/tmp/project",
        prompt: "First request",
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
    const prompt = queryMock.mock.calls[0]?.[0].prompt
    expect(prompt).not.toBeTypeOf("string")
    // SAFETY: the assertion above proves live sessions use the SDK's async
    // user-message prompt form.
    const input = (prompt as AsyncIterable<SDKUserMessage>)[
      Symbol.asyncIterator
    ]()

    await expect(input.next()).resolves.toMatchObject({
      value: {
        uuid: "3bca8cf5-1d29-4ce2-bd31-dfa05c4c5038",
        message: { content: [{ type: "text", text: "First request" }] },
      },
    })
    await session.queue({
      id: "420c410d-503f-4b6a-92ff-68db71c33d62",
      prompt: "After this",
      references: [],
      attachments: [],
    })
    await expect(input.next()).resolves.toMatchObject({
      value: {
        uuid: "420c410d-503f-4b6a-92ff-68db71c33d62",
        priority: "later",
        message: { content: [{ type: "text", text: "After this" }] },
      },
    })
    await session.steer({
      id: "adc030b1-63e0-4bf8-a8b0-3a6f433971a4",
      prompt: "Change course",
      references: [],
      attachments: [
        {
          type: "image",
          name: "direction.png",
          mimeType: "image/png",
          dataUrl: "data:image/png;base64,cG5n",
        },
      ],
    })
    await expect(input.next()).resolves.toMatchObject({
      value: {
        uuid: "adc030b1-63e0-4bf8-a8b0-3a6f433971a4",
        priority: "now",
        message: {
          content: [
            { type: "text", text: "Change course" },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: "cG5n",
              },
            },
          ],
        },
      },
    })
    expect(query.interrupt).toHaveBeenCalledOnce()

    const result = sdkMessage({
      type: "result",
      subtype: "success",
      modelUsage: {},
    })
    output.push(result)
    output.push(result)
    output.push(result)
    const events = session.events[Symbol.asyncIterator]()
    await expect(events.next()).resolves.toMatchObject({
      value: { type: "turn.completed" },
    })
    await expect(
      session.steer({
        id: "80f6c52f-2ad0-481d-912f-f842a9aba34c",
        prompt: "Too late",
        references: [],
        attachments: [],
      })
    ).rejects.toThrow("no longer running")
    output.close()
    await expect(events.next()).resolves.toMatchObject({ done: true })
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
          type: "stream_event",
          parent_tool_use_id: "task-1",
          event: {
            type: "content_block_start",
            index: 0,
            content_block: {
              type: "tool_use",
              id: "todo-child",
              name: "TodoWrite",
              input: {},
            },
          },
        }),
        sdkMessage({
          type: "stream_event",
          parent_tool_use_id: "task-1",
          event: {
            type: "content_block_delta",
            index: 0,
            delta: { type: "input_json_delta", partial_json: '{"todos"' },
          },
        }),
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
      {
        type: "progress.updated",
        progress: {
          stage: "preparing-tool",
          label: "Preparing todowrite",
        },
      },
      {
        type: "progress.updated",
        progress: {
          stage: "preparing-tool",
          label: "Preparing todowrite",
        },
      },
      {
        type: "activity.updated",
        update: {
          id: "todo-child",
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

describe("Claude live progress", () => {
  it("starts a tool row before its streamed input has finished", async () => {
    queryMock.mockReturnValue(
      fakeQuery([
        sdkMessage({
          type: "stream_event",
          parent_tool_use_id: null,
          event: {
            type: "content_block_start",
            index: 0,
            content_block: {
              type: "tool_use",
              id: "bash-1",
              name: "Bash",
              input: {},
            },
          },
        }),
        sdkMessage({
          type: "stream_event",
          parent_tool_use_id: null,
          event: {
            type: "content_block_delta",
            index: 0,
            delta: { type: "input_json_delta", partial_json: '{"command"' },
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
                id: "bash-1",
                name: "Bash",
                input: { command: "echo ready" },
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
                tool_use_id: "bash-1",
                content: "ready",
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
        prompt: "Write the file",
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

    expect(events.slice(0, 4)).toEqual([
      {
        type: "activity.started",
        activity: {
          id: "bash-1",
          name: "Run command",
          payload: { kind: "tool", tool: "command" },
        },
      },
      {
        type: "progress.updated",
        progress: { stage: "preparing-tool", label: "Preparing command" },
      },
      {
        type: "progress.updated",
        progress: { stage: "preparing-tool", label: "Preparing command" },
      },
      {
        type: "activity.updated",
        update: {
          id: "bash-1",
          name: "Run command",
          detail: "echo ready",
          payload: { kind: "tool", tool: "command" },
        },
      },
    ])
    expect(
      events.filter((event) => event.type === "activity.started")
    ).toHaveLength(1)
    expect(events.at(-1)).toEqual({ type: "turn.completed" })
  })

  it("keeps streamed tool preparation live inside a subagent", async () => {
    queryMock.mockReturnValue(
      fakeQuery([
        sdkMessage({
          type: "stream_event",
          parent_tool_use_id: "agent-1",
          event: {
            type: "content_block_start",
            index: 0,
            content_block: {
              type: "tool_use",
              id: "write-1",
              name: "Write",
              input: {},
            },
          },
        }),
        sdkMessage({
          type: "stream_event",
          parent_tool_use_id: "agent-1",
          event: {
            type: "content_block_delta",
            index: 0,
            delta: {
              type: "input_json_delta",
              partial_json: '{"file_path"',
            },
          },
        }),
        sdkMessage({
          type: "assistant",
          parent_tool_use_id: "agent-1",
          message: {
            model: "claude-test",
            usage: emptyAssistantUsage,
            content: [
              {
                type: "tool_use",
                id: "write-1",
                name: "Write",
                input: { file_path: "report.md", content: "Ready" },
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
                tool_use_id: "write-1",
                content: "Saved",
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
        prompt: "Delegate the report",
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

    expect(
      events.filter(
        (event) =>
          event.type === "progress.updated" &&
          event.progress.stage === "preparing-tool" &&
          event.progress.label === "Preparing file change"
      )
    ).toHaveLength(2)
    expect(events).toContainEqual({
      type: "activity.updated",
      update: {
        id: "write-1",
        name: "Write file",
        detail: "report.md",
        payload: {
          kind: "file-change",
          files: [{ path: "report.md" }],
        },
      },
    })
  })

  it("turns private thinking deltas into liveness only", async () => {
    queryMock.mockReturnValue(
      fakeQuery([
        sdkMessage({
          type: "stream_event",
          parent_tool_use_id: null,
          event: {
            type: "content_block_delta",
            index: 0,
            delta: { type: "thinking_delta", thinking: "private" },
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
        prompt: "Think",
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
        type: "progress.updated",
        progress: { stage: "thinking", label: "Thinking" },
      },
      { type: "turn.completed" },
    ])
    expect(JSON.stringify(events)).not.toContain("private")
  })
})

function sdkMessage(
  message: { type: SDKMessage["type"] } & Record<string, JsonValue>
): SDKMessage {
  // SAFETY: These fixtures include every field read by the adapter for their
  // discriminant and are consumed only by the in-process fake query.
  return message as SDKMessage
}

describe("Claude availability", () => {
  async function availability(accountInfo: () => Promise<AccountInfo>) {
    const fake = fakeQuery([], accountInfo)
    queryMock.mockReturnValue(fake)
    const result = await new ClaudeAdapter({
      queryFactory: queryMock,
    }).checkAvailability()
    return { result, fake }
  }

  it("reports available for an OAuth login", async () => {
    const { result } = await availability(() =>
      Promise.resolve({ email: "dev@example.com", apiProvider: "firstParty" })
    )
    expect(result).toEqual({ status: "available" })
  })

  it("runs account discovery outside the inherited launch directory", async () => {
    queryMock.mockReturnValue(
      fakeQuery([], () =>
        Promise.resolve({ email: "dev@example.com", apiProvider: "firstParty" })
      )
    )

    await new ClaudeAdapter({
      discoveryCwd: "/app-data/harness-discovery",
      queryFactory: queryMock,
    }).checkAvailability()

    expect(queryMock.mock.calls[0]?.[0]?.options?.cwd).toBe(
      "/app-data/harness-discovery"
    )
  })

  it("reports available for an API key", async () => {
    const { result } = await availability(() =>
      Promise.resolve({ apiKeySource: "user" })
    )
    expect(result).toEqual({ status: "available" })
  })

  it("trusts third-party providers to authenticate externally", async () => {
    const { result } = await availability(() =>
      Promise.resolve({ apiProvider: "bedrock" })
    )
    expect(result).toEqual({ status: "available" })
  })

  it("reports a signed-out first-party CLI as unavailable", async () => {
    const { result } = await availability(() =>
      Promise.resolve({ apiProvider: "firstParty" })
    )
    expect(result).toMatchObject({ status: "unavailable" })
    if (result.status === "unavailable") {
      expect(result.reason).toContain("not signed in")
    }
  })

  it("reports an empty account as unavailable", async () => {
    const { result } = await availability(() => Promise.resolve({}))
    expect(result).toMatchObject({ status: "unavailable" })
  })

  it("requires sign-in when the CLI cannot confirm an account", async () => {
    const { result } = await availability(() =>
      Promise.reject(new Error("Unknown control request"))
    )
    expect(result).toEqual({
      status: "unavailable",
      reason:
        "Claude Code could not verify your account. Open Terminal, run `claude`, and confirm that it works, then try again.",
    })
  })

  it("closes a discovery query that exceeds the availability deadline", async () => {
    const fake = fakeQuery([], () => new Promise<AccountInfo>(() => {}))
    queryMock.mockReturnValue(fake)

    await expect(
      new ClaudeAdapter({
        availabilityDeadlineMs: 5,
        queryFactory: queryMock,
      }).checkAvailability()
    ).resolves.toEqual({
      status: "unavailable",
      reason:
        "Claude Code could not verify your account. Open Terminal, run `claude`, and confirm that it works, then try again.",
    })
    expect(fake.close).toHaveBeenCalledOnce()
  })

  it("closes the discovery query on every path", async () => {
    const signedIn = await availability(() => Promise.resolve({}))
    expect(signedIn.fake.close).toHaveBeenCalled()
    const failed = await availability(() => Promise.reject(new Error("boom")))
    expect(failed.fake.close).toHaveBeenCalled()
  })
})

describe("Claude startup", () => {
  it("does not report a startup failure after cancellation", async () => {
    let endIterator = () => {}
    const iteratorDone = new Promise<IteratorResult<SDKMessage>>((resolve) => {
      endIterator = () => resolve({ done: true, value: undefined })
    })
    const query = fakeQuery([])
    query[Symbol.asyncIterator] = () => ({ next: () => iteratorDone })
    query.interrupt = vi.fn(() => {
      endIterator()
      return Promise.resolve(undefined)
    })
    queryMock.mockReturnValue(query)

    const session = await new ClaudeAdapter({
      queryFactory: queryMock,
      startupDeadlineMs: 1_000,
    }).start(
      {
        threadId: "thread-1",
        turnId: "turn-1",
        projectPath: "/tmp/project",
        prompt: "Hello",
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

    await session.cancel()
    const events: HarnessEvent[] = []
    for await (const event of session.events) events.push(event)

    expect(events).toEqual([])
    expect(query.close).toHaveBeenCalledOnce()
  })

  it("closes a silent cancelled stream at the startup deadline", async () => {
    const query = fakeQuery([])
    query[Symbol.asyncIterator] = () => ({
      next: () => new Promise<IteratorResult<SDKMessage>>(() => {}),
    })
    queryMock.mockReturnValue(query)

    const session = await new ClaudeAdapter({
      queryFactory: queryMock,
      startupDeadlineMs: 5,
    }).start(
      {
        threadId: "thread-1",
        turnId: "turn-1",
        projectPath: "/tmp/project",
        prompt: "Hello",
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

    await session.cancel()
    const events: HarnessEvent[] = []
    for await (const event of session.events) events.push(event)

    expect(events).toEqual([])
    expect(query.close).toHaveBeenCalledOnce()
  })

  it("fails with sign-in guidance when the CLI emits no messages", async () => {
    const query = fakeQuery([])
    query[Symbol.asyncIterator] = () => ({
      next: () => new Promise<IteratorResult<SDKMessage>>(() => {}),
    })
    query.close = vi.fn()
    query.interrupt = vi.fn(() => new Promise<never>(() => {}))
    queryMock.mockReturnValue(query)

    const session = await new ClaudeAdapter({
      queryFactory: queryMock,
      startupDeadlineMs: 1,
    }).start(
      {
        threadId: "thread-1",
        turnId: "turn-1",
        projectPath: "/tmp/project",
        prompt: "Hello",
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
          kind: "error",
          message:
            "Claude Code did not start. Open Terminal, run `claude`, and confirm that it is signed in, then try again.",
        },
      },
    ])
    expect(query.close).toHaveBeenCalled()
    await expect(session.cancel()).resolves.toBeUndefined()
    expect(query.interrupt).not.toHaveBeenCalled()
  })

  it("fails when the CLI closes before emitting its first message", async () => {
    queryMock.mockReturnValue(fakeQuery([]))

    const session = await new ClaudeAdapter({
      queryFactory: queryMock,
      startupDeadlineMs: 1_000,
    }).start(
      {
        threadId: "thread-1",
        turnId: "turn-1",
        projectPath: "/tmp/project",
        prompt: "Hello",
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
          kind: "error",
          message:
            "Claude Code did not start. Open Terminal, run `claude`, and confirm that it is signed in, then try again.",
        },
      },
    ])
  })
})

describe("claudeAccountSignedIn", () => {
  it("accepts a token source without an email", () => {
    expect(claudeAccountSignedIn({ tokenSource: "keychain" })).toBe(true)
  })

  it("ignores empty-string fields when a later field is set", () => {
    expect(claudeAccountSignedIn({ email: "", apiKeySource: "user" })).toBe(
      true
    )
  })

  it("rejects an account made only of empty strings", () => {
    expect(claudeAccountSignedIn({ email: "", tokenSource: "" })).toBe(false)
  })

  it("rejects a first-party account with no identity", () => {
    expect(claudeAccountSignedIn({ apiProvider: "firstParty" })).toBe(false)
  })
})

function fakeQuery(
  messages: SDKMessage[],
  accountInfo: () => Promise<AccountInfo> = () =>
    Promise.resolve({ email: "dev@example.com" })
): ClaudeQuery {
  return {
    async *[Symbol.asyncIterator]() {
      yield* messages
    },
    close: vi.fn(),
    interrupt: vi.fn(() => Promise.resolve(undefined)),
    supportedModels: vi.fn(() => Promise.resolve([])),
    getContextUsage: vi.fn(() => Promise.reject(new Error("Not available"))),
    accountInfo: vi.fn(accountInfo),
  }
}

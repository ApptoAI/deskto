import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { HarnessEvent, HarnessRunInput } from "@deskto/harness-sdk"
import type { JsonObject, JsonValue } from "@deskto/protocol"
import type { ZodType } from "zod"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  PiAdapter,
  piActivity,
  piLaunchArgs,
  piModels,
  piPromptCommand,
  type PiClient,
  type PiClientFactory,
} from "./pi-adapter.js"
import type { PiEvent } from "./pi-protocol.js"

const directories: string[] = []

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true }))
  )
})

// Lines recorded from `pi --mode rpc` 0.84.4 on 2026-09-02, trimmed to the
// fields the adapter reads.
const recordedRun: PiEvent[] = [
  { type: "agent_start" },
  { type: "turn_start" },
  {
    type: "message_update",
    assistantMessageEvent: {
      type: "thinking_delta",
      contentIndex: 0,
      delta: "…",
    },
  },
  {
    type: "message_update",
    assistantMessageEvent: {
      type: "text_delta",
      contentIndex: 1,
      delta: "Running ",
    },
  },
  {
    type: "message_update",
    assistantMessageEvent: {
      type: "toolcall_start",
      contentIndex: 2,
      id: "call_1",
      toolName: "bash",
    },
  },
  {
    type: "message_end",
    message: {
      role: "assistant",
      stopReason: "toolUse",
      usage: { input: 1124, output: 22, totalTokens: 1146 },
    },
  },
  {
    type: "tool_execution_start",
    toolCallId: "call_1",
    toolName: "bash",
    args: { command: "echo hello-deskto" },
  },
  {
    type: "tool_execution_end",
    toolCallId: "call_1",
    toolName: "bash",
    result: {},
    isError: false,
  },
  {
    type: "message_update",
    assistantMessageEvent: {
      type: "text_delta",
      contentIndex: 0,
      delta: "hello-deskto",
    },
  },
  {
    type: "message_end",
    message: {
      role: "assistant",
      stopReason: "stop",
      usage: { input: 1200, output: 8, totalTokens: 1208 },
    },
  },
  {
    type: "agent_end",
    messages: [
      { role: "user", content: [] },
      { role: "assistant", stopReason: "stop", usage: { totalTokens: 1208 } },
    ],
    willRetry: false,
  },
  { type: "agent_settled" },
]

class FakePiClient implements PiClient {
  readonly commands: JsonObject[] = []
  readonly sent: JsonObject[] = []
  closed = false
  #listener?: (event: PiEvent) => void
  #failure?: (error: Error) => void

  constructor(
    private readonly state: JsonObject = {
      sessionId: "session-1",
      model: {
        id: "gpt-5.6-sol",
        provider: "openai-codex",
        contextWindow: 272000,
      },
    }
  ) {}

  request<T extends JsonValue>(
    command: JsonObject,
    schema: ZodType<T>
  ): Promise<T> {
    this.commands.push(command)
    const data: JsonValue = command.type === "get_state" ? this.state : {}
    return Promise.resolve(schema.parse(data))
  }

  send(command: JsonObject): void {
    this.sent.push(command)
  }

  onEvent(listener: (event: PiEvent) => void) {
    this.#listener = listener
    return () => {}
  }

  onFailure(listener: (error: Error) => void) {
    this.#failure = listener
    return () => {}
  }

  close(): void {
    this.closed = true
  }

  emit(event: PiEvent): void {
    this.#listener?.(event)
  }

  fail(error: Error): void {
    this.#failure?.(error)
  }
}

function runInput(overrides: Partial<HarnessRunInput> = {}): HarnessRunInput {
  return {
    threadId: "thread-1",
    turnId: "turn-1",
    projectPath: "/tmp/project",
    prompt: "Say hello",
    references: [],
    executionProfile: {
      modelId: "openai-codex/gpt-5.6-sol",
      effort: "medium",
      permissionMode: "full-access",
    },
    customization: { skillRoots: [] },
    ...overrides,
  }
}

async function collect(events: AsyncIterable<HarnessEvent>) {
  const collected: HarnessEvent[] = []
  for await (const event of events) collected.push(event)
  return collected
}

async function tempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "deskto-pi-"))
  directories.push(directory)
  return directory
}

describe("Pi session", () => {
  it("translates a recorded run into Harness events", async () => {
    const client = new FakePiClient()
    const factory: PiClientFactory = () => client
    const adapter = new PiAdapter(factory, {
      extensionsPath: await tempDirectory(),
    })

    const session = await adapter.start(
      runInput(),
      new AbortController().signal
    )
    for (const event of recordedRun) client.emit(event)
    const events = await collect(session.events)

    expect(client.commands[0]).toEqual({ type: "get_state" })
    expect(client.commands[1]).toEqual({ type: "prompt", message: "Say hello" })
    expect(events).toEqual([
      { type: "session.started", providerSessionId: "session-1" },
      {
        type: "progress.updated",
        progress: { stage: "thinking", label: "Thinking" },
      },
      { type: "message.delta", text: "Running " },
      {
        type: "progress.updated",
        progress: { stage: "preparing-tool", label: "Run command" },
      },
      {
        type: "usage.updated",
        usage: { usedTokens: 1146, maxTokens: 272000 },
      },
      {
        type: "activity.started",
        activity: {
          id: "call_1",
          name: "Run command",
          detail: "echo hello-deskto",
          payload: { kind: "tool", tool: "command" },
        },
      },
      { type: "activity.completed", id: "call_1", outcome: "completed" },
      { type: "message.delta", text: "hello-deskto" },
      {
        type: "usage.updated",
        usage: { usedTokens: 1208, maxTokens: 272000 },
      },
      { type: "turn.completed" },
    ])
    expect(client.closed).toBe(true)
  })

  it("fails the turn with Pi's own message when the model errors", async () => {
    const client = new FakePiClient()
    const adapter = new PiAdapter(() => client, {
      extensionsPath: await tempDirectory(),
    })

    const session = await adapter.start(
      runInput(),
      new AbortController().signal
    )
    client.emit({
      type: "agent_end",
      messages: [
        {
          role: "assistant",
          stopReason: "error",
          errorMessage: "You have hit your usage limit",
        },
      ],
      willRetry: false,
    })
    const events = await collect(session.events)

    expect(events.at(-1)).toEqual({
      type: "turn.failed",
      failure: {
        kind: "usage-limit",
        message: "You have hit your usage limit",
      },
    })
  })

  it("fails the turn when the Pi process dies", async () => {
    const client = new FakePiClient()
    const adapter = new PiAdapter(() => client, {
      extensionsPath: await tempDirectory(),
    })

    const session = await adapter.start(
      runInput(),
      new AbortController().signal
    )
    client.fail(new Error("Pi exited (1): No API key for provider openai"))
    const events = await collect(session.events)

    expect(events.at(-1)).toEqual({
      type: "turn.failed",
      failure: {
        kind: "error",
        message: "Pi exited (1): No API key for provider openai",
      },
    })
  })

  it("aborts Pi on cancel without reporting a failure", async () => {
    const client = new FakePiClient()
    const adapter = new PiAdapter(() => client, {
      extensionsPath: await tempDirectory(),
    })

    const session = await adapter.start(
      runInput(),
      new AbortController().signal
    )
    await session.cancel()
    const events = await collect(session.events)

    expect(client.commands.at(-1)).toEqual({ type: "abort" })
    expect(events).toEqual([
      { type: "session.started", providerSessionId: "session-1" },
    ])
    expect(client.closed).toBe(true)
  })

  it("asks the person before a command in approval-required mode", async () => {
    const client = new FakePiClient()
    const extensionsPath = await tempDirectory()
    const adapter = new PiAdapter(() => client, { extensionsPath })

    const session = await adapter.start(
      runInput({
        executionProfile: {
          modelId: null,
          effort: null,
          permissionMode: "approval-required",
        },
      }),
      new AbortController().signal
    )
    const extension = join(extensionsPath, "deskto-approvals.mjs")
    await expect(readFile(extension, "utf8")).resolves.toContain("tool_call")

    client.emit({
      type: "extension_ui_request",
      id: "ui-1",
      method: "confirm",
      title: "deskto-approval:bash",
      message: "rm -rf build",
    })
    const iterator = session.events[Symbol.asyncIterator]()
    await iterator.next()
    const approval = await iterator.next()
    expect(approval.value).toMatchObject({
      type: "approval.requested",
      request: {
        kind: "command",
        title: "Allow this command?",
        detail: "rm -rf build",
      },
    })
    if (approval.value?.type !== "approval.requested")
      throw new Error("no approval")

    await session.respondToApproval(approval.value.request.id, "deny")
    expect(client.sent).toEqual([
      { type: "extension_ui_response", id: "ui-1", confirmed: false },
    ])
    await session.cancel()
  })

  it("dismisses dialogs raised by other extensions", async () => {
    const client = new FakePiClient()
    const adapter = new PiAdapter(() => client, {
      extensionsPath: await tempDirectory(),
    })

    const session = await adapter.start(
      runInput(),
      new AbortController().signal
    )
    client.emit({
      type: "extension_ui_request",
      id: "ui-2",
      method: "select",
      title: "Pick one",
      options: ["a", "b"],
    })
    client.emit({ type: "extension_ui_request", id: "ui-3", method: "notify" })

    expect(client.sent).toEqual([
      { type: "extension_ui_response", id: "ui-2", cancelled: true },
    ])
    await session.cancel()
  })
})

describe("Pi text generation", () => {
  it("generates a title in a session Pi does not keep", async () => {
    const client = new FakePiClient()
    const launches: string[][] = []
    const adapter = new PiAdapter(
      (_command, _cwd, options) => {
        launches.push(options?.args ?? [])
        return client
      },
      { extensionsPath: await tempDirectory() }
    )

    const generated = adapter.generateText(
      {
        projectPath: "/tmp/project",
        prompt: "Name this task",
        executionProfile: {
          modelId: null,
          effort: null,
          permissionMode: "approval-required",
        },
      },
      new AbortController().signal
    )
    await vi.waitFor(() => expect(client.commands).toHaveLength(2))
    client.emit({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "Renewal review" },
    })
    client.emit({
      type: "agent_end",
      messages: [{ role: "assistant", stopReason: "stop" }],
      willRetry: false,
    })

    await expect(generated).resolves.toBe("Renewal review")
    expect(launches[0]).toContain("--no-session")
  })
})

describe("Pi launch arguments", () => {
  it("resumes or forks the stored session and passes the profile", () => {
    expect(
      piLaunchArgs(
        runInput({
          providerSessionId: "session-9",
          customization: {
            skillRoots: [{ path: "/packs/sales", name: "Sales" }],
            instructions: "Be brief.",
          },
        }),
        "/tmp/deskto-approvals.mjs"
      )
    ).toEqual([
      "--no-extensions",
      "--session",
      "session-9",
      "--model",
      "openai-codex/gpt-5.6-sol",
      "--thinking",
      "medium",
      "--extension",
      "/tmp/deskto-approvals.mjs",
      "--skill",
      "/packs/sales",
      "--append-system-prompt",
      "Be brief.",
    ])
    expect(
      piLaunchArgs(
        runInput({ providerSessionId: "session-9", forkProviderSession: true })
      )
    ).toContain("--fork")
  })

  it("folds references and images into the prompt command", () => {
    expect(
      piPromptCommand({
        prompt: "Summarize",
        references: [
          {
            kind: "project-entry",
            name: "notes.md",
            path: "/tmp/project/notes.md",
            entryKind: "file",
          },
          {
            kind: "skill",
            origin: "pack",
            name: "brief",
            path: "/packs/brief",
          },
        ],
        attachments: [
          {
            type: "image",
            name: "shot.png",
            mimeType: "image/png",
            dataUrl: "data:image/png;base64,AAAA",
          },
        ],
      })
    ).toEqual({
      type: "prompt",
      message:
        "Summarize\n\nReferenced file: /tmp/project/notes.md\n\nUse the skill at /packs/brief (read its SKILL.md first).",
      images: [{ type: "image", data: "AAAA", mimeType: "image/png" }],
    })
  })
})

describe("Pi activities", () => {
  it("maps built-in tools to bounded activities", () => {
    expect(
      piActivity({
        type: "tool_execution_start",
        toolCallId: "c1",
        toolName: "edit",
        args: { path: "/tmp/project/report.md" },
      })
    ).toEqual({
      id: "c1",
      name: "Change files",
      detail: "/tmp/project/report.md",
      payload: {
        kind: "file-change",
        files: [{ path: "/tmp/project/report.md" }],
      },
    })
    expect(
      piActivity({
        type: "tool_execution_start",
        toolCallId: "c2",
        toolName: "grep",
        args: { pattern: "TODO" },
      })
    ).toEqual({
      id: "c2",
      name: "Search files",
      detail: "TODO",
      payload: { kind: "tool", tool: "search" },
    })
    expect(
      piActivity({
        type: "tool_execution_start",
        toolCallId: "c4",
        toolName: "powershell",
        args: { command: "Get-ChildItem" },
      })
    ).toEqual({
      id: "c4",
      name: "Run command",
      detail: "Get-ChildItem",
      payload: { kind: "tool", tool: "command" },
    })
    expect(
      piActivity({
        type: "tool_execution_start",
        toolCallId: "c3",
        toolName: "my_tool",
      })
    ).toEqual({
      id: "c3",
      name: "My tool",
      payload: { kind: "tool", tool: "other" },
    })
  })
})

const listOutput = `provider      model                context  max-out  thinking  images
openai-codex  gpt-5.6-sol          272K     128K     yes       yes
openrouter    amazon/nova-lite-v1  300K     5.1K     no        yes
xai           grok-4.6             256K     32K      yes       no
`

describe("Pi models", () => {
  it("reads the model table and marks Pi's default", () => {
    const models = piModels(listOutput, {
      defaultProvider: "xai",
      defaultModel: "grok-4.6",
    })
    expect(models.map((model) => [model.id, model.isDefault])).toEqual([
      ["openai-codex/gpt-5.6-sol", false],
      ["openrouter/amazon/nova-lite-v1", false],
      ["xai/grok-4.6", true],
    ])
    expect(models[1]).toMatchObject({ supportedEfforts: [] })
    expect(models[0]).toMatchObject({
      name: "gpt-5.6-sol",
      description: "openai-codex",
      defaultEffort: "medium",
      supportedPermissionModes: ["approval-required", "full-access"],
    })
    expect(models[0]?.supportedEfforts).toContain("xhigh")
  })

  it("keeps only the models the person enabled in pi", () => {
    const models = piModels(listOutput, { enabledModels: ["openrouter/*"] })
    expect(models.map((model) => model.id)).toEqual([
      "openrouter/amazon/nova-lite-v1",
    ])
    expect(models[0]?.isDefault).toBe(true)
  })

  it("matches enabled models the way pi does", () => {
    const models = piModels(listOutput, {
      enabledModels: ["GROK-4.6", "openai-codex/gpt-5.6-sol:high"],
    })
    expect(models.map((model) => model.id)).toEqual([
      "openai-codex/gpt-5.6-sol",
      "xai/grok-4.6",
    ])
  })

  it("offers every model when the enabled list matches none", () => {
    const models = piModels(listOutput, { enabledModels: ["anthropic/*"] })
    expect(models).toHaveLength(3)
    expect(models[0]?.isDefault).toBe(true)
  })
})

describe("Pi availability", () => {
  it("reports the installed version", async () => {
    const runCommand = vi.fn(() => Promise.resolve("0.84.4\n"))
    await expect(
      new PiAdapter(undefined, { runCommand }).checkAvailability()
    ).resolves.toEqual({ status: "available", version: "0.84.4" })
    expect(runCommand).toHaveBeenCalledWith(["--version"], expect.any(String))
  })

  it("explains how to install Pi when the CLI is missing", async () => {
    const error = Object.assign(new Error("not found"), { code: "ENOENT" })
    await expect(
      new PiAdapter(undefined, {
        runCommand: () => Promise.reject(error),
      }).checkAvailability()
    ).resolves.toEqual({
      status: "unavailable",
      reason:
        "Pi was not found. Open Terminal and run `npm install -g @earendil-works/pi-coding-agent`.",
    })
  })
})

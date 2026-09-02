import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { join, relative } from "node:path"
import { pathToFileURL } from "node:url"

import type { HarnessEvent, HarnessRunInput } from "@deskto/harness-sdk"
import type { JsonObject, JsonValue } from "@deskto/protocol"
import type { ZodType } from "zod"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  PiAdapter,
  piActivity,
  piLaunchArgs,
  piModels,
  piNormalizedPath,
  piPromptCommand,
  piTooOldReason,
  type PiClient,
  type PiClientFactory,
} from "./pi-adapter.js"
import type { PiEvent, PiModel } from "./pi-protocol.js"

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
  /** Every write in order, so tests can check what reached Pi first. */
  readonly timeline: string[] = []
  models: PiModel[] = []
  closed = false
  #listener?: (event: PiEvent) => void
  #failure?: (error: Error) => void

  constructor(
    private readonly state: JsonObject = {
      sessionId: "session-1",
      sessionFile: "/tmp/session-1.jsonl",
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
    this.timeline.push(`request:${String(command.type)}`)
    const data: JsonValue =
      command.type === "get_state"
        ? this.state
        : command.type === "get_available_models"
          ? { models: this.models }
          : {}
    return Promise.resolve(schema.parse(data))
  }

  send(command: JsonObject): void {
    this.sent.push(command)
    this.timeline.push(`send:${String(command.type)}`)
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
      { type: "session.started", providerSessionId: "session-1" },
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
    client.emit({ type: "agent_settled" })
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
    expect(events).toEqual([])
    expect(client.closed).toBe(true)
  })

  it("waits for Pi to settle after multiple agent runs", async () => {
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
      messages: [{ role: "assistant", stopReason: "error" }],
      willRetry: true,
    })
    client.emit({
      type: "agent_end",
      messages: [{ role: "assistant", stopReason: "stop" }],
      willRetry: false,
    })
    expect(client.closed).toBe(false)

    client.emit({ type: "agent_settled" })
    const events = await collect(session.events)

    expect(events).toEqual([{ type: "turn.completed" }])
    expect(client.closed).toBe(true)
  })

  it("starts fresh after a process dies before its session is resumable", async () => {
    const firstClient = new FakePiClient()
    const secondClient = new FakePiClient({
      sessionId: "session-2",
      sessionFile: "/tmp/session-2.jsonl",
    })
    const clients = [firstClient, secondClient]
    const launches: string[][] = []
    const adapter = new PiAdapter(
      (_command, _cwd, options) => {
        launches.push(options?.args ?? [])
        const client = clients.shift()
        if (!client) throw new Error("Unexpected Pi launch")
        return client
      },
      { extensionsPath: await tempDirectory() }
    )

    const firstSession = await adapter.start(
      runInput(),
      new AbortController().signal
    )
    firstClient.fail(new Error("Pi exited before its first assistant message"))
    const firstEvents = await collect(firstSession.events)
    const storedSessionId = firstEvents.find(
      (event) => event.type === "session.started"
    )?.providerSessionId

    const nextInput = storedSessionId
      ? runInput({ providerSessionId: storedSessionId })
      : runInput()
    const secondSession = await adapter.start(
      nextInput,
      new AbortController().signal
    )

    expect(storedSessionId).toBeUndefined()
    expect(launches[1]).not.toContain("--session")
    await secondSession.cancel()
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

  it("dismisses a pending approval before asking Pi to abort", async () => {
    const client = new FakePiClient()
    const adapter = new PiAdapter(() => client, {
      extensionsPath: await tempDirectory(),
    })

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
    client.emit({
      type: "extension_ui_request",
      id: "ui-1",
      method: "confirm",
      title: "deskto-approval:bash",
      message: "rm -rf build",
    })
    client.emit({
      type: "extension_ui_request",
      id: "ui-2",
      method: "confirm",
      title: "deskto-approval:write",
      message: "notes.md",
    })
    await session.cancel()

    // Pi's abort waits for idle, which a blocked confirm dialog never reaches.
    expect(client.timeline.slice(-3)).toEqual([
      "send:extension_ui_response",
      "send:extension_ui_response",
      "request:abort",
    ])
    expect(client.sent).toEqual([
      { type: "extension_ui_response", id: "ui-1", cancelled: true },
      { type: "extension_ui_response", id: "ui-2", cancelled: true },
    ])
    expect(await collect(session.events)).toEqual([
      expect.objectContaining({ type: "approval.requested" }),
    ])
  })

  it("keeps a task folder untrusted until the person approves its work", async () => {
    const client = new FakePiClient()
    const projectPath = await tempDirectory()
    await mkdir(join(projectPath, ".pi", "skills"), { recursive: true })
    const launches: string[][] = []
    const adapter = new PiAdapter(
      (_command, _cwd, options) => {
        launches.push(options?.args ?? [])
        return client
      },
      { extensionsPath: await tempDirectory() }
    )
    const profile = {
      modelId: null,
      effort: null,
      permissionMode: "approval-required" as const,
    }

    // A checked-in .pi/settings.json can name packages Pi would install,
    // scripts included, before the first prompt; the skills folder is only
    // text and still reaches Pi.
    const guarded = await adapter.start(
      runInput({ projectPath, executionProfile: profile }),
      new AbortController().signal
    )
    expect(launches[0]).toContain("--no-approve")
    expect(launches[0]).not.toContain("--approve")
    expect(launches[0]).toContain("--skill")
    expect(launches[0]![launches[0]!.indexOf("--skill") + 1]).toBe(
      join(projectPath, ".pi", "skills")
    )
    await guarded.cancel()

    const bare = await adapter.start(
      runInput({
        projectPath: await tempDirectory(),
        executionProfile: profile,
      }),
      new AbortController().signal
    )
    expect(launches[1]).not.toContain("--skill")
    await bare.cancel()

    const trusted = await adapter.start(
      runInput({ projectPath }),
      new AbortController().signal
    )
    expect(launches[2]).toContain("--approve")
    expect(launches[2]).not.toContain("--skill")
    await trusted.cancel()
  })

  it("turns away an approval that arrives while Pi is still aborting", async () => {
    let releaseAbort = () => {}
    class SlowAbortClient extends FakePiClient {
      override request<T extends JsonValue>(
        command: JsonObject,
        schema: ZodType<T>
      ): Promise<T> {
        if (command.type !== "abort") return super.request(command, schema)
        this.commands.push(command)
        this.timeline.push("request:abort")
        return new Promise((resolve) => {
          releaseAbort = () => resolve(schema.parse({}))
        })
      }
    }
    const client = new SlowAbortClient()
    const adapter = new PiAdapter(() => client, {
      extensionsPath: await tempDirectory(),
    })
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

    const cancelled = session.cancel()
    // Pi's abort waits for the agent to go idle; a dialog Deskto queued now
    // would hold it open, and cancel() with it, forever.
    client.emit({
      type: "extension_ui_request",
      id: "ui-late",
      method: "confirm",
      title: "deskto-approval:bash",
      message: "rm -rf build",
    })
    expect(client.sent).toEqual([
      { type: "extension_ui_response", id: "ui-late", cancelled: true },
    ])
    releaseAbort()
    await cancelled
    expect(await collect(session.events)).toEqual([])
  })

  it("refuses an image for a model that reads only text", async () => {
    const attachments = [
      {
        type: "image" as const,
        name: "shot.png",
        mimeType: "image/png" as const,
        dataUrl: "data:image/png;base64,AAAA",
      },
    ]
    const textOnly = new FakePiClient({
      sessionId: "session-1",
      sessionFile: "/tmp/session-1.jsonl",
      model: {
        id: "gpt-5.3-codex-spark",
        provider: "openai-codex",
        contextWindow: 128000,
        input: ["text"],
      },
    })
    const adapter = new PiAdapter(() => textOnly, {
      extensionsPath: await tempDirectory(),
    })
    await expect(
      adapter.start(runInput({ attachments }), new AbortController().signal)
    ).rejects.toThrow(
      "openai-codex/gpt-5.3-codex-spark can't read images. Remove the attachment or choose a model that accepts images."
    )
    expect(textOnly.commands.map((command) => command.type)).toEqual([
      "get_state",
    ])
    expect(textOnly.closed).toBe(true)

    const vision = new FakePiClient({
      sessionId: "session-1",
      sessionFile: "/tmp/session-1.jsonl",
      model: {
        id: "gpt-5.6-sol",
        provider: "openai-codex",
        contextWindow: 272000,
        input: ["text", "image"],
      },
    })
    const session = await new PiAdapter(() => vision, {
      extensionsPath: await tempDirectory(),
    }).start(runInput({ attachments }), new AbortController().signal)
    expect(vision.commands[1]).toMatchObject({
      type: "prompt",
      images: [{ type: "image", data: "AAAA", mimeType: "image/png" }],
    })
    await session.cancel()
  })

  it("lets Pi explain a missing account instead of blaming the model", async () => {
    // Pi 0.84.4 with no credentials reports pi-agent-core's stand-in model.
    const noAccount = new FakePiClient({
      sessionId: "session-1",
      model: { id: "unknown", provider: "unknown", contextWindow: 0, input: [] },
    })
    const session = await new PiAdapter(() => noAccount, {
      extensionsPath: await tempDirectory(),
    }).start(
      runInput({
        attachments: [
          {
            type: "image",
            name: "shot.png",
            mimeType: "image/png",
            dataUrl: "data:image/png;base64,AAAA",
          },
        ],
      }),
      new AbortController().signal
    )
    expect(noAccount.commands.map((command) => command.type)).toEqual([
      "get_state",
      "prompt",
    ])
    await session.cancel()
  })

  it("hands Pi the project instructions as a file it removes afterwards", async () => {
    const client = new FakePiClient()
    const extensionsPath = await tempDirectory()
    const launches: string[][] = []
    const adapter = new PiAdapter(
      (_command, _cwd, options) => {
        launches.push(options?.args ?? [])
        return client
      },
      { extensionsPath }
    )

    const session = await adapter.start(
      runInput({
        customization: { skillRoots: [], instructions: "README.md" },
      }),
      new AbortController().signal
    )
    const flag = launches[0]!.indexOf("--append-system-prompt")
    const file = launches[0]![flag + 1]!
    expect(file).toMatch(/[\\/]instructions[\\/][^\\/]+\.md$/)
    // Pi reads the flag as a file whenever the path exists; the literal text
    // "README.md" would otherwise become the project's README.
    await expect(readFile(file, "utf8")).resolves.toBe("README.md")

    await session.cancel()
    await collect(session.events)
    await vi.waitFor(async () =>
      expect(await readdir(join(extensionsPath, "instructions"))).toEqual([])
    )
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
    client.emit({ type: "agent_settled" })

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
        "/tmp/deskto-approvals.mjs",
        { ephemeral: false },
        "/tmp/deskto-pi/instructions/turn.md"
      )
    ).toEqual([
      "--no-extensions",
      "--approve",
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
      "/tmp/deskto-pi/instructions/turn.md",
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

// Trimmed from `get_available_models` on Pi 0.84.4: the codex model maps
// xhigh but not max, the xai model maps neither, nova has no reasoning.
const availableModels: PiModel[] = [
  {
    provider: "openai-codex",
    id: "gpt-5.6-sol",
    name: "GPT-5.6 Sol",
    reasoning: true,
    contextWindow: 272_000,
    thinkingLevelMap: { minimal: "low", xhigh: "xhigh" },
  },
  {
    provider: "openrouter",
    id: "amazon/nova-lite-v1",
    name: "Amazon Nova Lite",
    reasoning: false,
    contextWindow: 300_000,
  },
  {
    provider: "xai",
    id: "grok-4.6",
    name: "Grok 4.6",
    reasoning: true,
    contextWindow: 256_000,
  },
]

describe("Pi models", () => {
  it("reads Pi's model snapshot and marks Pi's default", () => {
    const models = piModels(availableModels, {
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
  })

  it("offers only the thinking levels each model maps", () => {
    const models = piModels(availableModels)
    expect(models[0]?.supportedEfforts).toEqual([
      "off",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
    ])
    expect(models[2]?.supportedEfforts).toEqual([
      "off",
      "minimal",
      "low",
      "medium",
      "high",
    ])
    const [sol] = piModels([
      {
        ...availableModels[0]!,
        thinkingLevelMap: {
          off: "none",
          medium: null,
          high: "high",
          max: "max",
        },
      },
    ])
    expect(sol?.supportedEfforts).toEqual([
      "off",
      "minimal",
      "low",
      "high",
      "max",
    ])
    // Pi clamps medium upward to high rather than down to off.
    expect(sol?.defaultEffort).toBe("high")
  })

  it("asks a running Pi for its models", async () => {
    const client = new FakePiClient()
    client.models = availableModels
    const launches: string[][] = []
    const adapter = new PiAdapter(
      (_command, _cwd, options) => {
        launches.push(options?.args ?? [])
        return client
      },
      { configPath: await tempDirectory() }
    )

    const models = await adapter.listModels()
    expect(models.map((model) => model.id)).toEqual([
      "openai-codex/gpt-5.6-sol",
      "openrouter/amazon/nova-lite-v1",
      "xai/grok-4.6",
    ])
    expect(launches).toEqual([["--no-session", "--no-extensions"]])
    expect(client.commands).toEqual([{ type: "get_available_models" }])
    expect(client.closed).toBe(true)
  })

  it("keeps only the models the person enabled in pi", () => {
    const models = piModels(availableModels, {
      enabledModels: ["xai/*"],
    })
    expect(models.map((model) => model.id)).toEqual(["xai/grok-4.6"])
    expect(models[0]?.isDefault).toBe(true)
  })

  it("matches enabled models the way pi does", () => {
    const ids = (patterns: string[]) =>
      piModels(availableModels, { enabledModels: patterns }).map(
        (model) => model.id
      )
    expect(ids(["GROK-4.6", "openai-codex/gpt-5.6-sol:high"])).toEqual([
      "xai/grok-4.6",
      "openai-codex/gpt-5.6-sol",
    ])
    expect(ids(["openai-codex/gpt-5.?-sol"])).toEqual([
      "openai-codex/gpt-5.6-sol",
    ])
    expect(ids(["grok-4.[0-9]"])).toEqual(["xai/grok-4.6"])
    expect(ids(["*grok*"])).toEqual(["xai/grok-4.6"])
    // A glob star stops at a slash in Pi too, so a nested id needs its
    // provider spelled out or a plain substring.
    expect(ids(["openrouter/*", "xai/*"])).toEqual(["xai/grok-4.6"])
    expect(ids(["openrouter/*/*"])).toEqual(["openrouter/amazon/nova-lite-v1"])
    expect(ids(["Nova Lite"])).toEqual(["openrouter/amazon/nova-lite-v1"])
    // Pi drops an unknown suffix with a warning and keeps the model.
    expect(ids(["gpt-5.6-sol:banana", "xai/*:banana"])).toEqual([
      "openai-codex/gpt-5.6-sol",
    ])
  })

  it("defaults each model to the level Pi would pick", () => {
    const hidesMedium: PiModel = {
      ...availableModels[2]!,
      thinkingLevelMap: { medium: null },
    }
    // Pi clamps upward first: with medium hidden and off still there, a
    // first-supported pick would silently weaken the model to off.
    expect(piModels([hidesMedium])[0]?.defaultEffort).toBe("high")
    expect(
      piModels(availableModels, { defaultThinkingLevel: "low" }).map(
        (model) => model.defaultEffort
      )
    ).toEqual(["low", undefined, "low"])
    expect(
      piModels(availableModels, {
        defaultThinkingLevel: "low",
        modelThinkingLevels: { "xai/grok-4.6": "high" },
      }).map((model) => model.defaultEffort)
    ).toEqual(["low", undefined, "high"])
    // A level the model does not reach clamps down to its highest.
    expect(
      piModels(availableModels, { defaultThinkingLevel: "max" }).map(
        (model) => model.defaultEffort
      )
    ).toEqual(["xhigh", undefined, "high"])
    expect(
      piModels(availableModels, { defaultThinkingLevel: "banana" })[0]
        ?.defaultEffort
    ).toBe("off")
  })

  it("keeps the thinking level an enabled entry names", () => {
    const efforts = (patterns: string[], settings = {}) =>
      piModels(availableModels, { enabledModels: patterns, ...settings }).map(
        (model) => [model.id, model.defaultEffort]
      )
    // The entry's own level outranks the per-model and global settings,
    // which is what Pi's get_state reports for a scoped model.
    expect(
      efforts(["xai/grok-4.6:high"], {
        defaultThinkingLevel: "low",
        modelThinkingLevels: { "xai/grok-4.6": "minimal" },
      })
    ).toEqual([["xai/grok-4.6", "high"]])
    expect(efforts(["openai-codex/*:low", "GROK-4.6:xhigh"])).toEqual([
      ["openai-codex/gpt-5.6-sol", "low"],
      // A level the model does not reach clamps the way Pi clamps.
      ["xai/grok-4.6", "high"],
    ])
    // An unknown suffix voids the level in front of it, as in Pi, and the
    // first entry naming a model keeps its level.
    expect(
      efforts(["gpt-5.6-sol:high:banana", "xai/grok-4.6", "xai/grok-4.6:high"])
    ).toEqual([
      ["openai-codex/gpt-5.6-sol", "medium"],
      ["xai/grok-4.6", "medium"],
    ])
    // A glob sheds only its last suffix, so the rest stays part of the glob.
    expect(efforts(["*grok*:banana:low", "openai-codex/*"])).toEqual([
      ["openai-codex/gpt-5.6-sol", "medium"],
    ])
  })

  it("takes a bare model id exactly before searching substrings", () => {
    const withBatch: PiModel[] = [
      ...availableModels,
      {
        provider: "openrouter",
        id: "openai/gpt-5.6-sol:batch",
        name: "GPT-5.6 Sol (batch)",
        reasoning: true,
      },
    ]
    const ids = (patterns: string[]) =>
      piModels(withBatch, { enabledModels: patterns }).map((model) => model.id)
    // Substring matching would sort the batch route first and move the
    // task to another provider than Pi itself would use.
    expect(ids(["gpt-5.6-sol"])).toEqual(["openai-codex/gpt-5.6-sol"])
    expect(ids(["GPT-5.6-SOL:high"])).toEqual(["openai-codex/gpt-5.6-sol"])
    // Pi falls through to the bare id when no provider owns the prefix.
    expect(ids(["amazon/nova-lite-v1"])).toEqual([
      "openrouter/amazon/nova-lite-v1",
    ])
    expect(ids(["sol"])).toEqual(["openrouter/openai/gpt-5.6-sol:batch"])
  })

  it("reads Pi's settings the way Pi does", async () => {
    const client = new FakePiClient()
    client.models = availableModels
    const configPath = await tempDirectory()
    await writeFile(
      join(configPath, "settings.json"),
      `\uFEFF${JSON.stringify({ enabledModels: ["xai/*"] })}`,
      "utf8"
    )
    // A byte order mark Pi strips must not read as an empty settings file.
    expect(
      (await new PiAdapter(() => client, { configPath }).listModels()).map(
        (model) => model.id
      )
    ).toEqual(["xai/grok-4.6"])

    // PI_CODING_AGENT_DIR goes through Pi's own path reading.
    vi.stubEnv("PI_CODING_AGENT_DIR", pathToFileURL(configPath).href)
    try {
      expect(
        (await new PiAdapter(() => client).listModels()).map(
          (model) => model.id
        )
      ).toEqual(["xai/grok-4.6"])
    } finally {
      vi.unstubAllEnvs()
    }

    // A relative override is resolved once, here, and handed to every Pi
    // process, since Pi would resolve it against each process's own folder.
    const relativeOverride = relative(process.cwd(), configPath)
    const launches: (NodeJS.ProcessEnv | undefined)[] = []
    const adapter = new PiAdapter((_command, _cwd, options) => {
      launches.push(options?.env)
      return client
    })
    vi.stubEnv("PI_CODING_AGENT_DIR", relativeOverride)
    try {
      expect((await adapter.listModels()).map((model) => model.id)).toEqual([
        "xai/grok-4.6",
      ])
      const session = await adapter.start(
        runInput(),
        new AbortController().signal
      )
      await session.cancel()
    } finally {
      vi.unstubAllEnvs()
    }
    expect(launches.map((env) => env?.PI_CODING_AGENT_DIR)).toEqual([
      configPath,
      configPath,
    ])

    expect(piNormalizedPath("~", "linux", "/home/me")).toBe("/home/me")
    expect(piNormalizedPath("~/pi", "linux", "/home/me")).toBe("/home/me/pi")
    expect(piNormalizedPath("~/pi")).toBe(join(homedir(), "pi"))
    expect(piNormalizedPath("/c/Users/me/.pi/agent", "win32", "C:\\me")).toBe(
      "C:\\Users\\me\\.pi\\agent"
    )
    expect(piNormalizedPath("/mnt/d/pi", "win32", "C:\\me")).toBe("D:\\pi")
    expect(piNormalizedPath("/c/Users/me", "linux", "/home/me")).toBe(
      "/c/Users/me"
    )
    expect(piNormalizedPath("/opt/pi", "win32", "C:\\me")).toBe("/opt/pi")
  })

  it("offers every model when the enabled list matches none", () => {
    const models = piModels(availableModels, {
      enabledModels: ["anthropic/*"],
    })
    expect(models).toHaveLength(3)
    expect(models.map((model) => model.isDefault)).toEqual([
      false,
      false,
      true,
    ])
  })

  it("falls back to the provider default pi would start with", () => {
    // Pi walks its provider default table, not the snapshot order: the
    // codex entry is not that provider's default, grok is xai's.
    expect(
      piModels(availableModels).map((model) => model.isDefault)
    ).toEqual([false, false, true])
    // A settings default without credentials is skipped the same way.
    expect(
      piModels(availableModels, {
        defaultProvider: "anthropic",
        defaultModel: "claude-opus-4-8",
      }).map((model) => model.isDefault)
    ).toEqual([false, false, true])
    // Table order wins over snapshot order between two provider defaults.
    expect(
      piModels([
        availableModels[2]!,
        { ...availableModels[0]!, id: "gpt-5.5" },
      ]).map((model) => model.id + (model.isDefault ? "*" : ""))
    ).toEqual(["xai/grok-4.6", "openai-codex/gpt-5.5*"])
    // Nothing in the table: the first model, as in Pi.
    expect(piModels([availableModels[0]!])[0]?.isDefault).toBe(true)
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

  it("turns away a Pi that cannot report when a task settles", async () => {
    const runCommand = vi.fn(() => Promise.resolve("0.80.3\n"))
    await expect(
      new PiAdapter(undefined, { runCommand }).checkAvailability()
    ).resolves.toEqual({
      status: "unavailable",
      reason: piTooOldReason("0.80.3"),
    })
    expect(piTooOldReason("0.80.3")).toContain("0.80.4")
    await expect(
      new PiAdapter(undefined, {
        runCommand: () => Promise.resolve("0.80.4\n"),
      }).checkAvailability()
    ).resolves.toEqual({ status: "available", version: "0.80.4" })
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

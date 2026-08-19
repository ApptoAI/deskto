import type { HarnessEvent } from "@deskto/harness-sdk"
import type { JsonObject, JsonValue } from "@deskto/protocol"
import type { ZodType } from "zod"
import { beforeEach, describe, expect, it } from "vitest"

import {
  CodexAdapter,
  codexActivity,
  codexLimitResetAt,
  codexMcpLaunchOptions,
  codexPlanSteps,
  codexTurnInput,
  type CodexClient,
  type CodexClientFactory,
} from "./codex-adapter.js"
import type { CodexNotification } from "./codex-protocol.js"

interface ClientState {
  notification?: (notification: CodexNotification) => void
}

const clientState: ClientState = {}

class FakeCodexClient implements CodexClient {
  request<T extends JsonValue>(
    method: string,
    _params: JsonObject,
    schema: ZodType<T>
  ): Promise<T> {
    const response: JsonValue =
      method === "thread/start" || method === "thread/resume"
        ? { thread: { id: "thread-1" } }
        : method === "turn/start"
          ? { turn: { id: "turn-1" } }
          : {}
    return Promise.resolve(schema.parse(response))
  }

  notify(): void {}
  respond(): void {}
  respondMethodNotFound(): void {}
  close(): void {}

  onNotification(listener: (notification: CodexNotification) => void) {
    clientState.notification = listener
    return () => {
      if (clientState.notification === listener) delete clientState.notification
    }
  }

  onRequest() {
    return () => {}
  }

  onFailure() {
    return () => {}
  }
}

class UnsupportedSkillRootsClient extends FakeCodexClient {
  override request<T extends JsonValue>(
    method: string,
    params: JsonObject,
    schema: ZodType<T>
  ): Promise<T> {
    if (method === "skills/extraRoots/set")
      return Promise.reject(new Error("Unsupported request"))
    return super.request(method, params, schema)
  }
}

class RecordingCodexClient extends FakeCodexClient {
  readonly requests: { method: string; params: JsonObject }[] = []

  override request<T extends JsonValue>(
    method: string,
    params: JsonObject,
    schema: ZodType<T>
  ): Promise<T> {
    this.requests.push({ method, params })
    return super.request(method, params, schema)
  }
}

const clientFactory: CodexClientFactory = () => new FakeCodexClient()

beforeEach(() => {
  delete clientState.notification
})

describe("codexTurnInput", () => {
  it("projects semantic references to native app-server input items", () => {
    expect(
      codexTurnInput({
        prompt: "Review @src/a.ts with $review",
        references: [
          {
            kind: "project-entry",
            name: "a.ts",
            path: "/repo/src/a.ts",
            entryKind: "file",
          },
          {
            kind: "skill",
            origin: "pack",
            name: "review",
            path: "/packs/review/SKILL.md",
          },
        ],
      })
    ).toEqual([
      {
        type: "text",
        text: "Review @src/a.ts with $review",
        text_elements: [],
      },
      { type: "mention", name: "a.ts", path: "/repo/src/a.ts" },
      {
        type: "skill",
        name: "review",
        path: "/packs/review/SKILL.md",
      },
    ])
  })

  it("passes image attachments to app-server turns", () => {
    expect(
      codexTurnInput({
        prompt: "",
        references: [],
        attachments: [
          {
            type: "image",
            name: "screen.png",
            mimeType: "image/png",
            dataUrl: "data:image/png;base64,cG5n",
          },
        ],
      })
    ).toEqual([{ type: "image", url: "data:image/png;base64,cG5n" }])
  })
})

describe("Codex MCP launch options", () => {
  it("injects private MCP auth without exposing the token to shell commands", () => {
    const options = codexMcpLaunchOptions([
      {
        id: "deskto_browser",
        url: "http://127.0.0.1:4312/mcp",
        authorization: { type: "bearer", token: "secret-token" },
      },
    ])

    expect(options.args).toEqual([
      "-c",
      'mcp_servers.deskto_browser.url="http://127.0.0.1:4312/mcp"',
      "-c",
      "mcp_servers.deskto_browser.required=true",
      "-c",
      'mcp_servers.deskto_browser.bearer_token_env_var="DESKTO_MCP_0_TOKEN"',
      "-c",
      'shell_environment_policy.set.DESKTO_MCP_0_TOKEN=""',
    ])
    expect(options.env?.DESKTO_MCP_0_TOKEN).toBe("secret-token")
  })
})

describe("Codex skill provisioning", () => {
  it("reports accepted extra roots", async () => {
    const session = await new CodexAdapter(clientFactory).start(
      runInputWithPack(),
      new AbortController().signal
    )

    expect(session.skillProvisioning).toEqual([
      {
        rootId: "pack-1",
        rootPath: "/packs/reviews/skills",
        contentDigest: "sha256:one",
        status: "configured",
        method: "extra-root",
      },
    ])
  })

  it("keeps the session running when the installed Codex rejects extra roots", async () => {
    const factory: CodexClientFactory = () => new UnsupportedSkillRootsClient()
    const session = await new CodexAdapter(factory).start(
      runInputWithPack(),
      new AbortController().signal
    )

    expect(session.skillProvisioning?.[0]).toMatchObject({
      rootId: "pack-1",
      status: "unsupported",
      method: "extra-root",
    })
  })
})

describe("Codex MCP provisioning", () => {
  it("starts app-server with a turn-scoped HTTP server", async () => {
    let processOptions: Parameters<CodexClientFactory>[2]
    const factory: CodexClientFactory = (_command, _cwd, options) => {
      processOptions = options
      return new FakeCodexClient()
    }
    await new CodexAdapter(factory).start(
      {
        ...runInputWithPack(),
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

    expect(processOptions?.args).toContain(
      'mcp_servers.deskto.url="http://127.0.0.1:4321/mcp"'
    )
    expect(processOptions?.args).toContain(
      'mcp_servers.deskto.bearer_token_env_var="DESKTO_MCP_0_TOKEN"'
    )
    expect(processOptions?.env?.DESKTO_MCP_0_TOKEN).toBe("secret-token")
  })
})

describe("Codex Project instructions", () => {
  it("passes shared instructions as app-server developer instructions", async () => {
    const client = new RecordingCodexClient()
    await new CodexAdapter(() => client).start(
      {
        ...runInputWithPack(),
        customization: {
          skillRoots: [],
          instructions: "Use the approved client terminology.",
        },
      },
      new AbortController().signal
    )

    expect(
      client.requests.find(({ method }) => method === "thread/start")?.params
    ).toMatchObject({
      developerInstructions: "Use the approved client terminology.",
    })
  })

  it("clears shared instructions when resuming an existing thread", async () => {
    const client = new RecordingCodexClient()
    await new CodexAdapter(() => client).start(
      {
        ...runInputWithPack(),
        providerSessionId: "codex-thread-1",
        customization: { skillRoots: [], instructions: "" },
      },
      new AbortController().signal
    )

    expect(
      client.requests.find(({ method }) => method === "thread/resume")?.params
    ).toMatchObject({ developerInstructions: "" })
  })
})

function runInputWithPack() {
  return {
    threadId: "thread-1",
    turnId: "turn-1",
    projectPath: "/tmp/project",
    prompt: "Continue",
    references: [],
    executionProfile: {
      modelId: null,
      effort: null,
      permissionMode: "approval-required" as const,
    },
    customization: {
      skillRoots: [
        {
          id: "pack-1",
          name: "Reviews",
          path: "/packs/reviews/skills",
          contentDigest: "sha256:one",
        },
      ],
    },
  }
}

describe("codexActivity", () => {
  it("classifies app-server items into provider-neutral payloads", () => {
    expect(
      codexActivity({ id: "i1", type: "commandExecution", command: "ls" })
    ).toEqual({
      id: "i1",
      name: "Run command",
      detail: "ls",
      payload: { kind: "tool", tool: "command" },
    })
    expect(
      codexActivity({
        id: "i2",
        type: "fileChange",
        changes: [
          { path: "a.md", additions: 3, deletions: 1 },
          { path: "b.md" },
        ],
      })
    ).toEqual({
      id: "i2",
      name: "Change files",
      detail: "a.md, b.md",
      payload: {
        kind: "file-change",
        files: [{ path: "a.md", additions: 3, deletions: 1 }, { path: "b.md" }],
      },
    })
  })

  it("summarizes remaining files and classifies empty known items", () => {
    expect(
      codexActivity({
        id: "many",
        type: "fileChange",
        changes: ["a.md", "b.md", "c.md", "d.md"].map((path) => ({ path })),
      })
    ).toMatchObject({ detail: "a.md, b.md, c.md +1 more" })
    expect(codexActivity({ id: "empty-files", type: "fileChange" })).toEqual({
      id: "empty-files",
      name: "Change files",
      payload: { kind: "tool", tool: "other" },
    })
    expect(
      codexActivity({ id: "empty-plan", type: "plan", text: "Planning" })
    ).toBeUndefined()
  })

  it("classifies current app-server subagent items", () => {
    expect(
      codexActivity({
        type: "subAgentActivity",
        id: "spawn-1",
        kind: "started",
        agentThreadId: "agent-thread-1",
        agentPath: "/root/research_repo",
      })
    ).toEqual({
      id: "spawn-1",
      name: "Research repo",
      payload: { kind: "subagent" },
    })
    expect(
      codexActivity({
        type: "collabAgentToolCall",
        id: "wait-1",
        tool: "wait",
        status: "inProgress",
      })
    ).toEqual({
      id: "wait-1",
      name: "Wait for subagents",
      payload: { kind: "tool", tool: "other" },
    })
    expect(
      codexActivity({
        type: "collabAgentToolCall",
        id: "unknown-1",
        tool: "",
      })
    ).toEqual({
      id: "unknown-1",
      name: "Use subagent",
      payload: { kind: "tool", tool: "other" },
    })
  })

  it.each([
    [
      {
        id: "mcp",
        type: "mcpToolCall",
        server: "linear",
        tool: "create_issue",
      },
      {
        id: "mcp",
        name: "create_issue",
        detail: "linear",
        payload: { kind: "tool", tool: "mcp" },
      },
    ],
    [
      { id: "web", type: "webSearch", query: "activity payloads" },
      {
        id: "web",
        name: "Search web",
        detail: "activity payloads",
        payload: { kind: "tool", tool: "web" },
      },
    ],
    [
      { id: "image", type: "imageView" },
      {
        id: "image",
        name: "View image",
        payload: { kind: "tool", tool: "other" },
      },
    ],
    [
      { id: "future", type: "futureItem" },
      {
        id: "future",
        name: "Future Item",
        payload: { kind: "tool", tool: "other" },
      },
    ],
  ])("classifies supported and fallback item %s", (item, expected) => {
    expect(codexActivity(item)).toEqual(expected)
  })

  it("keeps plan items instead of dropping them", () => {
    expect(
      codexActivity({
        id: "p1",
        type: "plan",
        plan: [
          { step: "Research", status: "completed" },
          { step: "Write", status: "inProgress" },
        ],
      })
    ).toEqual({
      id: "p1",
      name: "Plan",
      payload: {
        kind: "plan",
        steps: [
          { text: "Research", status: "done" },
          { text: "Write", status: "active" },
        ],
      },
    })
  })

  it("still ignores message and reasoning items", () => {
    expect(codexActivity({ id: "r1", type: "reasoning" })).toBeUndefined()
    expect(codexActivity({ id: "m1", type: "agentMessage" })).toBeUndefined()
  })
})

describe("codexPlanSteps", () => {
  it("accepts the step-list shapes seen in the wild", () => {
    expect(
      codexPlanSteps({ steps: [{ text: "One", status: "in_progress" }] })
    ).toEqual([{ text: "One", status: "active" }])
    expect(codexPlanSteps({ items: ["Bare step"] })).toEqual([
      { text: "Bare step", status: "pending" },
    ])
    expect(
      codexPlanSteps({
        steps: [
          { text: "Two", status: "In Progress" },
          { text: "Three", status: "COMPLETED" },
        ],
      })
    ).toEqual([
      { text: "Two", status: "active" },
      { text: "Three", status: "done" },
    ])
    expect(codexPlanSteps({})).toEqual([])
  })
})

describe("CodexAdapter activity notifications", () => {
  it("reports reasoning and tool-output heartbeats without their contents", async () => {
    const session = await new CodexAdapter(clientFactory).start(
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
    const notify = clientState.notification!
    notify({
      method: "item/reasoning/textDelta",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        delta: "private reasoning",
      },
    })
    notify({
      method: "item/commandExecution/outputDelta",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        delta: "private command output",
      },
    })
    notify({
      method: "turn/completed",
      params: {
        threadId: "thread-1",
        turn: { id: "turn-1", status: "completed" },
      },
    })

    const events: HarnessEvent[] = []
    for await (const event of session.events) events.push(event)
    expect(events).toEqual([
      { type: "session.started", providerSessionId: "thread-1" },
      {
        type: "progress.updated",
        progress: { stage: "thinking", label: "Thinking" },
      },
      {
        type: "progress.updated",
        progress: { stage: "running-tool", label: "Run command" },
      },
      { type: "turn.completed" },
    ])
    expect(JSON.stringify(events)).not.toContain("private")
  })

  it("reports progress from a recognized delegated thread", async () => {
    const session = await new CodexAdapter(clientFactory).start(
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
    const notify = clientState.notification!
    notify({
      method: "item/started",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        item: {
          id: "spawn-1",
          type: "subAgentActivity",
          kind: "started",
          agentThreadId: "child-thread",
        },
      },
    })
    notify({
      method: "item/reasoning/textDelta",
      params: {
        threadId: "child-thread",
        turnId: "child-turn",
        delta: "private reasoning",
      },
    })
    notify({
      method: "item/commandExecution/outputDelta",
      params: {
        threadId: "child-thread",
        turnId: "child-turn",
        delta: "private command output",
      },
    })
    notify({
      method: "turn/completed",
      params: {
        threadId: "thread-1",
        turn: { id: "turn-1", status: "completed" },
      },
    })

    const events: HarnessEvent[] = []
    for await (const event of session.events) events.push(event)
    expect(events).toEqual([
      { type: "session.started", providerSessionId: "thread-1" },
      {
        type: "activity.started",
        activity: {
          id: "spawn-1",
          name: "Subagent",
          payload: { kind: "subagent" },
        },
      },
      {
        type: "progress.updated",
        progress: { stage: "thinking", label: "Thinking" },
      },
      {
        type: "progress.updated",
        progress: { stage: "running-tool", label: "Run command" },
      },
      { type: "turn.completed" },
    ])
    expect(JSON.stringify(events)).not.toContain("private")
  })

  it("nests child work and scopes child failures to the subagent", async () => {
    const session = await new CodexAdapter(clientFactory).start(
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
    const notify = clientState.notification!
    notify({
      method: "turn/plan/updated",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        plan: [{ step: "Research", status: "inProgress" }],
      },
    })
    notify({
      method: "turn/plan/updated",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        plan: [{ step: "Research", status: "inProgress" }],
      },
    })
    notify({
      method: "turn/plan/updated",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        plan: [{ step: "Research", status: "completed" }],
      },
    })
    const subagentItem = {
      id: "spawn-1",
      type: "subAgentActivity",
      kind: "started",
      agentThreadId: "child-thread",
      agentPath: "/root/research_repo",
    }
    notify({
      method: "item/started",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        item: subagentItem,
      },
    })
    notify({
      method: "item/completed",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        item: subagentItem,
      },
    })
    notify({
      method: "turn/plan/updated",
      params: {
        threadId: "child-thread",
        turnId: "child-turn",
        plan: [{ step: "Inspect source", status: "inProgress" }],
      },
    })
    notify({
      method: "item/started",
      params: {
        threadId: "child-thread",
        turnId: "child-turn",
        item: {
          id: "child-command",
          type: "commandExecution",
          command: "rg source",
        },
      },
    })
    notify({
      method: "error",
      params: {
        threadId: "child-thread",
        turnId: "child-turn",
        willRetry: false,
        error: { message: "Child failed" },
      },
    })
    notify({
      method: "item/completed",
      params: {
        threadId: "child-thread",
        turnId: "child-turn",
        item: {
          id: "child-command",
          type: "commandExecution",
          command: "rg source",
          status: "completed",
        },
      },
    })
    notify({
      method: "turn/completed",
      params: {
        threadId: "child-thread",
        turn: { id: "child-turn", status: "completed" },
      },
    })
    notify({
      method: "turn/completed",
      params: {
        threadId: "thread-1",
        turn: { id: "turn-1", status: "completed" },
      },
    })

    const events: HarnessEvent[] = []
    for await (const event of session.events) events.push(event)
    expect(events).toEqual([
      { type: "session.started", providerSessionId: "thread-1" },
      {
        type: "activity.started",
        activity: {
          id: "codex-plan",
          name: "Plan",
          payload: {
            kind: "plan",
            steps: [{ text: "Research", status: "active" }],
          },
        },
      },
      {
        type: "activity.updated",
        update: {
          id: "codex-plan",
          name: "Plan",
          payload: {
            kind: "plan",
            steps: [{ text: "Research", status: "done" }],
          },
        },
      },
      {
        type: "activity.started",
        activity: {
          id: "spawn-1",
          name: "Research repo",
          payload: { kind: "subagent" },
        },
      },
      {
        type: "activity.started",
        activity: {
          id: "codex-plan:child-thread",
          parentId: "spawn-1",
          name: "Plan",
          payload: {
            kind: "plan",
            steps: [{ text: "Inspect source", status: "active" }],
          },
        },
      },
      {
        type: "activity.started",
        activity: {
          id: "child-command",
          parentId: "spawn-1",
          name: "Run command",
          detail: "rg source",
          payload: { kind: "tool", tool: "command" },
        },
      },
      {
        type: "activity.completed",
        id: "codex-plan:child-thread",
        outcome: "failed",
      },
      {
        type: "activity.completed",
        id: "child-command",
        outcome: "failed",
      },
      {
        type: "activity.completed",
        id: "spawn-1",
        outcome: "failed",
      },
      { type: "turn.completed" },
    ])
  })

  it("fails a spawn that never created a delegated thread", async () => {
    const session = await new CodexAdapter(clientFactory).start(
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
    const notify = clientState.notification!
    const spawn = {
      id: "spawn-failed",
      type: "collabAgentToolCall",
      tool: "spawnAgent",
      receiverThreadIds: [],
      status: "failed",
    }
    notify({
      method: "item/started",
      params: { threadId: "thread-1", turnId: "turn-1", item: spawn },
    })
    notify({
      method: "item/completed",
      params: { threadId: "thread-1", turnId: "turn-1", item: spawn },
    })
    notify({
      method: "turn/completed",
      params: {
        threadId: "thread-1",
        turn: { id: "turn-1", status: "completed" },
      },
    })

    const events: HarnessEvent[] = []
    for await (const event of session.events) events.push(event)
    expect(events).toEqual([
      { type: "session.started", providerSessionId: "thread-1" },
      {
        type: "activity.started",
        activity: {
          id: "spawn-failed",
          name: "Subagent",
          payload: { kind: "subagent" },
        },
      },
      {
        type: "activity.completed",
        id: "spawn-failed",
        outcome: "failed",
      },
      { type: "turn.completed" },
    ])
  })

  it("fails a delegated activity when Codex interrupts its thread", async () => {
    const session = await new CodexAdapter(clientFactory).start(
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
    const notify = clientState.notification!
    const spawn = {
      id: "fleet-1",
      type: "collabAgentToolCall",
      tool: "spawnAgent",
      receiverThreadIds: ["child-thread"],
      status: "completed",
    }
    notify({
      method: "item/started",
      params: { threadId: "thread-1", turnId: "turn-1", item: spawn },
    })
    notify({
      method: "item/completed",
      params: { threadId: "thread-1", turnId: "turn-1", item: spawn },
    })
    const interruption = {
      id: "interrupt-1",
      type: "subAgentActivity",
      kind: "interrupted",
      agentThreadId: "child-thread",
    }
    notify({
      method: "item/started",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        item: interruption,
      },
    })
    notify({
      method: "item/completed",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        item: interruption,
      },
    })
    notify({
      method: "turn/completed",
      params: {
        threadId: "thread-1",
        turn: { id: "turn-1", status: "completed" },
      },
    })

    const events: HarnessEvent[] = []
    for await (const event of session.events) events.push(event)
    expect(events).toEqual([
      { type: "session.started", providerSessionId: "thread-1" },
      {
        type: "activity.started",
        activity: {
          id: "fleet-1",
          name: "Subagent",
          payload: { kind: "subagent" },
        },
      },
      {
        type: "activity.completed",
        id: "fleet-1",
        outcome: "failed",
      },
      { type: "turn.completed" },
    ])
  })

  it("uses type fallbacks only when an item status is absent", async () => {
    const session = await new CodexAdapter(clientFactory).start(
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
    const notify = clientState.notification!
    const planWithoutStatus = {
      id: "plan-without-status",
      type: "plan",
      steps: ["Research"],
    }
    const declinedPlan = {
      id: "declined-plan",
      type: "plan",
      status: "declined",
      steps: ["Write"],
    }
    for (const item of [planWithoutStatus, declinedPlan]) {
      notify({
        method: "item/started",
        params: { threadId: "thread-1", turnId: "turn-1", item },
      })
      notify({
        method: "item/completed",
        params: { threadId: "thread-1", turnId: "turn-1", item },
      })
    }
    notify({
      method: "turn/completed",
      params: {
        threadId: "thread-1",
        turn: { id: "turn-1", status: "completed" },
      },
    })

    const events: HarnessEvent[] = []
    for await (const event of session.events) events.push(event)
    expect(events).toEqual([
      { type: "session.started", providerSessionId: "thread-1" },
      {
        type: "activity.started",
        activity: {
          id: "plan-without-status",
          name: "Plan",
          payload: {
            kind: "plan",
            steps: [{ text: "Research", status: "pending" }],
          },
        },
      },
      {
        type: "activity.completed",
        id: "plan-without-status",
        outcome: "completed",
      },
      {
        type: "activity.started",
        activity: {
          id: "declined-plan",
          name: "Plan",
          payload: {
            kind: "plan",
            steps: [{ text: "Write", status: "pending" }],
          },
        },
      },
      {
        type: "activity.completed",
        id: "declined-plan",
        outcome: "failed",
      },
      { type: "turn.completed" },
    ])
  })

  it("keeps a fleet running until every delegated thread settles", async () => {
    const session = await new CodexAdapter(clientFactory).start(
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
    const notify = clientState.notification!
    const spawn = {
      id: "fleet-1",
      type: "collabAgentToolCall",
      tool: "spawnAgent",
      prompt: "Compare changes",
      receiverThreadIds: ["child-a", "child-b"],
      status: "completed",
    }
    notify({
      method: "item/started",
      params: { threadId: "thread-1", turnId: "turn-1", item: spawn },
    })
    notify({
      method: "item/completed",
      params: { threadId: "thread-1", turnId: "turn-1", item: spawn },
    })
    notify({
      method: "turn/completed",
      params: {
        threadId: "child-a",
        turn: { id: "turn-a", status: "failed" },
      },
    })
    const childCommand = {
      id: "child-b-command",
      type: "commandExecution",
      command: "git diff --check",
      status: "completed",
    }
    notify({
      method: "item/started",
      params: {
        threadId: "child-b",
        turnId: "turn-b",
        item: childCommand,
      },
    })
    notify({
      method: "item/completed",
      params: {
        threadId: "child-b",
        turnId: "turn-b",
        item: childCommand,
      },
    })
    notify({
      method: "turn/completed",
      params: {
        threadId: "child-b",
        turn: { id: "turn-b", status: "completed" },
      },
    })
    notify({
      method: "turn/completed",
      params: {
        threadId: "thread-1",
        turn: { id: "turn-1", status: "completed" },
      },
    })

    const events: HarnessEvent[] = []
    for await (const event of session.events) events.push(event)
    expect(events).toEqual([
      { type: "session.started", providerSessionId: "thread-1" },
      {
        type: "activity.started",
        activity: {
          id: "fleet-1",
          name: "Compare changes",
          payload: { kind: "subagent" },
        },
      },
      {
        type: "activity.started",
        activity: {
          id: "child-b-command",
          parentId: "fleet-1",
          name: "Run command",
          detail: "git diff --check",
          payload: { kind: "tool", tool: "command" },
        },
      },
      {
        type: "activity.completed",
        id: "child-b-command",
        outcome: "completed",
      },
      {
        type: "activity.completed",
        id: "fleet-1",
        outcome: "failed",
      },
      { type: "turn.completed" },
    ])
  })
})

describe("codexLimitResetAt", () => {
  it("reads the app-server camel-case payload and chooses the most-used limit", () => {
    const primaryReset = 1_754_000_000
    const secondaryReset = 1_755_000_000

    expect(
      codexLimitResetAt({
        rateLimits: {
          primary: { usedPercent: 95, resetsAt: primaryReset },
          secondary: { usedPercent: 40, resetsAt: secondaryReset },
        },
      })
    ).toBe(new Date(primaryReset * 1000).toISOString())
  })

  it("reads snake-case transcript data with millisecond timestamps", () => {
    const reset = 1_754_000_000_000

    expect(
      codexLimitResetAt({
        primary: { used_percent: 100, resets_at: reset },
      })
    ).toBe(new Date(reset).toISOString())
  })

  it("ignores malformed rate-limit data", () => {
    expect(codexLimitResetAt({ rateLimits: { primary: {} } })).toBeUndefined()
    expect(codexLimitResetAt(null)).toBeUndefined()
  })
})

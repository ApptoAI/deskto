import {
  jsonValueSchema,
  type JsonObject,
  type JsonValue,
  type RuntimeTransport,
  type ThreadView,
} from "@deskto/protocol"
import { afterEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"

import { startDesktoMcpServer } from "./server.js"
import type { DesktoMcpServer } from "./types.js"

const now = "2026-08-17T10:00:00.000Z"
const view: ThreadView = {
  thread: {
    id: "thread-1",
    projectId: "project-1",
    parentThreadId: null,
    title: "Ship orchestration",
    harnessId: "codex",
    status: "running",
    executionProfile: {
      modelId: "gpt-5",
      effort: "high",
      permissionMode: "auto",
    },
    lastUserMessageAt: now,
    lastTurnCompletedAt: null,
    failedAt: null,
    lastVisitedAt: now,
    pinnedAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    doneOverride: null,
    doneAt: null,
    createdAt: now,
    updatedAt: now,
  },
  childThreads: [],
  messages: [],
  activities: [],
  seq: 0,
}

const listPayloadSchema = z.object({
  result: z.object({ tools: z.array(z.object({ name: z.string() })) }),
})
const contextPayloadSchema = z.object({
  result: z.object({
    structuredContent: z.object({ thread: z.object({ id: z.string() }) }),
  }),
})
const createPayloadSchema = z.object({
  result: z.object({
    structuredContent: z.object({
      threads: z.array(z.object({ id: z.string(), status: z.string() })),
      errors: z.array(
        z.object({
          threadId: z.string().nullable(),
          stage: z.enum(["create", "start"]),
          message: z.string(),
        })
      ),
    }),
  }),
})

function fakeRuntime(
  options: { failTurnStart?: boolean } = {}
): RuntimeTransport {
  // SAFETY: the switch returns the matching Runtime response shape for every
  // method this MCP server test calls. Unexpected methods throw.
  const request = vi.fn(async (request) => {
    switch (request.method) {
      case "thread.get":
        return { ok: true, data: view }
      case "project.list":
        return {
          ok: true,
          data: [
            {
              id: "project-1",
              workspaceId: "personal",
              name: "Deskto",
              path: "/tmp/deskto",
              createdAt: now,
              updatedAt: now,
            },
          ],
        }
      case "workspace.list":
        return {
          ok: true,
          data: [
            {
              id: "personal",
              name: "Personal",
              color: "blue",
              icon: "house",
              sortOrder: 0,
              createdAt: now,
              updatedAt: now,
            },
          ],
        }
      case "harness.list":
        return {
          ok: true,
          data: [
            {
              id: "codex",
              name: "Codex",
              enabled: true,
              availability: { status: "available" as const },
              checkedAt: now,
              models: [],
            },
          ],
        }
      case "thread.create":
        return {
          ok: true,
          data: {
            ...view.thread,
            id: "child-1",
            parentThreadId: "thread-1",
            title: "Check startup",
            status: "idle" as const,
            lastUserMessageAt: null,
          },
        }
      case "turn.start": {
        if (!options.failTurnStart) throw new Error("Unexpected turn.start")
        return {
          ok: true,
          data: {
            ...view,
            thread: {
              ...view.thread,
              id: "child-1",
              parentThreadId: "thread-1",
              title: "Check startup",
              status: "failed" as const,
              failedAt: now,
            },
            messages: [
              {
                id: "user-1",
                threadId: "child-1",
                role: "user" as const,
                content: "Check startup",
                state: "complete" as const,
                createdAt: now,
              },
              {
                id: "assistant-1",
                threadId: "child-1",
                role: "assistant" as const,
                content: "Harness executable is unavailable",
                state: "error" as const,
                failure: {
                  kind: "error" as const,
                  message: "Harness executable is unavailable",
                },
                createdAt: now,
              },
            ],
          },
        }
      }
      default:
        throw new Error(`Unexpected method ${request.method}`)
    }
  }) as RuntimeTransport["request"]
  return {
    request,
    subscribe: () => () => undefined,
  }
}

async function postMcp(url: string, token: string, body: JsonObject) {
  return fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": "2025-11-25",
    },
    body: JSON.stringify(body),
  })
}

async function responsePayload(response: Response): Promise<JsonValue> {
  const body = await response.text()
  if (!body.startsWith("event:")) return jsonValueSchema.parse(JSON.parse(body))
  const data = body
    .split("\n")
    .find((line) => line.startsWith("data: "))
    ?.slice("data: ".length)
  if (!data) throw new Error("MCP response did not contain an SSE data frame")
  return jsonValueSchema.parse(JSON.parse(data))
}

async function postModernMcp(
  url: string,
  token: string,
  method: string,
  body: JsonObject,
  name?: string
) {
  const headers = new Headers({
    authorization: `Bearer ${token}`,
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    "mcp-protocol-version": "2026-07-28",
    "mcp-method": method,
  })
  if (name) headers.set("mcp-name", name)
  return fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  })
}

describe("Deskto MCP server", () => {
  let server: DesktoMcpServer | undefined

  afterEach(async () => {
    await server?.close()
    server = undefined
  })

  it("binds locally and rejects requests without a session token", async () => {
    server = await startDesktoMcpServer({ runtime: fakeRuntime() })

    expect(new URL(server.url).hostname).toBe("127.0.0.1")
    const response = await fetch(server.url, { method: "POST" })
    expect(response.status).toBe(401)

    const connection = server.connectionFor({
      threadId: "thread-1",
      turnId: "turn-1",
      projectId: "project-1",
      workspaceId: "personal",
    })
    const crossOrigin = await fetch(server.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${connection.authorizationToken}`,
        origin: "https://attacker.example",
      },
    })
    expect(crossOrigin.status).toBe(403)

    server.revokeTurn("turn-1")
    const revoked = await fetch(server.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${connection.authorizationToken}`,
      },
    })
    expect(revoked.status).toBe(401)
  })

  it("serves tools and resolves context for the bound task", async () => {
    const runtime = fakeRuntime()
    server = await startDesktoMcpServer({ runtime })
    const connection = server.connectionFor({
      threadId: "thread-1",
      turnId: "turn-1",
      projectId: "project-1",
      workspaceId: "personal",
    })

    const initialized = await postMcp(
      server.url,
      connection.authorizationToken,
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "test", version: "1" },
        },
      }
    )
    expect(initialized.status).toBe(200)

    const listed = await postMcp(server.url, connection.authorizationToken, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    })
    const listPayload = listPayloadSchema.parse(await responsePayload(listed))
    expect(listPayload.result.tools.map((tool) => tool.name)).toContain(
      "deskto_create_threads"
    )
    expect(listPayload.result.tools.map((tool) => tool.name)).toContain(
      "deskto_search_threads"
    )

    const called = await postMcp(server.url, connection.authorizationToken, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "deskto_context", arguments: {} },
    })
    const callPayload = contextPayloadSchema.parse(
      await responsePayload(called)
    )
    expect(callPayload.result.structuredContent.thread.id).toBe("thread-1")
  })

  it("serves the stateless 2026-07-28 protocol", async () => {
    server = await startDesktoMcpServer({ runtime: fakeRuntime() })
    const connection = server.connectionFor({
      threadId: "thread-1",
      turnId: "turn-1",
      projectId: "project-1",
      workspaceId: "personal",
    })
    const response = await postModernMcp(
      server.url,
      connection.authorizationToken,
      "tools/list",
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientCapabilities": {},
            "io.modelcontextprotocol/clientInfo": {
              name: "test",
              version: "1",
            },
          },
        },
      }
    )
    const payload = listPayloadSchema.parse(await responsePayload(response))
    expect(response.status).toBe(200)
    expect(payload.result.tools).toHaveLength(8)
  })

  it("reports a Runtime startup failure without losing the child id", async () => {
    server = await startDesktoMcpServer({
      runtime: fakeRuntime({ failTurnStart: true }),
    })
    const connection = server.connectionFor({
      threadId: "thread-1",
      turnId: "turn-1",
      projectId: "project-1",
      workspaceId: "personal",
    })
    await postMcp(server.url, connection.authorizationToken, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
      },
    })

    const response = await postMcp(server.url, connection.authorizationToken, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "deskto_create_threads",
        arguments: { tasks: [{ prompt: "Check startup" }] },
      },
    })
    const payload = createPayloadSchema.parse(await responsePayload(response))

    expect(payload.result.structuredContent.threads).toMatchObject([
      { id: "child-1", status: "failed" },
    ])
    expect(payload.result.structuredContent.errors).toMatchObject([
      {
        threadId: "child-1",
        stage: "start",
        message: "Harness executable is unavailable",
      },
    ])
  })
})

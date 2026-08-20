import {
  jsonValueSchema,
  type JsonObject,
  type JsonValue,
} from "@deskto/protocol"
import { afterEach, describe, expect, it } from "vitest"
import { z } from "zod"

import { startDesktoMcpServer } from "./server.js"
import { artifactRuntime, fakeRuntime } from "./test-fixtures.js"
import type { DesktoMcpServer } from "./types.js"

const listPayloadSchema = z.object({
  result: z.object({ tools: z.array(z.object({ name: z.string() })) }),
})
const contextPayloadSchema = z.object({
  result: z.object({
    structuredContent: z.object({ thread: z.object({ id: z.string() }) }),
  }),
})
const dependenciesPayloadSchema = z.object({
  result: z.object({
    structuredContent: z.object({
      nodeModulesPath: z.string(),
      versions: z.object({ artifactTool: z.string() }),
    }),
  }),
})

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

    const localhostHost = await fetch(server.url, {
      method: "POST",
      headers: { host: `localhost:${new URL(server.url).port}` },
    })
    expect(localhostHost.status).toBe(401)

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

  it("advertises the artifact runtime only when it is complete", async () => {
    server = await startDesktoMcpServer({
      runtime: fakeRuntime(),
      artifactRuntime,
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

    const listed = await postMcp(server.url, connection.authorizationToken, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    })
    const listPayload = listPayloadSchema.parse(await responsePayload(listed))
    expect(listPayload.result.tools.map((tool) => tool.name)).toContain(
      "load_workspace_dependencies"
    )

    const called = await postMcp(server.url, connection.authorizationToken, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "load_workspace_dependencies", arguments: {} },
    })
    const payload = dependenciesPayloadSchema.parse(
      await responsePayload(called)
    )
    expect(payload.result.structuredContent).toEqual({
      nodeModulesPath: "/runtime/node/node_modules",
      versions: { artifactTool: "2.8.39" },
    })
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
})

import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import type { JsonValue } from "@deskto/protocol"
import { afterEach, describe, expect, it } from "vitest"
import { z } from "zod"

import {
  piMcpEnvironment,
  piMcpExtensionSource,
  piMcpServersEnvironment,
} from "./pi-mcp-extension.js"

const temporaryPaths: string[] = []
const addressSchema = z.object({ port: z.number() })
const requestBodySchema = z.object({
  id: z.number().optional(),
  method: z.string(),
  params: z
    .object({
      name: z.string().optional(),
      arguments: z.object({ query: z.string().optional() }).optional(),
    })
    .optional(),
})
type TestRequestBody = z.infer<typeof requestBodySchema>
type RecordedRequest = {
  method: string
  authorization?: string
  sessionId?: string
  body?: TestRequestBody
}

afterEach(async () => {
  delete process.env[piMcpServersEnvironment]
  await Promise.all(
    temporaryPaths.splice(0).map((path) =>
      rm(path, {
        recursive: true,
        force: true,
      })
    )
  )
})

describe("Pi MCP extension", () => {
  it("initializes MCP, registers its tools, proxies calls, and closes", async () => {
    const requests: RecordedRequest[] = []
    const server = createServer((request, response) => {
      void handleMcpRequest(request, response, requests)
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = addressSchema.safeParse(server.address())
    if (!address.success) throw new Error("No test port")

    const directory = await mkdtemp(join(tmpdir(), "deskto-pi-mcp-"))
    temporaryPaths.push(directory)
    const extensionPath = join(directory, "extension.mjs")
    await writeFile(extensionPath, piMcpExtensionSource, "utf8")
    process.env[piMcpServersEnvironment] = JSON.stringify([
      {
        id: "deskto",
        url: `http://127.0.0.1:${address.data.port}/mcp`,
        authorization: { type: "bearer", token: "turn-token" },
      },
    ])

    const tools: PiTool[] = []
    let shutdown: (() => Promise<void>) | undefined
    const module = await import(`${pathToFileURL(extensionPath).href}?test=1`)
    await module.default({
      registerTool: (tool: PiTool) => tools.push(tool),
      on: (event: string, listener: () => Promise<void>) => {
        if (event === "session_shutdown") shutdown = listener
      },
    })

    expect(process.env[piMcpServersEnvironment]).toBeUndefined()
    expect(tools).toHaveLength(1)
    expect(tools[0]).toMatchObject({
      name: "deskto_search_threads",
      label: "Search tasks",
      description: "Search Deskto tasks",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    })

    await expect(
      tools[0]!.execute(
        "call-1",
        { query: "renewals" },
        new AbortController().signal
      )
    ).resolves.toEqual({
      content: [
        { type: "text", text: "Found one task" },
        { type: "image", data: "AAAA", mimeType: "image/png" },
      ],
      details: { count: 1 },
    })
    await shutdown?.()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )

    expect(
      requests.map((request) => request.body?.method ?? request.method)
    ).toEqual([
      "initialize",
      "notifications/initialized",
      "tools/list",
      "tools/call",
      "DELETE",
    ])
    expect(
      requests.every((request) => request.authorization === "Bearer turn-token")
    ).toBe(true)
    expect(
      requests.slice(1).every((request) => request.sessionId === "session-1")
    ).toBe(true)
    expect(requests[3]?.body).toMatchObject({
      params: {
        name: "deskto_search_threads",
        arguments: { query: "renewals" },
      },
    })
  })

  it("adds MCP configuration without dropping the child environment", () => {
    expect(
      piMcpEnvironment([{ id: "deskto", url: "http://127.0.0.1/mcp" }], {
        PATH: "/bin",
      })
    ).toEqual({
      PATH: "/bin",
      [piMcpServersEnvironment]: JSON.stringify([
        { id: "deskto", url: "http://127.0.0.1/mcp" },
      ]),
    })
  })
})

type PiTool = {
  name: string
  execute(
    id: string,
    params: { query?: string },
    signal: AbortSignal
  ): Promise<PiToolResult>
}

type PiToolResult = {
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  >
  details?: { count: number }
}

async function handleMcpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  requests: RecordedRequest[]
): Promise<void> {
  const body =
    request.method === "DELETE"
      ? undefined
      : requestBodySchema.parse(JSON.parse(await readBody(request)))
  const recorded: RecordedRequest = { method: request.method ?? "" }
  if (request.headers.authorization) {
    recorded.authorization = request.headers.authorization
  }
  const sessionId = z.string().safeParse(request.headers["mcp-session-id"])
  if (sessionId.success) recorded.sessionId = sessionId.data
  if (body) recorded.body = body
  requests.push(recorded)
  if (request.method === "DELETE") {
    response.writeHead(204).end()
    return
  }
  response.setHeader("mcp-session-id", "session-1")
  if (body?.method === "notifications/initialized") {
    response.writeHead(202).end()
    return
  }
  if (body?.method === "initialize") {
    json(response, {
      jsonrpc: "2.0",
      id: body.id ?? 0,
      result: {
        protocolVersion: "2025-11-25",
        capabilities: { tools: {} },
        serverInfo: { name: "test", version: "1" },
      },
    })
    return
  }
  if (body?.method === "tools/list") {
    response.writeHead(200, { "content-type": "text/event-stream" })
    response.end(
      `event: message\ndata: ${JSON.stringify({
        jsonrpc: "2.0",
        id: body.id ?? 0,
        result: {
          tools: [
            {
              name: "deskto_search_threads",
              title: "Search tasks",
              description: "Search Deskto tasks",
              inputSchema: {
                type: "object",
                properties: { query: { type: "string" } },
                required: ["query"],
              },
            },
          ],
        },
      })}\n\n`
    )
    return
  }
  json(response, {
    jsonrpc: "2.0",
    id: body?.id ?? 0,
    result: {
      content: [
        { type: "text", text: "Found one task" },
        { type: "image", data: "AAAA", mimeType: "image/png" },
      ],
      structuredContent: { count: 1 },
    },
  })
}

function json(response: ServerResponse, body: JsonValue): void {
  response.writeHead(200, { "content-type": "application/json" })
  response.end(JSON.stringify(body))
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString("utf8")
}

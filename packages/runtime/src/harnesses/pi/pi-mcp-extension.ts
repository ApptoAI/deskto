import { randomUUID } from "node:crypto"
import { mkdir, rename, writeFile } from "node:fs/promises"
import { join } from "node:path"

import type { SessionMcpServer } from "@deskto/harness-sdk"

export const piMcpServersEnvironment = "DESKTO_PI_MCP_SERVERS"
const mcpExtensionFileName = "deskto-mcp.mjs"

// Pi deliberately has no native MCP support. This selected extension turns
// Runtime-owned Streamable HTTP servers into Pi tools without enabling
// repository-controlled extension discovery.
export const piMcpExtensionSource = `const protocolVersion = "2025-11-25"

function responseMessage(payload) {
  if (payload.error) {
    const detail = payload.error.data ? ": " + JSON.stringify(payload.error.data) : ""
    throw new Error(String(payload.error.message ?? "MCP request failed") + detail)
  }
  return payload.result
}

async function responsePayload(response, requestId) {
  const body = await response.text()
  if (!response.ok) throw new Error("MCP request failed (" + response.status + "): " + body)
  if (!body.startsWith("event:")) return JSON.parse(body)
  for (const event of body.split(/\\n\\n+/)) {
    const data = event
      .split("\\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\\n")
    if (!data) continue
    const payload = JSON.parse(data)
    if (payload.id === requestId) return payload
  }
  throw new Error("MCP response did not contain the request's SSE data frame")
}

class McpConnection {
  constructor(config) {
    this.config = config
    this.nextId = 1
    this.sessionId = undefined
  }

  headers() {
    const headers = {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": protocolVersion,
    }
    if (this.config.authorization) {
      headers.authorization = "Bearer " + this.config.authorization.token
    }
    if (this.sessionId) headers["mcp-session-id"] = this.sessionId
    return headers
  }

  async post(message, signal) {
    const response = await fetch(this.config.url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(message),
      signal,
    })
    const sessionId = response.headers.get("mcp-session-id")
    if (sessionId) this.sessionId = sessionId
    if (message.id === undefined) {
      if (!response.ok) await responsePayload(response, message.id)
      return undefined
    }
    return responseMessage(await responsePayload(response, message.id))
  }

  request(method, params, signal) {
    return this.post(
      { jsonrpc: "2.0", id: this.nextId++, method, params },
      signal
    )
  }

  async connect() {
    await this.request("initialize", {
      protocolVersion,
      capabilities: {},
      clientInfo: { name: "deskto-pi", version: "0.0.1" },
    })
    await this.post({ jsonrpc: "2.0", method: "notifications/initialized" })
  }

  async listTools() {
    const tools = []
    let cursor
    do {
      const page = await this.request("tools/list", cursor ? { cursor } : {})
      tools.push(...page.tools)
      cursor = page.nextCursor
    } while (cursor)
    return tools
  }

  callTool(name, args, signal) {
    return this.request("tools/call", { name, arguments: args }, signal)
  }

  async close() {
    if (!this.sessionId) return
    await fetch(this.config.url, {
      method: "DELETE",
      headers: this.headers(),
    }).catch(() => undefined)
  }
}

function toolContent(result) {
  const content = Array.isArray(result.content)
    ? result.content.flatMap((item) => {
        if (item?.type === "text" && typeof item.text === "string") return [item]
        if (
          item?.type === "image" &&
          typeof item.data === "string" &&
          typeof item.mimeType === "string"
        ) return [item]
        return [{ type: "text", text: JSON.stringify(item) }]
      })
    : []
  if (content.length === 0 && result.structuredContent !== undefined) {
    content.push({ type: "text", text: JSON.stringify(result.structuredContent) })
  }
  if (content.length === 0) content.push({ type: "text", text: "Tool completed." })
  return content
}

export default async function (pi) {
  const serialized = process.env.${piMcpServersEnvironment}
  delete process.env.${piMcpServersEnvironment}
  if (!serialized) return

  const configs = JSON.parse(serialized)
  const connections = configs.map((config) => new McpConnection(config))
  const names = new Set()

  try {
    for (const connection of connections) {
      await connection.connect()
      for (const tool of await connection.listTools()) {
        if (names.has(tool.name)) {
          throw new Error("MCP tool name conflicts with another Pi tool: " + tool.name)
        }
        names.add(tool.name)
        pi.registerTool({
          name: tool.name,
          label: tool.title ?? tool.name,
          description: tool.description ?? "Call " + tool.name,
          parameters: tool.inputSchema ?? { type: "object", properties: {} },
          async execute(_toolCallId, params, signal) {
            const result = await connection.callTool(tool.name, params, signal)
            const content = toolContent(result)
            if (result.isError) {
              throw new Error(
                content
                  .filter((item) => item.type === "text")
                  .map((item) => item.text)
                  .join("\\n") || "MCP tool failed"
              )
            }
            return { content, details: result.structuredContent }
          },
        })
      }
    }
  } catch (error) {
    await Promise.allSettled(connections.map((connection) => connection.close()))
    throw error
  }

  pi.on("session_shutdown", async () => {
    await Promise.allSettled(connections.map((connection) => connection.close()))
  })
}
`

export async function writeMcpExtension(directory: string): Promise<string> {
  await mkdir(directory, { recursive: true })
  const file = join(directory, mcpExtensionFileName)
  const staging = `${file}.${randomUUID()}`
  await writeFile(staging, piMcpExtensionSource, {
    encoding: "utf8",
    mode: 0o600,
  })
  await rename(staging, file)
  return file
}

export function piMcpEnvironment(
  servers: readonly SessionMcpServer[],
  base: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  return {
    ...base,
    [piMcpServersEnvironment]: JSON.stringify(servers),
  }
}

import { randomBytes } from "node:crypto"
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http"

import type { AuthInfo } from "@modelcontextprotocol/server"
import { createMcpHandler } from "@modelcontextprotocol/server"
import {
  localhostHostValidation,
  localhostOriginValidation,
  toNodeHandler,
} from "@modelcontextprotocol/node"
import { z } from "zod"

import { RuntimeClient } from "./runtime-client.js"
import { createToolsServer } from "./tools/index.js"
import type {
  DesktoMcpConnection,
  DesktoMcpServer,
  DesktoMcpServerOptions,
  McpSessionContext,
  SessionBinding,
} from "./types.js"

const tokenLifetimeMs = 12 * 60 * 60 * 1_000
const localMcpHost = "127.0.0.1"
const tcpAddressSchema = z.object({ port: z.number().int().positive() })

function bearerToken(request: IncomingMessage): string | null {
  const header = request.headers.authorization
  if (!header?.startsWith("Bearer ")) return null
  return header.slice("Bearer ".length)
}

function jsonError(response: ServerResponse, status: number, message: string) {
  response.writeHead(status, { "content-type": "application/json" })
  response.end(JSON.stringify({ error: message }))
}

export async function startDesktoMcpServer(
  options: DesktoMcpServerOptions
): Promise<DesktoMcpServer> {
  const client = new RuntimeClient(options.runtime)
  const bindings = new Map<string, SessionBinding>()
  const handler = createMcpHandler((context) => {
    const token = context.authInfo?.token
    const binding = token ? bindings.get(token) : undefined
    if (!binding || binding.expiresAt <= Date.now()) {
      throw new Error("This Deskto session has expired")
    }
    return createToolsServer(client, binding, options.artifactRuntime)
  })
  const nodeHandler = toNodeHandler(handler)
  const validateHost = localhostHostValidation()
  const validateOrigin = localhostOriginValidation()

  const httpServer = createServer((request, response) => {
    if (!validateHost(request, response)) return
    if (!validateOrigin(request, response)) return
    if (request.url !== "/mcp") {
      jsonError(response, 404, "Not found")
      return
    }
    const token = bearerToken(request)
    const binding = token ? bindings.get(token) : undefined
    if (!token || !binding || binding.expiresAt <= Date.now()) {
      if (token) bindings.delete(token)
      jsonError(response, 401, "Invalid or expired bearer token")
      return
    }
    const auth: AuthInfo = {
      token,
      clientId: "deskto-local",
      scopes: ["threads:read", "threads:write"],
      expiresAt: Math.floor(binding.expiresAt / 1_000),
    }
    Object.assign(request, { auth })
    void nodeHandler(request, response)
  })

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      httpServer.off("listening", onListening)
      reject(error)
    }
    const onListening = () => {
      httpServer.off("error", onError)
      resolve()
    }
    httpServer.once("error", onError)
    httpServer.once("listening", onListening)
    httpServer.listen(options.port ?? 0, localMcpHost)
  })
  const address = tcpAddressSchema.safeParse(httpServer.address())
  if (!address.success) {
    httpServer.close()
    throw new Error("Deskto MCP server did not bind to a TCP port")
  }
  const url = `http://${localMcpHost}:${address.data.port}/mcp`

  return {
    url,
    connectionFor(context: McpSessionContext): DesktoMcpConnection {
      const now = Date.now()
      for (const [token, binding] of bindings) {
        if (binding.expiresAt <= now) bindings.delete(token)
      }
      const token = randomBytes(32).toString("base64url")
      bindings.set(token, { ...context, expiresAt: now + tokenLifetimeMs })
      return {
        id: "deskto",
        name: "Deskto background tasks",
        url,
        authorizationToken: token,
        required: true,
      }
    },
    revokeTurn(turnId: string) {
      for (const [token, binding] of bindings) {
        if (binding.turnId === turnId) bindings.delete(token)
      }
    },
    async close() {
      bindings.clear()
      try {
        await handler.close()
      } finally {
        await new Promise<void>((resolve, reject) => {
          httpServer.close((error) => (error ? reject(error) : resolve()))
        })
      }
    },
  }
}

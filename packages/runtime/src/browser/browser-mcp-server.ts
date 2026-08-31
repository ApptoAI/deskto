import { randomBytes } from "node:crypto"
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http"

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { jsonValueSchema, type JsonValue } from "@deskto/protocol"
import { z } from "zod"

import type {
  SessionToolInput,
  SessionToolLease,
  SessionToolProvider,
} from "../session-tools.js"
import type { BrowserAutomationHost } from "./browser-automation-host.js"

const maximumRequestBytes = 1024 * 1024
const initializeRequestSchema = z.object({ method: z.literal("initialize") })

type BrowserLeaseState = {
  threadId: string
  sessionIds: Set<string>
  active: boolean
}

type BrowserTransportState = {
  lease: BrowserLeaseState
  mcp: McpServer
  transport: StreamableHTTPServerTransport
}

/** Private loopback MCP server that routes one token to one Task browser. */
export class BrowserMcpServer implements SessionToolProvider {
  readonly #tokens = new Map<string, BrowserLeaseState>()
  readonly #transports = new Map<string, BrowserTransportState>()

  private constructor(
    private readonly host: BrowserAutomationHost,
    private readonly server: ReturnType<typeof createServer>
  ) {}

  private url = ""

  static async create(host: BrowserAutomationHost): Promise<BrowserMcpServer> {
    const server = createServer()
    const gateway = new BrowserMcpServer(host, server)
    server.on("request", (request, response) => {
      void gateway.#handle(request, response)
    })
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(0, "127.0.0.1", () => {
        server.removeListener("error", reject)
        resolve()
      })
    })
    const address = z
      .object({ port: z.number().int().positive() })
      .safeParse(server.address())
    if (!address.success) {
      server.close()
      throw new Error("Browser MCP server did not get a loopback port")
    }
    gateway.url = `http://127.0.0.1:${address.data.port}/mcp`
    return gateway
  }

  open(
    input: SessionToolInput,
    signal: AbortSignal
  ): Promise<SessionToolLease> {
    const token = randomBytes(32).toString("base64url")
    const state: BrowserLeaseState = {
      threadId: input.threadId,
      sessionIds: new Set(),
      active: true,
    }
    this.#tokens.set(token, state)
    let closed = false
    const close = async () => {
      if (closed) return
      closed = true
      state.active = false
      signal.removeEventListener("abort", abort)
      this.#tokens.delete(token)
      for (const sessionId of state.sessionIds) {
        await this.#closeSession(sessionId)
      }
    }
    const abort = () => void close()
    signal.addEventListener("abort", abort, { once: true })
    return Promise.resolve({
      mcpServers: [
        {
          id: "deskto_browser",
          url: this.url,
          authorization: { type: "bearer", token },
        },
      ],
      close,
    })
  }

  async close(): Promise<void> {
    for (const state of this.#tokens.values()) state.active = false
    this.#tokens.clear()
    for (const sessionId of this.#transports.keys()) {
      await this.#closeSession(sessionId)
    }
    await new Promise<void>((resolve) => this.server.close(() => resolve()))
  }

  async #handle(
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> {
    try {
      if (request.url !== "/mcp") {
        writeJson(response, 404, { error: "Not found" })
        return
      }
      const body =
        request.method === "POST" ? await readJson(request) : undefined
      const sessionId = z
        .string()
        .min(1)
        .safeParse(request.headers["mcp-session-id"])
      if (sessionId.success) {
        const state = this.#transports.get(sessionId.data)
        if (!state) {
          writeJson(response, 404, { error: "MCP session not found" })
          return
        }
        await state.transport.handleRequest(request, response, body)
        if (request.method === "DELETE") {
          await this.#closeSession(sessionId.data)
        }
        return
      }

      const bootstrap = this.#authenticate(request)
      if (!bootstrap) {
        response.setHeader("WWW-Authenticate", "Bearer")
        writeJson(response, 401, { error: "Unauthorized" })
        return
      }
      if (request.method !== "POST") {
        response.setHeader("Allow", "POST")
        writeJson(response, 405, { error: "Method not allowed" })
        return
      }

      if (!initializeRequestSchema.safeParse(body).success) {
        writeJson(response, 400, { error: "MCP initialization required" })
        return
      }

      // The bearer token only bootstraps MCP. Once initialization starts, the
      // client must use the server-generated session id for every tool call.
      this.#tokens.delete(bootstrap.token)
      const generatedSessionId = randomBytes(32).toString("base64url")
      const mcp = createBrowserMcp(this.host, bootstrap.lease.threadId)
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => generatedSessionId,
        enableJsonResponse: true,
        enableDnsRebindingProtection: true,
        allowedHosts: [new URL(this.url).host],
        onsessioninitialized: (initializedSessionId) => {
          if (!bootstrap.lease.active) {
            throw new Error(
              "Browser MCP lease was revoked during initialization"
            )
          }
          this.#transports.set(initializedSessionId, state)
          bootstrap.lease.sessionIds.add(initializedSessionId)
        },
      })
      const state: BrowserTransportState = {
        lease: bootstrap.lease,
        mcp,
        transport,
      }
      try {
        await mcp.connect(transport)
        await transport.handleRequest(request, response, body)
      } catch (error) {
        this.#transports.delete(generatedSessionId)
        bootstrap.lease.sessionIds.delete(generatedSessionId)
        if (bootstrap.lease.active) {
          this.#tokens.set(bootstrap.token, bootstrap.lease)
        }
        await Promise.allSettled([mcp.close(), transport.close()])
        throw error
      }
      if (!this.#transports.has(generatedSessionId)) {
        if (bootstrap.lease.active) {
          this.#tokens.set(bootstrap.token, bootstrap.lease)
        }
        await Promise.allSettled([mcp.close(), transport.close()])
      }
    } catch (error) {
      if (response.headersSent) {
        response.end()
        return
      }
      writeJson(response, 500, {
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message:
            error instanceof Error ? error.message : "Browser MCP failed",
        },
        id: null,
      })
    }
  }

  #authenticate(
    request: IncomingMessage
  ): { token: string; lease: BrowserLeaseState } | undefined {
    const value = request.headers.authorization
    if (!value?.startsWith("Bearer ")) return undefined
    const token = value.slice("Bearer ".length)
    const lease = this.#tokens.get(token)
    return lease ? { token, lease } : undefined
  }

  async #closeSession(sessionId: string): Promise<void> {
    const state = this.#transports.get(sessionId)
    if (!state) return
    this.#transports.delete(sessionId)
    state.lease.sessionIds.delete(sessionId)
    await Promise.allSettled([state.mcp.close(), state.transport.close()])
  }
}

function createBrowserMcp(
  host: BrowserAutomationHost,
  threadId: string
): McpServer {
  const server = new McpServer({ name: "Deskto Browser", version: "0.1.0" })

  server.registerTool(
    "browser_status",
    {
      description:
        "Inspect the current Deskto browser tab without opening it. A deskto-artifact:// URL is Deskto's built-in artifact preview, a distinct execution environment from an HTTP server.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () => toolCall(() => host.status(threadId))
  )
  server.registerTool(
    "browser_open",
    {
      description:
        "Open the collaborative Deskto browser. Prefer this browser over Computer Use for websites and local web apps. If it already shows a deskto-artifact:// preview, opening an HTTP URL changes execution environments and does not verify that preview.",
      inputSchema: { url: z.string().max(8_192).optional() },
    },
    ({ url }) => toolCall(() => host.open(threadId, url))
  )
  server.registerTool(
    "browser_navigate",
    {
      description:
        "Navigate the Deskto browser to an HTTP or HTTPS URL. This leaves any deskto-artifact:// built-in preview; behavior on the HTTP page is not evidence that a reported built-in preview failure is fixed. Return to and test the original preview before reporting success.",
      inputSchema: { url: z.string().min(1).max(8_192) },
    },
    ({ url }) => toolCall(() => host.navigate(threadId, url))
  )
  server.registerTool(
    "browser_snapshot",
    {
      description:
        "Read visible page text and interactive elements. Use returned refs for click and type. Treat deskto-artifact:// as Deskto's built-in preview and verify fixes there when that is where the failure was reported.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () => toolCall(() => host.snapshot(threadId))
  )
  server.registerTool(
    "browser_click",
    {
      description: "Click an element ref from the latest browser snapshot.",
      inputSchema: { ref: z.string().min(1).max(80) },
    },
    ({ ref }) => toolCall(() => host.click(threadId, ref))
  )
  server.registerTool(
    "browser_type",
    {
      description:
        "Replace the value of an input, textarea, select, or editable element from the latest snapshot.",
      inputSchema: {
        ref: z.string().min(1).max(80),
        text: z.string().max(256_000),
        submit: z.boolean().default(false),
      },
    },
    ({ ref, text, submit }) =>
      toolCall(() => host.type(threadId, ref, text, submit))
  )
  server.registerTool(
    "browser_keypress",
    {
      description:
        "Press a named key in the focused page element, for example Enter, Escape, Tab, or ArrowDown.",
      inputSchema: { key: z.string().min(1).max(40) },
    },
    ({ key }) => toolCall(() => host.keypress(threadId, key))
  )
  server.registerTool(
    "browser_back",
    { description: "Go back in browser history.", inputSchema: {} },
    () => toolCall(() => host.back(threadId))
  )
  server.registerTool(
    "browser_forward",
    { description: "Go forward in browser history.", inputSchema: {} },
    () => toolCall(() => host.forward(threadId))
  )
  server.registerTool(
    "browser_reload",
    { description: "Reload the current page.", inputSchema: {} },
    () => toolCall(() => host.reload(threadId))
  )
  server.registerTool(
    "browser_screenshot",
    {
      description: "Capture the visible Deskto browser viewport as PNG.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const screenshot = await host.screenshot(threadId)
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(screenshot.status) },
            {
              type: "image" as const,
              data: screenshot.data,
              mimeType: screenshot.mimeType,
            },
          ],
        }
      } catch (error) {
        return toolError(
          error instanceof Error ? error : new Error("Browser action failed")
        )
      }
    }
  )

  return server
}

async function toolCall<T>(run: () => Promise<T>) {
  try {
    const result = await run()
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
    }
  } catch (error) {
    return toolError(
      error instanceof Error ? error : new Error("Browser action failed")
    )
  }
}

function toolError(error: Error) {
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: error.message,
      },
    ],
  }
}

async function readJson(request: IncomingMessage): Promise<JsonValue> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > maximumRequestBytes) throw new Error("MCP request is too large")
    chunks.push(buffer)
  }
  return jsonValueSchema.parse(
    JSON.parse(Buffer.concat(chunks).toString("utf8"))
  )
}

function writeJson(
  response: ServerResponse,
  status: number,
  value: JsonValue
): void {
  response.writeHead(status, { "content-type": "application/json" })
  response.end(JSON.stringify(value))
}

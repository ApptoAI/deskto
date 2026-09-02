import { randomBytes } from "node:crypto"
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http"
import { setTimeout as sleep } from "node:timers/promises"

import {
  localhostHostValidation,
  localhostOriginValidation,
  NodeStreamableHTTPServerTransport,
} from "@modelcontextprotocol/node"
import { McpServer } from "@modelcontextprotocol/server"
import { computerUseSettings, settingValue } from "@deskto/settings"
import {
  jsonValueSchema,
  type JsonObject,
  type JsonValue,
} from "@deskto/protocol"
import { z } from "zod"

import type {
  SessionToolInput,
  SessionToolLease,
  SessionToolProvider,
} from "../session-tools.js"
import {
  clickInputSchema,
  clickEvents,
  dragEvents,
  dragInputSchema,
  emptyInputSchema,
  keyEvents,
  keyInputSchema,
  mouseMoveEvents,
  mouseMoveInputSchema,
  parseModifiers,
  pointFrom,
  scrollEvents,
  scrollInputSchema,
  typeEvents,
  typeInputSchema,
  waitInputSchema,
} from "./computer-use-actions.js"
import type {
  ComputerUseHost,
  ComputerUseInputEvent,
  ComputerUsePage,
  ComputerUsePoint,
  ComputerUseSize,
} from "./computer-use-host.js"

export const computerUseMcpServerId = "deskto_computer_use"

const localHost = "127.0.0.1"
const tcpAddressSchema = z.object({ port: z.number().int().positive() })
const initializeRequestSchema = z.object({ method: z.literal("initialize") })
const maximumRequestBytes = 1024 * 1024
const maximumScreenshotBytes = 8 * 1024 * 1024
/** Keeps input events from landing before the page has painted the last one. */
const inputSettleMs = 50

type ComputerUseLeaseState = {
  threadId: string
  sessionIds: Set<string>
  active: boolean
}

type ComputerUseTransportState = {
  lease: ComputerUseLeaseState
  mcp: McpServer
  transport: NodeStreamableHTTPServerTransport
}

function jsonError(response: ServerResponse, status: number, message: string) {
  response.writeHead(status, { "content-type": "application/json" })
  response.end(JSON.stringify({ error: message }))
}

function bearerToken(request: IncomingMessage): string | undefined {
  const header = request.headers.authorization
  if (!header?.startsWith("Bearer ")) return undefined
  return header.slice("Bearer ".length)
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

/**
 * Private loopback MCP server that gives one Turn screen-level control of
 * its Task's browser page. Each Turn gets a one-time bearer token; the token
 * dies with the Turn's lease, and tool arguments cannot name another Task.
 */
export class ComputerUseMcpServer implements SessionToolProvider {
  private constructor(
    private readonly httpServer: ReturnType<typeof createServer>,
    private readonly host: ComputerUseHost,
    private readonly tokens: Map<string, ComputerUseLeaseState>,
    private readonly transports: Map<string, ComputerUseTransportState>,
    private readonly cursors: Map<string, ComputerUsePoint>,
    readonly url: string
  ) {}

  static async create(host: ComputerUseHost): Promise<ComputerUseMcpServer> {
    const tokens = new Map<string, ComputerUseLeaseState>()
    const transports = new Map<string, ComputerUseTransportState>()
    const cursors = new Map<string, ComputerUsePoint>()
    const httpServer = createServer()
    const validateHost = localhostHostValidation()
    const validateOrigin = localhostOriginValidation()
    const addressReady = new Promise<void>((resolve, reject) => {
      httpServer.once("error", reject)
      httpServer.listen(0, localHost, () => {
        httpServer.removeListener("error", reject)
        resolve()
      })
    })
    await addressReady
    const address = tcpAddressSchema.safeParse(httpServer.address())
    if (!address.success) {
      httpServer.close()
      throw new Error("Screen control MCP server did not get a loopback port")
    }
    const url = `http://${localHost}:${address.data.port}/mcp`
    const gateway = new ComputerUseMcpServer(
      httpServer,
      host,
      tokens,
      transports,
      cursors,
      url
    )
    httpServer.on("request", (request, response) => {
      if (!validateHost(request, response)) return
      if (!validateOrigin(request, response)) return
      void gateway.#handle(request, response)
    })
    return gateway
  }

  open(
    input: SessionToolInput,
    signal: AbortSignal
  ): Promise<SessionToolLease | undefined> {
    if (
      !settingValue(input.settings, computerUseSettings.screenControlEnabled)
    ) {
      return Promise.resolve(undefined)
    }
    const token = randomBytes(32).toString("base64url")
    const state: ComputerUseLeaseState = {
      threadId: input.threadId,
      sessionIds: new Set(),
      active: true,
    }
    this.tokens.set(token, state)
    let closed = false
    const close = async () => {
      if (closed) return
      closed = true
      state.active = false
      signal.removeEventListener("abort", abort)
      this.tokens.delete(token)
      for (const sessionId of state.sessionIds) {
        await this.#closeSession(sessionId)
      }
    }
    const abort = () => void close()
    signal.addEventListener("abort", abort, { once: true })
    return Promise.resolve({
      mcpServers: [
        {
          id: computerUseMcpServerId,
          url: this.url,
          authorization: { type: "bearer", token },
        },
      ],
      close,
    })
  }

  async close(): Promise<void> {
    for (const state of this.tokens.values()) state.active = false
    this.tokens.clear()
    this.cursors.clear()
    for (const sessionId of this.transports.keys()) {
      await this.#closeSession(sessionId)
    }
    await new Promise<void>((resolve) => this.httpServer.close(() => resolve()))
  }

  async #handle(
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> {
    try {
      if (request.url !== "/mcp") {
        jsonError(response, 404, "Not found")
        return
      }

      const sessionId = z
        .string()
        .min(1)
        .safeParse(request.headers["mcp-session-id"])
      if (sessionId.success) {
        const state = this.transports.get(sessionId.data)
        if (!state || !state.lease.active) {
          jsonError(response, 404, "Screen control session not found")
          return
        }
        await state.transport.handleRequest(request, response)
        if (request.method === "DELETE") {
          await this.#closeSession(sessionId.data)
        }
        return
      }

      const token = bearerToken(request)
      const lease = token ? this.tokens.get(token) : undefined
      if (!token || !lease || !lease.active) {
        response.setHeader("WWW-Authenticate", "Bearer")
        jsonError(response, 401, "Unauthorized")
        return
      }
      if (request.method !== "POST") {
        response.setHeader("Allow", "POST")
        jsonError(response, 405, "Method not allowed")
        return
      }

      const body = await readJson(request)
      if (!initializeRequestSchema.safeParse(body).success) {
        jsonError(response, 400, "MCP initialization required")
        return
      }
      if (this.tokens.get(token) !== lease) {
        response.setHeader("WWW-Authenticate", "Bearer")
        jsonError(response, 401, "Unauthorized")
        return
      }

      this.tokens.delete(token)
      const generatedSessionId = randomBytes(32).toString("base64url")
      const mcp = createComputerUseMcp(this.host, lease.threadId, this.cursors)
      const transport = new NodeStreamableHTTPServerTransport({
        sessionIdGenerator: () => generatedSessionId,
        enableJsonResponse: true,
        onsessioninitialized: (initializedSessionId) => {
          if (!lease.active) {
            throw new Error(
              "Screen control lease was revoked during initialization"
            )
          }
          this.transports.set(initializedSessionId, state)
          lease.sessionIds.add(initializedSessionId)
        },
      })
      const state: ComputerUseTransportState = { lease, mcp, transport }
      try {
        await mcp.connect(transport)
        await transport.handleRequest(request, response, body)
      } catch (error) {
        this.transports.delete(generatedSessionId)
        lease.sessionIds.delete(generatedSessionId)
        if (lease.active) this.tokens.set(token, lease)
        await Promise.allSettled([mcp.close(), transport.close()])
        throw error
      }
      if (!this.transports.has(generatedSessionId)) {
        if (lease.active) this.tokens.set(token, lease)
        await Promise.allSettled([mcp.close(), transport.close()])
      }
    } catch (error) {
      if (response.headersSent) {
        response.end()
        return
      }
      jsonError(
        response,
        500,
        error instanceof Error ? error.message : "Screen control failed"
      )
    }
  }

  async #closeSession(sessionId: string): Promise<void> {
    const state = this.transports.get(sessionId)
    if (!state) return
    this.transports.delete(sessionId)
    state.lease.sessionIds.delete(sessionId)
    await Promise.allSettled([state.mcp.close(), state.transport.close()])
  }
}

type ToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: "image/png" }

type ToolResult = { content: ToolContent[]; isError?: boolean }

function textResult(value: JsonObject): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] }
}

function errorResult(error: Error): ToolResult {
  return { isError: true, content: [{ type: "text", text: error.message }] }
}

async function guarded(run: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await run()
  } catch (error) {
    return errorResult(
      error instanceof Error ? error : new Error("Screen action failed")
    )
  }
}

async function capture(page: ComputerUsePage): Promise<ToolContent[]> {
  const size = page.size()
  const image = await page.capturePage()
  const png = image.resize(size).toPNG()
  if (png.byteLength > maximumScreenshotBytes) {
    throw new Error("Screen control screenshot exceeds the 8 MB limit")
  }
  return [
    { type: "text", text: JSON.stringify({ display: size }) },
    {
      type: "image",
      data: png.toString("base64"),
      mimeType: "image/png",
    },
  ]
}

async function send(
  page: ComputerUsePage,
  events: ComputerUseInputEvent[]
): Promise<void> {
  for (const event of events) page.sendInputEvent(event)
  await sleep(inputSettleMs)
}

function lastPoint(
  events: ComputerUseInputEvent[]
): ComputerUsePoint | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event && "x" in event) return { x: event.x, y: event.y }
  }
  return undefined
}

function createComputerUseMcp(
  host: ComputerUseHost,
  threadId: string,
  cursors: Map<string, ComputerUsePoint>
): McpServer {
  const server = new McpServer(
    { name: "Deskto screen control", version: "0.1.0" },
    {
      instructions:
        "These tools operate the Deskto task browser by screen position, like a person with a mouse and keyboard. Take a screenshot first, act on its coordinates, then screenshot again to verify. For websites, prefer the browser_* tools when a semantic snapshot is enough; use these when a page needs real pointer or keyboard input.",
    }
  )

  const act = (
    build: (size: ComputerUseSize) => ComputerUseInputEvent[]
  ): Promise<ToolResult> =>
    guarded(() =>
      host.operate(threadId, async (page) => {
        const events = build(page.size())
        await send(page, events)
        const point = lastPoint(events)
        if (point) cursors.set(threadId, point)
        return { content: await capture(page) }
      })
    )

  server.registerTool(
    "computer_screenshot",
    {
      description:
        "Capture the task browser as a PNG. Coordinates for every other tool are pixel positions on this image.",
      inputSchema: emptyInputSchema,
      annotations: { readOnlyHint: true },
    },
    () =>
      guarded(() =>
        host.operate(threadId, async (page) => ({
          content: await capture(page),
        }))
      )
  )
  server.registerTool(
    "computer_display_info",
    {
      description:
        "Report the size of the task browser's display in pixels. Screenshots have this size.",
      inputSchema: emptyInputSchema,
      annotations: { readOnlyHint: true },
    },
    () =>
      guarded(() =>
        host.operate(threadId, (page) =>
          Promise.resolve(textResult({ display: page.size(), displays: 1 }))
        )
      )
  )
  server.registerTool(
    "computer_cursor_position",
    {
      description:
        "Report where the last screen action left the mouse pointer.",
      inputSchema: emptyInputSchema,
      annotations: { readOnlyHint: true },
    },
    () =>
      Promise.resolve(
        textResult({ position: cursors.get(threadId) ?? { x: 0, y: 0 } })
      )
  )
  server.registerTool(
    "computer_left_click",
    {
      description:
        "Click the left mouse button at a screenshot coordinate. Returns a fresh screenshot; verify the intended change on it before claiming success.",
      inputSchema: clickInputSchema,
    },
    ({ coordinate, text }) =>
      act((size) =>
        clickEvents(
          pointFrom(coordinate),
          size,
          "left",
          1,
          parseModifiers(text)
        )
      )
  )
  server.registerTool(
    "computer_right_click",
    {
      description:
        "Click the right mouse button at a screenshot coordinate and return a fresh screenshot.",
      inputSchema: clickInputSchema,
    },
    ({ coordinate, text }) =>
      act((size) =>
        clickEvents(
          pointFrom(coordinate),
          size,
          "right",
          1,
          parseModifiers(text)
        )
      )
  )
  server.registerTool(
    "computer_double_click",
    {
      description:
        "Double-click the left mouse button at a screenshot coordinate and return a fresh screenshot.",
      inputSchema: clickInputSchema,
    },
    ({ coordinate, text }) =>
      act((size) =>
        clickEvents(
          pointFrom(coordinate),
          size,
          "left",
          2,
          parseModifiers(text)
        )
      )
  )
  server.registerTool(
    "computer_mouse_move",
    {
      description:
        "Move the mouse pointer to a screenshot coordinate without clicking and return a fresh screenshot.",
      inputSchema: mouseMoveInputSchema,
    },
    ({ coordinate }) =>
      act((size) => mouseMoveEvents(pointFrom(coordinate), size))
  )
  server.registerTool(
    "computer_left_click_drag",
    {
      description:
        "Press the left mouse button at start_coordinate, drag to coordinate, release, and return a fresh screenshot.",
      inputSchema: dragInputSchema,
    },
    ({ start_coordinate, coordinate }) =>
      act((size) =>
        dragEvents(pointFrom(start_coordinate), pointFrom(coordinate), size)
      )
  )
  server.registerTool(
    "computer_scroll",
    {
      description:
        "Scroll the mouse wheel at a screenshot coordinate by a number of clicks in one direction and return a fresh screenshot.",
      inputSchema: scrollInputSchema,
    },
    ({ coordinate, scroll_direction, scroll_amount, text }) =>
      act((size) =>
        scrollEvents(
          pointFrom(coordinate),
          size,
          scroll_direction,
          scroll_amount,
          parseModifiers(text)
        )
      )
  )
  server.registerTool(
    "computer_type",
    {
      description:
        "Type text into whatever has keyboard focus on the page, one character at a time; a newline presses Return. Returns a fresh screenshot.",
      inputSchema: typeInputSchema,
    },
    ({ text }) => act(() => typeEvents(text))
  )
  server.registerTool(
    "computer_key",
    {
      description:
        "Press one key or chord using xdotool names, for example Return, Escape, Page_Down, ctrl+a, or shift+Tab. Returns a fresh screenshot.",
      inputSchema: keyInputSchema,
    },
    ({ text }) => act(() => keyEvents(text))
  )
  server.registerTool(
    "computer_wait",
    {
      description:
        "Wait for a number of seconds, up to 30, then return a fresh screenshot. Use it after an action that starts loading.",
      inputSchema: waitInputSchema,
    },
    ({ duration }) =>
      guarded(async () => {
        await sleep(duration * 1_000)
        return host.operate(threadId, async (page) => ({
          content: await capture(page),
        }))
      })
  )

  return server
}

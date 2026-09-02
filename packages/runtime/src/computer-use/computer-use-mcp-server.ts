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
  toNodeHandler,
} from "@modelcontextprotocol/node"
import {
  createMcpHandler,
  McpServer,
  type AuthInfo,
} from "@modelcontextprotocol/server"
import { computerUseSettings, settingValue } from "@deskto/settings"
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
/** Keeps input events from landing before the page has painted the last one. */
const inputSettleMs = 50

type TurnBinding = { threadId: string }

function jsonError(response: ServerResponse, status: number, message: string) {
  response.writeHead(status, { "content-type": "application/json" })
  response.end(JSON.stringify({ error: message }))
}

function bearerToken(request: IncomingMessage): string | undefined {
  const header = request.headers.authorization
  if (!header?.startsWith("Bearer ")) return undefined
  return header.slice("Bearer ".length)
}

/**
 * Private loopback MCP server that gives one Turn screen-level control of
 * its Task's browser page. Each Turn gets a one-time bearer token; the token
 * dies with the Turn's lease, and tool arguments cannot name another Task.
 */
export class ComputerUseMcpServer implements SessionToolProvider {
  private constructor(
    private readonly httpServer: ReturnType<typeof createServer>,
    private readonly handler: ReturnType<typeof createMcpHandler>,
    private readonly bindings: Map<string, TurnBinding>,
    private readonly cursors: Map<string, ComputerUsePoint>,
    readonly url: string
  ) {}

  static async create(host: ComputerUseHost): Promise<ComputerUseMcpServer> {
    const bindings = new Map<string, TurnBinding>()
    const cursors = new Map<string, ComputerUsePoint>()
    const handler = createMcpHandler((context) => {
      const token = context.authInfo?.token
      const binding = token ? bindings.get(token) : undefined
      if (!binding) throw new Error("This screen control session has ended")
      return createComputerUseMcp(host, binding.threadId, cursors)
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
      if (!token || !bindings.has(token)) {
        response.setHeader("WWW-Authenticate", "Bearer")
        jsonError(response, 401, "Unauthorized")
        return
      }
      const auth: AuthInfo = {
        token,
        clientId: "deskto-local",
        scopes: ["computer-use"],
      }
      Object.assign(request, { auth })
      void nodeHandler(request, response)
    })
    await new Promise<void>((resolve, reject) => {
      httpServer.once("error", reject)
      httpServer.listen(0, localHost, () => {
        httpServer.removeListener("error", reject)
        resolve()
      })
    })
    const address = tcpAddressSchema.safeParse(httpServer.address())
    if (!address.success) {
      httpServer.close()
      throw new Error("Screen control MCP server did not get a loopback port")
    }
    const url = `http://${localHost}:${address.data.port}/mcp`
    return new ComputerUseMcpServer(httpServer, handler, bindings, cursors, url)
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
    this.bindings.set(token, { threadId: input.threadId })
    let closed = false
    const close = () => {
      if (closed) return Promise.resolve()
      closed = true
      signal.removeEventListener("abort", abort)
      this.bindings.delete(token)
      return Promise.resolve()
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
    this.bindings.clear()
    this.cursors.clear()
    try {
      await this.handler.close()
    } finally {
      await new Promise<void>((resolve) =>
        this.httpServer.close(() => resolve())
      )
    }
  }
}

type ToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: "image/png" }

type ToolResult = { content: ToolContent[]; isError?: boolean }

function textResult(value: object | string): ToolResult {
  return {
    content: [
      {
        type: "text",
        text: typeof value === "string" ? value : JSON.stringify(value),
      },
    ],
  }
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
  return [
    { type: "text", text: JSON.stringify({ display: size }) },
    {
      type: "image",
      data: image.resize(size).toPNG().toString("base64"),
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
        clickEvents(pointFrom(coordinate), size, "left", 1, parseModifiers(text))
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
        clickEvents(pointFrom(coordinate), size, "right", 1, parseModifiers(text))
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
        clickEvents(pointFrom(coordinate), size, "left", 2, parseModifiers(text))
      )
  )
  server.registerTool(
    "computer_mouse_move",
    {
      description:
        "Move the mouse pointer to a screenshot coordinate without clicking and return a fresh screenshot.",
      inputSchema: mouseMoveInputSchema,
    },
    ({ coordinate }) => act((size) => mouseMoveEvents(pointFrom(coordinate), size))
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

import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client"
import { computerUseSettings, resolveSettings } from "@deskto/settings"
import { afterEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"

import type { SessionToolInput } from "../session-tools.js"
import type {
  ComputerUseHost,
  ComputerUseInputEvent,
  ComputerUsePage,
} from "./computer-use-host.js"
import { ComputerUseMcpServer } from "./computer-use-mcp-server.js"

const png = Buffer.from("89504e470d0a1a0a", "hex")

const input: SessionToolInput = {
  harnessId: "claude",
  threadId: "thread-7",
  turnId: "turn-8",
  projectId: "project-6",
  projectPath: "/repo",
  workspaceId: "personal",
  settings: resolveSettings({}),
}

const imageContentSchema = z.object({
  content: z.array(
    z.union([
      z.object({ type: z.literal("text"), text: z.string() }),
      z.object({
        type: z.literal("image"),
        data: z.string(),
        mimeType: z.string(),
      }),
    ])
  ),
  isError: z.boolean().optional(),
})

/** A stand-in for Electron's WebContents that records the input it receives. */
function fakePage() {
  const events: ComputerUseInputEvent[] = []
  const page: ComputerUsePage = {
    size: () => ({ width: 1280, height: 800 }),
    capturePage: vi.fn(() =>
      Promise.resolve({ resize: () => ({ toPNG: () => png }) })
    ),
    sendInputEvent: (event) => {
      events.push(event)
    },
  }
  return { page, events }
}

function fakeHost(page: ComputerUsePage) {
  const threads: string[] = []
  const host: ComputerUseHost = {
    operate: (threadId, run) => {
      threads.push(threadId)
      return run(page)
    },
  }
  return { host, threads }
}

describe("ComputerUseMcpServer", () => {
  let server: ComputerUseMcpServer | undefined
  let client: Client | undefined

  afterEach(async () => {
    await client?.close()
    await server?.close()
  })

  it("exposes computer-use tools to one Turn and routes input to its Task", async () => {
    const { page, events } = fakePage()
    const { host, threads } = fakeHost(page)
    server = await ComputerUseMcpServer.create(host)
    const lease = await server.open(input, new AbortController().signal)
    if (!lease) throw new Error("Lease should be open")
    const config = lease.mcpServers[0]
    if (!config?.authorization) throw new Error("Missing test authorization")
    expect(config.id).toBe("deskto_computer_use")

    client = new Client({ name: "test", version: "1.0.0" })
    await client.connect(
      new StreamableHTTPClientTransport(new URL(config.url), {
        requestInit: {
          headers: { Authorization: `Bearer ${config.authorization.token}` },
        },
      })
    )
    const tools = (await client.listTools()).tools.map((tool) => tool.name)
    expect(tools).toEqual(
      expect.arrayContaining([
        "computer_screenshot",
        "computer_left_click",
        "computer_right_click",
        "computer_double_click",
        "computer_mouse_move",
        "computer_left_click_drag",
        "computer_scroll",
        "computer_type",
        "computer_key",
        "computer_wait",
        "computer_cursor_position",
        "computer_display_info",
      ])
    )

    const shot = imageContentSchema.parse(
      await client.callTool({ name: "computer_screenshot", arguments: {} })
    )
    expect(shot.content[1]).toEqual({
      type: "image",
      data: png.toString("base64"),
      mimeType: "image/png",
    })

    const click = imageContentSchema.parse(
      await client.callTool({
        name: "computer_left_click",
        arguments: { coordinate: [40, 60] },
      })
    )
    expect(click.isError).toBeUndefined()
    expect(events.map((event) => event.type)).toEqual([
      "mouseMove",
      "mouseDown",
      "mouseUp",
    ])
    expect(threads.every((threadId) => threadId === "thread-7")).toBe(true)

    const cursor = imageContentSchema.parse(
      await client.callTool({ name: "computer_cursor_position", arguments: {} })
    )
    expect(cursor.content[0]).toEqual({
      type: "text",
      text: JSON.stringify({ position: { x: 40, y: 60 } }),
    })

    const outside = imageContentSchema.parse(
      await client.callTool({
        name: "computer_left_click",
        arguments: { coordinate: [5000, 60] },
      })
    )
    expect(outside.isError).toBe(true)

    await lease.close()
    await expect(
      client.callTool({ name: "computer_screenshot", arguments: {} })
    ).rejects.toThrow()
  })

  it("stays out of a Turn when screen control is switched off", async () => {
    const { page } = fakePage()
    server = await ComputerUseMcpServer.create(fakeHost(page).host)
    const lease = await server.open(
      {
        ...input,
        settings: resolveSettings({
          [computerUseSettings.screenControlEnabled.key]: false,
        }),
      },
      new AbortController().signal
    )
    expect(lease).toBeUndefined()
  })

  it("rejects requests without a live token", async () => {
    const { page } = fakePage()
    server = await ComputerUseMcpServer.create(fakeHost(page).host)
    const response = await fetch(server.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    })
    expect(response.status).toBe(401)
  })
})

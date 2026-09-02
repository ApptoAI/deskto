import { request as httpRequest } from "node:http"

import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { resolveSettings } from "@deskto/settings"
import { describe, expect, it, vi } from "vitest"

import type {
  BrowserAutomationHost,
  BrowserSnapshot,
  BrowserStatus,
} from "./browser-automation-host.js"
import { BrowserMcpServer } from "./browser-mcp-server.js"

const status: BrowserStatus = {
  url: "https://example.com/",
  title: "Example",
  loading: false,
  canGoBack: false,
  canGoForward: false,
}

const snapshot: BrowserSnapshot = {
  ...status,
  snapshotId: "after-action",
  text: "Saved changes",
  elements: [{ ref: "e1", tag: "button", name: "Undo" }],
}

describe("BrowserMcpServer", () => {
  it("authenticates one Turn and routes tools to its Task", async () => {
    const host = fakeHost()
    const gateway = await BrowserMcpServer.create(host)
    const controller = new AbortController()
    const lease = await gateway.open(
      {
        harnessId: "claude",
        threadId: "thread-7",
        turnId: "turn-8",
        projectId: "project-6",
        workspaceId: "personal",
        projectPath: "/repo",
        settings: resolveSettings({}),
      },
      controller.signal
    )
    const config = lease.mcpServers[0]
    if (!config?.authorization) throw new Error("Missing test authorization")
    const client = new Client({ name: "test", version: "1.0.0" })
    const transport = new StreamableHTTPClientTransport(new URL(config.url), {
      requestInit: {
        headers: { Authorization: `Bearer ${config.authorization.token}` },
      },
    })

    try {
      await client.connect(transport)
      expect(
        await requestWithBootstrapToken(config.url, config.authorization.token)
      ).toBe(401)
      const tools = await client.listTools()
      expect(tools.tools.map((tool) => tool.name)).toContain("browser_snapshot")
      expect(
        tools.tools.find((tool) => tool.name === "browser_navigate")
          ?.description
      ).toContain("not evidence")
      expect(
        tools.tools.find((tool) => tool.name === "browser_snapshot")
          ?.description
      ).toContain("built-in preview")
      expect(
        tools.tools.find((tool) => tool.name === "browser_click")?.description
      ).toContain("claim the intended page change succeeded only when")
      await client.callTool({
        name: "browser_open",
        arguments: { url: "https://example.com" },
      })
      expect(host.open).toHaveBeenCalledWith("thread-7", "https://example.com")

      const clickResult = await client.callTool({
        name: "browser_click",
        arguments: { ref: "e1" },
      })
      expect(clickResult.content).toEqual([
        { type: "text", text: JSON.stringify(snapshot) },
      ])
      expect(host.click).toHaveBeenCalledWith("thread-7", "e1")

      await lease.close()
      await expect(client.listTools()).rejects.toThrow()
    } finally {
      await client.close().catch(() => undefined)
      await lease.close()
      await gateway.close()
    }
  })

  it("isolates concurrent leases and rejects unknown sessions", async () => {
    const host = fakeHost()
    const gateway = await BrowserMcpServer.create(host)
    const controller = new AbortController()
    const firstLease = await gateway.open(
      { ...testInput, threadId: "thread-one", turnId: "turn-one" },
      controller.signal
    )
    const secondLease = await gateway.open(
      { ...testInput, threadId: "thread-two", turnId: "turn-two" },
      controller.signal
    )
    const firstConfig = firstLease.mcpServers[0]
    const secondConfig = secondLease.mcpServers[0]
    if (!firstConfig?.authorization || !secondConfig?.authorization) {
      throw new Error("Missing test authorization")
    }
    const first = mcpClient(firstConfig.url, firstConfig.authorization.token)
    const second = mcpClient(secondConfig.url, secondConfig.authorization.token)

    try {
      await first.client.connect(first.transport)
      await second.client.connect(second.transport)
      await first.client.callTool({
        name: "browser_open",
        arguments: { url: "https://one.example" },
      })
      await second.client.callTool({
        name: "browser_open",
        arguments: { url: "https://two.example" },
      })

      expect(host.open).toHaveBeenNthCalledWith(
        1,
        "thread-one",
        "https://one.example"
      )
      expect(host.open).toHaveBeenNthCalledWith(
        2,
        "thread-two",
        "https://two.example"
      )
      expect(await requestWithUnknownSession(firstConfig.url)).toBe(404)
    } finally {
      await first.client.close().catch(() => undefined)
      await second.client.close().catch(() => undefined)
      await firstLease.close()
      await secondLease.close()
      await gateway.close()
    }
  })

  it("rejects a rebound Host header without consuming the lease token", async () => {
    const host = fakeHost()
    const gateway = await BrowserMcpServer.create(host)
    const lease = await gateway.open(testInput, new AbortController().signal)
    const config = lease.mcpServers[0]
    if (!config?.authorization) throw new Error("Missing test authorization")
    const reboundStatus = await requestWithHost(
      config.url,
      config.authorization.token,
      "attacker.example"
    )
    const retry = mcpClient(config.url, config.authorization.token)

    try {
      expect(reboundStatus).toBe(403)
      await retry.client.connect(retry.transport)
      expect((await retry.client.listTools()).tools.length).toBeGreaterThan(0)
    } finally {
      await retry.client.close().catch(() => undefined)
      await lease.close()
      await gateway.close()
    }
  })
})

const testInput = {
  harnessId: "claude",
  threadId: "thread-test",
  turnId: "turn-test",
  projectId: "project-test",
  workspaceId: "personal",
  projectPath: "/repo",
  settings: resolveSettings({}),
}

const initializeRequest = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "test", version: "1.0.0" },
  },
}

async function requestWithBootstrapToken(
  url: string,
  token: string
): Promise<number> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    }),
  })
  return response.status
}

async function requestWithUnknownSession(url: string): Promise<number> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "mcp-session-id": "unknown-session",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    }),
  })
  return response.status
}

function requestWithHost(
  url: string,
  token: string,
  host: string
): Promise<number> {
  const body = JSON.stringify(initializeRequest)
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      url,
      {
        method: "POST",
        headers: {
          Accept: "application/json, text/event-stream",
          Authorization: `Bearer ${token}`,
          Host: host,
          "content-length": Buffer.byteLength(body),
          "content-type": "application/json",
        },
      },
      (response) => {
        response.resume()
        response.on("end", () => resolve(response.statusCode ?? 0))
      }
    )
    request.on("error", reject)
    request.end(body)
  })
}

function mcpClient(url: string, token: string) {
  const client = new Client({ name: "test", version: "1.0.0" })
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  })
  return { client, transport }
}

function fakeHost(): BrowserAutomationHost & {
  open: ReturnType<typeof vi.fn>
} {
  return {
    status: vi.fn(() => Promise.resolve(status)),
    open: vi.fn(() => Promise.resolve(snapshot)),
    navigate: vi.fn(() => Promise.resolve(snapshot)),
    snapshot: vi.fn(() =>
      Promise.resolve({ ...status, snapshotId: "one", text: "", elements: [] })
    ),
    click: vi.fn(() => Promise.resolve(snapshot)),
    type: vi.fn(() => Promise.resolve(snapshot)),
    keypress: vi.fn(() => Promise.resolve(snapshot)),
    back: vi.fn(() => Promise.resolve(snapshot)),
    forward: vi.fn(() => Promise.resolve(snapshot)),
    reload: vi.fn(() => Promise.resolve(snapshot)),
    screenshot: vi.fn(() =>
      Promise.resolve({
        status,
        data: "aGVsbG8=",
        mimeType: "image/png" as const,
      })
    ),
  }
}

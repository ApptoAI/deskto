import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { describe, expect, it, vi } from "vitest"

import type {
  BrowserAutomationHost,
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
        projectPath: "/repo",
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
      await client.callTool({
        name: "browser_open",
        arguments: { url: "https://example.com" },
      })
      expect(host.open).toHaveBeenCalledWith("thread-7", "https://example.com")

      await lease.close()
      await expect(client.listTools()).rejects.toThrow()
    } finally {
      await client.close().catch(() => undefined)
      await lease.close()
      await gateway.close()
    }
  })
})

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

function fakeHost(): BrowserAutomationHost & {
  open: ReturnType<typeof vi.fn>
} {
  return {
    status: vi.fn(() => Promise.resolve(status)),
    open: vi.fn(() => Promise.resolve(status)),
    navigate: vi.fn(() => Promise.resolve(status)),
    snapshot: vi.fn(() =>
      Promise.resolve({ ...status, snapshotId: "one", text: "", elements: [] })
    ),
    click: vi.fn(() => Promise.resolve(status)),
    type: vi.fn(() => Promise.resolve(status)),
    keypress: vi.fn(() => Promise.resolve(status)),
    back: vi.fn(() => Promise.resolve(status)),
    forward: vi.fn(() => Promise.resolve(status)),
    reload: vi.fn(() => Promise.resolve(status)),
    screenshot: vi.fn(() =>
      Promise.resolve({
        status,
        data: "aGVsbG8=",
        mimeType: "image/png" as const,
      })
    ),
  }
}

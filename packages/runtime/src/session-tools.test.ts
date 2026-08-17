import { describe, expect, it, vi } from "vitest"

import {
  SessionToolLeases,
  type SessionToolInput,
  type SessionToolProvider,
} from "./session-tools.js"

const input: SessionToolInput = {
  harnessId: "codex",
  threadId: "thread-1",
  turnId: "turn-1",
  projectId: "project-1",
  workspaceId: "personal",
  projectPath: "/repo",
}

describe("SessionToolLeases", () => {
  it("combines provider-neutral MCP records and closes every lease", async () => {
    const firstClose = vi.fn(() => Promise.resolve())
    const secondClose = vi.fn(() => Promise.resolve())
    const leases = await SessionToolLeases.open(
      [provider("browser", firstClose), provider("project_tools", secondClose)],
      input,
      new AbortController().signal
    )

    expect(leases.mcpServers.map((server) => server.id)).toEqual([
      "browser",
      "project_tools",
    ])
    await leases.close()
    await leases.close()
    expect(firstClose).toHaveBeenCalledOnce()
    expect(secondClose).toHaveBeenCalledOnce()
  })

  it("closes opened leases when a later provider fails", async () => {
    const close = vi.fn(() => Promise.resolve())
    const failing: SessionToolProvider = {
      open: () => Promise.reject(new Error("tool startup failed")),
    }

    await expect(
      SessionToolLeases.open(
        [provider("browser", close), failing],
        input,
        new AbortController().signal
      )
    ).rejects.toThrow("tool startup failed")
    expect(close).toHaveBeenCalledOnce()
  })

  it("rejects duplicate server ids and closes both leases", async () => {
    const firstClose = vi.fn(() => Promise.resolve())
    const secondClose = vi.fn(() => Promise.resolve())

    await expect(
      SessionToolLeases.open(
        [provider("browser", firstClose), provider("browser", secondClose)],
        input,
        new AbortController().signal
      )
    ).rejects.toThrow("duplicated")
    expect(firstClose).toHaveBeenCalledOnce()
    expect(secondClose).toHaveBeenCalledOnce()
  })

  it("closes a lease that resolves after setup is cancelled", async () => {
    const controller = new AbortController()
    const close = vi.fn(() => Promise.resolve())
    let finishOpen: (() => void) | undefined
    const provider: SessionToolProvider = {
      open: () =>
        new Promise((resolve) => {
          finishOpen = () =>
            resolve({
              mcpServers: [{ id: "browser", url: "http://127.0.0.1/mcp" }],
              close,
            })
        }),
    }

    const opening = SessionToolLeases.open([provider], input, controller.signal)
    controller.abort()
    finishOpen?.()

    await expect(opening).rejects.toThrow("cancelled")
    expect(close).toHaveBeenCalledOnce()
  })
})

function provider(id: string, close: () => Promise<void>): SessionToolProvider {
  return {
    open: () =>
      Promise.resolve({
        mcpServers: [{ id, url: `http://127.0.0.1/${id}` }],
        close,
      }),
  }
}

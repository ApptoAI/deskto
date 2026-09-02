import { describe, expect, it, vi } from "vitest"

import { BrowserTabCreations } from "./browser-tab-creations.js"

describe("Browser tab creations", () => {
  it("shares one pending lookup for concurrent callers", async () => {
    const creations = new BrowserTabCreations<string>()
    const lookup = vi.fn(() => Promise.resolve("workspace-1"))
    const create = vi.fn((workspaceId: string) => workspaceId)
    const first = creations.run("thread-1", lookup, create)
    const second = creations.run("thread-1", lookup, create)

    await expect(first).resolves.toBe("workspace-1")
    await expect(second).resolves.toBe("workspace-1")
    expect(lookup).toHaveBeenCalledOnce()
    expect(create).toHaveBeenCalledOnce()
  })

  it("does not create a tab when the task closes during lookup", async () => {
    const creations = new BrowserTabCreations<string>()
    let finishLookup: (workspaceId: string) => void = () => undefined
    const lookup = new Promise<string>((resolve) => {
      finishLookup = resolve
    })
    const create = vi.fn((workspaceId: string) => workspaceId)
    const pending = creations.run("thread-1", () => lookup, create)

    creations.cancel("thread-1")
    finishLookup("workspace-1")

    await expect(pending).rejects.toThrow("closed before it opened")
    expect(create).not.toHaveBeenCalled()
  })
})

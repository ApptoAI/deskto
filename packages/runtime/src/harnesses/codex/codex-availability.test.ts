import { describe, expect, it, vi } from "vitest"

import { CodexAdapter } from "./codex-adapter.js"

describe("Codex availability", () => {
  it("checks the version in the discovery directory", async () => {
    const versionReader = vi.fn(() => Promise.resolve("codex-cli 1.2.3"))

    await expect(
      new CodexAdapter(undefined, {
        discoveryCwd: "/app-data/harness-discovery",
        versionReader,
      }).checkAvailability()
    ).resolves.toEqual({
      status: "available",
      version: "codex-cli 1.2.3",
    })
    expect(versionReader).toHaveBeenCalledWith("/app-data/harness-discovery")
  })
})

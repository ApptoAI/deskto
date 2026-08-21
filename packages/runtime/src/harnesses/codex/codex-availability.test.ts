import { describe, expect, it, vi } from "vitest"

import { CodexAdapter } from "./codex-adapter.js"

describe("Codex availability", () => {
  it("checks the version in the discovery directory", async () => {
    const availabilityProbe = vi.fn(() =>
      Promise.resolve({
        version: "codex-cli 1.2.3",
        accountStatus: "ready" as const,
      })
    )

    await expect(
      new CodexAdapter(undefined, {
        discoveryCwd: "/app-data/harness-discovery",
        availabilityProbe,
      }).checkAvailability()
    ).resolves.toEqual({
      status: "available",
      version: "codex-cli 1.2.3",
    })
    expect(availabilityProbe).toHaveBeenCalledWith(
      "/app-data/harness-discovery"
    )
  })

  it("explains how to install Codex when the CLI cannot be started", async () => {
    const error = Object.assign(new Error("not found"), { code: "ENOENT" })

    await expect(
      new CodexAdapter(undefined, {
        availabilityProbe: () => Promise.reject(error),
      }).checkAvailability()
    ).resolves.toEqual({
      status: "unavailable",
      reason:
        "Codex CLI was not found. Open Terminal and run `npm install -g @openai/codex`.",
    })
  })

  it("explains how to sign in when Codex has no active login", async () => {
    await expect(
      new CodexAdapter(undefined, {
        availabilityProbe: () =>
          Promise.resolve({ accountStatus: "signed-out" }),
      }).checkAvailability()
    ).resolves.toEqual({
      status: "unavailable",
      reason:
        "Codex is not signed in. Open Terminal, run `codex login`, and follow the sign-in steps.",
    })
  })

  it("explains how to update Codex when its account cannot be checked", async () => {
    await expect(
      new CodexAdapter(undefined, {
        availabilityProbe: () =>
          Promise.reject(new Error("Method not found: account/read")),
      }).checkAvailability()
    ).resolves.toEqual({
      status: "unavailable",
      reason:
        "Codex could not verify your account. Open Terminal, run `npm install -g @openai/codex@latest`, then try again.",
    })
  })
})

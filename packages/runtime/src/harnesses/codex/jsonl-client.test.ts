import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { jsonValueSchema } from "@deskto/protocol"
import { afterEach, describe, expect, it, vi } from "vitest"

import { JsonlClient, terminateProcessTree } from "./jsonl-client.js"

const directories: string[] = []

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true }))
  )
})

describe("JsonlClient", () => {
  it("terminates the full Codex process tree on Windows", async () => {
    const kill = vi.fn(() => true)
    const taskkill = vi.fn(() => Promise.resolve())

    terminateProcessTree({ pid: 42, kill }, "win32", taskkill)
    await Promise.resolve()

    expect(taskkill).toHaveBeenCalledWith(42)
    expect(kill).not.toHaveBeenCalled()
  })

  it("falls back to killing the wrapper when taskkill fails", async () => {
    const kill = vi.fn(() => true)

    terminateProcessTree({ pid: 42, kill }, "win32", () =>
      Promise.reject(new Error("taskkill unavailable"))
    )
    await vi.waitFor(() => expect(kill).toHaveBeenCalled())
  })

  it("terminates a live process after stdin fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "deskto-jsonl-client-"))
    directories.push(directory)
    const executable = join(directory, "closed-stdin-app-server")
    await writeFile(executable, "#!/bin/sh\nexec 0<&-\nsleep 60\n")
    await chmod(executable, 0o755)
    const terminateProcess = vi.fn(terminateProcessTree)
    const client = new JsonlClient(executable, directory, { terminateProcess })
    const failure = new Promise<Error>((resolve) => {
      client.onFailure(resolve)
    })

    await new Promise((resolve) => setTimeout(resolve, 20))
    void client
      .request(
        "thread/resume",
        { payload: "x".repeat(1_000_000) },
        jsonValueSchema
      )
      .catch(() => {})

    await expect(failure).resolves.toBeInstanceOf(Error)
    expect(terminateProcess).toHaveBeenCalledOnce()
    client.close()
    expect(terminateProcess).toHaveBeenCalledOnce()
  })

  it("fails a request when app-server stays silent", async () => {
    const directory = await mkdtemp(join(tmpdir(), "deskto-jsonl-client-"))
    directories.push(directory)
    const executable = join(directory, "silent-app-server")
    await writeFile(executable, "#!/bin/sh\nread request\nexec sleep 60\n")
    await chmod(executable, 0o755)
    const client = new JsonlClient(executable, directory, {
      requestTimeoutMs: 20,
    })

    await expect(
      client.request("thread/resume", {}, jsonValueSchema)
    ).rejects.toThrow("Codex did not respond to thread/resume within 20ms")

    client.close()
  })
})

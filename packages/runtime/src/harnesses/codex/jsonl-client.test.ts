import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { jsonValueSchema } from "@deskto/protocol"
import { afterEach, describe, expect, it } from "vitest"

import { JsonlClient } from "./jsonl-client.js"

const directories: string[] = []

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true }))
  )
})

describe("JsonlClient", () => {
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

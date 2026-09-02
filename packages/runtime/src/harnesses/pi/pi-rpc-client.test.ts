import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { piStateSchema, type PiEvent } from "./pi-protocol.js"
import { PiRpcClient } from "./pi-rpc-client.js"

const directories: string[] = []

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true }))
  )
})

async function fakePi(
  script: string
): Promise<{ command: string; cwd: string }> {
  const directory = await mkdtemp(join(tmpdir(), "deskto-pi-rpc-"))
  directories.push(directory)
  const command = join(directory, "pi")
  await writeFile(command, `#!/bin/sh\n${script}`)
  await chmod(command, 0o755)
  return { command, cwd: directory }
}

describe("PiRpcClient", () => {
  it("correlates responses by id and forwards events", async () => {
    // Echo the request id back inside a response, with an event before it and
    // a CRLF-terminated event after it, in one write.
    const { command, cwd } = await fakePi(
      `read request
id=$(printf '%s' "$request" | sed 's/.*"id":"\\([^"]*\\)".*/\\1/')
printf '{"type":"agent_start"}\\n{"id":"%s","type":"response","command":"get_state","success":true,"data":{"sessionId":"s-1"}}\\n{"type":"agent_end","willRetry":false}\\r\\n' "$id"
sleep 5
`
    )
    const client = new PiRpcClient(command, cwd, { args: [] })
    const events: PiEvent[] = []
    client.onEvent((event) => events.push(event))

    await expect(
      client.request({ type: "get_state" }, piStateSchema)
    ).resolves.toEqual({ sessionId: "s-1" })
    expect(events.map((event) => event.type)).toEqual([
      "agent_start",
      "agent_end",
    ])
    client.close()
  })

  it("rejects a command Pi refuses", async () => {
    const { command, cwd } = await fakePi(
      `read request
id=$(printf '%s' "$request" | sed 's/.*"id":"\\([^"]*\\)".*/\\1/')
printf '{"id":"%s","type":"response","command":"prompt","success":false,"error":"Agent is busy"}\\n' "$id"
sleep 5
`
    )
    const client = new PiRpcClient(command, cwd)

    await expect(
      client.request({ type: "prompt", message: "hi" }, piStateSchema)
    ).rejects.toThrow("Agent is busy")
    client.close()
  })

  it("reports the last stderr line when Pi exits early", async () => {
    const { command, cwd } = await fakePi(
      `echo "No API key found for provider anthropic" >&2\nexit 1\n`
    )
    const client = new PiRpcClient(command, cwd)
    const failure = new Promise<Error>((resolve) => {
      client.onFailure(resolve)
    })

    await expect(failure).resolves.toMatchObject({
      message: "Pi exited (1): No API key found for provider anthropic",
    })
  })

  it("fails a request when Pi stays silent", async () => {
    const { command, cwd } = await fakePi("read request\nexec sleep 60\n")
    const client = new PiRpcClient(command, cwd, { requestTimeoutMs: 20 })

    await expect(
      client.request({ type: "get_state" }, piStateSchema)
    ).rejects.toThrow("Pi did not respond to get_state within 20ms")
    client.close()
  })
})

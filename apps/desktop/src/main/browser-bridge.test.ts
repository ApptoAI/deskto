import { mkdtemp, rm } from "node:fs/promises"
import { request, createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createRuntime, type Runtime } from "@deskto/runtime"
import { z } from "zod"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { startBrowserBridge } from "./browser-bridge.js"

const listeningAddressSchema = z.object({ port: z.number().int().positive() })

let closeBridge: (() => void) | undefined
let directory: string
let port: number
let runtime: Runtime

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "deskto-browser-bridge-"))
  port = await availablePort()
  runtime = createRuntime({
    databasePath: join(directory, "runtime.sqlite"),
    harnesses: [],
    harnessRefreshMs: 0,
  })
  closeBridge = startBrowserBridge(runtime, port)
})

afterEach(async () => {
  closeBridge?.()
  await runtime.close()
  await rm(directory, { recursive: true, force: true })
})

describe("browser Runtime bridge", () => {
  it("rejects requests without a browser origin", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/request`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method: "workspace.list", params: {} }),
    })

    expect(response.status).toBe(403)
  })

  it("decodes UTF-8 only after every request chunk arrives", async () => {
    const body = Buffer.from(
      JSON.stringify({
        method: "workspace.list",
        params: {},
        ignoredNonAsciiValue: "💾",
      })
    )
    const markerIndex = body.indexOf(Buffer.from("💾"))
    const splitAt = markerIndex + 1

    const response = await postChunks(
      port,
      body.subarray(0, splitAt),
      body.subarray(splitAt)
    )

    expect(response.status).toBe(200)
  })
})

async function availablePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = listeningAddressSchema.parse(server.address())
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
  return address.port
}

function postChunks(
  requestPort: number,
  first: Buffer,
  second: Buffer
): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: "127.0.0.1",
        port: requestPort,
        path: "/request",
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": first.length + second.length,
          origin: `http://127.0.0.1:${requestPort}`,
        },
      },
      (res) => {
        res.resume()
        res.on("end", () => resolve({ status: res.statusCode ?? 0 }))
      }
    )
    req.on("error", reject)
    req.write(first)
    setTimeout(() => req.end(second), 10)
  })
}

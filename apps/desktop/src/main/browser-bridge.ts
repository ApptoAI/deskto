import { createServer, type Server } from "node:http"

import { app } from "electron"
import { z } from "zod"

import {
  runtimeEventSchema,
  runtimeRequestSchema,
  type RuntimeEvent,
} from "@deskto/protocol"
import type { Runtime } from "@deskto/runtime"

const failureDetailSchema = z
  .instanceof(Error)
  .transform((error) => error.message)
  .catch("The bridge request failed")

/**
 * Dev-only bridge that serves the Runtime protocol over HTTP so the Surface
 * can run in a plain browser tab (Electron's preload bridge does not exist
 * there). Requests are POSTs returning one JSON response; events travel over
 * Server-Sent Events. Same serializable protocol as IPC — no provider types
 * cross this line. Never starts in a packaged build.
 */
const maxBridgeRequestBytes = 1_048_576

function isAllowedBridgeOrigin(origin: string | undefined): boolean {
  if (!origin) return true
  try {
    const url = new URL(origin)
    const host = url.hostname
    const allowedHost =
      host === "localhost" ||
      host === "127.0.0.1" ||
      host.endsWith(".exe.xyz")
    return allowedHost && (url.protocol === "http:" || url.protocol === "https:")
  } catch {
    return false
  }
}

function setBridgeCorsHeaders(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse
): boolean {
  // SAFETY: Node's IncomingMessage headers are string | string[] | undefined
  // per the http types, and the Origin header is always a single string when
  // present, so narrowing to string | undefined is safe.
  const origin = req.headers.origin as string | undefined
  if (origin && !isAllowedBridgeOrigin(origin)) return false
  if (origin) res.setHeader("access-control-allow-origin", origin)
  res.setHeader("access-control-allow-headers", "content-type")
  res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS")
  return true
}

export function startBrowserBridge(runtime: Runtime, port: number): () => void {
  const server: Server = createServer((req, res) => {
    if (req.method === "OPTIONS") {
      if (!setBridgeCorsHeaders(req, res)) {
        res.writeHead(403, { "content-type": "application/json" }).end(
          JSON.stringify({
            ok: false,
            error: { code: "invalid-request", message: "Origin not allowed" },
          })
        )
        return
      }
      res.writeHead(204).end()
      return
    }

    if (req.method === "GET" && req.url === "/events") {
      if (!setBridgeCorsHeaders(req, res)) {
        res.writeHead(403, { "content-type": "application/json" }).end(
          JSON.stringify({
            ok: false,
            error: { code: "invalid-request", message: "Origin not allowed" },
          })
        )
        return
      }
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      })
      const unsubscribe = runtime.subscribe((event: RuntimeEvent) => {
        const parsed = runtimeEventSchema.safeParse(event)
        if (!parsed.success) return
        res.write(`data: ${JSON.stringify(parsed.data)}\n\n`)
      })
      const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15_000)
      res.on("close", () => {
        clearInterval(heartbeat)
        unsubscribe()
      })
      return
    }

    if (req.method === "POST" && req.url === "/request") {
      if (!setBridgeCorsHeaders(req, res)) {
        res.writeHead(403, { "content-type": "application/json" }).end(
          JSON.stringify({
            ok: false,
            error: { code: "invalid-request", message: "Origin not allowed" },
          })
        )
        return
      }
      let body = ""
      let receivedBytes = 0
      let overflowed = false
      req.on("data", (chunk: Buffer) => {
        receivedBytes += chunk.length
        if (receivedBytes > maxBridgeRequestBytes) {
          overflowed = true
          return
        }
        body += chunk
      })
      req.on("end", () => {
        if (overflowed) {
          res.writeHead(413).end(
            JSON.stringify({
              ok: false,
              error: { code: "invalid-request", message: "Request too large" },
            })
          )
          return
        }
        let value: unknown
        try {
          value = JSON.parse(body)
        } catch {
          res.writeHead(400).end(
            JSON.stringify({
              ok: false,
              error: { code: "invalid-request", message: "Bad JSON" },
            })
          )
          return
        }
        const parsed = runtimeRequestSchema.safeParse(value)
        if (!parsed.success) {
          res.writeHead(400).end(
            JSON.stringify({
              ok: false,
              error: {
                code: "invalid-request",
                message: "The runtime request is invalid",
              },
            })
          )
          return
        }
        runtime
          .request(parsed.data)
          .then((response) => {
            res.writeHead(200).end(JSON.stringify(response))
          })
          .catch((error) => {
            res.writeHead(500).end(
              JSON.stringify({
                ok: false,
                error: {
                  code: "bridge-failed",
                  message: failureDetailSchema.parse(error),
                },
              })
            )
          })
      })
      return
    }

    res.writeHead(404).end()
  })

  server.listen(port, "127.0.0.1")
  return () => {
    server.close()
  }
}

/** Opt-in so a dev launch never opens a network port by accident. */
export function browserBridgeEnabled(): boolean {
  return !app.isPackaged && process.env.DESKTO_BROWSER_BRIDGE === "1"
}

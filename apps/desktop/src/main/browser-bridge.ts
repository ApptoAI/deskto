import { createServer, type Server } from "node:http"

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

function requestHostname(
  req: import("node:http").IncomingMessage
): string | undefined {
  const forwardedHost = req.headers["x-forwarded-host"]
  const host = Array.isArray(forwardedHost)
    ? forwardedHost[0]
    : (forwardedHost ?? req.headers.host)
  const firstHost = host?.split(",", 1)[0]?.trim()
  if (!firstHost) return undefined
  try {
    return new URL(`http://${firstHost}`).hostname
  } catch {
    return undefined
  }
}

function isAllowedBridgeOrigin(
  origin: string,
  hostname: string | undefined
): boolean {
  if (!hostname) return false
  try {
    const url = new URL(origin)
    const allowedHostname =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]" ||
      hostname.endsWith(".exe.xyz")
    return (
      allowedHostname &&
      url.hostname === hostname &&
      (url.protocol === "http:" || url.protocol === "https:")
    )
  } catch {
    return false
  }
}

function setBridgeCorsHeaders(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse
): boolean {
  const origin = req.headers.origin
  if (!origin || !isAllowedBridgeOrigin(origin, requestHostname(req))) {
    return false
  }
  res.setHeader("access-control-allow-origin", origin)
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
        if (!parsed.success) {
          console.error(
            "Browser bridge received an invalid Runtime event",
            parsed.error
          )
          return
        }
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
      const chunks: Buffer[] = []
      let receivedBytes = 0
      let overflowed = false
      req.on("data", (chunk: Buffer) => {
        receivedBytes += chunk.length
        if (receivedBytes > maxBridgeRequestBytes) {
          overflowed = true
          return
        }
        chunks.push(chunk)
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
          value = JSON.parse(Buffer.concat(chunks).toString("utf8"))
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

  server.on("error", (error) => {
    console.error("Browser bridge failed", error)
  })
  server.listen(port, "127.0.0.1")
  return () => {
    server.close()
    server.closeAllConnections()
  }
}

/** Opt-in so a dev launch never opens a network port by accident. */
export function browserBridgeEnabled(isPackaged: boolean): boolean {
  return !isPackaged && process.env.DESKTO_BROWSER_BRIDGE === "1"
}

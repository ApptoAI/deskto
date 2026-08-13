import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { createInterface } from "node:readline"

import type {
  CodexNotification,
  CodexServerRequest,
  JsonObject,
} from "./codex-protocol.js"
import { isRecord } from "./codex-protocol.js"

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

export class JsonlClient {
  readonly #process: ChildProcessWithoutNullStreams
  readonly #pending = new Map<number, PendingRequest>()
  readonly #notificationListeners = new Set<
    (notification: CodexNotification) => void
  >()
  readonly #requestListeners = new Set<(request: CodexServerRequest) => void>()
  readonly #failureListeners = new Set<(error: Error) => void>()
  #nextId = 1
  #closed = false

  constructor(command: string, cwd: string) {
    this.#process = spawn(command, ["app-server"], {
      cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    })

    const lines = createInterface({ input: this.#process.stdout })
    this.#process.stderr.resume()
    lines.on("line", (line) => this.#onLine(line))
    this.#process.stdin.on("error", (error) => this.#fail(error))
    this.#process.once("error", (error) => this.#fail(error))
    this.#process.once("exit", (code, signal) => {
      this.#fail(
        new Error(`Codex app-server exited (${signal ?? code ?? "unknown"})`)
      )
    })
  }

  request<T>(method: string, params: JsonObject): Promise<T> {
    const id = this.#nextId++
    return new Promise<T>((resolve, reject) => {
      this.#pending.set(id, { resolve: (value) => resolve(value as T), reject })
      this.#write({ id, method, params })
    })
  }

  notify(method: string, params?: JsonObject): void {
    this.#write(params ? { method, params } : { method })
  }

  respond(id: string | number, result: JsonObject): void {
    this.#write({ id, result })
  }

  respondMethodNotFound(id: string | number, method: string): void {
    this.#write({
      id,
      error: { code: -32601, message: `Unsupported request: ${method}` },
    })
  }

  onNotification(
    listener: (notification: CodexNotification) => void
  ): () => void {
    this.#notificationListeners.add(listener)
    return () => this.#notificationListeners.delete(listener)
  }

  onRequest(listener: (request: CodexServerRequest) => void): () => void {
    this.#requestListeners.add(listener)
    return () => this.#requestListeners.delete(listener)
  }

  onFailure(listener: (error: Error) => void): () => void {
    this.#failureListeners.add(listener)
    return () => this.#failureListeners.delete(listener)
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    const error = new Error("Codex app-server was closed")
    for (const pending of this.#pending.values()) pending.reject(error)
    this.#pending.clear()
    this.#process.kill()
  }

  #write(message: JsonObject): void {
    if (this.#closed) throw new Error("Codex app-server is closed")
    this.#process.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
      if (error) this.#fail(error)
    })
  }

  #onLine(line: string): void {
    let message: unknown
    try {
      message = JSON.parse(line)
    } catch {
      return
    }
    if (!isRecord(message)) return

    if (
      (typeof message.id === "number" || typeof message.id === "string") &&
      typeof message.method === "string"
    ) {
      for (const listener of this.#requestListeners) {
        listener({
          id: message.id,
          method: message.method,
          params: isRecord(message.params) ? message.params : undefined,
        })
      }
      return
    }

    if (typeof message.id === "number") {
      const pending = this.#pending.get(message.id)
      if (!pending) return
      this.#pending.delete(message.id)
      if (isRecord(message.error)) {
        pending.reject(
          new Error(String(message.error.message ?? "Codex request failed"))
        )
      } else {
        pending.resolve(message.result)
      }
      return
    }

    if (typeof message.method === "string") {
      const notification = {
        method: message.method,
        ...(isRecord(message.params) ? { params: message.params } : {}),
      }
      for (const listener of this.#notificationListeners) listener(notification)
    }
  }

  #fail(error: Error): void {
    if (this.#closed) return
    this.#closed = true
    for (const pending of this.#pending.values()) pending.reject(error)
    this.#pending.clear()
    for (const listener of this.#failureListeners) listener(error)
  }
}

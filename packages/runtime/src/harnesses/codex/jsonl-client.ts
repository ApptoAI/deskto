import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { createInterface } from "node:readline"
import { jsonValueSchema } from "@deskto/protocol"
import { z } from "zod"

import type {
  CodexNotification,
  CodexServerRequest,
  JsonObject,
  JsonValue,
} from "./codex-protocol.js"
import {
  codexNotificationSchema,
  codexServerRequestSchema,
  getString,
  parseJsonObject,
  parseJsonValue,
} from "./codex-protocol.js"

type PendingRequest = {
  resolve: (value: JsonValue) => void
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

  request<T extends JsonValue>(
    method: string,
    params: JsonObject,
    schema: z.ZodType<T>
  ): Promise<T> {
    const id = this.#nextId++
    return new Promise<T>((resolve, reject) => {
      this.#pending.set(id, {
        resolve: (value) => {
          const parsed = schema.safeParse(value)
          if (parsed.success) resolve(parsed.data)
          else reject(new Error(`Codex returned an invalid ${method} response`))
        },
        reject,
      })
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
    const value = parseJsonValue(line)
    const message = parseJsonObject(value)
    if (!message) return

    const serverRequest = codexServerRequestSchema.safeParse(message)
    if (serverRequest.success) {
      for (const listener of this.#requestListeners) {
        listener(serverRequest.data)
      }
      return
    }

    const responseId = z.number().safeParse(message.id)
    if (responseId.success) {
      const pending = this.#pending.get(responseId.data)
      if (!pending) return
      this.#pending.delete(responseId.data)
      const error = parseJsonObject(message.error)
      if (error) {
        pending.reject(
          new Error(getString(error, "message") ?? "Codex request failed")
        )
      } else {
        const result = jsonValueSchema.safeParse(message.result)
        if (result.success) pending.resolve(result.data)
        else pending.reject(new Error("Codex response has no result"))
      }
      return
    }

    const notification = codexNotificationSchema.safeParse(message)
    if (notification.success) {
      for (const listener of this.#notificationListeners) {
        listener(notification.data)
      }
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

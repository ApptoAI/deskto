import {
  execFile,
  type ChildProcessWithoutNullStreams,
} from "node:child_process"
import { createInterface } from "node:readline"
import path from "node:path"
import { jsonValueSchema } from "@deskto/protocol"
import crossSpawn from "cross-spawn"
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

export type JsonlClientOptions = {
  args?: string[]
  env?: NodeJS.ProcessEnv
  /** Fails a silent app-server request instead of leaving the UI running forever. */
  requestTimeoutMs?: number
  terminateProcess?: (target: ProcessTreeTarget) => void
}

const defaultRequestTimeoutMs = 30_000
const maximumStderrTailLength = 8_192

export type ProcessTreeTarget = {
  pid?: number
  kill(): boolean
}

type TaskkillRunner = (pid: number) => Promise<void>

export function terminateProcessTree(
  target: ProcessTreeTarget,
  platform: NodeJS.Platform = process.platform,
  taskkill: TaskkillRunner = runWindowsTaskkill
): void {
  if (platform !== "win32" || !target.pid) {
    target.kill()
    return
  }
  void taskkill(target.pid).catch(() => {
    target.kill()
  })
}

function runWindowsTaskkill(pid: number): Promise<void> {
  const systemRoot = Object.entries(process.env).find(
    ([key, value]) => key.toUpperCase() === "SYSTEMROOT" && value
  )?.[1]
  const command = systemRoot
    ? path.win32.join(systemRoot, "System32/taskkill.exe")
    : "taskkill.exe"
  return new Promise((resolve, reject) => {
    execFile(
      command,
      ["/PID", String(pid), "/T", "/F"],
      { timeout: 5_000, windowsHide: true },
      (error) => {
        if (error) reject(error)
        else resolve()
      }
    )
  })
}

export class JsonlClient {
  readonly #process: ChildProcessWithoutNullStreams
  readonly #pending = new Map<number, PendingRequest>()
  readonly #notificationListeners = new Set<
    (notification: CodexNotification) => void
  >()
  readonly #requestListeners = new Set<(request: CodexServerRequest) => void>()
  readonly #failureListeners = new Set<(error: Error) => void>()
  readonly #requestTimeoutMs: number
  readonly #terminateProcess: (target: ProcessTreeTarget) => void
  #stderrTail = ""
  #nextId = 1
  #closed = false
  #processTerminated = false

  constructor(command: string, cwd: string, options: JsonlClientOptions = {}) {
    this.#requestTimeoutMs = options.requestTimeoutMs ?? defaultRequestTimeoutMs
    this.#terminateProcess = options.terminateProcess ?? terminateProcessTree
    this.#process = crossSpawn.spawn(
      command,
      ["app-server", ...(options.args ?? [])],
      {
        cwd,
        env: options.env ?? process.env,
        stdio: ["pipe", "pipe", "pipe"],
      }
    )

    const lines = createInterface({ input: this.#process.stdout })
    this.#process.stderr.on("data", (chunk: Buffer) => {
      this.#stderrTail = (this.#stderrTail + chunk.toString()).slice(
        -maximumStderrTailLength
      )
    })
    lines.on("line", (line) => this.#onLine(line))
    this.#process.stdin.on("error", (error) => this.#fail(error))
    this.#process.once("error", (error) => this.#fail(error))
    this.#process.once("exit", (code, signal) => {
      const diagnostic = this.#stderrDiagnostic()
      this.#fail(
        new Error(
          `Codex app-server exited (${signal ?? code ?? "unknown"})${diagnostic}`
        )
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
      let timer: ReturnType<typeof setTimeout> | undefined
      const clearTimer = () => {
        if (timer) clearTimeout(timer)
      }
      this.#pending.set(id, {
        resolve: (value) => {
          clearTimer()
          const parsed = schema.safeParse(value)
          if (parsed.success) resolve(parsed.data)
          else reject(new Error(`Codex returned an invalid ${method} response`))
        },
        reject: (error) => {
          clearTimer()
          reject(error)
        },
      })
      this.#write({ id, method, params })
      if (this.#requestTimeoutMs > 0) {
        timer = setTimeout(() => {
          const pending = this.#pending.get(id)
          if (!pending) return
          this.#pending.delete(id)
          pending.reject(
            new Error(
              `Codex did not respond to ${method} within ${this.#requestTimeoutMs}ms`
            )
          )
        }, this.#requestTimeoutMs)
      }
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
    if (!this.#closed) {
      this.#closed = true
      const error = new Error("Codex app-server was closed")
      for (const pending of this.#pending.values()) pending.reject(error)
      this.#pending.clear()
    }
    this.#terminate()
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
    this.#terminate()
    for (const listener of this.#failureListeners) listener(error)
  }

  #terminate(): void {
    if (this.#processTerminated) return
    this.#processTerminated = true
    this.#terminateProcess(this.#process)
  }

  #stderrDiagnostic(): string {
    const line = this.#stderrTail.trim().split(/\r?\n/).filter(Boolean).at(-1)
    return line ? `: ${line.slice(0, 1_000)}` : ""
  }
}

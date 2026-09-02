import type { ChildProcessWithoutNullStreams } from "node:child_process"
import crossSpawn from "cross-spawn"
import { z } from "zod"

import {
  terminateProcessTree,
  type ProcessTreeTarget,
} from "../codex/jsonl-client.js"
import {
  parseJsonObject,
  parseJsonValue,
  piEventSchema,
  piResponseSchema,
  type JsonObject,
  type JsonValue,
  type PiEvent,
  type PiResponse,
} from "./pi-protocol.js"

type PendingRequest = {
  resolve: (response: PiResponse) => void
  reject: (error: Error) => void
}

export type PiRpcClientOptions = {
  args?: string[]
  env?: NodeJS.ProcessEnv
  /** Fails a silent Pi command instead of leaving the task running forever. */
  requestTimeoutMs?: number
  terminateProcess?: (target: ProcessTreeTarget) => void
}

const defaultRequestTimeoutMs = 30_000
const maximumStderrTailLength = 8_192

/**
 * Drives one `pi --mode rpc` process. Pi frames records with a bare LF and
 * warns against readline-style splitting, so lines are cut by hand.
 */
export class PiRpcClient {
  readonly #process: ChildProcessWithoutNullStreams
  readonly #pending = new Map<string, PendingRequest>()
  readonly #eventListeners = new Set<(event: PiEvent) => void>()
  readonly #failureListeners = new Set<(error: Error) => void>()
  readonly #requestTimeoutMs: number
  readonly #terminateProcess: (target: ProcessTreeTarget) => void
  #buffer = ""
  #stderrTail = ""
  #nextId = 1
  #closed = false
  #processTerminated = false

  constructor(command: string, cwd: string, options: PiRpcClientOptions = {}) {
    this.#requestTimeoutMs = options.requestTimeoutMs ?? defaultRequestTimeoutMs
    this.#terminateProcess = options.terminateProcess ?? terminateProcessTree
    this.#process = crossSpawn.spawn(
      command,
      ["--mode", "rpc", ...(options.args ?? [])],
      {
        cwd,
        env: options.env ?? process.env,
        stdio: ["pipe", "pipe", "pipe"],
      }
    )
    this.#process.stdout.setEncoding("utf8")
    this.#process.stdout.on("data", (chunk: string) => this.#onData(chunk))
    this.#process.stderr.on("data", (chunk: Buffer) => {
      this.#stderrTail = (this.#stderrTail + chunk.toString()).slice(
        -maximumStderrTailLength
      )
    })
    this.#process.stdin.on("error", (error) => this.#fail(error))
    this.#process.once("error", (error) => this.#fail(error))
    this.#process.once("exit", (code, signal) => {
      const diagnostic = this.#stderrDiagnostic()
      this.#fail(
        new Error(`Pi exited (${signal ?? code ?? "unknown"})${diagnostic}`)
      )
    })
  }

  request<T extends JsonValue>(
    command: JsonObject,
    schema: z.ZodType<T>
  ): Promise<T> {
    const id = `deskto-${this.#nextId++}`
    const parsedType = z.string().safeParse(command.type)
    const type = parsedType.success ? parsedType.data : "command"
    return new Promise<T>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const clearTimer = () => {
        if (timer) clearTimeout(timer)
      }
      this.#pending.set(id, {
        resolve: (response) => {
          clearTimer()
          if (!response.success) {
            reject(new Error(response.error ?? `Pi refused ${type}`))
            return
          }
          const parsed = schema.safeParse(response.data ?? {})
          if (parsed.success) resolve(parsed.data)
          else reject(new Error(`Pi returned an invalid ${type} response`))
        },
        reject: (error) => {
          clearTimer()
          reject(error)
        },
      })
      this.#write({ ...command, id })
      if (this.#requestTimeoutMs > 0) {
        timer = setTimeout(() => {
          const pending = this.#pending.get(id)
          if (!pending) return
          this.#pending.delete(id)
          pending.reject(
            new Error(
              `Pi did not respond to ${type} within ${this.#requestTimeoutMs}ms`
            )
          )
        }, this.#requestTimeoutMs)
      }
    })
  }

  send(command: JsonObject): void {
    this.#write(command)
  }

  onEvent(listener: (event: PiEvent) => void): () => void {
    this.#eventListeners.add(listener)
    return () => this.#eventListeners.delete(listener)
  }

  onFailure(listener: (error: Error) => void): () => void {
    this.#failureListeners.add(listener)
    return () => this.#failureListeners.delete(listener)
  }

  close(): void {
    if (!this.#closed) {
      this.#closed = true
      const error = new Error("Pi was closed")
      for (const pending of this.#pending.values()) pending.reject(error)
      this.#pending.clear()
    }
    this.#terminate()
  }

  #write(message: JsonObject): void {
    if (this.#closed) throw new Error("Pi is closed")
    this.#process.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
      if (error) this.#fail(error)
    })
  }

  #onData(chunk: string): void {
    this.#buffer += chunk
    let newline = this.#buffer.indexOf("\n")
    while (newline !== -1) {
      const line = this.#buffer.slice(0, newline).replace(/\r$/, "")
      this.#buffer = this.#buffer.slice(newline + 1)
      if (line) this.#onLine(line)
      newline = this.#buffer.indexOf("\n")
    }
  }

  #onLine(line: string): void {
    const message = parseJsonObject(parseJsonValue(line))
    if (!message) return

    const response = piResponseSchema.safeParse(message)
    if (response.success) {
      const id = response.data.id
      const pending = id ? this.#pending.get(id) : undefined
      if (!pending || !id) return
      this.#pending.delete(id)
      pending.resolve(response.data)
      return
    }

    const event = piEventSchema.safeParse(message)
    if (event.success) {
      for (const listener of this.#eventListeners) listener(event.data)
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

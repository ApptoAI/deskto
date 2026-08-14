import {
  query,
  type CanUseTool,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk"
import {
  AsyncQueue,
  harnessFailure,
  type ApprovalDecision,
  type HarnessAdapterFactory,
  type HarnessEvent,
  type HarnessFailure,
  type HarnessModelOption,
  type HarnessRunInput,
  type HarnessSession,
} from "@openappto/harness-sdk"

import { positiveTokens } from "../token-usage.js"

import { claudePluginsFor } from "./claude-packs.js"

type ClaudeAdapterOptions = {
  executablePath?: string
  /** Stable app-owned directory for generated pack plugin shims. */
  packShimsPath?: string
}

type PendingApproval = {
  id: string
  request: Extract<HarnessEvent, { type: "approval.requested" }>["request"]
  resolve: (decision: ApprovalDecision) => void
}

export class ClaudeAdapter implements HarnessAdapterFactory {
  readonly descriptor = { id: "claude", name: "Claude Code" }

  constructor(private readonly options: ClaudeAdapterOptions = {}) {}

  checkAvailability() {
    return Promise.resolve({ status: "available" as const })
  }

  async listModels(): Promise<HarnessModelOption[]> {
    const abortController = new AbortController()
    const prompt = new AsyncQueue<SDKUserMessage>()
    const discovery = query({
      prompt,
      options: {
        abortController,
        ...(this.options.executablePath
          ? { pathToClaudeCodeExecutable: this.options.executablePath }
          : {}),
      },
    })
    try {
      const models = await discovery.supportedModels()
      return models.map((model) => {
        const supportedEfforts = model.supportedEffortLevels ?? []
        return {
          id: model.value,
          name: model.displayName,
          description: model.description,
          supportedEfforts,
          isDefault: model.value === "default",
          supportedPermissionModes: [
            "approval-required",
            ...(model.supportsAutoMode ? (["auto"] as const) : []),
            "full-access",
          ],
        }
      })
    } finally {
      abortController.abort()
      prompt.close()
      discovery.close()
    }
  }

  start(input: HarnessRunInput, signal: AbortSignal): Promise<HarnessSession> {
    return Promise.resolve(new ClaudeSession(input, signal, this.options))
  }
}

class ClaudeSession implements HarnessSession {
  readonly #queue = new AsyncQueue<HarnessEvent>()
  readonly #approvalQueue: PendingApproval[] = []
  readonly #abortController = new AbortController()
  readonly #query: Query
  readonly events = this.#queue
  #activeApproval?: PendingApproval
  #closed = false
  #drainingApprovals = false
  #lastUsedTokens = 0
  #lastKnownMaxTokens?: number
  #primaryModel?: string
  #usageLimitResetAt?: string
  #terminalEventEmitted = false

  constructor(
    input: HarnessRunInput,
    signal: AbortSignal,
    { executablePath, packShimsPath }: ClaudeAdapterOptions
  ) {
    if (signal.aborted) this.#abortController.abort()
    signal.addEventListener("abort", () => this.#abortController.abort(), {
      once: true,
    })
    const pluginShims = claudePluginsFor(
      input.customization.skillRoots,
      packShimsPath
    )
    const canUseTool: CanUseTool = (toolName, toolInput, options) =>
      new Promise((resolve) => {
        const approvalId = options.toolUseID
        const finish = (decision: ApprovalDecision) => {
          if (!this.#removeApproval(approvalId)) return
          resolve(
            decision === "approve"
              ? { behavior: "allow", updatedInput: toolInput }
              : { behavior: "deny", message: "The user denied this action" }
          )
          this.#showNextApproval()
        }

        this.#approvalQueue.push({
          id: approvalId,
          resolve: finish,
          request: {
            id: approvalId,
            kind: toolName === "Bash" ? "command" : "tool",
            title: options.title ?? options.displayName ?? `Allow ${toolName}`,
            detail: options.description ?? readableInput(toolInput),
          },
        })
        this.#showNextApproval()
        if (options.signal.aborted) finish("deny")
        else
          options.signal.addEventListener("abort", () => finish("deny"), {
            once: true,
          })
      })

    this.#query = query({
      prompt: input.prompt,
      options: {
        abortController: this.#abortController,
        canUseTool,
        cwd: input.projectPath,
        includePartialMessages: true,
        permissionMode: claudePermissionMode(
          input.executionProfile.permissionMode
        ),
        allowDangerouslySkipPermissions:
          input.executionProfile.permissionMode === "full-access",
        ...(input.executionProfile.modelId
          ? { model: input.executionProfile.modelId }
          : {}),
        ...(input.executionProfile.effort
          ? {
              effort: input.executionProfile.effort as
                | "low"
                | "medium"
                | "high"
                | "xhigh"
                | "max",
            }
          : {}),
        settingSources: ["user", "project", "local"],
        systemPrompt: { type: "preset", preset: "claude_code" },
        ...(pluginShims.length > 0 ? { plugins: pluginShims } : {}),
        ...(executablePath
          ? { pathToClaudeCodeExecutable: executablePath }
          : {}),
        ...(input.providerSessionId ? { resume: input.providerSessionId } : {}),
      },
    })

    void this.#consume()
  }

  async cancel(): Promise<void> {
    this.#abortController.abort()
    this.#denyPending()
    try {
      await this.#query.interrupt()
    } catch {
      this.#query.close()
    }
  }

  respondToApproval(
    approvalId: string,
    decision: ApprovalDecision
  ): Promise<void> {
    if (this.#activeApproval?.id !== approvalId)
      return Promise.reject(new Error("Approval is no longer pending"))
    this.#activeApproval.resolve(decision)
    return Promise.resolve()
  }

  async #consume(): Promise<void> {
    try {
      for await (const message of this.#query) this.#mapMessage(message)
    } catch (error) {
      if (!this.#abortController.signal.aborted) {
        this.#emitTerminal({
          type: "turn.failed",
          failure: harnessFailure(errorMessage(error), this.#usageLimitResetAt),
        })
      }
    } finally {
      this.#finish()
    }
  }

  #mapMessage(message: SDKMessage): void {
    if (message.type === "rate_limit_event") {
      if (message.rate_limit_info.status === "rejected") {
        this.#usageLimitResetAt = message.rate_limit_info.resetsAt
          ? isoFromUnixTimestamp(message.rate_limit_info.resetsAt)
          : undefined
        this.#emitUsageLimit({
          kind: "usage-limit",
          message: "Claude Code usage limit reached",
          ...(this.#usageLimitResetAt
            ? { resetAt: this.#usageLimitResetAt }
            : {}),
        })
      }
      return
    }

    const assistantFailure = claudeAssistantFailure(
      message,
      this.#usageLimitResetAt
    )
    if (assistantFailure) {
      this.#emitUsageLimit(assistantFailure)
      return
    }

    if (message.type === "system" && message.subtype === "init") {
      this.#queue.push({
        type: "session.started",
        providerSessionId: message.session_id,
      })
      void this.#emitInitialContextUsage()
      return
    }

    if (message.type === "stream_event") {
      const event = message.event
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        this.#queue.push({ type: "message.delta", text: event.delta.text })
      }
      return
    }

    if (message.type === "assistant") {
      // Subagent (sidechain) messages run in their own context; only the main
      // thread's usage describes this session's window.
      if (message.parent_tool_use_id === null) {
        this.#primaryModel = message.message.model
        const usedTokens = contextTokens(message.message.usage)
        if (usedTokens > 0) this.#pushUsage(usedTokens)
      }
      for (const block of message.message.content) {
        if (block.type !== "tool_use") continue
        this.#queue.push({
          type: "activity.started",
          activity: {
            id: block.id,
            name: readableToolName(block.name),
            ...(readableInput(block.input)
              ? { detail: readableInput(block.input) }
              : {}),
          },
        })
      }
      return
    }

    if (message.type === "user" && Array.isArray(message.message.content)) {
      for (const block of message.message.content) {
        if (block.type !== "tool_result") continue
        this.#queue.push({
          type: "activity.completed",
          id: block.tool_use_id,
          outcome: block.is_error ? "failed" : "completed",
        })
      }
      return
    }

    if (message.type === "system" && message.subtype === "permission_denied") {
      this.#queue.push({
        type: "activity.completed",
        id: message.tool_use_id,
        outcome: "failed",
      })
      return
    }

    if (message.type !== "result") return

    // Fallback for CLIs without the context-usage control request: learn the
    // window from modelUsage once, then re-emit the last reading with it. When
    // the window is already known this stays silent — modelUsage spans subagent
    // models whose larger windows would skew the denominator.
    if (!this.#lastKnownMaxTokens) {
      const contextWindow = primaryContextWindow(
        message.modelUsage,
        this.#primaryModel
      )
      if (contextWindow) {
        this.#lastKnownMaxTokens = contextWindow
        if (this.#lastUsedTokens > 0) this.#pushUsage(this.#lastUsedTokens)
      }
    }

    if (message.subtype === "success") {
      this.#emitTerminal({ type: "turn.completed" })
    } else {
      this.#emitTerminal({
        type: "turn.failed",
        failure: harnessFailure(
          message.errors.join("\n") || "Claude could not complete the task",
          this.#usageLimitResetAt
        ),
      })
    }
  }

  /** Ask the CLI for the materialized context size, so resumed threads show usage before the first result. */
  async #emitInitialContextUsage(): Promise<void> {
    try {
      const usage = await this.#query.getContextUsage()
      if (this.#closed) return
      if (usage.maxTokens > 0) this.#lastKnownMaxTokens = usage.maxTokens
      if (this.#lastUsedTokens > 0) {
        // A per-message reading raced ahead of this response; keep it and just
        // attach the window it was missing.
        this.#pushUsage(this.#lastUsedTokens)
      } else if (usage.totalTokens > 0) {
        this.#pushUsage(usage.totalTokens)
      }
    } catch {
      // The control request is best-effort; per-message usage still arrives.
    }
  }

  #pushUsage(usedTokens: number): void {
    this.#lastUsedTokens = usedTokens
    this.#queue.push({
      type: "usage.updated",
      usage: {
        usedTokens,
        ...(this.#lastKnownMaxTokens
          ? { maxTokens: this.#lastKnownMaxTokens }
          : {}),
      },
    })
  }

  #emitUsageLimit(failure: HarnessFailure): void {
    this.#emitTerminal({ type: "turn.failed", failure })
  }

  #emitTerminal(
    event: Extract<HarnessEvent, { type: "turn.completed" | "turn.failed" }>
  ): void {
    if (this.#terminalEventEmitted) return
    this.#queue.push(event)
    this.#terminalEventEmitted = true
  }

  #denyPending(): void {
    this.#drainingApprovals = true
    const approvals = [
      ...(this.#activeApproval ? [this.#activeApproval] : []),
      ...this.#approvalQueue,
    ]
    for (const approval of approvals) approval.resolve("deny")
    this.#drainingApprovals = false
  }

  #removeApproval(id: string): boolean {
    if (this.#activeApproval?.id === id) {
      this.#activeApproval = undefined
      return true
    }
    const index = this.#approvalQueue.findIndex(
      (approval) => approval.id === id
    )
    if (index < 0) return false
    this.#approvalQueue.splice(index, 1)
    return true
  }

  #showNextApproval(): void {
    if (this.#activeApproval || this.#closed || this.#drainingApprovals) return
    const approval = this.#approvalQueue.shift()
    if (!approval) return
    this.#activeApproval = approval
    this.#queue.push({ type: "approval.requested", request: approval.request })
  }

  #finish(): void {
    if (this.#closed) return
    this.#closed = true
    this.#denyPending()
    this.#query.close()
    this.#queue.close()
  }
}

function readableInput(input: unknown): string | undefined {
  if (!isRecord(input)) return undefined
  const command = input.command
  if (typeof command === "string") return command

  const filePath = input.file_path
  if (typeof filePath === "string") return filePath
  const query = input.query
  if (typeof query === "string") return query
  const pattern = input.pattern
  if (typeof pattern === "string") return pattern
  return undefined
}

function readableToolName(name: string): string {
  const names: Record<string, string> = {
    Bash: "Run command",
    Edit: "Edit file",
    Glob: "Find files",
    Grep: "Search files",
    Read: "Read file",
    WebFetch: "Fetch webpage",
    WebSearch: "Search web",
    Write: "Write file",
  }
  return names[name] ?? name
}

function claudePermissionMode(
  mode: HarnessRunInput["executionProfile"]["permissionMode"]
): "default" | "auto" | "bypassPermissions" {
  if (mode === "auto") return "auto"
  if (mode === "full-access") return "bypassPermissions"
  return "default"
}

/** Tokens occupying the context after a model call: the full prompt (cached or not) plus the reply. */
function contextTokens(usage: unknown): number {
  if (!isRecord(usage)) return 0
  return (
    (positiveTokens(usage.input_tokens) ?? 0) +
    (positiveTokens(usage.cache_creation_input_tokens) ?? 0) +
    (positiveTokens(usage.cache_read_input_tokens) ?? 0) +
    (positiveTokens(usage.output_tokens) ?? 0)
  )
}

function primaryContextWindow(
  modelUsage: Record<string, { contextWindow: number }>,
  primaryModel: string | undefined
): number | undefined {
  if (!primaryModel) return undefined
  return positiveTokens(modelUsage[primaryModel]?.contextWindow)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Claude stopped unexpectedly"
}

/** Maps Claude's assistant error frame, which may still be followed by a successful result. */
export function claudeAssistantFailure(
  message: SDKMessage,
  resetAt?: string
): HarnessFailure | undefined {
  if (message.type !== "assistant" || message.error !== "rate_limit") {
    return undefined
  }
  const text = message.message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n")
    .trim()
  return {
    kind: "usage-limit",
    message: text || "Claude Code usage limit reached",
    ...(resetAt ? { resetAt } : {}),
  }
}

function isoFromUnixTimestamp(seconds: number): string | undefined {
  const milliseconds = seconds > 10_000_000_000 ? seconds : seconds * 1000
  const date = new Date(milliseconds)
  return Number.isNaN(date.valueOf()) ? undefined : date.toISOString()
}

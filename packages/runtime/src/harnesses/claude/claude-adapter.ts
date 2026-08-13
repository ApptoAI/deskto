import {
  query,
  type CanUseTool,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk"
import {
  AsyncQueue,
  type ApprovalDecision,
  type HarnessAdapterFactory,
  type HarnessEvent,
  type HarnessModelOption,
  type HarnessRunInput,
  type HarnessSession,
} from "@openappto/harness-sdk"

type ClaudeAdapterOptions = {
  executablePath?: string
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
    return Promise.resolve(
      new ClaudeSession(input, signal, this.options.executablePath)
    )
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

  constructor(
    input: HarnessRunInput,
    signal: AbortSignal,
    executablePath?: string
  ) {
    if (signal.aborted) this.#abortController.abort()
    signal.addEventListener("abort", () => this.#abortController.abort(), {
      once: true,
    })
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
        cwd: input.workspacePath,
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
        this.#queue.push({ type: "turn.failed", message: errorMessage(error) })
      }
    } finally {
      this.#finish()
    }
  }

  #mapMessage(message: SDKMessage): void {
    if (message.type === "system" && message.subtype === "init") {
      this.#queue.push({
        type: "session.started",
        providerSessionId: message.session_id,
      })
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

    if (message.subtype === "success") {
      this.#queue.push({ type: "turn.completed" })
    } else {
      this.#queue.push({
        type: "turn.failed",
        message:
          message.errors.join("\n") || "Claude could not complete the task",
      })
    }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Claude stopped unexpectedly"
}

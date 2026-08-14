import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"

import {
  AsyncQueue,
  harnessFailure,
  type ActivityStart,
  type ApprovalDecision,
  type ChangedFile,
  type ContextUsage,
  type HarnessAdapterFactory,
  type HarnessEvent,
  type HarnessModelOption,
  type HarnessRunInput,
  type HarnessSession,
  type PlanStep,
  type TextGenerationInput,
} from "@openappto/harness-sdk"

import { normalizePlanStepStatus } from "../plan-status.js"
import { isoFromEpoch } from "../timestamps.js"
import { positiveTokens } from "../token-usage.js"
import { generateTextWithSession } from "../generate-text.js"

import type {
  CodexNotification,
  CodexServerRequest,
  CodexThreadResponse,
  CodexTurnResponse,
} from "./codex-protocol.js"
import { getString, isRecord } from "./codex-protocol.js"
import { JsonlClient } from "./jsonl-client.js"

type PendingApproval = {
  id: string
  requestId: string | number
  request: Extract<HarnessEvent, { type: "approval.requested" }>["request"]
}

export class CodexAdapter implements HarnessAdapterFactory {
  readonly descriptor = { id: "codex", name: "Codex" }

  async checkAvailability() {
    try {
      return { status: "available" as const, version: await readVersion() }
    } catch {
      return {
        status: "unavailable" as const,
        reason: "Codex CLI was not found. Install Codex and sign in first.",
      }
    }
  }

  async listModels(): Promise<HarnessModelOption[]> {
    const client = new JsonlClient("codex", process.cwd())
    try {
      await initialize(client)
      const models: HarnessModelOption[] = []
      let cursor: string | null = null
      do {
        const response: unknown = await client.request("model/list", {
          includeHidden: false,
          cursor,
        })
        if (!isRecord(response) || !Array.isArray(response.data)) {
          throw new Error("Codex returned an invalid model catalog")
        }
        for (const candidate of response.data) {
          const model = codexModel(candidate)
          if (model) models.push(model)
        }
        cursor =
          typeof response.nextCursor === "string" ? response.nextCursor : null
      } while (cursor)
      return models
    } finally {
      client.close()
    }
  }

  start(input: HarnessRunInput, signal: AbortSignal): Promise<HarnessSession> {
    return CodexSession.open(input, signal)
  }

  generateText(
    input: TextGenerationInput,
    signal: AbortSignal
  ): Promise<string> {
    return generateTextWithSession(
      (run, runSignal) => this.start(run, runSignal),
      input,
      signal
    )
  }
}

class CodexSession implements HarnessSession {
  readonly #queue = new AsyncQueue<HarnessEvent>()
  readonly #approvalQueue: PendingApproval[] = []
  readonly #lastActivityShape = new Map<string, string>()
  readonly events = this.#queue
  #activeApproval?: PendingApproval
  #threadId?: string
  #turnId?: string
  #usageLimitResetAt?: string
  #closed = false

  private constructor(
    private readonly client: JsonlClient,
    private readonly input: HarnessRunInput
  ) {
    client.onNotification((notification) => this.#onNotification(notification))
    client.onRequest((request) => this.#onRequest(request))
    client.onFailure((error) => {
      this.#queue.push({
        type: "turn.failed",
        failure: harnessFailure(error.message, this.#usageLimitResetAt),
      })
      this.#discardApprovals()
      this.#finish()
    })
  }

  static async open(
    input: HarnessRunInput,
    signal: AbortSignal
  ): Promise<CodexSession> {
    const client = new JsonlClient("codex", input.projectPath)
    const session = new CodexSession(client, input)
    const abort = () => client.close()
    signal.addEventListener("abort", abort, { once: true })
    try {
      if (signal.aborted) abort()
      await session.#start()
      return session
    } catch (error) {
      client.close()
      throw error
    } finally {
      signal.removeEventListener("abort", abort)
    }
  }

  async cancel(): Promise<void> {
    try {
      if (this.#threadId && this.#turnId) {
        await this.client.request("turn/interrupt", {
          threadId: this.#threadId,
          turnId: this.#turnId,
        })
      }
    } catch {
      return
    } finally {
      this.#finish()
    }
  }

  respondToApproval(
    approvalId: string,
    decision: ApprovalDecision
  ): Promise<void> {
    const pending = this.#activeApproval
    if (pending?.id !== approvalId)
      return Promise.reject(new Error("Approval is no longer pending"))

    this.#activeApproval = undefined
    this.client.respond(pending.requestId, {
      decision: decision === "approve" ? "accept" : "decline",
    })
    this.#showNextApproval()
    return Promise.resolve()
  }

  async #start(): Promise<void> {
    await initialize(this.client)
    await this.#offerSkillRoots()

    const permissions = codexPermissions(
      this.input.executionProfile.permissionMode
    )
    const params = {
      cwd: this.input.projectPath,
      ...permissions.thread,
      ...(this.input.executionProfile.modelId
        ? { model: this.input.executionProfile.modelId }
        : {}),
    }
    const response = this.input.providerSessionId
      ? await this.client.request<CodexThreadResponse>("thread/resume", {
          ...params,
          threadId: this.input.providerSessionId,
        })
      : await this.client.request<CodexThreadResponse>("thread/start", params)

    this.#threadId = response.thread.id
    this.#queue.push({
      type: "session.started",
      providerSessionId: response.thread.id,
    })

    const turn = await this.client.request<CodexTurnResponse>("turn/start", {
      threadId: response.thread.id,
      input: [{ type: "text", text: this.input.prompt, text_elements: [] }],
      ...permissions.turn,
      ...(this.input.executionProfile.modelId
        ? { model: this.input.executionProfile.modelId }
        : {}),
      ...(this.input.executionProfile.effort
        ? { effort: this.input.executionProfile.effort }
        : {}),
    })
    this.#turnId = turn.turn.id
  }

  /**
   * Best effort: the app-server RPC surface is experimental and versioned
   * with the locally installed codex, so a pack the binary cannot accept
   * degrades silently instead of blocking the turn.
   */
  async #offerSkillRoots(): Promise<void> {
    const { skillRoots } = this.input.customization
    if (skillRoots.length === 0) return
    await this.client
      .request("skills/extraRoots/set", {
        extraRoots: skillRoots.map((root) => root.path),
      })
      .catch(() => undefined)
  }

  #onNotification(notification: CodexNotification): void {
    const params = notification.params
    if (!params) return

    if (notification.method === "item/agentMessage/delta") {
      const delta = getString(params, "delta")
      if (delta) this.#queue.push({ type: "message.delta", text: delta })
      return
    }

    if (notification.method === "thread/tokenUsage/updated") {
      const usage = codexContextUsage(params.tokenUsage)
      if (usage) this.#queue.push({ type: "usage.updated", usage })
      return
    }

    if (notification.method === "account/rateLimits/updated") {
      this.#usageLimitResetAt = codexLimitResetAt(params)
      return
    }

    if (
      notification.method === "item/started" ||
      notification.method === "item/updated" ||
      notification.method === "item/completed"
    ) {
      const item = isRecord(params.item) ? params.item : undefined
      const activity = codexActivity(item)
      if (!activity) return
      if (notification.method === "item/started") {
        this.#lastActivityShape.set(activity.id, JSON.stringify(activity))
        this.#queue.push({ type: "activity.started", activity })
      } else if (notification.method === "item/updated") {
        // Codex repeats item/updated while an item runs; identical shapes
        // would burn a write, a sequence number, and a renderer pass each.
        this.#pushActivityUpdate(activity)
      } else {
        const status = getString(item, "status")
        const type = getString(item, "type")
        // The terminal item can contain the final plan or file-change shape
        // even when Codex did not send a matching item/updated notification.
        this.#pushActivityUpdate(activity)
        this.#lastActivityShape.delete(activity.id)
        this.#queue.push({
          type: "activity.completed",
          id: activity.id,
          // A plan that ends without a status settled fine; for every other
          // item a missing status means it never ran to completion.
          outcome:
            status === "completed" || (status === undefined && type === "plan")
              ? "completed"
              : "failed",
        })
      }
      return
    }

    if (notification.method === "error" && params.willRetry === false) {
      const error = isRecord(params.error) ? params.error : undefined
      this.#queue.push({
        type: "turn.failed",
        failure: harnessFailure(
          getString(error, "message") ?? "Codex stopped unexpectedly",
          this.#usageLimitResetAt
        ),
      })
      this.#finish()
      return
    }

    if (notification.method !== "turn/completed") return
    const turn = isRecord(params.turn) ? params.turn : undefined
    const status = getString(turn, "status")
    if (status === "completed") {
      this.#queue.push({ type: "turn.completed" })
    } else if (status !== "interrupted") {
      const error = isRecord(turn?.error) ? turn.error : undefined
      this.#queue.push({
        type: "turn.failed",
        failure: harnessFailure(
          getString(error, "message") ?? "Codex could not complete the task",
          this.#usageLimitResetAt
        ),
      })
    }
    this.#finish()
  }

  #pushActivityUpdate(activity: ActivityStart): void {
    const shape = JSON.stringify(activity)
    if (this.#lastActivityShape.get(activity.id) === shape) return
    this.#lastActivityShape.set(activity.id, shape)
    this.#queue.push({
      type: "activity.updated",
      update: {
        id: activity.id,
        name: activity.name,
        ...(activity.detail !== undefined ? { detail: activity.detail } : {}),
        ...(activity.payload !== undefined
          ? { payload: activity.payload }
          : {}),
      },
    })
  }

  #onRequest(request: CodexServerRequest): void {
    const kind = approvalKind(request.method)
    if (!kind) {
      this.client.respondMethodNotFound(request.id, request.method)
      return
    }

    const approvalId = randomUUID()
    const command = request.params
      ? getString(request.params, "command")
      : undefined
    const reason = request.params
      ? getString(request.params, "reason")
      : undefined
    this.#approvalQueue.push({
      id: approvalId,
      requestId: request.id,
      request: {
        id: approvalId,
        kind,
        title:
          kind === "command"
            ? "Allow this command?"
            : "Allow this file change?",
        ...(command || reason ? { detail: command ?? reason } : {}),
      },
    })
    this.#showNextApproval()
  }

  #finish(): void {
    if (this.#closed) return
    this.#closed = true
    const approvals = [
      ...(this.#activeApproval ? [this.#activeApproval] : []),
      ...this.#approvalQueue,
    ]
    for (const approval of approvals) {
      try {
        this.client.respond(approval.requestId, { decision: "cancel" })
      } catch {
        break
      }
    }
    this.#discardApprovals()
    this.#lastActivityShape.clear()
    this.client.close()
    this.#queue.close()
  }

  #showNextApproval(): void {
    if (this.#activeApproval || this.#closed) return
    const approval = this.#approvalQueue.shift()
    if (!approval) return
    this.#activeApproval = approval
    this.#queue.push({ type: "approval.requested", request: approval.request })
  }

  #discardApprovals(): void {
    this.#activeApproval = undefined
    this.#approvalQueue.length = 0
  }
}

async function initialize(client: JsonlClient): Promise<void> {
  await client.request("initialize", {
    clientInfo: { name: "appto", title: "Appto", version: "0.0.1" },
    capabilities: { experimentalApi: false, requestAttestation: false },
  })
  client.notify("initialized")
}

function codexModel(value: unknown): HarnessModelOption | undefined {
  if (!isRecord(value)) return undefined
  const id = getString(value, "id") ?? getString(value, "model")
  const name = getString(value, "displayName")
  if (!id || !name) return undefined
  const supportedEfforts = Array.isArray(value.supportedReasoningEfforts)
    ? value.supportedReasoningEfforts.flatMap((option) => {
        const effort = getString(option, "reasoningEffort")
        return effort ? [effort] : []
      })
    : []
  const defaultEffort = getString(value, "defaultReasoningEffort")
  return {
    id,
    name,
    ...(getString(value, "description")
      ? { description: getString(value, "description") }
      : {}),
    supportedEfforts,
    ...(defaultEffort ? { defaultEffort } : {}),
    isDefault: value.isDefault === true,
    supportedPermissionModes: ["approval-required", "auto", "full-access"],
  }
}

function codexPermissions(
  mode: HarnessRunInput["executionProfile"]["permissionMode"]
) {
  if (mode === "full-access") {
    return {
      thread: {
        approvalPolicy: "never",
        approvalsReviewer: "user",
        sandbox: "danger-full-access",
      },
      turn: {
        approvalPolicy: "never",
        approvalsReviewer: "user",
        sandboxPolicy: { type: "dangerFullAccess" },
      },
    }
  }
  const approvalsReviewer = mode === "auto" ? "auto_review" : "user"
  if (mode === "approval-required") {
    return {
      thread: {
        approvalPolicy: "untrusted",
        approvalsReviewer,
        sandbox: "read-only",
      },
      turn: {
        approvalPolicy: "untrusted",
        approvalsReviewer,
        sandboxPolicy: { type: "readOnly", networkAccess: false },
      },
    }
  }
  return {
    thread: {
      approvalPolicy: "on-request",
      approvalsReviewer,
      // Codex wire value; "workspace" here is Codex's word, not our domain's.
      sandbox: "workspace-write",
    },
    turn: {
      approvalPolicy: "on-request",
      approvalsReviewer,
      sandboxPolicy: {
        type: "workspaceWrite",
        writableRoots: [],
        networkAccess: false,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      },
    },
  }
}

/** `tokenUsage.last` describes the latest model call, so its total is the current context occupancy. */
function codexContextUsage(value: unknown): ContextUsage | undefined {
  if (!isRecord(value)) return undefined
  const last = isRecord(value.last) ? value.last : undefined
  const usedTokens = positiveTokens(last?.totalTokens)
  if (!usedTokens) return undefined
  const maxTokens = positiveTokens(value.modelContextWindow)
  return { usedTokens, ...(maxTokens ? { maxTokens } : {}) }
}

export function codexLimitResetAt(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined
  const limits = isRecord(value.rateLimits) ? value.rateLimits : value
  const slots = [limits.primary, limits.secondary]
    .filter(isRecord)
    .map((slot) => ({
      usedPercent:
        typeof slot.usedPercent === "number"
          ? slot.usedPercent
          : typeof slot.used_percent === "number"
            ? slot.used_percent
            : -1,
      reset:
        typeof slot.resetsAt === "number"
          ? slot.resetsAt
          : typeof slot.resets_at === "number"
            ? slot.resets_at
            : undefined,
    }))
    .filter(
      (slot): slot is { usedPercent: number; reset: number } =>
        slot.reset !== undefined
    )
    .sort((left, right) => right.usedPercent - left.usedPercent)
  const reset = slots[0]?.reset
  if (reset === undefined) return undefined
  return isoFromEpoch(reset)
}

export function codexActivity(
  item: Record<string, unknown> | undefined
): ActivityStart | undefined {
  const id = getString(item, "id")
  const type = getString(item, "type")
  if (!id || !type || ignoredItemTypes.has(type)) return undefined

  if (type === "commandExecution") {
    return {
      id,
      name: "Run command",
      ...detailOf(compactDetail(item?.command)),
      payload: { kind: "tool", tool: "command" },
    }
  }
  if (type === "fileChange") {
    const files = changedFiles(item?.changes)
    return {
      id,
      name: "Change files",
      ...detailOf(fileSummary(files)),
      payload:
        files.length > 0
          ? { kind: "file-change", files }
          : { kind: "tool", tool: "other" },
    }
  }
  if (type === "plan") {
    const steps = item ? codexPlanSteps(item) : []
    return {
      id,
      name: "Plan",
      ...detailOf(steps.length === 0 ? getString(item, "text") : undefined),
      payload:
        steps.length > 0
          ? { kind: "plan", steps }
          : { kind: "tool", tool: "other" },
    }
  }
  if (type === "mcpToolCall") {
    const server = getString(item, "server")
    const tool = getString(item, "tool")
    return {
      id,
      name: tool ?? "Use MCP tool",
      ...detailOf(server),
      payload: { kind: "tool", tool: "mcp" },
    }
  }
  if (type === "webSearch") {
    return {
      id,
      name: "Search web",
      ...detailOf(getString(item, "query")),
      payload: { kind: "tool", tool: "web" },
    }
  }
  if (type === "imageView") {
    return { id, name: "View image", payload: { kind: "tool", tool: "other" } }
  }
  return {
    id,
    name: wordsFromCamelCase(type),
    payload: { kind: "tool", tool: "other" },
  }
}

const ignoredItemTypes = new Set(["agentMessage", "userMessage", "reasoning"])

function detailOf(detail: string | undefined): { detail?: string } {
  return detail ? { detail } : {}
}

function compactDetail(value: unknown): string | undefined {
  if (typeof value === "string") return value.slice(0, 500)
  if (Array.isArray(value)) {
    const text = value
      .filter((part): part is string => typeof part === "string")
      .join(" ")
    return text ? text.slice(0, 500) : undefined
  }
  return undefined
}

function changedFiles(value: unknown): ChangedFile[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((change) => {
    const path = getString(change, "path")
    if (!path) return []
    const additions = fileChangeCount(change, "additions")
    const deletions = fileChangeCount(change, "deletions")
    return [
      {
        path,
        ...(additions !== undefined ? { additions } : {}),
        ...(deletions !== undefined ? { deletions } : {}),
      },
    ]
  })
}

function fileChangeCount(
  value: unknown,
  key: "additions" | "deletions"
): number | undefined {
  if (!isRecord(value)) return undefined
  const count = value[key]
  return typeof count === "number" && Number.isInteger(count) && count >= 0
    ? count
    : undefined
}

function fileSummary(files: ChangedFile[]): string | undefined {
  if (files.length === 0) return undefined
  const shown = files.slice(0, 3).map((file) => file.path)
  const remaining = files.length - shown.length
  const summary = shown.join(", ")
  return remaining > 0 ? `${summary} +${remaining} more` : summary
}

/**
 * Codex plan items are experimental app-server surface; accept the step-list
 * shapes seen in the wild and fall back to a plain row when none match.
 */
export function codexPlanSteps(item: Record<string, unknown>): PlanStep[] {
  const candidates = [item.plan, item.steps, item.items]
  const list = candidates.find(Array.isArray)
  if (!list) return []
  return list.flatMap((entry) => {
    if (typeof entry === "string") return [{ text: entry, status: "pending" }]
    if (!isRecord(entry)) return []
    const text =
      getString(entry, "step") ??
      getString(entry, "text") ??
      getString(entry, "content") ??
      getString(entry, "title")
    if (!text) return []
    return [
      { text, status: normalizePlanStepStatus(getString(entry, "status")) },
    ]
  })
}

function wordsFromCamelCase(value: string): string {
  const words = value.replace(/([a-z])([A-Z])/g, "$1 $2")
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function approvalKind(method: string): "command" | "file-change" | undefined {
  if (method === "item/commandExecution/requestApproval") return "command"
  if (method === "item/fileChange/requestApproval") return "file-change"
  return undefined
}

function readVersion(): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("codex", ["--version"], {
      env: process.env,
      stdio: ["ignore", "pipe", "ignore"],
    })
    let output = ""
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString()
    })
    child.once("error", reject)
    child.once("exit", (code) => {
      if (code === 0) resolve(output.trim())
      else reject(new Error("Codex CLI is unavailable"))
    })
  })
}

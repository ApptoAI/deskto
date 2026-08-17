import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { homedir } from "node:os"
import { join } from "node:path"

import {
  AsyncQueue,
  harnessFailure,
  type ActivityStart,
  type ActivityUpdate,
  type ApprovalDecision,
  type ChangedFile,
  type ContextUsage,
  type HarnessAdapterFactory,
  type HarnessEvent,
  type HarnessModelOption,
  type HarnessRunInput,
  type HarnessSession,
  type NativeSkillRoot,
  type PlanStep,
  type TextGenerationInput,
  type SkillDiscoveryInput,
  type SkillProvisioningResult,
  type SkillRoot,
  type SessionMcpServer,
} from "@deskto/harness-sdk"
import {
  jsonObjectSchema,
  jsonValueSchema,
  type JsonObject,
  type JsonValue,
} from "@deskto/protocol"
import { z } from "zod"

import { normalizePlanStepStatus } from "../plan-status.js"
import { isoFromEpoch } from "../timestamps.js"
import { positiveTokens } from "../token-usage.js"
import { generateTextWithSession } from "../generate-text.js"
import { projectSkillRootPaths } from "../../skills/project-skill-roots.js"

import type { CodexNotification, CodexServerRequest } from "./codex-protocol.js"
import {
  codexThreadResponseSchema,
  codexTurnResponseSchema,
  getString,
  parseJsonObject,
} from "./codex-protocol.js"
import { JsonlClient, type JsonlClientOptions } from "./jsonl-client.js"

const codexModelListSchema = z.object({
  data: z.array(jsonValueSchema),
  nextCursor: z.string().nullable().optional(),
})
type CodexModelListResponse = z.infer<typeof codexModelListSchema>

const codexLimitSlotSchema = z.object({
  usedPercent: z.number().optional(),
  used_percent: z.number().optional(),
  resetsAt: z.number().optional(),
  resets_at: z.number().optional(),
})

const compactDetailSchema = z.union([z.string(), z.array(z.string())])

export interface CodexClient {
  request<T extends JsonValue>(
    method: string,
    params: JsonObject,
    schema: z.ZodType<T>
  ): Promise<T>
  notify(method: string, params?: JsonObject): void
  respond(id: string | number, result: JsonObject): void
  respondMethodNotFound(id: string | number, method: string): void
  onNotification(
    listener: (notification: CodexNotification) => void
  ): () => void
  onRequest(listener: (request: CodexServerRequest) => void): () => void
  onFailure(listener: (error: Error) => void): () => void
  close(): void
}

export type CodexClientFactory = (
  command: string,
  cwd: string,
  options?: JsonlClientOptions
) => CodexClient

const createCodexClient: CodexClientFactory = (command, cwd, options) =>
  new JsonlClient(command, cwd, options)
type PendingApproval = {
  id: string
  requestId: string | number
  request: Extract<HarnessEvent, { type: "approval.requested" }>["request"]
}

type ActivityScope = {
  parentId?: string
  providerThreadId?: string
}

type DelegationLifecycle = {
  childThreadIds: string[]
  defersCompletion: boolean
  interruptedThreadId?: string
  terminalStates: Array<{
    threadId: string
    outcome: "completed" | "failed"
  }>
}

export class CodexAdapter implements HarnessAdapterFactory {
  readonly descriptor = { id: "codex", name: "Codex" }

  constructor(
    private readonly clientFactory: CodexClientFactory = createCodexClient
  ) {}

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
    const client = this.clientFactory("codex", process.cwd())
    try {
      await initialize(client)
      const models: HarnessModelOption[] = []
      let cursor: string | null = null
      do {
        const response: CodexModelListResponse = await client.request(
          "model/list",
          { includeHidden: false, cursor },
          codexModelListSchema
        )
        for (const candidate of response.data) {
          const model = codexModel(candidate)
          if (model) models.push(model)
        }
        cursor = response.nextCursor ?? null
      } while (cursor)
      return models
    } finally {
      client.close()
    }
  }

  async discoverSkillRoots(
    input: SkillDiscoveryInput
  ): Promise<NativeSkillRoot[]> {
    const roots: NativeSkillRoot[] = []
    if (input.projectPath) {
      const projectRoots = await projectSkillRootPaths(
        input.projectPath,
        join(".agents", "skills")
      )
      roots.push(
        ...projectRoots.map((path) => ({
          path,
          scope: "project" as const,
          label: "Codex project skills",
        }))
      )
    }
    roots.push({
      path: join(homedir(), ".agents", "skills"),
      scope: "user",
      label: "Codex personal skills",
    })
    if (process.platform !== "win32") {
      roots.push({
        path: "/etc/codex/skills",
        scope: "admin",
        label: "Codex administrator skills",
      })
    }
    return roots
  }

  start(input: HarnessRunInput, signal: AbortSignal): Promise<HarnessSession> {
    return CodexSession.open(input, signal, this.clientFactory)
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
  readonly #activityThreads = new Map<string, string>()
  readonly #delegatedActivities = new Map<string, string>()
  readonly #delegationFailures = new Set<string>()
  readonly #lastActivitySnapshot = new Map<string, string>()
  readonly #startedPlans = new Set<string>()
  readonly #settledActivities = new Set<string>()
  readonly events = this.#queue
  readonly skillProvisioning: SkillProvisioningResult[] = []
  #activeApproval?: PendingApproval
  #threadId?: string
  #turnId?: string
  #usageLimitResetAt?: string
  #closed = false

  private constructor(
    private readonly client: CodexClient,
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
    signal: AbortSignal,
    clientFactory: CodexClientFactory
  ): Promise<CodexSession> {
    const client = clientFactory(
      "codex",
      input.projectPath,
      codexMcpLaunchOptions(input.customization.mcpServers ?? [])
    )
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
        await this.client.request(
          "turn/interrupt",
          { threadId: this.#threadId, turnId: this.#turnId },
          jsonValueSchema
        )
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
    }
    if (this.input.executionProfile.modelId) {
      Object.assign(params, { model: this.input.executionProfile.modelId })
    }
    const response = this.input.providerSessionId
      ? await this.client.request(
          "thread/resume",
          { ...params, threadId: this.input.providerSessionId },
          codexThreadResponseSchema
        )
      : await this.client.request(
          "thread/start",
          params,
          codexThreadResponseSchema
        )

    this.#threadId = response.thread.id
    this.#queue.push({
      type: "session.started",
      providerSessionId: response.thread.id,
    })

    const input = codexTurnInput(this.input)
    const turnParams = {
      threadId: response.thread.id,
      input,
      ...permissions.turn,
    }
    if (this.input.executionProfile.modelId) {
      Object.assign(turnParams, { model: this.input.executionProfile.modelId })
    }
    if (this.input.executionProfile.effort) {
      Object.assign(turnParams, { effort: this.input.executionProfile.effort })
    }
    const turn = await this.client.request(
      "turn/start",
      jsonObjectSchema.parse(turnParams),
      codexTurnResponseSchema
    )
    this.#turnId = turn.turn.id
  }

  async #offerSkillRoots(): Promise<void> {
    const { skillRoots } = this.input.customization
    if (skillRoots.length === 0) return
    try {
      await this.client.request(
        "skills/extraRoots/set",
        {
          extraRoots: skillRoots.map((root) => root.path),
        },
        jsonValueSchema
      )
      this.skillProvisioning.push(
        ...skillRoots.map((root) => codexProvisioning(root, "configured"))
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const status = /unsupported|method not found/i.test(message)
        ? "unsupported"
        : "failed"
      this.skillProvisioning.push(
        ...skillRoots.map((root) => codexProvisioning(root, status, message))
      )
    }
  }

  #onNotification(notification: CodexNotification): void {
    const params = notification.params
    if (!params) return

    if (notification.method === "item/agentMessage/delta") {
      if (!this.#isCurrentTurn(params)) return
      const delta = getString(params, "delta")
      if (delta) this.#queue.push({ type: "message.delta", text: delta })
      return
    }

    if (notification.method === "thread/tokenUsage/updated") {
      if (!this.#isCurrentThread(params)) return
      const usage = codexContextUsage(params.tokenUsage)
      if (usage) this.#queue.push({ type: "usage.updated", usage })
      return
    }

    if (notification.method === "account/rateLimits/updated") {
      this.#usageLimitResetAt = codexLimitResetAt(params)
      return
    }

    if (notification.method === "turn/plan/updated") {
      const scope = this.#activityScope(params)
      if (!scope) return
      this.#pushPlan(params, scope)
      return
    }

    if (
      notification.method === "item/started" ||
      notification.method === "item/updated" ||
      notification.method === "item/completed"
    ) {
      const scope = this.#activityScope(params)
      if (!scope) return
      const item = parseJsonObject(params.item)
      const delegation = codexDelegationLifecycle(item)
      if (delegation) {
        const activityId = getString(item, "id")
        if (activityId) {
          for (const threadId of delegation.childThreadIds) {
            this.#delegatedActivities.set(threadId, activityId)
          }
        }
        for (const terminal of delegation.terminalStates) {
          this.#settleDelegatedThread(terminal.threadId, terminal.outcome)
        }
        if (delegation.interruptedThreadId) {
          this.#settleDelegatedThread(delegation.interruptedThreadId, "failed")
          return
        }
      }
      const baseActivity = codexActivity(item)
      if (!baseActivity) return
      if (this.#settledActivities.has(baseActivity.id)) return
      const activity = scope.parentId
        ? { ...baseActivity, parentId: scope.parentId }
        : baseActivity
      if (scope.providerThreadId) {
        this.#activityThreads.set(activity.id, scope.providerThreadId)
      }
      if (notification.method === "item/started") {
        this.#lastActivitySnapshot.set(activity.id, JSON.stringify(activity))
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
        // A successful spawn only completes the announcement. The delegated
        // activity settles from the child turn or a reported agent state.
        if (
          delegation?.defersCompletion &&
          status !== "failed" &&
          status !== "errored"
        )
          return
        this.#completeActivity(
          activity.id,
          codexActivityOutcome(type, status, item)
        )
      }
      return
    }

    if (notification.method === "error" && params.willRetry === false) {
      const errorThreadId = getString(params, "threadId")
      if (
        errorThreadId &&
        errorThreadId !== this.#threadId &&
        this.#delegatedActivities.has(errorThreadId)
      ) {
        this.#settleDelegatedThread(errorThreadId, "failed")
        return
      }
      if (!this.#isCurrentTurn(params)) return
      const error = parseJsonObject(params.error)
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
    const notificationThreadId = getString(params, "threadId")
    if (
      notificationThreadId &&
      notificationThreadId !== this.#threadId &&
      this.#delegatedActivities.has(notificationThreadId)
    ) {
      const childTurn = parseJsonObject(params.turn)
      this.#settleDelegatedThread(
        notificationThreadId,
        getString(childTurn, "status") === "completed" ? "completed" : "failed"
      )
      return
    }
    if (!this.#isCurrentTurn(params)) return
    const turn = parseJsonObject(params.turn)
    const status = getString(turn, "status")
    if (status === "completed") {
      this.#queue.push({ type: "turn.completed" })
    } else if (status !== "interrupted") {
      const error = parseJsonObject(turn?.error)
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

  #isCurrentThread(params: JsonObject): boolean {
    const threadId = getString(params, "threadId")
    return (
      threadId === undefined ||
      this.#threadId === undefined ||
      threadId === this.#threadId
    )
  }

  #isCurrentTurn(params: JsonObject): boolean {
    const turn = parseJsonObject(params.turn)
    const turnId = getString(params, "turnId") ?? getString(turn, "id")
    return (
      this.#isCurrentThread(params) &&
      (turnId === undefined ||
        this.#turnId === undefined ||
        turnId === this.#turnId)
    )
  }

  #activityScope(params: JsonObject): ActivityScope | undefined {
    if (this.#isCurrentTurn(params)) return {}
    const threadId = getString(params, "threadId")
    if (!threadId) return undefined
    const parentId = this.#delegatedActivities.get(threadId)
    return parentId ? { parentId, providerThreadId: threadId } : undefined
  }

  #settleDelegatedThread(
    threadId: string,
    outcome: "completed" | "failed",
    visited: Set<string> = new Set()
  ): void {
    if (visited.has(threadId)) return
    visited.add(threadId)
    const activityId = this.#delegatedActivities.get(threadId)
    if (!activityId) return
    for (const [childActivityId, ownerThreadId] of this.#activityThreads) {
      if (ownerThreadId !== threadId) continue
      const descendantThreads = [...this.#delegatedActivities.entries()]
        .filter(([, parentActivityId]) => parentActivityId === childActivityId)
        .map(([descendantThreadId]) => descendantThreadId)
      for (const descendantThreadId of descendantThreads) {
        this.#settleDelegatedThread(descendantThreadId, outcome, visited)
      }
      this.#completeActivity(childActivityId, outcome)
    }
    if (outcome === "failed") this.#delegationFailures.add(activityId)
    this.#delegatedActivities.delete(threadId)
    const hasRunningSibling = [...this.#delegatedActivities.values()].includes(
      activityId
    )
    if (hasRunningSibling) return
    const finalOutcome = this.#delegationFailures.delete(activityId)
      ? "failed"
      : outcome
    this.#completeActivity(activityId, finalOutcome)
  }

  #completeActivity(activityId: string, outcome: "completed" | "failed"): void {
    if (this.#settledActivities.has(activityId)) return
    this.#settledActivities.add(activityId)
    this.#activityThreads.delete(activityId)
    this.#delegationFailures.delete(activityId)
    this.#lastActivitySnapshot.delete(activityId)
    for (const [candidateThreadId, candidateActivityId] of this
      .#delegatedActivities) {
      if (candidateActivityId === activityId) {
        this.#delegatedActivities.delete(candidateThreadId)
      }
    }
    this.#queue.push({ type: "activity.completed", id: activityId, outcome })
  }

  /** The current app-server sends plans outside the item lifecycle. */
  #pushPlan(params: JsonObject, scope: ActivityScope): void {
    const steps = codexPlanSteps(params)
    if (steps.length === 0) return
    const id = scope.providerThreadId
      ? `${codexPlanActivityId}:${scope.providerThreadId}`
      : codexPlanActivityId
    const activity: ActivityStart = {
      id,
      name: "Plan",
      payload: { kind: "plan", steps },
    }
    if (scope.parentId) activity.parentId = scope.parentId
    if (scope.providerThreadId) {
      this.#activityThreads.set(activity.id, scope.providerThreadId)
    }
    if (this.#startedPlans.has(activity.id)) {
      this.#pushActivityUpdate(activity)
      return
    }
    this.#startedPlans.add(activity.id)
    this.#lastActivitySnapshot.set(activity.id, JSON.stringify(activity))
    this.#queue.push({ type: "activity.started", activity })
  }

  #pushActivityUpdate(activity: ActivityStart): void {
    const snapshot = JSON.stringify(activity)
    if (this.#lastActivitySnapshot.get(activity.id) === snapshot) return
    this.#lastActivitySnapshot.set(activity.id, snapshot)
    const update: ActivityUpdate = {
      id: activity.id,
      name: activity.name,
    }
    if (activity.detail !== undefined) update.detail = activity.detail
    if (activity.payload !== undefined) update.payload = activity.payload
    this.#queue.push({ type: "activity.updated", update })
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
    const approvalRequest: PendingApproval["request"] = {
      id: approvalId,
      kind,
      title:
        kind === "command" ? "Allow this command?" : "Allow this file change?",
    }
    const detail = command ?? reason
    if (detail) approvalRequest.detail = detail
    this.#approvalQueue.push({
      id: approvalId,
      requestId: request.id,
      request: approvalRequest,
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
    this.#lastActivitySnapshot.clear()
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

export function codexTurnInput(
  input: Pick<HarnessRunInput, "prompt" | "references" | "attachments">
): JsonObject[] {
  return [
    ...(input.prompt
      ? [{ type: "text", text: input.prompt, text_elements: [] }]
      : []),
    ...input.references.map((reference) =>
      reference.kind === "skill"
        ? { type: "skill", name: reference.name, path: reference.path }
        : { type: "mention", name: reference.name, path: reference.path }
    ),
    ...(input.attachments ?? []).map((attachment) => ({
      type: "image",
      url: attachment.dataUrl,
    })),
  ]
}

export function codexMcpLaunchOptions(
  servers: readonly SessionMcpServer[]
): JsonlClientOptions {
  if (servers.length === 0) return {}
  const args: string[] = []
  const env: NodeJS.ProcessEnv = { ...process.env }
  servers.forEach((server, index) => {
    if (!/^[A-Za-z0-9_-]+$/.test(server.id)) {
      throw new Error(`Invalid MCP server id: ${server.id}`)
    }
    const prefix = `mcp_servers.${server.id}`
    args.push("-c", `${prefix}.url=${JSON.stringify(server.url)}`)
    args.push("-c", `${prefix}.required=true`)
    if (server.authorization) {
      const variable = `DESKTO_MCP_${index}_TOKEN`
      env[variable] = server.authorization.token
      args.push(
        "-c",
        `${prefix}.bearer_token_env_var=${JSON.stringify(variable)}`,
        "-c",
        `shell_environment_policy.set.${variable}=""`
      )
    }
  })
  return { args, env }
}

async function initialize(client: CodexClient): Promise<void> {
  await client.request(
    "initialize",
    {
      clientInfo: { name: "deskto", title: "Deskto", version: "0.0.1" },
      capabilities: { experimentalApi: false, requestAttestation: false },
    },
    jsonValueSchema
  )
  client.notify("initialized")
}

function codexModel(value: JsonValue): HarnessModelOption | undefined {
  const record = parseJsonObject(value)
  if (!record) return undefined
  const id = getString(record, "id") ?? getString(record, "model")
  const name = getString(record, "displayName")
  if (!id || !name) return undefined
  const effortList = z
    .array(jsonValueSchema)
    .safeParse(record.supportedReasoningEfforts)
  const supportedEfforts = effortList.success
    ? effortList.data.flatMap((option) => {
        const effort = getString(parseJsonObject(option), "reasoningEffort")
        return effort ? [effort] : []
      })
    : []
  const defaultEffort = getString(record, "defaultReasoningEffort")
  const model: HarnessModelOption = {
    id,
    name,
    supportedEfforts,
    isDefault: record.isDefault === true,
    supportedPermissionModes: ["approval-required", "auto", "full-access"],
  }
  const description = getString(record, "description")
  if (description) model.description = description
  if (defaultEffort) model.defaultEffort = defaultEffort
  return model
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
function codexContextUsage(
  value: JsonValue | undefined
): ContextUsage | undefined {
  const record = parseJsonObject(value)
  if (!record) return undefined
  const last = parseJsonObject(record.last)
  const parsedUsedTokens = z.number().safeParse(last?.totalTokens)
  const usedTokens = positiveTokens(
    parsedUsedTokens.success ? parsedUsedTokens.data : undefined
  )
  if (!usedTokens) return undefined
  const parsedMaxTokens = z.number().safeParse(record.modelContextWindow)
  const maxTokens = positiveTokens(
    parsedMaxTokens.success ? parsedMaxTokens.data : undefined
  )
  const usage: ContextUsage = { usedTokens }
  if (maxTokens) usage.maxTokens = maxTokens
  return usage
}

export function codexLimitResetAt(
  value: JsonValue | undefined
): string | undefined {
  const record = parseJsonObject(value)
  if (!record) return undefined
  const limits = parseJsonObject(record.rateLimits) ?? record
  const slots = [limits.primary, limits.secondary]
    .flatMap((value) => {
      const parsed = codexLimitSlotSchema.safeParse(value)
      return parsed.success ? [parsed.data] : []
    })
    .map((slot) => ({
      usedPercent: slot.usedPercent ?? slot.used_percent ?? -1,
      reset: slot.resetsAt ?? slot.resets_at,
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
  item: JsonObject | undefined
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
    if (steps.length === 0) return undefined
    return {
      id,
      name: "Plan",
      payload: { kind: "plan", steps },
    }
  }
  if (type === "subAgentActivity") {
    const agentPath = getString(item, "agentPath")
    const kind = getString(item, "kind")
    return kind === "started"
      ? {
          id,
          name: subagentName(agentPath),
          payload: { kind: "subagent" },
        }
      : {
          id,
          name: kind === "interrupted" ? "Stop subagent" : "Contact subagent",
          ...detailOf(agentPath),
          payload: { kind: "tool", tool: "other" },
        }
  }
  if (type === "collabAgentToolCall") {
    const tool = getString(item, "tool")
    const prompt = compactDetail(item?.prompt)
    if (tool === "spawnAgent") {
      return {
        id,
        name: prompt ? firstLine(prompt, 80) : "Subagent",
        payload: { kind: "subagent" },
      }
    }
    return {
      id,
      name: collabToolName(tool),
      ...detailOf(prompt),
      payload: { kind: "tool", tool: "other" },
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

const codexPlanActivityId = "codex-plan"

function codexActivityOutcome(
  type: string | undefined,
  status: string | undefined,
  item: JsonObject | undefined
): "completed" | "failed" {
  if (status !== undefined)
    return status === "completed" ? "completed" : "failed"
  if (type === "plan") return "completed"
  if (type === "subAgentActivity") {
    return getString(item, "kind") === "interrupted" ? "failed" : "completed"
  }
  return "failed"
}

function codexDelegationLifecycle(
  item: JsonObject | undefined
): DelegationLifecycle | undefined {
  const type = getString(item, "type")
  if (type === "subAgentActivity") {
    const threadId = getString(item, "agentThreadId")
    const kind = getString(item, "kind")
    const lifecycle: DelegationLifecycle = {
      childThreadIds: kind === "started" && threadId ? [threadId] : [],
      defersCompletion: kind === "started",
      terminalStates: [],
    }
    if (kind === "interrupted" && threadId) {
      lifecycle.interruptedThreadId = threadId
    }
    return lifecycle
  }
  if (type !== "collabAgentToolCall") return undefined

  const childThreadIds =
    getString(item, "tool") === "spawnAgent"
      ? stringArray(item?.receiverThreadIds)
      : []
  const states = parseJsonObject(item?.agentsStates) ?? {}
  const terminalStates = Object.entries(states).flatMap(
    ([threadId, rawState]): DelegationLifecycle["terminalStates"] => {
      const state = getString(parseJsonObject(rawState), "status")
      if (state === "completed" || state === "shutdown") {
        return [{ threadId, outcome: "completed" }]
      }
      if (
        state === "interrupted" ||
        state === "errored" ||
        state === "notFound"
      ) {
        return [{ threadId, outcome: "failed" }]
      }
      return []
    }
  )
  return {
    childThreadIds,
    defersCompletion: getString(item, "tool") === "spawnAgent",
    terminalStates,
  }
}

function stringArray(value: JsonValue | undefined): string[] {
  const parsed = z.array(z.string()).safeParse(value)
  return parsed.success ? parsed.data : []
}

function subagentName(agentPath: string | undefined): string {
  const leaf = agentPath?.split("/").filter(Boolean).at(-1)
  return leaf ? wordsFromIdentifier(leaf) : "Subagent"
}

function collabToolName(tool: string | undefined): string {
  const names = new Map<string, string>([
    ["sendInput", "Contact subagent"],
    ["resumeAgent", "Resume subagent"],
    ["wait", "Wait for subagents"],
    ["closeAgent", "Close subagent"],
  ])
  return names.get(tool ?? "") ?? "Use subagent"
}

function firstLine(value: string, maxLength: number): string {
  return value.split(/\r?\n/, 1)[0]!.slice(0, maxLength)
}

function detailOf(detail: string | undefined): { detail?: string } {
  return detail ? { detail } : {}
}

function compactDetail(value: JsonValue | undefined): string | undefined {
  const parsed = compactDetailSchema.safeParse(value)
  if (!parsed.success) return undefined
  const text = Array.isArray(parsed.data) ? parsed.data.join(" ") : parsed.data
  return text ? text.slice(0, 500) : undefined
}

function changedFiles(value: JsonValue | undefined): ChangedFile[] {
  const parsed = z.array(jsonValueSchema).safeParse(value)
  if (!parsed.success) return []
  return parsed.data.flatMap((change) => {
    const record = parseJsonObject(change)
    const path = getString(record, "path")
    if (!path) return []
    const additions = fileChangeCount(record, "additions")
    const deletions = fileChangeCount(record, "deletions")
    const file: ChangedFile = { path }
    if (additions !== undefined) file.additions = additions
    if (deletions !== undefined) file.deletions = deletions
    return [file]
  })
}

function fileChangeCount(
  value: JsonObject | undefined,
  key: "additions" | "deletions"
): number | undefined {
  const parsed = z.number().int().nonnegative().safeParse(value?.[key])
  return parsed.success ? parsed.data : undefined
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
export function codexPlanSteps(item: JsonObject): PlanStep[] {
  const candidates = [item.plan, item.steps, item.items]
  const parsedList = candidates
    .map((candidate) => z.array(jsonValueSchema).safeParse(candidate))
    .find((candidate) => candidate.success)
  if (!parsedList?.success) return []
  return parsedList.data.flatMap((entry) => {
    const textEntry = z.string().safeParse(entry)
    if (textEntry.success) {
      return [{ text: textEntry.data, status: "pending" }]
    }
    const record = parseJsonObject(entry)
    if (!record) return []
    const text =
      getString(record, "step") ??
      getString(record, "text") ??
      getString(record, "content") ??
      getString(record, "title")
    if (!text) return []
    return [
      { text, status: normalizePlanStepStatus(getString(record, "status")) },
    ]
  })
}

function wordsFromCamelCase(value: string): string {
  const words = value.replace(/([a-z])([A-Z])/g, "$1 $2")
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function wordsFromIdentifier(value: string): string {
  return wordsFromCamelCase(value.replaceAll(/[-_]+/g, " "))
}

function approvalKind(method: string): "command" | "file-change" | undefined {
  if (method === "item/commandExecution/requestApproval") return "command"
  if (method === "item/fileChange/requestApproval") return "file-change"
  return undefined
}

function codexProvisioning(
  root: SkillRoot,
  status: SkillProvisioningResult["status"],
  message?: string
): SkillProvisioningResult {
  const result: SkillProvisioningResult = {
    rootId: root.id ?? root.path,
    rootPath: root.path,
    status,
    method: "extra-root",
  }
  if (root.contentDigest) result.contentDigest = root.contentDigest
  if (message) result.message = message
  return result
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

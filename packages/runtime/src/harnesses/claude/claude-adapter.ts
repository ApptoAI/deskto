import { homedir } from "node:os"
import { join } from "node:path"

import {
  query,
  type AccountInfo,
  type CanUseTool,
  type Options,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk"
import {
  AsyncQueue,
  harnessFailure,
  type ActivityStart,
  type ActivityUpdate,
  type ApprovalDecision,
  type HarnessAdapterFactory,
  type HarnessEvent,
  type HarnessFailure,
  type HarnessModelOption,
  type HarnessRunInput,
  type HarnessSession,
  type NativeSkillRoot,
  type PlanStep,
  type TextGenerationInput,
  type SkillDiscoveryInput,
  type SkillProvisioningResult,
  type SkillRoot,
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
import { createErrorMessageSchema } from "../../errors.js"

import { claudeSkillCommand, provisionClaudePlugins } from "./claude-packs.js"
import { ClaudeTaskPlan, isTaskPlanTool } from "./claude-task-plan.js"

export type ClaudeQuery = Pick<
  Query,
  "close" | "interrupt" | "supportedModels" | "getContextUsage" | "accountInfo"
> &
  AsyncIterable<SDKMessage>

export type ClaudeQueryFactory = (
  input: Parameters<typeof query>[0]
) => ClaudeQuery

type ClaudeAdapterOptions = {
  executablePath?: string
  /** Folder used only by account and model discovery processes. */
  discoveryCwd?: string
  /** Stable app-owned directory for generated pack plugin shims. */
  packShimsPath?: string
  /** Host-provided skills available to every Claude session. */
  hostSkillRoots?: SkillRoot[]
  queryFactory?: ClaudeQueryFactory
}

const claudeErrorMessageSchema = createErrorMessageSchema(
  "Claude stopped unexpectedly"
)

export const claudeNotSignedInReason =
  "Claude Code is not signed in. Run `claude` in a terminal and sign in, or set ANTHROPIC_API_KEY."

// Local deadlines for discovery spawns. The registry's own timeouts only
// abandon the promise; aborting here is what actually stops the CLI, so a
// hung install cannot leak one process per probe.
const availabilityDeadlineMs = 10_000
const modelListDeadlineMs = 30_000

/**
 * Whether the CLI reports a usable identity. Third-party providers (Bedrock,
 * Vertex, gateways) authenticate outside the CLI, so any non-firstParty
 * provider counts as signed in; first-party needs an OAuth login or an API
 * key, both of which the CLI reports through these fields.
 */
export function claudeAccountSignedIn(account: AccountInfo): boolean {
  if (account.apiProvider && account.apiProvider !== "firstParty") return true
  // Presence means a non-empty value; an empty string is as good as unset.
  return [account.email, account.tokenSource, account.apiKeySource].some(
    (value) => Boolean(value)
  )
}

const claudePlanSchema = z.object({
  todos: z.array(
    z.object({ content: z.string(), status: z.string().optional() })
  ),
})

const readableToolNames = new Map<string, string>([
  ["Bash", "Run command"],
  ["Edit", "Edit file"],
  ["Glob", "Find files"],
  ["Grep", "Search files"],
  ["Read", "Read file"],
  ["WebFetch", "Fetch webpage"],
  ["WebSearch", "Search web"],
  ["Write", "Write file"],
  ["NotebookEdit", "Edit notebook"],
])

type ClaudeAssistantUsage = Extract<
  SDKMessage,
  { type: "assistant" }
>["message"]["usage"]

type PendingApproval = {
  id: string
  request: Extract<HarnessEvent, { type: "approval.requested" }>["request"]
  resolve: (decision: ApprovalDecision) => void
}

export class ClaudeAdapter implements HarnessAdapterFactory {
  readonly descriptor = { id: "claude", name: "Claude Code" }

  constructor(private readonly options: ClaudeAdapterOptions = {}) {}

  async checkAvailability() {
    try {
      const account = await this.#discover(
        availabilityDeadlineMs,
        (discovery) => discovery.accountInfo()
      )
      return claudeAccountSignedIn(account)
        ? { status: "available" as const }
        : { status: "unavailable" as const, reason: claudeNotSignedInReason }
    } catch {
      // A CLI that cannot answer the control request gets the benefit of the
      // doubt: listModels stays the arbiter there, and a false "available" is
      // cheaper than bricking a working install with a false "unavailable".
      return { status: "available" as const }
    }
  }

  listModels(): Promise<HarnessModelOption[]> {
    return this.#discover(modelListDeadlineMs, async (discovery) => {
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
    })
  }

  /** One short-lived query per discovery call, aborted on a local deadline. */
  async #discover<T>(
    deadlineMs: number,
    run: (discovery: ClaudeQuery) => Promise<T>
  ): Promise<T> {
    const abortController = new AbortController()
    const prompt = new AsyncQueue<SDKUserMessage>()
    const options: Options = { abortController }
    if (this.options.discoveryCwd) options.cwd = this.options.discoveryCwd
    if (this.options.executablePath) {
      options.pathToClaudeCodeExecutable = this.options.executablePath
    }
    const discovery = (this.options.queryFactory ?? query)({ prompt, options })
    const deadline = setTimeout(() => abortController.abort(), deadlineMs)
    deadline.unref?.()
    try {
      return await run(discovery)
    } finally {
      clearTimeout(deadline)
      abortController.abort()
      prompt.close()
      discovery.close()
    }
  }

  async discoverSkillRoots(
    input: SkillDiscoveryInput
  ): Promise<NativeSkillRoot[]> {
    const roots: NativeSkillRoot[] = []
    if (input.projectPath) {
      const projectRoots = await projectSkillRootPaths(
        input.projectPath,
        join(".claude", "skills")
      )
      roots.push(
        ...projectRoots.map((path) => ({
          path,
          scope: "project" as const,
          label: "Claude Code project skills",
        }))
      )
    }
    roots.push({
      path: join(homedir(), ".claude", "skills"),
      scope: "user",
      label: "Claude Code personal skills",
    })
    return roots
  }

  start(input: HarnessRunInput, signal: AbortSignal): Promise<HarnessSession> {
    return Promise.resolve(new ClaudeSession(input, signal, this.options))
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

class ClaudeSession implements HarnessSession {
  readonly #queue = new AsyncQueue<HarnessEvent>()
  readonly #approvalQueue: PendingApproval[] = []
  readonly #abortController = new AbortController()
  readonly #backgroundActivities = new Set<string>()
  readonly #ignoredBackgroundTaskIds = new Set<string>()
  readonly #liveBackgroundTaskIds = new Set<string>()
  readonly #settledActivities = new Set<string>()
  readonly #streamedToolActivities = new Set<string>()
  readonly #streamedToolsByIndex = new Map<
    string,
    { id: string; name: string }
  >()
  readonly #taskActivities = new Map<string, string>()
  /** Task-tool calls whose results feed the plan instead of settling a row. */
  readonly #taskPlanCalls = new Set<string>()
  readonly #taskPlan = new ClaudeTaskPlan()
  readonly #query: ClaudeQuery
  readonly events = this.#queue
  readonly skillProvisioning: SkillProvisioningResult[]
  #activeApproval?: PendingApproval
  #closed = false
  #drainingApprovals = false
  #lastUsedTokens = 0
  #lastKnownMaxTokens?: number
  #primaryModel?: string
  #usageLimitResetAt?: string
  #terminalEventEmitted = false
  #successfulResultPending = false
  #backgroundTaskLevelSeen = false
  #backgroundActivityStartedAfterLevel = false
  #planStarted = false

  constructor(
    input: HarnessRunInput,
    signal: AbortSignal,
    {
      executablePath,
      hostSkillRoots = [],
      packShimsPath,
      queryFactory = query,
    }: ClaudeAdapterOptions
  ) {
    if (signal.aborted) this.#abortController.abort()
    signal.addEventListener("abort", () => this.#abortController.abort(), {
      once: true,
    })
    const provisionedPlugins = provisionClaudePlugins(
      [...hostSkillRoots, ...input.customization.skillRoots],
      packShimsPath
    )
    const pluginShims = provisionedPlugins.plugins
    this.skillProvisioning = provisionedPlugins.results
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

        const parsedToolInput = jsonValueSchema.safeParse(toolInput)
        this.#approvalQueue.push({
          id: approvalId,
          resolve: finish,
          request: {
            id: approvalId,
            kind: toolName === "Bash" ? "command" : "tool",
            title: options.title ?? options.displayName ?? `Allow ${toolName}`,
            detail:
              options.description ??
              readableInput(
                parsedToolInput.success ? parsedToolInput.data : null
              ),
          },
        })
        this.#showNextApproval()
        if (options.signal.aborted) finish("deny")
        else
          options.signal.addEventListener("abort", () => finish("deny"), {
            once: true,
          })
      })

    const options: Options = {
      abortController: this.#abortController,
      canUseTool,
      cwd: input.projectPath,
      // The one place the CLI states which task a `TaskCreate` call produced.
      // The call itself carries only a subject and the updates that follow
      // carry only an id, so without this the two never meet.
      hooks: {
        TaskCreated: [
          {
            hooks: [
              (hookInput, toolUseID) => {
                if (
                  hookInput.hook_event_name === "TaskCreated" &&
                  toolUseID &&
                  this.#taskPlan.bind(
                    toolUseID,
                    hookInput.task_id,
                    hookInput.task_subject
                  )
                ) {
                  this.#pushPlan(this.#taskPlan.steps())
                }
                return Promise.resolve({ continue: true })
              },
            ],
          },
        ],
      },
      includePartialMessages: true,
      permissionMode: claudePermissionMode(
        input.executionProfile.permissionMode
      ),
      allowDangerouslySkipPermissions:
        input.executionProfile.permissionMode === "full-access",
      settingSources: ["user", "project", "local"],
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        ...(input.customization.instructions
          ? { append: input.customization.instructions }
          : undefined),
      },
    }
    if (input.executionProfile.modelId)
      options.model = input.executionProfile.modelId
    if (input.executionProfile.effort) {
      options.effort = claudeEffort(input.executionProfile.effort)
    }
    if (pluginShims.length > 0) options.plugins = pluginShims
    const mcpServers = input.customization.mcpServers ?? []
    if (mcpServers.length > 0) {
      options.mcpServers = Object.fromEntries(
        mcpServers.map((server) => {
          if (server.authorization) {
            return [
              server.id,
              {
                type: "http" as const,
                url: server.url,
                headers: {
                  Authorization: `Bearer ${server.authorization.token}`,
                },
              },
            ]
          }
          return [server.id, { type: "http" as const, url: server.url }]
        })
      )
    }
    if (executablePath) options.pathToClaudeCodeExecutable = executablePath
    if (input.providerSessionId) options.resume = input.providerSessionId
    this.#query = queryFactory({ prompt: claudeQueryPrompt(input), options })

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
      // A single-shot Claude query can close after background work settles
      // without producing a second result frame. Release the earlier success
      // even if the last task-level signal is stale: a clean stream end cannot
      // deliver another notification, and every Turn needs a terminal event.
      if (this.#successfulResultPending) {
        this.#emitTerminal({ type: "turn.completed" })
      }
    } catch (error) {
      if (!this.#abortController.signal.aborted) {
        this.#emitTerminal({
          type: "turn.failed",
          failure: harnessFailure(
            claudeErrorMessageSchema.parse(error),
            this.#usageLimitResetAt
          ),
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
          ? isoFromEpoch(message.rate_limit_info.resetsAt)
          : undefined
        const failure: HarnessFailure = {
          kind: "usage-limit",
          message: "Claude Code usage limit reached",
        }
        if (this.#usageLimitResetAt) failure.resetAt = this.#usageLimitResetAt
        this.#emitUsageLimit(failure)
      }
      return
    }

    if (message.type === "system" && message.subtype === "thinking_tokens") {
      this.#queue.push({
        type: "progress.updated",
        progress: { stage: "thinking", label: "Thinking" },
      })
      return
    }

    if (message.type === "tool_progress") {
      this.#queue.push({
        type: "progress.updated",
        progress: {
          stage: "running-tool",
          label: readableToolName(message.tool_name),
        },
      })
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

    if (
      message.type === "system" &&
      message.subtype === "background_tasks_changed"
    ) {
      // The SDK defines this as a replace-semantics liveness signal. Keep its
      // task IDs separate from Activity IDs because edge ordering is not fixed.
      this.#backgroundTaskLevelSeen = true
      this.#backgroundActivityStartedAfterLevel = false
      this.#liveBackgroundTaskIds.clear()
      for (const task of message.tasks) {
        if (!this.#ignoredBackgroundTaskIds.has(task.task_id)) {
          this.#liveBackgroundTaskIds.add(task.task_id)
        }
      }
      const reportedIds = new Set(message.tasks.map((task) => task.task_id))
      for (const taskId of this.#ignoredBackgroundTaskIds) {
        if (!reportedIds.has(taskId)) {
          this.#ignoredBackgroundTaskIds.delete(taskId)
        }
      }
      return
    }

    if (message.type === "system" && message.subtype === "task_started") {
      if (message.skip_transcript) {
        this.#ignoredBackgroundTaskIds.add(message.task_id)
        this.#liveBackgroundTaskIds.delete(message.task_id)
        if (message.tool_use_id) {
          this.#backgroundActivities.delete(message.tool_use_id)
        }
        return
      }
      // Bridge the ordering window before the next level update. A later
      // background_tasks_changed message still replaces this whole set.
      this.#backgroundActivityStartedAfterLevel = true
      this.#liveBackgroundTaskIds.add(message.task_id)
      if (message.tool_use_id) {
        this.#taskActivities.set(message.task_id, message.tool_use_id)
        this.#backgroundActivities.add(message.tool_use_id)
      }
      return
    }

    if (message.type === "system" && message.subtype === "task_notification") {
      this.#ignoredBackgroundTaskIds.delete(message.task_id)
      this.#liveBackgroundTaskIds.delete(message.task_id)
      const activityId =
        message.tool_use_id ?? this.#taskActivities.get(message.task_id)
      this.#taskActivities.delete(message.task_id)
      if (activityId) {
        this.#backgroundActivities.delete(activityId)
        this.#completeActivity(
          activityId,
          message.status === "completed" ? "completed" : "failed"
        )
      }
      return
    }

    if (message.type === "stream_event") {
      const event = message.event
      if (event.type === "content_block_start") {
        const block = event.content_block
        if (block.type === "thinking" && message.parent_tool_use_id === null) {
          this.#queue.push({
            type: "progress.updated",
            progress: { stage: "thinking", label: "Thinking" },
          })
          return
        }
        if (block.type !== "tool_use") return
        this.#streamedToolsByIndex.set(
          streamedToolKey(message.parent_tool_use_id, event.index),
          { id: block.id, name: block.name }
        )
        const isMainPlanTool =
          message.parent_tool_use_id === null && isPlanTool(block.name)
        if (!isMainPlanTool) {
          this.#streamedToolActivities.add(block.id)
          this.#queue.push({
            type: "activity.started",
            activity: claudeActivity(
              block.id,
              block.name,
              null,
              message.parent_tool_use_id ?? undefined
            ),
          })
        }
        this.#queue.push({
          type: "progress.updated",
          progress: {
            stage: "preparing-tool",
            label: preparingToolLabel(block.name),
          },
        })
        return
      }
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        // Sidechain narration belongs to that agent, not the main answer.
        if (message.parent_tool_use_id !== null) return
        this.#queue.push({ type: "message.delta", text: event.delta.text })
      } else if (
        event.type === "content_block_delta" &&
        event.delta.type === "thinking_delta" &&
        message.parent_tool_use_id === null
      ) {
        this.#queue.push({
          type: "progress.updated",
          progress: { stage: "thinking", label: "Thinking" },
        })
      } else if (
        event.type === "content_block_delta" &&
        event.delta.type === "input_json_delta"
      ) {
        const tool = this.#streamedToolsByIndex.get(
          streamedToolKey(message.parent_tool_use_id, event.index)
        )
        this.#queue.push({
          type: "progress.updated",
          progress: {
            stage: "preparing-tool",
            label: tool ? preparingToolLabel(tool.name) : "Preparing tool",
          },
        })
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
        const parsedInput = jsonValueSchema.safeParse(block.input)
        const input = parsedInput.success ? parsedInput.data : null
        const parentId = message.parent_tool_use_id ?? undefined
        // The main thread's task list is the Turn's plan: one activity,
        // updated in place. A subagent's own list stays ordinary tool rows.
        if (!parentId && block.name === "TodoWrite") {
          this.#forgetStreamedTool(block.id)
          this.#pushPlan(planStepsFromTodos(input))
          continue
        }
        if (!parentId && isTaskPlanTool(block.name)) {
          this.#forgetStreamedTool(block.id)
          this.#taskPlanCalls.add(block.id)
          const changed =
            block.name === "TaskCreate"
              ? this.#taskPlan.created(block.id, input)
              : block.name === "TaskUpdate" && this.#taskPlan.updated(input)
          if (changed) this.#pushPlan(this.#taskPlan.steps())
          continue
        }
        if (
          !parentId &&
          isClaudeSubagentTool(block.name) &&
          subagentRunsInBackground(block.name, input)
        ) {
          this.#backgroundActivities.add(block.id)
          this.#backgroundActivityStartedAfterLevel = true
        }
        const activity = claudeActivity(block.id, block.name, input, parentId)
        if (this.#streamedToolActivities.has(block.id)) {
          this.#forgetStreamedTool(block.id)
          this.#queue.push({
            type: "activity.updated",
            update: activityUpdate(activity),
          })
        } else {
          this.#queue.push({ type: "activity.started", activity })
        }
      }
      return
    }

    if (message.type === "user" && Array.isArray(message.message.content)) {
      for (const block of message.message.content) {
        if (block.type !== "tool_result") continue
        // Background tools return an immediate launch result. The matching
        // task_notification reports their actual outcome.
        if (this.#backgroundActivities.has(block.tool_use_id)) continue
        // A plan tool never started an activity, so it has none to settle.
        // Its answer is where a created task first says which id it got.
        if (this.#taskPlanCalls.delete(block.tool_use_id)) {
          const changed = this.#taskPlan.resolveCreated(
            block.tool_use_id,
            toolResultText(block.content)
          )
          if (changed) this.#pushPlan(this.#taskPlan.steps())
          continue
        }
        this.#completeActivity(
          block.tool_use_id,
          block.is_error ? "failed" : "completed"
        )
      }
      return
    }

    if (message.type === "system" && message.subtype === "permission_denied") {
      this.#completeActivity(message.tool_use_id, "failed")
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
      // Claude emits a result at the main response boundary even while
      // background agents keep working. Ending the product Turn here would
      // make the Runtime cancel those agents and paint their cards green.
      // Keep the success pending until the SDK reports no live background work
      // and either a follow-up result arrives or the query closes.
      if (this.#backgroundWorkMayStillBeRunning()) {
        this.#successfulResultPending = true
        return
      }
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
    const usage = { usedTokens, maxTokens: this.#lastKnownMaxTokens }
    this.#queue.push({ type: "usage.updated", usage })
  }

  #forgetStreamedTool(id: string): void {
    this.#streamedToolActivities.delete(id)
    for (const [index, tool] of this.#streamedToolsByIndex) {
      if (tool.id === id) this.#streamedToolsByIndex.delete(index)
    }
  }

  #completeActivity(id: string, outcome: "completed" | "failed"): void {
    if (this.#settledActivities.has(id)) return
    this.#settledActivities.add(id)
    this.#backgroundActivities.delete(id)
    this.#queue.push({ type: "activity.completed", id, outcome })
  }

  /** Prefer the SDK's level signal, with Activity edges for older versions. */
  #backgroundWorkMayStillBeRunning(): boolean {
    return this.#backgroundTaskLevelSeen
      ? this.#liveBackgroundTaskIds.size > 0 ||
          (this.#backgroundActivityStartedAfterLevel &&
            this.#backgroundActivities.size > 0)
      : this.#backgroundActivities.size > 0
  }

  #emitUsageLimit(failure: HarnessFailure): void {
    this.#emitTerminal({ type: "turn.failed", failure })
  }

  /** Emits the plan once, then updates the same activity in place. */
  #pushPlan(steps: PlanStep[]): void {
    if (steps.length === 0 && !this.#planStarted) return
    const payload = { kind: "plan" as const, steps }
    if (this.#planStarted) {
      this.#queue.push({
        type: "activity.updated",
        update: { id: planActivityId, payload },
      })
      return
    }
    this.#planStarted = true
    this.#queue.push({
      type: "activity.started",
      activity: { id: planActivityId, name: "Plan", payload },
    })
  }

  #emitTerminal(
    event: Extract<HarnessEvent, { type: "turn.completed" | "turn.failed" }>
  ): void {
    if (this.#terminalEventEmitted) return
    this.#queue.push(event)
    this.#terminalEventEmitted = true
    this.#successfulResultPending = false
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
    this.#streamedToolActivities.clear()
    this.#streamedToolsByIndex.clear()
    this.#query.close()
    this.#queue.close()
  }
}

/** Claude skills are exposed as plugin slash commands; keep that syntax local. */
export function claudePrompt(input: HarnessRunInput): string {
  let prompt = input.prompt
  for (const reference of input.references) {
    if (reference.kind !== "skill") continue
    prompt = replaceStandaloneToken(
      prompt,
      `$${reference.name}`,
      claudeSkillCommand(reference, input.customization.skillRoots)
    )
  }
  return prompt
}

function claudeQueryPrompt(
  input: HarnessRunInput
): string | AsyncIterable<SDKUserMessage> {
  const text = claudePrompt(input)
  if (!input.attachments?.length) return text

  const content: Exclude<SDKUserMessage["message"]["content"], string> = []
  if (text) content.push({ type: "text", text })
  for (const attachment of input.attachments) {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: attachment.mimeType,
        data: attachment.dataUrl.slice(attachment.dataUrl.indexOf(",") + 1),
      },
    })
  }

  const prompt = new AsyncQueue<SDKUserMessage>()
  const userMessage: SDKUserMessage = {
    type: "user",
    session_id: "",
    parent_tool_use_id: null,
    message: {
      role: "user",
      content,
    },
  }
  prompt.push(userMessage)
  prompt.close()
  return prompt
}

function replaceStandaloneToken(
  text: string,
  token: string,
  replacement: string
): string {
  let result = ""
  let offset = 0
  while (offset < text.length) {
    const index = text.indexOf(token, offset)
    if (index < 0) return result + text.slice(offset)
    const before = index === 0 ? "" : (text[index - 1] ?? "")
    const afterIndex = index + token.length
    const after = afterIndex === text.length ? "" : (text[afterIndex] ?? "")
    if (isTokenBoundary(before) && isTokenBoundary(after)) {
      result += text.slice(offset, index) + replacement
      offset = afterIndex
    } else {
      result += text.slice(offset, index + 1)
      offset = index + 1
    }
  }
  return result
}

function isTokenBoundary(character: string): boolean {
  return !character || !/[\p{L}\p{N}_./\\@$-]/u.test(character)
}

const planActivityId = "claude-plan"

function isPlanTool(toolName: string): boolean {
  return toolName === "TodoWrite" || isTaskPlanTool(toolName)
}

function streamedToolKey(parentId: string | null, index: number): string {
  return JSON.stringify([parentId, index])
}

function preparingToolLabel(toolName: string): string {
  if (fileChangeTools.has(toolName)) return "Preparing file change"
  if (toolName === "Bash") return "Preparing command"
  if (toolName === "WebFetch" || toolName === "WebSearch")
    return "Preparing web request"
  return `Preparing ${readableToolName(toolName).toLowerCase()}`
}

function activityUpdate(activity: ActivityStart): ActivityUpdate {
  const update: ActivityUpdate = { id: activity.id, name: activity.name }
  if (activity.detail) update.detail = activity.detail
  if (activity.payload) update.payload = activity.payload
  return update
}

/** Classifies one Claude tool call into the provider-neutral activity shape. */
export function claudeActivity(
  id: string,
  toolName: string,
  input: JsonValue,
  parentId: string | undefined
): ActivityStart {
  const base: Pick<ActivityStart, "id" | "parentId"> = { id }
  if (parentId) base.parentId = parentId
  const detail = readableInput(input)

  if (isClaudeSubagentTool(toolName)) {
    const record = parseClaudeInput(input)
    const parsedDescription = z.string().safeParse(record?.description)
    const parsedAgentType = z.string().safeParse(record?.subagent_type)
    const description = parsedDescription.success
      ? parsedDescription.data
      : undefined
    const agentType = parsedAgentType.success ? parsedAgentType.data : undefined
    const activity: ActivityStart = {
      ...base,
      name: description ?? "Subagent",
      payload: { kind: "subagent" },
    }
    if (agentType) {
      activity.detail = agentType
      activity.payload = { kind: "subagent", agentType }
    }
    return activity
  }

  if (fileChangeTools.has(toolName)) {
    const record = parseClaudeInput(input)
    const filePath = [record?.file_path, record?.notebook_path].flatMap(
      (value) => {
        const parsed = z.string().safeParse(value)
        return parsed.success ? [parsed.data] : []
      }
    )[0]
    const activity: ActivityStart = {
      ...base,
      name: readableToolName(toolName),
    }
    if (filePath) {
      activity.detail = filePath
      activity.payload = {
        kind: "file-change",
        files: [{ path: filePath }],
      }
    }
    return activity
  }

  const mcp = mcpToolParts(toolName)
  if (mcp) {
    return {
      ...base,
      name: mcp.tool,
      detail: mcp.server,
      payload: { kind: "tool", tool: "mcp" },
    }
  }

  const activity: ActivityStart = {
    ...base,
    name: readableToolName(toolName),
    payload: { kind: "tool", tool: toolCategory(toolName) },
  }
  if (detail) activity.detail = detail
  return activity
}

function isClaudeSubagentTool(toolName: string): boolean {
  return toolName === "Agent" || toolName === "Task"
}

function subagentRunsInBackground(toolName: string, input: JsonValue): boolean {
  const record = parseClaudeInput(input)
  const parsed = z.boolean().safeParse(record?.run_in_background)
  if (!parsed.success) return toolName === "Agent"
  if (toolName === "Agent") return parsed.data
  return parsed.data
}

function toolCategory(
  toolName: string
): "command" | "search" | "web" | "other" {
  if (toolName === "Bash") return "command"
  if (toolName === "Glob" || toolName === "Grep") return "search"
  if (toolName === "WebFetch" || toolName === "WebSearch") return "web"
  return "other"
}

const fileChangeTools = new Set(["Edit", "Write", "NotebookEdit"])

/** Splits an MCP tool id like `mcp__linear__create_issue`. */
function mcpToolParts(
  toolName: string
): { server: string; tool: string } | undefined {
  if (!toolName.startsWith("mcp__")) return undefined
  const rest = toolName.slice("mcp__".length)
  const separator = rest.indexOf("__")
  if (separator <= 0) return undefined
  return {
    server: rest.slice(0, separator),
    tool: rest.slice(separator + 2).replaceAll("_", " ") || toolName,
  }
}

type ToolResultContent = string | { type: string; text?: string }[]

/**
 * The text a tool answered with. A structured tool returns its JSON inside
 * text blocks, so the blocks are joined before anyone tries to parse it.
 */
function toolResultText(
  content: ToolResultContent | undefined
): string | undefined {
  if (content === undefined) return undefined
  if (!Array.isArray(content)) return content
  const text = content
    .flatMap((block) =>
      block.type === "text" && block.text ? [block.text] : []
    )
    .join("")
  return text || undefined
}

export function planStepsFromTodos(input: JsonValue): PlanStep[] {
  const parsed = claudePlanSchema.safeParse(input)
  if (!parsed.success) return []
  return parsed.data.todos.map((todo) => ({
    text: todo.content,
    status: normalizePlanStepStatus(todo.status),
  }))
}

function readableInput(input: JsonValue): string | undefined {
  const record = parseClaudeInput(input)
  if (!record) return undefined
  for (const key of ["command", "file_path", "query", "pattern", "url"]) {
    const parsed = z.string().safeParse(record[key])
    if (parsed.success) return parsed.data
  }
  return undefined
}

function readableToolName(name: string): string {
  return readableToolNames.get(name) ?? name
}

function claudePermissionMode(
  mode: HarnessRunInput["executionProfile"]["permissionMode"]
): "default" | "auto" | "bypassPermissions" {
  if (mode === "auto") return "auto"
  if (mode === "full-access") return "bypassPermissions"
  return "default"
}

/** Tokens occupying the context after a model call: the full prompt (cached or not) plus the reply. */
function contextTokens(usage: ClaudeAssistantUsage): number {
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

function parseClaudeInput(input: JsonValue): JsonObject | undefined {
  const parsed = jsonObjectSchema.safeParse(input)
  return parsed.success ? parsed.data : undefined
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
  const failure: HarnessFailure = {
    kind: "usage-limit",
    message: text || "Claude Code usage limit reached",
  }
  if (resetAt) failure.resetAt = resetAt
  return failure
}

function claudeEffort(value: string): Options["effort"] {
  switch (value) {
    case "low":
    case "medium":
    case "high":
    case "xhigh":
    case "max":
      return value
    default:
      return undefined
  }
}

import { randomUUID } from "node:crypto"

import {
  harnessFailure,
  type ActivityStart,
  type ActivityUpdate,
  type ApprovalDecision,
  type ContextUsage,
  type HarnessEvent,
  type HarnessFailure,
  type HarnessRunInput,
  type HarnessSession,
} from "@deskto/harness-sdk"
import {
  turnProgressLabelMaxLength,
  type Activity,
  type ActivityPayload,
  type ThreadDeltaChange,
  type ThreadView,
  type TurnInput,
  type TurnProgress,
} from "@deskto/protocol"

import { appendBrowserPromptContext } from "./browser/browser-prompt-context.js"
import { RuntimeError, runtimeErrorMessageSchema } from "./errors.js"
import { isThreadRowActive } from "./storage/records.js"
import type { HarnessRegistry } from "./harness-registry.js"
import { existingSkillRoots } from "./packs/pack-files.js"
import { ProjectOutputSweep } from "./project-outputs.js"
import type { ProjectActivityGate } from "./project-activity-gate.js"
import { resolvePromptReferences } from "./prompt-references.js"
import { SkillInventory } from "./skills/skill-inventory.js"
import { SessionToolLeases, type SessionToolProvider } from "./session-tools.js"
import type {
  ActivityStartInput,
  ActivityUpdateInput,
} from "./storage/activities.js"
import type { PreparedArtifactCapture } from "./storage/artifacts.js"
import type { Store } from "./storage/store.js"
import type { ActiveTurnRecord } from "./storage/turns.js"
import { ThreadTitleGenerator } from "./thread-title-generator.js"
import type { UserSettings } from "./user-settings.js"

export type TurnEvents = {
  /** Coarse invalidation: lifecycle transitions worth a full view reload. */
  changed: (threadId: string) => void
  /** Fine-grained change an open view applies without a reload. */
  delta: (threadId: string, change: ThreadDeltaChange) => void
  /** A completed file change produced one or more project results. */
  artifactsChanged: (threadId: string) => void
}

type StartingRun = ActiveTurnRecord & {
  threadId: string
  phase: "starting"
  controller: AbortController
  cancelled: boolean
  progress: TurnProgress
  tools?: SessionToolLeases
  releaseProject: () => void
}

type ActiveRun = ActiveTurnRecord & {
  threadId: string
  phase: "active"
  session: HarnessSession
  cancelled: boolean
  terminal: boolean
  progress: TurnProgress
  pendingText: string
  approvalIds: Map<string, string>
  activityIds: Map<string, string>
  /** Streaming assistant message currently receiving text, if one is open. */
  segmentMessageId?: string
  /** Most recently created assistant message; terminal states land on it. */
  lastMessageId: string
  /** Next shared position for messages and activities within this Turn. */
  ordinal: number
  flushTimer?: ReturnType<typeof setTimeout>
  lastUsage?: ContextUsage
  outputs?: ProjectOutputSweep
  tools: SessionToolLeases
  releaseProject: () => void
}

const streamFlushIntervalMs = 50
const progressHeartbeatIntervalMs = 1_000
type ProgressState = Pick<TurnProgress, "stage" | "label">

function turnProgress(
  stage: TurnProgress["stage"],
  label: string,
  now = Date.now()
): TurnProgress {
  return {
    stage,
    label: boundedProgressLabel(stage, label),
    updatedAt: new Date(now).toISOString(),
  }
}

function progressLabel(stage: TurnProgress["stage"]): string {
  if (stage === "starting") return "Starting agent"
  if (stage === "responding") return "Writing response"
  if (stage === "preparing-tool") return "Preparing tool"
  if (stage === "running-tool") return "Running tool"
  if (stage === "waiting-approval") return "Waiting for approval"
  return "Thinking"
}

function boundedProgressLabel(
  stage: TurnProgress["stage"],
  label: string
): string {
  const normalized = label.trim() || progressLabel(stage)
  let bounded = ""
  for (const character of normalized) {
    if (bounded.length + character.length > turnProgressLabelMaxLength) break
    bounded += character
  }
  return bounded
}

function activityProgress(
  activity: Pick<ActivityStart, "name" | "payload">
): ProgressState {
  if (activity.payload?.kind === "plan") {
    return { stage: "thinking", label: "Updating plan" }
  }
  return { stage: "running-tool", label: activity.name }
}

function progressAfterActivity(activities: Activity[]): ProgressState {
  let latest: Activity | undefined
  for (const activity of activities) {
    if (activity.payload?.kind === "plan") continue
    if ((activity.ordinal ?? -1) > (latest?.ordinal ?? -1)) latest = activity
  }
  return latest
    ? activityProgress(latest)
    : { stage: "thinking", label: "Thinking" }
}

/** A command, an MCP call, a subagent, or an unknown tool can write without saying so. */
function reportsItsFileEffects(payload: ActivityPayload | undefined): boolean {
  if (!payload) return false
  if (payload.kind === "file-change" || payload.kind === "plan") return true
  return (
    payload.kind === "tool" &&
    (payload.tool === "search" || payload.tool === "web")
  )
}

export class TurnCoordinator {
  readonly #runs = new Map<string, StartingRun | ActiveRun>()
  readonly #discarding = new Set<string>()
  readonly #titles: ThreadTitleGenerator

  readonly #skills: SkillInventory

  constructor(
    private readonly store: Store,
    private readonly harnesses: HarnessRegistry,
    settings: UserSettings,
    private readonly sessionTools: readonly SessionToolProvider[],
    private readonly projectActivity: ProjectActivityGate,
    private readonly events: TurnEvents
  ) {
    this.#skills = new SkillInventory(store, harnesses)
    this.#titles = new ThreadTitleGenerator(
      store,
      harnesses,
      settings,
      (threadId) => this.#changed(threadId)
    )
  }

  /**
   * Announces a lifecycle transition, unless the Thread is being discarded:
   * telling clients to reload a Thread that is about to be deleted only sends
   * them to `thread.get` for a row that will not be there.
   */
  #changed(threadId: string): void {
    if (this.#discarding.has(threadId)) return
    this.events.changed(threadId)
  }

  /**
   * Re-checked at fork time, not just when the side chat was created: between
   * the two the parent may have begun responding, and forking then would base
   * the side chat on a half-written turn. The check and the adapter spawn are
   * still two steps; ADR 0026 records the remaining window as accepted.
   */
  #requireParentQuiet(threadId: string): void {
    const parentId = this.store.threads.parentId(threadId)
    if (!parentId) return
    const parent = this.store.threads.getRow(parentId)
    if (isThreadRowActive(parent.status)) {
      throw new RuntimeError(
        "fork-parent-active",
        "Wait for the main task's response before sending here"
      )
    }
  }

  #settleRun(threadId: string, run: StartingRun | ActiveRun): void {
    if (this.#runs.get(threadId) !== run) return
    this.#runs.delete(threadId)
    run.releaseProject()
  }

  /** Adds process-local liveness to the durable Thread projection. */
  view(threadId: string): ThreadView {
    const view = this.store.threads.view(threadId)
    const run = this.#runs.get(threadId)
    if (
      run &&
      (run.phase === "starting" || (run.phase === "active" && !run.terminal))
    ) {
      view.progress = run.progress
    }
    return view
  }

  async start(threadId: string, input: TurnInput): Promise<ThreadView> {
    if (this.#runs.has(threadId)) {
      throw new RuntimeError(
        "turn-active",
        "This task already has an active turn"
      )
    }

    const thread = this.store.threads.getRow(threadId)
    const releaseProject = this.projectActivity.beginTurn(thread.project_id)
    const prepare = () =>
      Promise.all([
        this.harnesses.requireAvailable(thread.harness_id),
        resolvePromptReferences(
          this.store,
          this.#skills,
          threadId,
          input.references
        ),
      ] as const)
    let preparation: Awaited<ReturnType<typeof prepare>>
    try {
      preparation = await prepare()
    } catch (error) {
      releaseProject()
      throw error
    }
    const [harness, references] = preparation
    let turn: ActiveTurnRecord
    try {
      turn = this.store.turns.begin(threadId, input)
    } catch (error) {
      releaseProject()
      throw error
    }
    const starting: StartingRun = {
      ...turn,
      threadId,
      phase: "starting",
      controller: new AbortController(),
      cancelled: false,
      progress: turnProgress("starting", "Starting agent"),
      releaseProject,
    }
    this.#runs.set(threadId, starting)
    this.#changed(threadId)

    try {
      if (turn.forkProviderSession) this.#requireParentQuiet(threadId)
      const tools = await SessionToolLeases.open(
        this.sessionTools,
        {
          harnessId: turn.harnessId,
          threadId,
          turnId: turn.turnId,
          projectId: thread.project_id,
          workspaceId: turn.workspaceId,
          projectPath: turn.projectPath,
        },
        starting.controller.signal
      )
      starting.tools = tools
      const runInput: HarnessRunInput = {
        threadId,
        turnId: turn.turnId,
        projectPath: turn.projectPath,
        prompt: appendBrowserPromptContext(
          input.text,
          input.browserContexts ?? []
        ),
        references,
        attachments: input.attachments.map(
          ({ type, name, mimeType, dataUrl }) => ({
            type,
            name,
            mimeType,
            dataUrl,
          })
        ),
        executionProfile: turn.executionProfile,
        customization: {
          skillRoots: existingSkillRoots(
            this.store.packs.attachedToWorkspace(turn.workspaceId)
          ),
          instructions: this.store.projects.instructions(thread.project_id),
          mcpServers: tools.mcpServers,
        },
      }
      if (turn.providerSessionId) {
        runInput.providerSessionId = turn.providerSessionId
      }
      if (turn.forkProviderSession) runInput.forkProviderSession = true
      // Before the Harness starts, so the files it writes are new to it.
      const outputs = await ProjectOutputSweep.begin(
        turn.projectPath,
        (paths) => this.#captureSweptOutputs(threadId, turn.turnId, paths)
      )
      const session = await harness.start(runInput, starting.controller.signal)
      try {
        this.store.skillProvisioning.record(
          turn.turnId,
          turn.harnessId,
          session.skillProvisioning ?? []
        )
      } catch {
        // Provisioning reports are diagnostics. A storage failure must not
        // abandon a Harness session that already started successfully.
      }
      if (starting.cancelled || this.#runs.get(threadId) !== starting) {
        outputs?.close()
        await session.cancel().catch(() => undefined)
        await tools.close()
        return this.view(threadId)
      }
      const run: ActiveRun = {
        ...turn,
        threadId,
        phase: "active",
        session,
        cancelled: false,
        terminal: false,
        progress: turnProgress("thinking", "Thinking"),
        pendingText: "",
        approvalIds: new Map(),
        activityIds: new Map(),
        segmentMessageId: turn.assistantMessageId,
        lastMessageId: turn.assistantMessageId,
        // The user message holds 0 and the first assistant segment holds 1.
        ordinal: 2,
        outputs,
        tools,
        releaseProject,
      }
      this.#runs.set(threadId, run)
      this.events.delta(threadId, {
        type: "progress.updated",
        progress: run.progress,
      })
      if (turn.generateTitle) {
        this.#titles.start({
          threadId,
          projectPath: turn.projectPath,
          prompt:
            input.text ||
            `Attached ${input.attachments.map((attachment) => attachment.name).join(", ")}`,
          harnessId: turn.harnessId,
          executionProfile: turn.executionProfile,
        })
      }
      void this.#consume(threadId, run)
    } catch (error) {
      await starting.tools?.close()
      if (!starting.cancelled) {
        this.store.turns.fail(
          threadId,
          turn.turnId,
          turn.assistantMessageId,
          harnessFailure(runtimeErrorMessageSchema.parse(error))
        )
        this.#changed(threadId)
      }
      this.#settleRun(threadId, starting)
    }

    return this.view(threadId)
  }

  async cancel(threadId: string): Promise<ThreadView> {
    const run = this.#runs.get(threadId)
    if (!run)
      throw new RuntimeError("turn-not-active", "This task has no active turn")

    if (run.phase === "starting") {
      run.cancelled = true
      run.controller.abort()
      this.store.turns.cancel(threadId, run.turnId, run.assistantMessageId)
      this.#settleRun(threadId, run)
      await run.tools?.close()
      this.#changed(threadId)
      return this.view(threadId)
    }

    run.cancelled = true
    this.#flush(run)
    this.#requestSweepForUnreportedWork(run)
    await run.tools.close()
    try {
      await run.session.cancel()
    } catch (error) {
      run.terminal = true
      const message = `Could not stop the harness: ${runtimeErrorMessageSchema.parse(error)}`
      this.store.activities.settleRunning(run.turnId, "failed")
      this.store.turns.fail(
        threadId,
        run.turnId,
        this.#terminalMessageId(run),
        harnessFailure(message)
      )
      this.#changed(threadId)
      await run.outputs?.finish()
      this.#settleRun(threadId, run)
      throw new RuntimeError("cancel-failed", message)
    }
    if (!run.terminal) {
      run.terminal = true
      this.store.activities.settleRunning(run.turnId, "failed")
      this.store.turns.cancel(
        threadId,
        run.turnId,
        this.#terminalMessageId(run)
      )
      this.#changed(threadId)
    }
    await run.outputs?.finish()
    this.#settleRun(threadId, run)
    return this.view(threadId)
  }

  /**
   * Stops every provider call a Thread has in flight, because the Thread is
   * about to be deleted. Unlike `cancel`, an idle thread is fine and a harness
   * that refuses to stop does not fail the caller: the rows it would write to
   * are going away either way.
   */
  async discard(threadId: string): Promise<void> {
    this.#titles.cancel(threadId)
    const run = this.#runs.get(threadId)
    if (!run) return
    // Sweeping would write rows on their way out with the Thread.
    if (run.phase === "active") run.outputs?.close()
    this.#discarding.add(threadId)
    try {
      await this.cancel(threadId).catch(() => undefined)
    } finally {
      this.#discarding.delete(threadId)
      this.#settleRun(threadId, run)
    }
  }

  async resolveApproval(
    threadId: string,
    approvalId: string,
    decision: ApprovalDecision
  ): Promise<ThreadView> {
    const run = this.#runs.get(threadId)
    if (!run || run.phase === "starting")
      throw new RuntimeError("turn-not-active", "This task has no active turn")

    this.store.turns.assertPendingApproval(threadId, approvalId)
    const providerApprovalId = run.approvalIds.get(approvalId)
    if (!providerApprovalId) {
      throw new RuntimeError(
        "approval-not-found",
        "Pending approval is no longer active"
      )
    }
    this.store.turns.resolveApproval(threadId, approvalId, decision)
    run.approvalIds.delete(approvalId)
    this.events.delta(threadId, { type: "approval.resolved", approvalId })
    this.events.delta(threadId, {
      type: "thread.updated",
      thread: this.store.threads.get(threadId),
    })
    this.#updateProgress(threadId, run, {
      stage: "thinking",
      label: "Resuming agent",
    })
    try {
      await run.session.respondToApproval(providerApprovalId, decision)
    } catch (error) {
      if (run.cancelled || this.#runs.get(threadId) !== run) {
        throw new RuntimeError(
          "turn-not-active",
          "This task has no active turn"
        )
      }
      const message = `Could not answer the harness: ${runtimeErrorMessageSchema.parse(error)}`
      this.#fail(threadId, run, harnessFailure(message))
      await run.tools.close()
      await run.session.cancel().catch(() => undefined)
      throw new RuntimeError("approval-failed", message)
    }
    return this.view(threadId)
  }

  async dispose(): Promise<void> {
    await this.#titles.dispose()
    const runs = [...this.#runs.entries()]
    for (const [threadId, run] of runs) {
      run.cancelled = true
      if (run.phase === "starting") {
        run.controller.abort()
        this.store.turns.cancel(threadId, run.turnId, run.assistantMessageId)
        await run.tools?.close()
        this.#settleRun(threadId, run)
        continue
      }
      this.#flush(run)
      run.outputs?.close()
      await run.tools.close()
      await run.session.cancel().catch(() => undefined)
      if (!run.terminal) {
        run.terminal = true
        this.store.activities.settleRunning(run.turnId, "failed")
        this.store.turns.cancel(
          threadId,
          run.turnId,
          this.#terminalMessageId(run)
        )
      }
      this.#settleRun(threadId, run)
    }
    this.#runs.clear()
  }

  async #consume(threadId: string, run: ActiveRun): Promise<void> {
    try {
      for await (const event of run.session.events) {
        if (run.cancelled || run.terminal) break
        this.#applyEvent(threadId, run, event)
        if (run.terminal) break
      }
      if (!run.cancelled && !run.terminal) {
        this.#fail(
          threadId,
          run,
          harnessFailure("Harness ended without completing the turn")
        )
      }
      // A terminal event can arrive while the provider still streams (a
      // usage-limit frame, for example). Stop the session so no orphaned
      // process keeps working on a turn the app already settled.
      if (run.terminal && !run.cancelled) {
        await run.tools.close()
        await run.session.cancel().catch(() => undefined)
      }
    } catch (error) {
      if (!run.cancelled && !run.terminal) {
        this.#fail(
          threadId,
          run,
          harnessFailure(runtimeErrorMessageSchema.parse(error))
        )
        await run.tools.close()
        await run.session.cancel().catch(() => undefined)
      }
    } finally {
      // The provider is stopped before the final walk. Keeping the run in the
      // map until capture finishes also prevents the next Turn from writing
      // files that this one could claim.
      await run.tools.close()
      if (!run.cancelled) await run.outputs?.finish()
      if (!run.cancelled) this.#settleRun(threadId, run)
    }
  }

  #applyEvent(threadId: string, run: ActiveRun, event: HarnessEvent): void {
    switch (event.type) {
      case "session.started":
        this.store.turns.setProviderSession(
          threadId,
          run.turnId,
          event.providerSessionId
        )
        this.#updateProgress(threadId, run, {
          stage: "thinking",
          label: "Thinking",
        })
        break
      case "progress.updated":
        this.#updateProgress(threadId, run, {
          stage: event.progress.stage,
          label: event.progress.label ?? progressLabel(event.progress.stage),
        })
        break
      case "message.delta":
        this.#updateProgress(threadId, run, {
          stage: "responding",
          label: "Writing response",
        })
        this.#appendDelta(run, event.text)
        break
      case "usage.updated": {
        this.#updateProgress(threadId, run, run.progress)
        const usage =
          event.usage.maxTokens === undefined &&
          run.lastUsage?.maxTokens !== undefined
            ? { ...event.usage, maxTokens: run.lastUsage.maxTokens }
            : event.usage
        // Providers repeat usage reports; only a changed value is worth a
        // write and a renderer update.
        if (
          run.lastUsage?.usedTokens === usage.usedTokens &&
          run.lastUsage.maxTokens === usage.maxTokens
        )
          break
        run.lastUsage = usage
        this.store.threads.setContextUsage(threadId, usage)
        this.events.delta(threadId, {
          type: "thread.updated",
          thread: this.store.threads.get(threadId),
        })
        break
      }
      case "approval.requested":
        this.#updateProgress(threadId, run, {
          stage: "waiting-approval",
          label: "Waiting for approval",
        })
        this.#flush(run)
        this.#requestApproval(threadId, run, event.request)
        this.#changed(threadId)
        break
      case "turn.completed": {
        this.#flush(run)
        run.terminal = true
        const leftover = this.store.activities.running(run.turnId)
        const captures = this.#prepareArtifactCaptures(run.turnId, leftover)
        // Work the Harness never reported finishing still ran.
        this.#requestSweepForUnreportedWork(run, leftover)
        // A finished turn settles leftover rows as completed; a red failure
        // mark on a good turn would blame work that simply never reported.
        const artifactsChanged = this.store.transaction(() => {
          this.store.activities.settleRunning(run.turnId, "completed")
          const changed = this.#captureArtifacts(captures)
          this.store.turns.complete(
            threadId,
            run.turnId,
            this.#terminalMessageId(run)
          )
          return changed
        })
        if (artifactsChanged) this.events.artifactsChanged(threadId)
        this.#changed(threadId)
        break
      }
      case "turn.failed":
        this.#fail(threadId, run, event.failure)
        break
      case "activity.started":
        this.#startActivity(threadId, run, event.activity)
        this.#updateProgress(threadId, run, activityProgress(event.activity))
        break
      case "activity.updated": {
        const activity = this.#updateActivity(threadId, run, event.update)
        if (activity) {
          this.#updateProgress(threadId, run, activityProgress(activity))
        }
        break
      }
      case "activity.completed":
        this.#completeActivity(threadId, run, event.id, event.outcome)
        this.#updateProgress(
          threadId,
          run,
          progressAfterActivity(this.store.activities.running(run.turnId))
        )
        break
    }
  }

  #fail(threadId: string, run: ActiveRun, failure: HarnessFailure): void {
    this.#flush(run)
    run.terminal = true
    this.#requestSweepForUnreportedWork(run)
    this.store.activities.settleRunning(run.turnId, "failed")
    this.store.turns.fail(
      threadId,
      run.turnId,
      this.#terminalMessageId(run),
      failure
    )
    this.#changed(threadId)
  }

  #appendDelta(run: ActiveRun, text: string): void {
    run.pendingText += text
    if (run.flushTimer) return
    run.flushTimer = setTimeout(() => this.#flush(run), streamFlushIntervalMs)
  }

  #updateProgress(
    threadId: string,
    run: ActiveRun,
    progress: ProgressState
  ): void {
    const now = Date.now()
    const previousAt = Date.parse(run.progress.updatedAt)
    const label = boundedProgressLabel(progress.stage, progress.label)
    if (
      run.progress.stage === progress.stage &&
      run.progress.label === label &&
      !Number.isNaN(previousAt) &&
      now - previousAt < progressHeartbeatIntervalMs
    ) {
      return
    }
    run.progress = turnProgress(progress.stage, label, now)
    this.events.delta(threadId, {
      type: "progress.updated",
      progress: run.progress,
    })
  }

  #requestApproval(
    threadId: string,
    run: ActiveRun,
    request: Extract<HarnessEvent, { type: "approval.requested" }>["request"]
  ): void {
    const approvalId = randomUUID()
    run.approvalIds.set(approvalId, request.id)
    const approval = this.store.turns.requestApproval(threadId, run.turnId, {
      ...request,
      id: approvalId,
    })
    this.events.delta(threadId, { type: "approval.requested", approval })
    this.events.delta(threadId, {
      type: "thread.updated",
      thread: this.store.threads.get(threadId),
    })
  }

  #startActivity(
    threadId: string,
    run: ActiveRun,
    activity: ActivityStart
  ): void {
    if (run.activityIds.has(activity.id)) return
    // A top-level tool row after prose settles the current segment, so the
    // next prose lands below the row instead of merging into one block.
    // Subagent-internal work must not chop the main narration.
    const parentId = activity.parentId
      ? run.activityIds.get(activity.parentId)
      : undefined
    if (!parentId) this.#closeSegment(threadId, run)
    const startInput: ActivityStartInput = { name: activity.name }
    if (activity.detail) startInput.detail = activity.detail
    if (activity.payload) startInput.payload = activity.payload
    if (parentId) startInput.parentId = parentId
    const record = this.store.activities.start(
      threadId,
      run.turnId,
      run.ordinal++,
      startInput
    )
    run.activityIds.set(activity.id, record.id)
    this.events.delta(threadId, { type: "activity.upserted", activity: record })
  }

  #updateActivity(
    threadId: string,
    run: ActiveRun,
    update: ActivityUpdate
  ): Activity | undefined {
    const id = run.activityIds.get(update.id)
    if (!id) return undefined
    const patch: ActivityUpdateInput = {}
    if (update.name !== undefined) patch.name = update.name
    if (update.detail !== undefined) patch.detail = update.detail
    if (update.payload !== undefined) patch.payload = update.payload
    const record = this.store.activities.update(id, patch)
    if (record)
      this.events.delta(threadId, {
        type: "activity.upserted",
        activity: record,
      })
    return record
  }

  #completeActivity(
    threadId: string,
    run: ActiveRun,
    providerId: string,
    outcome: "completed" | "failed"
  ): void {
    const id = run.activityIds.get(providerId)
    if (!id) return
    const pending = this.store.activities.find(id)
    const captures =
      pending?.status === "running" && outcome === "completed"
        ? this.#prepareArtifactCaptures(run.turnId, [pending])
        : []
    // The provider id stays mapped so later children can still name their
    // parent, and the status guard makes repeated completions harmless.
    const { record, artifactsChanged } = this.store.transaction(() => {
      const record = this.store.activities.complete(id, outcome)
      return {
        record,
        artifactsChanged:
          record && outcome === "completed"
            ? this.#captureArtifacts(captures)
            : false,
      }
    })
    if (record) {
      this.events.delta(threadId, {
        type: "activity.upserted",
        activity: record,
      })
      if (artifactsChanged) this.events.artifactsChanged(threadId)
    }
    // A failed command counts: it can fail after its file already landed.
    if (pending && !reportsItsFileEffects(pending.payload)) {
      run.outputs?.request()
    }
  }

  /** Swept files have no Activity to attribute them to, so the Turn owns them. */
  #captureSweptOutputs(
    threadId: string,
    turnId: string,
    paths: string[]
  ): void {
    try {
      const capture = this.store.artifacts.prepareCapture(turnId, paths)
      if (!capture || capture.files.length === 0) return
      if (this.#captureArtifacts([capture])) {
        this.events.artifactsChanged(threadId)
      }
    } catch {
      // A sweep lands late: storage may be closed or the Thread already gone.
    }
  }

  /** A still-running generic Activity may already have written its result. */
  #requestSweepForUnreportedWork(
    run: ActiveRun,
    activities = this.store.activities.running(run.turnId)
  ): void {
    if (
      activities.some((activity) => !reportsItsFileEffects(activity.payload))
    ) {
      run.outputs?.request()
    }
  }

  #prepareArtifactCaptures(
    turnId: string,
    activities: Activity[]
  ): PreparedArtifactCapture[] {
    const captures: PreparedArtifactCapture[] = []
    for (const activity of activities) {
      if (activity.payload?.kind !== "file-change") continue
      const paths = activity.payload.files.map((file) => file.path)
      const capture = this.store.artifacts.prepareCapture(turnId, paths)
      if (capture) captures.push(capture)
    }
    return captures
  }

  #captureArtifacts(captures: PreparedArtifactCapture[]): boolean {
    let changed = false
    for (const capture of captures) {
      if (this.store.artifacts.capture(capture).length > 0) changed = true
    }
    return changed
  }

  // Closes the open segment even when it is still empty: leaving it open
  // would collect prose written after this tool row under an earlier ordinal,
  // rendering the narration above the work it describes. An empty settled
  // segment is skipped by the renderer.
  #closeSegment(threadId: string, run: ActiveRun): void {
    this.#flush(run)
    if (!run.segmentMessageId) return
    const closed = this.store.turns.closeSegment(run.segmentMessageId)
    run.segmentMessageId = undefined
    if (closed)
      this.events.delta(threadId, {
        type: "message.upserted",
        message: closed,
      })
  }

  #terminalMessageId(run: ActiveRun): string {
    return run.segmentMessageId ?? run.lastMessageId
  }

  #flush(run: ActiveRun): void {
    if (run.flushTimer) clearTimeout(run.flushTimer)
    run.flushTimer = undefined
    if (!run.pendingText) return

    if (!run.segmentMessageId) {
      const segment = this.store.turns.addSegment(
        run.threadId,
        run.turnId,
        run.ordinal++
      )
      run.segmentMessageId = segment.id
      run.lastMessageId = segment.id
      this.events.delta(run.threadId, {
        type: "message.upserted",
        message: segment,
      })
    }
    this.store.turns.appendDelta(run.segmentMessageId, run.pendingText)
    this.events.delta(run.threadId, {
      type: "message.appended",
      messageId: run.segmentMessageId,
      text: run.pendingText,
    })
    run.pendingText = ""
  }
}

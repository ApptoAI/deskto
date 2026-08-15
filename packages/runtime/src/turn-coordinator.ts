import { randomUUID } from "node:crypto"

import {
  harnessFailure,
  type ActivityStart,
  type ActivityUpdate,
  type ApprovalDecision,
  type ContextUsage,
  type HarnessEvent,
  type HarnessFailure,
  type HarnessSession,
} from "@openappto/harness-sdk"
import type {
  ThreadDeltaChange,
  ThreadView,
  TurnInput,
} from "@openappto/protocol"

import { RuntimeError, errorMessage } from "./errors.js"
import type { HarnessRegistry } from "./harness-registry.js"
import { existingSkillRoots } from "./packs/pack-files.js"
import { resolvePromptReferences } from "./prompt-references.js"
import type { Store } from "./storage/store.js"
import type { ActiveTurnRecord } from "./storage/turns.js"
import { ThreadTitleGenerator } from "./thread-title-generator.js"
import type { UserSettings } from "./user-settings.js"

export type TurnEvents = {
  /** Coarse invalidation: lifecycle transitions worth a full view reload. */
  changed: (threadId: string) => void
  /** Fine-grained change an open view applies without a reload. */
  delta: (threadId: string, change: ThreadDeltaChange) => void
}

type StartingRun = ActiveTurnRecord & {
  threadId: string
  phase: "starting"
  controller: AbortController
  cancelled: boolean
}

type ActiveRun = ActiveTurnRecord & {
  threadId: string
  phase: "active"
  session: HarnessSession
  cancelled: boolean
  terminal: boolean
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
}

const streamFlushIntervalMs = 50

export class TurnCoordinator {
  readonly #runs = new Map<string, StartingRun | ActiveRun>()
  readonly #titles: ThreadTitleGenerator

  constructor(
    private readonly store: Store,
    private readonly harnesses: HarnessRegistry,
    settings: UserSettings,
    private readonly events: TurnEvents
  ) {
    this.#titles = new ThreadTitleGenerator(
      store,
      harnesses,
      settings,
      events.changed
    )
  }

  async start(threadId: string, input: TurnInput): Promise<ThreadView> {
    if (this.#runs.has(threadId)) {
      throw new RuntimeError(
        "turn-active",
        "This task already has an active turn"
      )
    }

    const thread = this.store.threads.getRow(threadId)
    const harness = await this.harnesses.requireAvailable(thread.harness_id)
    const references = await resolvePromptReferences(
      this.store,
      threadId,
      input.references
    )
    const turn = this.store.turns.begin(threadId, input)
    const starting: StartingRun = {
      ...turn,
      threadId,
      phase: "starting",
      controller: new AbortController(),
      cancelled: false,
    }
    this.#runs.set(threadId, starting)
    this.events.changed(threadId)

    try {
      const session = await harness.start(
        {
          threadId,
          turnId: turn.turnId,
          projectPath: turn.projectPath,
          prompt: input.text,
          references,
          executionProfile: turn.executionProfile,
          customization: {
            skillRoots: existingSkillRoots(
              this.store.packs
                .attachedToWorkspace(turn.workspaceId)
                .map(({ path, name }) => ({ path, name }))
            ),
          },
          ...(turn.providerSessionId
            ? { providerSessionId: turn.providerSessionId }
            : {}),
        },
        starting.controller.signal
      )
      if (starting.cancelled || this.#runs.get(threadId) !== starting) {
        await session.cancel().catch(() => undefined)
        return this.store.threads.view(threadId)
      }
      const run: ActiveRun = {
        ...turn,
        threadId,
        phase: "active",
        session,
        cancelled: false,
        terminal: false,
        pendingText: "",
        approvalIds: new Map(),
        activityIds: new Map(),
        segmentMessageId: turn.assistantMessageId,
        lastMessageId: turn.assistantMessageId,
        // The user message holds 0 and the first assistant segment holds 1.
        ordinal: 2,
      }
      this.#runs.set(threadId, run)
      if (turn.generateTitle) {
        this.#titles.start({
          threadId,
          projectPath: turn.projectPath,
          prompt: input.text,
          harnessId: turn.harnessId,
          executionProfile: turn.executionProfile,
        })
      }
      void this.#consume(threadId, run)
    } catch (error) {
      if (!starting.cancelled) {
        this.store.turns.fail(
          threadId,
          turn.turnId,
          turn.assistantMessageId,
          harnessFailure(errorMessage(error))
        )
        this.events.changed(threadId)
      }
      if (this.#runs.get(threadId) === starting) this.#runs.delete(threadId)
    }

    return this.store.threads.view(threadId)
  }

  async cancel(threadId: string): Promise<ThreadView> {
    const run = this.#runs.get(threadId)
    if (!run)
      throw new RuntimeError("turn-not-active", "This task has no active turn")

    if (run.phase === "starting") {
      run.cancelled = true
      run.controller.abort()
      this.store.turns.cancel(threadId, run.turnId, run.assistantMessageId)
      this.#runs.delete(threadId)
      this.events.changed(threadId)
      return this.store.threads.view(threadId)
    }

    run.cancelled = true
    this.#flush(run)
    try {
      await run.session.cancel()
    } catch (error) {
      run.terminal = true
      const message = `Could not stop the harness: ${errorMessage(error)}`
      this.store.activities.settleRunning(run.turnId, "failed")
      this.store.turns.fail(
        threadId,
        run.turnId,
        this.#terminalMessageId(run),
        harnessFailure(message)
      )
      this.#runs.delete(threadId)
      this.events.changed(threadId)
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
      this.events.changed(threadId)
    }
    this.#runs.delete(threadId)
    return this.store.threads.view(threadId)
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
    try {
      await run.session.respondToApproval(providerApprovalId, decision)
    } catch (error) {
      const message = `Could not answer the harness: ${errorMessage(error)}`
      this.#fail(threadId, run, harnessFailure(message))
      await run.session.cancel().catch(() => undefined)
      throw new RuntimeError("approval-failed", message)
    }
    return this.store.threads.view(threadId)
  }

  async dispose(): Promise<void> {
    await this.#titles.dispose()
    const runs = [...this.#runs.entries()]
    for (const [threadId, run] of runs) {
      run.cancelled = true
      if (run.phase === "starting") {
        run.controller.abort()
        this.store.turns.cancel(threadId, run.turnId, run.assistantMessageId)
        continue
      }
      this.#flush(run)
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
        await run.session.cancel().catch(() => undefined)
      }
    } catch (error) {
      if (!run.cancelled && !run.terminal) {
        this.#fail(threadId, run, harnessFailure(errorMessage(error)))
        await run.session.cancel().catch(() => undefined)
      }
    } finally {
      if (this.#runs.get(threadId) === run) this.#runs.delete(threadId)
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
        break
      case "message.delta":
        this.#appendDelta(run, event.text)
        break
      case "usage.updated": {
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
        this.#flush(run)
        this.#requestApproval(threadId, run, event.request)
        this.events.changed(threadId)
        break
      case "turn.completed":
        this.#flush(run)
        run.terminal = true
        // A finished turn settles leftover rows as completed; a red failure
        // mark on a good turn would blame work that simply never reported.
        this.store.activities.settleRunning(run.turnId, "completed")
        this.store.turns.complete(
          threadId,
          run.turnId,
          this.#terminalMessageId(run)
        )
        this.events.changed(threadId)
        break
      case "turn.failed":
        this.#fail(threadId, run, event.failure)
        break
      case "activity.started":
        this.#startActivity(threadId, run, event.activity)
        break
      case "activity.updated":
        this.#updateActivity(threadId, run, event.update)
        break
      case "activity.completed":
        this.#completeActivity(threadId, run, event.id, event.outcome)
        break
    }
  }

  #fail(threadId: string, run: ActiveRun, failure: HarnessFailure): void {
    this.#flush(run)
    run.terminal = true
    this.store.activities.settleRunning(run.turnId, "failed")
    this.store.turns.fail(
      threadId,
      run.turnId,
      this.#terminalMessageId(run),
      failure
    )
    this.events.changed(threadId)
  }

  #appendDelta(run: ActiveRun, text: string): void {
    run.pendingText += text
    if (run.flushTimer) return
    run.flushTimer = setTimeout(() => this.#flush(run), streamFlushIntervalMs)
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
    const record = this.store.activities.start(
      threadId,
      run.turnId,
      run.ordinal++,
      {
        name: activity.name,
        ...(activity.detail ? { detail: activity.detail } : {}),
        ...(activity.payload ? { payload: activity.payload } : {}),
        ...(parentId ? { parentId } : {}),
      }
    )
    run.activityIds.set(activity.id, record.id)
    this.events.delta(threadId, { type: "activity.upserted", activity: record })
  }

  #updateActivity(
    threadId: string,
    run: ActiveRun,
    update: ActivityUpdate
  ): void {
    const id = run.activityIds.get(update.id)
    if (!id) return
    const record = this.store.activities.update(id, {
      ...(update.name !== undefined ? { name: update.name } : {}),
      ...(update.detail !== undefined ? { detail: update.detail } : {}),
      ...(update.payload !== undefined ? { payload: update.payload } : {}),
    })
    if (record)
      this.events.delta(threadId, {
        type: "activity.upserted",
        activity: record,
      })
  }

  #completeActivity(
    threadId: string,
    run: ActiveRun,
    providerId: string,
    outcome: "completed" | "failed"
  ): void {
    const id = run.activityIds.get(providerId)
    if (!id) return
    // The provider id stays mapped so later children can still name their
    // parent, and the status guard makes repeated completions harmless.
    const record = this.store.activities.complete(id, outcome)
    if (record)
      this.events.delta(threadId, {
        type: "activity.upserted",
        activity: record,
      })
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

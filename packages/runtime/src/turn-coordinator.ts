import { randomUUID } from "node:crypto"

import type {
  ApprovalDecision,
  HarnessEvent,
  HarnessSession,
} from "@openappto/harness-sdk"
import type { ThreadView } from "@openappto/protocol"

import { RuntimeError, errorMessage } from "./errors.js"
import type { HarnessRegistry } from "./harness-registry.js"
import type { Store } from "./storage/store.js"
import type { ActiveTurnRecord } from "./storage/turns.js"

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
  flushTimer?: ReturnType<typeof setTimeout>
}

const streamFlushIntervalMs = 50

export class TurnCoordinator {
  readonly #runs = new Map<string, StartingRun | ActiveRun>()

  constructor(
    private readonly store: Store,
    private readonly harnesses: HarnessRegistry,
    private readonly changed: (threadId: string) => void
  ) {}

  async start(threadId: string, prompt: string): Promise<ThreadView> {
    if (this.#runs.has(threadId)) {
      throw new RuntimeError(
        "turn-active",
        "This task already has an active turn"
      )
    }

    const thread = this.store.threads.getRow(threadId)
    const harness = await this.harnesses.requireAvailable(thread.harness_id)
    const turn = this.store.turns.begin(threadId, prompt)
    const starting: StartingRun = {
      ...turn,
      threadId,
      phase: "starting",
      controller: new AbortController(),
      cancelled: false,
    }
    this.#runs.set(threadId, starting)
    this.changed(threadId)

    try {
      const session = await harness.start(
        {
          threadId,
          turnId: turn.turnId,
          workspacePath: turn.workspacePath,
          prompt,
          executionProfile: turn.executionProfile,
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
      }
      this.#runs.set(threadId, run)
      void this.#consume(threadId, run)
    } catch (error) {
      if (!starting.cancelled) {
        this.store.turns.fail(
          threadId,
          turn.turnId,
          turn.assistantMessageId,
          errorMessage(error)
        )
        this.changed(threadId)
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
      this.changed(threadId)
      return this.store.threads.view(threadId)
    }

    run.cancelled = true
    this.#flush(run)
    try {
      await run.session.cancel()
    } catch (error) {
      run.terminal = true
      const message = `Could not stop the harness: ${errorMessage(error)}`
      this.store.activities.failRunning(run.turnId)
      this.store.turns.fail(
        threadId,
        run.turnId,
        run.assistantMessageId,
        message
      )
      this.#runs.delete(threadId)
      this.changed(threadId)
      throw new RuntimeError("cancel-failed", message)
    }
    if (!run.terminal) {
      run.terminal = true
      this.store.activities.failRunning(run.turnId)
      this.store.turns.cancel(threadId, run.turnId, run.assistantMessageId)
      this.changed(threadId)
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
    this.changed(threadId)
    try {
      await run.session.respondToApproval(providerApprovalId, decision)
    } catch (error) {
      const message = `Could not answer the harness: ${errorMessage(error)}`
      this.#fail(threadId, run, message)
      await run.session.cancel().catch(() => undefined)
      throw new RuntimeError("approval-failed", message)
    }
    return this.store.threads.view(threadId)
  }

  async dispose(): Promise<void> {
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
        this.store.activities.failRunning(run.turnId)
        this.store.turns.cancel(threadId, run.turnId, run.assistantMessageId)
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
        this.#fail(threadId, run, "Harness ended without completing the turn")
      }
    } catch (error) {
      if (!run.cancelled && !run.terminal) {
        this.#fail(threadId, run, errorMessage(error))
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
        return
      case "approval.requested":
        this.#flush(run)
        this.#requestApproval(threadId, run, event.request)
        break
      case "turn.completed":
        this.#flush(run)
        run.terminal = true
        this.store.activities.failRunning(run.turnId)
        this.store.turns.complete(threadId, run.turnId, run.assistantMessageId)
        break
      case "turn.failed":
        this.#fail(threadId, run, event.message)
        return
      case "activity.started":
        this.#startActivity(threadId, run, event.activity)
        break
      case "activity.completed":
        this.#completeActivity(run, event.id, event.outcome)
        break
    }
    this.changed(threadId)
  }

  #fail(threadId: string, run: ActiveRun, message: string): void {
    this.#flush(run)
    run.terminal = true
    this.store.activities.failRunning(run.turnId)
    this.store.turns.fail(threadId, run.turnId, run.assistantMessageId, message)
    this.changed(threadId)
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
    this.store.turns.requestApproval(threadId, run.turnId, {
      ...request,
      id: approvalId,
    })
  }

  #startActivity(
    threadId: string,
    run: ActiveRun,
    activity: Extract<HarnessEvent, { type: "activity.started" }>["activity"]
  ): void {
    if (run.activityIds.has(activity.id)) return
    const id = this.store.activities.start(threadId, run.turnId, activity)
    run.activityIds.set(activity.id, id)
  }

  #completeActivity(
    run: ActiveRun,
    providerId: string,
    outcome: "completed" | "failed"
  ): void {
    const id = run.activityIds.get(providerId)
    if (!id) return
    this.store.activities.complete(id, outcome)
    run.activityIds.delete(providerId)
  }

  #flush(run: ActiveRun): void {
    if (run.flushTimer) clearTimeout(run.flushTimer)
    run.flushTimer = undefined
    if (!run.pendingText) return

    this.store.turns.appendDelta(run.assistantMessageId, run.pendingText)
    run.pendingText = ""
    this.changed(run.threadId)
  }
}

import { z } from "zod"
import type { PlanStep, PlanStepStatus } from "@deskto/harness-sdk"
import type { JsonValue } from "@deskto/protocol"

import { normalizePlanStepStatus } from "../plan-status.js"

/**
 * Claude's task tools as one working plan.
 *
 * `TodoWrite` rewrites the whole list on every call, so a plan falls out of
 * each input on its own. `TaskCreate` and `TaskUpdate` are deltas against a
 * list the CLI holds, and they do not agree on a key: a create names its task
 * but not its id, while an update names it by an id the create never carried.
 * So the plan is assembled here, from the `TaskCreated` hook and from the
 * create's own answer — either binds the same pair.
 *
 * Until that binding lands a task is still shown, keyed by the call that made
 * it. An update naming an id nothing is bound to is never a new task: an
 * update is by definition about a task that already exists, and drawing a
 * second row for it — named `5`, or named with the rename it carried — is how
 * one task became three.
 */

const taskCreateInputSchema = z.object({ subject: z.string() })

const taskUpdateInputSchema = z.object({
  taskId: z.string(),
  subject: z.string().optional(),
  status: z.string().optional(),
})

/**
 * How the CLI answers a create: `Task #12 created successfully: Read the code`.
 * It is prose, not JSON, and this is the same shape the CLI matches on itself.
 */
const createdTaskPattern = /^Task #(\S+) created successfully(?::\s*(.*))?$/m

/** The tools that manage the list rather than do the work it describes. */
const taskPlanTools = new Set([
  "TaskCreate",
  "TaskUpdate",
  "TaskGet",
  "TaskList",
])

export function isTaskPlanTool(name: string): boolean {
  return taskPlanTools.has(name)
}

/** A change that named a task before this class could place it. */
type HeldChange = { status?: PlanStepStatus; subject?: string }

/** A task id, and the name it came with, waiting for the call it belongs to. */
type ParkedBinding = { taskId: string; subject?: string }

export class ClaudeTaskPlan {
  /** Insertion-ordered by the row's own key: the list reads as it was written. */
  readonly #tasks = new Map<string, PlanStep>()

  /** Task id to the key its row is filed under, once the two are known. */
  readonly #keys = new Map<string, string>()

  readonly #held = new Map<string, HeldChange>()
  readonly #parked = new Map<string, ParkedBinding>()

  /**
   * Records a create the moment it is called, keyed by that call. The task is
   * visible immediately; the id catches up.
   */
  created(toolUseId: string, input: JsonValue): boolean {
    const parsed = taskCreateInputSchema.safeParse(input)
    if (!parsed.success) return false
    this.#tasks.set(toolUseId, { text: parsed.data.subject, status: "pending" })
    const parked = this.#parked.get(toolUseId)
    if (parked) {
      this.#parked.delete(toolUseId)
      this.bind(toolUseId, parked.taskId, parked.subject)
    }
    return true
  }

  /**
   * Binds a task id to the call that created it. Both the `TaskCreated` hook
   * and the create's own answer report this pair, and either can arrive first
   * — including before the call itself — so this stays idempotent and parks
   * what it cannot place yet.
   *
   * Returns whether the plan now *reads* differently. A binding on its own
   * only teaches this class where a task lives; there is nothing to redraw
   * unless it also renamed the task or released a change held for it.
   */
  bind(toolUseId: string, taskId: string, subject?: string): boolean {
    const row = this.#tasks.get(toolUseId)
    if (!row) {
      const parked: ParkedBinding = { taskId }
      if (subject !== undefined) parked.subject = subject
      this.#parked.set(toolUseId, parked)
      return false
    }
    this.#keys.set(taskId, toolUseId)
    const held = this.#held.get(taskId)
    this.#held.delete(taskId)
    // A held change is the later word on the same task, so it lands over the
    // name the binding itself carried.
    return this.#apply(row, { subject, ...held })
  }

  /** Binds from the create's own answer, which repeats what the hook reports. */
  resolveCreated(toolUseId: string, result: string | undefined): boolean {
    const match = result?.match(createdTaskPattern)
    const taskId = match?.[1]
    if (!taskId) return false
    const subject = match?.[2]?.trim()
    return this.bind(toolUseId, taskId, subject || undefined)
  }

  updated(input: JsonValue): boolean {
    const parsed = taskUpdateInputSchema.safeParse(input)
    if (!parsed.success) return false
    const { taskId, subject, status } = parsed.data
    const key =
      this.#keys.get(taskId) ?? (this.#tasks.has(taskId) ? taskId : undefined)

    if (status === "deleted") {
      if (!key) return false
      this.#keys.delete(taskId)
      this.#tasks.delete(key)
      return true
    }

    const change: HeldChange = {}
    if (subject !== undefined) change.subject = subject
    if (status !== undefined) change.status = normalizePlanStepStatus(status)

    const row = key === undefined ? undefined : this.#tasks.get(key)
    if (!row) {
      // Hold it. This is a task that exists on the CLI's side and will appear
      // here the moment its create is bound; it is not a task of its own.
      this.#held.set(taskId, { ...this.#held.get(taskId), ...change })
      return false
    }
    return this.#apply(row, change)
  }

  steps(): PlanStep[] {
    return [...this.#tasks.values()].map((step) => ({ ...step }))
  }

  /** Applies a change, reporting whether it altered how the step reads. */
  #apply(row: PlanStep, change: HeldChange): boolean {
    let changed = false
    if (change.subject && change.subject !== row.text) {
      row.text = change.subject
      changed = true
    }
    if (change.status && change.status !== row.status) {
      row.status = change.status
      changed = true
    }
    return changed
  }
}

import { randomUUID } from "node:crypto"
import type { DatabaseSync } from "node:sqlite"

import {
  canMarkDone,
  canSnooze,
  type ContextUsage,
  type ExecutionProfile,
  type Thread,
  type ThreadView,
} from "@openappto/protocol"

import { RuntimeError } from "../errors.js"
import {
  toApproval,
  toActivity,
  toMessage,
  toThread,
  type ApprovalRow,
  type ActivityRow,
  type MessageRow,
  type ThreadRow,
} from "./records.js"
import type { Projects } from "./projects.js"

export class Threads {
  constructor(
    private readonly database: DatabaseSync,
    private readonly projects: Projects
  ) {}

  list(projectId: string): Thread[] {
    this.projects.get(projectId)
    const rows = this.database
      .prepare(
        "SELECT * FROM threads WHERE project_id = ? ORDER BY updated_at DESC"
      )
      .all(projectId) as ThreadRow[]
    return rows.map(toThread)
  }

  create(
    projectId: string,
    harnessId: string,
    executionProfile: ExecutionProfile
  ): Thread {
    this.projects.get(projectId)
    const now = new Date().toISOString()
    const thread: Thread = {
      id: randomUUID(),
      projectId,
      title: "New task",
      harnessId,
      status: "idle",
      executionProfile,
      lastUserMessageAt: null,
      lastTurnCompletedAt: null,
      lastVisitedAt: null,
      failedAt: null,
      pinnedAt: null,
      snoozedUntil: null,
      snoozedAt: null,
      doneOverride: null,
      doneAt: null,
      createdAt: now,
      updatedAt: now,
    }
    this.database
      .prepare(
        "INSERT INTO threads (id, project_id, title, harness_id, status, model_id, effort, permission_mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        thread.id,
        thread.projectId,
        thread.title,
        thread.harnessId,
        thread.status,
        executionProfile.modelId,
        executionProfile.effort,
        executionProfile.permissionMode,
        thread.createdAt,
        thread.updatedAt
      )
    return thread
  }

  configure(id: string, executionProfile: ExecutionProfile): ThreadView {
    const thread = this.getRow(id)
    const modelChanged = thread.model_id !== executionProfile.modelId
    if (thread.status === "running" || thread.status === "waiting-approval") {
      throw new RuntimeError(
        "thread-active",
        "Execution settings cannot change while the agent is working"
      )
    }
    this.database
      .prepare(
        "UPDATE threads SET model_id = ?, effort = ?, permission_mode = ?, context_used_tokens = CASE WHEN ? THEN NULL ELSE context_used_tokens END, context_max_tokens = CASE WHEN ? THEN NULL ELSE context_max_tokens END, updated_at = ? WHERE id = ?"
      )
      .run(
        executionProfile.modelId,
        executionProfile.effort,
        executionProfile.permissionMode,
        modelChanged ? 1 : 0,
        modelChanged ? 1 : 0,
        new Date().toISOString(),
        id
      )
    return this.view(id)
  }

  setContextUsage(id: string, usage: ContextUsage): void {
    // Providers report the window intermittently; keep the last known max
    // instead of erasing it on every max-less reading.
    this.database
      .prepare(
        "UPDATE threads SET context_used_tokens = ?, context_max_tokens = COALESCE(?, context_max_tokens) WHERE id = ?"
      )
      .run(usage.usedTokens, usage.maxTokens ?? null, id)
  }

  /** Rejects with the same predicates the client uses to disable these
      actions (see thread-guards in the protocol package). */
  #assertNotBlocked(row: ThreadRow, action: "close" | "snooze"): void {
    const allowed = action === "close" ? canMarkDone(row) : canSnooze(row)
    if (allowed) return
    throw new RuntimeError(
      "thread-blocked",
      row.status === "waiting-approval"
        ? "This task is waiting for your answer"
        : "The agent is still working on this task"
    )
  }

  /** One statement per write: RETURNING hands back the updated row, and an
      empty result doubles as the missing-id check. */
  #updateReturning(sql: string, ...params: (string | null)[]): Thread {
    const row = this.database.prepare(sql).get(...params) as
      | ThreadRow
      | undefined
    if (!row) throw new RuntimeError("thread-not-found", "Task not found")
    return toThread(row)
  }

  /**
   * Organization writes deliberately leave updated_at alone: it stamps
   * activity edges (turns, failures), and closing or snoozing a task is not
   * activity.
   */
  setDone(id: string, done: boolean): Thread {
    if (done) {
      this.#assertNotBlocked(this.getRow(id), "close")
      // Closing also unpins and wakes: a done task neither sits above the
      // inbox nor comes back from a snooze.
      return this.#updateReturning(
        "UPDATE threads SET done_override = 'done', done_at = ?, pinned_at = NULL, snoozed_until = NULL, snoozed_at = NULL WHERE id = ? RETURNING *",
        new Date().toISOString(),
        id
      )
    }
    // Restoring pins the task active rather than clearing the override,
    // so a quiet task does not immediately auto-close again.
    return this.#updateReturning(
      "UPDATE threads SET done_override = 'active', done_at = NULL WHERE id = ? RETURNING *",
      id
    )
  }

  snooze(id: string, until: string): Thread {
    this.#assertNotBlocked(this.getRow(id), "snooze")
    return this.#updateReturning(
      "UPDATE threads SET snoozed_until = ?, snoozed_at = ? WHERE id = ? RETURNING *",
      until,
      new Date().toISOString(),
      id
    )
  }

  wake(id: string): Thread {
    return this.#updateReturning(
      "UPDATE threads SET snoozed_until = NULL, snoozed_at = NULL WHERE id = ? RETURNING *",
      id
    )
  }

  setPinned(id: string, pinned: boolean): Thread {
    if (pinned) {
      // Pinning a done task reopens it: pinned means "keep in front of me".
      return this.#updateReturning(
        "UPDATE threads SET pinned_at = ?, done_override = NULL, done_at = NULL WHERE id = ? RETURNING *",
        new Date().toISOString(),
        id
      )
    }
    return this.#updateReturning(
      "UPDATE threads SET pinned_at = NULL WHERE id = ? RETURNING *",
      id
    )
  }

  markVisited(id: string): Thread {
    return this.#updateReturning(
      "UPDATE threads SET last_visited_at = ? WHERE id = ? RETURNING *",
      new Date().toISOString(),
      id
    )
  }

  getRow(id: string): ThreadRow {
    const row = this.database
      .prepare("SELECT * FROM threads WHERE id = ?")
      .get(id) as ThreadRow | undefined
    if (!row) throw new RuntimeError("thread-not-found", "Task not found")
    return row
  }

  view(id: string): ThreadView {
    const thread = toThread(this.getRow(id))
    const messages = this.database
      .prepare(
        "SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at, rowid"
      )
      .all(id) as MessageRow[]
    const approval = this.database
      .prepare(
        "SELECT * FROM approvals WHERE thread_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1"
      )
      .get(id) as ApprovalRow | undefined
    const activities = this.database
      .prepare(
        "SELECT * FROM activities WHERE thread_id = ? ORDER BY created_at, rowid"
      )
      .all(id) as ActivityRow[]

    return {
      thread,
      messages: messages.map(toMessage),
      activities: activities.map(toActivity),
      ...(approval ? { pendingApproval: toApproval(approval) } : {}),
    }
  }
}

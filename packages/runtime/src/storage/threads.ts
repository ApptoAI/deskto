import { randomUUID } from "node:crypto"
import type { DatabaseSync } from "node:sqlite"

import {
  canMarkDone,
  canSnooze,
  type ContextUsage,
  type ExecutionProfile,
  type ImageAttachmentPreview,
  type Thread,
  type ThreadView,
} from "@deskto/protocol"

import { RuntimeError } from "../errors.js"
import type { ThreadSequences } from "../thread-sequences.js"
import {
  toApproval,
  toActivity,
  toMessage,
  toImageAttachment,
  toThread,
  type ApprovalRow,
  type ActivityRow,
  type MessageRow,
  type MessageAttachmentMetadataRow,
  type MessageAttachmentRow,
  type ThreadRow,
} from "./records.js"
import type { Projects } from "./projects.js"

export const newThreadTitle = "New task"

export class Threads {
  constructor(
    private readonly database: DatabaseSync,
    private readonly projects: Projects,
    private readonly sequences: ThreadSequences
  ) {}

  list(projectId: string): Thread[] {
    this.projects.get(projectId)
    // SAFETY: migrations define every threads column in ThreadRow, and this
    // query selects complete rows.
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
      title: newThreadTitle,
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

  /** Replaces generated-title seed only; a later custom title always wins. */
  replaceTitle(id: string, expected: string, title: string): boolean {
    const result = this.database
      .prepare(
        "UPDATE threads SET title = ?, updated_at = ? WHERE id = ? AND title = ?"
      )
      .run(title, new Date().toISOString(), id, expected)
    return result.changes > 0
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
    // SAFETY: every caller supplies an UPDATE threads ... RETURNING * query;
    // that result matches ThreadRow or is absent when no id matched.
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
        "UPDATE threads SET pinned_at = ?, done_override = CASE WHEN done_override = 'active' THEN 'active' ELSE NULL END, done_at = NULL WHERE id = ? RETURNING *",
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

  /** Removes the task for good. Turns, messages, activities and approvals go
      with it through the foreign-key cascade; the project folder is untouched. */
  delete(id: string): void {
    const result = this.database
      .prepare("DELETE FROM threads WHERE id = ?")
      .run(id)
    if (result.changes === 0)
      throw new RuntimeError("thread-not-found", "Task not found")
    this.sequences.forget(id)
  }

  getRow(id: string): ThreadRow {
    // SAFETY: threads.id is the primary key and SELECT * matches ThreadRow;
    // SQLite returns undefined when no thread has that id.
    const row = this.database
      .prepare("SELECT * FROM threads WHERE id = ?")
      .get(id) as ThreadRow | undefined
    if (!row) throw new RuntimeError("thread-not-found", "Task not found")
    return row
  }

  view(id: string): ThreadView {
    const thread = toThread(this.getRow(id))
    // SAFETY: SELECT * matches MessageRow because migrations own the messages
    // schema and every column is selected.
    const messages = this.database
      .prepare(
        "SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at, rowid"
      )
      .all(id) as MessageRow[]
    // SAFETY: Thread views carry attachment metadata only. The BLOB is read
    // separately by previewAttachment when a visible image requests it.
    const attachmentRows = this.database
      .prepare(
        "SELECT attachment.id, attachment.message_id, attachment.type, attachment.name, attachment.mime_type, attachment.size_bytes, attachment.sort_order FROM message_attachments attachment JOIN messages message ON message.id = attachment.message_id WHERE message.thread_id = ? ORDER BY attachment.message_id, attachment.sort_order"
      )
      .all(id) as MessageAttachmentMetadataRow[]
    const attachmentsByMessage = new Map<
      string,
      ReturnType<typeof toImageAttachment>[]
    >()
    for (const row of attachmentRows) {
      const attachments = attachmentsByMessage.get(row.message_id) ?? []
      attachments.push(toImageAttachment(row))
      attachmentsByMessage.set(row.message_id, attachments)
    }
    // SAFETY: the query selects a complete ApprovalRow and LIMIT 1 yields
    // either one row or undefined.
    const approval = this.database
      .prepare(
        "SELECT * FROM approvals WHERE thread_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1"
      )
      .get(id) as ApprovalRow | undefined
    // SAFETY: SELECT * matches ActivityRow because migrations own the
    // activities schema and every column is selected.
    const activities = this.database
      .prepare(
        "SELECT * FROM activities WHERE thread_id = ? ORDER BY created_at, rowid"
      )
      .all(id) as ActivityRow[]

    const view: ThreadView = {
      thread,
      messages: messages.map((message) =>
        toMessage(message, attachmentsByMessage.get(message.id))
      ),
      activities: activities.map(toActivity),
      seq: this.sequences.current(id),
    }
    if (approval) view.pendingApproval = toApproval(approval)
    return view
  }

  previewAttachment(
    threadId: string,
    attachmentId: string
  ): ImageAttachmentPreview {
    // SAFETY: this is the one attachment read that selects the BLOB. The
    // attachment id is unique, so it returns one row or undefined.
    const row = this.database
      .prepare(
        "SELECT attachment.* FROM message_attachments attachment JOIN messages message ON message.id = attachment.message_id WHERE attachment.id = ? AND message.thread_id = ?"
      )
      .get(attachmentId, threadId) as MessageAttachmentRow | undefined
    if (!row) throw new RuntimeError("attachment-not-found", "Image not found")
    return {
      id: row.id,
      dataUrl: `data:${row.mime_type};base64,${Buffer.from(row.data).toString("base64")}`,
    }
  }

  get(id: string): Thread {
    return toThread(this.getRow(id))
  }
}

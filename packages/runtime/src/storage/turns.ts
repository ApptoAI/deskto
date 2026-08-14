import { randomUUID } from "node:crypto"
import type { DatabaseSync } from "node:sqlite"

import type {
  Approval,
  ExecutionProfile,
  HarnessFailure,
} from "@openappto/protocol"

import { RuntimeError } from "../errors.js"
import { transaction } from "./database.js"
import type { ThreadRow } from "./records.js"
import { newThreadTitle } from "./threads.js"

export type ActiveTurnRecord = {
  turnId: string
  assistantMessageId: string
  prompt: string
  providerSessionId?: string
  projectPath: string
  workspaceId: string
  harnessId: string
  executionProfile: ExecutionProfile
  generateTitle: boolean
}

export class Turns {
  constructor(private readonly database: DatabaseSync) {}

  begin(threadId: string, prompt: string): ActiveTurnRecord {
    const context = this.database
      .prepare(
        "SELECT t.*, p.path AS project_path, p.workspace_id AS workspace_id, EXISTS(SELECT 1 FROM turns existing WHERE existing.thread_id = t.id) AS has_turns FROM threads t JOIN projects p ON p.id = t.project_id WHERE t.id = ?"
      )
      .get(threadId) as
      | (ThreadRow & {
          project_path: string
          workspace_id: string
          has_turns: number
        })
      | undefined
    if (!context) throw new RuntimeError("thread-not-found", "Task not found")
    if (context.status === "running" || context.status === "waiting-approval") {
      throw new RuntimeError(
        "turn-active",
        "This task already has an active turn"
      )
    }

    const turnId = randomUUID()
    const userMessageId = randomUUID()
    const assistantMessageId = randomUUID()
    const now = new Date().toISOString()
    const generateTitle =
      context.title === newThreadTitle && context.has_turns === 0

    transaction(this.database, () => {
      this.database
        .prepare(
          "INSERT INTO turns (id, thread_id, prompt, status, provider_session_id, model_id, effort, permission_mode, created_at) VALUES (?, ?, ?, 'running', ?, ?, ?, ?, ?)"
        )
        .run(
          turnId,
          threadId,
          prompt,
          context.provider_session_id,
          context.model_id,
          context.effort,
          context.permission_mode,
          now
        )
      this.database
        .prepare(
          "INSERT INTO messages (id, thread_id, turn_id, role, content, state, created_at) VALUES (?, ?, ?, 'user', ?, 'complete', ?)"
        )
        .run(userMessageId, threadId, turnId, prompt, now)
      this.database
        .prepare(
          "INSERT INTO messages (id, thread_id, turn_id, role, content, state, created_at) VALUES (?, ?, ?, 'assistant', '', 'streaming', ?)"
        )
        .run(assistantMessageId, threadId, turnId, now)
      // A new turn is real activity: it stamps the message time and clears
      // the done override and the snooze, so a closed task cannot swallow
      // the reply the user just asked for and a running task cannot sit
      // hidden on the Later shelf.
      this.database
        .prepare(
          "UPDATE threads SET status = 'running', last_user_message_at = ?, done_override = NULL, done_at = NULL, snoozed_until = NULL, snoozed_at = NULL, failed_at = NULL, updated_at = ? WHERE id = ?"
        )
        .run(now, now, threadId)
    })

    return {
      turnId,
      assistantMessageId,
      prompt,
      projectPath: context.project_path,
      workspaceId: context.workspace_id,
      harnessId: context.harness_id,
      executionProfile: {
        modelId: context.model_id,
        effort: context.effort,
        permissionMode: context.permission_mode,
      },
      generateTitle,
      ...(context.provider_session_id
        ? { providerSessionId: context.provider_session_id }
        : {}),
    }
  }

  setProviderSession(
    threadId: string,
    turnId: string,
    providerSessionId: string
  ): void {
    transaction(this.database, () => {
      this.database
        .prepare(
          "UPDATE threads SET provider_session_id = ?, updated_at = ? WHERE id = ?"
        )
        .run(providerSessionId, new Date().toISOString(), threadId)
      this.database
        .prepare("UPDATE turns SET provider_session_id = ? WHERE id = ?")
        .run(providerSessionId, turnId)
    })
  }

  appendDelta(messageId: string, text: string): void {
    this.database
      .prepare(
        "UPDATE messages SET content = content || ? WHERE id = ? AND state = 'streaming'"
      )
      .run(text, messageId)
  }

  requestApproval(
    threadId: string,
    turnId: string,
    approval: Pick<Approval, "id" | "kind" | "title" | "detail">
  ): void {
    const now = new Date().toISOString()
    transaction(this.database, () => {
      const pending = this.database
        .prepare(
          "SELECT id FROM approvals WHERE thread_id = ? AND status = 'pending'"
        )
        .get(threadId)
      if (pending)
        throw new RuntimeError(
          "approval-active",
          "This task already has a pending approval"
        )

      this.database
        .prepare(
          "INSERT INTO approvals (id, thread_id, turn_id, kind, title, detail, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)"
        )
        .run(
          approval.id,
          threadId,
          turnId,
          approval.kind,
          approval.title,
          approval.detail ?? null,
          now
        )
      this.database
        .prepare("UPDATE turns SET status = 'waiting-approval' WHERE id = ?")
        .run(turnId)
      this.database
        .prepare(
          "UPDATE threads SET status = 'waiting-approval', updated_at = ? WHERE id = ?"
        )
        .run(now, threadId)
    })
  }

  assertPendingApproval(threadId: string, approvalId: string): void {
    const pending = this.database
      .prepare(
        "SELECT id FROM approvals WHERE id = ? AND thread_id = ? AND status = 'pending'"
      )
      .get(approvalId, threadId)
    if (!pending)
      throw new RuntimeError("approval-not-found", "Pending approval not found")
  }

  resolveApproval(
    threadId: string,
    approvalId: string,
    decision: "approve" | "deny"
  ): void {
    const now = new Date().toISOString()
    transaction(this.database, () => {
      const result = this.database
        .prepare(
          "UPDATE approvals SET status = ?, resolved_at = ? WHERE id = ? AND thread_id = ? AND status = 'pending'"
        )
        .run(
          decision === "approve" ? "approved" : "denied",
          now,
          approvalId,
          threadId
        )
      if (result.changes === 0) {
        throw new RuntimeError(
          "approval-not-found",
          "Pending approval not found"
        )
      }

      this.database
        .prepare(
          "UPDATE turns SET status = 'running' WHERE thread_id = ? AND status = 'waiting-approval'"
        )
        .run(threadId)
      this.database
        .prepare(
          "UPDATE threads SET status = 'running', updated_at = ? WHERE id = ?"
        )
        .run(now, threadId)
    })
  }

  complete(threadId: string, turnId: string, messageId: string): void {
    const now = new Date().toISOString()
    transaction(this.database, () => {
      this.database
        .prepare("UPDATE messages SET state = 'complete' WHERE id = ?")
        .run(messageId)
      this.database
        .prepare(
          "UPDATE turns SET status = 'completed', finished_at = ? WHERE id = ?"
        )
        .run(now, turnId)
      // Only a completion stamps the unread marker; a cancel was the user's
      // own act and a failure already shows through the status.
      this.database
        .prepare(
          "UPDATE threads SET last_turn_completed_at = ? WHERE id = ?"
        )
        .run(now, threadId)
      this.#finish(threadId, turnId, "idle", now)
    })
  }

  fail(
    threadId: string,
    turnId: string,
    messageId: string,
    failure: HarnessFailure
  ): void {
    const now = new Date().toISOString()
    transaction(this.database, () => {
      this.database
        .prepare(
          "UPDATE messages SET state = 'error', error = ?, failure_kind = ?, failure_reset_at = ? WHERE id = ?"
        )
        .run(failure.message, failure.kind, failure.resetAt ?? null, messageId)
      this.database
        .prepare(
          "UPDATE turns SET status = 'failed', error = ?, failure_kind = ?, failure_reset_at = ?, finished_at = ? WHERE id = ?"
        )
        .run(
          failure.message,
          failure.kind,
          failure.resetAt ?? null,
          now,
          turnId
        )
      this.#finish(threadId, turnId, "failed", now)
    })
  }

  cancel(threadId: string, turnId: string, messageId: string): void {
    const now = new Date().toISOString()
    transaction(this.database, () => {
      this.database
        .prepare("UPDATE messages SET state = 'complete' WHERE id = ?")
        .run(messageId)
      this.database
        .prepare("DELETE FROM messages WHERE id = ? AND content = ''")
        .run(messageId)
      this.database
        .prepare(
          "UPDATE turns SET status = 'cancelled', finished_at = ? WHERE id = ?"
        )
        .run(now, turnId)
      this.#finish(threadId, turnId, "idle", now)
    })
  }

  #finish(
    threadId: string,
    turnId: string,
    threadStatus: "idle" | "failed",
    now: string
  ): void {
    this.database
      .prepare(
        "UPDATE approvals SET status = 'denied', resolved_at = ? WHERE turn_id = ? AND status = 'pending'"
      )
      .run(now, turnId)
    // failed_at is the failure EDGE: stamped only on the transition into
    // failed and cleared on any other outcome, so snooze wake rules can
    // tell a fresh failure from one the user already snoozed past.
    this.database
      .prepare(
        "UPDATE threads SET status = ?, failed_at = ?, updated_at = ? WHERE id = ?"
      )
      .run(threadStatus, threadStatus === "failed" ? now : null, now, threadId)
  }
}

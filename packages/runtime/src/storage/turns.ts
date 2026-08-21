import { randomUUID } from "node:crypto"
import type { DatabaseSync } from "node:sqlite"

import type {
  Approval,
  ExecutionProfile,
  HarnessFailure,
  Message,
  TurnInput,
} from "@deskto/protocol"

import { RuntimeError } from "../errors.js"
import { transaction } from "./database.js"
import { decodeImageAttachment } from "./image-attachment-data.js"
import { toMessage, type MessageRow, type ThreadRow } from "./records.js"
import { newThreadTitle } from "./threads.js"

export type ActiveTurnRecord = {
  turnId: string
  assistantMessageId: string
  prompt: string
  providerSessionId?: string
  forkProviderSession?: boolean
  projectPath: string
  workspaceId: string
  harnessId: string
  executionProfile: ExecutionProfile
  generateTitle: boolean
}

export class Turns {
  constructor(private readonly database: DatabaseSync) {}

  begin(threadId: string, input: TurnInput): ActiveTurnRecord {
    const prompt = input.text
    const promptReferences =
      input.references.length > 0 ? JSON.stringify(input.references) : null
    const attachments = input.attachments.map((attachment) => ({
      attachment,
      data: decodeImageAttachment(attachment),
    }))
    // SAFETY: the query selects a complete ThreadRow plus the three named
    // project and EXISTS fields declared in this intersection.
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
          "INSERT INTO turns (id, thread_id, prompt, prompt_references, status, provider_session_id, model_id, effort, permission_mode, created_at) VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?, ?)"
        )
        .run(
          turnId,
          threadId,
          prompt,
          promptReferences,
          context.provider_session_id,
          context.model_id,
          context.effort,
          context.permission_mode,
          now
        )
      this.database
        .prepare(
          "INSERT INTO messages (id, thread_id, turn_id, role, content, prompt_references, state, ordinal, created_at) VALUES (?, ?, ?, 'user', ?, ?, 'complete', 0, ?)"
        )
        .run(userMessageId, threadId, turnId, prompt, promptReferences, now)
      const insertAttachment = this.database.prepare(
        "INSERT INTO message_attachments (id, message_id, type, name, mime_type, size_bytes, data, sort_order) VALUES (?, ?, 'image', ?, ?, ?, ?, ?)"
      )
      attachments.forEach(({ attachment, data }, index) => {
        insertAttachment.run(
          attachment.id,
          userMessageId,
          attachment.name,
          attachment.mimeType,
          attachment.sizeBytes,
          data,
          index
        )
      })
      this.database
        .prepare(
          "INSERT INTO messages (id, thread_id, turn_id, role, content, state, ordinal, created_at) VALUES (?, ?, ?, 'assistant', '', 'streaming', 1, ?)"
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

    const activeTurn: ActiveTurnRecord = {
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
    }
    if (context.provider_session_id) {
      activeTurn.providerSessionId = context.provider_session_id
    }
    if (context.fork_provider_session === 1) {
      activeTurn.forkProviderSession = true
    }
    return activeTurn
  }

  setProviderSession(
    threadId: string,
    turnId: string,
    providerSessionId: string
  ): void {
    transaction(this.database, () => {
      this.database
        .prepare(
          "UPDATE threads SET provider_session_id = ?, fork_provider_session = 0, updated_at = ? WHERE id = ?"
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

  /**
   * Opens a further assistant message inside a running Turn, so prose that
   * follows tool work lands after it instead of merging into one block.
   */
  addSegment(threadId: string, turnId: string, ordinal: number): Message {
    const id = randomUUID()
    const createdAt = new Date().toISOString()
    this.database
      .prepare(
        "INSERT INTO messages (id, thread_id, turn_id, role, content, state, ordinal, created_at) VALUES (?, ?, ?, 'assistant', '', 'streaming', ?, ?)"
      )
      .run(id, threadId, turnId, ordinal, createdAt)
    return {
      id,
      threadId,
      turnId,
      role: "assistant",
      content: "",
      state: "streaming",
      ordinal,
      createdAt,
    }
  }

  /** Settles a streaming segment when work moves on past it. */
  closeSegment(messageId: string): Message | undefined {
    const result = this.database
      .prepare(
        "UPDATE messages SET state = 'complete' WHERE id = ? AND state = 'streaming'"
      )
      .run(messageId)
    if (result.changes === 0) return undefined
    return this.requireMessage(messageId)
  }

  requireMessage(id: string): Message {
    // SAFETY: messages.id is the primary key and SELECT * matches MessageRow;
    // SQLite returns undefined for a missing id.
    const row = this.database
      .prepare("SELECT * FROM messages WHERE id = ?")
      .get(id) as MessageRow | undefined
    if (!row) throw new RuntimeError("message-not-found", "Message not found")
    return toMessage(row)
  }

  requestApproval(
    threadId: string,
    turnId: string,
    approval: Pick<Approval, "id" | "kind" | "title" | "detail">
  ): Approval {
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
    const record: Approval = {
      id: approval.id,
      threadId,
      kind: approval.kind,
      title: approval.title,
      status: "pending",
      createdAt: now,
    }
    if (approval.detail) record.detail = approval.detail
    return record
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
        .prepare("UPDATE threads SET last_turn_completed_at = ? WHERE id = ?")
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

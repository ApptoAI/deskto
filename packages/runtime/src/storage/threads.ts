import { randomUUID } from "node:crypto"
import type { DatabaseSync } from "node:sqlite"

import type {
  ContextUsage,
  ExecutionProfile,
  Thread,
  ThreadView,
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
import type { Workspaces } from "./workspaces.js"

export class Threads {
  constructor(
    private readonly database: DatabaseSync,
    private readonly workspaces: Workspaces
  ) {}

  list(workspaceId: string): Thread[] {
    this.workspaces.get(workspaceId)
    const rows = this.database
      .prepare(
        "SELECT * FROM threads WHERE workspace_id = ? ORDER BY updated_at DESC"
      )
      .all(workspaceId) as ThreadRow[]
    return rows.map(toThread)
  }

  create(
    workspaceId: string,
    harnessId: string,
    executionProfile: ExecutionProfile
  ): Thread {
    this.workspaces.get(workspaceId)
    const now = new Date().toISOString()
    const thread: Thread = {
      id: randomUUID(),
      workspaceId,
      title: "New task",
      harnessId,
      status: "idle",
      executionProfile,
      createdAt: now,
      updatedAt: now,
    }
    this.database
      .prepare(
        "INSERT INTO threads (id, workspace_id, title, harness_id, status, model_id, effort, permission_mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        thread.id,
        thread.workspaceId,
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
    if (thread.status === "running" || thread.status === "waiting-approval") {
      throw new RuntimeError(
        "thread-active",
        "Execution settings cannot change while the agent is working"
      )
    }
    this.database
      .prepare(
        "UPDATE threads SET model_id = ?, effort = ?, permission_mode = ?, updated_at = ? WHERE id = ?"
      )
      .run(
        executionProfile.modelId,
        executionProfile.effort,
        executionProfile.permissionMode,
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

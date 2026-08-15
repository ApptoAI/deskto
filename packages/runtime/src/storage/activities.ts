import { randomUUID } from "node:crypto"
import type { DatabaseSync } from "node:sqlite"

import type { Activity, ActivityPayload } from "@openappto/protocol"

import { toActivity, type ActivityRow } from "./records.js"

export type ActivityStartInput = {
  name: string
  detail?: string
  payload?: ActivityPayload
  parentId?: string
}

export type ActivityUpdateInput = {
  name?: string
  detail?: string
  payload?: ActivityPayload
}

export class Activities {
  constructor(private readonly database: DatabaseSync) {}

  start(
    threadId: string,
    turnId: string,
    ordinal: number,
    activity: ActivityStartInput
  ): Activity {
    const id = randomUUID()
    const createdAt = new Date().toISOString()
    this.database
      .prepare(
        "INSERT INTO activities (id, thread_id, turn_id, name, detail, status, payload, parent_id, ordinal, created_at) VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?, ?)"
      )
      .run(
        id,
        threadId,
        turnId,
        activity.name,
        activity.detail ?? null,
        activity.payload ? JSON.stringify(activity.payload) : null,
        activity.parentId ?? null,
        ordinal,
        createdAt
      )
    // SQLite is synchronous here, so the inserted row is exactly the input;
    // composing it in memory skips a read-back on the streaming hot path.
    return {
      id,
      threadId,
      turnId,
      name: activity.name,
      status: "running",
      ...(activity.detail ? { detail: activity.detail } : {}),
      ...(activity.payload ? { payload: activity.payload } : {}),
      ...(activity.parentId ? { parentActivityId: activity.parentId } : {}),
      ordinal,
      createdAt,
    }
  }

  /** Returns undefined when the activity is no longer running. */
  update(id: string, patch: ActivityUpdateInput): Activity | undefined {
    const result = this.database
      .prepare(
        "UPDATE activities SET name = COALESCE(?, name), detail = COALESCE(?, detail), payload = COALESCE(?, payload) WHERE id = ? AND status = 'running'"
      )
      .run(
        patch.name ?? null,
        patch.detail ?? null,
        patch.payload ? JSON.stringify(patch.payload) : null,
        id
      )
    if (result.changes === 0) return undefined
    return this.#find(id)
  }

  /** Returns undefined when the activity already settled. */
  complete(id: string, outcome: "completed" | "failed"): Activity | undefined {
    const result = this.database
      .prepare(
        "UPDATE activities SET status = ?, finished_at = ? WHERE id = ? AND status = 'running'"
      )
      .run(outcome, new Date().toISOString(), id)
    if (result.changes === 0) return undefined
    return this.#find(id)
  }

  find(id: string): Activity | undefined {
    return this.#find(id)
  }

  running(turnId: string): Activity[] {
    const rows = this.database
      .prepare(
        "SELECT * FROM activities WHERE turn_id = ? AND status = 'running'"
      )
      .all(turnId) as ActivityRow[]
    return rows.map(toActivity)
  }

  /**
   * Settles whatever is still running when a Turn ends: completed when the
   * Turn finished, failed when it was interrupted. Rows that never received
   * an explicit completion should not wear a failure mark on a good turn.
   */
  settleRunning(turnId: string, outcome: "completed" | "failed"): void {
    this.database
      .prepare(
        "UPDATE activities SET status = ?, finished_at = ? WHERE turn_id = ? AND status = 'running'"
      )
      .run(outcome, new Date().toISOString(), turnId)
  }

  #find(id: string): Activity | undefined {
    const row = this.database
      .prepare("SELECT * FROM activities WHERE id = ?")
      .get(id) as ActivityRow | undefined
    return row ? toActivity(row) : undefined
  }
}

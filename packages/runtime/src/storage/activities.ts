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
        new Date().toISOString()
      )
    return this.#get(id)
  }

  update(id: string, patch: ActivityUpdateInput): Activity | undefined {
    this.database
      .prepare(
        "UPDATE activities SET name = COALESCE(?, name), detail = COALESCE(?, detail), payload = COALESCE(?, payload) WHERE id = ? AND status = 'running'"
      )
      .run(
        patch.name ?? null,
        patch.detail ?? null,
        patch.payload ? JSON.stringify(patch.payload) : null,
        id
      )
    return this.#find(id)
  }

  complete(id: string, outcome: "completed" | "failed"): Activity | undefined {
    this.database
      .prepare(
        "UPDATE activities SET status = ?, finished_at = ? WHERE id = ? AND status = 'running'"
      )
      .run(outcome, new Date().toISOString(), id)
    return this.#find(id)
  }

  failRunning(turnId: string): void {
    this.database
      .prepare(
        "UPDATE activities SET status = 'failed', finished_at = ? WHERE turn_id = ? AND status = 'running'"
      )
      .run(new Date().toISOString(), turnId)
  }

  #get(id: string): Activity {
    const activity = this.#find(id)
    if (!activity) throw new Error(`Activity ${id} disappeared mid-write`)
    return activity
  }

  #find(id: string): Activity | undefined {
    const row = this.database
      .prepare("SELECT * FROM activities WHERE id = ?")
      .get(id) as ActivityRow | undefined
    return row ? toActivity(row) : undefined
  }
}

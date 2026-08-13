import { randomUUID } from "node:crypto"
import type { DatabaseSync } from "node:sqlite"

import type { Activity } from "@openappto/protocol"

export class Activities {
  constructor(private readonly database: DatabaseSync) {}

  start(
    threadId: string,
    turnId: string,
    activity: Pick<Activity, "name" | "detail">
  ): string {
    const id = randomUUID()
    this.database
      .prepare(
        "INSERT INTO activities (id, thread_id, turn_id, name, detail, status, created_at) VALUES (?, ?, ?, ?, ?, 'running', ?)"
      )
      .run(
        id,
        threadId,
        turnId,
        activity.name,
        activity.detail ?? null,
        new Date().toISOString()
      )
    return id
  }

  complete(id: string, outcome: "completed" | "failed"): void {
    this.database
      .prepare(
        "UPDATE activities SET status = ?, finished_at = ? WHERE id = ? AND status = 'running'"
      )
      .run(outcome, new Date().toISOString(), id)
  }

  failRunning(turnId: string): void {
    this.database
      .prepare(
        "UPDATE activities SET status = 'failed', finished_at = ? WHERE turn_id = ? AND status = 'running'"
      )
      .run(new Date().toISOString(), turnId)
  }
}

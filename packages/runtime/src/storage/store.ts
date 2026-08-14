import type { DatabaseSync } from "node:sqlite"

import { transaction } from "./database.js"
import { Activities } from "./activities.js"
import { Settings } from "./settings.js"
import { Threads } from "./threads.js"
import { Turns } from "./turns.js"
import { Workspaces } from "./workspaces.js"

export class Store {
  readonly workspaces: Workspaces
  readonly activities: Activities
  readonly threads: Threads
  readonly turns: Turns
  readonly settings: Settings

  constructor(private readonly database: DatabaseSync) {
    this.workspaces = new Workspaces(database)
    this.activities = new Activities(database)
    this.threads = new Threads(database, this.workspaces)
    this.turns = new Turns(database)
    this.settings = new Settings(database)
  }

  close(): void {
    this.database.close()
  }

  recoverInterrupted(): void {
    const now = new Date().toISOString()
    transaction(this.database, () => {
      this.database
        .prepare(
          "UPDATE turns SET status = 'interrupted', error = 'Application stopped during this turn', finished_at = ? WHERE status IN ('running', 'waiting-approval')"
        )
        .run(now)
      this.database
        .prepare(
          "UPDATE messages SET state = 'error', error = COALESCE(error, 'Application stopped during this turn') WHERE state = 'streaming'"
        )
        .run()
      this.database
        .prepare(
          "UPDATE approvals SET status = 'denied', resolved_at = ? WHERE status = 'pending'"
        )
        .run(now)
      this.database
        .prepare(
          "UPDATE activities SET status = 'failed', finished_at = ? WHERE status = 'running'"
        )
        .run(now)
      this.database
        .prepare(
          "UPDATE threads SET status = 'failed', updated_at = ? WHERE status IN ('running', 'waiting-approval')"
        )
        .run(now)
    })
  }
}

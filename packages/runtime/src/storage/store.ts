import type { DatabaseSync } from "node:sqlite"

import type { ThreadSequences } from "../thread-sequences.js"
import { transaction } from "./database.js"
import { Activities } from "./activities.js"
import { Artifacts } from "./artifacts.js"
import { Settings } from "./settings.js"
import { SkillProvisioningReports } from "./skill-provisioning.js"
import { Threads } from "./threads.js"
import { Turns } from "./turns.js"
import { Packs } from "./packs.js"
import { Projects } from "./projects.js"
import { Workspaces } from "./workspaces.js"

export class Store {
  readonly workspaces: Workspaces
  readonly projects: Projects
  readonly packs: Packs
  readonly activities: Activities
  readonly artifacts: Artifacts
  readonly threads: Threads
  readonly turns: Turns
  readonly settings: Settings
  readonly skillProvisioning: SkillProvisioningReports

  constructor(
    private readonly database: DatabaseSync,
    sequences: ThreadSequences
  ) {
    this.workspaces = new Workspaces(database)
    this.projects = new Projects(database, this.workspaces)
    this.packs = new Packs(database, this.workspaces)
    this.activities = new Activities(database)
    this.artifacts = new Artifacts(database)
    this.threads = new Threads(database, this.projects, sequences)
    this.turns = new Turns(database)
    this.settings = new Settings(database)
    this.skillProvisioning = new SkillProvisioningReports(database)
  }

  close(): void {
    this.database.close()
  }

  transaction<T>(operation: () => T): T {
    return transaction(this.database, operation)
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

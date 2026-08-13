import { randomUUID } from "node:crypto"
import type { DatabaseSync } from "node:sqlite"

import type { Workspace } from "@openappto/protocol"

import { RuntimeError } from "../errors.js"
import { toWorkspace, type WorkspaceRow } from "./records.js"

export class Workspaces {
  constructor(private readonly database: DatabaseSync) {}

  list(): Workspace[] {
    const rows = this.database
      .prepare("SELECT * FROM workspaces ORDER BY updated_at DESC")
      .all() as WorkspaceRow[]
    return rows.map(toWorkspace)
  }

  add(path: string, name: string): Workspace {
    const existing = this.database
      .prepare("SELECT * FROM workspaces WHERE path = ?")
      .get(path) as WorkspaceRow | undefined
    if (existing) return toWorkspace(existing)

    const now = new Date().toISOString()
    const workspace = {
      id: randomUUID(),
      name,
      path,
      createdAt: now,
      updatedAt: now,
    }
    this.database
      .prepare(
        "INSERT INTO workspaces (id, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(
        workspace.id,
        workspace.name,
        workspace.path,
        workspace.createdAt,
        workspace.updatedAt
      )
    return workspace
  }

  get(id: string): Workspace {
    const row = this.database
      .prepare("SELECT * FROM workspaces WHERE id = ?")
      .get(id) as WorkspaceRow | undefined
    if (!row) throw new RuntimeError("workspace-not-found", "Project not found")
    return toWorkspace(row)
  }
}

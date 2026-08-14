import { randomUUID } from "node:crypto"
import type { DatabaseSync } from "node:sqlite"

import { personalWorkspaceId, type Workspace } from "@openappto/protocol"

import { RuntimeError } from "../errors.js"
import { transaction } from "./database.js"
import { toWorkspace, type WorkspaceRow } from "./records.js"

export class Workspaces {
  constructor(private readonly database: DatabaseSync) {}

  list(): Workspace[] {
    const rows = this.database
      .prepare("SELECT * FROM workspaces ORDER BY sort_order, created_at")
      .all() as WorkspaceRow[]
    return rows.map(toWorkspace)
  }

  get(id: string): Workspace {
    const row = this.database
      .prepare("SELECT * FROM workspaces WHERE id = ?")
      .get(id) as WorkspaceRow | undefined
    if (!row)
      throw new RuntimeError("workspace-not-found", "Workspace not found")
    return toWorkspace(row)
  }

  create(name: string, color: string, icon: string): Workspace {
    const now = new Date().toISOString()
    const { next } = this.database
      .prepare(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM workspaces"
      )
      .get() as { next: number }
    const workspace: Workspace = {
      id: randomUUID(),
      name,
      color,
      icon,
      sortOrder: next,
      createdAt: now,
      updatedAt: now,
    }
    this.database
      .prepare(
        "INSERT INTO workspaces (id, name, color, icon, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        workspace.id,
        workspace.name,
        workspace.color,
        workspace.icon,
        workspace.sortOrder,
        workspace.createdAt,
        workspace.updatedAt
      )
    return workspace
  }

  update(
    id: string,
    patch: { name?: string; color?: string; icon?: string }
  ): Workspace {
    const current = this.get(id)
    const next = {
      name: patch.name ?? current.name,
      color: patch.color ?? current.color,
      icon: patch.icon ?? current.icon,
    }
    this.database
      .prepare(
        "UPDATE workspaces SET name = ?, color = ?, icon = ?, updated_at = ? WHERE id = ?"
      )
      .run(next.name, next.color, next.icon, new Date().toISOString(), id)
    return this.get(id)
  }

  /** Projects survive: they move to the Personal workspace, which itself cannot go. */
  delete(id: string): Workspace[] {
    if (id === personalWorkspaceId)
      throw new RuntimeError(
        "workspace-not-deletable",
        "The Personal workspace cannot be deleted"
      )
    this.get(id)
    const now = new Date().toISOString()
    transaction(this.database, () => {
      this.database
        .prepare(
          "UPDATE projects SET workspace_id = ?, updated_at = ? WHERE workspace_id = ?"
        )
        .run(personalWorkspaceId, now, id)
      this.database.prepare("DELETE FROM workspaces WHERE id = ?").run(id)
    })
    return this.list()
  }
}

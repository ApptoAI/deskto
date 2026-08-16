import { randomUUID } from "node:crypto"
import type { DatabaseSync } from "node:sqlite"

import type { Project } from "@openappto/protocol"

import { RuntimeError } from "../errors.js"
import { toProject, type ProjectRow } from "./records.js"
import type { Workspaces } from "./workspaces.js"

export class Projects {
  constructor(
    private readonly database: DatabaseSync,
    private readonly workspaces: Workspaces
  ) {}

  list(): Project[] {
    // SAFETY: migrations define every projects column used by ProjectRow, and
    // this query selects the complete row without computed fields.
    const rows = this.database
      .prepare("SELECT * FROM projects ORDER BY updated_at DESC")
      .all() as ProjectRow[]
    return rows.map(toProject)
  }

  /**
   * A folder registers once. Re-adding it in its own workspace returns the
   * existing project; in another workspace it fails loudly, because silently
   * returning a project the caller's workspace cannot show reads as a no-op.
   */
  add(path: string, name: string, workspaceId: string): Project {
    this.workspaces.get(workspaceId)
    // SAFETY: migrations define projects.path as unique and every selected
    // column matches ProjectRow; absence is represented by undefined.
    const existing = this.database
      .prepare("SELECT * FROM projects WHERE path = ?")
      .get(path) as ProjectRow | undefined
    if (existing && existing.workspace_id !== workspaceId)
      throw new RuntimeError(
        "project-in-other-workspace",
        "This folder is already a project in another workspace. Move it instead."
      )
    if (existing) return toProject(existing)

    const now = new Date().toISOString()
    const project = {
      id: randomUUID(),
      workspaceId,
      name,
      path,
      createdAt: now,
      updatedAt: now,
    }
    this.database
      .prepare(
        "INSERT INTO projects (id, workspace_id, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(
        project.id,
        project.workspaceId,
        project.name,
        project.path,
        project.createdAt,
        project.updatedAt
      )
    return project
  }

  move(projectId: string, workspaceId: string): Project {
    const current = this.get(projectId)
    this.workspaces.get(workspaceId)
    const updatedAt = new Date().toISOString()
    this.database
      .prepare(
        "UPDATE projects SET workspace_id = ?, updated_at = ? WHERE id = ?"
      )
      .run(workspaceId, updatedAt, projectId)
    return { ...current, workspaceId, updatedAt }
  }

  get(id: string): Project {
    // SAFETY: projects.id is the primary key and SELECT * matches ProjectRow;
    // SQLite returns undefined when no row has that id.
    const row = this.database
      .prepare("SELECT * FROM projects WHERE id = ?")
      .get(id) as ProjectRow | undefined
    if (!row) throw new RuntimeError("project-not-found", "Project not found")
    return toProject(row)
  }
}

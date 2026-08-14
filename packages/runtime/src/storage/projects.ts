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
    const rows = this.database
      .prepare("SELECT * FROM projects ORDER BY updated_at DESC")
      .all() as ProjectRow[]
    return rows.map(toProject)
  }

  /** A folder registers once; re-adding it returns the project where it already lives. */
  add(path: string, name: string, workspaceId: string): Project {
    this.workspaces.get(workspaceId)
    const existing = this.database
      .prepare("SELECT * FROM projects WHERE path = ?")
      .get(path) as ProjectRow | undefined
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
    this.get(projectId)
    this.workspaces.get(workspaceId)
    this.database
      .prepare(
        "UPDATE projects SET workspace_id = ?, updated_at = ? WHERE id = ?"
      )
      .run(workspaceId, new Date().toISOString(), projectId)
    return this.get(projectId)
  }

  get(id: string): Project {
    const row = this.database
      .prepare("SELECT * FROM projects WHERE id = ?")
      .get(id) as ProjectRow | undefined
    if (!row) throw new RuntimeError("project-not-found", "Project not found")
    return toProject(row)
  }
}

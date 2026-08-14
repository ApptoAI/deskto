import { randomUUID } from "node:crypto"
import type { DatabaseSync } from "node:sqlite"

import type { Project } from "@openappto/protocol"

import { RuntimeError } from "../errors.js"
import { toProject, type ProjectRow } from "./records.js"

export class Projects {
  constructor(private readonly database: DatabaseSync) {}

  list(): Project[] {
    const rows = this.database
      .prepare("SELECT * FROM projects ORDER BY updated_at DESC")
      .all() as ProjectRow[]
    return rows.map(toProject)
  }

  add(path: string, name: string): Project {
    const existing = this.database
      .prepare("SELECT * FROM projects WHERE path = ?")
      .get(path) as ProjectRow | undefined
    if (existing) return toProject(existing)

    const now = new Date().toISOString()
    const project = {
      id: randomUUID(),
      name,
      path,
      createdAt: now,
      updatedAt: now,
    }
    this.database
      .prepare(
        "INSERT INTO projects (id, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(
        project.id,
        project.name,
        project.path,
        project.createdAt,
        project.updatedAt
      )
    return project
  }

  get(id: string): Project {
    const row = this.database
      .prepare("SELECT * FROM projects WHERE id = ?")
      .get(id) as ProjectRow | undefined
    if (!row) throw new RuntimeError("project-not-found", "Project not found")
    return toProject(row)
  }
}

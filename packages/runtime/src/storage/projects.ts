import { randomUUID } from "node:crypto"
import type { DatabaseSync } from "node:sqlite"

import type {
  Project,
  ProjectDetails,
  ProjectLocationKind,
  ProjectTemplateSource,
} from "@deskto/protocol"

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
      .prepare(
        "SELECT * FROM projects ORDER BY pinned_at IS NULL, pinned_at DESC, updated_at DESC"
      )
      .all() as ProjectRow[]
    return rows.map(toProject)
  }

  /**
   * A folder registers once. Re-adding it in its own workspace returns the
   * existing project; in another workspace it fails loudly, because silently
   * returning a project the caller's workspace cannot show reads as a no-op.
   */
  add(
    path: string,
    name: string,
    workspaceId: string,
    options: {
      id?: string
      locationKind?: ProjectLocationKind
      instructions?: string
      sourceTemplate?: ProjectTemplateSource
    } = {}
  ): Project {
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
      id: options.id ?? randomUUID(),
      workspaceId,
      name,
      path,
      locationKind: options.locationKind ?? "linked",
      pinnedAt: null,
      createdAt: now,
      updatedAt: now,
    }
    this.database
      .prepare(
        `INSERT INTO projects (
          id, workspace_id, name, path, location_kind, instructions, pinned_at,
          source_template_id, source_template_name, source_template_pack_name,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`
      )
      .run(
        project.id,
        project.workspaceId,
        project.name,
        project.path,
        project.locationKind,
        options.instructions ?? "",
        options.sourceTemplate?.id ?? null,
        options.sourceTemplate?.name ?? null,
        options.sourceTemplate?.packName ?? null,
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

  details(projectId: string): ProjectDetails {
    const row = this.#getRow(projectId)
    const hasCompleteSource =
      row.source_template_id &&
      row.source_template_name &&
      row.source_template_pack_name
    return {
      project: toProject(row),
      instructions: row.instructions,
      sourceTemplate: hasCompleteSource
        ? {
            id: row.source_template_id!,
            name: row.source_template_name!,
            packName: row.source_template_pack_name!,
          }
        : null,
    }
  }

  update(
    projectId: string,
    patch: { name?: string; instructions?: string }
  ): ProjectDetails {
    const current = this.#getRow(projectId)
    const name = patch.name ?? current.name
    const instructions = patch.instructions ?? current.instructions
    const updatedAt = new Date().toISOString()
    this.database
      .prepare(
        "UPDATE projects SET name = ?, instructions = ?, updated_at = ? WHERE id = ?"
      )
      .run(name, instructions, updatedAt, projectId)
    return this.details(projectId)
  }

  setPinned(projectId: string, pinned: boolean): Project {
    this.get(projectId)
    this.database
      .prepare("UPDATE projects SET pinned_at = ? WHERE id = ?")
      .run(pinned ? new Date().toISOString() : null, projectId)
    return this.get(projectId)
  }

  changeLocation(
    projectId: string,
    path: string,
    locationKind: ProjectLocationKind
  ): Project {
    this.get(projectId)
    this.ensurePathAvailable(path, projectId)
    const updatedAt = new Date().toISOString()
    this.database
      .prepare(
        "UPDATE projects SET path = ?, location_kind = ?, updated_at = ? WHERE id = ?"
      )
      .run(path, locationKind, updatedAt, projectId)
    return this.get(projectId)
  }

  get(id: string): Project {
    return toProject(this.#getRow(id))
  }

  instructions(id: string): string {
    return this.#getRow(id).instructions
  }

  ensurePathAvailable(path: string, exceptProjectId?: string): void {
    // SAFETY: both queries select only the text id column and can return at most one row.
    const collision = exceptProjectId
      ? (this.database
          .prepare("SELECT id FROM projects WHERE path = ? AND id <> ?")
          .get(path, exceptProjectId) as { id: string } | undefined)
      : (this.database
          .prepare("SELECT id FROM projects WHERE path = ?")
          .get(path) as { id: string } | undefined)
    if (collision)
      throw new RuntimeError(
        "project-path-in-use",
        "This folder is already registered as another project"
      )
  }

  ensureIdle(projectId: string): void {
    this.get(projectId)
    // SAFETY: the query selects only the text id column and can return at most one row.
    const active = this.database
      .prepare(
        "SELECT id FROM threads WHERE project_id = ? AND status IN ('running', 'waiting-approval') LIMIT 1"
      )
      .get(projectId) as { id: string } | undefined
    if (active)
      throw new RuntimeError(
        "project-busy",
        "Wait for active tasks before moving this project"
      )
  }

  #getRow(id: string): ProjectRow {
    // SAFETY: projects.id is the primary key and SELECT * matches ProjectRow;
    // SQLite returns undefined when no row has that id.
    const row = this.database
      .prepare("SELECT * FROM projects WHERE id = ?")
      .get(id) as ProjectRow | undefined
    if (!row) throw new RuntimeError("project-not-found", "Project not found")
    return row
  }
}

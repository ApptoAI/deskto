import { randomUUID } from "node:crypto"
import type { DatabaseSync } from "node:sqlite"

import { RuntimeError } from "../errors.js"
import type { PackRow } from "./records.js"
import type { Workspaces } from "./workspaces.js"

/** Registration only; a Pack's content lives in its directory on disk. */
export class Packs {
  constructor(
    private readonly database: DatabaseSync,
    private readonly workspaces: Workspaces
  ) {}

  list(): PackRow[] {
    return this.database
      .prepare("SELECT * FROM packs ORDER BY name, created_at")
      .all() as PackRow[]
  }

  get(id: string): PackRow {
    const row = this.database
      .prepare("SELECT * FROM packs WHERE id = ?")
      .get(id) as PackRow | undefined
    if (!row) throw new RuntimeError("pack-not-found", "Pack not found")
    return row
  }

  /** Registering a path twice returns the existing pack. */
  add(name: string, path: string): PackRow {
    const existing = this.database
      .prepare("SELECT * FROM packs WHERE path = ?")
      .get(path) as PackRow | undefined
    if (existing) return existing

    const now = new Date().toISOString()
    const row: PackRow = {
      id: randomUUID(),
      name,
      path,
      created_at: now,
      updated_at: now,
    }
    this.database
      .prepare(
        "INSERT INTO packs (id, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(row.id, row.name, row.path, row.created_at, row.updated_at)
    return row
  }

  /** Unregisters the pack everywhere; its directory stays on disk. */
  remove(id: string): void {
    this.get(id)
    this.database.prepare("DELETE FROM packs WHERE id = ?").run(id)
  }

  /** All attachments in one query, for list views over every pack. */
  attachedWorkspaceIds(): Map<string, string[]> {
    const rows = this.database
      .prepare(
        "SELECT pack_id, workspace_id FROM workspace_packs ORDER BY workspace_id"
      )
      .all() as { pack_id: string; workspace_id: string }[]
    const byPack = new Map<string, string[]>()
    for (const row of rows) {
      const ids = byPack.get(row.pack_id) ?? []
      ids.push(row.workspace_id)
      byPack.set(row.pack_id, ids)
    }
    return byPack
  }

  workspaceIdsFor(packId: string): string[] {
    return (
      this.database
        .prepare(
          "SELECT workspace_id FROM workspace_packs WHERE pack_id = ? ORDER BY workspace_id"
        )
        .all(packId) as { workspace_id: string }[]
    ).map((row) => row.workspace_id)
  }

  setAttached(workspaceId: string, packId: string, attached: boolean): void {
    this.workspaces.get(workspaceId)
    this.get(packId)
    if (attached) {
      this.database
        .prepare(
          "INSERT INTO workspace_packs (workspace_id, pack_id) VALUES (?, ?) ON CONFLICT DO NOTHING"
        )
        .run(workspaceId, packId)
    } else {
      this.database
        .prepare(
          "DELETE FROM workspace_packs WHERE workspace_id = ? AND pack_id = ?"
        )
        .run(workspaceId, packId)
    }
  }

  /** Packs attached to this workspace, for session customization. */
  attachedToWorkspace(workspaceId: string): { path: string; name: string }[] {
    return this.database
      .prepare(
        "SELECT p.path, p.name FROM packs p JOIN workspace_packs wp ON wp.pack_id = p.id WHERE wp.workspace_id = ? ORDER BY p.name"
      )
      .all(workspaceId) as { path: string; name: string }[]
  }
}

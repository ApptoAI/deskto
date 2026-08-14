import { randomUUID } from "node:crypto"
import type { DatabaseSync } from "node:sqlite"

import { RuntimeError } from "../errors.js"

export type PackRow = {
  id: string
  name: string
  path: string
  created_at: string
  updated_at: string
}

/** Registration only; a Pack's content lives in its directory on disk. */
export class Packs {
  constructor(private readonly database: DatabaseSync) {}

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

  workspaceIds(packId: string): string[] {
    const rows = this.database
      .prepare(
        "SELECT workspace_id FROM workspace_packs WHERE pack_id = ? ORDER BY workspace_id"
      )
      .all(packId) as { workspace_id: string }[]
    return rows.map((row) => row.workspace_id)
  }

  setAttached(workspaceId: string, packId: string, attached: boolean): void {
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

  /** Pack directories attached to this workspace, for session customization. */
  pathsForWorkspace(workspaceId: string): string[] {
    const rows = this.database
      .prepare(
        "SELECT p.path FROM packs p JOIN workspace_packs wp ON wp.pack_id = p.id WHERE wp.workspace_id = ? ORDER BY p.name"
      )
      .all(workspaceId) as { path: string }[]
    return rows.map((row) => row.path)
  }
}

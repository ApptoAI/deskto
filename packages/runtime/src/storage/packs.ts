import { randomUUID } from "node:crypto"
import { dirname, resolve } from "node:path"
import type { DatabaseSync } from "node:sqlite"

import type { PackKind, PackReceipt } from "@deskto/protocol"

import { RuntimeError } from "../errors.js"
import { transaction } from "./database.js"
import type { PackRow } from "./records.js"
import type { Workspaces } from "./workspaces.js"

export type PackMetadata = {
  kind: PackKind
  contentDigest?: string | null
  receipt?: PackReceipt | null
}

/** Stores Pack ownership and Workspace attachment; content stays on disk. */
export class Packs {
  #managedRoot: string | null = null

  constructor(
    private readonly database: DatabaseSync,
    private readonly workspaces: Workspaces
  ) {}

  list(): PackRow[] {
    // SAFETY: migrations define the packs table with the PackRow columns, and
    // this query selects complete rows only.
    return this.database
      .prepare("SELECT * FROM packs ORDER BY name, created_at")
      .all() as PackRow[]
  }

  get(id: string): PackRow {
    // SAFETY: packs.id is the primary key and SELECT * matches PackRow;
    // SQLite returns undefined when the pack is absent.
    const row = this.database
      .prepare("SELECT * FROM packs WHERE id = ?")
      .get(id) as PackRow | undefined
    if (!row) throw new RuntimeError("pack-not-found", "Pack not found")
    return row
  }

  findByPath(path: string): PackRow | null {
    // SAFETY: packs.path is unique and SELECT * matches PackRow after the
    // ownership migration runs; SQLite returns undefined when absent.
    return (
      (this.database.prepare("SELECT * FROM packs WHERE path = ?").get(path) as
        | PackRow
        | undefined) ?? null
    )
  }

  /**
   * Finishes the ownership migration that SQL cannot perform because the
   * managed Pack root is supplied by the host rather than stored in SQLite.
   */
  initializeOwnership(managedRoot: string): void {
    this.#managedRoot = resolve(managedRoot)
    // SAFETY: the migration adds the PackRow columns before this query runs;
    // kind is the only temporarily-null field and is not read below.
    const legacy = this.database
      .prepare("SELECT * FROM packs WHERE kind IS NULL")
      .all() as PackRow[]
    if (legacy.length === 0) return

    transaction(this.database, () => {
      const update = this.database.prepare(
        "UPDATE packs SET kind = ?, updated_at = ? WHERE id = ? AND kind IS NULL"
      )
      const now = new Date().toISOString()
      for (const row of legacy) {
        const kind: PackKind = this.#isManagedPath(row.path)
          ? "managed"
          : "linked"
        update.run(kind, now, row.id)
      }
    })
  }

  /** Registering a path twice returns the existing pack. */
  add(name: string, path: string, metadata?: PackMetadata): PackRow {
    // SAFETY: packs.path is unique and SELECT * matches PackRow; an unmatched
    // path produces undefined.
    const existing = this.database
      .prepare("SELECT * FROM packs WHERE path = ?")
      .get(path) as PackRow | undefined
    if (existing) return existing

    const now = new Date().toISOString()
    const kind =
      metadata?.kind ?? (this.#isManagedPath(path) ? "managed" : "linked")
    const row: PackRow = {
      id: randomUUID(),
      name,
      path,
      kind,
      content_digest: metadata?.contentDigest ?? null,
      receipt_json: metadata?.receipt ? JSON.stringify(metadata.receipt) : null,
      created_at: now,
      updated_at: now,
    }
    this.database
      .prepare(
        "INSERT INTO packs (id, name, path, kind, content_digest, receipt_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        row.id,
        row.name,
        row.path,
        row.kind,
        row.content_digest,
        row.receipt_json,
        row.created_at,
        row.updated_at
      )
    return row
  }

  /** Deletes the record and lets the foreign key cascade remove attachments. */
  deleteRecord(id: string): void {
    this.get(id)
    this.database.prepare("DELETE FROM packs WHERE id = ?").run(id)
  }

  updateContentDigest(id: string, contentDigest: string): void {
    this.get(id)
    this.database
      .prepare(
        "UPDATE packs SET content_digest = ?, updated_at = ? WHERE id = ?"
      )
      .run(contentDigest, new Date().toISOString(), id)
  }

  /** All attachments in one query, for list views over every pack. */
  attachedWorkspaceIds(): Map<string, string[]> {
    // SAFETY: workspace_packs declares both selected columns as non-null text.
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
    // SAFETY: workspace_packs.workspace_id is non-null text for every row.
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
  attachedToWorkspace(workspaceId: string): PackRow[] {
    // SAFETY: the join selects complete packs rows, whose migration columns
    // match PackRow.
    return this.database
      .prepare(
        "SELECT p.* FROM packs p JOIN workspace_packs wp ON wp.pack_id = p.id WHERE wp.workspace_id = ? ORDER BY p.name"
      )
      .all(workspaceId) as PackRow[]
  }

  #isManagedPath(path: string): boolean {
    return (
      this.#managedRoot !== null && dirname(resolve(path)) === this.#managedRoot
    )
  }
}

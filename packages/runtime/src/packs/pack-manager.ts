import { mkdirSync, realpathSync } from "node:fs"
import { lstat } from "node:fs/promises"
import { isAbsolute, relative, resolve } from "node:path"
import { z } from "zod"

import type { PackReceipt, PackSkill } from "@deskto/protocol"

import { RuntimeError } from "../errors.js"
import type { PackRow } from "../storage/records.js"
import type { Packs } from "../storage/packs.js"
import { readPackName, validatePackDirectory } from "./pack-files.js"
import { ManagedSkills, type ManagedSkillDraft } from "./managed-skills.js"
import {
  createManagedPack,
  discardManagedPack,
  installPackFolder,
  installPackZip,
  isManagedDirectChild,
  sourceLabel,
  type MaterializedPack,
} from "./pack-installer.js"

export type PackFileActions = {
  trashItem(path: string): Promise<void>
}

const missingFileSystemEntrySchema = z.object({ code: z.literal("ENOENT") })

export class PackManager {
  readonly #managedRoot: string
  readonly #managedSkills: ManagedSkills

  constructor(
    private readonly packs: Packs,
    managedRoot: string,
    private readonly fileActions?: PackFileActions
  ) {
    mkdirSync(managedRoot, { recursive: true })
    this.#managedRoot = realpathSync(managedRoot)
    this.packs.initializeOwnership(this.#managedRoot)
    this.#managedSkills = new ManagedSkills(this.packs, this.#managedRoot)
  }

  async create(name: string): Promise<PackRow> {
    const normalizedName = name.trim()
    if (!normalizedName)
      throw new RuntimeError("invalid-name", "A name is required")
    const materialized = await createManagedPack(
      normalizedName,
      this.#managedRoot
    )
    return this.#registerManaged(materialized, { kind: "created" })
  }

  async installFolder(sourcePath: string): Promise<PackRow> {
    const materialized = await installPackFolder(sourcePath, this.#managedRoot)
    return this.#registerManaged(materialized, {
      kind: "folder",
      name: sourceLabel(sourcePath),
    })
  }

  async installZip(archivePath: string): Promise<PackRow> {
    const materialized = await installPackZip(archivePath, this.#managedRoot)
    return this.#registerManaged(materialized, {
      kind: "zip",
      name: sourceLabel(archivePath),
    })
  }

  createSkill(packId: string, draft: ManagedSkillDraft): Promise<PackSkill> {
    return this.#managedSkills.create(packId, draft)
  }

  updateSkill(
    packId: string,
    directoryName: string,
    draft: ManagedSkillDraft
  ): Promise<PackSkill> {
    return this.#managedSkills.update(packId, directoryName, draft)
  }

  async link(sourcePath: string): Promise<PackRow> {
    const path = await validatePackDirectory(sourcePath)
    const existing = this.packs.findByPath(path)
    if (existing) return existing
    if (isWithin(this.#managedRoot, path))
      throw new RuntimeError(
        "invalid-pack-operation",
        "A folder inside the managed Pack directory cannot be linked"
      )
    return this.packs.add(await readPackName(path), path, { kind: "linked" })
  }

  unlink(packId: string): void {
    const pack = this.packs.get(packId)
    if (pack.kind !== "linked")
      throw new RuntimeError(
        "invalid-pack-operation",
        "Managed Packs must be uninstalled, not unlinked"
      )
    this.packs.deleteRecord(pack.id)
  }

  async uninstall(packId: string): Promise<void> {
    const pack = this.packs.get(packId)
    if (pack.kind !== "managed")
      throw new RuntimeError(
        "invalid-pack-operation",
        "Linked Packs must be unlinked, not uninstalled"
      )
    if (!isManagedDirectChild(this.#managedRoot, pack.path))
      throw new RuntimeError(
        "invalid-pack-path",
        "Managed Pack path is outside the managed Pack directory"
      )

    if (await pathExists(pack.path)) {
      if (!this.fileActions)
        throw new RuntimeError(
          "trash-unavailable",
          "This environment cannot move Packs to trash"
        )
      await this.fileActions.trashItem(pack.path)
    }
    this.packs.deleteRecord(pack.id)
  }

  async #registerManaged(
    materialized: MaterializedPack,
    source: PackReceipt["source"]
  ): Promise<PackRow> {
    const installedAt = new Date().toISOString()
    const receipt: PackReceipt = {
      schemaVersion: 1,
      installedAt,
      source,
      contentDigest: materialized.contentDigest,
      fileCount: materialized.fileCount,
      totalBytes: materialized.totalBytes,
    }
    try {
      return this.packs.add(materialized.name, materialized.path, {
        kind: "managed",
        contentDigest: materialized.contentDigest,
        receipt,
      })
    } catch (error) {
      await discardManagedPack(materialized.path, this.#managedRoot).catch(
        () => undefined
      )
      throw error
    }
  }
}

function isWithin(root: string, candidate: string): boolean {
  const pathFromRoot = relative(resolve(root), resolve(candidate))
  return (
    pathFromRoot === "" ||
    (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot))
  )
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (missingFileSystemEntrySchema.safeParse(error).success) return false
    throw error
  }
}

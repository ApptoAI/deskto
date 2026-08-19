import { mkdirSync, realpathSync } from "node:fs"
import { lstat } from "node:fs/promises"
import { z } from "zod"

import {
  mySkillsPackName,
  type ManagedSkillDraft,
  type PackReceipt,
  type PackSkill,
} from "@deskto/protocol"

import { RuntimeError } from "../errors.js"
import { pathIsDirectChild, pathIsWithin } from "../path-boundaries.js"
import type { PackRow } from "../storage/records.js"
import type { Packs } from "../storage/packs.js"
import { readPackName, validatePackDirectory } from "./pack-files.js"
import { ManagedSkills } from "./managed-skills.js"
import {
  sourceLabel,
  stageManagedPack,
  stagePackFolder,
  stagePackZip,
  type StagedManagedPack,
} from "./pack-installer.js"
import { canEditManagedSkills } from "./pack-capabilities.js"

export type PackFileActions = {
  trashItem(path: string): Promise<void>
}

const missingFileSystemEntrySchema = z.object({ code: z.literal("ENOENT") })

export class PackManager {
  readonly #managedRoot: string
  readonly #managedSkills: ManagedSkills
  #mySkillsPackCreation: Promise<PackRow> | null = null

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

    if (normalizedName === mySkillsPackName) {
      const existing = this.packs.list().find(canEditManagedSkills)
      if (existing) return existing
      if (!this.#mySkillsPackCreation) {
        this.#mySkillsPackCreation = this.#create(normalizedName).finally(
          () => {
            this.#mySkillsPackCreation = null
          }
        )
      }
      return this.#mySkillsPackCreation
    }

    return this.#create(normalizedName)
  }

  async #create(name: string): Promise<PackRow> {
    const staged = await stageManagedPack(name, this.#managedRoot)
    return this.#registerManaged(staged, { kind: "created" })
  }

  async installFolder(sourcePath: string): Promise<PackRow> {
    const staged = await stagePackFolder(sourcePath, this.#managedRoot)
    return this.#registerManaged(staged, {
      kind: "folder",
      name: sourceLabel(sourcePath),
    })
  }

  async installZip(archivePath: string): Promise<PackRow> {
    const staged = await stagePackZip(archivePath, this.#managedRoot)
    return this.#registerManaged(staged, {
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
    if (pathIsWithin(this.#managedRoot, path))
      throw new RuntimeError(
        "invalid-pack-operation",
        "A folder inside the managed Pack directory cannot be linked"
      )
    const existing = this.packs.findByPath(path)
    if (existing) return existing
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
    if (!pathIsDirectChild(this.#managedRoot, pack.path))
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
    staged: StagedManagedPack,
    source: PackReceipt["source"]
  ): Promise<PackRow> {
    const installedAt = new Date().toISOString()
    const receipt: PackReceipt = {
      schemaVersion: 1,
      installedAt,
      source,
      contentDigest: staged.contentDigest,
      fileCount: staged.fileCount,
      totalBytes: staged.totalBytes,
    }
    let record: PackRow | undefined
    let recordIsOwned = false
    try {
      const added = this.packs.addWithStatus(staged.name, staged.path, {
        kind: "managed",
        contentDigest: staged.contentDigest,
        receipt,
      })
      record = added.record
      recordIsOwned = added.inserted
      if (!recordIsOwned)
        throw new RuntimeError(
          "invalid-pack-path",
          "The managed Pack destination is already registered"
        )
      await staged.commit()
      return record
    } catch (error) {
      if (record && recordIsOwned)
        try {
          this.packs.deleteRecord(record.id)
        } catch {
          // Preserve the install error when best-effort rollback also fails.
        }
      await staged.discard().catch(() => undefined)
      throw error
    }
  }
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

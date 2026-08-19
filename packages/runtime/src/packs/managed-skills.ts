import { randomUUID } from "node:crypto"
import { lstat, mkdir, rename, rm, writeFile } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"

import type { ManagedSkillDraft, PackSkill } from "@deskto/protocol"
import { stringify } from "yaml"

import { RuntimeError } from "../errors.js"
import { pathIsDirectChild } from "../path-boundaries.js"
import type { PackRow } from "../storage/records.js"
import type { Packs } from "../storage/packs.js"
import { refreshPackDigest } from "./refresh-pack-digest.js"
import { packSkillId, skillsDirectory, slugify } from "./pack-files.js"
import { canEditManagedSkills } from "./pack-capabilities.js"

export class ManagedSkills {
  readonly #managedRoot: string

  constructor(
    private readonly packs: Packs,
    managedRoot: string
  ) {
    this.#managedRoot = resolve(managedRoot)
  }

  async create(packId: string, draft: ManagedSkillDraft): Promise<PackSkill> {
    const pack = await this.#managedPack(packId)
    const root = await this.#skillsRoot(pack, true)
    const directoryName = `${slugify(required(draft.name, "name")) || "skill"}-${randomUUID().slice(0, 8)}`
    const staging = join(root, `.create-${randomUUID()}`)
    const destination = join(root, directoryName)
    try {
      await mkdir(staging)
      await writeFile(join(staging, "SKILL.md"), skillFile(draft), {
        flag: "wx",
      })
      await rename(staging, destination)
    } catch (error) {
      await rm(staging, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }
    await refreshPackDigest(this.packs, pack)
    return toPackSkill(pack, directoryName, draft)
  }

  async update(
    packId: string,
    directoryName: string,
    draft: ManagedSkillDraft
  ): Promise<PackSkill> {
    const pack = await this.#managedPack(packId)
    if (basename(directoryName) !== directoryName)
      throw new RuntimeError("invalid-skill", "Skill folder name is invalid")
    const root = await this.#skillsRoot(pack, false)
    const directory = join(root, directoryName)
    if (dirname(resolve(directory)) !== resolve(root))
      throw new RuntimeError(
        "invalid-skill",
        "Skill folder is outside the Pack"
      )
    const metadata = await lstat(directory).catch(() => null)
    if (!metadata?.isDirectory() || metadata.isSymbolicLink())
      throw new RuntimeError("skill-not-found", "Managed skill was not found")

    const temporaryFile = join(directory, `.SKILL-${randomUUID()}.tmp`)
    try {
      await writeFile(temporaryFile, skillFile(draft), { flag: "wx" })
      await rename(temporaryFile, join(directory, "SKILL.md"))
    } catch (error) {
      await rm(temporaryFile, { force: true }).catch(() => undefined)
      throw error
    }
    await refreshPackDigest(this.packs, pack)
    return toPackSkill(pack, directoryName, draft)
  }

  async #managedPack(packId: string): Promise<PackRow> {
    const pack = this.packs.get(packId)
    if (
      !canEditManagedSkills(pack) ||
      !pathIsDirectChild(this.#managedRoot, pack.path)
    ) {
      throw new RuntimeError(
        "invalid-pack-operation",
        "Skills can be edited only in the My Skills Pack"
      )
    }
    const metadata = await lstat(pack.path).catch(() => null)
    if (!metadata?.isDirectory() || metadata.isSymbolicLink()) {
      throw new RuntimeError(
        "invalid-pack-path",
        "The My Skills Pack directory is not safe to edit"
      )
    }
    return pack
  }

  async #skillsRoot(pack: PackRow, create: boolean): Promise<string> {
    const root = skillsDirectory(pack.path)
    let metadata = await lstat(root).catch(() => null)
    if (!metadata && create) {
      await mkdir(root)
      metadata = await lstat(root)
    }
    if (!metadata?.isDirectory() || metadata.isSymbolicLink()) {
      throw new RuntimeError(
        "invalid-pack-path",
        "The My Skills directory is not safe to edit"
      )
    }
    return root
  }
}

function skillFile(draft: ManagedSkillDraft): string {
  const name = required(draft.name, "name")
  const description = required(draft.description, "description")
  const instructions = required(draft.instructions, "instructions")
  const frontmatter = stringify({ name, description }).trimEnd()
  return `---\n${frontmatter}\n---\n\n${instructions}\n`
}

function required(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized)
    throw new RuntimeError("invalid-skill", `Skill ${field} is required`)
  return normalized
}

function toPackSkill(
  pack: PackRow,
  directoryName: string,
  draft: ManagedSkillDraft
): PackSkill {
  return {
    id: packSkillId(pack.id, directoryName),
    packId: pack.id,
    packName: pack.name,
    name: draft.name.trim(),
    description: draft.description.trim(),
  }
}

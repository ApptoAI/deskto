import { randomUUID } from "node:crypto"
import { lstat, mkdir, rename, rm, writeFile } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"

import type { PackSkill } from "@deskto/protocol"
import { stringify } from "yaml"

import { RuntimeError } from "../errors.js"
import type { PackRow } from "../storage/records.js"
import type { Packs } from "../storage/packs.js"
import { digestPackDirectory } from "./pack-digest.js"
import { packSkillId, skillsDirectory, slugify } from "./pack-files.js"
import { isManagedDirectChild } from "./pack-installer.js"

export type ManagedSkillDraft = {
  name: string
  description: string
  instructions: string
}

export class ManagedSkills {
  readonly #managedRoot: string

  constructor(
    private readonly packs: Packs,
    managedRoot: string
  ) {
    this.#managedRoot = resolve(managedRoot)
  }

  async create(packId: string, draft: ManagedSkillDraft): Promise<PackSkill> {
    const pack = this.#managedPack(packId)
    const root = skillsDirectory(pack.path)
    await mkdir(root, { recursive: true })
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
    await this.#refreshDigest(pack)
    return toPackSkill(pack, directoryName, draft)
  }

  async update(
    packId: string,
    directoryName: string,
    draft: ManagedSkillDraft
  ): Promise<PackSkill> {
    const pack = this.#managedPack(packId)
    if (basename(directoryName) !== directoryName)
      throw new RuntimeError("invalid-skill", "Skill folder name is invalid")
    const root = skillsDirectory(pack.path)
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
    await this.#refreshDigest(pack)
    return toPackSkill(pack, directoryName, draft)
  }

  #managedPack(packId: string): PackRow {
    const pack = this.packs.get(packId)
    if (
      pack.kind !== "managed" ||
      !isManagedDirectChild(this.#managedRoot, pack.path)
    ) {
      throw new RuntimeError(
        "invalid-pack-operation",
        "Skills can be edited only in Packs managed by Deskto"
      )
    }
    return pack
  }

  async #refreshDigest(pack: PackRow): Promise<void> {
    const digest = await digestPackDirectory(pack.path)
    this.packs.updateContentDigest(pack.id, digest.contentDigest)
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

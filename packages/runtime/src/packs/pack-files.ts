import { statSync } from "node:fs"
import { readFile, realpath, stat } from "node:fs/promises"
import { basename, join } from "node:path"

import type { SkillRoot } from "@deskto/harness-sdk"
import type { PackSkill, SkillOccurrence } from "@deskto/protocol"
import { z } from "zod"

import type { PackRow } from "../storage/records.js"
import { scanSkillSource } from "../skills/skill-scanner.js"

import { RuntimeError } from "../errors.js"

const packManifestSchema = z.object({ name: z.string().trim().min(1) })

/**
 * A Pack directory is provider-neutral: a small pack.json manifest and a
 * skills/ directory whose children are SKILL.md skill folders.
 */

export function skillsDirectory(packPath: string): string {
  return join(packPath, "skills")
}

/** Skill roots that actually exist right now; packs can vanish from disk. */
export function existingSkillRoots(
  packs: {
    id?: string
    path: string
    name: string
    content_digest?: string | null
  }[]
): SkillRoot[] {
  return packs
    .map((pack) => ({
      id: pack.id ?? pack.path,
      path: skillsDirectory(pack.path),
      name: pack.name,
      ...(pack.content_digest
        ? { contentDigest: pack.content_digest }
        : undefined),
    }))
    .filter((root) => isDirectory(root.path))
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** Resolves a path and asserts it is a directory, with caller-owned wording. */
export async function resolvedDirectory(
  path: string,
  error: { code: string; missing: string; notFolder: string }
): Promise<string> {
  let resolved: string
  try {
    resolved = await realpath(path)
  } catch {
    throw new RuntimeError(error.code, error.missing)
  }
  if (!(await stat(resolved)).isDirectory())
    throw new RuntimeError(error.code, error.notFolder)
  return resolved
}

export async function validatePackDirectory(path: string): Promise<string> {
  const resolved = await resolvedDirectory(path, {
    code: "invalid-pack",
    missing: "Pack folder does not exist",
    notFolder: "Pack path is not a folder",
  })
  await resolvedDirectory(skillsDirectory(resolved), {
    code: "invalid-pack",
    missing: "A pack folder must contain a skills directory",
    notFolder: "A pack folder must contain a skills directory",
  })
  return resolved
}

export async function readPackName(packPath: string): Promise<string> {
  try {
    const parsed = packManifestSchema.safeParse(
      JSON.parse(await readFile(join(packPath, "pack.json"), "utf8"))
    )
    if (parsed.success) return parsed.data.name
  } catch {
    // No readable manifest; the folder name is the next best label.
  }
  return basename(packPath)
}

export type ResolvedPackSkill = {
  skill: PackSkill
  path: string
}

export type PackContents = {
  occurrences: SkillOccurrence[]
  resolvedSkills: ResolvedPackSkill[]
}

export function packSkillId(packId: string, directoryName: string): string {
  return `${packId}/${encodeURIComponent(directoryName)}`
}

export async function readResolvedPackSkills(
  pack: Pick<PackRow, "id" | "name" | "path">
): Promise<ResolvedPackSkill[]> {
  return (await readPackContents(pack)).resolvedSkills
}

export async function readPackContents(
  pack: Pick<PackRow, "id" | "name" | "path">
): Promise<PackContents> {
  const root = skillsDirectory(pack.path)
  const scanned = await scanSkillSource(
    {
      id: pack.id,
      kind: "pack",
      scope: "workspace",
      label: pack.name,
      path: root,
      harnessIds: [],
      packId: pack.id,
      editable: false,
      provisioning: [],
    },
    { missingIsDiagnostic: true }
  )
  const resolvedSkills = scanned.skills
    .filter(({ content }) => content !== null)
    .map(({ occurrence }) => ({
      path: occurrence.skillFilePath,
      skill: {
        id: packSkillId(pack.id, occurrence.directoryName),
        packId: pack.id,
        packName: pack.name,
        name: occurrence.name ?? occurrence.directoryName,
        description: occurrence.description ?? "",
      },
    }))
  return {
    occurrences: scanned.skills.map(({ occurrence }) => occurrence),
    resolvedSkills,
  }
}

export async function readPackSkills(
  pack: Pick<PackRow, "id" | "name" | "path">
): Promise<PackSkill[]> {
  return (await readResolvedPackSkills(pack)).map((entry) => entry.skill)
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

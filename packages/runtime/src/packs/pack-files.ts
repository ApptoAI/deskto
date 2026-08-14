import { existsSync } from "node:fs"
import { mkdir, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises"
import { basename, join } from "node:path"

import type { SkillRoot } from "@openappto/harness-sdk"
import type { PackSkill } from "@openappto/protocol"

import { RuntimeError } from "../errors.js"

/**
 * A Pack directory is provider-neutral: a small pack.json manifest and a
 * skills/ directory whose children are SKILL.md skill folders.
 */

export function skillsDirectory(packPath: string): string {
  return join(packPath, "skills")
}

/** Skill roots that actually exist right now; packs can vanish from disk. */
export function existingSkillRoots(
  packs: { path: string; name: string }[]
): SkillRoot[] {
  return packs
    .map((pack) => ({ path: skillsDirectory(pack.path), name: pack.name }))
    .filter((root) => existsSync(root.path))
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

/**
 * Creates the pack directory, adopting a leftover folder with the same slug
 * (pack.remove keeps directories on disk) instead of failing on it.
 */
export async function createPackDirectory(
  packsRoot: string,
  name: string
): Promise<string> {
  const slug = slugify(name)
  if (!slug)
    throw new RuntimeError("invalid-pack", "Pack name needs letters or digits")
  const path = join(packsRoot, slug)

  await mkdir(skillsDirectory(path), { recursive: true })
  if (!existsSync(join(path, "pack.json")))
    await writeFile(
      join(path, "pack.json"),
      `${JSON.stringify({ name }, null, 2)}\n`
    )
  return path
}

export async function validatePackDirectory(path: string): Promise<string> {
  const resolved = await resolvedDirectory(path, {
    code: "invalid-pack",
    missing: "Pack folder does not exist",
    notFolder: "Pack path is not a folder",
  })
  if (!existsSync(skillsDirectory(resolved)))
    throw new RuntimeError(
      "invalid-pack",
      "A pack folder must contain a skills directory"
    )
  return resolved
}

export async function readPackName(packPath: string): Promise<string> {
  try {
    const manifest = JSON.parse(
      await readFile(join(packPath, "pack.json"), "utf8")
    ) as { name?: unknown }
    if (typeof manifest.name === "string" && manifest.name.trim())
      return manifest.name.trim()
  } catch {
    // No readable manifest; the folder name is the next best label.
  }
  return basename(packPath)
}

export async function readPackSkills(packPath: string): Promise<PackSkill[]> {
  const root = skillsDirectory(packPath)
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return []
  }

  const skills = (
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => readSkill(join(root, entry.name), entry.name))
    )
  ).filter((skill): skill is PackSkill => skill !== null)
  return skills.sort((a, b) => a.name.localeCompare(b.name))
}

async function readSkill(
  directory: string,
  fallbackName: string
): Promise<PackSkill | null> {
  let content: string
  try {
    content = await readFile(join(directory, "SKILL.md"), "utf8")
  } catch {
    return null
  }
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)?.[1] ?? ""
  return {
    name: frontmatterValue(frontmatter, "name") ?? fallbackName,
    description: frontmatterValue(frontmatter, "description") ?? "",
  }
}

function frontmatterValue(frontmatter: string, key: string): string | null {
  const match = new RegExp(`^${key}:\\s*(.+)$`, "m").exec(frontmatter)
  if (!match) return null
  return match[1]!.trim().replace(/^["']|["']$/g, "")
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

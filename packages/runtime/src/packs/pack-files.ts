import { existsSync } from "node:fs"
import { mkdir, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises"
import { basename, join } from "node:path"

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
export function existingSkillRoots(packPaths: string[]): string[] {
  return packPaths
    .map((packPath) => skillsDirectory(packPath))
    .filter((path) => existsSync(path))
}

export async function createPackDirectory(
  packsRoot: string,
  name: string
): Promise<string> {
  const slug = slugify(name)
  if (!slug)
    throw new RuntimeError("invalid-pack", "Pack name needs letters or digits")
  const path = join(packsRoot, slug)
  if (existsSync(path))
    throw new RuntimeError("pack-exists", "A pack folder with this name exists")

  await mkdir(skillsDirectory(path), { recursive: true })
  await writeFile(
    join(path, "pack.json"),
    `${JSON.stringify({ name }, null, 2)}\n`
  )
  return path
}

export async function validatePackDirectory(path: string): Promise<string> {
  let resolved: string
  try {
    resolved = await realpath(path)
  } catch {
    throw new RuntimeError("invalid-pack", "Pack folder does not exist")
  }
  if (!(await stat(resolved)).isDirectory())
    throw new RuntimeError("invalid-pack", "Pack path is not a folder")
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

  const skills: PackSkill[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const skill = await readSkill(join(root, entry.name), entry.name)
    if (skill) skills.push(skill)
  }
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

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

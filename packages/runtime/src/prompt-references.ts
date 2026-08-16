import { realpath, stat } from "node:fs/promises"
import { basename, isAbsolute, relative, resolve, sep } from "node:path"

import type { HarnessPromptReference } from "@deskto/harness-sdk"
import type { PromptReference } from "@deskto/protocol"

import { RuntimeError } from "./errors.js"
import { readResolvedPackSkills } from "./packs/pack-files.js"
import type { Store } from "./storage/store.js"

export async function resolvePromptReferences(
  store: Store,
  threadId: string,
  references: PromptReference[]
): Promise<HarnessPromptReference[]> {
  if (references.length === 0) return []
  const thread = store.threads.getRow(threadId)
  const project = store.projects.get(thread.project_id)
  const projectRoot = await realpath(project.path)
  const packs = store.packs.attachedToWorkspace(project.workspaceId)
  const resolvedSkills = (
    await Promise.all(packs.map((pack) => readResolvedPackSkills(pack)))
  ).flat()
  const skillsById = new Map(
    resolvedSkills.map((entry) => [entry.skill.id, entry] as const)
  )

  const resolved: HarnessPromptReference[] = []
  const seen = new Set<string>()
  const skillIdsByName = new Map<string, string>()
  for (const reference of references) {
    if (reference.kind === "skill") {
      const selectedSkillId = skillIdsByName.get(reference.name)
      if (selectedSkillId && selectedSkillId !== reference.skillId) {
        throw new RuntimeError(
          "invalid-prompt-reference",
          `Skill '${reference.name}' is selected from more than one Pack`
        )
      }
      skillIdsByName.set(reference.name, reference.skillId)
      const entry = skillsById.get(reference.skillId)
      if (!entry || entry.skill.name !== reference.name) {
        throw new RuntimeError(
          "invalid-prompt-reference",
          `Skill '${reference.name}' is not available in this workspace`
        )
      }
      const key = `skill:${entry.skill.id}`
      if (!seen.has(key)) {
        seen.add(key)
        resolved.push({
          kind: "skill",
          name: entry.skill.name,
          path: entry.path,
        })
      }
      continue
    }

    if (isAbsolute(reference.path)) {
      throw new RuntimeError(
        "invalid-prompt-reference",
        "Project references must use relative paths"
      )
    }
    let path: string
    try {
      path = await realpath(resolve(projectRoot, reference.path))
    } catch {
      throw new RuntimeError(
        "invalid-prompt-reference",
        `Project entry '${reference.path}' no longer exists`
      )
    }
    const fromRoot = relative(projectRoot, path)
    if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`)) {
      throw new RuntimeError(
        "invalid-prompt-reference",
        "Project references cannot leave the project folder"
      )
    }
    const metadata = await stat(path)
    if (!metadata.isDirectory() && !metadata.isFile()) {
      throw new RuntimeError(
        "invalid-prompt-reference",
        `Project entry '${reference.path}' is not a file or directory`
      )
    }
    const actualKind = metadata.isDirectory() ? "directory" : "file"
    if (actualKind !== reference.entryKind) {
      throw new RuntimeError(
        "invalid-prompt-reference",
        `Project entry '${reference.path}' changed type`
      )
    }
    const key = `project-entry:${fromRoot}`
    if (!seen.has(key)) {
      seen.add(key)
      resolved.push({
        kind: "project-entry",
        name: basename(path),
        path,
        entryKind: actualKind,
      })
    }
  }
  return resolved
}

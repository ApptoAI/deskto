import { lstat, realpath } from "node:fs/promises"
import { join, resolve } from "node:path"

import type {
  PromptSkill,
  SkillDetails,
  SkillInventory as SkillInventoryRecord,
  SkillLookupContext,
  SkillSource,
} from "@deskto/protocol"

import { openRegularFileWithinRoot } from "../safe-file-open.js"
import { refreshPackDigest } from "../packs/refresh-pack-digest.js"
import { RuntimeError } from "../errors.js"
import type { HarnessRegistry } from "../harness-registry.js"
import { packSkillId, skillsDirectory } from "../packs/pack-files.js"
import { canEditManagedSkills } from "../packs/pack-capabilities.js"
import type { Store } from "../storage/store.js"

import { commitSkillFile } from "./skill-file-commit.js"
import { skillSourceId } from "./skill-identifiers.js"
import {
  scanSkillNames,
  scanSkillSource,
  type ScannedSkill,
  type SkillSourceInput,
} from "./skill-scanner.js"

type SourceToScan = {
  source: SkillSourceInput
  missingIsDiagnostic: boolean
}

type InventoryScan = {
  inventory: SkillInventoryRecord
  skills: ScannedSkill[]
}

/** A referenceable skill plus the SKILL.md a harness is handed for it. */
export type ResolvedPromptSkill = {
  skill: PromptSkill
  path: string
}

export class SkillInventory {
  #mutationTail: Promise<void> = Promise.resolve()
  constructor(
    private readonly store: Store,
    private readonly harnesses: HarnessRegistry
  ) {}

  async listForProject(projectId: string): Promise<SkillInventoryRecord> {
    return (await this.#scanForProject(projectId)).inventory
  }

  async listForWorkspace(workspaceId: string): Promise<SkillInventoryRecord> {
    return (await this.#scanForWorkspace(workspaceId)).inventory
  }

  async listOnComputer(): Promise<SkillInventoryRecord> {
    return (await this.#scanOnComputer()).inventory
  }

  /**
   * Every skill a prompt in this project may reference, with the file each one
   * resolves to. Name-only scan: this runs when someone types `$`, and again
   * when the turn starts, so it never pays for digests it will not read.
   */
  async listForPrompt(projectId: string): Promise<ResolvedPromptSkill[]> {
    const project = this.store.projects.get(projectId)
    const sources = [
      ...(await this.#nativeSources(project.path, "all")),
      ...this.#packSources(project.workspaceId),
    ]
    const scanned = await Promise.all(
      uniqueById(sources).map(async ({ source }) => ({
        source,
        skills: await scanSkillNames(source),
      }))
    )
    const bySkillId = new Map<string, ResolvedPromptSkill>()
    for (const { source, skills } of scanned) {
      for (const skill of skills) {
        // Pack skills keep the id the Pack views already publish; a skill from
        // an agent's own folder is identified the way the inventory does.
        const id =
          source.packId !== undefined
            ? packSkillId(source.packId, skill.directoryName)
            : skill.id
        if (bySkillId.has(id)) continue
        bySkillId.set(id, {
          path: skill.skillFilePath,
          skill: {
            id,
            name: skill.name,
            description: skill.description,
            origin: source.kind,
            sourceLabel: source.label,
            harnessIds: source.harnessIds,
          },
        })
      }
    }
    // Sorted, because the composer offers the first few and counts the rest:
    // in source order every Pack skill would sit behind every skill found in
    // an agent's folder, and a workspace with four of those would bury them.
    return [...bySkillId.values()].sort((left, right) =>
      left.skill.name.localeCompare(right.skill.name)
    )
  }

  async get(
    occurrenceId: string,
    context?: SkillLookupContext
  ): Promise<SkillDetails> {
    const scan = context
      ? context.projectId !== undefined
        ? await this.#scanForProject(context.projectId)
        : await this.#scanForWorkspace(context.workspaceId)
      : await this.#scanOnComputer()
    const skill = scan.skills.find(
      ({ occurrence }) => occurrence.id === occurrenceId
    )
    if (!skill) {
      throw new RuntimeError(
        "skill-not-found",
        "Skill was not found in this inventory"
      )
    }
    return skill
  }

  async mutate(
    occurrenceId: string,
    expectedContent: string,
    change: { content: string } | { enabled: boolean },
    context?: SkillLookupContext
  ): Promise<SkillDetails> {
    const previous = this.#mutationTail
    let release = () => {}
    this.#mutationTail = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      const inventory =
        context?.projectId !== undefined
          ? await this.listForProject(context.projectId)
          : context?.workspaceId !== undefined
            ? await this.listForWorkspace(context.workspaceId)
            : await this.listOnComputer()
      const details = await this.get(occurrenceId, context)
      const source = inventory.sources.find(
        (candidate) => candidate.id === details.occurrence.sourceId
      )
      if (!source?.editable || source.scopes.includes("admin"))
        throw new RuntimeError(
          "skill-read-only",
          "This skill is managed externally. Open its folder to make changes."
        )
      const { occurrence } = details
      const root = await realpath(source.path)
      const directoryMetadata = await lstat(occurrence.directoryPath)
      if (directoryMetadata.isSymbolicLink())
        throw new RuntimeError(
          "skill-read-only",
          "Linked skill folders cannot be changed here."
        )
      const opened = await openRegularFileWithinRoot(
        occurrence.skillFilePath,
        root
      )
      try {
        if ((await opened.handle.readFile("utf8")) !== expectedContent)
          throw new RuntimeError(
            "skill-conflict",
            "This skill changed since you opened it. Close and reopen it before saving."
          )
      } finally {
        await opened.handle.close()
      }
      if ("content" in change) {
        if (Buffer.byteLength(change.content, "utf8") > 1024 * 1024)
          throw new RuntimeError(
            "invalid-skill",
            "Skill instructions must be smaller than 1 MB."
          )
        await commitSkillFile({
          path: occurrence.skillFilePath,
          root,
          expectedContent,
          content: change.content,
          identity: opened.metadata,
        })
      } else if (change.enabled !== (occurrence.enabled !== false)) {
        const destination = join(
          occurrence.resolvedDirectoryPath,
          change.enabled ? "SKILL.md" : "SKILL.md.disabled"
        )
        if (
          await lstat(destination).then(
            () => true,
            () => false
          )
        )
          throw new RuntimeError(
            "skill-conflict",
            "A skill file already exists at the destination. Open the folder to review both copies."
          )
        await commitSkillFile({
          path: occurrence.skillFilePath,
          destination,
          root,
          expectedContent,
          content: expectedContent,
          identity: opened.metadata,
        })
      }
      if (source.packId)
        await refreshPackDigest(
          this.store.packs,
          this.store.packs.get(source.packId)
        )
      return this.get(occurrenceId, context)
    } finally {
      release()
    }
  }

  async #scanForProject(projectId: string): Promise<InventoryScan> {
    const project = this.store.projects.get(projectId)
    const latestProvisioning = this.store.skillProvisioning.latestForProject(
      project.id
    )
    const native = await this.#nativeSources(project.path, "all")
    const packs = this.#packSources(project.workspaceId, latestProvisioning)
    return this.#scan(project.id, [...native, ...packs])
  }

  async #scanForWorkspace(workspaceId: string): Promise<InventoryScan> {
    this.store.workspaces.get(workspaceId)
    const native = await this.#nativeSources(null, "computer")
    return this.#scan(null, [...native, ...this.#packSources(workspaceId)])
  }

  async #scanOnComputer(): Promise<InventoryScan> {
    return this.#scan(null, await this.#nativeSources(null, "computer"))
  }

  async #nativeSources(
    projectPath: string | null,
    include: "all" | "computer"
  ): Promise<SourceToScan[]> {
    const declarations = await this.harnesses.discoverSkillRoots(projectPath)
    return Promise.all(
      declarations
        .filter(({ root }) => include === "all" || root.scope !== "project")
        .map(async ({ harnessId, root }) => {
          const physicalPath = await realpath(root.path).catch(() =>
            resolve(root.path)
          )
          return {
            source: {
              id: skillSourceId(["native", physicalPath]),
              kind: "native" as const,
              scopes: [root.scope],
              label: root.label,
              path: root.path,
              harnessIds: [harnessId],
              editable: root.scope !== "admin",
              provisioning: [],
            },
            missingIsDiagnostic: false,
          }
        })
    )
  }

  #packSources(
    workspaceId: string,
    provisioning: ReadonlyMap<string, SkillSource["provisioning"]> = new Map()
  ): SourceToScan[] {
    return this.store.packs
      .attachedToWorkspace(workspaceId)
      .map((pack): SourceToScan => {
        const path = skillsDirectory(pack.path)
        return {
          source: {
            id: pack.id,
            kind: "pack",
            scopes: ["workspace"],
            label: pack.name,
            path,
            harnessIds: this.harnesses.harnessIds(),
            packId: pack.id,
            packKind: pack.kind,
            editable: canEditManagedSkills(pack),
            provisioning: provisioning.get(pack.id) ?? [],
          },
          missingIsDiagnostic: true,
        }
      })
  }

  async #scan(
    projectId: string | null,
    requestedSources: SourceToScan[]
  ): Promise<InventoryScan> {
    const uniqueSources = uniqueById(requestedSources)
    const scanned = await Promise.all(
      uniqueSources.map(({ source, missingIsDiagnostic }) =>
        scanSkillSource(source, { missingIsDiagnostic })
      )
    )
    const sources = scanned
      .map(({ source }) => source)
      .filter((source): source is SkillSource => source !== null)
      .sort(compareSources)
    const skills = scanned.flatMap(({ skills }) => skills)
    return {
      inventory: {
        projectId,
        scannedAt: new Date().toISOString(),
        sources,
        occurrences: skills.map(({ occurrence }) => occurrence),
      },
      skills,
    }
  }
}

function uniqueById(sources: SourceToScan[]): SourceToScan[] {
  const unique = new Map<string, SourceToScan>()
  for (const entry of sources) {
    const existing = unique.get(entry.source.id)
    if (!existing) {
      unique.set(entry.source.id, entry)
      continue
    }
    const harnessIds = [
      ...new Set([...existing.source.harnessIds, ...entry.source.harnessIds]),
    ].sort()
    const scopes = [
      ...new Set([...existing.source.scopes, ...entry.source.scopes]),
    ].sort()
    unique.set(entry.source.id, {
      source: {
        ...existing.source,
        label:
          existing.source.label === entry.source.label
            ? existing.source.label
            : sharedSourceLabel(scopes),
        harnessIds,
        scopes,
        editable: existing.source.editable && entry.source.editable,
      },
      missingIsDiagnostic:
        existing.missingIsDiagnostic || entry.missingIsDiagnostic,
    })
  }
  return [...unique.values()]
}

function sharedSourceLabel(scopes: SkillSource["scopes"]): string {
  if (scopes.length > 1) return "Skills with multiple scopes"
  if (scopes[0] === "project") return "Shared project skills"
  if (scopes[0] === "user") return "Shared personal skills"
  if (scopes[0] === "admin") return "Shared administrator skills"
  return "Shared workspace skills"
}

function compareSources(left: SkillSource, right: SkillSource): number {
  return (
    left.scopes.join(",").localeCompare(right.scopes.join(",")) ||
    left.label.localeCompare(right.label) ||
    left.path.localeCompare(right.path)
  )
}

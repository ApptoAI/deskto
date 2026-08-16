import { realpath } from "node:fs/promises"
import { resolve } from "node:path"

import type {
  SkillDetails,
  SkillInventory as SkillInventoryRecord,
  SkillSource,
} from "@deskto/protocol"

import { RuntimeError } from "../errors.js"
import type { HarnessRegistry } from "../harness-registry.js"
import { skillsDirectory } from "../packs/pack-files.js"
import { canEditManagedSkills } from "../packs/pack-capabilities.js"
import type { Store } from "../storage/store.js"

import { skillSourceId } from "./skill-identifiers.js"
import {
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

export class SkillInventory {
  constructor(
    private readonly store: Store,
    private readonly harnesses: HarnessRegistry
  ) {}

  async listForProject(projectId: string): Promise<SkillInventoryRecord> {
    return (await this.#scanForProject(projectId)).inventory
  }

  async listOnComputer(): Promise<SkillInventoryRecord> {
    return (await this.#scanOnComputer()).inventory
  }

  async get(occurrenceId: string, projectId?: string): Promise<SkillDetails> {
    const scan = projectId
      ? await this.#scanForProject(projectId)
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

  async #scanForProject(projectId: string): Promise<InventoryScan> {
    const project = this.store.projects.get(projectId)
    const latestProvisioning = this.store.skillProvisioning.latestForProject(
      project.id
    )
    const native = await this.#nativeSources(project.path, "all")
    const packs = this.store.packs
      .attachedToWorkspace(project.workspaceId)
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
            provisioning: latestProvisioning.get(pack.id) ?? [],
          },
          missingIsDiagnostic: true,
        }
      })
    return this.#scan(project.id, [...native, ...packs])
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
              editable: false,
              provisioning: [],
            },
            missingIsDiagnostic: false,
          }
        })
    )
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

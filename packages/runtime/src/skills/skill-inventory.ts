import type {
  SkillDetails,
  SkillInventory as SkillInventoryRecord,
  SkillSource,
} from "@deskto/protocol"

import { RuntimeError } from "../errors.js"
import type { HarnessRegistry } from "../harness-registry.js"
import { skillsDirectory } from "../packs/pack-files.js"
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
            id: skillSourceId(["pack", pack.id, path]),
            kind: "pack",
            scope: "workspace",
            label: pack.name,
            path,
            harnessIds: this.harnesses.harnessIds(),
            packId: pack.id,
            packKind: pack.kind,
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
    return declarations
      .filter(({ root }) => include === "all" || root.scope !== "project")
      .map(({ harnessId, root }) => ({
        source: {
          id: skillSourceId(["native", harnessId, root.scope, root.path]),
          kind: "native" as const,
          scope: root.scope,
          label: root.label,
          path: root.path,
          harnessIds: [harnessId],
          provisioning: [],
        },
        missingIsDiagnostic: false,
      }))
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
  for (const entry of sources) unique.set(entry.source.id, entry)
  return [...unique.values()]
}

function compareSources(left: SkillSource, right: SkillSource): number {
  return (
    left.scope.localeCompare(right.scope) ||
    left.label.localeCompare(right.label) ||
    left.path.localeCompare(right.path)
  )
}

import {
  lastProfileSchema,
  selectionSchema,
  type ExecutionProfile,
  type RequestFor,
  type RuntimeMethod,
  type RuntimeRequest,
  type RuntimeResponse,
  type RuntimeResponses,
  type Selection,
} from "@deskto/protocol"

import { RuntimeError, runtimeErrorMessageSchema } from "./errors.js"
import type { HarnessRegistry } from "./harness-registry.js"
import { readPackContents, resolvedDirectory } from "./packs/pack-files.js"
import { canEditManagedSkills } from "./packs/pack-capabilities.js"
import type { PackManager } from "./packs/pack-manager.js"
import { ProjectEntries } from "./project-entries.js"
import { SkillInventory } from "./skills/skill-inventory.js"
import { toPackRecord, type PackRow } from "./storage/records.js"
import type { Store } from "./storage/store.js"
import type { WorkspacePatch } from "./storage/workspaces.js"
import type { TurnCoordinator } from "./turn-coordinator.js"
import type { UserSettings } from "./user-settings.js"

// A migration moved the pre-workspace value under the personal workspace.
const selectionSettingKey = "ui.selection"

function lastProfileKeyFor(workspaceId: string): string {
  return `preferences.lastProfile.${workspaceId}`
}

export type RouterEvents = {
  /** The workspace or project lists changed; open views should refetch. */
  workspaceChanged: () => void
  /** The pack list or a workspace's attachments changed. */
  packChanged: () => void
  /** A thread's organization fields changed outside a turn. */
  threadChanged: (threadId: string) => void
  /** A thread was deleted; views holding it have nothing to reload. */
  threadDeleted: (threadId: string) => void
  /** A result was written from the Surface; result lists are stale. */
  artifactsChanged: (threadId: string) => void
}

export class RequestRouter {
  readonly #projectEntries = new ProjectEntries()
  readonly #skillInventory: SkillInventory

  constructor(
    private readonly store: Store,
    private readonly harnesses: HarnessRegistry,
    private readonly turns: TurnCoordinator,
    private readonly userSettings: UserSettings,
    private readonly packManager: PackManager,
    private readonly events: RouterEvents
  ) {
    this.#skillInventory = new SkillInventory(store, harnesses)
  }

  async request<M extends RuntimeMethod>(
    request: RequestFor<M>
  ): Promise<RuntimeResponse<M>> {
    try {
      const data = await this.#dispatch(request)
      // SAFETY: #dispatch switches on request.method and returns the matching
      // RuntimeResponses member for every RuntimeMethod branch.
      return { ok: true, data } as RuntimeResponse<M>
    } catch (error) {
      return {
        ok: false,
        error: {
          code: error instanceof RuntimeError ? error.code : "runtime-error",
          message: runtimeErrorMessageSchema.parse(error),
        },
      }
    }
  }

  async #dispatch(
    request: RuntimeRequest
  ): Promise<RuntimeResponses[RuntimeMethod]> {
    switch (request.method) {
      case "harness.list":
        return this.harnesses.list()
      case "harness.setEnabled":
        return this.harnesses.setEnabled(
          request.params.harnessId,
          request.params.enabled
        )
      case "harness.refresh":
        return this.harnesses.refresh()
      case "preferences.get": {
        const stored = lastProfileSchema.safeParse(
          this.store.settings.get(lastProfileKeyFor(request.params.workspaceId))
        )
        return { lastProfile: stored.success ? stored.data : null }
      }
      case "settings.get":
        return this.userSettings.snapshot()
      case "settings.update":
        return this.userSettings.update(request.params.entries)
      case "workspace.list":
        return this.store.workspaces.list()
      case "workspace.create": {
        const workspace = this.store.workspaces.create(
          requiredName(request.params.name),
          request.params.color,
          request.params.icon
        )
        this.events.workspaceChanged()
        return workspace
      }
      case "workspace.update": {
        const patch: WorkspacePatch = {}
        if (request.params.name !== undefined) {
          patch.name = requiredName(request.params.name)
        }
        if (request.params.color !== undefined) {
          patch.color = request.params.color
        }
        if (request.params.icon !== undefined) {
          patch.icon = request.params.icon
        }
        const workspace = this.store.workspaces.update(
          request.params.workspaceId,
          patch
        )
        this.events.workspaceChanged()
        return workspace
      }
      case "workspace.delete": {
        this.store.workspaces.delete(request.params.workspaceId)
        this.#forgetSelection(request.params.workspaceId)
        this.store.settings.delete(
          lastProfileKeyFor(request.params.workspaceId)
        )
        this.events.workspaceChanged()
        // The FK cascade also detached the workspace's packs.
        this.events.packChanged()
        return null
      }
      case "selection.get":
        return this.#selection()
      case "selection.set": {
        this.store.workspaces.get(request.params.workspaceId)
        if (request.params.projectId) {
          const project = this.store.projects.get(request.params.projectId)
          if (project.workspaceId !== request.params.workspaceId)
            throw new RuntimeError(
              "invalid-selection",
              "Project does not belong to workspace"
            )
        }
        const current = this.#selection()
        const next: Selection = {
          lastWorkspaceId: request.params.workspaceId,
          lastProjectIds: request.params.projectId
            ? {
                ...current.lastProjectIds,
                [request.params.workspaceId]: request.params.projectId,
              }
            : current.lastProjectIds,
        }
        this.store.settings.set(selectionSettingKey, next)
        return next
      }
      case "pack.list":
        return this.#packViews()
      case "pack.create": {
        const row = await this.packManager.create(request.params.name)
        this.events.packChanged()
        return this.#packView(row)
      }
      case "pack.install": {
        const row =
          request.params.source.kind === "zip"
            ? await this.packManager.installZip(request.params.source.path)
            : await this.packManager.installFolder(request.params.source.path)
        this.events.packChanged()
        return this.#packView(row)
      }
      case "pack.link": {
        const row = await this.packManager.link(request.params.path)
        this.events.packChanged()
        return this.#packView(row)
      }
      case "pack.unlink": {
        this.packManager.unlink(request.params.packId)
        this.events.packChanged()
        return null
      }
      case "pack.uninstall": {
        await this.packManager.uninstall(request.params.packId)
        this.events.packChanged()
        return null
      }
      case "workspace.setPack": {
        this.store.packs.setAttached(
          request.params.workspaceId,
          request.params.packId,
          request.params.attached
        )
        this.events.packChanged()
        return null
      }
      case "skill.listForPrompt":
        return (
          await this.#skillInventory.listForPrompt(request.params.projectId)
        ).map(({ skill }) => skill)
      case "skill.listForProject":
        return this.#skillInventory.listForProject(request.params.projectId)
      case "skill.listForWorkspace":
        return this.#skillInventory.listForWorkspace(request.params.workspaceId)
      case "skill.listOnComputer":
        return this.#skillInventory.listOnComputer()
      case "skill.get": {
        const context =
          "projectId" in request.params
            ? { projectId: request.params.projectId }
            : "workspaceId" in request.params
              ? { workspaceId: request.params.workspaceId }
              : undefined
        return this.#skillInventory.get(request.params.occurrenceId, context)
      }
      case "skill.createManaged": {
        const skill = await this.packManager.createSkill(
          request.params.packId,
          request.params
        )
        this.events.packChanged()
        return skill
      }
      case "skill.updateManaged": {
        const skill = await this.packManager.updateSkill(
          request.params.packId,
          request.params.directoryName,
          request.params
        )
        this.events.packChanged()
        return skill
      }
      case "project.list":
        return this.store.projects.list()
      case "project.add": {
        const path = await validDirectory(request.params.path)
        const project = this.store.projects.add(
          path,
          requiredName(request.params.name),
          request.params.workspaceId
        )
        this.events.workspaceChanged()
        return project
      }
      case "project.move": {
        const project = this.store.projects.move(
          request.params.projectId,
          request.params.workspaceId
        )
        this.events.workspaceChanged()
        return project
      }
      case "project.searchEntries": {
        const project = this.store.projects.get(request.params.projectId)
        return this.#projectEntries.search(
          project.path,
          request.params.query,
          request.params.limit
        )
      }
      case "thread.list":
        return this.store.threads.list(request.params.projectId)
      case "thread.create": {
        const profile = await this.harnesses.resolveProfile(
          request.params.harnessId,
          request.params.executionProfile
        )
        const project = this.store.projects.get(request.params.projectId)
        this.#rememberProfile(
          project.workspaceId,
          request.params.harnessId,
          profile
        )
        const thread = this.store.threads.create(
          request.params.projectId,
          request.params.harnessId,
          profile,
          {
            parentThreadId: request.params.parentThreadId,
            title: request.params.title,
          }
        )
        if (thread.parentThreadId) {
          this.events.threadChanged(thread.parentThreadId)
        }
        return thread
      }
      case "thread.search":
        return this.store.threads.search(
          request.params.originThreadId,
          request.params.query,
          request.params.scope,
          request.params.limit
        )
      case "thread.configure": {
        const thread = this.store.threads.getRow(request.params.threadId)
        const executionProfile = await this.harnesses.resolveProfile(
          thread.harness_id,
          request.params.executionProfile
        )
        const project = this.store.projects.get(thread.project_id)
        this.#rememberProfile(
          project.workspaceId,
          thread.harness_id,
          executionProfile
        )
        return this.store.threads.configure(thread.id, executionProfile)
      }
      case "thread.get":
        return this.store.threads.view(request.params.threadId)
      case "thread.setDone": {
        const thread = this.store.threads.setDone(
          request.params.threadId,
          request.params.done
        )
        this.events.threadChanged(thread.id)
        return thread
      }
      case "thread.snooze": {
        const thread = this.store.threads.snooze(
          request.params.threadId,
          request.params.until
        )
        this.events.threadChanged(thread.id)
        return thread
      }
      case "thread.wake": {
        const thread = this.store.threads.wake(request.params.threadId)
        this.events.threadChanged(thread.id)
        return thread
      }
      case "thread.setPinned": {
        const thread = this.store.threads.setPinned(
          request.params.threadId,
          request.params.pinned
        )
        this.events.threadChanged(thread.id)
        return thread
      }
      case "thread.markVisited": {
        const thread = this.store.threads.markVisited(request.params.threadId)
        this.events.threadChanged(thread.id)
        return thread
      }
      case "thread.delete": {
        const threadId = request.params.threadId
        // Fail on a missing id before anything else runs.
        const parentThreadId = this.store.threads.parentId(threadId)
        const descendantIds = this.store.threads.descendantIds(threadId)
        // A live turn would keep writing into rows that are about to vanish.
        for (const descendantId of descendantIds) {
          await this.turns.discard(descendantId)
        }
        await this.turns.discard(threadId)
        this.store.threads.delete(threadId)
        for (const descendantId of descendantIds) {
          this.events.threadDeleted(descendantId)
        }
        this.events.threadDeleted(threadId)
        if (parentThreadId) this.events.threadChanged(parentThreadId)
        return null
      }
      case "artifact.list":
        return this.store.artifacts.listForThread(request.params.threadId)
      case "artifact.listOutputs":
        return this.store.artifacts.listOutputsForThread(
          request.params.threadId
        )
      case "artifact.preview":
        return this.store.artifacts.preview(
          request.params.threadId,
          request.params.artifactId
        )
      case "attachment.preview":
        return this.store.threads.previewAttachment(
          request.params.threadId,
          request.params.attachmentId
        )
      case "artifact.locate":
        return this.store.artifacts.locate(
          request.params.threadId,
          request.params.artifactId
        )
      case "artifact.write": {
        const artifact = this.store.artifacts.write(
          request.params.threadId,
          request.params.artifactId,
          request.params.content,
          request.params.baseUpdatedAt
        )
        this.events.artifactsChanged(request.params.threadId)
        return artifact
      }
      case "turn.start":
        return this.turns.start(
          request.params.threadId,
          request.params.input ?? {
            text: request.params.prompt!,
            references: [],
            attachments: [],
          }
        )
      case "turn.cancel":
        return this.turns.cancel(request.params.threadId)
      case "approval.resolve":
        return this.turns.resolveApproval(
          request.params.threadId,
          request.params.approvalId,
          request.params.decision
        )
    }
  }

  /** New threads start from the profile the user last used in this workspace. */
  #rememberProfile(
    workspaceId: string,
    harnessId: string,
    executionProfile: ExecutionProfile
  ) {
    this.store.settings.set(lastProfileKeyFor(workspaceId), {
      harnessId,
      executionProfile,
    })
  }

  async #packView(row: PackRow, workspaceIds?: string[]) {
    const contents = await readPackContents(row)
    return {
      ...toPackRecord(row),
      canEditSkills: canEditManagedSkills(row),
      skills: contents.resolvedSkills.map(({ skill }) => skill),
      occurrences: contents.occurrences,
      workspaceIds: workspaceIds ?? this.store.packs.workspaceIdsFor(row.id),
    }
  }

  #packViews() {
    const attachments = this.store.packs.attachedWorkspaceIds()
    return Promise.all(
      this.store.packs
        .list()
        .map((row) => this.#packView(row, attachments.get(row.id) ?? []))
    )
  }

  #selection(): Selection {
    const stored = selectionSchema.safeParse(
      this.store.settings.get(selectionSettingKey)
    )
    return stored.success
      ? stored.data
      : { lastWorkspaceId: null, lastProjectIds: {} }
  }

  #forgetSelection(workspaceId: string) {
    const current = this.#selection()
    const lastProjectIds = { ...current.lastProjectIds }
    delete lastProjectIds[workspaceId]
    this.store.settings.set(selectionSettingKey, {
      lastWorkspaceId:
        current.lastWorkspaceId === workspaceId
          ? null
          : current.lastWorkspaceId,
      lastProjectIds,
    })
  }
}

function requiredName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) throw new RuntimeError("invalid-name", "A name is required")
  return trimmed
}

function validDirectory(path: string): Promise<string> {
  return resolvedDirectory(path, {
    code: "invalid-project",
    missing: "Project folder does not exist",
    notFolder: "Project path is not a folder",
  })
}

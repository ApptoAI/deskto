import { realpath, stat } from "node:fs/promises"

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
} from "@openappto/protocol"

import { RuntimeError, errorMessage } from "./errors.js"
import type { HarnessRegistry } from "./harness-registry.js"
import type { Store } from "./storage/store.js"
import type { TurnCoordinator } from "./turn-coordinator.js"
import type { UserSettings } from "./user-settings.js"

// The un-suffixed key is the pre-workspace value and still serves as fallback.
const lastProfileSettingKey = "preferences.lastProfile"
const selectionSettingKey = "ui.selection"

function lastProfileKeyFor(workspaceId: string): string {
  return `${lastProfileSettingKey}.${workspaceId}`
}

export type RouterEvents = {
  /** The workspace or project lists changed; open views should refetch. */
  workspaceChanged: () => void
}

export class RequestRouter {
  constructor(
    private readonly store: Store,
    private readonly harnesses: HarnessRegistry,
    private readonly turns: TurnCoordinator,
    private readonly userSettings: UserSettings,
    private readonly events: RouterEvents
  ) {}

  async request<M extends RuntimeMethod>(
    request: RequestFor<M>
  ): Promise<RuntimeResponse<M>> {
    try {
      const data = await this.#dispatch(request)
      return { ok: true, data } as RuntimeResponse<M>
    } catch (error) {
      return {
        ok: false,
        error: {
          code: error instanceof RuntimeError ? error.code : "runtime-error",
          message: errorMessage(error),
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
        const scoped = lastProfileSchema.safeParse(
          this.store.settings.get(
            lastProfileKeyFor(request.params.workspaceId)
          )
        )
        if (scoped.success) return { lastProfile: scoped.data }
        const legacy = lastProfileSchema.safeParse(
          this.store.settings.get(lastProfileSettingKey)
        )
        return { lastProfile: legacy.success ? legacy.data : null }
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
        const workspace = this.store.workspaces.update(
          request.params.workspaceId,
          {
            ...(request.params.name === undefined
              ? {}
              : { name: requiredName(request.params.name) }),
            ...(request.params.color === undefined
              ? {}
              : { color: request.params.color }),
            ...(request.params.icon === undefined
              ? {}
              : { icon: request.params.icon }),
          }
        )
        this.events.workspaceChanged()
        return workspace
      }
      case "workspace.delete": {
        const remaining = this.store.workspaces.delete(
          request.params.workspaceId
        )
        this.#forgetSelection(request.params.workspaceId)
        this.events.workspaceChanged()
        return remaining
      }
      case "selection.get":
        return this.#selection()
      case "selection.set": {
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
        return this.store.threads.create(
          request.params.projectId,
          request.params.harnessId,
          profile
        )
      }
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
      case "turn.start":
        return this.turns.start(request.params.threadId, request.params.prompt)
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

async function validDirectory(path: string): Promise<string> {
  let resolved: string
  try {
    resolved = await realpath(path)
  } catch {
    throw new RuntimeError("invalid-project", "Project folder does not exist")
  }

  if (!(await stat(resolved)).isDirectory()) {
    throw new RuntimeError("invalid-project", "Project path is not a folder")
  }
  return resolved
}

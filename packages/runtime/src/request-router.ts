import { realpath, stat } from "node:fs/promises"

import {
  lastProfileSchema,
  type ExecutionProfile,
  type RequestFor,
  type RuntimeMethod,
  type RuntimeRequest,
  type RuntimeResponse,
  type RuntimeResponses,
} from "@openappto/protocol"

import { RuntimeError, errorMessage } from "./errors.js"
import type { HarnessRegistry } from "./harness-registry.js"
import type { Store } from "./storage/store.js"
import type { TurnCoordinator } from "./turn-coordinator.js"
import type { UserSettings } from "./user-settings.js"

const lastProfileSettingKey = "preferences.lastProfile"

export class RequestRouter {
  constructor(
    private readonly store: Store,
    private readonly harnesses: HarnessRegistry,
    private readonly turns: TurnCoordinator,
    private readonly userSettings: UserSettings
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
        const stored = lastProfileSchema.safeParse(
          this.store.settings.get(lastProfileSettingKey)
        )
        return { lastProfile: stored.success ? stored.data : null }
      }
      case "settings.get":
        return this.userSettings.snapshot()
      case "settings.update":
        return this.userSettings.update(request.params.entries)
      case "workspace.list":
        return this.store.workspaces.list()
      case "workspace.add": {
        const path = await validDirectory(request.params.path)
        const name = request.params.name.trim()
        if (!name)
          throw new RuntimeError(
            "invalid-workspace",
            "Project name is required"
          )
        return this.store.workspaces.add(path, name)
      }
      case "thread.list":
        return this.store.threads.list(request.params.workspaceId)
      case "thread.create": {
        const profile = await this.harnesses.resolveProfile(
          request.params.harnessId,
          request.params.executionProfile
        )
        this.#rememberProfile(request.params.harnessId, profile)
        return this.store.threads.create(
          request.params.workspaceId,
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
        this.#rememberProfile(thread.harness_id, executionProfile)
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

  /** New threads start from the profile the user last used. */
  #rememberProfile(harnessId: string, executionProfile: ExecutionProfile) {
    this.store.settings.set(lastProfileSettingKey, {
      harnessId,
      executionProfile,
    })
  }
}

async function validDirectory(path: string): Promise<string> {
  let resolved: string
  try {
    resolved = await realpath(path)
  } catch {
    throw new RuntimeError("invalid-workspace", "Project folder does not exist")
  }

  if (!(await stat(resolved)).isDirectory()) {
    throw new RuntimeError("invalid-workspace", "Project path is not a folder")
  }
  return resolved
}

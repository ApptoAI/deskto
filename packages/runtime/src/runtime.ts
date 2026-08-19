import { dirname, join, resolve } from "node:path"

import type { HarnessAdapterFactory } from "@deskto/harness-sdk"
import type {
  RequestFor,
  RuntimeEvent,
  RuntimeMethod,
  RuntimeResponse,
  RuntimeTransport,
} from "@deskto/protocol"

import { HarnessRegistry } from "./harness-registry.js"
import { PackManager } from "./packs/pack-manager.js"
import { ProjectActivityGate } from "./project-activity-gate.js"
import { ProjectManager } from "./project-manager.js"
import { RequestRouter } from "./request-router.js"
import type { SessionToolProvider } from "./session-tools.js"
import { openDatabase } from "./storage/database.js"
import { Store } from "./storage/store.js"
import { ThreadSequences } from "./thread-sequences.js"
import { TurnCoordinator } from "./turn-coordinator.js"
import { UserSettings } from "./user-settings.js"

export type RuntimeOptions = {
  databasePath: string
  /** Where app-created Packs live. Defaults to a packs folder next to the database. */
  packsPath?: string
  /** Where app-created Project folders live. Defaults beside the database. */
  projectsPath?: string
  harnesses: HarnessAdapterFactory[]
  /** How often harness health is re-checked. Pass 0 to turn the loop off. */
  harnessRefreshMs?: number
  /** Harness probes wait for this, e.g. until the host rebuilt PATH. */
  probeGate?: Promise<void>
  /** Host-owned recoverable file deletion, implemented by Electron on desktop. */
  fileActions?: HostFileActions
  /** App-owned MCP tools leased separately for every Turn. */
  sessionTools?: SessionToolProvider[]
}

export type HostFileActions = {
  trashItem(path: string): Promise<void>
}

const defaultHarnessRefreshMs = 5 * 60_000

export class Runtime implements RuntimeTransport {
  readonly #listeners = new Set<(event: RuntimeEvent) => void>()
  readonly #store: Store
  readonly #harnesses: HarnessRegistry
  readonly #turns: TurnCoordinator
  readonly #router: RequestRouter

  constructor(options: RuntimeOptions) {
    const sequences = new ThreadSequences()
    const packsRoot = resolve(
      options.packsPath ?? join(dirname(options.databasePath), "packs")
    )
    const projectsRoot = resolve(
      options.projectsPath ?? join(dirname(options.databasePath), "projects")
    )
    this.#store = new Store(openDatabase(options.databasePath), sequences)
    const projectActivity = new ProjectActivityGate()
    let packManager: PackManager
    let projectManager: ProjectManager
    try {
      packManager = new PackManager(
        this.#store.packs,
        packsRoot,
        options.fileActions
      )
      projectManager = new ProjectManager(
        this.#store.projects,
        packManager,
        projectsRoot,
        projectActivity
      )
    } catch (error) {
      try {
        this.#store.close()
      } catch {
        // Preserve the Pack root preparation error.
      }
      throw error
    }
    this.#store.recoverInterrupted()
    const userSettings = new UserSettings(this.#store.settings, () =>
      this.#emit({ type: "settings.changed" })
    )
    this.#harnesses = new HarnessRegistry(
      options.harnesses,
      this.#store.settings,
      {
        onChanged: () => this.#emit({ type: "harness.changed" }),
        probeGate: options.probeGate,
      }
    )
    const refreshMs = options.harnessRefreshMs ?? defaultHarnessRefreshMs
    if (refreshMs > 0) this.#harnesses.startAutoRefresh(refreshMs)
    this.#turns = new TurnCoordinator(
      this.#store,
      this.#harnesses,
      userSettings,
      options.sessionTools ?? [],
      projectActivity,
      {
        changed: (threadId) => this.#emitThreadChanged(threadId),
        delta: (threadId, change) => {
          this.#emit({
            type: "thread.delta",
            threadId,
            seq: sequences.next(threadId),
            change,
          })
          if (change.type === "thread.updated") {
            this.#emitParentThreadChanged(threadId)
          }
        },
        artifactsChanged: (threadId) =>
          this.#emit({ type: "artifact.changed", threadId }),
      }
    )
    this.#router = new RequestRouter(
      this.#store,
      this.#harnesses,
      this.#turns,
      userSettings,
      packManager,
      projectManager,
      {
        workspaceChanged: () => this.#emit({ type: "workspace.changed" }),
        packChanged: () => this.#emit({ type: "pack.changed" }),
        threadChanged: (threadId) => this.#emitThreadChanged(threadId),
        threadDeleted: (threadId) =>
          this.#emit({ type: "thread.deleted", threadId }),
        artifactsChanged: (threadId) =>
          this.#emit({ type: "artifact.changed", threadId }),
      }
    )
  }

  request<M extends RuntimeMethod>(
    request: RequestFor<M>
  ): Promise<RuntimeResponse<M>> {
    return this.#router.request(request)
  }

  subscribe(listener: (event: RuntimeEvent) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  async close(): Promise<void> {
    this.#harnesses.dispose()
    await this.#turns.dispose()
    this.#listeners.clear()
    this.#store.close()
  }

  #emit(event: RuntimeEvent): void {
    for (const listener of this.#listeners) {
      try {
        listener(event)
      } catch {
        continue
      }
    }
  }

  #emitThreadChanged(threadId: string): void {
    this.#emit({ type: "thread.changed", threadId })
    this.#emitParentThreadChanged(threadId)
  }

  #emitParentThreadChanged(threadId: string): void {
    try {
      const parentThreadId = this.#store.threads.parentId(threadId)
      if (parentThreadId) {
        this.#emit({ type: "thread.changed", threadId: parentThreadId })
      }
    } catch {
      // A delete announces its own lifecycle and resolves the parent first.
    }
  }
}

export function createRuntime(options: RuntimeOptions): Runtime {
  return new Runtime(options)
}

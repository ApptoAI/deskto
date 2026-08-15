import { dirname, join } from "node:path"

import type { HarnessAdapterFactory } from "@openappto/harness-sdk"
import type {
  RequestFor,
  RuntimeEvent,
  RuntimeMethod,
  RuntimeResponse,
  RuntimeTransport,
} from "@openappto/protocol"

import { HarnessRegistry } from "./harness-registry.js"
import { RequestRouter } from "./request-router.js"
import { openDatabase } from "./storage/database.js"
import { Store } from "./storage/store.js"
import { ThreadSequences } from "./thread-sequences.js"
import { TurnCoordinator } from "./turn-coordinator.js"
import { UserSettings } from "./user-settings.js"

export type RuntimeOptions = {
  databasePath: string
  /** Where app-created Packs live. Defaults to a packs folder next to the database. */
  packsPath?: string
  harnesses: HarnessAdapterFactory[]
  /** How often harness health is re-checked. Pass 0 to turn the loop off. */
  harnessRefreshMs?: number
  /** Harness probes wait for this, e.g. until the host rebuilt PATH. */
  probeGate?: Promise<void>
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
    this.#store = new Store(openDatabase(options.databasePath), sequences)
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
      {
        changed: (threadId) => this.#emit({ type: "thread.changed", threadId }),
        delta: (threadId, change) =>
          this.#emit({
            type: "thread.delta",
            threadId,
            seq: sequences.next(threadId),
            change,
          }),
        artifactsChanged: (threadId) =>
          this.#emit({ type: "artifact.changed", threadId }),
      }
    )
    this.#router = new RequestRouter(
      this.#store,
      this.#harnesses,
      this.#turns,
      userSettings,
      options.packsPath ?? join(dirname(options.databasePath), "packs"),
      {
        workspaceChanged: () => this.#emit({ type: "workspace.changed" }),
        packChanged: () => this.#emit({ type: "pack.changed" }),
        threadChanged: (threadId) =>
          this.#emit({ type: "thread.changed", threadId }),
        threadDeleted: (threadId) =>
          this.#emit({ type: "thread.deleted", threadId }),
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
}

export function createRuntime(options: RuntimeOptions): Runtime {
  return new Runtime(options)
}

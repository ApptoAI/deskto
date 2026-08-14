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
import { TurnCoordinator } from "./turn-coordinator.js"

export type RuntimeOptions = {
  databasePath: string
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
    this.#store = new Store(openDatabase(options.databasePath))
    this.#store.recoverInterrupted()
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
      (threadId) => this.#emit({ type: "thread.changed", threadId })
    )
    this.#router = new RequestRouter(this.#store, this.#harnesses, this.#turns)
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

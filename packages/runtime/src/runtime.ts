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
}

export class Runtime implements RuntimeTransport {
  readonly #listeners = new Set<(event: RuntimeEvent) => void>()
  readonly #store: Store
  readonly #turns: TurnCoordinator
  readonly #router: RequestRouter

  constructor(options: RuntimeOptions) {
    this.#store = new Store(openDatabase(options.databasePath))
    this.#store.recoverInterrupted()
    const harnesses = new HarnessRegistry(options.harnesses)
    this.#turns = new TurnCoordinator(this.#store, harnesses, (threadId) =>
      this.#emit({ type: "thread.changed", threadId })
    )
    this.#router = new RequestRouter(this.#store, harnesses, this.#turns)
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

import type {
  ExecutionProfile,
  HarnessAdapterFactory,
  HarnessAvailability,
  HarnessModelOption,
} from "@openappto/harness-sdk"
import type { Harness } from "@openappto/protocol"

import { RuntimeError, errorMessage } from "./errors.js"
import type { Settings } from "./storage/settings.js"

const enabledSettingKey = "harness.enabled"

// How long a probe result stays trusted. Reads within this window reuse it;
// older results are re-checked on the next read.
const probeFreshnessMs = 30_000

// A CLI that never answers must not wedge every later read behind its probe.
const availabilityTimeoutMs = 10_000
const modelListTimeoutMs = 30_000

type Probe = {
  availability: HarnessAvailability
  models: HarnessModelOption[]
  checkedAt: string
}

type Entry = {
  factory: HarnessAdapterFactory
  enabled: boolean
  probe: Probe | null
  probing: Promise<Probe> | null
}

export type HarnessRegistryOptions = {
  /** Called when harness state changed outside a caller's own request. */
  onChanged?: () => void
  /** Probes wait for this before spawning a CLI, e.g. until PATH is rebuilt. */
  probeGate?: Promise<void>
}

/**
 * The one place harnesses plug into. Owns which harnesses exist, whether the
 * user keeps them on, and the last known health of each. Everything else reads
 * harness state from here instead of talking to adapters directly.
 */
export class HarnessRegistry {
  readonly #entries = new Map<string, Entry>()
  readonly #settings: Settings
  readonly #onChanged: () => void
  readonly #probeGate: Promise<void>
  #refreshTimer: NodeJS.Timeout | null = null

  constructor(
    factories: HarnessAdapterFactory[],
    settings: Settings,
    options: HarnessRegistryOptions = {}
  ) {
    this.#settings = settings
    this.#onChanged = options.onChanged ?? (() => {})
    this.#probeGate = (options.probeGate ?? Promise.resolve()).catch(() => {})
    const enabled =
      settings.get<Record<string, boolean>>(enabledSettingKey) ?? {}
    for (const factory of factories) {
      if (this.#entries.has(factory.descriptor.id)) {
        throw new RuntimeError(
          "duplicate-harness",
          `Harness '${factory.descriptor.id}' is registered more than once`
        )
      }
      this.#entries.set(factory.descriptor.id, {
        factory,
        enabled: enabled[factory.descriptor.id] ?? true,
        probe: null,
        probing: null,
      })
    }
  }

  get(id: string): HarnessAdapterFactory {
    return this.#entry(id).factory
  }

  /** Health snapshot of every harness, re-checking the ones gone stale. */
  async list(): Promise<Harness[]> {
    await Promise.all(
      [...this.#entries.values()]
        .filter((entry) => entry.enabled && this.#isStale(entry))
        .map((entry) => this.#probe(entry))
    )
    return this.#snapshot()
  }

  /** Force-checks every enabled harness; reports when anything moved. */
  async refresh(): Promise<Harness[]> {
    const before = comparable(this.#snapshot())
    await Promise.all(
      [...this.#entries.values()]
        .filter((entry) => entry.enabled)
        .map((entry) => this.#probe(entry, { force: true }))
    )
    const after = this.#snapshot()
    if (comparable(after) !== before) this.#onChanged()
    return after
  }

  async setEnabled(id: string, enabled: boolean): Promise<Harness[]> {
    const entry = this.#entry(id)
    if (entry.enabled !== enabled) {
      entry.enabled = enabled
      // Merge into the stored record: harnesses not registered in this
      // process keep their saved preference.
      const stored =
        this.#settings.get<Record<string, boolean>>(enabledSettingKey) ?? {}
      stored[id] = enabled
      this.#settings.set(enabledSettingKey, stored)
    }
    return this.list()
  }

  /** Re-checks availability on an interval so the picture stays current. */
  startAutoRefresh(intervalMs: number): void {
    if (this.#refreshTimer) return
    this.#refreshTimer = setInterval(() => {
      this.refresh().catch(() => {})
    }, intervalMs)
    this.#refreshTimer.unref?.()
  }

  dispose(): void {
    if (this.#refreshTimer) clearInterval(this.#refreshTimer)
    this.#refreshTimer = null
  }

  async resolveProfile(
    harnessId: string,
    requested?: ExecutionProfile
  ): Promise<ExecutionProfile> {
    const { factory, probe } = await this.#requireUsable(harnessId)
    const models = probe.models
    if (!requested) {
      const model = models.find((candidate) => candidate.isDefault) ?? models[0]
      return {
        modelId: model?.id ?? null,
        effort: model?.defaultEffort ?? null,
        permissionMode: "approval-required",
      }
    }

    if (requested.modelId === null) {
      if (requested.effort !== null) {
        throw new RuntimeError(
          "invalid-execution-profile",
          "A thinking level requires a selected model"
        )
      }
      return requested
    }

    const model = models.find((candidate) => candidate.id === requested.modelId)
    if (!model) {
      throw new RuntimeError(
        "invalid-execution-profile",
        `Model '${requested.modelId}' is not available for ${factory.descriptor.name}`
      )
    }
    if (
      requested.effort !== null &&
      !model.supportedEfforts.includes(requested.effort)
    ) {
      throw new RuntimeError(
        "invalid-execution-profile",
        `Thinking level '${requested.effort}' is not available for ${model.name}`
      )
    }
    if (!model.supportedPermissionModes.includes(requested.permissionMode)) {
      throw new RuntimeError(
        "invalid-execution-profile",
        `${requested.permissionMode === "auto" ? "Auto permissions are" : "This permission mode is"} not available for ${model.name}`
      )
    }
    return requested
  }

  async requireAvailable(id: string): Promise<HarnessAdapterFactory> {
    return (await this.#requireUsable(id)).factory
  }

  async #requireUsable(
    id: string
  ): Promise<{ factory: HarnessAdapterFactory; probe: Probe }> {
    const entry = this.#entry(id)
    if (!entry.enabled) {
      throw new RuntimeError(
        "harness-disabled",
        `${entry.factory.descriptor.name} is turned off in settings`
      )
    }
    const probe = this.#isStale(entry) ? await this.#probe(entry) : entry.probe!
    if (probe.availability.status === "unavailable") {
      throw new RuntimeError("harness-unavailable", probe.availability.reason)
    }
    return { factory: entry.factory, probe }
  }

  #entry(id: string): Entry {
    const entry = this.#entries.get(id)
    if (!entry)
      throw new RuntimeError("harness-not-found", `Harness '${id}' not found`)
    return entry
  }

  #isStale(entry: Entry): boolean {
    if (!entry.probe) return true
    return Date.now() - Date.parse(entry.probe.checkedAt) >= probeFreshnessMs
  }

  #snapshot(): Harness[] {
    return [...this.#entries.values()].map((entry) => ({
      ...entry.factory.descriptor,
      enabled: entry.enabled,
      availability: entry.probe?.availability ?? {
        status: "unavailable",
        reason: "Not checked yet",
      },
      checkedAt: entry.probe?.checkedAt ?? null,
      models: entry.probe?.models ?? [],
    }))
  }

  #probe(entry: Entry, options: { force?: boolean } = {}): Promise<Probe> {
    if (entry.probing && !options.force) return entry.probing
    const probing = this.#runProbe(entry, options.force ?? false)
    entry.probing = probing
    void probing.finally(() => {
      if (entry.probing === probing) entry.probing = null
    })
    return probing
  }

  async #runProbe(entry: Entry, force: boolean): Promise<Probe> {
    await this.#probeGate
    const name = entry.factory.descriptor.name
    let availability: HarnessAvailability
    let models: HarnessModelOption[] = []
    try {
      availability = await withTimeout(
        entry.factory.checkAvailability(),
        availabilityTimeoutMs,
        `${name} did not answer a health check`
      )
      if (availability.status === "available") {
        models = await this.#modelsFor(entry, availability, force)
      }
    } catch (error) {
      availability = { status: "unavailable", reason: errorMessage(error) }
      models = []
    }
    const probe: Probe = {
      availability,
      models,
      checkedAt: new Date().toISOString(),
    }
    entry.probe = probe
    return probe
  }

  // Model catalogs are slow to read, so they are reused while the reported
  // version stands still. A forced refresh always re-reads them.
  #modelsFor(
    entry: Entry,
    availability: Extract<HarnessAvailability, { status: "available" }>,
    force: boolean
  ): Promise<HarnessModelOption[]> {
    const previous = entry.probe
    const sameVersion =
      previous?.availability.status === "available" &&
      previous.availability.version === availability.version
    if (!force && sameVersion && previous.models.length > 0) {
      return Promise.resolve(previous.models)
    }
    return withTimeout(
      entry.factory.listModels(),
      modelListTimeoutMs,
      `${entry.factory.descriptor.name} did not report its models`
    )
  }
}

/** Snapshot serialization for change detection; ignores probe timestamps. */
function comparable(harnesses: Harness[]): string {
  return JSON.stringify(
    harnesses.map((harness) => ({ ...harness, checkedAt: null }))
  )
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new RuntimeError("harness-timeout", message))
    }, timeoutMs)
    timer.unref?.()
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    )
  })
}

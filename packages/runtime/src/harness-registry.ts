import type {
  ExecutionProfile,
  HarnessAdapterFactory,
  HarnessAvailability,
  HarnessDescriptor,
  HarnessModelOption,
} from "@openappto/harness-sdk"

import { RuntimeError, errorMessage } from "./errors.js"

export type AvailableHarness = HarnessDescriptor & {
  availability: HarnessAvailability
  models: HarnessModelOption[]
}

export class HarnessRegistry {
  readonly #factories: Map<string, HarnessAdapterFactory>
  readonly #modelLists = new Map<string, Promise<HarnessModelOption[]>>()

  constructor(factories: HarnessAdapterFactory[]) {
    this.#factories = new Map()
    for (const factory of factories) {
      if (this.#factories.has(factory.descriptor.id)) {
        throw new RuntimeError(
          "duplicate-harness",
          `Harness '${factory.descriptor.id}' is registered more than once`
        )
      }
      this.#factories.set(factory.descriptor.id, factory)
    }
  }

  get(id: string): HarnessAdapterFactory {
    const factory = this.#factories.get(id)
    if (!factory)
      throw new RuntimeError("harness-not-found", `Harness '${id}' not found`)
    return factory
  }

  async list(): Promise<AvailableHarness[]> {
    return Promise.all(
      [...this.#factories.values()].map(async (factory) => {
        let availability: HarnessAvailability
        let models: HarnessModelOption[] = []
        try {
          availability = await factory.checkAvailability()
          if (availability.status === "available") {
            models = await this.#models(factory)
          }
        } catch (error) {
          availability = { status: "unavailable", reason: errorMessage(error) }
        }
        return { ...factory.descriptor, availability, models }
      })
    )
  }

  async resolveProfile(
    harnessId: string,
    requested?: ExecutionProfile
  ): Promise<ExecutionProfile> {
    const factory = await this.requireAvailable(harnessId)
    const models = await this.#models(factory)
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
    const factory = this.get(id)
    let availability: HarnessAvailability
    try {
      availability = await factory.checkAvailability()
    } catch (error) {
      throw new RuntimeError("harness-unavailable", errorMessage(error))
    }
    if (availability.status === "unavailable") {
      throw new RuntimeError("harness-unavailable", availability.reason)
    }
    return factory
  }

  #models(factory: HarnessAdapterFactory): Promise<HarnessModelOption[]> {
    const cached = this.#modelLists.get(factory.descriptor.id)
    if (cached) return cached
    const models = factory.listModels().catch((error) => {
      this.#modelLists.delete(factory.descriptor.id)
      throw error
    })
    this.#modelLists.set(factory.descriptor.id, models)
    return models
  }
}

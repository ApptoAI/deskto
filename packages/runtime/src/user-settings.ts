import {
  resolveSettings,
  settingDefinition,
  type SettingsSnapshot,
} from "@openappto/settings"

import { RuntimeError } from "./errors.js"
import type { Settings } from "./storage/settings.js"

const storageKey = "user-settings"

/**
 * Validates and stores user overrides for the settings registry in
 * `@openappto/settings`. Overrides live as one JSON object in the settings
 * table; defaults never leave the registry, so shipping a new default reaches
 * every user who has not overridden that setting.
 */
export class UserSettings {
  constructor(
    private readonly storage: Settings,
    /** Fires after every persisted change, like HarnessRegistry's onChanged. */
    private readonly onChanged: () => void
  ) {}

  snapshot(): SettingsSnapshot {
    return resolveSettings(this.#stored())
  }

  /** Applies overrides; a null entry clears one back to its default. */
  update(entries: Record<string, unknown>): SettingsSnapshot {
    const stored = this.#stored()
    for (const [key, value] of Object.entries(entries)) {
      const definition = settingDefinition(key)
      if (!definition)
        throw new RuntimeError("invalid-setting", `"${key}" is not a setting`)
      if (value === null) {
        delete stored[key]
        continue
      }
      const parsed = definition.schema.safeParse(value)
      if (!parsed.success)
        throw new RuntimeError(
          "invalid-setting",
          `The value for "${definition.label}" is not valid`
        )
      stored[key] = parsed.data
    }
    this.storage.set(storageKey, stored)
    this.onChanged()
    return resolveSettings(stored)
  }

  #stored(): Record<string, unknown> {
    const value = this.storage.get<unknown>(storageKey)
    return isRecord(value) ? { ...value } : {}
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

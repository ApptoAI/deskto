import { settingDefinitions } from "./app-settings.js"
import type { SettingDefinition } from "./definition.js"

/**
 * Effective settings after user overrides are applied to the defaults.
 * Serializable, so the Runtime can hand it to any Surface as plain JSON.
 */
export interface SettingsSnapshot {
  /** Every setting key mapped to the value currently in effect. */
  values: Record<string, unknown>
  /** The subset the user has changed, keyed the same way. */
  overrides: Record<string, unknown>
}

/** Applies stored overrides to the defaults, dropping unknown or invalid ones. */
export function resolveSettings(
  stored: Record<string, unknown>
): SettingsSnapshot {
  const values: Record<string, unknown> = {}
  const overrides: Record<string, unknown> = {}
  for (const definition of settingDefinitions) {
    const parsed = definition.schema.safeParse(stored[definition.key])
    if (parsed.success) {
      values[definition.key] = parsed.data
      overrides[definition.key] = parsed.data
    } else {
      values[definition.key] = definition.defaultValue
    }
  }
  return { values, overrides }
}

/** Reads one setting from a snapshot; pass null to get the default. */
export function settingValue<T>(
  snapshot: SettingsSnapshot | null,
  definition: SettingDefinition<T>
): T {
  if (!snapshot || !(definition.key in snapshot.values))
    return definition.defaultValue
  // resolveSettings already validated every entry; the cast restates that.
  return snapshot.values[definition.key] as T
}

/** Whether the user has overridden this setting. */
export function isOverridden<T>(
  snapshot: SettingsSnapshot | null,
  definition: SettingDefinition<T>
): boolean {
  return snapshot !== null && definition.key in snapshot.overrides
}

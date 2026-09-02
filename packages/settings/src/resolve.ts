import { keybindingSettings, settingDefinitions } from "./app-settings.js"
import type {
  SettingDefinition,
  SettingValue,
  SettingValues,
} from "./definition.js"
import { parseKeybinding, type Keybinding } from "./keybinding.js"

/**
 * Effective settings after user overrides are applied to the defaults.
 * Serializable, so the Runtime can hand it to any Surface as plain JSON.
 */
export interface SettingsSnapshot {
  /** Every setting key mapped to the value currently in effect. */
  values: SettingValues
  /** The subset the user has changed, keyed the same way. */
  overrides: SettingValues
}

/** Applies stored overrides to the defaults, dropping unknown or invalid ones. */
export function resolveSettings(stored: SettingValues): SettingsSnapshot {
  const values: SettingValues = {}
  const overrides: SettingValues = {}
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
export function settingValue<T extends SettingValue>(
  snapshot: SettingsSnapshot | null,
  definition: SettingDefinition<T>
): T {
  if (!snapshot || !(definition.key in snapshot.values))
    return definition.defaultValue
  // SAFETY: resolveSettings stored this key only after the definition's schema
  // parsed it, so the value has the definition's generic output type.
  return snapshot.values[definition.key] as T
}

/** Whether the user has overridden this setting. */
export function isOverridden<T extends SettingValue>(
  snapshot: SettingsSnapshot | null,
  definition: SettingDefinition<T>
): boolean {
  return snapshot !== null && definition.key in snapshot.overrides
}

/**
 * The other keybinding setting already holding `binding`, or null. Two
 * bindings that fire on the same keydown would both run, so a Surface refuses
 * the second one and names the first.
 */
export function findKeybindingConflict(
  snapshot: SettingsSnapshot | null,
  definition: SettingDefinition<string>,
  binding: string
): SettingDefinition<string> | null {
  const candidate = parseKeybinding(binding)
  if (!candidate) return null
  for (const other of keybindingSettings) {
    if (other.key === definition.key) continue
    const held = parseKeybinding(settingValue(snapshot, other))
    if (held && sameKeybinding(held, candidate)) return other
  }
  return null
}

function sameKeybinding(a: Keybinding, b: Keybinding): boolean {
  return (
    a.key === b.key &&
    a.mod === b.mod &&
    a.ctrl === b.ctrl &&
    a.alt === b.alt &&
    a.shift === b.shift
  )
}

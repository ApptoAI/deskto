import type { z } from "zod"

export type SettingValue =
  | string
  | number
  | boolean
  | null
  | SettingValue[]
  | { [key: string]: SettingValue }

export type SettingValues = { [key: string]: SettingValue }

/** How a settings screen edits the value. New editor kinds join this union. */
export type SettingInput = { kind: "keybinding" } | { kind: "harness-model" }

/** One configurable value: a stable key, a validated shape, and a default. */
export interface SettingDefinition<T extends SettingValue> {
  /**
   * Stable identity in storage and over the protocol, e.g.
   * "keybindings.new-task". Renaming a key silently discards saved overrides.
   */
  key: string
  /** Short name a settings screen shows, e.g. "New task". */
  label: string
  /** What the setting changes, for settings screens. */
  description?: string
  input: SettingInput
  /** Guards every stored override; values that stop parsing fall back. */
  schema: z.ZodType<T>
  /** The value in effect until the user overrides it. */
  defaultValue: T
}

export function defineSetting<T extends SettingValue>(
  definition: SettingDefinition<T>
): SettingDefinition<T> {
  return definition
}

import type { z } from "zod"

export type SettingValue =
  | string
  | number
  | boolean
  | null
  | SettingValue[]
  | { [key: string]: SettingValue }

export type SettingValues = { [key: string]: SettingValue }

/** One selectable value in a `choice` setting, in the order it is offered. */
export type SettingChoice<T extends string = string> = {
  value: T
  label: string
  /** What picking this one means, when the label cannot say it alone. */
  description?: string
}

/** How a settings screen edits the value. New editor kinds join this union. */
export type SettingInput =
  | { kind: "keybinding" }
  | { kind: "harness-model" }
  | { kind: "model-visibility" }
  | { kind: "provider-follow-up" }
  | { kind: "choice" }
  | { kind: "range"; min: number; max: number; step: number; unit?: string }
  | { kind: "text"; placeholder?: string; monospace?: boolean }
  | { kind: "toggle" }
  | { kind: "viewport" }
  /** One host rule per line; the schema says what a rule looks like. */
  | { kind: "host-list" }
  /** Stored and validated like any setting, but no settings screen edits it. */
  | { kind: "hidden" }

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

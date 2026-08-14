import { defineSetting, type SettingDefinition } from "./definition.js"
import { keybindingSchema } from "./keybinding.js"

/**
 * Every configurable setting in the product. Add a setting here and each
 * layer picks it up: the Runtime validates and stores overrides by `key`,
 * and settings screens render an editor from `input`.
 */
export const appSettings = {
  newTaskKeybinding: defineSetting({
    key: "keybindings.new-task",
    label: "New task",
    description: "Start a new task in the current project.",
    input: { kind: "keybinding" },
    schema: keybindingSchema,
    defaultValue: "mod+n",
  }),
}

export const settingDefinitions: readonly SettingDefinition<unknown>[] =
  Object.values(appSettings)

const definitionsByKey = new Map(
  settingDefinitions.map((definition) => [definition.key, definition])
)

/** The keybinding settings, in registry order, for settings screens. */
export const keybindingSettings: readonly SettingDefinition<string>[] =
  settingDefinitions.filter(
    (definition): definition is SettingDefinition<string> =>
      definition.input.kind === "keybinding"
  )

export function settingDefinition(
  key: string
): SettingDefinition<unknown> | undefined {
  return definitionsByKey.get(key)
}

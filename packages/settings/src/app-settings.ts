import { z } from "zod"

import { defineSetting, type SettingDefinition } from "./definition.js"
import { keybindingSchema } from "./keybinding.js"

export const harnessModelSelectionSchema = z
  .object({
    harnessId: z.string().min(1).nullable(),
    modelId: z.string().min(1).nullable(),
  })
  .refine(
    (selection) => selection.harnessId !== null || selection.modelId === null
  )

export type HarnessModelSelection = z.infer<typeof harnessModelSelectionSchema>

/**
 * Every configurable setting in the product. Add a setting here and each
 * layer picks it up: the Runtime validates and stores overrides by `key`,
 * and settings screens render an editor from `input`.
 */
export const appSettings = {
  threadTitleModel: defineSetting({
    key: "models.thread-title",
    label: "Task title model",
    description:
      "Generate a short title after the first message. By default, use the task's agent and model.",
    input: { kind: "harness-model" },
    schema: harnessModelSelectionSchema,
    defaultValue: { harnessId: null, modelId: null },
  }),
  newTaskKeybinding: defineSetting({
    key: "keybindings.new-task",
    label: "New task",
    description: "Start a new task in the current project.",
    input: { kind: "keybinding" },
    schema: keybindingSchema,
    defaultValue: "mod+n",
  }),
  nextWorkspaceKeybinding: defineSetting({
    key: "keybindings.next-workspace",
    label: "Next workspace",
    description: "Switch to the next workspace.",
    input: { kind: "keybinding" },
    schema: keybindingSchema,
    defaultValue: "mod+alt+arrowright",
  }),
  previousWorkspaceKeybinding: defineSetting({
    key: "keybindings.previous-workspace",
    label: "Previous workspace",
    description: "Switch to the previous workspace.",
    input: { kind: "keybinding" },
    schema: keybindingSchema,
    defaultValue: "mod+alt+arrowleft",
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

/** Settings edited with the shared Harness/model picker, in registry order. */
export const harnessModelSettings = settingDefinitions.filter(
  (definition): definition is SettingDefinition<HarnessModelSelection> =>
    definition.input.kind === "harness-model"
)

export function settingDefinition(
  key: string
): SettingDefinition<unknown> | undefined {
  return definitionsByKey.get(key)
}

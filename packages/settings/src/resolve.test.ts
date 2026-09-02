import { describe, expect, it } from "vitest"

import {
  appSettings,
  harnessModelSettings,
  interfaceFontSizeSchema,
} from "./app-settings.js"
import {
  findKeybindingConflict,
  isOverridden,
  resolveSettings,
  settingValue,
} from "./resolve.js"

const newTask = appSettings.newTaskKeybinding
const threadTitleModel = appSettings.threadTitleModel
const workspaceLayout = appSettings.workspaceLayout
const interfaceFontSize = appSettings.interfaceFontSize

describe("resolveSettings", () => {
  it("serves defaults when nothing is stored", () => {
    const snapshot = resolveSettings({})
    expect(snapshot.values[newTask.key]).toBe(newTask.defaultValue)
    expect(settingValue(snapshot, threadTitleModel)).toEqual({
      harnessId: null,
      modelId: null,
    })
    expect(settingValue(snapshot, workspaceLayout)).toBe("workspace")
    expect(settingValue(snapshot, interfaceFontSize)).toBe(16)
    expect(snapshot.overrides).toEqual({})
  })

  it("derives Harness model editors from the registry", () => {
    expect(harnessModelSettings).toEqual([threadTitleModel])
  })

  it("keeps the interface scale inside its layout-safe range", () => {
    expect(interfaceFontSizeSchema.safeParse(12).success).toBe(true)
    expect(interfaceFontSizeSchema.safeParse(20).success).toBe(true)
    expect(interfaceFontSizeSchema.safeParse(11).success).toBe(false)
    expect(interfaceFontSizeSchema.safeParse(21).success).toBe(false)
    expect(interfaceFontSizeSchema.safeParse(16.5).success).toBe(false)
  })

  it("applies a valid override and reports it", () => {
    const snapshot = resolveSettings({ [newTask.key]: "mod+shift+n" })
    expect(settingValue(snapshot, newTask)).toBe("mod+shift+n")
    expect(isOverridden(snapshot, newTask)).toBe(true)
  })

  it("drops overrides that are invalid or unknown", () => {
    const snapshot = resolveSettings({
      [newTask.key]: 7,
      [workspaceLayout.key]: "columns",
      [interfaceFontSize.key]: 21,
      "no-such-setting": true,
    })
    expect(settingValue(snapshot, newTask)).toBe(newTask.defaultValue)
    expect(snapshot.overrides).toEqual({})
    expect("no-such-setting" in snapshot.values).toBe(false)
  })

  it("falls back to the default without a snapshot", () => {
    expect(settingValue(null, newTask)).toBe(newTask.defaultValue)
    expect(isOverridden(null, newTask)).toBe(false)
  })
})

describe("findKeybindingConflict", () => {
  const toggleSidebar = appSettings.toggleSidebarKeybinding

  it("names the setting already holding the binding", () => {
    const conflict = findKeybindingConflict(
      resolveSettings({}),
      newTask,
      toggleSidebar.defaultValue
    )
    expect(conflict?.key).toBe(toggleSidebar.key)
  })

  it("compares parsed bindings, not their spelling", () => {
    const snapshot = resolveSettings({ [toggleSidebar.key]: "shift+mod+k" })
    expect(findKeybindingConflict(snapshot, newTask, "mod+shift+k")?.key).toBe(
      toggleSidebar.key
    )
  })

  it("lets a setting keep its own binding and ignores unused ones", () => {
    const snapshot = resolveSettings({})
    expect(findKeybindingConflict(snapshot, newTask, newTask.defaultValue)).toBe(
      null
    )
    expect(findKeybindingConflict(snapshot, newTask, "mod+alt+9")).toBe(null)
  })
})

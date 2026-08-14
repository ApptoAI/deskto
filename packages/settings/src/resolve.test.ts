import { describe, expect, it } from "vitest"

import { appSettings } from "./app-settings.js"
import { isOverridden, resolveSettings, settingValue } from "./resolve.js"

const newTask = appSettings.newTaskKeybinding

describe("resolveSettings", () => {
  it("serves defaults when nothing is stored", () => {
    const snapshot = resolveSettings({})
    expect(snapshot.values[newTask.key]).toBe(newTask.defaultValue)
    expect(snapshot.overrides).toEqual({})
  })

  it("applies a valid override and reports it", () => {
    const snapshot = resolveSettings({ [newTask.key]: "mod+shift+n" })
    expect(settingValue(snapshot, newTask)).toBe("mod+shift+n")
    expect(isOverridden(snapshot, newTask)).toBe(true)
  })

  it("drops overrides that are invalid or unknown", () => {
    const snapshot = resolveSettings({
      [newTask.key]: 7,
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

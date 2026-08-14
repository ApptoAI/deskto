import { describe, expect, it } from "vitest"

import {
  formatKeybinding,
  keybindingFromEvent,
  matchesKeybinding,
  parseKeybinding,
  type KeyComboEvent,
} from "./keybinding.js"

function press(overrides: Partial<KeyComboEvent> & { key: string }) {
  return {
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...overrides,
  }
}

describe("parseKeybinding", () => {
  it("reads modifiers in any order around a final key", () => {
    expect(parseKeybinding("shift+mod+n")).toEqual({
      key: "n",
      mod: true,
      ctrl: false,
      alt: false,
      shift: true,
    })
  })

  it("rejects bindings without a key or with unknown modifiers", () => {
    expect(parseKeybinding("mod+shift")).toBeNull()
    expect(parseKeybinding("super+n")).toBeNull()
    expect(parseKeybinding("")).toBeNull()
  })
})

describe("matchesKeybinding", () => {
  it("maps mod to the command key on mac", () => {
    const event = press({ key: "n", metaKey: true })
    expect(matchesKeybinding("mod+n", event, "mac")).toBe(true)
    expect(matchesKeybinding("mod+n", event, "other")).toBe(false)
  })

  it("maps mod to control elsewhere", () => {
    const event = press({ key: "n", ctrlKey: true })
    expect(matchesKeybinding("mod+n", event, "other")).toBe(true)
    expect(matchesKeybinding("mod+n", event, "mac")).toBe(false)
  })

  it("requires the exact modifier set", () => {
    const event = press({ key: "n", metaKey: true, shiftKey: true })
    expect(matchesKeybinding("mod+n", event, "mac")).toBe(false)
    expect(matchesKeybinding("mod+shift+n", event, "mac")).toBe(true)
  })

  it("matches letter keys case-insensitively", () => {
    const event = press({ key: "N", metaKey: true, shiftKey: true })
    expect(matchesKeybinding("mod+shift+n", event, "mac")).toBe(true)
  })
})

describe("keybindingFromEvent", () => {
  it("captures the platform command modifier as mod", () => {
    expect(keybindingFromEvent(press({ key: "n", metaKey: true }), "mac")).toBe(
      "mod+n"
    )
    expect(
      keybindingFromEvent(press({ key: "N", ctrlKey: true }), "other")
    ).toBe("mod+n")
  })

  it("ignores bare modifiers and unmodified typing keys", () => {
    expect(
      keybindingFromEvent(press({ key: "Meta", metaKey: true }), "mac")
    ).toBeNull()
    expect(keybindingFromEvent(press({ key: "a" }), "mac")).toBeNull()
    expect(
      keybindingFromEvent(press({ key: "a", shiftKey: true }), "mac")
    ).toBeNull()
  })

  it("allows function keys without a modifier", () => {
    expect(keybindingFromEvent(press({ key: "F5" }), "other")).toBe("f5")
  })

  it("ignores AltGr, dead keys, and composed characters", () => {
    expect(
      keybindingFromEvent(
        press({ key: "AltGraph", ctrlKey: true, altKey: true }),
        "other"
      )
    ).toBeNull()
    expect(
      keybindingFromEvent(press({ key: "Dead", altKey: true }), "mac")
    ).toBeNull()
    expect(
      keybindingFromEvent(press({ key: "ñ", altKey: true }), "mac")
    ).toBeNull()
  })

  it("records the plus key without colliding with the separator", () => {
    const event = press({ key: "+", metaKey: true })
    const binding = keybindingFromEvent(event, "mac")
    expect(binding).toBe("mod+plus")
    expect(matchesKeybinding(binding!, event, "mac")).toBe(true)
    expect(formatKeybinding(binding!, "mac")).toBe("⌘+")
  })

  it("round-trips through matching", () => {
    const event = press({ key: "n", metaKey: true, shiftKey: true })
    const binding = keybindingFromEvent(event, "mac")
    expect(binding).not.toBeNull()
    expect(matchesKeybinding(binding!, event, "mac")).toBe(true)
  })
})

describe("formatKeybinding", () => {
  it("writes shortcuts the way each platform does", () => {
    expect(formatKeybinding("mod+shift+n", "mac")).toBe("⇧⌘N")
    expect(formatKeybinding("mod+shift+n", "other")).toBe("Ctrl+Shift+N")
    expect(formatKeybinding("mod+arrowup", "mac")).toBe("⌘↑")
  })
})

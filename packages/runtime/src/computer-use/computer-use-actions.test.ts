import { describe, expect, it } from "vitest"

import {
  clickEvents,
  clickInputSchema,
  dragEvents,
  keyEvents,
  parseKeyChord,
  parseModifiers,
  scrollEvents,
  scrollInputSchema,
  typeEvents,
  waitInputSchema,
} from "./computer-use-actions.js"

const display = { width: 1280, height: 800 }

describe("computer-use tool schemas", () => {
  it("accepts screenshot coordinates as [x, y] integers", () => {
    expect(clickInputSchema.safeParse({ coordinate: [10, 20] }).success).toBe(
      true
    )
    expect(clickInputSchema.safeParse({ coordinate: [10.5, 20] }).success).toBe(
      false
    )
    expect(clickInputSchema.safeParse({ coordinate: [-1, 20] }).success).toBe(
      false
    )
    expect(clickInputSchema.safeParse({ coordinate: [1, 2, 3] }).success).toBe(
      false
    )
  })

  it("bounds scroll clicks and wait durations", () => {
    expect(
      scrollInputSchema.safeParse({
        coordinate: [1, 1],
        scroll_direction: "down",
        scroll_amount: 3,
      }).success
    ).toBe(true)
    expect(
      scrollInputSchema.safeParse({
        coordinate: [1, 1],
        scroll_direction: "sideways",
        scroll_amount: 3,
      }).success
    ).toBe(false)
    expect(waitInputSchema.safeParse({ duration: 31 }).success).toBe(false)
    expect(waitInputSchema.safeParse({ duration: 2 }).success).toBe(true)
  })
})

describe("input-event mapping", () => {
  it("clicks with a move, a press, and a release", () => {
    expect(clickEvents({ x: 5, y: 7 }, display, "left", 1, [])).toEqual([
      { type: "mouseMove", x: 5, y: 7 },
      { type: "mouseDown", x: 5, y: 7, button: "left", clickCount: 1 },
      { type: "mouseUp", x: 5, y: 7, button: "left", clickCount: 1 },
    ])
  })

  it("counts the second press of a double click and holds modifiers", () => {
    const events = clickEvents({ x: 1, y: 1 }, display, "left", 2, ["shift"])
    expect(events).toHaveLength(5)
    expect(events[3]).toEqual({
      type: "mouseDown",
      x: 1,
      y: 1,
      button: "left",
      clickCount: 2,
      modifiers: ["shift"],
    })
  })

  it("rejects points outside the display", () => {
    expect(() =>
      clickEvents({ x: 1280, y: 10 }, display, "left", 1, [])
    ).toThrow(/outside/)
  })

  it("drags through a midpoint with the button held", () => {
    const events = dragEvents({ x: 0, y: 0 }, { x: 100, y: 50 }, display)
    expect(events.map((event) => event.type)).toEqual([
      "mouseMove",
      "mouseDown",
      "mouseMove",
      "mouseMove",
      "mouseUp",
    ])
    expect(events[2]).toEqual({
      type: "mouseMove",
      x: 50,
      y: 25,
      button: "left",
      modifiers: ["leftbuttondown"],
    })
    expect(events[4]).toEqual({
      type: "mouseUp",
      x: 100,
      y: 50,
      button: "left",
      clickCount: 1,
      modifiers: ["leftbuttondown"],
    })
  })

  it("scrolls down with a negative wheel delta", () => {
    const events = scrollEvents({ x: 9, y: 9 }, display, "down", 3, [])
    expect(events[1]).toEqual({
      type: "mouseWheel",
      x: 9,
      y: 9,
      deltaX: 0,
      deltaY: -300,
    })
  })

  it("parses xdotool chords into Electron key codes", () => {
    expect(parseKeyChord("Return")).toEqual({
      keyCode: "Return",
      modifiers: [],
    })
    expect(parseKeyChord("ctrl+shift+t")).toEqual({
      keyCode: "t",
      modifiers: ["control", "shift"],
    })
    expect(parseKeyChord("Page_Down")).toEqual({
      keyCode: "PageDown",
      modifiers: [],
    })
    expect(parseKeyChord("f5")).toEqual({ keyCode: "F5", modifiers: [] })
    expect(parseKeyChord("ctrl")).toEqual({ keyCode: "Control", modifiers: [] })
    expect(() => parseKeyChord("a+b")).toThrow(/one key/)
  })

  it("presses and releases a chord", () => {
    expect(keyEvents("alt+Tab")).toEqual([
      { type: "keyDown", keyCode: "Tab", modifiers: ["alt"] },
      { type: "keyUp", keyCode: "Tab", modifiers: ["alt"] },
    ])
  })

  it("types characters and turns newlines into Return", () => {
    expect(typeEvents("a\n")).toEqual([
      { type: "keyDown", keyCode: "a" },
      { type: "char", keyCode: "a" },
      { type: "keyUp", keyCode: "a" },
      { type: "keyDown", keyCode: "Return" },
      { type: "keyUp", keyCode: "Return" },
    ])
  })

  it("only accepts modifier names in a click's text argument", () => {
    expect(parseModifiers("ctrl+alt")).toEqual(["control", "alt"])
    expect(() => parseModifiers("Return")).toThrow(/Not a modifier/)
  })
})

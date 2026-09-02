import { z } from "zod"

import type {
  ComputerUseInputEvent,
  ComputerUseModifier,
  ComputerUseMouseButton,
  ComputerUsePoint,
  ComputerUseSize,
} from "./computer-use-host.js"

export const maxComputerUseCoordinate = 16_384
export const maxComputerUseTextLength = 32_000
export const maxComputerUseWaitSeconds = 30
export const maxComputerUseScrollClicks = 50
/** How far one scroll click moves, in CSS pixels. */
export const computerUseScrollClickPixels = 100

export const coordinateSchema = z
  .tuple([
    z.number().int().min(0).max(maxComputerUseCoordinate),
    z.number().int().min(0).max(maxComputerUseCoordinate),
  ])
  .describe("[x, y] pixel position on the latest screenshot")

export const pointFrom = ([x, y]: [number, number]): ComputerUsePoint => ({
  x,
  y,
})

/**
 * An xdotool-style key chord such as `Return`, `ctrl+s`, or `shift+Tab`,
 * the shape the Anthropic computer-use tool documents.
 */
export const keyChordSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9_+-]+$/, "Use a key name like Return or ctrl+s")

export const clickInputSchema = z.object({
  coordinate: coordinateSchema,
  text: keyChordSchema
    .optional()
    .describe("Modifier keys to hold during the click, like ctrl or shift"),
})

export const mouseMoveInputSchema = z.object({ coordinate: coordinateSchema })

export const dragInputSchema = z.object({
  start_coordinate: coordinateSchema,
  coordinate: coordinateSchema.describe("[x, y] where the drag ends"),
})

export const scrollDirectionSchema = z.enum(["up", "down", "left", "right"])

export const scrollInputSchema = z.object({
  coordinate: coordinateSchema,
  scroll_direction: scrollDirectionSchema,
  scroll_amount: z.number().int().min(1).max(maxComputerUseScrollClicks),
  text: keyChordSchema
    .optional()
    .describe("Modifier keys to hold while scrolling, like shift"),
})

export const typeInputSchema = z.object({
  text: z.string().min(1).max(maxComputerUseTextLength),
})

export const keyInputSchema = z.object({ text: keyChordSchema })

export const waitInputSchema = z.object({
  duration: z.number().min(0).max(maxComputerUseWaitSeconds),
})

export const emptyInputSchema = z.object({})

const modifierNames = new Map<string, ComputerUseModifier>([
  ["shift", "shift"],
  ["ctrl", "control"],
  ["control", "control"],
  ["alt", "alt"],
  ["option", "alt"],
  ["meta", "meta"],
  ["super", "meta"],
  ["cmd", "meta"],
  ["command", "meta"],
  ["win", "meta"],
])

/** xdotool key names to Electron accelerator key codes where they differ. */
const keyCodes = new Map<string, string>([
  ["return", "Return"],
  ["enter", "Return"],
  ["kp_enter", "Return"],
  ["tab", "Tab"],
  ["escape", "Escape"],
  ["esc", "Escape"],
  ["backspace", "Backspace"],
  ["delete", "Delete"],
  ["space", "Space"],
  ["up", "Up"],
  ["down", "Down"],
  ["left", "Left"],
  ["right", "Right"],
  ["home", "Home"],
  ["end", "End"],
  ["page_up", "PageUp"],
  ["pageup", "PageUp"],
  ["page_down", "PageDown"],
  ["pagedown", "PageDown"],
  ["insert", "Insert"],
  ["minus", "-"],
  ["plus", "+"],
  ["equal", "="],
  ["comma", ","],
  ["period", "."],
  ["slash", "/"],
  ["backslash", "\\"],
  ["semicolon", ";"],
  ["apostrophe", "'"],
  ["grave", "`"],
  ["bracketleft", "["],
  ["bracketright", "]"],
])

function modifierKeyCode(modifier: ComputerUseModifier): string {
  switch (modifier) {
    case "shift":
      return "Shift"
    case "control":
      return "Control"
    case "alt":
      return "Alt"
    case "meta":
      return "Meta"
  }
}
export type KeyChord = { keyCode: string; modifiers: ComputerUseModifier[] }

/** Splits `ctrl+shift+t` into the key Electron presses and the modifiers held. */
export function parseKeyChord(chord: string): KeyChord {
  const parts = chord.split("+").filter((part) => part.length > 0)
  if (parts.length === 0) throw new Error(`Unsupported key: ${chord}`)
  const modifiers: ComputerUseModifier[] = []
  const keys: string[] = []
  for (const part of parts) {
    const modifier = modifierNames.get(part.toLowerCase())
    if (modifier) {
      if (!modifiers.includes(modifier)) modifiers.push(modifier)
    } else {
      keys.push(keyCodes.get(part.toLowerCase()) ?? part)
    }
  }
  if (keys.length > 1) {
    throw new Error(`A key chord holds modifiers and one key: ${chord}`)
  }
  let keyCode = keys[0]
  if (keyCode === undefined) {
    // Every part was a modifier: press the last one as a key on its own.
    const last = modifiers.pop()
    if (!last) throw new Error(`Unsupported key: ${chord}`)
    keyCode = modifierKeyCode(last)
  }
  if (/^f\d{1,2}$/i.test(keyCode)) keyCode = keyCode.toUpperCase()
  return { keyCode, modifiers }
}

/** Modifiers named in a click or scroll `text` argument; empty when absent. */
export function parseModifiers(
  text: string | undefined
): ComputerUseModifier[] {
  if (!text) return []
  const modifiers: ComputerUseModifier[] = []
  for (const part of text.split("+")) {
    const modifier = modifierNames.get(part.toLowerCase())
    if (!modifier) throw new Error(`Not a modifier key: ${part}`)
    if (!modifiers.includes(modifier)) modifiers.push(modifier)
  }
  return modifiers
}

export function insideDisplay(
  point: ComputerUsePoint,
  size: ComputerUseSize
): boolean {
  return (
    point.x >= 0 &&
    point.y >= 0 &&
    point.x < size.width &&
    point.y < size.height
  )
}

function requireInside(point: ComputerUsePoint, size: ComputerUseSize): void {
  if (!insideDisplay(point, size)) {
    throw new Error(
      `Point (${point.x}, ${point.y}) is outside the ${size.width}x${size.height} display; take a screenshot`
    )
  }
}

function withModifiers(
  event: ComputerUseInputEvent,
  modifiers: ComputerUseModifier[]
): ComputerUseInputEvent {
  return modifiers.length > 0 ? { ...event, modifiers } : event
}

export function clickEvents(
  point: ComputerUsePoint,
  size: ComputerUseSize,
  button: ComputerUseMouseButton,
  clickCount: number,
  modifiers: ComputerUseModifier[]
): ComputerUseInputEvent[] {
  requireInside(point, size)
  const events: ComputerUseInputEvent[] = [
    withModifiers({ type: "mouseMove", ...point }, modifiers),
  ]
  for (let count = 1; count <= clickCount; count += 1) {
    events.push(
      withModifiers(
        { type: "mouseDown", ...point, button, clickCount: count },
        modifiers
      ),
      withModifiers(
        { type: "mouseUp", ...point, button, clickCount: count },
        modifiers
      )
    )
  }
  return events
}

export function mouseMoveEvents(
  point: ComputerUsePoint,
  size: ComputerUseSize
): ComputerUseInputEvent[] {
  requireInside(point, size)
  return [{ type: "mouseMove", ...point }]
}

/** Press at the start, move through a midpoint so drop targets see motion, release at the end. */
export function dragEvents(
  start: ComputerUsePoint,
  end: ComputerUsePoint,
  size: ComputerUseSize
): ComputerUseInputEvent[] {
  requireInside(start, size)
  requireInside(end, size)
  const midpoint = {
    x: Math.round((start.x + end.x) / 2),
    y: Math.round((start.y + end.y) / 2),
  }
  return [
    { type: "mouseMove", ...start },
    { type: "mouseDown", ...start, button: "left", clickCount: 1 },
    { type: "mouseMove", ...midpoint, button: "left" },
    { type: "mouseMove", ...end, button: "left" },
    { type: "mouseUp", ...end, button: "left", clickCount: 1 },
  ]
}

export function scrollEvents(
  point: ComputerUsePoint,
  size: ComputerUseSize,
  direction: z.infer<typeof scrollDirectionSchema>,
  clicks: number,
  modifiers: ComputerUseModifier[]
): ComputerUseInputEvent[] {
  requireInside(point, size)
  const distance = clicks * computerUseScrollClickPixels
  // Wheel deltas follow the content, so scrolling down is a negative deltaY.
  const deltaX =
    direction === "left" ? distance : direction === "right" ? -distance : 0
  const deltaY =
    direction === "up" ? distance : direction === "down" ? -distance : 0
  return [
    { type: "mouseMove", ...point },
    withModifiers({ type: "mouseWheel", ...point, deltaX, deltaY }, modifiers),
  ]
}

export function keyEvents(chord: string): ComputerUseInputEvent[] {
  const { keyCode, modifiers } = parseKeyChord(chord)
  return [
    withModifiers({ type: "keyDown", keyCode }, modifiers),
    withModifiers({ type: "keyUp", keyCode }, modifiers),
  ]
}

/** Types text one character at a time; a newline presses Return. */
export function typeEvents(text: string): ComputerUseInputEvent[] {
  const events: ComputerUseInputEvent[] = []
  for (const character of text) {
    if (character === "\n") {
      events.push(...keyEvents("Return"))
      continue
    }
    if (character === "\r") continue
    events.push(
      { type: "keyDown", keyCode: character },
      { type: "char", keyCode: character },
      { type: "keyUp", keyCode: character }
    )
  }
  return events
}

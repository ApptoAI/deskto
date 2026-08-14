import { z } from "zod"

/** Which modifier layout a machine uses: "mod" is ⌘ on mac, Ctrl elsewhere. */
export type Platform = "mac" | "other"

/** The fields this module reads off a DOM KeyboardEvent. */
export interface KeyComboEvent {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

/**
 * A parsed binding such as "mod+shift+n": optional modifiers joined with "+"
 * around a final lowercase `KeyboardEvent.key` value (" " is stored as
 * "space").
 */
export interface Keybinding {
  key: string
  /** The platform command modifier: ⌘ on mac, Ctrl elsewhere. */
  mod: boolean
  /** The literal Control key, for mac bindings that want ⌃ specifically. */
  ctrl: boolean
  alt: boolean
  shift: boolean
}

type ModifierName = "mod" | "ctrl" | "alt" | "shift"

const modifierNames = new Set<string>(["mod", "ctrl", "alt", "shift"])
const modifierEventKeys = new Set([
  "meta",
  "control",
  "alt",
  "shift",
  "altgraph",
])
// Keydowns that stand in for composition state rather than a real key.
const compositionEventKeys = new Set(["dead", "process", "unidentified"])
const functionKeyPattern = /^f([1-9]|1[0-9]|2[0-4])$/

export function parseKeybinding(value: string): Keybinding | null {
  const parts = value.toLowerCase().split("+")
  const key = parts.at(-1)
  if (!key || modifierNames.has(key)) return null

  const binding: Keybinding = {
    key,
    mod: false,
    ctrl: false,
    alt: false,
    shift: false,
  }
  for (const part of parts.slice(0, -1)) {
    if (!modifierNames.has(part)) return null
    binding[part as ModifierName] = true
  }
  return binding
}

export const keybindingSchema = z
  .string()
  .refine((value) => parseKeybinding(value) !== null, {
    message: 'Expected a key combination such as "mod+n"',
  })

/** The event modifier state a binding requires on a platform. */
function effectiveModifiers(binding: Keybinding, platform: Platform) {
  return {
    meta: platform === "mac" && binding.mod,
    ctrl: platform === "mac" ? binding.ctrl : binding.mod || binding.ctrl,
    alt: binding.alt,
    shift: binding.shift,
  }
}

/**
 * Whether a keydown event is exactly this binding on this platform. Pass an
 * already parsed `Keybinding` when matching on every keydown.
 */
export function matchesKeybinding(
  binding: string | Keybinding,
  event: KeyComboEvent,
  platform: Platform
): boolean {
  const parsed =
    typeof binding === "string" ? parseKeybinding(binding) : binding
  if (!parsed) return false

  const required = effectiveModifiers(parsed, platform)
  return (
    eventKey(event) === parsed.key &&
    event.metaKey === required.meta &&
    event.ctrlKey === required.ctrl &&
    event.altKey === required.alt &&
    event.shiftKey === required.shift
  )
}

/**
 * Builds a binding from a keydown a shortcut recorder captured. Returns null
 * for keydowns that cannot become a binding: bare modifiers, dead keys and
 * composed characters (layout artifacts that would match the wrong keys or
 * none after a layout switch), and keys without a command modifier (except
 * function keys), which would otherwise hijack typing.
 */
export function keybindingFromEvent(
  event: KeyComboEvent,
  platform: Platform
): string | null {
  const key = eventKey(event)
  if (modifierEventKeys.has(key)) return null
  if (compositionEventKeys.has(key) || !isStableKey(key)) return null

  const mod = platform === "mac" ? event.metaKey : event.ctrlKey
  const ctrl = platform === "mac" && event.ctrlKey
  const alt = event.altKey
  if (!mod && !ctrl && !alt && !functionKeyPattern.test(key)) return null

  const parts: string[] = []
  if (mod) parts.push("mod")
  if (ctrl) parts.push("ctrl")
  if (alt) parts.push("alt")
  if (event.shiftKey) parts.push("shift")
  parts.push(key)
  return parts.join("+")
}

const displayKeys: Record<string, string> = {
  escape: "Esc",
  plus: "+",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
}

/** Renders a binding the way the platform writes shortcuts: ⌘N or Ctrl+N. */
export function formatKeybinding(value: string, platform: Platform): string {
  const binding = parseKeybinding(value)
  if (!binding) return value

  const modifiers = effectiveModifiers(binding, platform)
  const key =
    displayKeys[binding.key] ??
    (binding.key.length === 1
      ? binding.key.toUpperCase()
      : binding.key.charAt(0).toUpperCase() + binding.key.slice(1))

  if (platform === "mac") {
    return [
      modifiers.ctrl ? "⌃" : "",
      modifiers.alt ? "⌥" : "",
      modifiers.shift ? "⇧" : "",
      modifiers.meta ? "⌘" : "",
      key,
    ].join("")
  }

  const parts: string[] = []
  if (modifiers.ctrl) parts.push("Ctrl")
  if (modifiers.alt) parts.push("Alt")
  if (modifiers.shift) parts.push("Shift")
  parts.push(key)
  return parts.join("+")
}

function eventKey(event: KeyComboEvent): string {
  const key = event.key.toLowerCase()
  if (key === " ") return "space"
  // "+" would collide with the separator in the binding string.
  if (key === "+") return "plus"
  return key
}

/** Multi-character names and printable ASCII survive keyboard-layout changes. */
function isStableKey(key: string): boolean {
  return key.length > 1 || /[\x20-\x7e]/.test(key)
}

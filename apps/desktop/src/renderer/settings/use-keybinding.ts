import { useEffect } from "react"
import {
  formatKeybinding,
  matchesKeybinding,
  parseKeybinding,
  type SettingDefinition,
} from "@deskto/settings"

import { keyboardPlatform } from "../lib/platform.js"
import { useSettingValue } from "./settings-context.js"

const modalRoot = '[role="dialog"], [role="alertdialog"]'

/**
 * Fires `onTrigger` when the keybinding this setting holds is pressed
 * anywhere in the window. Pass a stable callback; a new identity rebinds.
 */
export function useKeybinding(
  definition: SettingDefinition<string>,
  onTrigger: () => void
): void {
  const binding = useSettingValue(definition)

  useEffect(() => {
    const parsed = parseKeybinding(binding)
    if (!parsed) return

    const platform = keyboardPlatform()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      // A dialog holds focus, so a keydown from inside one would change the
      // screen behind it while the person is still answering it.
      if (event.target instanceof Element && event.target.closest(modalRoot))
        return
      if (!matchesKeybinding(parsed, event, platform)) return
      event.preventDefault()
      onTrigger()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [binding, onTrigger])
}

/**
 * The same binding written the way this platform writes shortcuts (⌘N, Ctrl+N),
 * for buttons that want to teach their shortcut. Empty when the binding is
 * cleared, so callers can skip the hint.
 */
export function useKeybindingLabel(
  definition: SettingDefinition<string>
): string {
  const binding = useSettingValue(definition)
  return parseKeybinding(binding)
    ? formatKeybinding(binding, keyboardPlatform())
    : ""
}

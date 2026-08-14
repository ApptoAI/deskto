import { useEffect } from "react"
import {
  matchesKeybinding,
  parseKeybinding,
  type SettingDefinition,
} from "@openappto/settings"

import { keyboardPlatform } from "../lib/platform.js"
import { useSettingValue } from "./settings-context.js"

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
      if (!matchesKeybinding(parsed, event, platform)) return
      event.preventDefault()
      onTrigger()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [binding, onTrigger])
}

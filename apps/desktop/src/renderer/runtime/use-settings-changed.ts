import { useRuntimeEvent } from "./use-runtime-event.js"

/**
 * Runs `onChange` when the Runtime reports that settings moved. Pass a stable
 * callback; a new identity resubscribes.
 */
export function useSettingsChanged(onChange: () => void): void {
  useRuntimeEvent("settings.changed", onChange)
}

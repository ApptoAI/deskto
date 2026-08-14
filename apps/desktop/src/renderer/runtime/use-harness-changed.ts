import { useRuntimeEvent } from "./use-runtime-event.js"

/**
 * Runs `onChange` when the Runtime reports that harness state moved. Pass a
 * stable callback; a new identity resubscribes.
 */
export function useHarnessChanged(onChange: () => void): void {
  useRuntimeEvent("harness.changed", onChange)
}

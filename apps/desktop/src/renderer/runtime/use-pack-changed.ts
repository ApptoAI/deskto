import { useRuntimeEvent } from "./use-runtime-event.js"

/**
 * Runs `onChange` when the Runtime reports that packs or their attachments
 * moved. Pass a stable callback; a new identity resubscribes.
 */
export function usePackChanged(onChange: () => void): void {
  useRuntimeEvent("pack.changed", onChange)
}

import { useRuntimeEvent } from "./use-runtime-event.js"

/**
 * Runs `onChange` when the Runtime reports that workspaces or projects moved.
 * Pass a stable callback; a new identity resubscribes.
 */
export function useWorkspaceChanged(onChange: () => void): void {
  useRuntimeEvent("workspace.changed", onChange)
}

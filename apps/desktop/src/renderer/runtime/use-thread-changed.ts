import { useCallback } from "react"

import { useRuntimeEvent } from "./use-runtime-event.js"

/**
 * Runs `onChange` when the Runtime reports that a task moved on. Pass a stable
 * callback; a new identity resubscribes.
 */
export function useThreadChanged(onChange: (threadId: string) => void): void {
  useRuntimeEvent(
    "thread.changed",
    useCallback((event) => onChange(event.threadId), [onChange])
  )
}

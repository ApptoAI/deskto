import { useCallback } from "react"

import { useRuntimeEvent } from "./use-runtime-event.js"

/**
 * Runs `onDelete` when the Runtime reports that a task is gone. Pass a stable
 * callback; a new identity resubscribes.
 */
export function useThreadDeleted(onDelete: (threadId: string) => void): void {
  useRuntimeEvent(
    "thread.deleted",
    useCallback((event) => onDelete(event.threadId), [onDelete])
  )
}

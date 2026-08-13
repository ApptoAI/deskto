import { useEffect } from "react"

import { useRuntimeClient } from "./runtime-client-context.js"

/**
 * Runs `onChange` when the Runtime reports that a task moved on. Pass a stable
 * callback; a new identity resubscribes.
 */
export function useThreadChanged(onChange: (threadId: string) => void): void {
  const client = useRuntimeClient()

  useEffect(
    () =>
      client.subscribe((event) => {
        if (event.type === "thread.changed") onChange(event.threadId)
      }),
    [client, onChange]
  )
}

import { useEffect } from "react"

import { useRuntimeClient } from "./runtime-client-context.js"

/**
 * Runs `onChange` when the Runtime reports that harness state moved. Pass a
 * stable callback; a new identity resubscribes.
 */
export function useHarnessChanged(onChange: () => void): void {
  const client = useRuntimeClient()

  useEffect(
    () =>
      client.subscribe((event) => {
        if (event.type === "harness.changed") onChange()
      }),
    [client, onChange]
  )
}

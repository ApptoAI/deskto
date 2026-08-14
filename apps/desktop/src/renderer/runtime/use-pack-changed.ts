import { useEffect } from "react"

import { useRuntimeClient } from "./runtime-client-context.js"

/**
 * Runs `onChange` when the Runtime reports that packs or their attachments
 * moved. Pass a stable callback; a new identity resubscribes.
 */
export function usePackChanged(onChange: () => void): void {
  const client = useRuntimeClient()

  useEffect(
    () =>
      client.subscribe((event) => {
        if (event.type === "pack.changed") onChange()
      }),
    [client, onChange]
  )
}

import { useEffect } from "react"

import { useRuntimeClient } from "./runtime-client-context.js"

/**
 * Runs `onChange` when the Runtime reports that settings moved. Pass a stable
 * callback; a new identity resubscribes.
 */
export function useSettingsChanged(onChange: () => void): void {
  const client = useRuntimeClient()

  useEffect(
    () =>
      client.subscribe((event) => {
        if (event.type === "settings.changed") onChange()
      }),
    [client, onChange]
  )
}

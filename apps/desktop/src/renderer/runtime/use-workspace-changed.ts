import { useEffect } from "react"

import { useRuntimeClient } from "./runtime-client-context.js"

/**
 * Runs `onChange` when the Runtime reports that workspaces or projects moved.
 * Pass a stable callback; a new identity resubscribes.
 */
export function useWorkspaceChanged(onChange: () => void): void {
  const client = useRuntimeClient()

  useEffect(
    () =>
      client.subscribe((event) => {
        if (event.type === "workspace.changed") onChange()
      }),
    [client, onChange]
  )
}

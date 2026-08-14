import { useEffect } from "react"
import type { RuntimeEvent } from "@openappto/protocol"

import { useRuntimeClient } from "./runtime-client-context.js"

/**
 * Runs `onEvent` for every runtime event of one type. Pass a stable callback;
 * a new identity resubscribes.
 */
export function useRuntimeEvent<T extends RuntimeEvent["type"]>(
  type: T,
  onEvent: (event: Extract<RuntimeEvent, { type: T }>) => void
): void {
  const client = useRuntimeClient()

  useEffect(
    () =>
      client.subscribe((event) => {
        if (event.type === type)
          onEvent(event as Extract<RuntimeEvent, { type: T }>)
      }),
    [client, type, onEvent]
  )
}

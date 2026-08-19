import { useCallback, useState } from "react"

import { describedErrorSchema } from "../runtime/describe-error.js"

/**
 * One funnel for user-triggered mutations. `tryAction` shows failures in the
 * inline error strip and rethrows for callers that hold UI open on failure (a
 * dialog, a busy flag); `runAction` is the fire-and-forget flavor for callers
 * with nothing to roll back.
 */
export function useActionError() {
  const [actionError, setActionError] = useState<string | null>(null)

  const tryAction = useCallback(
    async <T>(action: () => Promise<T>): Promise<T> => {
      setActionError(null)
      try {
        return await action()
      } catch (error) {
        setActionError(describedErrorSchema.parse(error))
        throw error
      }
    },
    []
  )

  const runAction = useCallback(
    <T>(action: () => Promise<T>) => {
      tryAction(action).catch(() => {
        // Already surfaced through the error strip.
      })
    },
    [tryAction]
  )

  return { actionError, tryAction, runAction }
}

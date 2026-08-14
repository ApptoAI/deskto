import { useCallback, useEffect, useRef } from "react"
import { applyThreadDelta } from "@openappto/client"
import type { ThreadView } from "@openappto/protocol"

import { useRuntimeClient } from "./runtime-client-context.js"
import { useRuntimeEvent } from "./use-runtime-event.js"
import { useRuntimeQuery, type RuntimeQuery } from "./use-runtime-query.js"
import { useThreadChanged } from "./use-thread-changed.js"

/**
 * Holds one Thread view and keeps it current. High-frequency changes arrive
 * as `thread.delta` events and fold into the held view in place; lifecycle
 * transitions arrive as `thread.changed` and reload it. Any delta the fold
 * cannot place safely also falls back to a reload, so the Runtime stays the
 * source of truth (ADR 0004).
 */
export function useThreadView(threadId: string): RuntimeQuery<ThreadView> {
  const client = useRuntimeClient()
  const load = useCallback(() => client.getThread(threadId), [client, threadId])
  const query = useRuntimeQuery(load)

  // The delta handler writes the ref itself, so a burst of deltas inside one
  // React commit folds sequentially instead of tripping the sequence guard.
  // The effect re-baselines it whenever a load or reload lands.
  const viewRef = useRef<ThreadView | undefined>(undefined)
  const view = query.state.status === "ready" ? query.state.data : undefined
  useEffect(() => {
    viewRef.current = view
  }, [view])

  const { replace, revalidate } = query
  useRuntimeEvent(
    "thread.delta",
    useCallback(
      (event) => {
        if (event.threadId !== threadId) return
        const view = viewRef.current
        if (!view) return
        const result = applyThreadDelta(view, event)
        if (result.outcome === "applied") {
          viewRef.current = result.view
          replace(result.view)
        } else if (result.outcome === "gap") {
          revalidate()
        }
      },
      [threadId, replace, revalidate]
    )
  )

  useThreadChanged(
    useCallback(
      (changedThreadId: string) => {
        if (changedThreadId === threadId) revalidate()
      },
      [threadId, revalidate]
    )
  )

  return query
}

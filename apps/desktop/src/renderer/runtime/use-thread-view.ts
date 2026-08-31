import { useCallback, useEffect, useRef } from "react"
import { applyThreadDelta } from "@deskto/client"
import type { ThreadView } from "@deskto/protocol"

import { useRuntimeClient } from "./runtime-client-context.js"
import { useRuntimeEvent } from "./use-runtime-event.js"
import { useRuntimeQuery, type RuntimeQuery } from "./use-runtime-query.js"
import { useThreadChanged } from "./use-thread-changed.js"

const cachedViews = new Map<string, ThreadView>()
const MAX_CACHED_VIEWS = 20

/** Makes a locally selected task available before its screen replaces the old one. */
export function primeThreadView(view: ThreadView): void {
  cachedViews.delete(view.thread.id)
  cachedViews.set(view.thread.id, view)
  if (cachedViews.size > MAX_CACHED_VIEWS) {
    const oldest = cachedViews.keys().next()
    if (!oldest.done) cachedViews.delete(oldest.value)
  }
}

/**
 * Holds one Thread view and keeps it current. High-frequency changes arrive
 * as `thread.delta` events and fold into the held view in place; lifecycle
 * transitions arrive as `thread.changed` and reload it. Any delta the fold
 * cannot place safely also falls back to a reload, so the Runtime stays the
 * source of truth (ADR 0004).
 */
export function useThreadView(threadId: string): RuntimeQuery<ThreadView> {
  const client = useRuntimeClient()

  // The delta handler writes the ref itself, so a burst of deltas inside one
  // React commit folds sequentially instead of tripping the sequence guard.
  // The effect re-baselines it whenever a load, reload, or mutation lands.
  const viewRef = useRef<ThreadView | undefined>(undefined)

  // A reload can resolve with a snapshot older than deltas folded while it
  // was in flight; keeping the newer view prevents a brief step backwards.
  const load = useCallback(async () => {
    const fetched = await client.getThread(threadId)
    const held = viewRef.current
    return held &&
      held.thread.id === fetched.thread.id &&
      held.seq > fetched.seq
      ? held
      : fetched
  }, [client, threadId])
  const query = useRuntimeQuery(load, cachedViews.get(threadId))

  const view = query.state.status === "ready" ? query.state.data : undefined
  useEffect(() => {
    viewRef.current = view
    if (view) primeThreadView(view)
  }, [view])

  const { patch, revalidate } = query
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
          // patch, not replace: replace would cancel a reload the runtime
          // asked for through thread.changed, and a folded delta can never
          // bring back what only that reload carries (a pending approval).
          patch(result.view)
        } else if (result.outcome === "gap") {
          revalidate()
        }
      },
      [threadId, patch, revalidate]
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

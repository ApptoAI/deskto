import { useCallback, useEffect, useRef, useState } from "react"

import { describeError } from "./describe-error.js"

export type QueryState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T }

export type RuntimeQuery<T> = {
  state: QueryState<T>
  /** Re-reads without clearing what is already on screen. */
  revalidate: () => void
  /** Applies a response a mutation already returned. */
  replace: (data: T) => void
}

type Load<T> = (() => Promise<T>) | null

function startingState<T>(load: Load<T>): QueryState<T> {
  return load ? { status: "loading" } : { status: "idle" }
}

/**
 * Reads Runtime state through a `load` function. Pass `null` to stand down, for
 * example while no project is selected. `load` must be stable; a new identity
 * starts a fresh read and drops any answer still in flight.
 */
export function useRuntimeQuery<T>(load: Load<T>): RuntimeQuery<T> {
  const [snapshot, setSnapshot] = useState(() => ({
    load,
    state: startingState<T>(load),
  }))
  const latestRequest = useRef(0)

  if (snapshot.load !== load) {
    setSnapshot({ load, state: startingState(load) })
  }

  const read = useCallback((nextLoad: Load<T>) => {
    const request = ++latestRequest.current
    if (!nextLoad) return

    nextLoad().then(
      (data) => {
        if (request === latestRequest.current) {
          setSnapshot((current) =>
            current.load === nextLoad
              ? { load: nextLoad, state: { status: "ready", data } }
              : current
          )
        }
      },
      (error: unknown) => {
        if (request === latestRequest.current) {
          setSnapshot((current) =>
            current.load === nextLoad
              ? {
                  load: nextLoad,
                  state: { status: "error", message: describeError(error) },
                }
              : current
          )
        }
      }
    )
  }, [])

  useEffect(() => {
    read(load)
    return () => {
      latestRequest.current += 1
    }
  }, [load, read])

  const revalidate = useCallback(() => read(load), [load, read])

  const replace = useCallback(
    (data: T) => {
      latestRequest.current += 1
      setSnapshot({ load, state: { status: "ready", data } })
    },
    [load]
  )

  return {
    state: snapshot.load === load ? snapshot.state : startingState(load),
    revalidate,
    replace,
  }
}

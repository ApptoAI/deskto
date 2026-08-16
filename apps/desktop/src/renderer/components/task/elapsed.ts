import { useEffect, useMemo, useState } from "react"

/**
 * Milliseconds since `since`, ticking while the caller stays mounted. The
 * cadence drops to a second past the first minute: tenths stop being readable
 * long before a run does, and a 100ms interval running for ten minutes is a
 * render loop nobody asked for.
 */
export function useElapsed(since?: string): number {
  const [mountedAt] = useState(() => Date.now())
  const start = useMemo(() => {
    const parsed = since ? Date.parse(since) : Number.NaN
    return Number.isNaN(parsed) ? mountedAt : parsed
  }, [mountedAt, since])
  const [now, setNow] = useState(() => Date.now())
  const coarse = now - start >= 60_000
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), coarse ? 1000 : 100)
    return () => window.clearInterval(id)
  }, [coarse])
  return Math.max(0, now - start)
}

/**
 * A duration read as `4s` or `1m 12s`. `precise` keeps tenths under a minute,
 * which is what a live counter needs to look alive and a settled one does not.
 */
export function formatElapsed(
  milliseconds: number,
  { precise = false }: { precise?: boolean } = {}
): string {
  const total = Math.max(0, milliseconds) / 1000
  if (total < 60)
    return precise ? `${total.toFixed(1)}s` : `${Math.round(total)}s`
  return `${Math.floor(total / 60)}m ${Math.floor(total % 60)}s`
}

/** The same duration between two timestamps, for work that has already ended. */
export function elapsedBetween(
  since: string,
  until: string | undefined
): number | undefined {
  const start = Date.parse(since)
  const end = until ? Date.parse(until) : Number.NaN
  if (Number.isNaN(start) || Number.isNaN(end)) return undefined
  return Math.max(0, end - start)
}

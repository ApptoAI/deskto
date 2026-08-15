import { useEffect, useMemo, useState } from "react"

/**
 * Loading state for long-running agent work: a 3×3 pixel grid with a
 * chevron wavefront driving right, a shimmering label and a live elapsed
 * timer. The 650ms cycle is shorter than the sweep, so two fronts are
 * always in flight. Reduced motion freezes the grid to its dim state and
 * the label to static muted; the timer still ticks.
 */

// Chevron wavefront: delay grows with column and distance from the middle row.
const CELL_DELAYS = Array.from({ length: 9 }, (_, index) => {
  const row = Math.floor(index / 3)
  const column = index % 3
  return (column + Math.abs(row - 1)) * 90
})

/** Elapsed time since `since` (fallback: mount), formatted like 4.2s / 1m 12s. */
function useElapsed(since?: string): string {
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
  const total = Math.max(0, now - start) / 1000
  if (total < 60) return `${total.toFixed(1)}s`
  return `${Math.floor(total / 60)}m ${Math.floor(total % 60)}s`
}

export function WorkingIndicator({
  label = "Working",
  since,
}: {
  label?: string
  since?: string | undefined
}) {
  const elapsed = useElapsed(since)
  return (
    <div className="flex w-fit items-center gap-2.5">
      <span aria-hidden className="grid grid-cols-[repeat(3,4px)] gap-[1.5px]">
        {CELL_DELAYS.map((delay, index) => (
          <span
            key={index}
            className="size-1 rounded-[1px] bg-foreground opacity-15 motion-safe:animate-[pixel-on_650ms_ease-in-out_infinite]"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </span>
      <span aria-hidden className="shimmer-label text-[13px] font-medium">
        {label}
      </span>
      <span
        aria-hidden
        className="font-mono text-xs text-muted-foreground/70 tabular-nums"
      >
        {elapsed}
      </span>
      <span role="status" className="sr-only">
        {label}…
      </span>
    </div>
  )
}

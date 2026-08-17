import { formatElapsed, useElapsed } from "./elapsed.js"

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

export function WorkingIndicator({
  label = "Working",
  since,
}: {
  label?: string
  since?: string | undefined
}) {
  // Tenths, unlike the Turn headers: this indicator's whole job is to say the
  // agent is still there, and a number that only moves once a second does not.
  const elapsed = formatElapsed(useElapsed(since), { precise: true })
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
      <span aria-hidden className="shimmer-label text-ui font-medium">
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

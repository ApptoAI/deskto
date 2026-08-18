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

export function progressSilenceLabel(
  elapsedMs: number,
  since?: string,
  lastSignalAt?: string
): string | undefined {
  const startedAt = since ? Date.parse(since) : Number.NaN
  const signalledAt = lastSignalAt ? Date.parse(lastSignalAt) : Number.NaN
  if (Number.isNaN(startedAt) || Number.isNaN(signalledAt)) return undefined
  const silenceMs = Math.max(0, startedAt + elapsedMs - signalledAt)
  return silenceMs >= 10_000 ? formatElapsed(silenceMs) : undefined
}

export function progressStatusText(
  label: string,
  noRecentUpdate: boolean
): string {
  return `${label}…${noRecentUpdate ? " No recent update." : ""}`
}

export function WorkingIndicator({
  label = "Working",
  since,
  lastSignalAt,
}: {
  label?: string | undefined
  since?: string | undefined
  lastSignalAt?: string | undefined
}) {
  // Tenths, unlike the Turn headers: this indicator's whole job is to say the
  // agent is still there, and a number that only moves once a second does not.
  const elapsedMs = useElapsed(since)
  const elapsed = formatElapsed(elapsedMs, { precise: true })
  const silenceLabel = progressSilenceLabel(elapsedMs, since, lastSignalAt)
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
      {silenceLabel ? (
        <span aria-hidden className="text-micro text-muted-foreground">
          No update for {silenceLabel}
        </span>
      ) : null}
      <span role="status" className="sr-only">
        {progressStatusText(label, Boolean(silenceLabel))}
      </span>
    </div>
  )
}

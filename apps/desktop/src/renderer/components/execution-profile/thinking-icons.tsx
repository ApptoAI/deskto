import SparklesIcon from "lucide-react/dist/esm/icons/sparkles"

import { cn } from "@workspace/ui/lib/utils"

/**
 * Reasoning effort reads as a level, so it draws as one: four rising bars
 * filled up to the chosen depth. The rank comes from the order the harness
 * lists its efforts in, not from their names — every provider invents its
 * own top rung ("xhigh", "max", "ultra"), and a name map would rank the
 * ones it had never heard of below the ones it had.
 */
export function ThinkingIcon({ level }: { level: number }) {
  return <EffortBars level={level} />
}

/** "Default" defers to the model, so there is no level to draw. */
export function DefaultThinkingIcon() {
  return <SparklesIcon />
}

/**
 * Where one effort sits on the 0–4 scale. "none" is always empty; the rest
 * spread across the four bars in listed order, so the top effort always
 * fills them regardless of how many rungs the harness offers.
 */
export function effortRank(effort: string, efforts: readonly string[]): number {
  if (effort === "none") return 0
  const ranked = efforts.filter((candidate) => candidate !== "none")
  const index = ranked.indexOf(effort)
  if (index === -1 || ranked.length === 0) return 2
  if (ranked.length === 1) return 4
  return 1 + Math.round((index / (ranked.length - 1)) * 3)
}

const bars = [
  { x: 1.5, y: 10.5 },
  { x: 6, y: 8 },
  { x: 10.5, y: 5.5 },
  { x: 15, y: 3 },
]

function EffortBars({ level }: { level: number }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden className="size-4">
      {bars.map((bar, index) => (
        <rect
          key={bar.x}
          x={bar.x}
          y={bar.y}
          width="3.5"
          height={17 - bar.y}
          rx="1.25"
          className={cn("fill-current", index >= level && "opacity-25")}
        />
      ))}
    </svg>
  )
}

import type { ContextUsage } from "@openappto/protocol"

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"

const radius = 9.75
const circumference = 2 * Math.PI * radius

export function ContextUsageMeter({ usage }: { usage: ContextUsage }) {
  const percentage = usage.maxTokens
    ? Math.min(100, (usage.usedTokens / usage.maxTokens) * 100)
    : 0
  const nearLimit = percentage > 90
  const label = usage.maxTokens
    ? `Context ${Math.round(percentage)}% used, ${formatTokens(usage.usedTokens)} of ${formatTokens(usage.maxTokens)} tokens`
    : `Context ${formatTokens(usage.usedTokens)} tokens used`

  return (
    <Tooltip>
      <TooltipTrigger
        type="button"
        delay={150}
        aria-label={label}
        className="flex size-7 cursor-default items-center justify-center rounded-md outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden
          className={cn(
            "size-4 -rotate-90",
            nearLimit ? "text-destructive" : "text-muted-foreground"
          )}
        >
          <circle
            cx="12"
            cy="12"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.25"
            strokeWidth="3"
          />
          <circle
            cx="12"
            cy="12"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - percentage / 100)}
            className="transition-[stroke-dashoffset] duration-500 ease-out motion-reduce:transition-none"
          />
        </svg>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function formatTokens(value: number): string {
  if (value < 1_000) return `${Math.round(value)}`
  const thousands = Math.round(value / 1_000)
  if (thousands < 1_000) return `${thousands}k`
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
}

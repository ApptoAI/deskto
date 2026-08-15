import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"

type PlanStepStatus = "pending" | "active" | "done"

/**
 * The agent's working plan as a task card: circle status glyphs per step —
 * dashed ring for pending, spinning arc for active, filled check for done.
 * Purely presentational: callers pass plain steps, this component knows
 * nothing about the protocol.
 */
function Plan({
  title,
  steps,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  title: string
  steps: { text: string; status: PlanStepStatus }[]
}) {
  const done = steps.filter((step) => step.status === "done").length

  return (
    <div
      data-slot="plan"
      className={cn(
        "rounded-xl bg-card px-3.5 py-3 text-xs shadow-xs ring-1 ring-border/60",
        className
      )}
      {...props}
    >
      <p className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-medium">{title}</span>
        <span className="text-muted-foreground tabular-nums">
          {done}/{steps.length}
        </span>
      </p>
      <ol className="flex flex-col gap-1.5">
        {steps.map((step, index) => (
          <PlanStepRow key={index} text={step.text} status={step.status} />
        ))}
      </ol>
    </div>
  )
}

function PlanStepRow({
  text,
  status,
}: {
  text: string
  status: PlanStepStatus
}) {
  return (
    <li
      data-status={status}
      className={cn(
        "flex min-w-0 items-center gap-2.5",
        status === "pending" && "text-muted-foreground",
        status === "done" && "text-muted-foreground line-through"
      )}
    >
      <StepGlyph status={status} />
      <span className="min-w-0 truncate">{text}</span>
    </li>
  )
}

function StepGlyph({ status }: { status: PlanStepStatus }) {
  if (status === "done") {
    return (
      <span
        aria-hidden
        className="flex size-4 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white dark:bg-emerald-600"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-2.5"
        >
          <path d="M20 6L9 17l-5-5" />
        </svg>
      </span>
    )
  }
  if (status === "active") {
    return (
      <svg
        viewBox="0 0 16 16"
        aria-hidden
        className="size-4 shrink-0 animate-spin [animation-duration:1.1s]"
      >
        <circle
          cx="8"
          cy="8"
          r="6.5"
          fill="none"
          strokeWidth="1.8"
          className="stroke-border"
        />
        <circle
          cx="8"
          cy="8"
          r="6.5"
          fill="none"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeDasharray="11.4 29.4"
          className="stroke-foreground"
        />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="size-4 shrink-0">
      <circle
        cx="8"
        cy="8"
        r="6.5"
        fill="none"
        strokeWidth="1.5"
        strokeDasharray="2.8 2.5"
        strokeLinecap="round"
        className="stroke-muted-foreground/60"
      />
    </svg>
  )
}

export { Plan, type PlanStepStatus }

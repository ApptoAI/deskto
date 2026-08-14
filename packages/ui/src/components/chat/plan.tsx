import * as React from "react"
import { CheckIcon, CircleIcon, LoaderCircleIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

type PlanStepStatus = "pending" | "active" | "done"

/**
 * Restrained checklist for an agent's working plan. Purely presentational:
 * callers pass plain steps, this component knows nothing about the protocol.
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
        "rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5 text-xs",
        className
      )}
      {...props}
    >
      <p className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="font-medium">{title}</span>
        <span className="text-muted-foreground">
          {done}/{steps.length}
        </span>
      </p>
      <ol className="flex flex-col gap-1">
        {steps.map((step, index) => (
          <PlanStepRow key={index} text={step.text} status={step.status} />
        ))}
      </ol>
    </div>
  )
}

const stepIcons: Record<PlanStepStatus, typeof CheckIcon> = {
  pending: CircleIcon,
  active: LoaderCircleIcon,
  done: CheckIcon,
}

function PlanStepRow({
  text,
  status,
}: {
  text: string
  status: PlanStepStatus
}) {
  const Icon = stepIcons[status]

  return (
    <li
      data-status={status}
      className={cn(
        "flex min-w-0 items-center gap-2",
        status === "pending" && "text-muted-foreground",
        status === "done" && "text-muted-foreground line-through"
      )}
    >
      <Icon
        aria-hidden
        className={cn(
          "size-3.5 shrink-0",
          status === "active" &&
            "animate-spin text-foreground [animation-duration:0.9s]",
          status !== "active" && "text-muted-foreground"
        )}
      />
      <span className="min-w-0 truncate">{text}</span>
    </li>
  )
}

export { Plan, type PlanStepStatus }

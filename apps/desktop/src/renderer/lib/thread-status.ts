import type { Thread } from "@deskto/protocol"

type StatusPresentation = {
  label: string
  dotClassName: string
  textClassName: string
}

const presentations = {
  idle: {
    label: "Ready",
    dotClassName: "bg-muted-foreground/50",
    textClassName: "text-muted-foreground",
  },
  running: {
    label: "Working",
    dotClassName: "animate-pulse bg-chart-1",
    textClassName: "text-foreground",
  },
  "waiting-approval": {
    label: "Needs your answer",
    dotClassName: "bg-chart-1",
    textClassName: "text-foreground",
  },
  failed: {
    label: "Stopped with an error",
    dotClassName: "bg-destructive",
    textClassName: "text-destructive",
  },
} satisfies Record<Thread["status"], StatusPresentation>

export function describeThreadStatus(
  status: Thread["status"]
): StatusPresentation {
  return presentations[status]
}

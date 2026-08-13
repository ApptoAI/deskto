import type { Thread } from "@openappto/protocol"

type StatusPresentation = {
  label: string
  dotClassName: string
  textClassName: string
}

const presentations: Record<Thread["status"], StatusPresentation> = {
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
}

export function describeThreadStatus(
  status: Thread["status"]
): StatusPresentation {
  return presentations[status]
}

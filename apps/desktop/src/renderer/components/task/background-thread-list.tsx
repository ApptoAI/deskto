import CircleCheckIcon from "lucide-react/dist/esm/icons/circle-check"
import CircleEllipsisIcon from "lucide-react/dist/esm/icons/circle-ellipsis"
import CircleIcon from "lucide-react/dist/esm/icons/circle"
import CircleStopIcon from "lucide-react/dist/esm/icons/circle-stop"
import CircleXIcon from "lucide-react/dist/esm/icons/circle-x"
import GitBranchIcon from "lucide-react/dist/esm/icons/git-branch"
import type { Thread } from "@deskto/protocol"

import { cn } from "@workspace/ui/lib/utils"

type BackgroundState =
  | "failed"
  | "working"
  | "needs-input"
  | "finished"
  | "stopped"
  | "ready"

export function backgroundState(thread: Thread): BackgroundState {
  if (thread.status === "failed") return "failed"
  if (thread.status === "running") return "working"
  if (thread.status === "waiting-approval") return "needs-input"
  if (
    thread.lastTurnCompletedAt &&
    (!thread.lastUserMessageAt ||
      thread.lastTurnCompletedAt >= thread.lastUserMessageAt)
  )
    return "finished"
  if (thread.lastUserMessageAt) return "stopped"
  return "ready"
}

function BackgroundStatus({ state }: { state: BackgroundState }) {
  if (state === "failed") {
    return (
      <CircleXIcon aria-label="Failed" className="size-3.5 text-destructive" />
    )
  }
  if (state === "working" || state === "needs-input") {
    return (
      <CircleEllipsisIcon
        aria-label={state === "needs-input" ? "Needs input" : "Working"}
        className="size-3.5 animate-pulse text-muted-foreground"
      />
    )
  }
  if (state === "finished")
    return (
      <CircleCheckIcon
        aria-label="Finished"
        className="size-3.5 text-foreground"
      />
    )
  if (state === "stopped")
    return (
      <CircleStopIcon
        aria-label="Stopped"
        className="size-3.5 text-muted-foreground"
      />
    )
  return (
    <CircleIcon aria-label="Ready" className="size-3.5 text-muted-foreground" />
  )
}

const backgroundStateLabels = {
  failed: "Failed",
  working: "Working",
  "needs-input": "Needs input",
  finished: "Finished",
  stopped: "Stopped",
  ready: "Ready",
} satisfies Record<BackgroundState, string>

export function BackgroundThreadList({
  threads,
  onOpenThread,
  compact = false,
}: {
  threads: Thread[]
  onOpenThread: (threadId: string) => void
  compact?: boolean
}) {
  if (threads.length === 0) return null

  return (
    <section className={cn("flex flex-col", compact ? "gap-px" : "gap-2")}>
      {!compact ? (
        <h3 className="px-0.5 eyebrow text-muted-foreground">
          Background tasks
        </h3>
      ) : null}
      {threads.map((thread) => {
        const state = backgroundState(thread)
        return (
          <button
            key={thread.id}
            type="button"
            onClick={() => onOpenThread(thread.id)}
            className={cn(
              "flex w-full cursor-pointer items-center gap-2 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
              compact
                ? "rounded-md px-1.5 py-1.5 hover:bg-muted/40"
                : "rounded-xl bg-card px-3 py-2.5 ring-1 ring-border/60 hover:bg-muted/40"
            )}
          >
            <span className="relative flex size-5 shrink-0 items-center justify-center">
              <GitBranchIcon
                aria-hidden
                className="size-4 text-muted-foreground"
              />
              <span className="absolute -right-1 -bottom-1 rounded-full bg-card">
                <BackgroundStatus state={state} />
              </span>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium">
                {thread.title}
              </span>
              <span className="block text-[11px] text-muted-foreground">
                {backgroundStateLabels[state]}
              </span>
            </span>
          </button>
        )
      })}
    </section>
  )
}

import type { Thread } from "@openappto/protocol"

import { cn } from "@workspace/ui/lib/utils"
import { Button } from "@workspace/ui/components/button"

import { formatAge, formatExactTime } from "../../lib/format-time.js"
import { describeThreadStatus } from "../../lib/thread-status.js"
import type { QueryState } from "../../runtime/use-runtime-query.js"

export function TaskList({
  state,
  openThreadId,
  onOpenThread,
  onRetry,
}: {
  state: QueryState<Thread[]>
  openThreadId: string | null
  onOpenThread: (threadId: string) => void
  onRetry: () => void
}) {
  if (state.status === "idle") return null

  if (state.status === "loading") {
    return (
      <ul className="space-y-1 px-2" aria-label="Loading tasks">
        {[0, 1, 2].map((row) => (
          <li key={row} className="h-8 animate-pulse rounded-lg bg-muted/40" />
        ))}
      </ul>
    )
  }

  if (state.status === "error") {
    return (
      <div className="space-y-2 px-3 py-2">
        <p className="text-sm text-destructive">{state.message}</p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </div>
    )
  }

  if (state.data.length === 0) {
    return (
      <p className="px-3 py-2 text-sm text-muted-foreground">No tasks yet.</p>
    )
  }

  return (
    <ul className="space-y-0.5 px-2">
      {state.data.map((thread) => {
        const status = describeThreadStatus(thread.status)
        const isOpen = thread.id === openThreadId

        return (
          <li key={thread.id}>
            <button
              type="button"
              onClick={() => onOpenThread(thread.id)}
              aria-current={isOpen ? "true" : undefined}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors outline-none hover:bg-muted/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
                isOpen && "bg-muted/60 text-foreground"
              )}
            >
              {thread.status === "idle" ? null : (
                <span
                  aria-hidden
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    status.dotClassName
                  )}
                />
              )}
              <span className="min-w-0 flex-1 truncate">{thread.title}</span>
              <span
                className="shrink-0 text-xs text-muted-foreground/70 tabular-nums"
                title={formatExactTime(thread.updatedAt)}
              >
                {formatAge(thread.updatedAt)}
              </span>
              {thread.status === "idle" ? null : (
                <span className="sr-only">{status.label}</span>
              )}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

import { memo, useMemo } from "react"
import PanelRightIcon from "lucide-react/dist/esm/icons/panel-right"
import type { Activity, Thread } from "@deskto/protocol"

import { Plan } from "@workspace/ui/components/chat/plan"
import { cn } from "@workspace/ui/lib/utils"

import { AgentElapsed, SubagentBadge } from "./activity-rows.js"
import { summarizeActivities, type ActivityNode } from "./activity-tree.js"
import { BackgroundThreadList } from "./background-thread-list.js"

/**
 * The task's state beside its conversation: the plan it is working to and the
 * agents working on it. It takes its own column rather than covering the
 * thread, and it gives that column up the moment the full panel opens — the
 * two are the same information at two sizes, and showing both is showing it
 * twice.
 *
 * Its header and agent rows open the same information in the full panel.
 */
export const ActivityAside = memo(function ActivityAside({
  activities,
  childThreads = [],
  onOpen,
  onOpenThread = () => undefined,
}: {
  activities: Activity[]
  childThreads?: Thread[]
  onOpen: () => void
  onOpenThread?: (threadId: string) => void
}) {
  const { agents, plan, working } = useMemo(
    () => summarizeActivities(activities),
    [activities]
  )
  const runningThreads = childThreads.filter(
    (thread) =>
      thread.status === "running" || thread.status === "waiting-approval"
  ).length
  if (!plan && agents.length === 0 && childThreads.length === 0) return null

  return (
    <aside className="hidden w-76 shrink-0 flex-col pt-4 pr-4 pb-6 lg:flex">
      <div className="glass-popover flex max-h-full min-h-0 w-full flex-col overflow-hidden rounded-card">
        <button
          type="button"
          onClick={onOpen}
          className="flex h-9 shrink-0 cursor-pointer items-center gap-2 px-3 text-left transition-colors outline-none hover:bg-fill-chip focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Open activity panel"
        >
          <span className="text-ui font-medium">Activity</span>
          {working + runningThreads > 0 ? (
            <span className="text-micro text-muted-foreground tabular-nums">
              {working + runningThreads} working
            </span>
          ) : null}
          <PanelRightIcon
            aria-hidden
            className="ml-auto size-3.5 text-muted-foreground"
          />
        </button>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {plan?.payload?.kind === "plan" ? (
            <section className="border-t border-border/60 px-3 py-2.5">
              <Plan
                title={plan.name}
                steps={plan.payload.steps}
                wrap
                className="rounded-none bg-transparent p-0 shadow-none ring-0"
              />
            </section>
          ) : null}

          {agents.length > 0 ? (
            <section className="border-t border-border/60 px-1.5 py-2">
              <h3 className="px-1.5 pb-1 text-micro tracking-wide text-muted-foreground uppercase">
                Agents
              </h3>
              <ul className="flex flex-col">
                {agents.map((node) => (
                  <li key={node.activity.id}>
                    <AgentLine node={node} onOpen={onOpen} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {childThreads.length > 0 ? (
            <section className="border-t border-border/60 px-1.5 py-2">
              <h3 className="px-1.5 pb-1 text-micro tracking-wide text-muted-foreground uppercase">
                Background tasks
              </h3>
              <BackgroundThreadList
                threads={childThreads}
                onOpenThread={onOpenThread}
                compact
              />
            </section>
          ) : null}
        </div>
      </div>
    </aside>
  )
})

/** One agent as a line: status, name, and how long it has been at it. */
function AgentLine({
  node,
  onOpen,
}: {
  node: ActivityNode
  onOpen: () => void
}) {
  const activity = node.activity
  const calls = node.children.length
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 text-left transition-colors outline-none hover:bg-fill-chip focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`Open activity for ${activity.name}`}
    >
      <SubagentBadge status={activity.status} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={cn(
            "truncate text-xs font-medium",
            activity.status === "failed" && "text-destructive"
          )}
        >
          {activity.name}
        </span>
        {calls > 0 ? (
          <span className="text-micro text-muted-foreground tabular-nums">
            {calls} tool {calls === 1 ? "call" : "calls"}
          </span>
        ) : null}
      </span>
      <AgentElapsed activity={activity} className="self-start" />
    </button>
  )
}

import { memo, useState } from "react"
import BotIcon from "lucide-react/dist/esm/icons/bot"
import ChevronDownIcon from "lucide-react/dist/esm/icons/chevron-down"

import { Plan } from "@workspace/ui/components/chat/plan"
import { cn } from "@workspace/ui/lib/utils"

import { type ActivityNode, type ActivitySummary } from "./activity-tree.js"
import {
  AgentElapsed,
  ActivityLine,
  Collapse,
  SubagentBadge,
  activityIcon,
} from "./activity-rows.js"

/**
 * The task's work, out of the conversation. A Turn's plan and the agents it
 * spawned are the two things worth watching while a task runs and worth
 * scrolling back through afterwards, and neither belongs inline between a
 * question and its answer.
 */
export const ActivityPanel = memo(function ActivityPanel({
  summary,
  onOpenFiles,
}: {
  summary: ActivitySummary
  onOpenFiles: () => void
}) {
  const { agents, plan, working } = summary
  const settled = agents.length - working

  if (!plan && agents.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <BotIcon aria-hidden className="size-6 text-muted-foreground/60" />
        <p className="text-sm font-medium">Nothing running yet</p>
        <p className="max-w-64 text-xs text-muted-foreground">
          A plan the agent writes, and any agents it puts to work, show up here
          with their own tool calls.{" "}
          <button
            type="button"
            onClick={onOpenFiles}
            className="cursor-pointer underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            Files it changed
          </button>{" "}
          are collected in the Files view.
        </p>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="flex flex-col gap-3">
          {plan?.payload?.kind === "plan" ? (
            <Plan title={plan.name} steps={plan.payload.steps} />
          ) : null}
          {agents.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h3 className="px-0.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                Agents
              </h3>
              {agents.map((node) => (
                <AgentCard key={node.activity.id} node={node} />
              ))}
            </section>
          ) : null}
        </div>
      </div>
      {agents.length > 0 ? (
        <footer className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
          {working > 0 ? (
            <span className="tabular-nums">{working} working</span>
          ) : null}
          {settled > 0 ? (
            <span className="tabular-nums">{settled} settled</span>
          ) : null}
        </footer>
      ) : null}
    </div>
  )
})

/**
 * One agent run: status, name, how long it has been at it, and its own tool
 * calls behind a rail. Open while it works, folded once it settles — and a
 * card the user opened by hand stays open through that change.
 */
function AgentCard({ node }: { node: ActivityNode }) {
  const activity = node.activity
  const running = activity.status === "running"
  const [manual, setManual] = useState<boolean | null>(null)
  const open = manual ?? running
  const agentType =
    activity.payload?.kind === "subagent"
      ? activity.payload.agentType
      : undefined

  return (
    <div className="overflow-hidden rounded-xl bg-card shadow-xs ring-1 ring-border/60">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setManual(!open)}
        className="flex h-10 w-full cursor-pointer items-center gap-2.5 px-3 text-left transition-colors duration-100 outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <SubagentBadge status={activity.status} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
          {activity.name}
        </span>
        <AgentElapsed activity={activity} />
        {agentType ? (
          <span className="inline-flex h-5.5 shrink-0 items-center rounded-md bg-muted/60 px-1.5 font-mono text-[11px] text-muted-foreground ring-1 ring-border/40">
            {agentType}
          </span>
        ) : null}
        <ChevronDownIcon
          aria-hidden
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform duration-300 ease-(--ease-out-quart)",
            open && "rotate-180"
          )}
        />
      </button>
      <Collapse open={open}>
        <div className="grid grid-cols-[16px_1fr] gap-x-2.5 px-3 pb-2.5">
          <span aria-hidden className="mx-auto h-full w-px bg-border" />
          <div className="flex min-w-0 flex-col gap-px">
            {node.children.length > 0 ? (
              node.children.map((child) => (
                <NestedActivity key={child.activity.id} node={child} />
              ))
            ) : (
              <p className="py-1 text-[11px] text-muted-foreground">
                {running
                  ? "Working in a separate context."
                  : activity.status === "completed"
                    ? "Finished in a separate context."
                    : "Failed before finishing."}
              </p>
            )}
          </div>
        </div>
      </Collapse>
    </div>
  )
}

function NestedActivity({ node }: { node: ActivityNode }) {
  if (node.activity.payload?.kind === "subagent") {
    return (
      <div className="py-1">
        <AgentCard node={node} />
      </div>
    )
  }
  if (node.activity.payload?.kind === "plan") {
    return (
      <div className="py-1">
        <Plan title={node.activity.name} steps={node.activity.payload.steps} />
      </div>
    )
  }
  return (
    <ActivityLine activity={node.activity} icon={activityIcon(node.activity)} />
  )
}

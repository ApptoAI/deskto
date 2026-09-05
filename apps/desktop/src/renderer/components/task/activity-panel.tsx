import { memo, useEffect, useRef } from "react"
import BotIcon from "lucide-react/dist/esm/icons/bot"
import ChevronRightIcon from "lucide-react/dist/esm/icons/chevron-right"
import ArrowLeftIcon from "lucide-react/dist/esm/icons/arrow-left"
import type { Thread } from "@deskto/protocol"

import { Plan } from "@workspace/ui/components/chat/plan"

import { type ActivityNode, type ActivitySummary } from "./activity-tree.js"
import {
  AgentElapsed,
  ActivityLine,
  SubagentBadge,
  activityIcon,
} from "./activity-rows.js"
import { BackgroundThreadList } from "./background-thread-list.js"

/**
 * The task's work, out of the conversation. A Turn's plan and the agents it
 * spawned are the two things worth watching while a task runs and worth
 * scrolling back through afterwards, and neither belongs inline between a
 * question and its answer.
 */
export const ActivityPanel = memo(function ActivityPanel({
  summary,
  selectedAgentId,
  onSelectAgent,
  onBack,
  childThreads,
  onOpenThread,
  onOpenFiles,
}: {
  summary: ActivitySummary
  selectedAgentId?: string | undefined
  onSelectAgent: (agentId: string) => void
  onBack: () => void
  childThreads: Thread[]
  onOpenThread: (threadId: string) => void
  onOpenFiles: () => void
}) {
  const { agents, plan, working } = summary
  const settled = agents.length - working
  const selected = selectedAgentId
    ? findAgent(agents, selectedAgentId)
    : undefined

  const agentButtons = useRef(new Map<string, HTMLButtonElement>())
  const returnFocus = useRef<string | null>(null)
  useEffect(() => {
    if (!selected && returnFocus.current) {
      agentButtons.current.get(returnFocus.current)?.focus()
      returnFocus.current = null
    }
  }, [selected])

  function backToActivities() {
    const parent = selectedAgentId
      ? agents.find((node) => findAgent([node], selectedAgentId))
      : undefined
    returnFocus.current = parent?.activity.id ?? null
    onBack()
  }

  if (selected) {
    return (
      <AgentPreview
        node={selected}
        onBack={backToActivities}
        onSelectAgent={onSelectAgent}
      />
    )
  }

  if (!plan && agents.length === 0 && childThreads.length === 0) {
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
            className="cursor-pointer underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
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
              <h3 className="px-0.5 eyebrow text-muted-foreground">Agents</h3>
              {agents.map((node) => (
                <AgentCard
                  key={node.activity.id}
                  node={node}
                  onSelectAgent={onSelectAgent}
                  buttonRef={(button) => {
                    if (button)
                      agentButtons.current.set(node.activity.id, button)
                    else agentButtons.current.delete(node.activity.id)
                  }}
                />
              ))}
            </section>
          ) : null}
          <BackgroundThreadList
            threads={childThreads}
            onOpenThread={onOpenThread}
          />
        </div>
      </div>
      {agents.length > 0 ? (
        <footer className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-1.5 text-micro text-muted-foreground">
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

function findAgent(
  nodes: ActivityNode[],
  id: string
): ActivityNode | undefined {
  for (const node of nodes) {
    if (node.activity.id === id && node.activity.payload?.kind === "subagent")
      return node
    const nested = findAgent(node.children, id)
    if (nested) return nested
  }
  return undefined
}

function AgentCard({
  node,
  onSelectAgent,
  buttonRef,
}: {
  node: ActivityNode
  onSelectAgent: (agentId: string) => void
  buttonRef?: (button: HTMLButtonElement | null) => void
}) {
  const activity = node.activity
  return (
    <button
      type="button"
      ref={buttonRef}
      onClick={() => onSelectAgent(activity.id)}
      aria-label={`Preview ${activity.name}`}
      className="flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-left outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <SubagentBadge status={activity.status} />
      <span className="min-w-0 flex-1 truncate text-ui font-medium">
        {activity.name}
      </span>
      <AgentElapsed activity={activity} />
      <ChevronRightIcon
        aria-hidden
        className="size-4 shrink-0 text-muted-foreground"
      />
    </button>
  )
}

function AgentPreview({
  node,
  onBack,
  onSelectAgent,
}: {
  node: ActivityNode
  onBack: () => void
  onSelectAgent: (agentId: string) => void
}) {
  const activity = node.activity
  const backButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    backButton.current?.focus()
  }, [activity.id])
  const status =
    activity.status === "running"
      ? "Working"
      : activity.status === "completed"
        ? "Finished"
        : "Failed"
  return (
    <section
      aria-label="Agent preview"
      className="flex min-h-0 flex-1 flex-col"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <button
          type="button"
          onClick={onBack}
          ref={backButton}
          aria-label="Back to activities"
          className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeftIcon aria-hidden className="size-4" />
        </button>
        <SubagentBadge status={activity.status} />
        <h3
          className="min-w-0 flex-1 truncate text-ui font-medium"
          title={activity.name}
        >
          {activity.name}
        </h3>
        <span className="shrink-0 text-micro text-muted-foreground">
          Read only
        </span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
          <span role="status">{status}</span>
          <AgentElapsed activity={activity} />
          {activity.payload?.kind === "subagent" &&
          activity.payload.agentType ? (
            <span>{activity.payload.agentType}</span>
          ) : null}
        </div>
        {activity.detail ? (
          <p className="mb-5 text-sm leading-relaxed break-words whitespace-pre-wrap">
            {activity.detail}
          </p>
        ) : null}
        <div className="flex min-w-0 flex-col gap-2">
          {node.children.length > 0 ? (
            node.children.map((child) => (
              <NestedActivity
                key={child.activity.id}
                node={child}
                onSelectAgent={onSelectAgent}
              />
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              {activity.status === "running"
                ? "Waiting for this agent to share its work."
                : "This agent did not share any tool activity."}
            </p>
          )}
        </div>
      </div>
      <footer className="shrink-0 border-t border-border px-4 py-3 text-xs text-muted-foreground">
        Work shared by this agent appears here as it runs. Its full conversation
        is not available.
      </footer>
    </section>
  )
}

function NestedActivity({
  node,
  onSelectAgent,
}: {
  node: ActivityNode
  onSelectAgent: (agentId: string) => void
}) {
  return (
    <div className="min-w-0">
      {node.activity.payload?.kind === "subagent" ? (
        <AgentCard node={node} onSelectAgent={onSelectAgent} />
      ) : (
        <>
          {node.activity.payload?.kind === "plan" ? (
            <Plan
              title={node.activity.name}
              steps={node.activity.payload.steps}
            />
          ) : (
            <ActivityLine
              activity={node.activity}
              icon={activityIcon(node.activity)}
            />
          )}
          {node.children.length > 0 ? (
            <div className="ml-2 border-l border-border pl-3">
              {node.children.map((child) => (
                <NestedActivity
                  key={child.activity.id}
                  node={child}
                  onSelectAgent={onSelectAgent}
                />
              ))}
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}

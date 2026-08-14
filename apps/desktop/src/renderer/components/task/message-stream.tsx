import { memo, useMemo } from "react"
import BotIcon from "lucide-react/dist/esm/icons/bot"
import CircleCheckIcon from "lucide-react/dist/esm/icons/circle-check"
import CircleXIcon from "lucide-react/dist/esm/icons/circle-x"
import FilePenIcon from "lucide-react/dist/esm/icons/file-pen"
import GlobeIcon from "lucide-react/dist/esm/icons/globe"
import LoaderCircleIcon from "lucide-react/dist/esm/icons/loader-circle"
import SearchIcon from "lucide-react/dist/esm/icons/search"
import TerminalIcon from "lucide-react/dist/esm/icons/terminal"
import WrenchIcon from "lucide-react/dist/esm/icons/wrench"
import type { Activity, Message } from "@openappto/protocol"

import { Markdown } from "@workspace/ui/components/chat/markdown"
import {
  Message as MessageRow,
  MessageActivity,
  MessageBody,
} from "@workspace/ui/components/chat/message"
import { MessageList } from "@workspace/ui/components/chat/message-list"
import { Plan } from "@workspace/ui/components/chat/plan"
import { cn } from "@workspace/ui/lib/utils"

import { openExternal } from "../../lib/desktop.js"
import { TurnFailureNotice } from "./turn-failure-notice.js"

type TurnEntry =
  | { kind: "message"; key: string; order: number; message: Message }
  | {
      kind: "activity"
      key: string
      order: number
      activity: Activity
      children: Activity[]
    }

export function MessageStream({
  messages,
  activities,
  running,
}: {
  messages: Message[]
  activities: Activity[]
  running: boolean
}) {
  const lastMessage = messages.at(-1)
  const awaitingFirstOutput = running && lastMessage?.role !== "assistant"
  const turns = useMemo(
    () => interleaveTurns(messages, activities),
    [messages, activities]
  )

  return (
    <MessageList className="px-6" aria-label="Task conversation">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 py-8">
        {turns.map((entry) =>
          entry.kind === "message" ? (
            <MessageEntry key={entry.key} message={entry.message} />
          ) : (
            <ActivityEntry
              key={entry.key}
              activity={entry.activity}
              childActivities={entry.children}
            />
          )
        )}
        {awaitingFirstOutput ? (
          <MessageActivity>Working…</MessageActivity>
        ) : null}
      </div>
    </MessageList>
  )
}

/**
 * Merges each Turn's messages and top-level activities into one chronological
 * list. Both carry a shared per-turn ordinal; rows written before it existed
 * fall back to the old layout, activities ahead of the assistant text.
 */
function interleaveTurns(
  messages: Message[],
  activities: Activity[]
): TurnEntry[] {
  const childrenByParent = new Map<string, Activity[]>()
  for (const activity of activities) {
    if (!activity.parentActivityId) continue
    const siblings = childrenByParent.get(activity.parentActivityId) ?? []
    siblings.push(activity)
    childrenByParent.set(activity.parentActivityId, siblings)
  }

  const entries: TurnEntry[] = messages.map((message) => ({
    kind: "message",
    key: message.id,
    order: message.ordinal ?? (message.role === "user" ? -1 : legacyTail),
    message,
  }))
  for (const [index, activity] of activities.entries()) {
    if (activity.parentActivityId) continue
    entries.push({
      kind: "activity",
      key: activity.id,
      order: activity.ordinal ?? legacyMiddle + index,
      activity,
      children: childrenByParent.get(activity.id) ?? [],
    })
  }

  const turnOrder = new Map<string, number>()
  for (const message of messages) {
    const turnId = message.turnId ?? message.id
    if (!turnOrder.has(turnId)) turnOrder.set(turnId, turnOrder.size)
  }
  return entries.sort((left, right) => {
    const leftTurn = turnOrder.get(turnKey(left)) ?? Number.MAX_SAFE_INTEGER
    const rightTurn = turnOrder.get(turnKey(right)) ?? Number.MAX_SAFE_INTEGER
    if (leftTurn !== rightTurn) return leftTurn - rightTurn
    return left.order - right.order
  })
}

const legacyMiddle = 1_000_000
const legacyTail = Number.MAX_SAFE_INTEGER

function turnKey(entry: TurnEntry): string {
  if (entry.kind === "message") return entry.message.turnId ?? entry.message.id
  return entry.activity.turnId
}

// Memoized so a streaming flush re-parses only the message it touched; the
// delta fold preserves identity for every row it did not change.
const MessageEntry = memo(function MessageEntry({
  message,
}: {
  message: Message
}) {
  if (message.role === "user") {
    return (
      <MessageRow role="user" className="enter-rise">
        <MessageBody role="user">{message.content}</MessageBody>
      </MessageRow>
    )
  }

  if (message.role === "system") {
    return (
      <MessageRow role="system" className="enter-rise">
        <MessageBody role="system">{message.content}</MessageBody>
      </MessageRow>
    )
  }

  if (message.state === "complete" && !message.content) return null

  return (
    <MessageRow role="assistant" className="enter-rise">
      <MessageBody role="assistant" className="space-y-3">
        {message.state === "error" ? (
          <div className="space-y-3">
            {message.content ? (
              <Markdown onLinkActivate={openExternal}>
                {message.content}
              </Markdown>
            ) : null}
            <TurnFailureNotice
              failure={
                message.failure ?? {
                  kind: "error",
                  message: message.error ?? "The agent stopped with an error.",
                }
              }
            />
          </div>
        ) : message.content ? (
          <Markdown onLinkActivate={openExternal}>{message.content}</Markdown>
        ) : (
          <MessageActivity>Working…</MessageActivity>
        )}
        {message.state === "streaming" && message.content ? (
          <span
            aria-hidden
            className="mt-1 inline-block h-4 w-1.5 animate-pulse rounded-xs bg-foreground/60 align-middle"
          />
        ) : null}
      </MessageBody>
    </MessageRow>
  )
})

/** One unit of tool work, rendered by its provider-neutral kind. */
const ActivityEntry = memo(
  function ActivityEntry({
    activity,
    childActivities,
  }: {
    activity: Activity
    childActivities: Activity[]
  }) {
    if (activity.payload?.kind === "plan") {
      return (
        <div className="enter-rise w-full">
          <Plan title={activity.name} steps={activity.payload.steps} />
        </div>
      )
    }

    if (activity.payload?.kind === "subagent") {
      return (
        <div className="enter-rise flex w-full flex-col gap-1">
          <ActivityLine activity={activity} icon={BotIcon} />
          {childActivities.length > 0 ? (
            <div className="ml-4 flex flex-col gap-1 border-l border-border/60 pl-2.5">
              {childActivities.map((child) => (
                <ActivityLine
                  key={child.id}
                  activity={child}
                  icon={activityIcon(child)}
                />
              ))}
            </div>
          ) : null}
        </div>
      )
    }

    return (
      <div className="enter-rise w-full">
        <ActivityLine activity={activity} icon={activityIcon(activity)} />
      </div>
    )
  },
  // Child arrays are rebuilt on every interleave; compare their rows instead
  // so an untouched subagent block skips its render.
  (prev, next) =>
    prev.activity === next.activity &&
    prev.childActivities.length === next.childActivities.length &&
    prev.childActivities.every(
      (child, index) => child === next.childActivities[index]
    )
)

type Icon = typeof TerminalIcon

const toolIcons: Record<string, Icon> = {
  command: TerminalIcon,
  search: SearchIcon,
  web: GlobeIcon,
  mcp: WrenchIcon,
}

function activityIcon(activity: Activity): Icon | undefined {
  const payload = activity.payload
  if (!payload) return undefined
  if (payload.kind === "file-change") return FilePenIcon
  if (payload.kind === "subagent") return BotIcon
  if (payload.kind !== "tool") return undefined
  return toolIcons[payload.tool]
}

const statusIcons: Record<Activity["status"], Icon> = {
  running: LoaderCircleIcon,
  completed: CircleCheckIcon,
  failed: CircleXIcon,
}

/** Restrained, plain-text row for one tool call. Detail is never Markdown. */
function ActivityLine({
  activity,
  icon,
}: {
  activity: Activity
  icon?: Icon | undefined
}) {
  const StatusIcon = statusIcons[activity.status]
  const KindIcon = activity.status === "completed" && icon ? icon : StatusIcon
  const fileCount =
    activity.payload?.kind === "file-change" ? activity.payload.files.length : 0

  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg bg-muted/50 px-2.5 py-1.5 text-xs">
      <KindIcon
        className={cn(
          "size-3.5 shrink-0 text-muted-foreground",
          activity.status === "running" &&
            "animate-spin [animation-duration:0.7s]",
          activity.status === "failed" && "text-destructive"
        )}
      />
      <span className="shrink-0 font-medium">{activity.name}</span>
      {activity.detail ? (
        <span className="min-w-0 truncate text-muted-foreground">
          {activity.detail}
        </span>
      ) : null}
      {fileCount > 1 ? (
        <span className="ml-auto shrink-0 text-muted-foreground">
          {fileCount} files
        </span>
      ) : null}
    </div>
  )
}

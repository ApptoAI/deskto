import CircleCheckIcon from "lucide-react/dist/esm/icons/circle-check"
import CircleXIcon from "lucide-react/dist/esm/icons/circle-x"
import LoaderCircleIcon from "lucide-react/dist/esm/icons/loader-circle"
import type { Activity, Message } from "@openappto/protocol"

import { Markdown } from "@workspace/ui/components/chat/markdown"
import {
  Message as MessageRow,
  MessageActivity,
  MessageBody,
} from "@workspace/ui/components/chat/message"
import { MessageList } from "@workspace/ui/components/chat/message-list"
import { cn } from "@workspace/ui/lib/utils"

import { openExternal } from "../../lib/desktop.js"

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

  return (
    <MessageList className="px-6" aria-label="Task conversation">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 py-8">
        {messages.map((message) => (
          <MessageEntry
            key={message.id}
            message={message}
            activities={activities.filter(
              (activity) => activity.turnId === message.turnId
            )}
          />
        ))}
        {awaitingFirstOutput ? (
          <MessageActivity>Working…</MessageActivity>
        ) : null}
      </div>
    </MessageList>
  )
}

function MessageEntry({
  message,
  activities,
}: {
  message: Message
  activities: Activity[]
}) {
  if (message.role === "user") {
    return (
      <MessageRow role="user">
        <MessageBody role="user">{message.content}</MessageBody>
      </MessageRow>
    )
  }

  if (message.role === "system") {
    return (
      <MessageRow role="system">
        <MessageBody role="system">{message.content}</MessageBody>
      </MessageRow>
    )
  }

  const hasNothingToShow =
    message.state === "complete" && !message.content && activities.length === 0
  if (hasNothingToShow) return null

  return (
    <MessageRow role="assistant">
      <MessageBody role="assistant" className="space-y-3">
        {activities.length > 0 ? (
          <div className="flex flex-col gap-1">
            {activities.map((activity) => (
              <ActivityRow key={activity.id} activity={activity} />
            ))}
          </div>
        ) : null}
        {message.state === "error" ? (
          <div className="space-y-3">
            {message.content ? (
              <Markdown onLinkActivate={openExternal}>
                {message.content}
              </Markdown>
            ) : null}
            <p role="alert" className="text-sm text-destructive">
              {message.error ?? "The agent stopped with an error."}
            </p>
          </div>
        ) : message.content ? (
          <Markdown onLinkActivate={openExternal}>{message.content}</Markdown>
        ) : message.state === "streaming" && activities.length === 0 ? (
          <MessageActivity>Working…</MessageActivity>
        ) : null}
        {message.state === "streaming" && message.content ? (
          <span
            aria-hidden
            className="mt-1 inline-block h-4 w-1.5 animate-pulse rounded-xs bg-foreground/60 align-middle"
          />
        ) : null}
      </MessageBody>
    </MessageRow>
  )
}

const activityIcons: Record<Activity["status"], typeof CircleCheckIcon> = {
  running: LoaderCircleIcon,
  completed: CircleCheckIcon,
  failed: CircleXIcon,
}

/** Restrained, plain-text row for one tool call. Detail is never Markdown. */
function ActivityRow({ activity }: { activity: Activity }) {
  const Icon = activityIcons[activity.status]

  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg bg-muted/50 px-2.5 py-1.5 text-xs">
      <Icon
        className={cn(
          "size-3.5 shrink-0 text-muted-foreground",
          activity.status === "running" && "animate-spin",
          activity.status === "failed" && "text-destructive"
        )}
      />
      <span className="shrink-0 font-medium">{activity.name}</span>
      {activity.detail ? (
        <span className="min-w-0 truncate text-muted-foreground">
          {activity.detail}
        </span>
      ) : null}
    </div>
  )
}

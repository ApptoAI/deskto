import { memo, useMemo, useRef, useState } from "react"
import ChevronDownIcon from "lucide-react/dist/esm/icons/chevron-down"
import FilesIcon from "lucide-react/dist/esm/icons/files"
import type { Activity, Message, TurnOutput } from "@deskto/protocol"

import { Markdown } from "@workspace/ui/components/chat/markdown"
import {
  Message as MessageRow,
  MessageBody,
} from "@workspace/ui/components/chat/message"
import {
  MessageList,
  type MessageListHandle,
} from "@workspace/ui/components/chat/message-list"
import {
  TimelineMinimap,
  minimapAnchor,
  type TimelineMinimapItem,
} from "@workspace/ui/components/chat/timeline-minimap"
import { minimapPreviewText } from "@workspace/ui/lib/timeline-minimap"
import { cn } from "@workspace/ui/lib/utils"

import { openExternal } from "../../lib/desktop.js"
import { ActivityLine, Collapse, activityIcon } from "./activity-rows.js"
import { ArtifactIcon } from "./artifact-views.js"
import { elapsedBetween, formatElapsed } from "./elapsed.js"
import { useFileActions } from "./files-context.js"
import {
  buildTimeline,
  capLiveItems,
  type FoldedItem,
  type LiveItem,
} from "./thread-timeline.js"
import { TurnFailureNotice } from "./turn-failure-notice.js"
import { WorkingIndicator } from "./working-indicator.js"

/**
 * The conversation. A running Turn shows its work as it lands, capped to the
 * newest rows; a settled one folds every tool call and every preamble behind
 * "Worked for", leaving the prompt and the answer. Plans and subagents are
 * not drawn here at all: they are the task's state, and they are read beside
 * the conversation rather than inside it.
 */
export function MessageStream({
  messages,
  activities,
  running,
  outputs,
}: {
  messages: Message[]
  activities: Activity[]
  running: boolean
  outputs: TurnOutput[]
}) {
  const lastMessage = messages.at(-1)
  // The tail indicator holds the floor whenever nothing else is visibly
  // streaming: before the first output and between prose segments while
  // tools run. An actively streaming message shows its own caret instead.
  const streamingTail =
    lastMessage?.role === "assistant" && lastMessage.state === "streaming"
  const sinceTail = lastUserMessageAt(messages)
  const rows = useMemo(
    () => buildTimeline({ messages, activities, running, outputs }),
    [messages, activities, running, outputs]
  )
  const listRef = useRef<MessageListHandle>(null)
  const [viewport, setViewport] = useState<HTMLElement | null>(null)
  const minimapItems = useMemo(() => toMinimapItems(messages), [messages])

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <MessageList
        ref={listRef}
        onViewportChange={setViewport}
        className="px-6"
        aria-label="Task conversation"
      >
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 py-8">
          {rows.map((row) => {
            switch (row.kind) {
              case "message":
                return <MessageEntry key={row.key} message={row.message} />
              case "worked":
                return (
                  <WorkedDisclosure
                    key={row.key}
                    since={row.since}
                    until={row.until}
                    items={row.items}
                  />
                )
              case "live":
                return <LiveTurn key={row.key} items={row.items} />
              case "files":
                return <TurnFiles key={row.key} outputs={row.outputs} />
            }
          })}
          {running && !streamingTail ? (
            <WorkingIndicator since={sinceTail} />
          ) : null}
        </div>
      </MessageList>
      <TimelineMinimap
        items={minimapItems}
        viewport={viewport}
        onSelect={(anchor) => listRef.current?.scrollToElement(anchor)}
      />
    </div>
  )
}

function TurnFiles({ outputs }: { outputs: TurnOutput[] }) {
  const { open, openAll } = useFileActions()
  const visible = outputs.slice(0, 3)

  return (
    <section className="enter-rise -mt-2 max-w-full self-start">
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <FilesIcon aria-hidden className="size-3.5" />
        <span>{outputs.length === 1 ? "File" : "Files"}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {visible.map(({ artifact }) => (
          <button
            key={artifact.id}
            type="button"
            title={artifact.relativePath}
            onClick={() => open(artifact.id)}
            className="flex max-w-full min-w-0 items-center gap-1.5 rounded-md bg-background px-2.5 py-1.5 text-xs shadow-xs ring-1 ring-border/70 transition-colors outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <ArtifactIcon
              kind={artifact.previewKind}
              className="size-3.5 shrink-0 text-muted-foreground"
            />
            <span className="truncate">{artifact.name}</span>
          </button>
        ))}
        {outputs.length > visible.length ? (
          <button
            type="button"
            onClick={openAll}
            className="rounded-md px-2.5 py-1.5 text-xs text-muted-foreground transition-colors outline-none hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            Show all {outputs.length}
          </button>
        ) : null}
      </div>
    </section>
  )
}

/**
 * One minimap stop per prompt, previewed by the reply it drew.
 *
 * The reply is read positionally, taking every assistant segment between this
 * prompt and the next one, rather than by `turnId`. A turn's prose arrives in
 * segments split around tool activity, so no single segment is the reply, and
 * `turnId` is absent on rows written before it existed.
 */
function toMinimapItems(messages: Message[]): TimelineMinimapItem[] {
  const items: TimelineMinimapItem[] = []
  for (const [index, message] of messages.entries()) {
    if (message.role !== "user") continue
    items.push({
      id: message.id,
      // A prompt that survives no markdown at all still gets a stop: dropping
      // it would leave the rail quietly short of the conversation.
      label: minimapPreviewText(message.content) ?? "Message",
      preview: minimapPreviewText(replyToPromptAt(messages, index)),
    })
  }
  return items
}

function replyToPromptAt(messages: Message[], promptIndex: number): string {
  const segments: string[] = []
  for (const message of messages.slice(promptIndex + 1)) {
    if (message.role === "user") break
    if (message.role === "assistant" && message.content) {
      segments.push(message.content)
    }
  }
  return segments.join(" ")
}

function lastUserMessageAt(messages: Message[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message?.role === "user") return message.createdAt
  }
  return undefined
}

const turnHeaderClassName =
  "-ml-0.5 flex items-center gap-1.5 pb-2 text-xs text-muted-foreground"

/**
 * Everything a settled Turn did, behind one toggle. Closed by default: the
 * answer under it is what the user asked for, and the working out is there
 * for the times that answer needs checking.
 */
function WorkedDisclosure({
  since,
  until,
  items,
}: {
  since: string
  until: string | undefined
  items: FoldedItem[]
}) {
  const [open, setOpen] = useState(false)
  const elapsed = elapsedBetween(since, until)
  const label =
    elapsed === undefined ? "Details" : `Worked for ${formatElapsed(elapsed)}`

  // A Turn that only put agents to work leaves nothing to unfold here. It
  // still says how long it took, as a label rather than a toggle onto blank.
  if (items.length === 0) {
    return (
      <div className="enter-rise w-full">
        <p className={turnHeaderClassName}>{label}</p>
        <span aria-hidden className="block h-px w-full bg-border" />
      </div>
    )
  }

  return (
    <div className="enter-rise w-full">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          turnHeaderClassName,
          "cursor-pointer rounded-md transition-colors duration-100 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        )}
      >
        <span>{label}</span>
        <ChevronDownIcon
          aria-hidden
          className={cn(
            "size-3 shrink-0 transition-transform duration-200 ease-(--ease-out-quart)",
            !open && "-rotate-90"
          )}
        />
      </button>
      <Collapse open={open} className="-mx-1.5 px-1.5">
        <div className="flex flex-col gap-3 pb-3">
          {items.map((item) =>
            item.kind === "tools" ? (
              <ToolCluster key={item.key} items={item.items} />
            ) : (
              <div key={item.key} className="text-xs text-muted-foreground">
                <Markdown onLinkActivate={openExternal}>
                  {item.message.content}
                </Markdown>
              </div>
            )
          )}
        </div>
      </Collapse>
      <span aria-hidden className="block h-px w-full bg-border" />
    </div>
  )
}

/** A running Turn with one expansion state across every tool cluster. */
function LiveTurn({ items }: { items: LiveItem[] }) {
  const [expanded, setExpanded] = useState(false)
  const { visible, hidden } = capLiveItems(items, expanded)
  const overflowing = hidden > 0 || expanded
  const rows: Array<
    | { kind: "message"; key: string; message: Message }
    | { kind: "tools"; key: string; items: Activity[] }
  > = []
  for (const item of visible) {
    if (item.kind === "message") {
      rows.push(item)
      continue
    }
    const last = rows.at(-1)
    if (last?.kind === "tools") last.items.push(item.activity)
    else
      rows.push({
        kind: "tools",
        key: `tools:${item.activity.id}`,
        items: [item.activity],
      })
  }

  return (
    <div className="flex w-full flex-col gap-3">
      {overflowing ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className="-mx-1.5 mt-0.5 flex w-fit cursor-pointer items-center rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors duration-100 outline-none hover:bg-muted/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {expanded ? "Show less" : `+${hidden} more tool calls`}
        </button>
      ) : null}
      {rows.map((row) =>
        row.kind === "message" ? (
          <MessageEntry key={row.key} message={row.message} />
        ) : (
          <ToolCluster key={row.key} items={row.items} />
        )
      )}
    </div>
  )
}

/** Consecutive tool calls rendered as one tight column. */
function ToolCluster({ items }: { items: Activity[] }) {
  return (
    <div className="enter-rise w-full">
      <ul className="flex flex-col gap-px">
        {items.map((activity) => (
          <li key={activity.id} className="min-w-0">
            <ActivityLine activity={activity} icon={activityIcon(activity)} />
          </li>
        ))}
      </ul>
    </div>
  )
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
      <MessageRow
        role="user"
        className="enter-rise"
        {...minimapAnchor(message.id)}
      >
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
          <WorkingIndicator since={message.createdAt} />
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

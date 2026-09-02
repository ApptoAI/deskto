import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import ChevronDownIcon from "lucide-react/dist/esm/icons/chevron-down"
import FilesIcon from "lucide-react/dist/esm/icons/files"
import type {
  Activity,
  ImageAttachment,
  Message,
  TurnProgress,
  TurnOutput,
} from "@deskto/protocol"

import { Button } from "@workspace/ui/components/button"
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
import { useRuntimeClient } from "../../runtime/runtime-client-context.js"
import { useRuntimeQuery } from "../../runtime/use-runtime-query.js"
import { ActivityLine, Collapse, activityIcon } from "./activity-rows.js"
import { ArtifactIcon } from "./artifact-views.js"
import { elapsedBetween, formatElapsed } from "./elapsed.js"
import { useFileActions } from "./files-context.js"
import { conversationMeasureClassName } from "./task-panel-size.js"
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
  progress,
  outputs,
  label = "Task conversation",
}: {
  messages: Message[]
  activities: Activity[]
  running: boolean
  progress?: TurnProgress | undefined
  outputs: TurnOutput[]
  label?: string
}) {
  const lastPrompt = lastUserMessage(messages)
  const sinceTail = lastPrompt?.createdAt
  const rows = useMemo(
    () => buildTimeline({ messages, activities, running, outputs }),
    [messages, activities, running, outputs]
  )
  const listRef = useRef<MessageListHandle>(null)
  const [viewport, setViewport] = useState<HTMLElement | null>(null)
  const minimapItems = useMemo(() => toMinimapItems(messages), [messages])
  // A new prompt is the person's own doing, so the list goes to it even if
  // they had scrolled up; the first render is already at the end.
  const lastPromptId = lastPrompt?.id
  const followedPromptId = useRef(lastPromptId)
  useEffect(() => {
    if (followedPromptId.current === lastPromptId) return
    followedPromptId.current = lastPromptId
    listRef.current?.follow()
  }, [lastPromptId])

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <MessageList
        ref={listRef}
        onViewportChange={setViewport}
        className="px-6"
        aria-label={label}
      >
        {/* The column is the reading measure: everything in it — prose,
            tables, rules, code — shares one right edge, and the width is set
            once here rather than per element. */}
        <div
          className={cn(
            "mx-auto flex w-full flex-col gap-5 py-5 pb-8",
            conversationMeasureClassName
          )}
        >
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
          {running ? (
            <WorkingIndicator
              label={progress?.label}
              since={sinceTail}
              lastSignalAt={progress?.updatedAt}
            />
          ) : null}
        </div>
      </MessageList>
      {/* The transcript ends at the composer's edge, which guillotines the
          last line mid-glyph. A short wash of the canvas lets it fall away
          instead — and says the text continues, rather than stopped. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-background to-transparent"
      />
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
      {/* The same label voice the Files view uses, so the two read as one
          feature seen from two places. */}
      <div className="mb-2 flex items-center gap-1.5 eyebrow text-muted-foreground">
        <FilesIcon aria-hidden className="size-3.5" />
        <span>{outputs.length === 1 ? "File" : "Files"}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {visible.map(({ artifact }) => (
          <Button
            key={artifact.id}
            variant="outline"
            size="sm"
            title={artifact.relativePath}
            onClick={() => open(artifact.id)}
            className="max-w-full min-w-0 gap-1.5"
          >
            <ArtifactIcon
              kind={artifact.previewKind}
              className="size-3.5 text-muted-foreground"
            />
            <span className="truncate">{artifact.name}</span>
          </Button>
        ))}
        {outputs.length > visible.length ? (
          // The way out of the fold, not a fourth file: it drops the hairline
          // so the three named files stay the only pills with an edge.
          <Button
            variant="ghost"
            size="sm"
            onClick={() => openAll(outputs)}
            className="text-muted-foreground"
          >
            Show all {outputs.length}
          </Button>
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

function lastUserMessage(messages: Message[]): Message | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message?.role === "user") return message
  }
  return undefined
}

const turnHeaderClassName =
  "-ml-0.5 flex items-center gap-1.5 pb-2 text-xs text-muted-foreground"

/** The answer is the longest thing anyone reads here, so it sets a step above
    the chrome around it rather than at the app's default body size. */
const answerClassName = "text-reading"

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
      <div className="enter-rise w-fit">
        <p className={turnHeaderClassName}>{label}</p>
      </div>
    )
  }

  return (
    <div className="enter-rise w-fit max-w-full">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          turnHeaderClassName,
          "cursor-pointer rounded-md transition-colors duration-100 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
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
              <div key={item.key}>
                {/* Working-out, not the answer: it stays a size down so
                    unfolding a turn never reads like a second reply. */}
                <Markdown
                  className="text-xs text-muted-foreground"
                  onLinkActivate={openExternal}
                >
                  {item.message.content}
                </Markdown>
              </div>
            )
          )}
        </div>
      </Collapse>
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
          className="-mx-1.5 mt-0.5 flex w-fit cursor-pointer items-center rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors duration-100 outline-none hover:bg-muted/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
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
        <MessageBody role="user" className="space-y-2">
          {message.attachments?.length ? (
            <div className="flex flex-wrap justify-end gap-2">
              {message.attachments.map((attachment) => (
                <MessageImage
                  key={attachment.id}
                  threadId={message.threadId}
                  attachment={attachment}
                />
              ))}
            </div>
          ) : null}
          {message.content ? <div>{message.content}</div> : null}
        </MessageBody>
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

  if (!message.content && message.state !== "error") return null

  return (
    <MessageRow role="assistant" className="enter-rise">
      <MessageBody role="assistant" className="space-y-3">
        {message.state === "error" ? (
          <div className="space-y-3">
            {message.content ? (
              <Markdown
                className={answerClassName}
                onLinkActivate={openExternal}
              >
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
          <Markdown className={answerClassName} onLinkActivate={openExternal}>
            {message.content}
          </Markdown>
        ) : null}
        {message.state === "streaming" && message.content ? (
          <span
            aria-hidden
            className="mt-1 inline-block h-4 w-1.5 rounded-xs bg-foreground/60 align-middle motion-safe:animate-pulse"
          />
        ) : null}
      </MessageBody>
    </MessageRow>
  )
})

function MessageImage({
  threadId,
  attachment,
}: {
  threadId: string
  attachment: ImageAttachment
}) {
  const client = useRuntimeClient()
  const containerRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(
    () => !("IntersectionObserver" in window)
  )
  const load = useCallback(
    () => client.previewAttachment(threadId, attachment.id),
    [attachment.id, client, threadId]
  )
  const preview = useRuntimeQuery(visible ? load : null)

  useEffect(() => {
    const container = containerRef.current
    if (!container || visible) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        setVisible(true)
        observer.disconnect()
      },
      { rootMargin: "400px 0px" }
    )
    observer.observe(container)
    return () => observer.disconnect()
  }, [visible])

  if (preview.state.status === "error") {
    return (
      <div ref={containerRef} className="size-24">
        <button
          type="button"
          onClick={preview.revalidate}
          className="flex size-full cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg border border-border bg-muted px-2 text-center text-xs text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          title={`${attachment.name}: ${preview.state.message}`}
        >
          <span>Preview unavailable</span>
          <span className="underline underline-offset-2">Try again</span>
        </button>
      </div>
    )
  }

  if (preview.state.status !== "ready") {
    return (
      <div
        ref={containerRef}
        className="flex size-24 items-center justify-center rounded-lg border border-border bg-muted px-2 text-center text-xs text-muted-foreground"
        title={attachment.name}
      >
        {visible ? "Loading…" : attachment.name}
      </div>
    )
  }

  return (
    <div ref={containerRef} className="size-24">
      <img
        src={preview.state.data.dataUrl}
        alt={attachment.name}
        title={attachment.name}
        loading="lazy"
        className="size-24 rounded-lg border border-border object-cover"
      />
    </div>
  )
}

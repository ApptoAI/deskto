import { memo, useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"
import BotIcon from "lucide-react/dist/esm/icons/bot"
import ChevronDownIcon from "lucide-react/dist/esm/icons/chevron-down"
import CircleCheckIcon from "lucide-react/dist/esm/icons/circle-check"
import CircleXIcon from "lucide-react/dist/esm/icons/circle-x"
import FilePenIcon from "lucide-react/dist/esm/icons/file-pen"
import GlobeIcon from "lucide-react/dist/esm/icons/globe"
import LoaderCircleIcon from "lucide-react/dist/esm/icons/loader-circle"
import SearchIcon from "lucide-react/dist/esm/icons/search"
import TerminalIcon from "lucide-react/dist/esm/icons/terminal"
import WrenchIcon from "lucide-react/dist/esm/icons/wrench"
import type { Activity, Message } from "@deskto/protocol"

import { Markdown } from "@workspace/ui/components/chat/markdown"
import {
  Message as MessageRow,
  MessageBody,
} from "@workspace/ui/components/chat/message"
import {
  MessageList,
  type MessageListHandle,
} from "@workspace/ui/components/chat/message-list"
import { Plan } from "@workspace/ui/components/chat/plan"
import {
  TimelineMinimap,
  minimapAnchor,
  type TimelineMinimapItem,
} from "@workspace/ui/components/chat/timeline-minimap"
import { minimapPreviewText } from "@workspace/ui/lib/timeline-minimap"
import { cn } from "@workspace/ui/lib/utils"

import { openExternal } from "../../lib/desktop.js"
import { TurnFailureNotice } from "./turn-failure-notice.js"
import { WorkingIndicator } from "./working-indicator.js"

type ActivityNode = {
  activity: Activity
  children: ActivityNode[]
}

type TurnEntry =
  | { kind: "message"; key: string; order: number; message: Message }
  | {
      kind: "activity"
      key: string
      order: number
      activity: Activity
      children: ActivityNode[]
    }

/** What the stream actually draws: messages and standalone boxes stay solo,
    consecutive plain tool activities collapse into one tight cluster. */
type RenderBlock =
  | { kind: "message"; key: string; message: Message }
  | { kind: "plan"; key: string; activity: Activity }
  | {
      kind: "subagent"
      key: string
      activity: Activity
      children: ActivityNode[]
    }
  | { kind: "tools"; key: string; items: Activity[] }

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
  // The tail indicator holds the floor whenever nothing else is visibly
  // streaming: before the first output and between prose segments while
  // tools run. An actively streaming message shows its own caret instead.
  const streamingTail =
    lastMessage?.role === "assistant" && lastMessage.state === "streaming"
  const sinceTail = lastUserMessageAt(messages)
  const blocks = useMemo(
    () => toBlocks(interleaveTurns(messages, activities)),
    [messages, activities]
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
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 py-8">
          {blocks.map((block) => {
            switch (block.kind) {
              case "message":
                return <MessageEntry key={block.key} message={block.message} />
              case "plan":
                return <PlanBlock key={block.key} activity={block.activity} />
              case "subagent":
                return (
                  <SubagentBlock
                    key={block.key}
                    activity={block.activity}
                    childActivities={block.children}
                  />
                )
              case "tools":
                return <ToolCluster key={block.key} items={block.items} />
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
  const activityIds = new Set(activities.map((activity) => activity.id))
  for (const activity of activities) {
    if (
      !activity.parentActivityId ||
      !activityIds.has(activity.parentActivityId)
    )
      continue
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
  const renderedActivityIds = new Set<string>()
  const addActivityEntry = (activity: Activity, index: number) => {
    renderedActivityIds.add(activity.id)
    entries.push({
      kind: "activity",
      key: activity.id,
      order: activity.ordinal ?? legacyMiddle + index,
      activity,
      children: activityChildren(
        activity.id,
        childrenByParent,
        new Set(),
        renderedActivityIds
      ),
    })
  }
  for (const [index, activity] of activities.entries()) {
    if (activity.parentActivityId && activityIds.has(activity.parentActivityId))
      continue
    if (!renderedActivityIds.has(activity.id)) addActivityEntry(activity, index)
  }
  for (const [index, activity] of activities.entries()) {
    if (!renderedActivityIds.has(activity.id)) addActivityEntry(activity, index)
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

function activityChildren(
  parentId: string,
  childrenByParent: Map<string, Activity[]>,
  ancestors: Set<string>,
  renderedActivityIds: Set<string>
): ActivityNode[] {
  const nextAncestors = new Set(ancestors).add(parentId)
  return (childrenByParent.get(parentId) ?? []).flatMap((activity) => {
    if (nextAncestors.has(activity.id) || renderedActivityIds.has(activity.id))
      return []
    renderedActivityIds.add(activity.id)
    return [
      {
        activity,
        children: activityChildren(
          activity.id,
          childrenByParent,
          nextAncestors,
          renderedActivityIds
        ),
      },
    ]
  })
}

const legacyMiddle = 1_000_000
const legacyTail = Number.MAX_SAFE_INTEGER

function lastUserMessageAt(messages: Message[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message?.role === "user") return message.createdAt
  }
  return undefined
}

function turnKey(entry: TurnEntry): string {
  if (entry.kind === "message") return entry.message.turnId ?? entry.message.id
  return entry.activity.turnId
}

/** Folds the sorted entries into render blocks, keyed by their first row so
    a growing cluster keeps its component (and open state) across renders. */
function toBlocks(turns: TurnEntry[]): RenderBlock[] {
  const blocks: RenderBlock[] = []
  for (const entry of turns) {
    if (entry.kind === "message") {
      blocks.push({ kind: "message", key: entry.key, message: entry.message })
      continue
    }
    const activity = entry.activity
    if (activity.payload?.kind === "plan") {
      blocks.push({ kind: "plan", key: entry.key, activity })
      continue
    }
    if (activity.payload?.kind === "subagent") {
      blocks.push({
        kind: "subagent",
        key: entry.key,
        activity,
        children: entry.children,
      })
      continue
    }
    const last = blocks[blocks.length - 1]
    if (last?.kind === "tools") last.items.push(activity)
    else blocks.push({ kind: "tools", key: entry.key, items: [activity] })
  }
  return blocks
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

function PlanBlock({ activity }: { activity: Activity }) {
  if (activity.payload?.kind !== "plan" || activity.status === "failed") {
    return (
      <div className="enter-rise w-full">
        <ActivityLine activity={activity} icon={activityIcon(activity)} />
      </div>
    )
  }
  return (
    <div className="enter-rise w-full">
      <Plan title={activity.name} steps={activity.payload.steps} />
    </div>
  )
}

function Collapse({
  open,
  className,
  children,
}: {
  open: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-300 ease-(--ease-out-quart) motion-reduce:transition-none",
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
      )}
    >
      <div className={cn("min-h-0 overflow-hidden", className)} inert={!open}>
        {children}
      </div>
    </div>
  )
}

/**
 * A consecutive run of plain tool calls, drawn as one tight column. Long
 * runs get a collapsible "N tool calls" header so finished work folds away.
 */
function ToolCluster({ items }: { items: Activity[] }) {
  const [open, setOpen] = useState(true)
  const collapsible = items.length >= 3
  return (
    <div className="enter-rise w-full">
      {collapsible ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="-mx-1.5 mb-0.5 flex w-fit cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors duration-100 outline-none hover:bg-muted/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <ChevronDownIcon
            aria-hidden
            className={cn(
              "size-3 shrink-0 transition-transform duration-200 ease-(--ease-out-quart)",
              !open && "-rotate-90"
            )}
          />
          <span className="tabular-nums">{items.length} tool calls</span>
        </button>
      ) : null}
      <Collapse open={open} className="-mx-1.5 px-1.5">
        <ul className="flex flex-col gap-px">
          {items.map((activity) => (
            <li key={activity.id} className="min-w-0">
              <ActivityLine activity={activity} icon={activityIcon(activity)} />
            </li>
          ))}
        </ul>
      </Collapse>
    </div>
  )
}

/** An agent run in a card: status badge, name, and its tool work behind an
    expandable rail. Open while it runs, folded once it settles. */
function SubagentBlock({
  activity,
  childActivities,
}: {
  activity: Activity
  childActivities: ActivityNode[]
}) {
  const running = activity.status === "running"
  const [manual, setManual] = useState<boolean | null>(null)
  const open = manual ?? running
  const agentType =
    activity.payload?.kind === "subagent"
      ? activity.payload.agentType
      : undefined

  return (
    <div className="enter-rise w-full overflow-hidden rounded-xl bg-card shadow-xs ring-1 ring-border/60">
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
            {childActivities.length > 0 ? (
              childActivities.map((child) => (
                <NestedActivity key={child.activity.id} node={child} />
              ))
            ) : (
              <p className="py-1 text-[11px] text-muted-foreground">
                {running
                  ? "Working in a separate context."
                  : activity.status === "completed"
                    ? "Finished in a separate context."
                    : activity.status === "failed"
                      ? "Failed before finishing."
                      : "Stopped before finishing."}
              </p>
            )}
          </div>
        </div>
      </Collapse>
    </div>
  )
}

function NestedActivity({ node }: { node: ActivityNode }) {
  if (node.activity.payload?.kind === "plan") {
    return <PlanBlock activity={node.activity} />
  }
  return node.activity.payload?.kind === "subagent" ? (
    <div className="py-1">
      <SubagentBlock activity={node.activity} childActivities={node.children} />
    </div>
  ) : (
    <ActivityLine activity={node.activity} icon={activityIcon(node.activity)} />
  )
}

function SubagentBadge({ status }: { status: Activity["status"] }) {
  if (status === "running") {
    return (
      <span className="relative flex size-5 shrink-0 items-center justify-center">
        {/* Reduced motion keeps the ring and its gap, just still: the shape
            already reads as pending next to the settled check and cross. */}
        <svg
          viewBox="0 0 20 20"
          aria-hidden
          className="absolute inset-0 [animation-duration:1.1s] motion-safe:animate-spin"
        >
          <circle
            cx="10"
            cy="10"
            r="8.5"
            fill="none"
            strokeWidth="2"
            className="stroke-border"
          />
          <circle
            cx="10"
            cy="10"
            r="8.5"
            fill="none"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray="15 38.4"
            className="stroke-muted-foreground"
          />
        </svg>
        <BotIcon aria-hidden className="size-3 text-muted-foreground" />
      </span>
    )
  }
  return (
    <span
      key={status}
      aria-hidden
      className={cn(
        // The fade survives reduced motion the way `enter-rise` keeps its
        // own, but the scale-in does not: only the distance travelled is
        // what a motion-sensitive reader needs dropped.
        "flex size-5 shrink-0 items-center justify-center rounded-full text-white transition-[opacity,scale] duration-300 ease-(--ease-out-quart) starting:opacity-0 motion-safe:starting:scale-50",
        status === "completed"
          ? "bg-emerald-500 dark:bg-emerald-600"
          : "bg-destructive"
      )}
    >
      {status === "completed" ? (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-3"
        >
          <path d="M20 6L9 17l-5-5" />
        </svg>
      ) : (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3.5"
          strokeLinecap="round"
          className="size-2.5"
        >
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      )}
    </span>
  )
}

type Icon = typeof TerminalIcon

const toolIcons = new Map<string, Icon>([
  ["command", TerminalIcon],
  ["search", SearchIcon],
  ["web", GlobeIcon],
  ["mcp", WrenchIcon],
])

function activityIcon(activity: Activity): Icon | undefined {
  const payload = activity.payload
  if (!payload) return undefined
  if (payload.kind === "file-change") return FilePenIcon
  if (payload.kind === "subagent") return BotIcon
  if (payload.kind !== "tool") return undefined
  return toolIcons.get(payload.tool)
}

/**
 * One tool call as a compact row: kind icon, name, and the detail in an
 * inline chip. Rows with a truncatable detail expand — the icon crossfades
 * to a chevron on hover — to show the full text. File changes render their
 * files as diff chips instead.
 */
function ActivityLine({
  activity,
  icon,
}: {
  activity: Activity
  icon?: Icon | undefined
}) {
  const [open, setOpen] = useState(false)
  const payload = activity.payload
  const files = payload?.kind === "file-change" ? payload.files : []
  const mono =
    payload?.kind === "file-change" ||
    (payload?.kind === "tool" && payload.tool === "command")
  const running = activity.status === "running"
  const failed = activity.status === "failed"
  const expandable = Boolean(activity.detail) && files.length === 0
  const LeadIcon = running
    ? LoaderCircleIcon
    : failed
      ? CircleXIcon
      : (icon ?? CircleCheckIcon)

  const row = (
    <>
      <span className="relative flex size-4 shrink-0 items-center justify-center text-muted-foreground">
        <LeadIcon
          aria-hidden
          className={cn(
            "size-3.5",
            // Held still under reduced motion rather than swapped out: the
            // broken circle still separates a running row from a finished one.
            running && "[animation-duration:0.7s] motion-safe:animate-spin",
            failed && "text-destructive",
            expandable &&
              "transition-opacity duration-100 group-hover/row:opacity-0",
            expandable && open && "opacity-0"
          )}
        />
        {expandable ? (
          <ChevronDownIcon
            aria-hidden
            className={cn(
              "absolute size-3.5 opacity-0 transition-[opacity,rotate] duration-150 ease-(--ease-out-quart) group-hover/row:opacity-100",
              open ? "opacity-100" : "-rotate-90"
            )}
          />
        ) : null}
      </span>
      <span
        className={cn(
          "shrink-0 text-xs font-medium",
          failed ? "text-destructive" : "text-foreground"
        )}
      >
        {activity.name}
      </span>
      {files.length > 0 ? (
        <FileChips files={files} />
      ) : activity.detail ? (
        <span
          className={cn(
            "inline-flex h-5.5 min-w-0 items-center rounded-md bg-muted/60 px-1.5 text-[11px] text-muted-foreground ring-1 ring-border/40",
            mono && "font-mono"
          )}
        >
          <span className="truncate">{activity.detail}</span>
        </span>
      ) : null}
    </>
  )

  const rowClassName = cn(
    "group/row -mx-1.5 flex min-h-7 w-[calc(100%+12px)] min-w-0 items-center gap-2 rounded-md px-1.5 text-left transition-colors duration-100",
    expandable &&
      "cursor-pointer outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/50"
  )

  if (!expandable) return <div className={rowClassName}>{row}</div>

  return (
    <div className="min-w-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={rowClassName}
      >
        {row}
      </button>
      <Collapse open={open}>
        <p
          className={cn(
            "mt-0.5 mb-1 ml-[7px] border-l border-border py-0.5 pl-3.5 text-[11px] leading-relaxed break-all whitespace-pre-wrap text-muted-foreground",
            mono && "font-mono"
          )}
        >
          {activity.detail}
        </p>
      </Collapse>
    </div>
  )
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

/** The edits summarized as diff chips: file name plus added and removed
    line counts, wrapping as needed. */
function FileChips({
  files,
}: {
  files: { path: string; additions?: number; deletions?: number }[]
}) {
  return (
    <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1 py-0.5">
      {files.map((file) => (
        <span
          key={file.path}
          title={file.path}
          className="inline-flex h-5.5 max-w-full min-w-0 items-center gap-1.5 rounded-md bg-muted/60 px-1.5 font-mono text-[11px] ring-1 ring-border/40"
        >
          <span className="min-w-0 truncate text-foreground/90">
            {fileName(file.path)}
          </span>
          {file.additions ? (
            <span className="shrink-0 text-emerald-600 tabular-nums dark:text-emerald-400">
              +{file.additions}
            </span>
          ) : null}
          {file.deletions ? (
            <span className="shrink-0 text-red-500 tabular-nums dark:text-red-400">
              −{file.deletions}
            </span>
          ) : null}
        </span>
      ))}
    </span>
  )
}

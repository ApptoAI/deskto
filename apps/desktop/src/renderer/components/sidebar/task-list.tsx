import { useEffect, useState } from "react"
import CheckIcon from "lucide-react/dist/esm/icons/check"
import ChevronDownIcon from "lucide-react/dist/esm/icons/chevron-down"
import ClockIcon from "lucide-react/dist/esm/icons/clock"
import EllipsisVerticalIcon from "lucide-react/dist/esm/icons/ellipsis-vertical"
import PinIcon from "lucide-react/dist/esm/icons/pin"
import PinOffIcon from "lucide-react/dist/esm/icons/pin-off"
import PlusIcon from "lucide-react/dist/esm/icons/plus"
import RotateCcwIcon from "lucide-react/dist/esm/icons/rotate-ccw"
import type { Thread } from "@openappto/protocol"
import {
  autoDoneAfterDays,
  canMarkDone,
  canSnooze,
  hasUnreadCompletion,
  partitionInbox,
  resolveDoneTimestamp,
  resolveSnoozePresets,
  snoozeWakeLabel,
  threadCameBack,
  type InboxSection,
  type SnoozePreset,
} from "@openappto/client"

import { cn } from "@workspace/ui/lib/utils"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"

import { formatAge, formatExactTime } from "../../lib/format-time.js"
import { describeThreadStatus } from "../../lib/thread-status.js"
import { useLocalStorage } from "../../lib/use-local-storage.js"
import type { QueryState } from "../../runtime/use-runtime-query.js"

/** Organization commands a row can issue; the workbench wires them to the
    runtime client. */
export type InboxActions = {
  onSetDone: (threadId: string, done: boolean) => void
  onSnooze: (threadId: string, until: string) => void
  onWake: (threadId: string) => void
  onSetPinned: (threadId: string, pinned: boolean) => void
}

// Recent history is the common lookup; the deep tail stays behind Show more.
const DONE_INITIAL_COUNT = 10
const DONE_PAGE_COUNT = 25

const decodeBoolean = (value: unknown) => value === true

/** Re-renders once a minute so auto-close and snooze wake-ups land while the
    app just sits open. */
function useNowMinute(): string {
  const [now, setNow] = useState(() => new Date().toISOString())
  useEffect(() => {
    const id = window.setInterval(
      () => setNow(new Date().toISOString()),
      60_000
    )
    return () => window.clearInterval(id)
  }, [])
  return now
}

export function TaskList({
  state,
  openThreadId,
  onOpenThread,
  onRetry,
  actions,
  projectNameById,
}: {
  state: QueryState<Thread[]>
  openThreadId: string | null
  onOpenThread: (threadId: string) => void
  onRetry: () => void
  actions: InboxActions
  projectNameById?: Map<string, string>
}) {
  const now = useNowMinute()
  const [laterExpanded, setLaterExpanded] = useLocalStorage(
    "appto.sidebar.later-expanded",
    false,
    decodeBoolean
  )
  const [doneExpanded, setDoneExpanded] = useLocalStorage(
    "appto.sidebar.done-expanded",
    false,
    decodeBoolean
  )
  const [doneVisibleCount, setDoneVisibleCount] = useState(DONE_INITIAL_COUNT)

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

  const partition = partitionInbox(state.data, { now, autoDoneAfterDays })
  const total =
    partition.pinned.length +
    partition.active.length +
    partition.later.length +
    partition.done.length
  if (total === 0) {
    return (
      <p className="px-4 py-1.5 text-sm text-muted-foreground">No tasks yet.</p>
    )
  }

  // The open task must stay in the list even when its shelf is collapsed or
  // its row falls past the pagination window, otherwise the task on screen
  // would have no row at all in the sidebar.
  const visibleLater = laterExpanded
    ? partition.later
    : partition.later.filter((thread) => thread.id === openThreadId)
  const pagedDone = partition.done.slice(0, doneVisibleCount)
  const openDoneBeyondPage = partition.done
    .slice(doneVisibleCount)
    .find((thread) => thread.id === openThreadId)
  const visibleDone = doneExpanded
    ? openDoneBeyondPage
      ? [...pagedDone, openDoneBeyondPage]
      : pagedDone
    : partition.done.filter((thread) => thread.id === openThreadId)
  const hiddenDoneCount = doneExpanded
    ? partition.done.length - pagedDone.length
    : 0
  // One preset set per render: the rows are many, the choices identical, and
  // the minute tick keeps them fresh enough for menus opened later.
  const snoozePresets = resolveSnoozePresets(new Date())

  const renderRow = (thread: Thread, section: InboxSection) => (
    <TaskRow
      key={thread.id}
      thread={thread}
      section={section}
      now={now}
      isOpen={thread.id === openThreadId}
      onOpenThread={onOpenThread}
      actions={actions}
      snoozePresets={snoozePresets}
      projectName={projectNameById?.get(thread.projectId)}
    />
  )

  return (
    <ul className="space-y-0.5 px-2">
      {partition.pinned.map((thread) => renderRow(thread, "pinned"))}
      {partition.pinned.length > 0 ? (
        <li aria-hidden className="mx-2 my-1.5 h-px bg-border" />
      ) : null}
      {partition.active.map((thread) => renderRow(thread, "active"))}
      {partition.later.length > 0 ? (
        <ShelfHeader
          label="Later"
          count={partition.later.length}
          expanded={laterExpanded}
          onToggle={() => setLaterExpanded((value) => !value)}
          className="text-blue-600 dark:text-blue-400"
          ruleClassName="bg-blue-500/20 dark:bg-blue-400/15"
        />
      ) : null}
      {visibleLater.map((thread) => renderRow(thread, "later"))}
      {partition.done.length > 0 ? (
        <ShelfHeader
          label="Done"
          count={partition.done.length}
          expanded={doneExpanded}
          onToggle={() => setDoneExpanded((value) => !value)}
          className="text-muted-foreground/60"
          ruleClassName="bg-border"
        />
      ) : null}
      {visibleDone.map((thread) => renderRow(thread, "done"))}
      {hiddenDoneCount > 0 ? (
        <li>
          <button
            type="button"
            onClick={() =>
              setDoneVisibleCount((count) => count + DONE_PAGE_COUNT)
            }
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-muted-foreground/70 hover:bg-muted/50 hover:text-foreground"
          >
            <PlusIcon aria-hidden className="size-3.5 shrink-0" />
            Show {Math.min(hiddenDoneCount, DONE_PAGE_COUNT)} more
          </button>
        </li>
      ) : null}
    </ul>
  )
}

function ShelfHeader({
  label,
  count,
  expanded,
  onToggle,
  className,
  ruleClassName,
}: {
  label: string
  count: number
  expanded: boolean
  onToggle: () => void
  className: string
  ruleClassName: string
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className={cn(
          "mt-3 mb-1 flex w-full cursor-pointer items-center gap-2 px-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          className
        )}
      >
        <span className="text-xs font-medium">
          {expanded ? label : `${label} (${count})`}
        </span>
        <span aria-hidden className={cn("h-px flex-1", ruleClassName)} />
        <ChevronDownIcon
          aria-hidden
          className={cn(
            "size-3 transition-transform",
            expanded && "rotate-180"
          )}
        />
      </button>
    </li>
  )
}

function TaskRow({
  thread,
  section,
  now,
  isOpen,
  onOpenThread,
  actions,
  snoozePresets,
  projectName,
}: {
  thread: Thread
  section: InboxSection
  now: string
  isOpen: boolean
  onOpenThread: (threadId: string) => void
  actions: InboxActions
  snoozePresets: readonly SnoozePreset[]
  projectName?: string | undefined
}) {
  const status = describeThreadStatus(thread.status)
  const showStatusDot = thread.status !== "idle"
  // Attention is a separate axis from status: an unseen completion or a
  // wake-up that happened since the last visit. Green is reserved for it.
  const cameBack = threadCameBack(thread, { now })
  const needsALook =
    !showStatusDot && (hasUnreadCompletion(thread) || cameBack)

  // One timestamp source per section; label and hover title must agree.
  const isWakeLabel = section === "later" && thread.snoozedUntil !== null
  const rowTimestamp = isWakeLabel
    ? thread.snoozedUntil!
    : section === "done"
      ? (resolveDoneTimestamp(thread) ?? thread.updatedAt)
      : (thread.lastUserMessageAt ?? thread.updatedAt)
  const timeLabel = isWakeLabel
    ? snoozeWakeLabel(rowTimestamp, { now })
    : formatAge(rowTimestamp)
  const timeTitle = isWakeLabel
    ? `Back ${formatExactTime(rowTimestamp)}`
    : formatExactTime(rowTimestamp)
  const dimmed = section === "done" || section === "later"

  return (
    <li className="group relative">
      <button
        type="button"
        onClick={() => onOpenThread(thread.id)}
        aria-current={isOpen ? "true" : undefined}
        className={cn(
          "flex w-full items-center gap-2 rounded-lg py-1.5 pr-7 pl-2 text-left text-sm transition-colors outline-none hover:bg-muted/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
          dimmed ? "text-muted-foreground/70" : "text-muted-foreground",
          isOpen && "bg-muted/60 text-foreground"
        )}
      >
        {section === "pinned" ? (
          <PinIcon
            aria-hidden
            className="size-3 shrink-0 text-muted-foreground/70"
          />
        ) : null}
        {showStatusDot ? (
          <span
            aria-hidden
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              status.dotClassName
            )}
          />
        ) : needsALook ? (
          <span
            aria-hidden
            className="size-1.5 shrink-0 rounded-full bg-emerald-500"
          />
        ) : null}
        <span className="min-w-0 flex-1 truncate">{thread.title}</span>
        {projectName ? (
          <span className="max-w-[35%] shrink-0 truncate text-[10px] text-muted-foreground/60">
            {projectName}
          </span>
        ) : null}
        <span
          className="shrink-0 text-xs text-muted-foreground/70 tabular-nums group-hover:invisible group-focus-within:invisible"
          title={timeTitle}
        >
          {timeLabel}
        </span>
        {showStatusDot ? (
          <span className="sr-only">{status.label}</span>
        ) : needsALook ? (
          <span className="sr-only">
            {cameBack ? "Back from Later" : "Finished since your last visit"}
          </span>
        ) : null}
      </button>
      <TaskRowMenu
        thread={thread}
        section={section}
        actions={actions}
        snoozePresets={snoozePresets}
      />
    </li>
  )
}

function TaskRowMenu({
  thread,
  section,
  actions,
  snoozePresets,
}: {
  thread: Thread
  section: InboxSection
  actions: InboxActions
  snoozePresets: readonly SnoozePreset[]
}) {
  const pinned = section === "pinned"
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Organize ${thread.title}`}
            className="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[popup-open]:opacity-100"
          />
        }
      >
        <EllipsisVerticalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        <DropdownMenuItem
          onClick={() => actions.onSetPinned(thread.id, !pinned)}
        >
          {pinned ? (
            <PinOffIcon data-icon="inline-start" />
          ) : (
            <PinIcon data-icon="inline-start" />
          )}
          {pinned ? "Unpin" : "Pin"}
        </DropdownMenuItem>
        {section === "later" ? (
          <DropdownMenuItem onClick={() => actions.onWake(thread.id)}>
            <ClockIcon data-icon="inline-start" />
            Wake now
          </DropdownMenuItem>
        ) : (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={!canSnooze(thread)}>
              <ClockIcon data-icon="inline-start" />
              Later
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {snoozePresets.map((preset) => (
                <DropdownMenuItem
                  key={preset.id}
                  onClick={() => actions.onSnooze(thread.id, preset.until)}
                >
                  {preset.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        <DropdownMenuSeparator />
        {section === "done" ? (
          <DropdownMenuItem onClick={() => actions.onSetDone(thread.id, false)}>
            <RotateCcwIcon data-icon="inline-start" />
            Restore
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            disabled={!canMarkDone(thread)}
            onClick={() => actions.onSetDone(thread.id, true)}
          >
            <CheckIcon data-icon="inline-start" />
            Mark done
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

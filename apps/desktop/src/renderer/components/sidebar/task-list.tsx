import { useEffect, useState } from "react"
import type { ReactNode } from "react"
import CheckIcon from "lucide-react/dist/esm/icons/check"
import ChevronDownIcon from "lucide-react/dist/esm/icons/chevron-down"
import ClockIcon from "lucide-react/dist/esm/icons/clock"
import FolderIcon from "lucide-react/dist/esm/icons/folder"
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
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@workspace/ui/components/context-menu"
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@workspace/ui/components/dropdown-menu"

import { HarnessLogo } from "../brand-logos.js"
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
      <ul className="space-y-1 px-2 pt-1" aria-label="Loading tasks">
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

  const pagedDone = partition.done.slice(0, doneVisibleCount)
  const openDoneBeyondPage = partition.done
    .slice(doneVisibleCount)
    .find((thread) => thread.id === openThreadId)
  const doneRows = openDoneBeyondPage
    ? [...pagedDone, openDoneBeyondPage]
    : pagedDone
  const hiddenDoneCount = partition.done.length - pagedDone.length
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

  // The open task must stay in view even when its shelf is collapsed,
  // otherwise the task on screen would have no row at all in the sidebar.
  const ghostRow = (rows: Thread[], expanded: boolean) =>
    expanded ? undefined : rows.find((thread) => thread.id === openThreadId)

  return (
    <div className="px-2">
      {partition.pinned.length > 0 ? (
        <section>
          <div className="flex items-center px-2 pt-4 pb-1.5 text-xs font-medium text-muted-foreground/80">
            <span>Pinned</span>
            <span className="ml-auto tabular-nums opacity-60">
              {partition.pinned.length}
            </span>
          </div>
          <ul className="space-y-0.5">
            {partition.pinned.map((thread) => renderRow(thread, "pinned"))}
          </ul>
        </section>
      ) : null}

      {partition.active.length > 0 ? (
        <section>
          <div className="flex items-center px-2 pt-4 pb-1.5 text-xs font-medium text-muted-foreground/80">
            <span>Inbox</span>
            <span className="ml-auto tabular-nums opacity-60">
              {partition.active.length}
            </span>
          </div>
          <ul className="space-y-0.5">
            {partition.active.map((thread) => renderRow(thread, "active"))}
          </ul>
        </section>
      ) : null}

      {partition.later.length > 0 ? (
        <Shelf
          label="Later"
          count={partition.later.length}
          expanded={laterExpanded}
          onToggle={() => setLaterExpanded((value) => !value)}
          section="later"
          rows={partition.later}
          renderRow={renderRow}
          openRow={ghostRow(partition.later, laterExpanded)}
          accentClassName="text-violet-500/90 hover:text-violet-500 dark:text-violet-400/90 dark:hover:text-violet-300"
        />
      ) : null}

      {partition.done.length > 0 ? (
        <Shelf
          label="Done"
          count={partition.done.length}
          expanded={doneExpanded}
          onToggle={() => setDoneExpanded((value) => !value)}
          section="done"
          rows={doneRows}
          renderRow={renderRow}
          openRow={ghostRow(partition.done, doneExpanded)}
          footer={
            hiddenDoneCount > 0 ? (
              <li>
                <button
                  type="button"
                  onClick={() =>
                    setDoneVisibleCount((count) => count + DONE_PAGE_COUNT)
                  }
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-muted-foreground/70 transition-colors duration-150 hover:bg-muted/50 hover:text-foreground"
                >
                  <PlusIcon aria-hidden className="size-3.5 shrink-0" />
                  Show {Math.min(hiddenDoneCount, DONE_PAGE_COUNT)} more
                </button>
              </li>
            ) : null
          }
        />
      ) : null}
    </div>
  )
}

/**
 * A collapsible section. Rows stay mounted while collapsed — the shelf
 * animates shut over them via the 0fr grid track — so expanding is a pure
 * height transition instead of a re-mount cascade. `inert` keeps the hidden
 * rows out of the tab order.
 */
function Shelf({
  label,
  count,
  expanded,
  onToggle,
  section,
  rows,
  renderRow,
  openRow,
  footer,
  accentClassName,
}: {
  label: string
  count: number
  expanded: boolean
  onToggle: () => void
  section: InboxSection
  rows: Thread[]
  renderRow: (thread: Thread, section: InboxSection) => ReactNode
  openRow?: Thread | undefined
  footer?: ReactNode
  accentClassName?: string
}) {
  return (
    <section>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className={cn(
          "flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 pt-4 pb-1.5 text-left text-xs font-medium transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          accentClassName ?? "text-muted-foreground/80 hover:text-foreground"
        )}
      >
        <span>{label}</span>
        <ChevronDownIcon
          aria-hidden
          className={cn(
            "size-3 shrink-0 transition-transform duration-200 ease-(--ease-out-quart)",
            !expanded && "-rotate-90"
          )}
        />
        <span className="ml-auto tabular-nums opacity-60">{count}</span>
      </button>
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-300 ease-(--ease-out-quart) motion-reduce:transition-none",
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        )}
      >
        <div
          className={cn(
            "min-h-0 overflow-hidden transition-opacity duration-200",
            !expanded && "opacity-0"
          )}
        >
          <ul className="space-y-0.5 pb-px" inert={!expanded}>
            {rows.map((thread) => renderRow(thread, section))}
            {footer}
          </ul>
        </div>
      </div>
      {openRow ? (
        <ul className="space-y-0.5">{renderRow(openRow, section)}</ul>
      ) : null}
    </section>
  )
}

/** Provider tints, matched to each brand; unknown harnesses stay neutral. */
const harnessAccent: Record<string, string> = {
  claude: "text-[#D97757]",
  codex: "text-foreground",
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
  const busy = thread.status !== "idle"
  // Attention is a separate axis from status: an unseen completion or a
  // wake-up that happened since the last visit. Green is reserved for it.
  const cameBack = threadCameBack(thread, { now })
  const needsALook = !busy && (hasUnreadCompletion(thread) || cameBack)

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
    <ContextMenu>
      <ContextMenuTrigger render={<li className="group enter-rise relative" />}>
        <button
          type="button"
          onClick={() => onOpenThread(thread.id)}
          aria-current={isOpen ? "true" : undefined}
          className={cn(
            "flex w-full items-start gap-2.5 rounded-lg py-2 pr-7 pl-2 text-left text-sm",
            "transition-[background-color,box-shadow,scale] duration-150 ease-out outline-none",
            "focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.99]",
            dimmed ? "text-muted-foreground/80" : "text-foreground/90",
            isOpen
              ? "bg-background text-foreground shadow-xs ring-1 ring-border/70 dark:bg-accent dark:shadow-none dark:ring-0"
              : "hover:bg-muted/50"
          )}
        >
          <span
            className={cn(
              "flex h-5 shrink-0 items-center",
              dimmed && !isOpen && "opacity-60"
            )}
          >
            <HarnessLogo
              harnessId={thread.harnessId}
              className={cn(
                "size-3.5",
                harnessAccent[thread.harnessId] ?? "text-muted-foreground"
              )}
              fallback={
                <span
                  aria-hidden
                  className="size-3.5 rounded-full border-[1.5px] border-muted-foreground/40"
                />
              }
            />
          </span>
          <span className="min-w-0 flex-1">
            <span
              className={cn(
                "block truncate leading-5",
                needsALook && !isOpen && "font-medium text-foreground"
              )}
            >
              {thread.title}
            </span>
            {projectName ? (
              <span className="mt-0.5 flex items-center gap-1 pr-7 text-xs leading-4 text-muted-foreground/70">
                <FolderIcon
                  aria-hidden
                  className="size-3 shrink-0 text-muted-foreground/50"
                />
                <span className="truncate">{projectName}</span>
              </span>
            ) : null}
          </span>
          <span className="flex h-5 shrink-0 items-center gap-1.5 transition-opacity duration-150 group-focus-within:opacity-0 group-hover:opacity-0">
            <RowIndicator
              thread={thread}
              section={section}
              needsALook={needsALook}
            />
            <span
              className={cn(
                "text-xs tabular-nums",
                isWakeLabel
                  ? "text-violet-500/90 dark:text-violet-400/90"
                  : "text-muted-foreground/70"
              )}
              title={timeTitle}
            >
              {timeLabel}
            </span>
          </span>
          {busy ? (
            <span className="sr-only">{status.label}</span>
          ) : needsALook ? (
            <span className="sr-only">
              {cameBack ? "Back from Later" : "Finished since your last visit"}
            </span>
          ) : null}
        </button>
        <span className="absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center">
          {section === "done" ? (
            <RowActionButton
              label={`Restore ${thread.title}`}
              tooltip="Restore"
              onClick={() => actions.onSetDone(thread.id, false)}
            >
              <RotateCcwIcon className="size-3.5" />
            </RowActionButton>
          ) : canMarkDone(thread) ? (
            <RowActionButton
              label={`Mark ${thread.title} done`}
              tooltip="Mark done"
              tone="done"
              onClick={() => actions.onSetDone(thread.id, true)}
            >
              <CheckIcon className="size-3.5" />
            </RowActionButton>
          ) : null}
        </span>
      </ContextMenuTrigger>
      <TaskRowMenu
        thread={thread}
        section={section}
        actions={actions}
        snoozePresets={snoozePresets}
      />
    </ContextMenu>
  )
}

/**
 * The one control a row carries: a round target that fades in on hover, over
 * the timestamp it replaces. Marking done greets the pointer in green — it is
 * the affirmative action and the only place the inbox spends that color.
 */
function RowActionButton({
  label,
  tooltip,
  tone,
  onClick,
  children,
}: {
  label: string
  tooltip: string
  tone?: "done"
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={tooltip}
      onClick={onClick}
      className={cn(
        "flex size-6 scale-90 items-center justify-center rounded-full border border-border/70 bg-sidebar text-muted-foreground opacity-0 shadow-xs",
        "transition-[opacity,scale,background-color,border-color,color] duration-150 ease-(--ease-out-quart) outline-none active:scale-95",
        "group-hover:scale-100 group-hover:opacity-100 focus-visible:scale-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50",
        tone === "done"
          ? "hover:border-emerald-500/50 hover:bg-emerald-500/15 hover:text-emerald-600 dark:hover:text-emerald-400"
          : "hover:border-border hover:bg-muted hover:text-foreground"
      )}
    >
      {children}
    </button>
  )
}

/**
 * The row's right-hand signal, one at a time, drawn as the classic circle
 * status glyphs in the inbox palette: a muted half-pie while the agent
 * works, an amber pie when it waits on the user, a red X on failure, a
 * violet dashed ring while snoozed, a green pie for an unseen completion
 * and a check on closed tasks. Keyed so a change pops in with a scale.
 *
 * Only the amber "needs you" state animates. A whole sidebar of spinners
 * pulls the eye to work that is simply proceeding, and it competes with
 * the one state that genuinely wants an answer.
 */
function RowIndicator({
  thread,
  section,
  needsALook,
}: {
  thread: Thread
  section: InboxSection
  needsALook: boolean
}) {
  const kind =
    thread.status !== "idle"
      ? thread.status
      : section === "later"
        ? "snoozed"
        : needsALook
          ? "unread"
          : section === "done"
            ? "done"
            : "none"
  if (kind === "none") return null
  return (
    <span
      key={kind}
      aria-hidden
      className="flex size-3.5 items-center justify-center transition-[opacity,scale] duration-200 ease-(--ease-out-quart) starting:scale-50 starting:opacity-0"
    >
      {kind === "running" ? (
        <PieGlyph className="text-blue-500 dark:text-blue-400" />
      ) : kind === "waiting-approval" ? (
        <PieGlyph className="animate-pulse text-amber-500 dark:text-amber-400" />
      ) : kind === "failed" ? (
        <MarkGlyph variant="x" className="text-destructive" />
      ) : kind === "snoozed" ? (
        <DashedGlyph className="text-violet-500 dark:text-violet-400" />
      ) : kind === "unread" ? (
        <PieGlyph className="text-emerald-500 dark:text-emerald-400" />
      ) : (
        <MarkGlyph variant="check" className="text-muted-foreground/70" />
      )}
    </span>
  )
}

/** Ring with a half-filled wedge — the "in progress" circle glyph. */
function PieGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={cn("size-3.5", className)}>
      <circle
        cx="8"
        cy="8"
        r="6.25"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M8 8 V2.5 A5.5 5.5 0 0 1 8 13.5 Z" fill="currentColor" />
    </svg>
  )
}

/** Dashed empty ring — the "parked" circle glyph. */
function DashedGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={cn("size-3.5", className)}>
      <circle
        cx="8"
        cy="8"
        r="6.25"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray="2.6 2.3"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** Filled circle with a check or an X knocked out in the sidebar color. */
function MarkGlyph({
  variant,
  className,
}: {
  variant: "check" | "x"
  className?: string
}) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={cn("size-3.5", className)}>
      <circle cx="8" cy="8" r="7" fill="currentColor" />
      {variant === "check" ? (
        <path
          d="M5 8.3 7.1 10.4 11 6.4"
          fill="none"
          className="stroke-sidebar"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <path
          d="M5.8 5.8 10.2 10.2 M10.2 5.8 5.8 10.2"
          fill="none"
          className="stroke-sidebar"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      )}
    </svg>
  )
}

/** Organize actions for a row. No button of its own: the row is the trigger,
    and right-click (or long press) opens this at the pointer. */
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
  const pinned = thread.pinnedAt != null
  return (
    <ContextMenuContent align="start" className="w-44">
      <DropdownMenuItem onClick={() => actions.onSetPinned(thread.id, !pinned)}>
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
    </ContextMenuContent>
  )
}

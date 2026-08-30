import { Fragment, useEffect, useMemo, useRef, useState } from "react"
import type { ComponentProps, ReactNode } from "react"
import { z } from "zod"
import CheckIcon from "lucide-react/dist/esm/icons/check"
import ChevronDownIcon from "lucide-react/dist/esm/icons/chevron-down"
import ClockIcon from "lucide-react/dist/esm/icons/clock"
import ClockArrowUpIcon from "lucide-react/dist/esm/icons/clock-arrow-up"
import FolderIcon from "lucide-react/dist/esm/icons/folder"
import PinIcon from "lucide-react/dist/esm/icons/pin"
import PinOffIcon from "lucide-react/dist/esm/icons/pin-off"
import PlusIcon from "lucide-react/dist/esm/icons/plus"
import RotateCcwIcon from "lucide-react/dist/esm/icons/rotate-ccw"
import Trash2Icon from "lucide-react/dist/esm/icons/trash-2"
import type { Thread } from "@deskto/protocol"
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
} from "@deskto/client"

import { cn } from "@workspace/ui/lib/utils"
import { Button } from "@workspace/ui/components/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@workspace/ui/components/context-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
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

import { HarnessLogo, harnessAccentByHarnessId } from "../brand-logos.js"
import { formatAge, formatExactTime } from "../../lib/format-time.js"
import { describeThreadStatus } from "../../lib/thread-status.js"
import { useLocalStorage } from "../../lib/use-local-storage.js"
import type { QueryState } from "../../runtime/use-runtime-query.js"
import { sidebarRowIdle, sidebarRowSelected } from "./sidebar-frame.js"

/** Organization commands a row can issue; the workbench wires them to the
    runtime client. */
export type InboxActions = {
  onSetDone: (threadId: string, done: boolean) => void
  onSnooze: (threadId: string, until: string) => void
  onWake: (threadId: string) => void
  onSetPinned: (threadId: string, pinned: boolean) => void
  onDelete: (threadId: string) => void
}

// Recent history is the common lookup; the deep tail stays behind Show more.
const DONE_INITIAL_COUNT = 10
const DONE_PAGE_COUNT = 25
const taskListFocusTargetId = "task-list-focus-target"

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
    "deskto.sidebar.later-expanded",
    false,
    z.boolean()
  )
  const [doneExpanded, setDoneExpanded] = useLocalStorage(
    "deskto.sidebar.done-expanded",
    false,
    z.boolean()
  )
  const [doneVisibleCount, setDoneVisibleCount] = useState(DONE_INITIAL_COUNT)
  // The confirmation lives with the list, not the row: a row remounts when its
  // task changes section, and a dialog inside it would vanish mid-decision.
  const [deleteTarget, setDeleteTarget] = useState<Thread | null>(null)
  const threadTree = useMemo(() => {
    const threads = state.status === "ready" ? state.data : []
    const ids = new Set(threads.map((thread) => thread.id))
    const children = new Map<string, Thread[]>()
    for (const thread of threads) {
      if (!thread.parentThreadId || !ids.has(thread.parentThreadId)) continue
      const siblings = children.get(thread.parentThreadId) ?? []
      siblings.push(thread)
      children.set(thread.parentThreadId, siblings)
    }
    return {
      roots: threads.filter(
        (thread) => !thread.parentThreadId || !ids.has(thread.parentThreadId)
      ),
      children,
    }
  }, [state])

  if (state.status === "idle") {
    return <div id={taskListFocusTargetId} tabIndex={-1} />
  }

  if (state.status === "loading") {
    return (
      <div id={taskListFocusTargetId} tabIndex={-1}>
        <ul className="space-y-1 px-2 pt-1" aria-label="Loading tasks">
          {[0, 1, 2].map((row) => (
            <li
              key={row}
              className="h-8 animate-pulse rounded-lg bg-muted/40"
            />
          ))}
        </ul>
      </div>
    )
  }

  if (state.status === "error") {
    return (
      <div id={taskListFocusTargetId} tabIndex={-1}>
        <div className="space-y-2 px-3 py-2">
          <p className="text-sm text-destructive">{state.message}</p>
          <Button variant="outline" size="sm" onClick={onRetry}>
            Try again
          </Button>
        </div>
      </div>
    )
  }

  const allPartition = partitionInbox(state.data, {
    now,
    autoDoneAfterDays,
  })
  const sectionByThreadId = new Map<string, InboxSection>()
  for (const section of ["pinned", "active", "later", "done"] as const) {
    for (const thread of allPartition[section]) {
      sectionByThreadId.set(thread.id, section)
    }
  }
  const partition = partitionInbox(threadTree.roots, {
    now,
    autoDoneAfterDays,
  })
  const total =
    partition.pinned.length +
    partition.active.length +
    partition.later.length +
    partition.done.length
  if (total === 0) {
    return (
      <div id={taskListFocusTargetId} tabIndex={-1}>
        <p className="px-4 py-1.5 text-sm text-muted-foreground">
          No tasks yet.
        </p>
      </div>
    )
  }

  const pagedDone = partition.done.slice(0, doneVisibleCount)
  const containsOpenThread = (thread: Thread): boolean =>
    thread.id === openThreadId ||
    (threadTree.children.get(thread.id) ?? []).some(containsOpenThread)
  const openDoneBeyondPage = partition.done
    .slice(doneVisibleCount)
    .find(containsOpenThread)
  const doneRows = openDoneBeyondPage
    ? [...pagedDone, openDoneBeyondPage]
    : pagedDone
  const hiddenDoneCount = partition.done.length - pagedDone.length
  // One preset set per render: the rows are many, the choices identical, and
  // the minute tick keeps them fresh enough for menus opened later.
  const snoozePresets = resolveSnoozePresets(new Date())

  const renderRow = (
    thread: Thread,
    section: InboxSection,
    depth = 0
  ): ReactNode => {
    const displaySection = sectionByThreadId.get(thread.id) ?? section
    return (
      <Fragment key={thread.id}>
        <TaskRow
          thread={thread}
          section={displaySection}
          now={now}
          isOpen={thread.id === openThreadId}
          nested={depth > 0}
          onOpenThread={onOpenThread}
          actions={actions}
          snoozePresets={snoozePresets}
          projectName={projectNameById?.get(thread.projectId)}
          onRequestDelete={setDeleteTarget}
        />
        {(threadTree.children.get(thread.id) ?? []).map((child) =>
          renderRow(child, displaySection, depth + 1)
        )}
      </Fragment>
    )
  }

  // The open task must stay in view even when its shelf is collapsed,
  // otherwise the task on screen would have no row at all in the sidebar.
  const ghostRow = (rows: Thread[], expanded: boolean) =>
    expanded ? undefined : rows.find(containsOpenThread)

  return (
    <div id={taskListFocusTargetId} tabIndex={-1} className="px-2">
      {partition.pinned.length > 0 ? (
        <section>
          <div className="flex items-center px-2 pt-5 pb-2 eyebrow text-muted-foreground">
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
          <div className="flex items-center px-2 pt-5 pb-2 eyebrow text-muted-foreground">
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
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors duration-150 hover:bg-muted/50 hover:text-foreground"
                >
                  <PlusIcon aria-hidden className="size-3.5 shrink-0" />
                  Show {Math.min(hiddenDoneCount, DONE_PAGE_COUNT)} more
                </button>
              </li>
            ) : null
          }
        />
      ) : null}

      <DeleteTaskDialog
        target={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={(threadId) => {
          setDeleteTarget(null)
          actions.onDelete(threadId)
        }}
      />
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
}) {
  return (
    <section>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 pt-5 pb-2 text-left eyebrow text-muted-foreground transition-colors duration-150 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
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

function TaskRow({
  thread,
  section,
  now,
  isOpen,
  nested,
  onOpenThread,
  actions,
  snoozePresets,
  projectName,
  onRequestDelete,
}: {
  thread: Thread
  section: InboxSection
  now: string
  isOpen: boolean
  nested: boolean
  onOpenThread: (threadId: string) => void
  actions: InboxActions
  snoozePresets: readonly SnoozePreset[]
  projectName?: string | undefined
  onRequestDelete: (thread: Thread) => void
}) {
  // An open popup holds the row in its hover state: the pointer sits in a
  // portalled menu, so without this the buttons would fade out from under it.
  // The two menus track separately, or closing one would clear the other's.
  const [contextMenuOpen, setContextMenuOpen] = useState(false)
  const [snoozeMenuOpen, setSnoozeMenuOpen] = useState(false)
  const popupOpen = contextMenuOpen || snoozeMenuOpen
  const pinned = thread.pinnedAt != null
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
    <ContextMenu onOpenChange={setContextMenuOpen}>
      <ContextMenuTrigger render={<li className="group enter-rise relative" />}>
        <button
          type="button"
          id={taskRowButtonId(thread.id)}
          onClick={() => onOpenThread(thread.id)}
          aria-current={isOpen ? "true" : undefined}
          // The row is the context menu trigger, and Base UI's trigger only
          // wires pointer handlers. Keyboard users reach the menu with
          // Shift+F10 or the Menu key, so say out loud that one exists.
          aria-haspopup="menu"
          className={cn(
            "flex w-full items-start gap-2.5 rounded-row px-2 py-1.5 pr-7 text-left text-caption",
            "transition-[background-color,box-shadow,scale] duration-150 ease-out outline-none",
            "focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]",
            dimmed ? "text-muted-foreground/80" : "text-foreground/90",
            isOpen ? sidebarRowSelected : sidebarRowIdle,
            nested && "ml-4 w-[calc(100%-1rem)]"
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
                harnessAccentByHarnessId.get(thread.harnessId) ??
                  "text-muted-foreground"
              )}
              fallback={
                <span
                  aria-hidden
                  className="size-3.5 rounded-full border-[1.5px] border-muted-foreground/40"
                />
              }
            />
          </span>
          {/* The buttons sit over this column, so the text truncates earlier
              while they are up rather than running underneath them. */}
          <span
            className={cn(
              "min-w-0 flex-1 transition-[padding] duration-150 ease-(--ease-out-quart) group-hover:pr-8 group-has-focus-visible:pr-8",
              popupOpen && "pr-8"
            )}
          >
            <span
              className={cn(
                "block truncate leading-5",
                needsALook && !isOpen && "font-medium text-foreground"
              )}
            >
              {thread.title}
            </span>
            {projectName ? (
              <span className="mt-0.5 flex items-center gap-1 pr-7 text-micro leading-4 text-muted-foreground/70">
                <FolderIcon
                  aria-hidden
                  className="size-3 shrink-0 text-muted-foreground/50"
                />
                <span className="truncate">{projectName}</span>
              </span>
            ) : null}
          </span>
          <span
            className={cn(
              "flex h-5 shrink-0 items-center justify-end gap-1.5 transition-opacity duration-150 group-hover:opacity-0 group-has-focus-visible:opacity-0",
              popupOpen && "opacity-0"
            )}
          >
            <RowIndicator
              thread={thread}
              section={section}
              needsALook={needsALook}
            />
            <span
              className={cn(
                // Fixed column: without it the timestamp starts at a different
                // x on every row depending on whether a status glyph is there.
                "w-8 shrink-0 text-right text-micro tabular-nums",
                isWakeLabel
                  ? "text-foreground"
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
        {/* Transparent to the pointer so the gaps between the buttons still
              belong to the row underneath. */}
        <span className="pointer-events-none absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center gap-1">
          {section === "done" ? (
            <RowActionButton
              action="Restore"
              subject={thread.title}
              popupOpen={popupOpen}
              onClick={() => actions.onSetDone(thread.id, false)}
            >
              <RotateCcwIcon className="size-3.5" />
            </RowActionButton>
          ) : (
            <>
              {section === "later" ? (
                <RowActionButton
                  action="Wake now"
                  subject={thread.title}
                  popupOpen={popupOpen}
                  onClick={() => actions.onWake(thread.id)}
                >
                  <ClockArrowUpIcon className="size-3.5" />
                </RowActionButton>
              ) : canSnooze(thread) ? (
                <SnoozeButton
                  thread={thread}
                  popupOpen={popupOpen}
                  snoozePresets={snoozePresets}
                  onSnooze={actions.onSnooze}
                  onOpenChange={setSnoozeMenuOpen}
                />
              ) : null}
              <RowActionButton
                action={pinned ? "Unpin" : "Pin"}
                subject={thread.title}
                popupOpen={popupOpen}
                onClick={() => actions.onSetPinned(thread.id, !pinned)}
              >
                {pinned ? (
                  <PinOffIcon className="size-3.5" />
                ) : (
                  <PinIcon className="size-3.5" />
                )}
              </RowActionButton>
              {canMarkDone(thread) ? (
                <RowActionButton
                  action="Mark done"
                  subject={thread.title}
                  popupOpen={popupOpen}
                  onClick={() => actions.onSetDone(thread.id, true)}
                >
                  <CheckIcon className="size-3.5" />
                </RowActionButton>
              ) : null}
            </>
          )}
        </span>
      </ContextMenuTrigger>
      <TaskRowMenu
        thread={thread}
        section={section}
        actions={actions}
        snoozePresets={snoozePresets}
        onRequestDelete={() => onRequestDelete(thread)}
      />
    </ContextMenu>
  )
}

/** Lets the list hand focus back to the row a dialog was opened from. */
function taskRowButtonId(threadId: string): string {
  return `task-row-${threadId}`
}

/** Opens the snooze presets from the row itself, so parking a task for later
    costs one hover and one click instead of a trip through the menu. */
function SnoozeButton({
  thread,
  popupOpen,
  snoozePresets,
  onSnooze,
  onOpenChange,
}: {
  thread: Thread
  popupOpen: boolean
  snoozePresets: readonly SnoozePreset[]
  onSnooze: (threadId: string, until: string) => void
  onOpenChange: (open: boolean) => void
}) {
  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        render={
          <RowActionButton
            action="Later"
            subject={thread.title}
            popupOpen={popupOpen}
          />
        }
      >
        <ClockIcon className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-32">
        {snoozePresets.map((preset) => (
          <DropdownMenuItem
            key={preset.id}
            onClick={() => onSnooze(thread.id, preset.until)}
          >
            {preset.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Deleting is the one row action with nothing behind it, so it asks first
    and says exactly what goes away. One dialog serves the whole list, and
    closing it hands focus back to the row it was opened from. */
function DeleteTaskDialog({
  target,
  onClose,
  onConfirm,
}: {
  target: Thread | null
  onClose: () => void
  onConfirm: (threadId: string) => void
}) {
  // The target clears the moment the dialog starts closing, so the last one
  // stays around: it names the task through the fade and tells the focus
  // handler which row to go back to.
  const [lastTarget, setLastTarget] = useState<Thread | null>(null)
  const deleteRequested = useRef(false)
  useEffect(() => {
    if (target) deleteRequested.current = false
  }, [target])
  if (target && target !== lastTarget) setLastTarget(target)
  const shown = target ?? lastTarget

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        finalFocus={() => {
          const list = document.getElementById(taskListFocusTargetId)
          if (deleteRequested.current) return list ?? false
          return (
            (shown && document.getElementById(taskRowButtonId(shown.id))) ??
            list ??
            false
          )
        }}
      >
        <DialogHeader>
          <DialogTitle>Delete this task?</DialogTitle>
          <DialogDescription>
            “{shown?.title}” and its whole conversation go for good. Files in
            the project folder stay as they are.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              if (!shown) return
              deleteRequested.current = true
              onConfirm(shown.id)
            }}
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * One of the controls a row carries: a round target that fades in on hover,
 * over the timestamp it replaces. Marking done greets the pointer in green —
 * it is the affirmative action and the only place the inbox spends that color.
 *
 * The accessible name starts with the visible tooltip so voice control can act
 * on what it reads, and the task follows to tell one row's buttons from the
 * next. `popupOpen` keeps the cluster up while a menu the row opened is on
 * screen.
 */
function RowActionButton({
  action,
  subject,
  popupOpen,
  className,
  ...props
}: ComponentProps<"button"> & {
  action: string
  subject: string
  popupOpen?: boolean
}) {
  return (
    <button
      type="button"
      aria-label={`${action}: ${subject}`}
      title={action}
      className={cn(
        "pointer-events-none flex size-6 scale-90 items-center justify-center rounded-full border border-border/70 bg-sidebar text-muted-foreground opacity-0",
        "transition-[opacity,scale,background-color,border-color,color] duration-150 ease-(--ease-out-quart) outline-none active:scale-95",
        "group-hover:pointer-events-auto group-hover:scale-100 group-hover:opacity-100",
        // Keyboard focus anywhere in the row shows the cluster too: the
        // timestamp fades with it, and nothing should replace it. Focus-visible
        // rather than focus, because a click leaves the row focused, and a
        // pointer that has moved on should not still be offering buttons.
        "group-has-focus-visible:pointer-events-auto group-has-focus-visible:scale-100 group-has-focus-visible:opacity-100",
        "focus-visible:ring-2 focus-visible:ring-ring",
        popupOpen && "pointer-events-auto scale-100 opacity-100",
        "hover:border-input hover:bg-fill-chip-hover hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

/**
 * The row's right-hand signal, one at a time. Status is carried by shape and
 * weight, never by hue: the palette is monochrome, so a glyph that only a
 * colour told apart would tell a reader nothing here, and would already have
 * told a reader with a colour vision deficiency nothing anywhere.
 *
 * Six states, six silhouettes. A ring with a half wedge is work in progress,
 * dim while it simply proceeds and full-strength while it waits on an answer.
 * A dashed ring is parked. A solid disc is a finished task nobody has looked
 * at yet, and cutting a mark out of that disc closes it — a check for done, a
 * cross for failed. Keyed so a change pops in with a scale.
 *
 * Only "needs you" animates. A whole sidebar of spinners pulls the eye to work
 * that is simply proceeding, and it competes with the one state that genuinely
 * wants an answer.
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
      className="flex size-3.5 shrink-0 items-center justify-center transition-[opacity,scale] duration-200 ease-(--ease-out-quart) motion-reduce:transition-none starting:scale-50 starting:opacity-0"
    >
      {kind === "running" ? (
        <PieGlyph className="text-muted-foreground" />
      ) : kind === "waiting-approval" ? (
        <PieGlyph className="text-foreground motion-safe:animate-pulse" />
      ) : kind === "failed" ? (
        <MarkGlyph variant="x" className="text-foreground" />
      ) : kind === "snoozed" ? (
        <DashedGlyph className="text-muted-foreground" />
      ) : kind === "unread" ? (
        <DotGlyph className="text-foreground" />
      ) : (
        <MarkGlyph variant="check" className="text-muted-foreground" />
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

/** Solid disc — a finished task nobody has opened yet. Deliberately the one
    glyph with no interior detail: it is the only state that is asking to be
    looked at rather than reporting what happened. */
function DotGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={cn("size-3.5", className)}>
      <circle cx="8" cy="8" r="5" fill="currentColor" />
    </svg>
  )
}

/** Filled circle with a check or an X cut out of it. The cut is painted in
    --knockout rather than the sidebar fill: every surface here is translucent
    glass, so the mark has to be the opaque colour that glass resolves to, or
    it tints whatever happens to be scrolling underneath. */
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
          className="stroke-knockout"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <path
          d="M5.8 5.8 10.2 10.2 M10.2 5.8 5.8 10.2"
          fill="none"
          className="stroke-knockout"
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
  onRequestDelete,
}: {
  thread: Thread
  section: InboxSection
  actions: InboxActions
  snoozePresets: readonly SnoozePreset[]
  onRequestDelete: () => void
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
      <DropdownMenuSeparator />
      {/* The item only asks; the list owns the confirmation and the delete. */}
      <DropdownMenuItem variant="destructive" onClick={onRequestDelete}>
        <Trash2Icon data-icon="inline-start" />
        Delete
      </DropdownMenuItem>
    </ContextMenuContent>
  )
}

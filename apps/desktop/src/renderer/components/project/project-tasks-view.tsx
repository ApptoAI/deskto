import { useState } from "react"
import FolderIcon from "lucide-react/dist/esm/icons/folder"
import { autoDoneAfterDays } from "@deskto/client"
import type { Harness, Project, Thread } from "@deskto/protocol"

import { cn } from "@workspace/ui/lib/utils"
import { ScrollArea } from "@workspace/ui/components/scroll-area"

import { findModel } from "../../lib/execution-profile.js"
import { formatAge, formatExactTime } from "../../lib/format-time.js"
import { findHarness } from "../../lib/harness.js"
import { describeThreadStatus } from "../../lib/thread-status.js"
import type { QueryState } from "../../runtime/use-runtime-query.js"
import { Composer } from "../composer.js"
import { TaskComposerToolbar } from "../task/task-composer-toolbar.js"
import { useTaskComposer } from "../task/use-task-composer.js"
import {
  taskFilters,
  taskTableCounts,
  taskTableRows,
  taskUpdatedAt,
  type TaskFilter,
} from "./task-table.js"

/**
 * A project with work in it, read as a table rather than a transcript: one
 * row per task, the agent that runs it, and when it last moved. The filters
 * name states the person can already see on a row, so switching one narrows
 * the same list instead of opening a different screen.
 *
 * The composer stays docked at the bottom. Starting the next task is the
 * most common thing to do from here, and it should not cost a navigation.
 */
export function ProjectTasksView({
  project,
  threads,
  harnesses,
  openThreadId,
  onOpenThread,
  onTaskCreated,
  onTaskStarted,
}: {
  project: Project
  threads: readonly Thread[]
  harnesses: QueryState<Harness[]>
  openThreadId: string | null
  onOpenThread: (threadId: string) => void
  onTaskCreated: (threadId: string) => void
  onTaskStarted: (threadId: string) => void
}) {
  const [filter, setFilter] = useState<TaskFilter>("all")
  const composer = useTaskComposer({
    project,
    harnesses,
    onTaskCreated,
    onTaskStarted,
  })

  // Read once per render rather than on a timer: ages are coarse enough that
  // a row would not change without some other event redrawing this anyway.
  const now = new Date().toISOString()
  const rows = taskTableRows(threads, filter, { now, autoDoneAfterDays })
  const counts = taskTableCounts(threads)
  const harnessOptions = harnesses.status === "ready" ? harnesses.data : []

  return (
    <>
      <header className="drag-region flex h-13 shrink-0 items-center justify-between gap-4 px-6">
        <div className="no-drag flex min-w-0 items-baseline gap-2.5">
          <h1 className="truncate text-base font-medium">{project.name}</h1>
          <p className="shrink-0 font-mono text-micro text-muted-foreground">
            {counts.total} {counts.total === 1 ? "task" : "tasks"}
            {counts.running > 0 ? ` · ${counts.running} running` : null}
          </p>
        </div>
        <div
          role="tablist"
          aria-label="Filter tasks"
          className="no-drag flex shrink-0 items-center gap-0.5"
        >
          {taskFilters.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              role="tab"
              aria-selected={filter === candidate.id}
              onClick={() => setFilter(candidate.id)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs transition-colors duration-100 outline-none focus-visible:ring-2 focus-visible:ring-ring",
                filter === candidate.id
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {candidate.label}
            </button>
          ))}
        </div>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-6 pb-4">
          {/* A header row, not a <table>: the rows are buttons that open a
              task, and a grid keeps the columns aligned without nesting an
              interactive element inside a cell. */}
          <div className="grid grid-cols-[minmax(0,1fr)_9rem_5rem] items-center gap-4 border-b border-border px-3 pb-2 text-micro text-muted-foreground">
            <span>Task</span>
            <span>Agent</span>
            <span className="text-right">Updated</span>
          </div>

          {rows.length === 0 ? (
            <p className="px-3 py-8 text-sm text-muted-foreground">
              {filter === "all"
                ? "No tasks in this project yet."
                : "Nothing here right now."}
            </p>
          ) : (
            <ul>
              {rows.map((thread) => (
                <TaskRow
                  key={thread.id}
                  thread={thread}
                  harnesses={harnessOptions}
                  open={thread.id === openThreadId}
                  onOpen={() => onOpenThread(thread.id)}
                />
              ))}
            </ul>
          )}
        </div>
      </ScrollArea>

      <div className="shrink-0 px-6 pb-5">
        <ProjectLocationStrip project={project} />
        <Composer
          projectId={project.id}
          harnessId={composer.harnessId}
          label="What should the agent do?"
          placeholder={`Start a task in ${project.name}…`}
          onSend={composer.send}
          blockedReason={composer.blockedReason}
          {...(composer.models.length > 0
            ? { onOpenModelPicker: () => composer.setModelMenuOpen(true) }
            : {})}
          toolbar={<TaskComposerToolbar composer={composer} />}
        />
      </div>
    </>
  )
}

/**
 * Where the project's files are and what it is for, on one quiet line above
 * the composer. The mock put a branch and a connection light here too; this
 * app has neither, so the line carries only what is true.
 */
export function ProjectLocationStrip({ project }: { project: Project }) {
  return (
    <div className="flex min-w-0 items-center gap-2 px-1 pb-2 text-micro text-muted-foreground">
      <FolderIcon aria-hidden className="size-3.5 shrink-0 stroke-[1.5]" />
      <span className="shrink-0">
        {project.locationKind === "managed" ? "Managed by Deskto" : "Linked"}
      </span>
      <span className="min-w-0 truncate font-mono tracking-normal">
        {project.path}
      </span>
      {project.description ? (
        <span className="hidden min-w-0 truncate border-l border-border pl-2 @[48rem]:inline">
          {project.description}
        </span>
      ) : null}
    </div>
  )
}

function TaskRow({
  thread,
  harnesses,
  open,
  onOpen,
}: {
  thread: Thread
  harnesses: Harness[]
  open: boolean
  onOpen: () => void
}) {
  const status = describeThreadStatus(thread.status)
  const harness = findHarness(harnesses, thread.harnessId)
  const model = findModel(
    harness?.models ?? [],
    thread.executionProfile.modelId
  )
  const updatedAt = taskUpdatedAt(thread)

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "grid w-full grid-cols-[minmax(0,1fr)_9rem_5rem] items-center gap-4 rounded-lg px-3 py-2.5 text-left transition-colors duration-100 outline-none focus-visible:ring-2 focus-visible:ring-ring",
          open ? "bg-accent" : "hover:bg-accent/50"
        )}
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <span
            aria-hidden
            className={cn("size-1.5 shrink-0 rounded-full", status.dotClassName)}
          />
          <span className="truncate text-sm">{thread.title}</span>
          {/* Idle is the resting state, so it earns no chip: a row that says
              nothing extra is a row with nothing to answer. */}
          {thread.status !== "idle" ? (
            <span
              className={cn(
                "shrink-0 rounded-md px-1.5 py-0.5 text-micro ring-1 ring-border/70",
                status.textClassName
              )}
            >
              {status.label}
            </span>
          ) : null}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {model?.name ?? harness?.name ?? thread.harnessId}
        </span>
        <span
          className="text-right font-mono text-micro text-muted-foreground"
          title={formatExactTime(updatedAt)}
        >
          {formatAge(updatedAt)}
        </span>
      </button>
    </li>
  )
}

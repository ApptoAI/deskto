import { effectiveDone, threadLastActivityAt } from "@deskto/client"
import type { Thread } from "@deskto/protocol"

/**
 * The project table's filters. They name states the person already sees on a
 * row, so each one is a plain read of Thread status rather than a second
 * inbox vocabulary: "Needs review" is the approval a task is waiting on, not
 * a shelf someone has to maintain.
 *
 * Done is the one filter that cannot be read off status alone — a quiet task
 * closes itself after a window — so it defers to `effectiveDone`, the same
 * predicate the sidebar partitions with.
 */
export const taskFilters = [
  { id: "all", label: "All" },
  { id: "running", label: "Running" },
  { id: "needs-review", label: "Needs review" },
  { id: "done", label: "Done" },
] as const

export type TaskFilter = (typeof taskFilters)[number]["id"]

export type TaskTableOptions = {
  readonly now: string
  readonly autoDoneAfterDays: number | null
}

export function matchesTaskFilter(
  thread: Thread,
  filter: TaskFilter,
  options: TaskTableOptions
): boolean {
  if (filter === "all") return true
  if (filter === "running") return thread.status === "running"
  if (filter === "needs-review") return thread.status === "waiting-approval"
  return effectiveDone(thread, options)
}

/**
 * Rows in a fixed order: newest task first, and nothing about what an agent
 * is doing moves one. The list holds still while work happens, the same
 * promise the sidebar's active section makes, so a row the person is reading
 * stays under their cursor.
 */
export function taskTableRows(
  threads: readonly Thread[],
  filter: TaskFilter,
  options: TaskTableOptions
): Thread[] {
  return threads
    .filter((thread) => matchesTaskFilter(thread, filter, options))
    .sort(
      (left, right) =>
        Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
        left.id.localeCompare(right.id)
    )
}

export type TaskTableCounts = {
  total: number
  running: number
}

export function taskTableCounts(threads: readonly Thread[]): TaskTableCounts {
  return {
    total: threads.length,
    running: threads.filter((thread) => thread.status === "running").length,
  }
}

/** The row's age column: when the task last did something, else when it began. */
export function taskUpdatedAt(thread: Thread): string {
  return threadLastActivityAt(thread) ?? thread.createdAt
}

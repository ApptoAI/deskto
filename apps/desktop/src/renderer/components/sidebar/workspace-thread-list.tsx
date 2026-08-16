import { useMemo } from "react"
import type { Project, Thread } from "@deskto/protocol"

import type { QueryState } from "../../runtime/use-runtime-query.js"
import { TaskList, type InboxActions } from "./task-list.js"

/**
 * The all-projects view: one inbox across every project in the workspace.
 * The sections come from the shared partition; a small project label on each
 * row replaces the old per-project grouping, so pinned and active work from
 * different projects can sit together.
 */
export function WorkspaceThreadList({
  projects,
  state,
  openThreadId,
  onOpenThread,
  onRetry,
  actions,
}: {
  projects: Project[]
  state: QueryState<Record<string, Thread[]>>
  openThreadId: string | null
  onOpenThread: (threadId: string) => void
  onRetry: () => void
  actions: InboxActions
}) {
  const projectNameById = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects]
  )
  const flattened: QueryState<Thread[]> = useMemo(
    () =>
      state.status === "ready"
        ? { status: "ready", data: Object.values(state.data).flat() }
        : state,
    [state]
  )

  return (
    <TaskList
      state={flattened}
      openThreadId={openThreadId}
      onOpenThread={onOpenThread}
      onRetry={onRetry}
      actions={actions}
      projectNameById={projectNameById}
    />
  )
}

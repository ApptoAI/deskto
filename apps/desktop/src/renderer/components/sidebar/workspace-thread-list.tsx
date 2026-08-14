import type { Project, Thread } from "@openappto/protocol"

import { Button } from "@workspace/ui/components/button"

import type { QueryState } from "../../runtime/use-runtime-query.js"
import { TaskList } from "./task-list.js"

/**
 * The all-projects view: every project's tasks, divided into sections with the
 * project name as a hairline header. Clicking a header narrows the sidebar to
 * that project.
 */
export function WorkspaceThreadList({
  projects,
  state,
  openThreadId,
  onOpenThread,
  onSelectProject,
  onRetry,
}: {
  projects: Project[]
  state: QueryState<Record<string, Thread[]>>
  openThreadId: string | null
  onOpenThread: (threadId: string) => void
  onSelectProject: (projectId: string) => void
  onRetry: () => void
}) {
  if (state.status === "idle") return null

  if (state.status === "loading") {
    return (
      <ul className="space-y-1 px-2" aria-label="Loading tasks">
        {[0, 1, 2, 3].map((row) => (
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

  return (
    <div className="space-y-4">
      {projects.map((project) => {
        const threads = state.data[project.id] ?? []

        return (
          <section key={project.id} aria-label={project.name}>
            <button
              type="button"
              onClick={() => onSelectProject(project.id)}
              title={`Show only ${project.name}`}
              className="group flex w-full items-center gap-2 rounded-sm px-4 pb-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <span className="truncate text-xs font-medium text-muted-foreground transition-colors duration-150 group-hover:text-foreground">
                {project.name}
              </span>
              <span aria-hidden className="h-px min-w-4 flex-1 bg-border" />
            </button>
            {threads.length > 0 ? (
              <TaskList
                state={{ status: "ready", data: threads }}
                openThreadId={openThreadId}
                onOpenThread={onOpenThread}
                onRetry={onRetry}
              />
            ) : (
              <p className="px-4 text-xs text-muted-foreground/70">
                No tasks yet
              </p>
            )}
          </section>
        )
      })}
    </div>
  )
}

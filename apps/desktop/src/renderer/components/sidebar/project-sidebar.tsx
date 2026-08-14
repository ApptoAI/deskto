import SettingsIcon from "lucide-react/dist/esm/icons/settings"
import SquarePenIcon from "lucide-react/dist/esm/icons/square-pen"
import type { Thread, Project } from "@openappto/protocol"

import { Button } from "@workspace/ui/components/button"

import type { QueryState } from "../../runtime/use-runtime-query.js"
import { ProjectMenu } from "./project-menu.js"
import { TaskList } from "./task-list.js"

export function ProjectSidebar({
  projects,
  activeProject,
  onSelectProject,
  onAddProject,
  addingProject,
  threads,
  openThreadId,
  onOpenThread,
  onNewTask,
  onRetryThreads,
  onOpenSettings,
}: {
  projects: Project[]
  activeProject: Project | null
  onSelectProject: (projectId: string) => void
  onAddProject: () => void
  addingProject: boolean
  threads: QueryState<Thread[]>
  openThreadId: string | null
  onOpenThread: (threadId: string) => void
  onNewTask: () => void
  onRetryThreads: () => void
  onOpenSettings: () => void
}) {
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border xl:w-72">
      <div className="drag-region h-10 shrink-0" />

      <div className="no-drag space-y-1 px-2 pb-2">
        <ProjectMenu
          projects={projects}
          activeProject={activeProject}
          onSelect={onSelectProject}
          onAddProject={onAddProject}
          adding={addingProject}
        />
        <Button
          variant="ghost"
          size="lg"
          className="w-full justify-start text-muted-foreground"
          onClick={onNewTask}
          disabled={!activeProject}
        >
          <SquarePenIcon data-icon="inline-start" />
          New task
        </Button>
      </div>

      {activeProject ? (
        <>
          <h2 className="px-4 pt-3 pb-1.5 text-xs font-medium text-muted-foreground">
            Tasks
          </h2>
          <nav
            aria-label="Tasks"
            className="min-h-0 flex-1 overflow-y-auto pb-3"
          >
            <TaskList
              state={threads}
              openThreadId={openThreadId}
              onOpenThread={onOpenThread}
              onRetry={onRetryThreads}
            />
          </nav>
          <p
            className="truncate border-t border-border px-4 py-2.5 text-xs text-muted-foreground"
            title={activeProject.path}
          >
            {activeProject.path}
          </p>
        </>
      ) : (
        <div className="flex-1" />
      )}

      <div className="no-drag border-t border-border p-2">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-muted-foreground"
          onClick={onOpenSettings}
        >
          <SettingsIcon data-icon="inline-start" />
          Settings
        </Button>
      </div>
    </aside>
  )
}

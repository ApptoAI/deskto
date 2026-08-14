import PencilIcon from "lucide-react/dist/esm/icons/pencil"
import SettingsIcon from "lucide-react/dist/esm/icons/settings"
import SquarePenIcon from "lucide-react/dist/esm/icons/square-pen"
import type { Thread, Project, Workspace } from "@openappto/protocol"

import { Button } from "@workspace/ui/components/button"

import type { QueryState } from "../../runtime/use-runtime-query.js"
import { ProjectSwitcher } from "./project-switcher.js"
import { TaskList, type InboxActions } from "./task-list.js"
import { WorkspaceThreadList } from "./workspace-thread-list.js"

export function ProjectSidebar({
  workspace,
  workspaces,
  projects,
  activeProject,
  allProjects,
  onSelectProject,
  onSelectAllProjects,
  onAddProject,
  onMoveProject,
  addingProject,
  onEditWorkspace,
  threads,
  workspaceThreads,
  openThreadId,
  onOpenThread,
  onNewTask,
  onRetryThreads,
  onOpenSettings,
  inboxActions,
}: {
  workspace: Workspace | null
  workspaces: Workspace[]
  projects: Project[]
  activeProject: Project | null
  allProjects: boolean
  onSelectProject: (projectId: string) => void
  onSelectAllProjects: () => void
  onAddProject: () => void
  onMoveProject: (projectId: string, workspaceId: string) => void
  addingProject: boolean
  onEditWorkspace: () => void
  threads: QueryState<Thread[]>
  workspaceThreads: QueryState<Record<string, Thread[]>>
  openThreadId: string | null
  onOpenThread: (threadId: string) => void
  onNewTask: () => void
  onRetryThreads: () => void
  onOpenSettings: () => void
  inboxActions: InboxActions
}) {
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-sidebar xl:w-72">
      <div className="drag-region h-13 shrink-0" />

      <div className="no-drag group flex h-9 items-center justify-between pr-2 pl-4">
        <h1 className="truncate text-sm font-semibold">
          {workspace?.name ?? "Workspace"}
        </h1>
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          aria-label="Edit workspace"
          onClick={onEditWorkspace}
          disabled={!workspace}
        >
          <PencilIcon />
        </Button>
      </div>

      <div className="no-drag space-y-0.5 px-2 pt-1 pb-3">
        <Button
          variant="ghost"
          className="w-full justify-start text-muted-foreground"
          onClick={onNewTask}
          disabled={!activeProject}
        >
          <SquarePenIcon data-icon="inline-start" />
          New task
        </Button>
        <ProjectSwitcher
          workspaces={workspaces}
          projects={projects}
          activeProject={activeProject}
          allProjects={allProjects}
          onSelectProject={onSelectProject}
          onSelectAllProjects={onSelectAllProjects}
          onAddProject={onAddProject}
          onMoveProject={onMoveProject}
          adding={addingProject}
        />
      </div>

      <nav
        aria-label="Tasks"
        className="no-drag min-h-0 flex-1 overflow-y-auto pb-3"
      >
        {projects.length === 0 ? (
          <div className="space-y-2 px-4 py-2">
            <p className="text-sm text-muted-foreground">No projects yet.</p>
            <Button
              variant="outline"
              size="sm"
              onClick={onAddProject}
              disabled={addingProject}
            >
              {addingProject ? "Opening…" : "Add a project folder"}
            </Button>
          </div>
        ) : allProjects ? (
          <WorkspaceThreadList
            projects={projects}
            state={workspaceThreads}
            openThreadId={openThreadId}
            onOpenThread={onOpenThread}
            onRetry={onRetryThreads}
            actions={inboxActions}
          />
        ) : (
          <TaskList
            state={threads}
            openThreadId={openThreadId}
            onOpenThread={onOpenThread}
            onRetry={onRetryThreads}
            actions={inboxActions}
          />
        )}
      </nav>

      {!allProjects && activeProject ? (
        <p
          className="truncate border-t border-border px-4 py-2.5 text-xs text-muted-foreground"
          title={activeProject.path}
        >
          {activeProject.path}
        </p>
      ) : null}

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

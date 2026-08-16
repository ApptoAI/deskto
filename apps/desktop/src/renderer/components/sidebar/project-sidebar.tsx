import SettingsIcon from "lucide-react/dist/esm/icons/settings"
import SquarePenIcon from "lucide-react/dist/esm/icons/square-pen"
import type { Thread, Project, Workspace } from "@deskto/protocol"
import { appSettings } from "@deskto/settings"

import { Button } from "@workspace/ui/components/button"

import { Kbd } from "@workspace/ui/components/kbd"
import { ScrollArea } from "@workspace/ui/components/scroll-area"

import { useKeybindingLabel } from "../../settings/use-keybinding.js"
import type { QueryState } from "../../runtime/use-runtime-query.js"
import { DesktoLockup } from "../deskto-logo.js"
import { ProjectSwitcher } from "./project-switcher.js"
import { TaskList, type InboxActions } from "./task-list.js"
import { WorkspaceSwitcher } from "./workspace-switcher.js"
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
  onSelectWorkspace,
  onCreateWorkspace,
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
  onSelectWorkspace: (workspaceId: string) => void
  onCreateWorkspace: () => void
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
  const newTaskShortcut = useKeybindingLabel(appSettings.newTaskKeybinding)

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-sidebar xl:w-80">
      {/* Traffic lights sit at the left of this strip, so the logo takes the
          right. Still a drag region — the svg is not an interactive target. */}
      <div className="drag-region flex h-13 shrink-0 items-center justify-end px-3">
        <DesktoLockup className="h-[15px] w-auto text-foreground/70" />
      </div>

      <div className="no-drag px-2 pb-3">
        <WorkspaceSwitcher
          workspace={workspace}
          workspaces={workspaces}
          onSelect={onSelectWorkspace}
          onCreate={onCreateWorkspace}
          onEdit={onEditWorkspace}
        />
      </div>

      <div className="no-drag space-y-1.5 px-2 pb-2">
        <Button
          variant="secondary"
          size="lg"
          className="w-full justify-start"
          onClick={onNewTask}
          disabled={!activeProject}
        >
          <SquarePenIcon
            data-icon="inline-start"
            className="text-muted-foreground"
          />
          New task
          {newTaskShortcut ? (
            <Kbd data-icon="inline-end" className="ml-auto">
              {newTaskShortcut}
            </Kbd>
          ) : null}
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

      {/* No scrollbar in the task list: the rows are the chrome here, and a
          lane down the edge would cut into them. The fade at either end is
          the only signal that the list runs past the viewport. */}
      <ScrollArea
        hideScrollbars
        scrollFade
        render={<nav aria-label="Tasks" />}
        className="no-drag h-auto min-h-0 flex-1"
      >
        <div className="pb-3">
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
        </div>
      </ScrollArea>

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

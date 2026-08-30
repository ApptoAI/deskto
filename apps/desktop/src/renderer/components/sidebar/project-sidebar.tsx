import { useEffect, useRef } from "react"
import FolderIcon from "lucide-react/dist/esm/icons/folder"
import PuzzleIcon from "lucide-react/dist/esm/icons/puzzle"
import PencilIcon from "lucide-react/dist/esm/icons/pencil"
import SettingsIcon from "lucide-react/dist/esm/icons/settings"
import RefreshCwIcon from "lucide-react/dist/esm/icons/refresh-cw"
import SquarePenIcon from "lucide-react/dist/esm/icons/square-pen"
import type { Thread, Project, Workspace } from "@deskto/protocol"
import { appSettings, type WorkspaceLayout } from "@deskto/settings"

import { Button } from "@workspace/ui/components/button"

import { Kbd } from "@workspace/ui/components/kbd"
import { ScrollArea } from "@workspace/ui/components/scroll-area"

import { useKeybindingLabel } from "../../settings/use-keybinding.js"
import { useUpdates } from "../../updates/updates-context.js"
import type { QueryState } from "../../runtime/use-runtime-query.js"
import { ProjectSwitcher } from "./project-switcher.js"
import { SidebarFrame } from "./sidebar-frame.js"
import { TaskList, type InboxActions } from "./task-list.js"
import {
  WorkspaceHeaderLabel,
  WorkspaceSwitcher,
} from "./workspace-switcher.js"
import { WorkspaceThreadList } from "./workspace-thread-list.js"

const sidebarRowClass = "w-full justify-start gap-2 px-2"

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
  onEditProject,
  onSetProjectPinned,
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
  onOpenProjects,
  projectsActive,
  onOpenSkills,
  skillsActive,
  onOpenSettings,
  focusSettings,
  inboxActions,
  workspaceLayout,
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
  onEditProject: () => void
  onSetProjectPinned: (projectId: string, pinned: boolean) => void
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
  onOpenProjects: () => void
  projectsActive: boolean
  onOpenSkills: () => void
  skillsActive: boolean
  onOpenSettings: () => void
  /** True when Settings just closed, so the button that opened it takes focus
      back instead of leaving the caret on the body. */
  focusSettings: boolean
  inboxActions: InboxActions
  workspaceLayout: WorkspaceLayout
}) {
  const {
    state: updateState,
    actionError: updateActionError,
    install: installUpdate,
  } = useUpdates()
  const newTaskShortcut = useKeybindingLabel(appSettings.newTaskKeybinding)
  const settingsButton = useRef<HTMLButtonElement>(null)
  // The secondary folder line uses the same lookup in both single-project and
  // all-project scopes, keeping its title axis aligned with the task above.
  const openProjectNames = activeProject
    ? new Map([[activeProject.id, activeProject.name]])
    : undefined
  useEffect(() => {
    if (focusSettings) settingsButton.current?.focus()
  }, [focusSettings])

  return (
    <SidebarFrame width={workspaceLayout === "slack" ? "compact" : "default"}>
      <div className="no-drag px-2 pb-3">
        {workspaceLayout === "slack" ? (
          <Button
            variant="ghost"
            size="lg"
            className={sidebarRowClass}
            onClick={onEditWorkspace}
            disabled={!workspace}
            aria-label={`Workspace settings for ${workspace?.name ?? "workspace"}`}
          >
            <WorkspaceHeaderLabel workspace={workspace} />
            <PencilIcon
              data-icon="inline-end"
              className="text-muted-foreground"
            />
          </Button>
        ) : (
          <WorkspaceSwitcher
            workspace={workspace}
            workspaces={workspaces}
            onSelect={onSelectWorkspace}
            onCreate={onCreateWorkspace}
            onEdit={onEditWorkspace}
          />
        )}
      </div>

      <div className="no-drag space-y-1.5 px-2 pb-2">
        <Button
          variant="ghost"
          size="lg"
          className={sidebarRowClass}
          onClick={onNewTask}
          disabled={!activeProject}
        >
          <span className="flex w-5 shrink-0 items-center justify-center">
            <SquarePenIcon className="size-4 text-muted-foreground" />
          </span>
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
          onEditProject={onEditProject}
          onSetPinned={onSetProjectPinned}
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
                Create project
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
              projectNameById={openProjectNames}
            />
          )}
        </div>
      </ScrollArea>

      {/* A rule above the foot, as in the design: the nav is a different kind
          of thing from the task list and needs saying so. */}
      <div className="no-drag space-y-0.5 border-t border-edge px-2 pt-1.5 pb-3">
        {updateState?.status === "ready" ? (
          <Button
            variant="secondary"
            size="lg"
            className={sidebarRowClass}
            onClick={() => void installUpdate()}
          >
            <span className="flex w-5 shrink-0 items-center justify-center">
              <RefreshCwIcon className="size-4" />
            </span>
            Restart to update
          </Button>
        ) : null}
        {updateActionError && updateState?.status === "ready" ? (
          <p role="alert" className="px-2 py-1 text-xs text-destructive">
            {updateActionError}
          </p>
        ) : null}
        <Button
          variant={projectsActive ? "secondary" : "ghost"}
          size="lg"
          className={`${sidebarRowClass} text-muted-foreground`}
          onClick={onOpenProjects}
          aria-current={projectsActive ? "page" : undefined}
        >
          <span className="flex w-5 shrink-0 items-center justify-center">
            <FolderIcon className="size-4" />
          </span>
          Projects
        </Button>
        <Button
          variant={skillsActive ? "secondary" : "ghost"}
          size="lg"
          className={`${sidebarRowClass} text-muted-foreground`}
          onClick={onOpenSkills}
          aria-current={skillsActive ? "page" : undefined}
        >
          <span className="flex w-5 shrink-0 items-center justify-center">
            <PuzzleIcon className="size-4" />
          </span>
          Skills
        </Button>
        <Button
          ref={settingsButton}
          variant="ghost"
          size="lg"
          className={`${sidebarRowClass} text-muted-foreground`}
          onClick={onOpenSettings}
        >
          <span className="flex w-5 shrink-0 items-center justify-center">
            <SettingsIcon className="size-4" />
          </span>
          Settings
        </Button>
      </div>
    </SidebarFrame>
  )
}

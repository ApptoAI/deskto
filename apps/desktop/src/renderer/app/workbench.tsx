import { useCallback, useMemo, useState, type ReactNode } from "react"
import { appSettings, settingValue } from "@deskto/settings"

import { personalWorkspaceId } from "@deskto/protocol"
import { Button } from "@workspace/ui/components/button"

import { surfaceCommandIds } from "../commands/surface-commands.js"
import { InlineError } from "../components/inline-error.js"
import {
  useSurfaceCommand,
  useSurface,
  useSurfaceNavigation,
} from "../surface/surface-context.js"
import { OnboardingView } from "../components/onboarding/onboarding-view.js"
import { ProjectDialog } from "../components/project/project-dialog.js"
import { ProjectsView } from "../components/project/projects-view.js"
import { ProjectTasksView } from "../components/project/project-tasks-view.js"
import {
  firstSettingsPage,
  type SettingsPageId,
} from "../components/settings/settings-pages.js"
import { SettingsSidebar } from "../components/settings/settings-sidebar.js"
import { SettingsView } from "../components/settings/settings-view.js"
import { SkillsView } from "../components/skills/skills-view.js"
import {
  firstSkillsFilter,
  type SkillsFilter,
} from "../components/skills/skills-filters.js"
import { ProjectSidebar } from "../components/sidebar/project-sidebar.js"
import type { InboxActions } from "../components/sidebar/task-list.js"
import { WorkspaceRail } from "../components/sidebar/workspace-rail.js"
import { StatusPanel } from "../components/status-panel.js"
import { NewTaskProjectPicker } from "../components/task/new-task-project-picker.js"
import { NewTaskView } from "../components/task/new-task-view.js"
import { TaskView } from "../components/task/task-view.js"
import {
  WorkspaceDialog,
  type WorkspaceDraft,
} from "../components/workspace/workspace-dialog.js"
import {
  readRememberedOnboardingCompleted,
  rememberOnboardingCompleted,
  shouldShowOnboarding,
} from "../lib/onboarding.js"
import { readRememberedWorkspaceLayout } from "../lib/workspace-layout.js"
import { useProjectPanel } from "./use-project-panel.js"
import { useRuntimeClient } from "../runtime/runtime-client-context.js"
import { useHarnessChanged } from "../runtime/use-harness-changed.js"
import { useRuntimeQuery } from "../runtime/use-runtime-query.js"
import { useThreadDeleted } from "../runtime/use-thread-deleted.js"
import { useKeybinding } from "../settings/use-keybinding.js"
import { useSettings } from "../settings/settings-context.js"
import { useActionError } from "./use-action-error.js"
import { usePackActions } from "./use-pack-actions.js"
import { useProjectActions } from "./use-project-actions.js"
import { useThreadQueries } from "./use-thread-queries.js"
import { useWorkspaceSelection } from "./use-workspace-selection.js"
import { toNewTask, toProject, type MainView } from "./work-view.js"

type WorkspaceDialogState = null | { mode: "create" } | { mode: "edit" }

export function Workbench() {
  const client = useRuntimeClient()
  const surface = useSurface()
  const { snapshot: settingsSnapshot, update: updateSettings } = useSettings()
  const [rememberedWorkspaceLayout] = useState(readRememberedWorkspaceLayout)
  const workspaceLayout = settingsSnapshot
    ? settingValue(settingsSnapshot, appSettings.workspaceLayout)
    : rememberedWorkspaceLayout

  const [rememberedOnboarding] = useState(readRememberedOnboardingCompleted)
  const onboardingCompleted = settingsSnapshot
    ? settingValue(settingsSnapshot, appSettings.onboardingCompleted)
    : rememberedOnboarding
  const [onboardingDismissed, setOnboardingDismissed] = useState(false)
  const showOnboarding = shouldShowOnboarding({
    completed: onboardingCompleted,
    forceOnboarding: window.deskto.devFlags.forceOnboarding,
    dismissedThisSession: onboardingDismissed,
  })

  function finishOnboarding() {
    rememberOnboardingCompleted(true)
    void updateSettings({ [appSettings.onboardingCompleted.key]: true }).catch(
      () => {
        // Best effort: the session stays dismissed either way, but if this
        // write failed the sync will re-mirror false and the wizard may
        // return on the next launch.
      }
    )
    setOnboardingDismissed(true)
  }

  const loadHarnesses = useCallback(() => client.listHarnesses(), [client])
  const harnesses = useRuntimeQuery(loadHarnesses)
  const revalidateHarnesses = harnesses.revalidate
  useHarnessChanged(
    useCallback(() => revalidateHarnesses(), [revalidateHarnesses])
  )

  const [view, setView] = useState<MainView>({ kind: "project" })
  const [workspaceDialog, setWorkspaceDialog] =
    useState<WorkspaceDialogState>(null)

  const { actionError, clearActionError, tryAction, runAction } =
    useActionError()

  const {
    workspaces,
    projects,
    workspaceProjects,
    activeWorkspace,
    activeWorkspaceId,
    activeProject,
    activeProjectId,
    allProjects,
    selectWorkspace,
    selectProject,
    selectAllProjects,
    listsLoading,
    listsError,
    retryLists,
    revalidateSelection,
  } = useWorkspaceSelection(client, setView, runAction)

  const {
    threads,
    workspaceThreads,
    revalidateThreads,
    revalidateThreadsSoon,
  } = useThreadQueries(client, {
    projectId: activeProjectId,
    workspaceProjectIds: workspaceProjects.map((project) => project.id),
    allProjects,
  })

  const { packsQuery, packActions } = usePackActions(client, {
    skillsOpen: view.kind === "skills",
    activeWorkspaceId,
    tryAction,
  })

  const {
    hasOpenDialog,
    addProject,
    moveProject,
    setProjectPinned,
    projectDialog,
  } = useProjectActions(client, {
    activeWorkspaceId,
    selectProject,
    clearActionError,
    tryAction,
    runAction,
  })
  const hasOpenModal = hasOpenDialog || workspaceDialog !== null

  // In all-projects scope the remembered project must not decide for the
  // user: a new task uses the project picked on the view itself, and until
  // one is picked the composer stays behind the project question. A lone
  // project answers the question by itself.
  const newTaskProject = allProjects
    ? workspaceProjects.length === 1
      ? (workspaceProjects[0] ?? null)
      : (workspaceProjects.find(
          (project) => view.kind === "new-task" && project.id === view.projectId
        ) ?? null)
    : activeProject

  const {
    preference: panelPreference,
    setCollapsed: setPanelCollapsed,
    forceOpen: forcePanelOpen,
  } = useProjectPanel(newTaskProject?.id ?? null)

  const openProjectPanel = useCallback(() => {
    if (!activeProject) return
    setView({ kind: "new-task", projectId: activeProject.id })
    forcePanelOpen(activeProject.id)
  }, [activeProject, forcePanelOpen])

  const openProjectFromGrid = useCallback(
    (projectId: string) => {
      selectProject(projectId)
      setView(toProject)
    },
    [selectProject]
  )

  // A deleted task has nothing left to reload, so the pane closes on the event
  // rather than after the request resolves — otherwise the open view refetches
  // the missing thread first and flashes an error.
  useThreadDeleted(
    useCallback(
      (threadId: string) => {
        setView((current) => {
          if (current.kind === "task" && current.threadId === threadId) {
            return toProject(current)
          }
          // Settings stays open, but Go back cannot land on a task that is gone.
          if (
            current.kind === "settings" &&
            current.returnTo.kind === "task" &&
            current.returnTo.threadId === threadId
          ) {
            return toProject(current)
          }
          return current
        })
        revalidateThreadsSoon()
      },
      [revalidateThreadsSoon]
    )
  )

  const inSettings = view.kind === "settings"
  const cycleWorkspace = useCallback(
    (direction: number) => {
      const index = workspaces.findIndex(
        (workspace) => workspace.id === activeWorkspaceId
      )
      const next =
        workspaces[(index + direction + workspaces.length) % workspaces.length]!
      selectWorkspace(next.id)
    },
    [workspaces, activeWorkspaceId, selectWorkspace]
  )

  const commandsBlocked = inSettings || hasOpenModal || showOnboarding
  const newTaskCommand = useMemo(
    () => ({
      id: surfaceCommandIds.newTask,
      title: "New task",
      enabled: () => !commandsBlocked,
      run: () => surface.navigation.newTask(),
    }),
    [commandsBlocked, surface.navigation]
  )
  const nextWorkspaceCommand = useMemo(
    () => ({
      id: surfaceCommandIds.nextWorkspace,
      title: "Next workspace",
      enabled: () => !commandsBlocked && workspaces.length > 1,
      run: () => surface.navigation.nextWorkspace(),
    }),
    [commandsBlocked, surface.navigation, workspaces.length]
  )
  const previousWorkspaceCommand = useMemo(
    () => ({
      id: surfaceCommandIds.previousWorkspace,
      title: "Previous workspace",
      enabled: () => !commandsBlocked && workspaces.length > 1,
      run: () => surface.navigation.previousWorkspace(),
    }),
    [commandsBlocked, surface.navigation, workspaces.length]
  )
  useSurfaceCommand(newTaskCommand)
  useSurfaceCommand(nextWorkspaceCommand)
  useSurfaceCommand(previousWorkspaceCommand)

  // Settings and modal screens stand down until the person returns to the
  // workbench. The command owns that policy so every future trigger agrees.
  useKeybinding(
    appSettings.newTaskKeybinding,
    useCallback(() => {
      void surface.commands.execute(surfaceCommandIds.newTask)
    }, [surface.commands])
  )

  useKeybinding(
    appSettings.nextWorkspaceKeybinding,
    useCallback(() => {
      void surface.commands.execute(surfaceCommandIds.nextWorkspace)
    }, [surface.commands])
  )
  useKeybinding(
    appSettings.previousWorkspaceKeybinding,
    useCallback(() => {
      void surface.commands.execute(surfaceCommandIds.previousWorkspace)
    }, [surface.commands])
  )

  // Opening Settings unmounts the button that was clicked; closing it puts
  // focus back there rather than on the body.
  const [focusSettingsButton, setFocusSettingsButton] = useState(false)

  const openSettings = useCallback(() => {
    setFocusSettingsButton(false)
    setView((current) =>
      current.kind === "settings"
        ? current
        : { kind: "settings", page: firstSettingsPage, returnTo: current }
    )
  }, [])

  function selectSettingsPage(page: SettingsPageId) {
    setView((current) =>
      current.kind === "settings" ? { ...current, page } : current
    )
  }

  function leaveSettings() {
    setFocusSettingsButton(true)
    setView((current) =>
      current.kind === "settings" ? current.returnTo : current
    )
  }

  const openThread = useCallback((threadId: string) => {
    setView({ kind: "task", threadId })
  }, [])

  const openSkills = useCallback(() => {
    setView({ kind: "skills", filter: firstSkillsFilter })
  }, [])

  const openProjects = useCallback(() => {
    setView({ kind: "projects" })
  }, [])

  const navigationHost = useMemo(
    () => ({
      newTask: () => setView(toNewTask),
      openTask: openThread,
      openProjects,
      openSkills,
      openSettings,
      nextWorkspace: () => cycleWorkspace(1),
      previousWorkspace: () => cycleWorkspace(-1),
    }),
    [cycleWorkspace, openProjects, openSettings, openSkills, openThread]
  )
  useSurfaceNavigation(navigationHost)

  function selectSkillsFilter(filter: SkillsFilter) {
    setView((current) =>
      current.kind === "skills" ? { ...current, filter } : current
    )
  }

  // Mutation responses are ignored on purpose: each one emits thread.changed,
  // and the list queries refetch from there like every other thread update.
  // Memoized so every task row is not handed a fresh identity per render.
  const inboxActions: InboxActions = useMemo(
    () => ({
      onSetDone: (threadId, done) =>
        runAction(() => client.setThreadDone(threadId, done)),
      onSnooze: (threadId, until) =>
        runAction(() => client.snoozeThread(threadId, until)),
      onWake: (threadId) => runAction(() => client.wakeThread(threadId)),
      onSetPinned: (threadId, pinned) =>
        runAction(() => client.setThreadPinned(threadId, pinned)),
      onDelete: (threadId) => runAction(() => client.deleteThread(threadId)),
    }),
    [client, runAction]
  )

  function submitWorkspace(draft: WorkspaceDraft) {
    return tryAction(async () => {
      if (workspaceDialog?.mode === "edit" && activeWorkspace) {
        await client.updateWorkspace(activeWorkspace.id, draft)
      } else {
        const created = await client.createWorkspace(
          draft.name,
          draft.color,
          draft.icon
        )
        selectWorkspace(created.id)
      }
    })
  }

  function deleteActiveWorkspace() {
    return tryAction(async () => {
      if (!activeWorkspace) return
      await client.deleteWorkspace(activeWorkspace.id)
      setView(toProject)
      revalidateSelection()
    })
  }

  const openThreadId = view.kind === "task" ? view.threadId : null

  // Only the single-project scope has a list to table up: in all-projects the
  // per-project query never runs, and the picker answers first anyway.
  const projectThreads =
    !allProjects && threads.state.status === "ready" ? threads.state.data : []

  // One branch per screen the main pane can show, from the most modal state
  // (Settings) down to the default new-task composer.
  function renderMain() {
    if (view.kind === "settings") {
      return <SettingsView page={view.page} harnesses={harnesses} />
    }
    if (listsError) {
      return (
        <Screen>
          <StatusPanel
            title="Deskto cannot reach the runtime"
            description={listsError}
            tone="danger"
          >
            <Button variant="outline" onClick={retryLists}>
              Try again
            </Button>
          </StatusPanel>
        </Screen>
      )
    }
    if (listsLoading) {
      return (
        <Screen>
          <StatusPanel title="Loading your projects…" />
        </Screen>
      )
    }
    if (view.kind === "projects") {
      return (
        <ProjectsView
          projects={workspaceProjects}
          onOpenProject={openProjectFromGrid}
          onNewProject={addProject}
          onSetPinned={setProjectPinned}
          creating={projectDialog.open}
        />
      )
    }
    if (view.kind === "skills") {
      return (
        <SkillsView
          filter={view.filter}
          project={activeProject}
          workspace={activeWorkspace}
          packs={packsQuery}
          packActions={packActions}
          onCreateSkill={packActions.onCreateSkill}
          onSelectFilter={selectSkillsFilter}
        />
      )
    }
    if (!activeProject) {
      return (
        <Screen>
          <StatusPanel
            title="Create your first project"
            description="Deskto can manage its folder now. You can move it somewhere else later."
          >
            <Button onClick={addProject} disabled={projectDialog.open}>
              Create project
            </Button>
          </StatusPanel>
        </Screen>
      )
    }
    if (openThreadId) {
      return (
        <TaskView
          key={openThreadId}
          threadId={openThreadId}
          harnesses={harnesses.state}
          projects={projects}
        />
      )
    }
    if (!newTaskProject) {
      return (
        <NewTaskProjectPicker
          projects={workspaceProjects}
          onSelect={(projectId) => setView({ kind: "new-task", projectId })}
        />
      )
    }
    // A project with work in it rests on that work. New task asked for a
    // blank composer, so it gets one; the centered screen is also what a
    // project with no tasks yet shows, where a table would be a header row
    // over an empty space.
    if (view.kind !== "new-task" && projectThreads.length > 0) {
      return (
        <ProjectTasksView
          key={newTaskProject.id}
          project={newTaskProject}
          threads={projectThreads}
          harnesses={harnesses.state}
          openThreadId={openThreadId}
          onOpenThread={surface.navigation.openTask}
          onTaskCreated={revalidateThreads}
          onTaskStarted={surface.navigation.openTask}
        />
      )
    }
    return (
      <NewTaskView
        key={newTaskProject.id}
        project={newTaskProject}
        harnesses={harnesses.state}
        onTaskCreated={revalidateThreads}
        onTaskStarted={surface.navigation.openTask}
        panelPreference={panelPreference}
        onPanelCollapsedChange={setPanelCollapsed}
      />
    )
  }

  // Shared between the wizard and the workbench: the wizard's project step
  // opens this same dialog, so it must stay mounted in both returns.
  const projectDialogElement = (
    <ProjectDialog
      open={projectDialog.open}
      onOpenChange={projectDialog.setOpen}
      templates={projectDialog.templates}
      templatesLoading={projectDialog.loading}
      loadError={projectDialog.error}
      actionError={actionError}
      onRetry={projectDialog.retry}
      onChooseFolder={projectDialog.chooseFolder}
      onSubmit={projectDialog.createProject}
    />
  )

  // More modal than Settings: the wizard replaces the sidebars, the error
  // strips, and every screen until the user finishes or skips.
  if (showOnboarding) {
    return (
      <div className="flex h-dvh w-full flex-col overflow-hidden bg-background text-foreground">
        <OnboardingView
          harnesses={harnesses}
          workspaceReady={activeWorkspaceId !== null}
          hasProject={activeProject !== null}
          creatingProject={projectDialog.open}
          onCreateProject={addProject}
          onFinish={finishOnboarding}
        />
        {projectDialogElement}
      </div>
    )
  }

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background text-foreground">
      {view.kind === "settings" ? (
        <SettingsSidebar
          page={view.page}
          workspaceLayout={workspaceLayout}
          onSelectPage={selectSettingsPage}
          onGoBack={leaveSettings}
        />
      ) : (
        <>
          {workspaceLayout === "slack" ? (
            <WorkspaceRail
              workspaces={workspaces}
              activeWorkspaceId={activeWorkspaceId}
              onSelect={selectWorkspace}
              onCreate={() => setWorkspaceDialog({ mode: "create" })}
            />
          ) : null}
          <ProjectSidebar
            workspace={activeWorkspace}
            workspaces={workspaces}
            projects={workspaceProjects}
            activeProject={activeProject}
            allProjects={allProjects}
            onSelectProject={selectProject}
            onSelectAllProjects={selectAllProjects}
            onAddProject={addProject}
            onMoveProject={moveProject}
            onEditProject={openProjectPanel}
            onSetProjectPinned={setProjectPinned}
            addingProject={projectDialog.open}
            onSelectWorkspace={selectWorkspace}
            onCreateWorkspace={() => setWorkspaceDialog({ mode: "create" })}
            onEditWorkspace={() => setWorkspaceDialog({ mode: "edit" })}
            threads={threads.state}
            workspaceThreads={workspaceThreads.state}
            openThreadId={openThreadId}
            onOpenThread={surface.navigation.openTask}
            onNewTask={() => {
              void surface.commands.execute(surfaceCommandIds.newTask)
            }}
            onRetryThreads={revalidateThreads}
            onOpenProjects={surface.navigation.openProjects}
            projectsActive={view.kind === "projects"}
            onOpenSkills={surface.navigation.openSkills}
            skillsActive={view.kind === "skills"}
            onOpenSettings={surface.navigation.openSettings}
            focusSettings={focusSettingsButton}
            inboxActions={inboxActions}
            workspaceLayout={workspaceLayout}
          />
        </>
      )}

      {/* min-h-0 and the clip: without them a tall screen can be scrolled as a
          whole — by focus, not by the wheel — which drags the window chrome
          off the top of the app. Every screen scrolls inside itself. */}
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {actionError ? (
          <div className="px-6 pt-3">
            <InlineError message={actionError} />
          </div>
        ) : null}

        {harnesses.state.status === "error" && view.kind !== "settings" ? (
          <div className="flex items-center gap-3 px-6 pt-3">
            <InlineError
              className="min-w-0 flex-1"
              message={`Deskto cannot read the list of agents. ${harnesses.state.message}`}
            />
            <Button variant="outline" size="sm" onClick={harnesses.revalidate}>
              Try again
            </Button>
          </div>
        ) : null}

        {renderMain()}
      </main>

      <WorkspaceDialog
        open={workspaceDialog !== null}
        onOpenChange={(open) => {
          if (!open) setWorkspaceDialog(null)
        }}
        workspace={workspaceDialog?.mode === "edit" ? activeWorkspace : null}
        canDelete={activeWorkspace?.id !== personalWorkspaceId}
        onSubmit={submitWorkspace}
        onDelete={deleteActiveWorkspace}
      />
      {projectDialogElement}
    </div>
  )
}

/** Adds the window drag strip that the task screens draw themselves. */
function Screen({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="drag-region h-10 shrink-0" />
      {children}
    </>
  )
}

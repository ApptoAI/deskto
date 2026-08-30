import { useCallback, useMemo, useState, type ReactNode } from "react"
import { appSettings, settingValue } from "@deskto/settings"

import { personalWorkspaceId, type Thread } from "@deskto/protocol"
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
import { toNewTask, type MainView } from "./work-view.js"
import FolderOpenIcon from "lucide-react/dist/esm/icons/folder-open"
import PanelRightIcon from "lucide-react/dist/esm/icons/panel-right"

import { DesktoMark } from "../components/deskto-logo.js"
import { useAccentSync } from "../settings/accent-sync.js"
import { openFolder } from "../lib/desktop.js"
import { TitleBar, TitleBarTask } from "../components/title-bar.js"
import {
  readRememberedSidebarOpen,
  rememberSidebarOpen,
} from "../lib/sidebar-visibility.js"

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

  // The titlebar's arrows need somewhere to go, so the view is a history
  // rather than a single value. Screens are compared by their serialized
  // shape: re-selecting the screen you are already on is not a journey, and
  // pushing it would make Back appear to do nothing.
  const [history, setHistory] = useState<{
    stack: MainView[]
    index: number
  }>(() => ({ stack: [{ kind: "new-task" }], index: 0 }))
  const view = history.stack[history.index]!
  const setView = useCallback((update: (current: MainView) => MainView) => {
    setHistory((current) => {
      const here = current.stack[current.index]!
      const next = update(here)
      if (JSON.stringify(next) === JSON.stringify(here)) return current
      const stack = [
        ...current.stack.slice(0, current.index + 1),
        next,
      ].slice(-50)
      return { stack, index: stack.length - 1 }
    })
  }, [])
  const canGoBack = history.index > 0
  const canGoForward = history.index < history.stack.length - 1
  const goBack = useCallback(() => {
    setHistory((c) => (c.index > 0 ? { ...c, index: c.index - 1 } : c))
  }, [])
  const goForward = useCallback(() => {
    setHistory((c) =>
      c.index < c.stack.length - 1 ? { ...c, index: c.index + 1 } : c
    )
  }, [])

  // The task list is summoned rather than always present, so whether it is out
  // is a preference the window has to remember between launches.
  const [sidebarOpen, setSidebarOpen] = useState(readRememberedSidebarOpen)
  const toggleSidebar = useCallback(() => {
    setSidebarOpen((open) => {
      rememberSidebarOpen(!open)
      return !open
    })
  }, [])
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

  // The accent follows the Workspace the person is standing in, and only when
  // they asked for one.
  useAccentSync(
    settingsSnapshot
      ? settingValue(settingsSnapshot, appSettings.accentSource)
      : "monochrome",
    activeWorkspace
  )

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
    setView(() => ({ kind: "new-task", projectId: activeProject.id }))
    forcePanelOpen(activeProject.id)
  }, [activeProject, forcePanelOpen, setView])

  const openProjectFromGrid = useCallback(
    (projectId: string) => {
      selectProject(projectId)
      setView(toNewTask)
    },
    [selectProject, setView]
  )

  // A deleted task has nothing left to reload, so the pane closes on the event
  // rather than after the request resolves — otherwise the open view refetches
  // the missing thread first and flashes an error.
  // A deleted task has to leave the history, not just the open view. Replacing
  // only the current entry left every earlier visit to that task in the stack,
  // so Back walked straight back into a thread that no longer exists.
  const forgetThread = useCallback((threadId: string) => {
    setHistory((current) => {
      const rewritten = current.stack.map((entry): MainView => {
        if (entry.kind === "task" && entry.threadId === threadId) {
          return toNewTask(entry)
        }
        // Settings stays open, but Go back cannot land on a task that is gone.
        if (
          entry.kind === "settings" &&
          entry.returnTo.kind === "task" &&
          entry.returnTo.threadId === threadId
        ) {
          // returnTo is never a settings view, so the blank task is the
          // only thing it can fall back to.
          return { ...entry, returnTo: { kind: "new-task" } }
        }
        return entry
      })
      // Rewriting can leave the same screen twice in a row, and a Back that
      // appears to do nothing is worse than a shorter history.
      const stack: MainView[] = []
      let index = 0
      rewritten.forEach((entry, at) => {
        const previous = stack[stack.length - 1]
        if (
          previous === undefined ||
          JSON.stringify(previous) !== JSON.stringify(entry)
        ) {
          stack.push(entry)
        }
        if (at === current.index) index = stack.length - 1
      })
      return { stack, index }
    })
  }, [])

  useThreadDeleted(
    useCallback(
      (threadId: string) => {
        forgetThread(threadId)
        revalidateThreadsSoon()
      },
      [forgetThread, revalidateThreadsSoon]
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
  }, [setView])

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
    setView(() => ({ kind: "task", threadId }))
  }, [setView])

  const openSkills = useCallback(() => {
    setView(() => ({ kind: "skills", filter: firstSkillsFilter }))
  }, [setView])

  const openProjects = useCallback(() => {
    setView(() => ({ kind: "projects" }))
  }, [setView])

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
    [cycleWorkspace, openProjects, openSettings, openSkills, openThread, setView]
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
      setView(toNewTask)
      revalidateSelection()
    })
  }

  const openThreadId = view.kind === "task" ? view.threadId : null

  // The titlebar says what the window is showing. A task names itself and the
  // project it belongs to; every other screen just names itself, because the
  // screen is the thing rather than a thing inside something else.
  // In all-projects scope the workspace query groups threads by project, so
  // the open one can be in either shape depending on the current scope.
  const readyThreads: Thread[] = [
    ...(threads.state.status === "ready" ? threads.state.data : []),
    ...(workspaceThreads.state.status === "ready"
      ? Object.values(workspaceThreads.state.data).flat()
      : []),
  ]
  const activeThread = openThreadId
    ? (readyThreads.find((thread) => thread.id === openThreadId) ?? null)
    : null
  const activeThreadProject = activeThread
    ? (projects.find((project) => project.id === activeThread.projectId) ?? null)
    : null

  // The open screen's own actions ride in the titlebar rather than in a second
  // strip beneath it: one row of window chrome, not two.
  const titleActions = activeThread ? (
    <>
      {activeThreadProject?.path ? (
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
          title={`Open folder — ${activeThreadProject.path}`}
          aria-label="Open folder"
          onClick={() =>
            runAction(() => openFolder(activeThreadProject.path))
          }
        >
          <FolderOpenIcon />
        </Button>
      ) : null}
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground"
        title="Show or hide the task panel"
        aria-label="Show or hide the task panel"
        onClick={() => surface.panel.toggle({ threadId: activeThread.id })}
      >
        <PanelRightIcon />
      </Button>
    </>
  ) : null

  const titleContext =
    view.kind === "settings" ? (
      <TitleBarTask mark={null} title="Settings" />
    ) : view.kind === "projects" ? (
      <TitleBarTask mark={null} title="Projects" />
    ) : view.kind === "skills" ? (
      <TitleBarTask mark={null} title="Skills" />
    ) : activeThread ? (
      <TitleBarTask
        mark={
          <DesktoMark className="h-[15px] w-4 shrink-0 text-foreground/90" />
        }
        title={activeThread.title}
        {...(activeThreadProject
          ? { subtitle: `${activeThreadProject.name} @ local` }
          : {})}
      />
    ) : newTaskProject ? (
      <TitleBarTask
        mark={
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-full bg-foreground/75"
          />
        }
        title={newTaskProject.name}
      />
    ) : null

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
          onSelect={(projectId) => setView(() => ({ kind: "new-task", projectId }))}
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
      <div className="glass-window flex h-dvh w-full flex-col overflow-hidden text-foreground">
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
    <div className="glass-window flex h-dvh w-full flex-col overflow-hidden text-foreground">
      <TitleBar
        sidebarOpen={sidebarOpen}
        onToggleSidebar={toggleSidebar}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        onBack={goBack}
        onForward={goForward}
        onNewTask={() => {
          void surface.commands.execute(surfaceCommandIds.newTask)
        }}
        trailing={titleActions}
      >
        {titleContext}
      </TitleBar>

      <div className="flex min-h-0 flex-1">
      {view.kind === "settings" ? (
        <SettingsSidebar
          page={view.page}
          workspaceLayout={workspaceLayout}
          onSelectPage={selectSettingsPage}
          onGoBack={leaveSettings}
        />
      ) : sidebarOpen ? (
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
      ) : null}

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
      </div>

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

/** A full-height screen. The window's drag strip is the titlebar above it. */
function Screen({ children }: { children: ReactNode }) {
  return <>{children}</>
}

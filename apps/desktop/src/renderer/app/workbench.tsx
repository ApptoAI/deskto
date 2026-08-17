import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import type { RuntimeClient } from "@deskto/client"
import { appSettings } from "@deskto/settings"

import {
  personalWorkspaceId,
  mySkillsPackName,
  type ManagedSkillDraft,
  type Selection,
} from "@deskto/protocol"
import { Button } from "@workspace/ui/components/button"
import { z } from "zod"

import { InlineError } from "../components/inline-error.js"
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
import { StatusPanel } from "../components/status-panel.js"
import { NewTaskView } from "../components/task/new-task-view.js"
import { TaskView } from "../components/task/task-view.js"
import {
  WorkspaceDialog,
  type WorkspaceDraft,
} from "../components/workspace/workspace-dialog.js"
import {
  pickPackArchive,
  pickPackFolder,
  pickProjectFolder,
} from "../lib/desktop.js"
import { useLocalStorage } from "../lib/use-local-storage.js"
import { describedErrorSchema } from "../runtime/describe-error.js"
import { useRuntimeClient } from "../runtime/runtime-client-context.js"
import { useHarnessChanged } from "../runtime/use-harness-changed.js"
import { useRuntimeQuery } from "../runtime/use-runtime-query.js"
import { usePackChanged } from "../runtime/use-pack-changed.js"
import { useThreadChanged } from "../runtime/use-thread-changed.js"
import { useThreadDeleted } from "../runtime/use-thread-deleted.js"
import { useWorkspaceChanged } from "../runtime/use-workspace-changed.js"
import { useKeybinding } from "../settings/use-keybinding.js"
import { afterScopeChange, toNewTask, type MainView } from "./work-view.js"

type WorkspaceDialogState = null | { mode: "create" } | { mode: "edit" }
type ProjectScope = "all" | "project"

const projectScopeMapSchema = z.record(z.string(), z.enum(["all", "project"]))

function useProjectThreadLoader(
  client: RuntimeClient,
  projectId: string | null,
  allProjects: boolean
) {
  return useMemo(
    () =>
      projectId && !allProjects ? () => client.listThreads(projectId) : null,
    [client, projectId, allProjects]
  )
}

export function Workbench() {
  const client = useRuntimeClient()

  const loadHarnesses = useCallback(() => client.listHarnesses(), [client])
  const harnesses = useRuntimeQuery(loadHarnesses)
  const revalidateHarnesses = harnesses.revalidate

  useHarnessChanged(
    useCallback(() => revalidateHarnesses(), [revalidateHarnesses])
  )

  const loadWorkspaces = useCallback(() => client.listWorkspaces(), [client])
  const workspacesQuery = useRuntimeQuery(loadWorkspaces)
  const loadSelection = useCallback(() => client.getSelection(), [client])
  const selectionQuery = useRuntimeQuery(loadSelection)
  const loadProjects = useCallback(() => client.listProjects(), [client])
  const projectsQuery = useRuntimeQuery(loadProjects)

  const [view, setView] = useState<MainView>({ kind: "new-task" })
  const [addingProject, setAddingProject] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [workspaceDialog, setWorkspaceDialog] =
    useState<WorkspaceDialogState>(null)

  // Pack scans stand down outside Skills. The library needs them for its
  // source manager and for creating skills in the managed My Skills Pack.
  const skillsOpen = view.kind === "skills"
  const loadPacks = useMemo(
    () => (skillsOpen ? () => client.listPacks() : null),
    [client, skillsOpen]
  )
  const packsQuery = useRuntimeQuery(loadPacks)

  // Mutation responses stay slim; these events are the one refetch trigger.
  const revalidateWorkspaces = workspacesQuery.revalidate
  const revalidateProjects = projectsQuery.revalidate
  useWorkspaceChanged(
    useCallback(() => {
      revalidateWorkspaces()
      revalidateProjects()
    }, [revalidateWorkspaces, revalidateProjects])
  )
  const revalidatePacks = packsQuery.revalidate
  usePackChanged(useCallback(() => revalidatePacks(), [revalidatePacks]))

  const workspacesState = workspacesQuery.state
  const workspaces = useMemo(
    () => (workspacesState.status === "ready" ? workspacesState.data : []),
    [workspacesState]
  )
  const selection =
    selectionQuery.state.status === "ready" ? selectionQuery.state.data : null
  const projects =
    projectsQuery.state.status === "ready" ? projectsQuery.state.data : []

  // The persisted Selection is the single source of truth for where the user
  // is; selecting updates it optimistically and the runtime write follows.
  // Nothing activates until the selection loads, so a restart cannot flash
  // (and fetch for) the wrong workspace while the remembered one is in flight.
  const activeWorkspace = selection
    ? (workspaces.find(
        (workspace) => workspace.id === selection.lastWorkspaceId
      ) ??
      workspaces[0] ??
      null)
    : null
  const activeWorkspaceId = activeWorkspace?.id ?? null

  const workspaceProjects = projects.filter(
    (project) => project.workspaceId === activeWorkspaceId
  )
  const rememberedProjectId = activeWorkspaceId
    ? (selection?.lastProjectIds[activeWorkspaceId] ?? null)
    : null
  const activeProject =
    workspaceProjects.find((project) => project.id === rememberedProjectId) ??
    workspaceProjects[0] ??
    null
  const activeProjectId = activeProject?.id ?? null

  // Whether the sidebar shows one project's tasks or every project's, divided
  // into sections. Pure UI state, persisted per workspace in localStorage the
  // same way the composer remembers the last model.
  const [projectScopeMap, setProjectScopeMap] = useLocalStorage<
    Record<string, ProjectScope>
  >("deskto.sidebar.project-scope.v1", {}, projectScopeMapSchema)
  const allProjects = activeWorkspaceId
    ? (projectScopeMap[activeWorkspaceId] ?? "project") === "all"
    : false

  // Gated on the visible scope: in all-projects mode this query's result is
  // never rendered, and every thread.changed would refetch it for nothing.
  const loadThreads = useProjectThreadLoader(
    client,
    activeProjectId,
    allProjects
  )
  const threads = useRuntimeQuery(loadThreads)
  const revalidateThreads = threads.revalidate
  const setProjectScope = useCallback(
    (scope: ProjectScope) => {
      if (!activeWorkspaceId) return
      setProjectScopeMap((previous) => ({
        ...previous,
        [activeWorkspaceId]: scope,
      }))
    },
    [activeWorkspaceId, setProjectScopeMap]
  )

  // The all-projects view loads every project's threads together; the joined
  // key keeps the loader stable while the workspace's projects stay the same.
  const workspaceProjectIdsKey = workspaceProjects
    .map((project) => project.id)
    .join("\n")
  const loadWorkspaceThreads = useMemo(() => {
    if (!allProjects || workspaceProjectIdsKey === "") return null
    const ids = workspaceProjectIdsKey.split("\n")
    return async () => {
      const lists = await Promise.all(ids.map((id) => client.listThreads(id)))
      return Object.fromEntries(
        ids.map((id, index) => [id, lists[index]!] as const)
      )
    }
  }, [client, allProjects, workspaceProjectIdsKey])
  const workspaceThreads = useRuntimeQuery(loadWorkspaceThreads)
  const revalidateWorkspaceThreads = workspaceThreads.revalidate

  // Only the active scope's query has a loader; the other revalidate is a
  // no-op, so this refreshes exactly the list on screen.
  const revalidateAllThreads = useCallback(() => {
    revalidateThreads()
    revalidateWorkspaceThreads()
  }, [revalidateThreads, revalidateWorkspaceThreads])

  const threadChangedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const revalidateAfterThreadChanges = useCallback(() => {
    if (threadChangedTimer.current !== null) {
      clearTimeout(threadChangedTimer.current)
    }
    threadChangedTimer.current = setTimeout(() => {
      threadChangedTimer.current = null
      revalidateAllThreads()
    }, 100)
  }, [revalidateAllThreads])
  useEffect(
    () => () => {
      if (threadChangedTimer.current !== null) {
        clearTimeout(threadChangedTimer.current)
        threadChangedTimer.current = null
      }
    },
    [revalidateAfterThreadChanges]
  )

  useThreadChanged(revalidateAfterThreadChanges)

  // A deleted task has nothing left to reload, so the pane closes on the event
  // rather than after the request resolves — otherwise the open view refetches
  // the missing thread first and flashes an error.
  useThreadDeleted(
    useCallback(
      (threadId: string) => {
        setView((current) => {
          if (current.kind === "task" && current.threadId === threadId) {
            return toNewTask(current)
          }
          // Settings stays open, but Go back cannot land on a task that is gone.
          if (
            current.kind === "settings" &&
            current.returnTo.kind === "task" &&
            current.returnTo.threadId === threadId
          ) {
            return toNewTask(current)
          }
          return current
        })
        revalidateAfterThreadChanges()
      },
      [revalidateAfterThreadChanges]
    )
  )

  // Settings covers the whole window, so a shortcut that quietly changed the
  // screen behind it would land the user somewhere they never chose. Both
  // shortcuts below stand down until Go back.
  useKeybinding(
    appSettings.newTaskKeybinding,
    useCallback(
      () =>
        setView((current) =>
          current.kind === "settings" ? current : { kind: "new-task" }
        ),
      []
    )
  )

  const openThreadId = view.kind === "task" ? view.threadId : null
  const replaceSelection = selectionQuery.replace

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

  const selectSettingsPage = useCallback((page: SettingsPageId) => {
    setView((current) =>
      current.kind === "settings" ? { ...current, page } : current
    )
  }, [])

  const leaveSettings = useCallback(() => {
    setFocusSettingsButton(true)
    setView((current) =>
      current.kind === "settings" ? current.returnTo : current
    )
  }, [])

  const selectWorkspace = useCallback(
    (workspaceId: string) => {
      setView(afterScopeChange)
      replaceSelection({
        lastWorkspaceId: workspaceId,
        lastProjectIds: selection?.lastProjectIds ?? {},
      })
      client.setSelection(workspaceId).then(replaceSelection, () => {})
    },
    [client, replaceSelection, selection]
  )

  const selectProject = useCallback(
    (projectId: string) => {
      if (!activeWorkspaceId) return
      setView(afterScopeChange)
      setProjectScope("project")
      const next: Selection = {
        lastWorkspaceId: activeWorkspaceId,
        lastProjectIds: {
          ...selection?.lastProjectIds,
          [activeWorkspaceId]: projectId,
        },
      }
      replaceSelection(next)
      client
        .setSelection(activeWorkspaceId, projectId)
        .then(replaceSelection, () => {})
    },
    [client, replaceSelection, selection, activeWorkspaceId, setProjectScope]
  )

  const selectAllProjects = useCallback(() => {
    setView(toNewTask)
    setProjectScope("all")
  }, [setProjectScope])

  const inSettings = view.kind === "settings"
  const cycleWorkspace = useCallback(
    (direction: number) => {
      // The workspace switcher is off screen under Settings; switching there
      // would write the new selection with nothing on screen to show for it.
      if (inSettings || workspaces.length < 2) return
      const index = workspaces.findIndex(
        (workspace) => workspace.id === activeWorkspaceId
      )
      const next =
        workspaces[(index + direction + workspaces.length) % workspaces.length]!
      selectWorkspace(next.id)
    },
    [inSettings, workspaces, activeWorkspaceId, selectWorkspace]
  )

  useKeybinding(
    appSettings.nextWorkspaceKeybinding,
    useCallback(() => cycleWorkspace(1), [cycleWorkspace])
  )
  useKeybinding(
    appSettings.previousWorkspaceKeybinding,
    useCallback(() => cycleWorkspace(-1), [cycleWorkspace])
  )

  function openThread(threadId: string) {
    setView({ kind: "task", threadId })
  }

  function openSkills() {
    setView({ kind: "skills", filter: firstSkillsFilter })
  }

  function selectSkillsFilter(filter: SkillsFilter) {
    setView((current) =>
      current.kind === "skills" ? { ...current, filter } : current
    )
  }

  /** Shows failures in the inline error strip and rethrows for callers that care. */
  async function reportErrors<T>(action: () => Promise<T>): Promise<T> {
    setActionError(null)
    try {
      return await action()
    } catch (error) {
      setActionError(describedErrorSchema.parse(error))
      throw error
    }
  }

  async function addProject() {
    if (!activeWorkspaceId) return
    setAddingProject(true)
    try {
      await reportErrors(async () => {
        const picked = await pickProjectFolder()
        if (!picked) return
        const project = await client.addProject(
          picked.path,
          picked.name,
          activeWorkspaceId
        )
        selectProject(project.id)
      })
    } catch {
      // Already surfaced through the error strip.
    } finally {
      setAddingProject(false)
    }
  }

  function moveProject(projectId: string, workspaceId: string) {
    reportErrors(() => client.moveProject(projectId, workspaceId)).catch(
      () => {}
    )
  }

  // Mutation responses are ignored on purpose: each one emits thread.changed,
  // and the list queries refetch from there like every other thread update.
  // Memoized so every task row is not handed a fresh identity per render.
  const inboxActions: InboxActions = useMemo(() => {
    const run = <Result,>(action: () => Promise<Result>) => {
      setActionError(null)
      action().catch((error) =>
        setActionError(describedErrorSchema.parse(error))
      )
    }
    return {
      onSetDone: (threadId, done) =>
        run(() => client.setThreadDone(threadId, done)),
      onSnooze: (threadId, until) =>
        run(() => client.snoozeThread(threadId, until)),
      onWake: (threadId) => run(() => client.wakeThread(threadId)),
      onSetPinned: (threadId, pinned) =>
        run(() => client.setThreadPinned(threadId, pinned)),
      onDelete: (threadId) => run(() => client.deleteThread(threadId)),
    }
  }, [client])

  function submitWorkspace(draft: WorkspaceDraft) {
    return reportErrors(async () => {
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
    return reportErrors(async () => {
      if (!activeWorkspace) return
      await client.deleteWorkspace(activeWorkspace.id)
      setView(toNewTask)
      selectionQuery.revalidate()
    })
  }

  // A Pack created, installed, or linked here is meant for the active
  // Workspace, so it attaches right away.
  const packActions = {
    onToggle: (packId: string, attached: boolean) =>
      reportErrors(async () => {
        if (!activeWorkspaceId) return
        await client.setWorkspacePack(activeWorkspaceId, packId, attached)
      }),
    onCreate: (name: string) =>
      reportErrors(async () => {
        if (!activeWorkspaceId) return
        const pack = await client.createPack(name)
        await client.setWorkspacePack(activeWorkspaceId, pack.id, true)
      }),
    onInstallFolder: () =>
      reportErrors(async () => {
        if (!activeWorkspaceId) return
        const picked = await pickPackFolder()
        if (!picked) return
        const pack = await client.installPackFromFolder(picked.path)
        await client.setWorkspacePack(activeWorkspaceId, pack.id, true)
      }),
    onInstallZip: () =>
      reportErrors(async () => {
        if (!activeWorkspaceId) return
        const picked = await pickPackArchive()
        if (!picked) return
        const pack = await client.installPackFromZip(picked.path)
        await client.setWorkspacePack(activeWorkspaceId, pack.id, true)
      }),
    onLink: () =>
      reportErrors(async () => {
        if (!activeWorkspaceId) return
        const picked = await pickPackFolder()
        if (!picked) return
        const pack = await client.linkPack(picked.path)
        await client.setWorkspacePack(activeWorkspaceId, pack.id, true)
      }),
    onUnlink: (packId: string) =>
      reportErrors(async () => {
        await client.unlinkPack(packId)
      }),
    onUninstall: (packId: string) =>
      reportErrors(async () => {
        await client.uninstallPack(packId)
      }),
    onCreateSkill: (draft: ManagedSkillDraft) =>
      reportErrors(async () => {
        if (!activeWorkspaceId) return
        const currentPacks =
          packsQuery.state.status === "ready"
            ? packsQuery.state.data
            : await client.listPacks()
        const mySkills =
          currentPacks.find(
            (pack) => pack.canEditSkills && pack.name === mySkillsPackName
          ) ?? (await client.createPack(mySkillsPackName))
        await client.setWorkspacePack(activeWorkspaceId, mySkills.id, true)
        await client.createManagedSkill(mySkills.id, draft)
      }),
  }

  const listsLoading = [
    workspacesQuery.state.status,
    projectsQuery.state.status,
    selectionQuery.state.status,
  ].some((status) => status === "loading" || status === "idle")
  const listsError =
    workspacesQuery.state.status === "error"
      ? workspacesQuery.state.message
      : projectsQuery.state.status === "error"
        ? projectsQuery.state.message
        : selectionQuery.state.status === "error"
          ? selectionQuery.state.message
          : null

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background text-foreground">
      {view.kind === "settings" ? (
        <SettingsSidebar
          page={view.page}
          onSelectPage={selectSettingsPage}
          onGoBack={leaveSettings}
        />
      ) : (
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
          addingProject={addingProject}
          onSelectWorkspace={selectWorkspace}
          onCreateWorkspace={() => setWorkspaceDialog({ mode: "create" })}
          onEditWorkspace={() => setWorkspaceDialog({ mode: "edit" })}
          threads={threads.state}
          workspaceThreads={workspaceThreads.state}
          openThreadId={openThreadId}
          onOpenThread={openThread}
          onNewTask={() => setView(toNewTask)}
          onRetryThreads={revalidateAllThreads}
          onOpenSkills={openSkills}
          skillsActive={view.kind === "skills"}
          onOpenSettings={openSettings}
          focusSettings={focusSettingsButton}
          inboxActions={inboxActions}
        />
      )}

      <main className="flex min-w-0 flex-1 flex-col">
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

        {view.kind === "settings" ? (
          <SettingsView page={view.page} harnesses={harnesses} />
        ) : listsError ? (
          <Screen>
            <StatusPanel
              title="Deskto cannot reach the runtime"
              description={listsError}
              tone="danger"
            >
              <Button
                variant="outline"
                onClick={() => {
                  revalidateWorkspaces()
                  revalidateProjects()
                  selectionQuery.revalidate()
                }}
              >
                Try again
              </Button>
            </StatusPanel>
          </Screen>
        ) : listsLoading ? (
          <Screen>
            <StatusPanel title="Loading your projects…" />
          </Screen>
        ) : view.kind === "skills" ? (
          <SkillsView
            filter={view.filter}
            project={activeProject}
            workspace={activeWorkspace}
            packs={packsQuery}
            packActions={packActions}
            onCreateSkill={packActions.onCreateSkill}
            onSelectFilter={selectSkillsFilter}
          />
        ) : !activeProject ? (
          <Screen>
            <StatusPanel
              title="Open a project folder"
              description="Deskto works inside one folder at a time. Choose the folder that holds the work you want done."
            >
              <Button onClick={addProject} disabled={addingProject}>
                {addingProject ? "Opening…" : "Choose a folder"}
              </Button>
            </StatusPanel>
          </Screen>
        ) : openThreadId ? (
          <TaskView
            key={openThreadId}
            threadId={openThreadId}
            harnesses={harnesses.state}
            projects={projects}
          />
        ) : (
          <NewTaskView
            key={activeProject.id}
            project={activeProject}
            harnesses={harnesses.state}
            onTaskCreated={revalidateAllThreads}
            onTaskStarted={openThread}
          />
        )}
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

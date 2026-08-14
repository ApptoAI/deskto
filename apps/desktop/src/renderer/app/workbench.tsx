import { useCallback, useMemo, useState, type ReactNode } from "react"
import { appSettings } from "@openappto/settings"

import { personalWorkspaceId } from "@openappto/protocol"
import { Button } from "@workspace/ui/components/button"

import { InlineError } from "../components/inline-error.js"
import { SettingsView } from "../components/settings/settings-view.js"
import { ProjectSidebar } from "../components/sidebar/project-sidebar.js"
import { WorkspaceRail } from "../components/sidebar/workspace-rail.js"
import { StatusPanel } from "../components/status-panel.js"
import { NewTaskView } from "../components/task/new-task-view.js"
import { TaskView } from "../components/task/task-view.js"
import {
  WorkspaceDialog,
  type WorkspaceDraft,
} from "../components/workspace/workspace-dialog.js"
import { pickProjectFolder } from "../lib/desktop.js"
import { describeError } from "../runtime/describe-error.js"
import { useRuntimeClient } from "../runtime/runtime-client-context.js"
import { useHarnessChanged } from "../runtime/use-harness-changed.js"
import { useRuntimeQuery } from "../runtime/use-runtime-query.js"
import { usePackChanged } from "../runtime/use-pack-changed.js"
import { useThreadChanged } from "../runtime/use-thread-changed.js"
import { useWorkspaceChanged } from "../runtime/use-workspace-changed.js"
import { useKeybinding } from "../settings/use-keybinding.js"

// One value per possible main pane, so navigation cannot leave a stale
// combination behind (e.g. a task opening underneath the settings screen).
type MainView =
  | { kind: "new-task" }
  | { kind: "task"; threadId: string }
  | { kind: "settings" }

type WorkspaceDialogState = null | { mode: "create" } | { mode: "edit" }

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

  const loadPacks = useCallback(() => client.listPacks(), [client])
  const packsQuery = useRuntimeQuery(loadPacks)

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

  const [chosenWorkspaceId, setChosenWorkspaceId] = useState<string | null>(
    null
  )
  const [chosenProjectId, setChosenProjectId] = useState<string | null>(null)
  const [view, setView] = useState<MainView>({ kind: "new-task" })
  const [addingProject, setAddingProject] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [workspaceDialog, setWorkspaceDialog] =
    useState<WorkspaceDialogState>(null)

  const workspacesState = workspacesQuery.state
  const workspaces = useMemo(
    () => (workspacesState.status === "ready" ? workspacesState.data : []),
    [workspacesState]
  )
  const selection =
    selectionQuery.state.status === "ready" ? selectionQuery.state.data : null
  const projects =
    projectsQuery.state.status === "ready" ? projectsQuery.state.data : []
  const packs =
    packsQuery.state.status === "ready" ? packsQuery.state.data : []

  // A restart reopens the last used workspace and its last used project;
  // explicit clicks in this session win over what was remembered.
  const activeWorkspace =
    workspaces.find(
      (workspace) =>
        workspace.id === (chosenWorkspaceId ?? selection?.lastWorkspaceId)
    ) ??
    workspaces[0] ??
    null
  const activeWorkspaceId = activeWorkspace?.id ?? null

  const workspaceProjects = projects.filter(
    (project) => project.workspaceId === activeWorkspaceId
  )
  const rememberedProjectId = activeWorkspaceId
    ? (selection?.lastProjectIds[activeWorkspaceId] ?? null)
    : null
  const activeProject =
    workspaceProjects.find(
      (project) => project.id === (chosenProjectId ?? rememberedProjectId)
    ) ??
    workspaceProjects[0] ??
    null
  const activeProjectId = activeProject?.id ?? null

  const loadThreads = useMemo(
    () =>
      activeProjectId ? () => client.listThreads(activeProjectId) : null,
    [client, activeProjectId]
  )
  const threads = useRuntimeQuery(loadThreads)
  const revalidateThreads = threads.revalidate

  useThreadChanged(useCallback(() => revalidateThreads(), [revalidateThreads]))

  useKeybinding(
    appSettings.newTaskKeybinding,
    useCallback(() => setView({ kind: "new-task" }), [])
  )

  const openThreadId = view.kind === "task" ? view.threadId : null
  const replaceSelection = selectionQuery.replace

  const selectWorkspace = useCallback(
    (workspaceId: string) => {
      setChosenWorkspaceId(workspaceId)
      setChosenProjectId(null)
      setView({ kind: "new-task" })
      client.setSelection(workspaceId).then(replaceSelection, () => {})
    },
    [client, replaceSelection]
  )

  const cycleWorkspace = useCallback(
    (direction: number) => {
      if (workspaces.length < 2) return
      const index = workspaces.findIndex(
        (workspace) => workspace.id === activeWorkspaceId
      )
      const next =
        workspaces[
          (index + direction + workspaces.length) % workspaces.length
        ]!
      selectWorkspace(next.id)
    },
    [workspaces, activeWorkspaceId, selectWorkspace]
  )

  useKeybinding(
    appSettings.nextWorkspaceKeybinding,
    useCallback(() => cycleWorkspace(1), [cycleWorkspace])
  )
  useKeybinding(
    appSettings.previousWorkspaceKeybinding,
    useCallback(() => cycleWorkspace(-1), [cycleWorkspace])
  )

  function selectProject(projectId: string) {
    setChosenProjectId(projectId)
    setView({ kind: "new-task" })
    if (activeWorkspaceId)
      client
        .setSelection(activeWorkspaceId, projectId)
        .then(replaceSelection, () => {})
  }

  function openThread(threadId: string) {
    setView({ kind: "task", threadId })
  }

  async function addProject() {
    if (!activeWorkspaceId) return
    setAddingProject(true)
    setActionError(null)
    try {
      const picked = await pickProjectFolder()
      if (!picked) return

      const project = await client.addProject(
        picked.path,
        picked.name,
        activeWorkspaceId
      )
      projectsQuery.revalidate()
      selectProject(project.id)
    } catch (error) {
      setActionError(describeError(error))
    } finally {
      setAddingProject(false)
    }
  }

  async function moveProject(projectId: string, workspaceId: string) {
    setActionError(null)
    try {
      await client.moveProject(projectId, workspaceId)
      setChosenProjectId(null)
      projectsQuery.revalidate()
    } catch (error) {
      setActionError(describeError(error))
    }
  }

  async function submitWorkspace(draft: WorkspaceDraft) {
    setActionError(null)
    try {
      if (workspaceDialog?.mode === "edit" && activeWorkspace) {
        await client.updateWorkspace(activeWorkspace.id, draft)
        revalidateWorkspaces()
      } else {
        const created = await client.createWorkspace(
          draft.name,
          draft.color,
          draft.icon
        )
        revalidateWorkspaces()
        selectWorkspace(created.id)
      }
    } catch (error) {
      setActionError(describeError(error))
      throw error
    }
  }

  const replacePacks = packsQuery.replace

  async function togglePack(packId: string, attached: boolean) {
    if (!activeWorkspaceId) return
    setActionError(null)
    try {
      replacePacks(
        await client.setWorkspacePack(activeWorkspaceId, packId, attached)
      )
    } catch (error) {
      setActionError(describeError(error))
      throw error
    }
  }

  // A pack created or imported while editing a workspace is meant for it, so
  // it attaches right away.
  async function createPack(name: string) {
    if (!activeWorkspaceId) return
    setActionError(null)
    try {
      const pack = await client.createPack(name)
      replacePacks(
        await client.setWorkspacePack(activeWorkspaceId, pack.id, true)
      )
    } catch (error) {
      setActionError(describeError(error))
      throw error
    }
  }

  async function importPack() {
    if (!activeWorkspaceId) return
    setActionError(null)
    try {
      const picked = await pickProjectFolder()
      if (!picked) return
      const pack = await client.importPack(picked.path)
      replacePacks(
        await client.setWorkspacePack(activeWorkspaceId, pack.id, true)
      )
    } catch (error) {
      setActionError(describeError(error))
      throw error
    }
  }

  async function removePack(packId: string) {
    setActionError(null)
    try {
      replacePacks(await client.removePack(packId))
    } catch (error) {
      setActionError(describeError(error))
      throw error
    }
  }

  async function deleteActiveWorkspace() {
    if (!activeWorkspace) return
    setActionError(null)
    try {
      await client.deleteWorkspace(activeWorkspace.id)
      setChosenWorkspaceId(null)
      setChosenProjectId(null)
      setView({ kind: "new-task" })
      revalidateWorkspaces()
      revalidateProjects()
      selectionQuery.revalidate()
    } catch (error) {
      setActionError(describeError(error))
      throw error
    }
  }

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background text-foreground">
      <WorkspaceRail
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        onSelect={selectWorkspace}
        onCreate={() => setWorkspaceDialog({ mode: "create" })}
      />

      <ProjectSidebar
        workspace={activeWorkspace}
        workspaces={workspaces}
        projects={workspaceProjects}
        activeProject={activeProject}
        onSelectProject={selectProject}
        onAddProject={addProject}
        onMoveProject={moveProject}
        addingProject={addingProject}
        onEditWorkspace={() => setWorkspaceDialog({ mode: "edit" })}
        threads={threads.state}
        openThreadId={openThreadId}
        onOpenThread={openThread}
        onNewTask={() => setView({ kind: "new-task" })}
        onRetryThreads={revalidateThreads}
        onOpenSettings={() => setView({ kind: "settings" })}
      />

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
              message={`Appto cannot read the list of agents. ${harnesses.state.message}`}
            />
            <Button variant="outline" size="sm" onClick={harnesses.revalidate}>
              Try again
            </Button>
          </div>
        ) : null}

        {view.kind === "settings" ? (
          <SettingsView harnesses={harnesses} />
        ) : projectsQuery.state.status === "loading" ||
          projectsQuery.state.status === "idle" ? (
          <Screen>
            <StatusPanel title="Loading your projects…" />
          </Screen>
        ) : projectsQuery.state.status === "error" ? (
          <Screen>
            <StatusPanel
              title="Appto cannot reach the runtime"
              description={projectsQuery.state.message}
              tone="danger"
            >
              <Button variant="outline" onClick={projectsQuery.revalidate}>
                Try again
              </Button>
            </StatusPanel>
          </Screen>
        ) : !activeProject ? (
          <Screen>
            <StatusPanel
              title="Open a project folder"
              description="Appto works inside one folder at a time. Choose the folder that holds the work you want done."
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
          />
        ) : (
          <NewTaskView
            key={activeProject.id}
            project={activeProject}
            harnesses={harnesses.state}
            onTaskCreated={revalidateThreads}
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
        packs={packs}
        packActions={{
          onToggle: togglePack,
          onCreate: createPack,
          onImport: importPack,
          onRemove: removePack,
        }}
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

import { useCallback, useMemo, useState, type ReactNode } from "react"

import { Button } from "@workspace/ui/components/button"

import { InlineError } from "../components/inline-error.js"
import { SettingsView } from "../components/settings/settings-view.js"
import { ProjectSidebar } from "../components/sidebar/project-sidebar.js"
import { StatusPanel } from "../components/status-panel.js"
import { NewTaskView } from "../components/task/new-task-view.js"
import { TaskView } from "../components/task/task-view.js"
import { pickWorkspaceFolder } from "../lib/desktop.js"
import { describeError } from "../runtime/describe-error.js"
import { useRuntimeClient } from "../runtime/runtime-client-context.js"
import { useHarnessChanged } from "../runtime/use-harness-changed.js"
import { useRuntimeQuery } from "../runtime/use-runtime-query.js"
import { useThreadChanged } from "../runtime/use-thread-changed.js"

// One value per possible main pane, so navigation cannot leave a stale
// combination behind (e.g. a task opening underneath the settings screen).
type MainView =
  | { kind: "new-task" }
  | { kind: "task"; threadId: string }
  | { kind: "settings" }

export function Workbench() {
  const client = useRuntimeClient()

  const loadHarnesses = useCallback(() => client.listHarnesses(), [client])
  const harnesses = useRuntimeQuery(loadHarnesses)
  const revalidateHarnesses = harnesses.revalidate

  useHarnessChanged(
    useCallback(() => revalidateHarnesses(), [revalidateHarnesses])
  )

  const loadWorkspaces = useCallback(() => client.listWorkspaces(), [client])
  const workspaces = useRuntimeQuery(loadWorkspaces)

  const [chosenWorkspaceId, setChosenWorkspaceId] = useState<string | null>(
    null
  )
  const [view, setView] = useState<MainView>({ kind: "new-task" })
  const [addingProject, setAddingProject] = useState(false)
  const [projectError, setProjectError] = useState<string | null>(null)

  const projects =
    workspaces.state.status === "ready" ? workspaces.state.data : []
  const activeWorkspace =
    projects.find((workspace) => workspace.id === chosenWorkspaceId) ??
    projects[0] ??
    null
  const activeWorkspaceId = activeWorkspace?.id ?? null

  const loadThreads = useMemo(
    () =>
      activeWorkspaceId ? () => client.listThreads(activeWorkspaceId) : null,
    [client, activeWorkspaceId]
  )
  const threads = useRuntimeQuery(loadThreads)
  const revalidateThreads = threads.revalidate

  useThreadChanged(useCallback(() => revalidateThreads(), [revalidateThreads]))

  const openThreadId = view.kind === "task" ? view.threadId : null

  function selectWorkspace(workspaceId: string) {
    setChosenWorkspaceId(workspaceId)
    setView({ kind: "new-task" })
  }

  function openThread(threadId: string) {
    setView({ kind: "task", threadId })
  }

  async function addProject() {
    setAddingProject(true)
    setProjectError(null)
    try {
      const picked = await pickWorkspaceFolder()
      if (!picked) return

      const workspace = await client.addWorkspace(picked.path, picked.name)
      workspaces.revalidate()
      selectWorkspace(workspace.id)
    } catch (error) {
      setProjectError(describeError(error))
    } finally {
      setAddingProject(false)
    }
  }

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background text-foreground">
      <ProjectSidebar
        workspaces={projects}
        activeWorkspace={activeWorkspace}
        onSelectWorkspace={selectWorkspace}
        onAddProject={addProject}
        addingProject={addingProject}
        threads={threads.state}
        openThreadId={openThreadId}
        onOpenThread={openThread}
        onNewTask={() => setView({ kind: "new-task" })}
        onRetryThreads={revalidateThreads}
        onOpenSettings={() => setView({ kind: "settings" })}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        {projectError ? (
          <div className="px-6 pt-3">
            <InlineError message={projectError} />
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
        ) : workspaces.state.status === "loading" ||
          workspaces.state.status === "idle" ? (
          <Screen>
            <StatusPanel title="Loading your projects…" />
          </Screen>
        ) : workspaces.state.status === "error" ? (
          <Screen>
            <StatusPanel
              title="Appto cannot reach the runtime"
              description={workspaces.state.message}
              tone="danger"
            >
              <Button variant="outline" onClick={workspaces.revalidate}>
                Try again
              </Button>
            </StatusPanel>
          </Screen>
        ) : !activeWorkspace ? (
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
            key={activeWorkspace.id}
            workspace={activeWorkspace}
            harnesses={harnesses.state}
            onTaskCreated={revalidateThreads}
            onTaskStarted={openThread}
          />
        )}
      </main>
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

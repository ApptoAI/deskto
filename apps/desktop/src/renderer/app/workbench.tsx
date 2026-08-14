import { useCallback, useMemo, useState, type ReactNode } from "react"
import { appSettings } from "@openappto/settings"

import { Button } from "@workspace/ui/components/button"

import { InlineError } from "../components/inline-error.js"
import { SettingsView } from "../components/settings/settings-view.js"
import { ProjectSidebar } from "../components/sidebar/project-sidebar.js"
import { StatusPanel } from "../components/status-panel.js"
import { NewTaskView } from "../components/task/new-task-view.js"
import { TaskView } from "../components/task/task-view.js"
import { pickProjectFolder } from "../lib/desktop.js"
import { describeError } from "../runtime/describe-error.js"
import { useRuntimeClient } from "../runtime/runtime-client-context.js"
import { useHarnessChanged } from "../runtime/use-harness-changed.js"
import { useRuntimeQuery } from "../runtime/use-runtime-query.js"
import { useThreadChanged } from "../runtime/use-thread-changed.js"
import { useKeybinding } from "../settings/use-keybinding.js"

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

  const loadProjects = useCallback(() => client.listProjects(), [client])
  const projectsQuery = useRuntimeQuery(loadProjects)

  const [chosenProjectId, setChosenProjectId] = useState<string | null>(
    null
  )
  const [view, setView] = useState<MainView>({ kind: "new-task" })
  const [addingProject, setAddingProject] = useState(false)
  const [projectError, setProjectError] = useState<string | null>(null)

  const projects =
    projectsQuery.state.status === "ready" ? projectsQuery.state.data : []
  const activeProject =
    projects.find((project) => project.id === chosenProjectId) ??
    projects[0] ??
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

  function selectProject(projectId: string) {
    setChosenProjectId(projectId)
    setView({ kind: "new-task" })
  }

  function openThread(threadId: string) {
    setView({ kind: "task", threadId })
  }

  async function addProject() {
    setAddingProject(true)
    setProjectError(null)
    try {
      const picked = await pickProjectFolder()
      if (!picked) return

      const project = await client.addProject(picked.path, picked.name)
      projectsQuery.revalidate()
      selectProject(project.id)
    } catch (error) {
      setProjectError(describeError(error))
    } finally {
      setAddingProject(false)
    }
  }

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background text-foreground">
      <ProjectSidebar
        projects={projects}
        activeProject={activeProject}
        onSelectProject={selectProject}
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

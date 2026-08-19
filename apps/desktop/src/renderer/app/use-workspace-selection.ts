import { useCallback, useMemo, useRef } from "react"
import type { RuntimeClient } from "@deskto/client"
import type { Selection } from "@deskto/protocol"
import { z } from "zod"

import { useLocalStorage } from "../lib/use-local-storage.js"
import { useRuntimeQuery } from "../runtime/use-runtime-query.js"
import { useWorkspaceChanged } from "../runtime/use-workspace-changed.js"
import { afterScopeChange, type MainView } from "./work-view.js"

type ProjectScope = "all" | "project"

const projectScopeMapSchema = z.record(z.string(), z.enum(["all", "project"]))
type RunAction = <T>(action: () => Promise<T>) => void

/**
 * Loads workspaces, projects, and the persisted Selection, and derives which
 * workspace and project are active. Selecting writes the Selection
 * optimistically and steers the main view through `setView`, so every scope
 * change lands the screen and the stored Selection together.
 */
export function useWorkspaceSelection(
  client: RuntimeClient,
  setView: (update: (current: MainView) => MainView) => void,
  runAction: RunAction
) {
  const loadWorkspaces = useCallback(() => client.listWorkspaces(), [client])
  const workspacesQuery = useRuntimeQuery(loadWorkspaces)
  const loadSelection = useCallback(() => client.getSelection(), [client])
  const selectionQuery = useRuntimeQuery(loadSelection)
  const loadProjects = useCallback(() => client.listProjects(), [client])
  const projectsQuery = useRuntimeQuery(loadProjects)

  // Mutation responses stay slim; these events are the one refetch trigger.
  const revalidateWorkspaces = workspacesQuery.revalidate
  const revalidateProjects = projectsQuery.revalidate
  useWorkspaceChanged(
    useCallback(() => {
      revalidateWorkspaces()
      revalidateProjects()
    }, [revalidateWorkspaces, revalidateProjects])
  )

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

  // Whether the sidebar shows one project's tasks or every project's, divided
  // into sections. Pure UI state, persisted per workspace in localStorage the
  // same way the composer remembers the last model.
  const [projectScopeMap, setProjectScopeMap] = useLocalStorage<
    Record<string, ProjectScope>
  >("deskto.sidebar.project-scope.v1", {}, projectScopeMapSchema)
  const allProjects = activeWorkspaceId
    ? (projectScopeMap[activeWorkspaceId] ?? "project") === "all"
    : false

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

  const replaceSelection = selectionQuery.replace
  const revalidateSelection = selectionQuery.revalidate
  const selectionRequest = useRef(0)

  const persistSelection = useCallback(
    (write: () => Promise<Selection>) => {
      const request = ++selectionRequest.current
      runAction(async () => {
        try {
          const persisted = await write()
          if (request === selectionRequest.current) {
            replaceSelection(persisted)
          }
        } catch (error) {
          if (request !== selectionRequest.current) return
          revalidateSelection()
          throw error
        }
      })
    },
    [replaceSelection, revalidateSelection, runAction]
  )

  const selectWorkspace = useCallback(
    (workspaceId: string) => {
      setView(afterScopeChange)
      replaceSelection({
        lastWorkspaceId: workspaceId,
        lastProjectIds: selection?.lastProjectIds ?? {},
      })
      persistSelection(() => client.setSelection(workspaceId))
    },
    [client, persistSelection, replaceSelection, selection, setView]
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
      persistSelection(() => client.setSelection(activeWorkspaceId, projectId))
    },
    [
      client,
      persistSelection,
      replaceSelection,
      selection,
      activeWorkspaceId,
      setProjectScope,
      setView,
    ]
  )

  const selectAllProjects = useCallback(() => {
    // Re-entering All projects deliberately drops any per-task project choice
    // so the picker asks again.
    setView(() => ({ kind: "new-task" }))
    setProjectScope("all")
  }, [setProjectScope, setView])

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

  const retryLists = useCallback(() => {
    revalidateWorkspaces()
    revalidateProjects()
    revalidateSelection()
  }, [revalidateWorkspaces, revalidateProjects, revalidateSelection])

  return {
    workspaces,
    projects,
    workspaceProjects,
    activeWorkspace,
    activeWorkspaceId,
    activeProject,
    activeProjectId: activeProject?.id ?? null,
    allProjects,
    selectWorkspace,
    selectProject,
    selectAllProjects,
    listsLoading,
    listsError,
    retryLists,
    revalidateSelection,
  }
}

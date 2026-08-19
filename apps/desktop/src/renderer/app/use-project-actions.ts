import { useCallback, useMemo, useState } from "react"
import type { RuntimeClient } from "@deskto/client"

import type { ProjectDraft } from "../components/project/project-dialog.js"
import { pickProjectFolder } from "../lib/desktop.js"
import { usePackChanged } from "../runtime/use-pack-changed.js"
import { useRuntimeQuery } from "../runtime/use-runtime-query.js"

type TryAction = <T>(action: () => Promise<T>) => Promise<T>
type RunAction = <T>(action: () => Promise<T>) => void

/**
 * Owns the create-project dialog and the mutations launched from the project
 * switcher and the Projects grid. Per-project settings live in the project
 * panel, which talks to the Runtime directly.
 */
export function useProjectActions(
  client: RuntimeClient,
  {
    activeWorkspaceId,
    selectProject,
    clearActionError,
    tryAction,
    runAction,
  }: {
    activeWorkspaceId: string | null
    selectProject: (projectId: string) => void
    clearActionError: () => void
    tryAction: TryAction
    runAction: RunAction
  }
) {
  const [projectDialogOpen, setProjectDialogOpen] = useState(false)

  const loadTemplates = useMemo(
    () =>
      projectDialogOpen && activeWorkspaceId
        ? () => client.listTemplatesForWorkspace(activeWorkspaceId)
        : null,
    [client, projectDialogOpen, activeWorkspaceId]
  )
  const templatesQuery = useRuntimeQuery(loadTemplates)

  const revalidateTemplates = templatesQuery.revalidate
  usePackChanged(
    useCallback(() => revalidateTemplates(), [revalidateTemplates])
  )

  const addProject = useCallback(() => {
    if (!activeWorkspaceId) return
    clearActionError()
    setProjectDialogOpen(true)
  }, [activeWorkspaceId, clearActionError])

  const chooseProjectFolder = useCallback(async (): Promise<
    Awaited<ReturnType<typeof pickProjectFolder>>
  > => {
    try {
      return await tryAction<Awaited<ReturnType<typeof pickProjectFolder>>>(
        pickProjectFolder
      )
    } catch {
      // tryAction already exposed the desktop bridge failure.
      return undefined
    }
  }, [tryAction])

  const createProject = useCallback(
    (draft: ProjectDraft) =>
      tryAction(async () => {
        if (!activeWorkspaceId) return
        const details = await client.createProject({
          workspaceId: activeWorkspaceId,
          ...draft,
        })
        selectProject(details.project.id)
      }),
    [client, activeWorkspaceId, selectProject, tryAction]
  )

  const moveProject = useCallback(
    (projectId: string, workspaceId: string) => {
      runAction(() => client.moveProject(projectId, workspaceId))
    },
    [client, runAction]
  )

  const setProjectPinned = useCallback(
    (projectId: string, pinned: boolean) => {
      runAction(() => client.setProjectPinned(projectId, pinned))
    },
    [client, runAction]
  )

  return {
    hasOpenDialog: projectDialogOpen,
    addProject,
    moveProject,
    setProjectPinned,
    projectDialog: {
      open: projectDialogOpen,
      setOpen: (open: boolean) => {
        setProjectDialogOpen(open)
        if (!open) clearActionError()
      },
      templates:
        templatesQuery.state.status === "ready"
          ? templatesQuery.state.data
          : [],
      loading:
        templatesQuery.state.status === "idle" ||
        templatesQuery.state.status === "loading",
      error:
        templatesQuery.state.status === "error"
          ? templatesQuery.state.message
          : null,
      retry: templatesQuery.revalidate,
      chooseFolder: chooseProjectFolder,
      createProject,
    },
  }
}

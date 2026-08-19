import { useCallback, useMemo, useState } from "react"
import type { RuntimeClient } from "@deskto/client"
import type { Project } from "@deskto/protocol"

import type { ProjectDraft } from "../components/project/project-dialog.js"
import type { ProjectSettingsDraft } from "../components/project/project-settings-dialog.js"
import type { SaveTemplateDraft } from "../components/project/save-template-dialog.js"
import { openFolder, pickProjectFolder } from "../lib/desktop.js"
import { usePackChanged } from "../runtime/use-pack-changed.js"
import { useRuntimeQuery } from "../runtime/use-runtime-query.js"

type TryAction = <T>(action: () => Promise<T>) => Promise<T>
type RunAction = <T>(action: () => Promise<T>) => void

/**
 * Owns project and template dialogs, their gated queries, and every mutation
 * launched from the project switcher or those dialogs.
 */
export function useProjectActions(
  client: RuntimeClient,
  {
    activeWorkspaceId,
    activeProject,
    projects,
    selectProject,
    clearActionError,
    tryAction,
    runAction,
  }: {
    activeWorkspaceId: string | null
    activeProject: Project | null
    projects: Project[]
    selectProject: (projectId: string) => void
    clearActionError: () => void
    tryAction: TryAction
    runAction: RunAction
  }
) {
  const [projectDialogOpen, setProjectDialogOpen] = useState(false)
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null)
  const [templateSourceProjectId, setTemplateSourceProjectId] = useState<
    string | null
  >(null)

  const loadTemplates = useMemo(
    () =>
      projectDialogOpen && activeWorkspaceId
        ? () => client.listTemplatesForWorkspace(activeWorkspaceId)
        : null,
    [client, projectDialogOpen, activeWorkspaceId]
  )
  const templatesQuery = useRuntimeQuery(loadTemplates)

  const loadProjectDetails = useMemo(
    () => (editingProjectId ? () => client.getProject(editingProjectId) : null),
    [client, editingProjectId]
  )
  const projectDetailsQuery = useRuntimeQuery(loadProjectDetails)
  const revalidateProjectDetails = projectDetailsQuery.revalidate

  const loadTemplateFiles = useMemo(
    () =>
      templateSourceProjectId
        ? () => client.listProjectTemplateFiles(templateSourceProjectId)
        : null,
    [client, templateSourceProjectId]
  )
  const templateFilesQuery = useRuntimeQuery(loadTemplateFiles)

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

  const openProjectSettings = useCallback(() => {
    if (!activeProject) return
    clearActionError()
    setEditingProjectId(activeProject.id)
  }, [activeProject, clearActionError])

  const updateProject = useCallback(
    (draft: ProjectSettingsDraft) =>
      tryAction(async () => {
        if (!editingProjectId) return
        await client.updateProject({ projectId: editingProjectId, ...draft })
      }),
    [client, editingProjectId, tryAction]
  )

  const relocateProject = useCallback(
    () =>
      tryAction(async () => {
        if (!editingProjectId) return
        const picked = await pickProjectFolder()
        if (!picked) return
        await client.relocateProject(editingProjectId, picked.path)
        revalidateProjectDetails()
      }),
    [client, editingProjectId, revalidateProjectDetails, tryAction]
  )

  const openTemplateSave = useCallback(() => {
    if (!editingProjectId) return
    clearActionError()
    setTemplateSourceProjectId(editingProjectId)
    setEditingProjectId(null)
  }, [editingProjectId, clearActionError])

  const saveTemplate = useCallback(
    (draft: SaveTemplateDraft) =>
      tryAction(async () => {
        if (!templateSourceProjectId) return
        await client.saveTemplateFromProject({
          projectId: templateSourceProjectId,
          ...draft,
        })
      }),
    [client, templateSourceProjectId, tryAction]
  )

  return {
    hasOpenDialog:
      projectDialogOpen ||
      editingProjectId !== null ||
      templateSourceProjectId !== null,
    addProject,
    moveProject,
    setProjectPinned,
    openProjectSettings,
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
    settingsDialog: {
      open: editingProjectId !== null,
      setOpen: (open: boolean) => {
        if (!open) {
          setEditingProjectId(null)
          clearActionError()
        }
      },
      details:
        projectDetailsQuery.state.status === "ready"
          ? projectDetailsQuery.state.data
          : null,
      loading:
        projectDetailsQuery.state.status === "idle" ||
        projectDetailsQuery.state.status === "loading",
      error:
        projectDetailsQuery.state.status === "error"
          ? projectDetailsQuery.state.message
          : null,
      retry: projectDetailsQuery.revalidate,
      updateProject,
      relocateProject,
      openFolder: () => {
        const details = projectDetailsQuery.state
        if (details.status === "ready") {
          runAction(() => openFolder(details.data.project.path))
        }
      },
      openTemplateSave,
    },
    templateDialog: {
      open: templateSourceProjectId !== null,
      setOpen: (open: boolean) => {
        if (!open) {
          setTemplateSourceProjectId(null)
          clearActionError()
        }
      },
      project:
        projects.find((project) => project.id === templateSourceProjectId) ??
        null,
      files:
        templateFilesQuery.state.status === "ready"
          ? templateFilesQuery.state.data
          : [],
      loading:
        templateFilesQuery.state.status === "idle" ||
        templateFilesQuery.state.status === "loading",
      error:
        templateFilesQuery.state.status === "error"
          ? templateFilesQuery.state.message
          : null,
      retry: templateFilesQuery.revalidate,
      saveTemplate,
    },
  }
}

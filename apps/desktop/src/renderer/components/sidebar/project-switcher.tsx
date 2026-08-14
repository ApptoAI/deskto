import ChevronDownIcon from "lucide-react/dist/esm/icons/chevron-down"
import FolderIcon from "lucide-react/dist/esm/icons/folder"
import FolderInputIcon from "lucide-react/dist/esm/icons/folder-input"
import FolderPlusIcon from "lucide-react/dist/esm/icons/folder-plus"
import LayersIcon from "lucide-react/dist/esm/icons/layers"
import type { Project, Workspace } from "@openappto/protocol"

import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"

const ALL_PROJECTS = "__all-projects__"

/**
 * Scope picker for the task list: one project, or every project in the
 * workspace at once.
 */
export function ProjectSwitcher({
  workspaces,
  projects,
  activeProject,
  allProjects,
  onSelectProject,
  onSelectAllProjects,
  onAddProject,
  onMoveProject,
  adding,
}: {
  workspaces: Workspace[]
  projects: Project[]
  activeProject: Project | null
  allProjects: boolean
  onSelectProject: (projectId: string) => void
  onSelectAllProjects: () => void
  onAddProject: () => void
  onMoveProject: (projectId: string, workspaceId: string) => void
  adding: boolean
}) {
  const otherWorkspaces = workspaces.filter(
    (workspace) => workspace.id !== activeProject?.workspaceId
  )
  const ScopeIcon = allProjects ? LayersIcon : FolderIcon
  const label = allProjects
    ? "All projects"
    : (activeProject?.name ?? "No project")

  return (
    <div className="flex items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" className="min-w-0 flex-1 justify-start" />
          }
        >
          <ScopeIcon
            data-icon="inline-start"
            className="text-muted-foreground"
          />
          <span className="min-w-0 flex-1 truncate text-left">{label}</span>
          <ChevronDownIcon
            data-icon="inline-end"
            className="text-muted-foreground"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-72" align="start">
          <DropdownMenuRadioGroup
            value={allProjects ? ALL_PROJECTS : (activeProject?.id ?? "")}
            onValueChange={(value) =>
              value === ALL_PROJECTS
                ? onSelectAllProjects()
                : onSelectProject(String(value))
            }
          >
            <DropdownMenuRadioItem
              value={ALL_PROJECTS}
              closeOnClick
              disabled={projects.length === 0}
            >
              <span className="flex items-center gap-2">
                <LayersIcon className="size-4 text-muted-foreground" />
                All projects
              </span>
            </DropdownMenuRadioItem>
            {projects.length > 0 ? <DropdownMenuSeparator /> : null}
            {projects.map((project) => (
              <DropdownMenuRadioItem
                key={project.id}
                value={project.id}
                closeOnClick
              >
                <span className="flex min-w-0 flex-col gap-0.5 py-0.5">
                  <span className="truncate">{project.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {project.path}
                  </span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          {!allProjects && activeProject && otherWorkspaces.length > 0 ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <FolderInputIcon />
                  Move project to…
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {otherWorkspaces.map((workspace) => (
                    <DropdownMenuItem
                      key={workspace.id}
                      onClick={() =>
                        onMoveProject(activeProject.id, workspace.id)
                      }
                    >
                      {workspace.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground"
        aria-label="Add a project folder"
        onClick={onAddProject}
        disabled={adding}
      >
        <FolderPlusIcon />
      </Button>
    </div>
  )
}

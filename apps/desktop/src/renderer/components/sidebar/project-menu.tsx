import ChevronsUpDownIcon from "lucide-react/dist/esm/icons/chevrons-up-down"
import FolderInputIcon from "lucide-react/dist/esm/icons/folder-input"
import FolderPlusIcon from "lucide-react/dist/esm/icons/folder-plus"
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

export function ProjectMenu({
  workspaces,
  projects,
  activeProject,
  onSelect,
  onAddProject,
  onMoveProject,
  adding,
}: {
  workspaces: Workspace[]
  projects: Project[]
  activeProject: Project | null
  onSelect: (projectId: string) => void
  onAddProject: () => void
  onMoveProject: (projectId: string, workspaceId: string) => void
  adding: boolean
}) {
  const otherWorkspaces = workspaces.filter(
    (workspace) => workspace.id !== activeProject?.workspaceId
  )

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="lg" className="w-full justify-start" />
        }
      >
        <span className="min-w-0 flex-1 truncate text-left">
          {activeProject?.name ?? "No project"}
        </span>
        <ChevronsUpDownIcon
          data-icon="inline-end"
          className="text-muted-foreground"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-72">
        {projects.length > 0 ? (
          <>
            <DropdownMenuRadioGroup
              value={activeProject?.id ?? ""}
              onValueChange={(value) => onSelect(String(value))}
            >
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
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuItem onClick={onAddProject} disabled={adding}>
          <FolderPlusIcon />
          {adding ? "Opening…" : "Add a project folder"}
        </DropdownMenuItem>
        {activeProject && otherWorkspaces.length > 0 ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <FolderInputIcon />
              Move project to…
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {otherWorkspaces.map((workspace) => (
                <DropdownMenuItem
                  key={workspace.id}
                  onClick={() => onMoveProject(activeProject.id, workspace.id)}
                >
                  {workspace.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

import ChevronsUpDownIcon from "lucide-react/dist/esm/icons/chevrons-up-down"
import FolderPlusIcon from "lucide-react/dist/esm/icons/folder-plus"
import type { Project } from "@openappto/protocol"

import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"

export function ProjectMenu({
  projects,
  activeProject,
  onSelect,
  onAddProject,
  adding,
}: {
  projects: Project[]
  activeProject: Project | null
  onSelect: (projectId: string) => void
  onAddProject: () => void
  adding: boolean
}) {
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
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

import ChevronsUpDownIcon from "lucide-react/dist/esm/icons/chevrons-up-down"
import FolderPlusIcon from "lucide-react/dist/esm/icons/folder-plus"
import type { Workspace } from "@openappto/protocol"

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
  workspaces,
  activeWorkspace,
  onSelect,
  onAddProject,
  adding,
}: {
  workspaces: Workspace[]
  activeWorkspace: Workspace | null
  onSelect: (workspaceId: string) => void
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
          {activeWorkspace?.name ?? "No project"}
        </span>
        <ChevronsUpDownIcon
          data-icon="inline-end"
          className="text-muted-foreground"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-72">
        {workspaces.length > 0 ? (
          <>
            <DropdownMenuRadioGroup
              value={activeWorkspace?.id ?? ""}
              onValueChange={(value) => onSelect(String(value))}
            >
              {workspaces.map((workspace) => (
                <DropdownMenuRadioItem
                  key={workspace.id}
                  value={workspace.id}
                  closeOnClick
                >
                  <span className="flex min-w-0 flex-col gap-0.5 py-0.5">
                    <span className="truncate">{workspace.name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {workspace.path}
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

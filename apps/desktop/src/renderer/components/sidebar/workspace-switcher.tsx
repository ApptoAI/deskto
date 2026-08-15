import type { ReactNode } from "react"
import ChevronsUpDownIcon from "lucide-react/dist/esm/icons/chevrons-up-down"
import PencilIcon from "lucide-react/dist/esm/icons/pencil"
import PlusIcon from "lucide-react/dist/esm/icons/plus"
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
import { cn } from "@workspace/ui/lib/utils"

import { WorkspaceIcon, workspaceSwatch } from "../workspace/workspace-theme.js"

/** The colored workspace tile, at header size or menu size. */
function WorkspaceTile({
  workspace,
  small,
}: {
  workspace: Workspace
  small?: boolean
}) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-md text-white",
        small ? "size-5" : "size-6",
        workspaceSwatch(workspace.color)
      )}
    >
      <WorkspaceIcon
        icon={workspace.icon}
        className={small ? "size-3" : "size-3.5"}
      />
    </span>
  )
}

/** Icon rows sit in a tile-sized box so their labels line up with the workspaces above. */
function MenuIcon({ children }: { children: ReactNode }) {
  return (
    <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
      {children}
    </span>
  )
}

/** Roomier than the default menu row: this menu is short, so it can breathe.
    Right padding is left alone — the radio rows reserve it for the checkmark. */
const menuRowClass = "gap-2.5 py-2 pl-2"

/**
 * The sidebar's title doubles as the workspace picker: the workspace list, its
 * settings and "new workspace" all live in one menu, so the sidebar carries the
 * whole hierarchy on its own.
 */
export function WorkspaceSwitcher({
  workspace,
  workspaces,
  onSelect,
  onCreate,
  onEdit,
}: {
  workspace: Workspace | null
  workspaces: Workspace[]
  onSelect: (workspaceId: string) => void
  onCreate: () => void
  onEdit: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="lg"
            className="w-full justify-start gap-2"
            aria-label={`Switch workspace, current: ${workspace?.name ?? "none"}`}
          />
        }
      >
        {workspace ? <WorkspaceTile workspace={workspace} /> : null}
        <span className="min-w-0 flex-1 truncate text-left text-[15px] font-semibold tracking-tight">
          {workspace?.name ?? "Workspace"}
        </span>
        <ChevronsUpDownIcon
          data-icon="inline-end"
          className="text-muted-foreground"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="p-1.5" align="start">
        <DropdownMenuRadioGroup
          value={workspace?.id ?? ""}
          onValueChange={(value) => onSelect(String(value))}
        >
          {workspaces.map((item) => (
            <DropdownMenuRadioItem
              key={item.id}
              value={item.id}
              className={menuRowClass}
              closeOnClick
            >
              <WorkspaceTile workspace={item} small />
              <span className="min-w-0 flex-1 truncate">{item.name}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator className="-mx-1.5 my-1.5" />
        <DropdownMenuItem
          className={menuRowClass}
          onClick={onEdit}
          disabled={!workspace}
        >
          <MenuIcon>
            <PencilIcon className="size-4" />
          </MenuIcon>
          Workspace settings
        </DropdownMenuItem>
        <DropdownMenuItem className={menuRowClass} onClick={onCreate}>
          <MenuIcon>
            <PlusIcon className="size-4" />
          </MenuIcon>
          New workspace
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

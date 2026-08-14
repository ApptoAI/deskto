import PlusIcon from "lucide-react/dist/esm/icons/plus"
import type { Workspace } from "@openappto/protocol"

import { cn } from "@workspace/ui/lib/utils"

import { WorkspaceIcon, workspaceSwatch } from "../workspace/workspace-theme.js"

/** Slack-style strip of workspace icons; the sidebar next to it shows one workspace at a time. */
export function WorkspaceRail({
  workspaces,
  activeWorkspaceId,
  onSelect,
  onCreate,
}: {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  onSelect: (workspaceId: string) => void
  onCreate: () => void
}) {
  return (
    <aside className="flex w-14 shrink-0 flex-col bg-sidebar">
      <div className="drag-region h-13 shrink-0" />
      <nav
        aria-label="Workspaces"
        className="no-drag flex min-h-0 flex-1 flex-col items-center gap-2.5 overflow-y-auto pt-1 pb-3"
      >
        {workspaces.map((workspace) => {
          const active = workspace.id === activeWorkspaceId
          return (
            <button
              key={workspace.id}
              type="button"
              title={workspace.name}
              aria-label={workspace.name}
              aria-current={active ? "true" : undefined}
              onClick={() => onSelect(workspace.id)}
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-xl text-white transition-[opacity,transform,box-shadow] duration-150 ease-out active:scale-95",
                workspaceSwatch(workspace.color),
                active
                  ? "shadow-[0_0_0_1.5px_var(--color-sidebar),0_0_0_3px_color-mix(in_oklch,var(--color-foreground)_35%,transparent)]"
                  : "opacity-55 hover:opacity-100"
              )}
            >
              <WorkspaceIcon icon={workspace.icon} className="size-4" />
            </button>
          )
        })}
        <button
          type="button"
          title="New workspace"
          aria-label="New workspace"
          onClick={onCreate}
          className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-dashed border-border text-muted-foreground transition-[background-color,color,transform] duration-150 ease-out hover:bg-muted hover:text-foreground active:scale-95"
        >
          <PlusIcon className="size-4" />
        </button>
      </nav>
    </aside>
  )
}

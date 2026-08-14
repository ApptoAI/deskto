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
    <aside className="flex w-13 shrink-0 flex-col border-r border-border">
      <div className="drag-region h-10 shrink-0" />
      <nav
        aria-label="Workspaces"
        className="no-drag flex min-h-0 flex-1 flex-col items-center gap-1.5 overflow-y-auto pb-2"
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
                "flex size-9 shrink-0 items-center justify-center rounded-lg text-white transition-opacity",
                workspaceSwatch(workspace.color),
                active
                  ? "ring-2 ring-ring ring-offset-2 ring-offset-background"
                  : "opacity-60 hover:opacity-100"
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
          className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <PlusIcon className="size-4" />
        </button>
      </nav>
    </aside>
  )
}

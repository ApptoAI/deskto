import PlusIcon from "lucide-react/dist/esm/icons/plus"
import type { Workspace } from "@deskto/protocol"

import { cn } from "@workspace/ui/lib/utils"

import { WorkspaceIcon, workspaceSwatch } from "../workspace/workspace-theme.js"

/** Persistent workspace switcher used by the Slack-like layout. */
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
    <aside className="flex w-18 shrink-0 flex-col border-r border-border bg-sidebar">
      <div className="drag-region h-13 shrink-0" />
      <nav
        aria-label="Workspaces"
        className="no-drag flex min-h-0 flex-1 flex-col items-center gap-2 overflow-y-auto px-2 pb-3"
      >
        {workspaces.map((workspace) => {
          const selected = workspace.id === activeWorkspaceId
          return (
            <button
              key={workspace.id}
              type="button"
              title={workspace.name}
              aria-label={workspace.name}
              aria-current={selected ? "page" : undefined}
              onClick={() => onSelect(workspace.id)}
              className={cn(
                "group/rail relative flex size-10 shrink-0 items-center justify-center rounded-xl transition-[background-color,box-shadow,transform] duration-150 outline-none",
                "focus-visible:ring-2 focus-visible:ring-ring active:scale-95",
                selected ? "bg-background shadow-sm" : "hover:bg-muted"
              )}
            >
              {selected ? (
                <span className="absolute -left-2 h-5 w-0.5 rounded-r-full bg-foreground" />
              ) : null}
              <span
                className={cn(
                  "flex size-8 items-center justify-center rounded-lg text-white transition-[border-radius,transform] duration-150",
                  workspaceSwatch(workspace.color),
                  selected
                    ? "rounded-[0.65rem]"
                    : "group-hover/rail:scale-105 group-hover/rail:rounded-[0.65rem]"
                )}
              >
                <WorkspaceIcon icon={workspace.icon} className="size-4" />
              </span>
            </button>
          )
        })}

        <button
          type="button"
          title="New workspace"
          aria-label="New workspace"
          onClick={onCreate}
          className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-dashed border-border text-muted-foreground transition-[background-color,border-color,color,transform] duration-150 outline-none hover:border-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:scale-95"
        >
          <PlusIcon className="size-4" />
        </button>
      </nav>
    </aside>
  )
}

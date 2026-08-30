import type { ReactNode } from "react"

import { cn } from "@workspace/ui/lib/utils"


const sidebarWidthClass = {
  default: "w-72 xl:w-80",
  compact: "w-64",
  "rail-stack": "w-82",
} as const

/**
 * The chrome both sidebars share: width, the window drag strip, and the lockup.
 * Settings replaces the workspace chrome, so rail-stack reserves the combined
 * width of the rail and compact project sidebar.
 */
export function SidebarFrame({
  children,
  width = "default",
}: {
  children: ReactNode
  width?: keyof typeof sidebarWidthClass
}) {
  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col border-r border-border",
        sidebarWidthClass[width]
      )}
    >
      {children}
    </aside>
  )
}

/**
 * Selected row in either sidebar: tasks in one, settings pages in the other.
 *
 * One rule in both themes now. The fill is a tint of whatever the canvas is
 * not, so it lifts the row on dark glass and settles it on light without
 * either palette needing its own case, and the bevel on top is what keeps it
 * reading as a raised surface rather than as a patch of different colour.
 */
export const sidebarRowSelected = "bevel bg-fill-row-selected text-foreground"

export const sidebarRowIdle = "hover:bg-fill-chip"

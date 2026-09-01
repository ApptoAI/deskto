import type { ReactNode } from "react"

import { cn } from "@workspace/ui/lib/utils"

const sidebarWidthClass = {
  default: "w-[256px]",
  compact: "w-[256px]",
  "rail-stack": "w-[328px]",
} as const

/**
 * The chrome both sidebars share: width, the window drag strip, and the lockup.
 * Settings replaces the workspace chrome, so rail-stack reserves the combined
 * width of the rail and compact project sidebar.
 *
 * No border: the sidebar sits on the window shell and the pane beside it
 * carries the only edge in the window.
 */
export function SidebarFrame({
  children,
  width = "default",
}: {
  children: ReactNode
  width?: keyof typeof sidebarWidthClass
}) {
  return (
    <aside className={cn("flex shrink-0 flex-col", sidebarWidthClass[width])}>
      {children}
    </aside>
  )
}

/**
 * Selected row in either sidebar: tasks in one, settings pages in the other.
 *
 * One quiet fill in both themes, with no bevel or border competing with the
 * row's label.
 */
export const sidebarRowSelected = "bg-fill-row-selected text-foreground"

export const sidebarRowIdle = "hover:bg-fill-chip"

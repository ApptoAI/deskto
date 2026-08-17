import type { ReactNode } from "react"

import { cn } from "@workspace/ui/lib/utils"

import { DesktoLockup } from "../deskto-logo.js"

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
        "flex shrink-0 flex-col border-r border-border bg-sidebar",
        sidebarWidthClass[width]
      )}
    >
      {/* Traffic lights sit at the left of this strip, so the logo takes the
          right. Still a drag region — the svg is not an interactive target. */}
      <div className="drag-region flex h-13 shrink-0 items-center justify-end px-3">
        <DesktoLockup className="h-[15px] w-auto text-foreground/70" />
      </div>
      {children}
    </aside>
  )
}

/**
 * Selected row in either sidebar: tasks in one, settings pages in the other.
 *
 * The two palettes lift the row in opposite directions, because the sidebar is
 * the lighter surface in dark and the darker one in light. Dark raises it to
 * the accent step; light lifts it back to the page colour and outlines it.
 */
export const sidebarRowSelected =
  "bg-background text-foreground ring-1 ring-border dark:bg-accent dark:ring-0"

export const sidebarRowIdle = "hover:bg-accent/60"

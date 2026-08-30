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
        "glass-panel flex shrink-0 flex-col border-r border-border",
        sidebarWidthClass[width]
      )}
    >
      {/* Traffic lights sit at the left of this strip, so the logo takes the
          right. Still a drag region — the svg is not an interactive target. */}
      <div className="drag-region flex h-13 shrink-0 items-center justify-end px-3">
        {/* Sized by the lettering, not the whole lockup: the mark overshoots
            the cap height on both sides, so matching the old 15px overall
            would have set the word two steps smaller than it used to read. */}
        <DesktoLockup className="h-[18px] w-auto text-foreground/70" />
      </div>
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

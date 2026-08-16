import type { ReactNode } from "react"

import { ApptoLockup } from "../appto-logo.js"

/**
 * The chrome both sidebars share: fixed width, the window drag strip, and the
 * lockup. Settings swaps one sidebar for the other, so the two have to line up
 * pixel for pixel across the swap.
 */
export function SidebarFrame({ children }: { children: ReactNode }) {
  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-sidebar xl:w-80">
      {/* Traffic lights sit at the left of this strip, so the logo takes the
          right. Still a drag region — the svg is not an interactive target. */}
      <div className="drag-region flex h-13 shrink-0 items-center justify-end px-3">
        <ApptoLockup className="h-[15px] w-auto text-foreground/70" />
      </div>
      {children}
    </aside>
  )
}

/** Selected row in either sidebar: tasks in one, settings pages in the other. */
export const sidebarRowSelected =
  "bg-background text-foreground shadow-xs ring-1 ring-border/70 dark:bg-accent dark:shadow-none dark:ring-0"

export const sidebarRowIdle = "hover:bg-muted/50"
